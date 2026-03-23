import { createDecipheriv } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const MEGA_PUBLIC_API_URL = 'https://g.api.mega.co.nz/cs';
const ZERO_IV = Buffer.alloc(16, 0);
const LEGACY_SIDECAR_DIR = '.nearbytes-sync';

interface MegaFolderTreeResponse {
  readonly f?: readonly MegaFolderNodeRecord[];
}

interface MegaFolderNodeRecord {
  readonly h?: string;
  readonly p?: string;
  readonly t?: number;
  readonly s?: number;
  readonly a?: string;
  readonly k?: string;
}

interface MegaDownloadTicketResponse {
  readonly g?: string;
  readonly s?: number;
  readonly at?: string;
}

interface MegaDecryptedNode {
  readonly handle: string;
  readonly parentHandle?: string;
  readonly isFolder: boolean;
  readonly size: number;
  readonly name: string;
  readonly nodeKey: Buffer;
}

export interface MegaPublicLinkTarget {
  readonly kind: 'file' | 'folder';
  readonly publicHandle: string;
  readonly key: string;
  readonly objectHandle?: string;
  readonly publicLink: string;
}

export function resolveMegaPublicLinkTarget(descriptor: Record<string, unknown>): MegaPublicLinkTarget | null {
  const publicLink = getDescriptorString(descriptor, 'publicLink') ?? getDescriptorString(descriptor, 'remotePath');
  if (!publicLink) {
    return null;
  }
  return parseMegaPublicLink(publicLink);
}

export function normalizeMegaPublicLinkDescriptor(descriptor: Record<string, unknown>): Record<string, unknown> | null {
  const target = resolveMegaPublicLinkTarget(descriptor);
  if (!target) {
    return null;
  }
  return {
    ...descriptor,
    publicLink: target.publicLink,
    remotePath: getDescriptorString(descriptor, 'remotePath') ?? target.publicLink,
    accessLevel: getDescriptorString(descriptor, 'accessLevel') ?? 'public link',
  };
}

export async function mirrorMegaPublicLink(options: {
  descriptor: Record<string, unknown>;
  localPath: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const target = resolveMegaPublicLinkTarget(options.descriptor);
  if (!target) {
    throw new Error('MEGA public link is missing or invalid.');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available for MEGA public link mirroring.');
  }

  await fs.mkdir(options.localPath, { recursive: true });
  await removeLegacyPublicLinkArtifacts(options.localPath);

  if (target.kind === 'file') {
    await mirrorPublicFileLink(fetchImpl, target, options.localPath);
    return;
  }

  await mirrorPublicFolderLink(fetchImpl, target, options.localPath);
}

function parseMegaPublicLink(rawValue: string): MegaPublicLinkTarget | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  const modernMatch = value.match(
    /(?:https?:\/\/)?(?:www\.)?mega\.nz\/(file|folder)\/([A-Za-z0-9_-]{8})#([A-Za-z0-9_-]{16,64})(?:\/(folder|file)\/([A-Za-z0-9_-]{8}))?/iu
  );
  if (modernMatch) {
    return {
      kind: (modernMatch[1] ?? '').toLowerCase() === 'folder' ? 'folder' : 'file',
      publicHandle: modernMatch[2] ?? '',
      key: modernMatch[3] ?? '',
      objectHandle: modernMatch[5]?.trim() || undefined,
      publicLink: value,
    };
  }

  const legacyFolderMatch = value.match(/^#?F!([A-Za-z0-9_-]{8})!([A-Za-z0-9_-]{16,64})(?:[!?]([A-Za-z0-9_-]{8}))?$/iu);
  if (legacyFolderMatch) {
    return {
      kind: 'folder',
      publicHandle: legacyFolderMatch[1] ?? '',
      key: legacyFolderMatch[2] ?? '',
      objectHandle: legacyFolderMatch[3]?.trim() || undefined,
      publicLink: value,
    };
  }

  const legacyFileMatch = value.match(/^#!([A-Za-z0-9_-]{8})!([A-Za-z0-9_-]{16,64})$/iu);
  if (legacyFileMatch) {
    return {
      kind: 'file',
      publicHandle: legacyFileMatch[1] ?? '',
      key: legacyFileMatch[2] ?? '',
      publicLink: value,
    };
  }

  return null;
}

async function mirrorPublicFileLink(fetchImpl: typeof fetch, target: MegaPublicLinkTarget, localPath: string): Promise<void> {
  const fileKey = decodeMegaBase64Url(target.key);
  const ticket = await megaApiRequest<MegaDownloadTicketResponse>(fetchImpl, { a: 'g', p: target.publicHandle });
  if (!ticket.g) {
    throw new Error('MEGA public file link did not return a download URL.');
  }
  const name = decryptNodeName(ticket.at, fileKey) ?? target.publicHandle;
  await downloadMegaFile(fetchImpl, ticket.g, fileKey, path.join(localPath, sanitizePathSegment(name)), ticket.s ?? 0);
}

async function mirrorPublicFolderLink(fetchImpl: typeof fetch, target: MegaPublicLinkTarget, localPath: string): Promise<void> {
  const folderKey = decodeMegaBase64Url(target.key);
  const response = await megaApiRequest<MegaFolderTreeResponse>(fetchImpl, { a: 'f', c: 1, r: 1 }, target.publicHandle);
  const decryptedNodes = decryptMegaFolderNodes(response.f ?? [], target.publicHandle, folderKey);
  const nodesByHandle = new Map(decryptedNodes.map((node) => [node.handle, node]));
  const childrenByParent = new Map<string, MegaDecryptedNode[]>();

  for (const node of decryptedNodes) {
    if (!node.parentHandle) {
      continue;
    }
    const siblings = childrenByParent.get(node.parentHandle) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentHandle, siblings);
  }

  const rootHandle = target.objectHandle ?? target.publicHandle;
  const rootNode = nodesByHandle.get(rootHandle);
  if (!rootNode) {
    throw new Error('MEGA public folder link does not contain the requested node.');
  }

  if (!rootNode.isFolder) {
    await mirrorFolderFileNode(fetchImpl, target, rootNode, localPath);
    return;
  }

  const rootChildren = childrenByParent.get(rootNode.handle) ?? [];
  for (const child of rootChildren) {
    if (isInternalSyncNode(child.name)) {
      continue;
    }
    await mirrorFolderNode(fetchImpl, target, child, localPath, childrenByParent);
  }
}

async function mirrorFolderNode(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  node: MegaDecryptedNode,
  destinationRoot: string,
  childrenByParent: ReadonlyMap<string, readonly MegaDecryptedNode[]>
): Promise<void> {
  const destinationPath = path.join(destinationRoot, sanitizePathSegment(node.name));
  if (!node.isFolder) {
    await mirrorFolderFileNode(fetchImpl, target, node, destinationPath);
    return;
  }

  await fs.mkdir(destinationPath, { recursive: true });
  const children = childrenByParent.get(node.handle) ?? [];
  for (const child of children) {
    await mirrorFolderNode(fetchImpl, target, child, destinationPath, childrenByParent);
  }
}

async function mirrorFolderFileNode(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  node: MegaDecryptedNode,
  destinationPath: string
): Promise<void> {
  const existing = await fs.stat(destinationPath).catch(() => null);
  if (existing?.isFile() && existing.size === node.size) {
    return;
  }

  const ticket = await megaApiRequest<MegaDownloadTicketResponse>(
    fetchImpl,
    { a: 'g', g: 1, n: node.handle },
    target.publicHandle
  );
  if (!ticket.g) {
    throw new Error(`MEGA public folder child ${node.name} did not return a download URL.`);
  }
  await downloadMegaFile(fetchImpl, ticket.g, node.nodeKey, destinationPath, node.size);
}

function decryptMegaFolderNodes(
  nodes: readonly MegaFolderNodeRecord[],
  publicHandle: string,
  folderKey: Buffer
): MegaDecryptedNode[] {
  const decryptedNodes: MegaDecryptedNode[] = [];
  const rootHandle = publicHandle.trim();

  for (const node of nodes) {
    const handle = node.h?.trim() ?? '';
    if (!handle) {
      continue;
    }

    let nodeKey: Buffer | null;
    if (handle === rootHandle) {
      nodeKey = folderKey;
    } else {
      nodeKey = decryptNodeKey(node.k, folderKey, rootHandle);
    }
    if (!nodeKey) {
      continue;
    }

    const name = decryptNodeName(node.a, nodeKey);
    if (!name) {
      continue;
    }

    decryptedNodes.push({
      handle,
      parentHandle: node.p?.trim() || undefined,
      isFolder: Number(node.t ?? 0) !== 0,
      size: Number(node.s ?? 0) || 0,
      name,
      nodeKey,
    });
  }

  return decryptedNodes;
}

function isInternalSyncNode(name: string): boolean {
  return name.trim() === LEGACY_SIDECAR_DIR;
}

async function removeLegacyPublicLinkArtifacts(localPath: string): Promise<void> {
  await fs.rm(path.join(localPath, LEGACY_SIDECAR_DIR), { recursive: true, force: true }).catch(() => undefined);
}

function decryptNodeKey(value: string | undefined, shareKey: Buffer, rootHandle: string): Buffer | null {
  const encoded = extractNodeKeyMaterial(value, rootHandle);
  if (!encoded) {
    return null;
  }
  const encrypted = decodeMegaBase64Url(encoded);
  if (encrypted.length === 0 || encrypted.length % 16 !== 0) {
    return null;
  }
  return decryptAesEcb(encrypted, shareKey);
}

function extractNodeKeyMaterial(value: string | undefined, rootHandle: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  let fallback: string | null = null;
  for (const segment of trimmed.split('/')) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex === -1) {
      if (!fallback) {
        fallback = segment;
      }
      continue;
    }
    const segmentHandle = segment.slice(0, colonIndex).trim();
    const encoded = segment.slice(colonIndex + 1).trim();
    if (!encoded) {
      continue;
    }
    if (!fallback) {
      fallback = encoded;
    }
    if (segmentHandle === rootHandle) {
      return encoded;
    }
  }
  return fallback;
}

function decryptNodeName(attributes: string | undefined, nodeKey: Buffer): string | null {
  const encodedAttributes = attributes?.trim();
  if (!encodedAttributes) {
    return null;
  }

  const decrypted = decryptAesCbc(decodeMegaBase64Url(encodedAttributes), deriveAttributeKey(nodeKey));
  const cleaned = decrypted.toString('utf8').replace(/\u0000+$/u, '');
  if (!cleaned.startsWith('MEGA')) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned.slice(4)) as { n?: unknown };
    return typeof parsed.n === 'string' && parsed.n.trim() !== '' ? parsed.n : null;
  } catch {
    return null;
  }
}

async function downloadMegaFile(
  fetchImpl: typeof fetch,
  url: string,
  nodeKey: Buffer,
  destinationPath: string,
  expectedSize: number
): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(`MEGA file download failed with HTTP ${response.status}.`);
  }

  const tempPath = `${destinationPath}.nearbytes-part`;
  const decipher = createDecipheriv('aes-128-ctr', deriveContentKey(nodeKey), deriveContentIv(nodeKey));
  const source = Readable.fromWeb(response.body as never);
  const sink = (await import('fs')).createWriteStream(tempPath);

  try {
    await pipeline(source, decipher, sink);
    if (expectedSize > 0) {
      const stats = await fs.stat(tempPath);
      if (stats.size !== expectedSize) {
        throw new Error(`MEGA file download size mismatch for ${path.basename(destinationPath)}.`);
      }
    }
    await fs.rename(tempPath, destinationPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function megaApiRequest<T>(
  fetchImpl: typeof fetch,
  payload: Record<string, unknown>,
  publicHandle?: string
): Promise<T> {
  const url = new URL(MEGA_PUBLIC_API_URL);
  url.searchParams.set('id', String(Date.now()));
  if (publicHandle) {
    url.searchParams.set('n', publicHandle);
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify([payload]),
  });
  if (!response.ok) {
    throw new Error(`MEGA public API failed with HTTP ${response.status}.`);
  }
  const json = (await response.json()) as unknown;
  const result = unwrapMegaApiResult(json);
  if (typeof result === 'number' && result < 0) {
    throw new Error(`MEGA public API returned error ${result}.`);
  }
  return result as T;
}

function unwrapMegaApiResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }
  if (value && typeof value === 'object' && 'result' in value) {
    return (value as { result?: unknown }).result;
  }
  return value;
}

function deriveAttributeKey(nodeKey: Buffer): Buffer {
  if (nodeKey.length >= 32) {
    return xorBuffers(nodeKey.subarray(0, 16), nodeKey.subarray(16, 32));
  }
  return nodeKey.subarray(0, 16);
}

function deriveContentKey(nodeKey: Buffer): Buffer {
  return deriveAttributeKey(nodeKey);
}

function deriveContentIv(nodeKey: Buffer): Buffer {
  if (nodeKey.length < 24) {
    return ZERO_IV;
  }
  const iv = Buffer.alloc(16, 0);
  nodeKey.copy(iv, 0, 16, 24);
  return iv;
}

function decryptAesEcb(value: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key.subarray(0, 16), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(value), decipher.final()]);
}

function decryptAesCbc(value: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-cbc', key.subarray(0, 16), ZERO_IV);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(value), decipher.final()]);
}

function decodeMegaBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const result = Buffer.alloc(Math.min(left.length, right.length));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = left[index]! ^ right[index]!;
  }
  return result;
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, ' ').trim();
  return cleaned || 'unnamed';
}

function getDescriptorString(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}