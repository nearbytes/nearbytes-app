import { createDecipheriv } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  NEARBYTES_SYNC_DIR,
  NEARBYTES_SYNC_INDEX_PATH,
  type NearbytesSyncChannelManifest,
  type NearbytesSyncIndex,
} from '../storage/syncManifest.js';

const MEGA_PUBLIC_API_URL = 'https://g.api.mega.co.nz/cs';
const ZERO_IV = Buffer.alloc(16, 0);
const LOCAL_PUBLIC_LINK_CACHE_FILE = 'mega-public-link-cache.json';

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
  readonly encodedKey: string;
}

interface MegaCachedNodeRef {
  readonly handle: string;
  readonly key: string;
  readonly size: number;
}

interface MegaPublicLinkCache {
  readonly version: 1;
  readonly publicHandle: string;
  readonly nodesByPath: Record<string, MegaCachedNodeRef>;
  readonly channelRevisions: Record<string, number>;
}

interface MegaPublicFolderTree {
  readonly rootNode: MegaDecryptedNode;
  readonly childrenByParent: ReadonlyMap<string, readonly MegaDecryptedNode[]>;
  readonly fileNodesByPath: ReadonlyMap<string, MegaDecryptedNode>;
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
  const cached = await readMegaPublicLinkCache(localPath, target.publicHandle);
  const appliedFromCache = cached
    ? await applyNearbytesSyncIndex(fetchImpl, target, localPath, cached, (relativePath) =>
        cached.nodesByPath[relativePath] ?? null
      ).catch(() => null)
    : null;
  if (appliedFromCache) {
    await writeMegaPublicLinkCache(localPath, appliedFromCache);
    return;
  }

  const tree = await loadMegaPublicFolderTree(fetchImpl, target);
  const nextCache = buildMegaPublicLinkCache(target, tree, cached);
  const appliedFromTree = await applyNearbytesSyncIndex(fetchImpl, target, localPath, nextCache, (relativePath) =>
    nextCache.nodesByPath[relativePath] ?? null
  ).catch(() => null);
  if (appliedFromTree) {
    await writeMegaPublicLinkCache(localPath, appliedFromTree);
    return;
  }

  const rootChildren = tree.childrenByParent.get(tree.rootNode.handle) ?? [];
  for (const child of rootChildren) {
    if (isInternalSyncNode(child.name)) {
      continue;
    }
    await mirrorFolderNode(fetchImpl, target, child, localPath, tree.childrenByParent);
  }

  await writeMegaPublicLinkCache(localPath, nextCache);
}

async function applyNearbytesSyncIndex(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  localPath: string,
  cache: MegaPublicLinkCache,
  resolveNodeRef: (relativePath: string) => MegaCachedNodeRef | null
): Promise<MegaPublicLinkCache | null> {
  const indexRef = resolveNodeRef(NEARBYTES_SYNC_INDEX_PATH);
  if (!indexRef) {
    return null;
  }

  const index = await downloadFolderJson<NearbytesSyncIndex>(fetchImpl, target, indexRef);
  if (!index || index.version !== 1) {
    return null;
  }

  const nextRevisions = { ...cache.channelRevisions };
  for (const [channelId, channelRef] of Object.entries(index.channels ?? {})) {
    const manifestRef = resolveNodeRef(channelRef.manifestPath);
    if (!manifestRef) {
      return null;
    }
    const manifest = await downloadFolderJson<NearbytesSyncChannelManifest>(fetchImpl, target, manifestRef);
    if (!manifest || manifest.version !== 1) {
      return null;
    }
    if ((cache.channelRevisions[channelId] ?? 0) === manifest.revision) {
      nextRevisions[channelId] = manifest.revision;
      continue;
    }

    for (const eventRecord of manifest.events) {
      await ensureMirrorFile(fetchImpl, target, localPath, eventRecord.eventPath, resolveNodeRef);
      if (eventRecord.blockPath) {
        await ensureMirrorFile(fetchImpl, target, localPath, eventRecord.blockPath, resolveNodeRef);
      }
    }

    nextRevisions[channelId] = manifest.revision;
  }

  return {
    version: 1,
    publicHandle: target.publicHandle,
    nodesByPath: cache.nodesByPath,
    channelRevisions: nextRevisions,
  };
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
      encodedKey: encodeMegaBase64Url(nodeKey),
    });
  }

  return decryptedNodes;
}

async function loadMegaPublicFolderTree(fetchImpl: typeof fetch, target: MegaPublicLinkTarget): Promise<MegaPublicFolderTree> {
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

  const fileNodesByPath = new Map<string, MegaDecryptedNode>();
  if (rootNode.isFolder) {
    collectFileNodes(rootNode.handle, '', childrenByParent, fileNodesByPath);
  } else {
    fileNodesByPath.set(sanitizeRelativePath(rootNode.name), rootNode);
  }

  return {
    rootNode,
    childrenByParent,
    fileNodesByPath,
  };
}

function collectFileNodes(
  parentHandle: string,
  parentPath: string,
  childrenByParent: ReadonlyMap<string, readonly MegaDecryptedNode[]>,
  fileNodesByPath: Map<string, MegaDecryptedNode>
): void {
  const children = childrenByParent.get(parentHandle) ?? [];
  for (const child of children) {
    const relativePath = parentPath ? `${parentPath}/${sanitizeRelativePath(child.name)}` : sanitizeRelativePath(child.name);
    if (child.isFolder) {
      collectFileNodes(child.handle, relativePath, childrenByParent, fileNodesByPath);
      continue;
    }
    fileNodesByPath.set(relativePath, child);
  }
}

function buildMegaPublicLinkCache(
  target: MegaPublicLinkTarget,
  tree: MegaPublicFolderTree,
  existing: MegaPublicLinkCache | null
): MegaPublicLinkCache {
  const nodesByPath: Record<string, MegaCachedNodeRef> = {};
  for (const [relativePath, node] of tree.fileNodesByPath) {
    nodesByPath[relativePath] = {
      handle: node.handle,
      key: node.encodedKey,
      size: node.size,
    };
  }

  return {
    version: 1,
    publicHandle: target.publicHandle,
    nodesByPath,
    channelRevisions: existing?.publicHandle === target.publicHandle ? existing.channelRevisions : {},
  };
}

async function ensureMirrorFile(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  localPath: string,
  relativePath: string,
  resolveNodeRef: (relativePath: string) => MegaCachedNodeRef | null
): Promise<void> {
  const normalizedPath = sanitizeRelativePath(relativePath);
  const ref = resolveNodeRef(normalizedPath);
  if (!ref) {
    throw new Error(`Missing cached MEGA node for ${normalizedPath}.`);
  }

  const destinationPath = path.join(localPath, ...normalizedPath.split('/'));
  const existing = await fs.stat(destinationPath).catch(() => null);
  if (existing?.isFile() && existing.size === ref.size) {
    return;
  }

  await downloadMegaNodeToPath(fetchImpl, target, ref, destinationPath);
}

async function downloadFolderJson<T>(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  ref: MegaCachedNodeRef
): Promise<T | null> {
  const bytes = await downloadMegaNodeToBuffer(fetchImpl, target, ref);
  try {
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch {
    return null;
  }
}

async function downloadMegaNodeToPath(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  ref: MegaCachedNodeRef,
  destinationPath: string
): Promise<void> {
  const ticket = await megaApiRequest<MegaDownloadTicketResponse>(
    fetchImpl,
    { a: 'g', g: 1, n: ref.handle },
    target.publicHandle
  );
  if (!ticket.g) {
    throw new Error(`MEGA public folder child ${ref.handle} did not return a download URL.`);
  }
  await downloadMegaFile(fetchImpl, ticket.g, decodeMegaBase64Url(ref.key), destinationPath, ref.size);
}

async function downloadMegaNodeToBuffer(
  fetchImpl: typeof fetch,
  target: MegaPublicLinkTarget,
  ref: MegaCachedNodeRef
): Promise<Buffer> {
  const ticket = await megaApiRequest<MegaDownloadTicketResponse>(
    fetchImpl,
    { a: 'g', g: 1, n: ref.handle },
    target.publicHandle
  );
  if (!ticket.g) {
    throw new Error(`MEGA public folder child ${ref.handle} did not return a download URL.`);
  }

  const response = await fetchImpl(ticket.g);
  if (!response.ok) {
    throw new Error(`MEGA file download failed with HTTP ${response.status}.`);
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  const nodeKey = decodeMegaBase64Url(ref.key);
  const decipher = createDecipheriv('aes-128-ctr', deriveContentKey(nodeKey), deriveContentIv(nodeKey));
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  if (ref.size > 0 && decrypted.length !== ref.size) {
    throw new Error(`MEGA file download size mismatch for ${ref.handle}.`);
  }
  return decrypted;
}

async function readMegaPublicLinkCache(localPath: string, publicHandle: string): Promise<MegaPublicLinkCache | null> {
  const cachePath = path.join(localPath, NEARBYTES_SYNC_DIR, LOCAL_PUBLIC_LINK_CACHE_FILE);
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as MegaPublicLinkCache;
    if (parsed.version !== 1 || parsed.publicHandle !== publicHandle) {
      return null;
    }
    return {
      version: 1,
      publicHandle: parsed.publicHandle,
      nodesByPath: parsed.nodesByPath ?? {},
      channelRevisions: parsed.channelRevisions ?? {},
    };
  } catch {
    return null;
  }
}

async function writeMegaPublicLinkCache(localPath: string, cache: MegaPublicLinkCache): Promise<void> {
  const cacheDir = path.join(localPath, NEARBYTES_SYNC_DIR);
  await fs.mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, LOCAL_PUBLIC_LINK_CACHE_FILE);
  await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8');
}

function isInternalSyncNode(name: string): boolean {
  return name.trim() === NEARBYTES_SYNC_DIR;
}

function sanitizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.trim() !== '')
    .map((segment) => sanitizePathSegment(segment))
    .join('/');
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

function encodeMegaBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
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