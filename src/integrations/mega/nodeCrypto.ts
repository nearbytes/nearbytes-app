import { Buffer } from 'buffer';
import { cbc as nobleAesCbc, ctr as nobleAesCtr } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { MegaSession } from './core.js';
import { decryptAesEcb, rsaRawDecryptMpi } from './crypto.js';
import { decodeMegaBase64Url, type MegaApiClient, type MegaFetchNodesSnapshot, type MegaNodeRecord, type MegaUserRecord } from './protocol.js';
import { ZERO_IV } from './adapterConstants.js';
import type { DecryptedMegaNode } from './adapterTypes.js';
import { assertString, describeAccessLevel, isMegaNodeHandle } from './shareHelpers.js';
import { keepMegaSyncAliveWhile } from './syncUtils.js';

let warnedMissingPrivateKeyForShareKey = false;

export function fingerprintMegaShareKey(shareKey: Buffer): string {
  return Buffer.from(sha256(shareKey)).toString('hex').slice(0, 16);
}

export function resolveTreeRootHandle(nodesByHandle: ReadonlyMap<string, DecryptedMegaNode>): string {
  for (const node of nodesByHandle.values()) {
    if (node.nodeType === 2) {
      return node.handle;
    }
  }
  for (const node of nodesByHandle.values()) {
    if (!node.parentHandle || !nodesByHandle.has(node.parentHandle)) {
      return node.handle;
    }
  }
  throw new Error('MEGA tree root could not be determined.');
}

export function decryptNodeRecord(
  node: MegaNodeRecord,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>,
  usersByHandle: ReadonlyMap<string, MegaUserRecord>,
  availableNodeKeys: ReadonlyMap<string, Buffer> = new Map()
): DecryptedMegaNode | null {
  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }

  const nodeType = Number(node.t ?? 0);
  const isSpecialRoot = nodeType === 2 || nodeType === 3 || nodeType === 4;
  const candidateKeys = decryptNodeKeys(node, session, shareKeys, availableNodeKeys);
  const nodeMeta = node as Record<string, unknown>;
  const directShareKey =
    typeof nodeMeta.su === 'string' && nodeMeta.su.trim() !== '' && shareKeys.has(handle)
      ? shareKeys.get(handle)
      : undefined;
  if (directShareKey && !candidateKeys.some((candidate) => candidate.nodeKey.equals(directShareKey))) {
    candidateKeys.unshift({ nodeKey: Buffer.from(directShareKey), keyOwner: handle });
  }
  const nodeCandidates = candidateKeys.length > 0 ? candidateKeys : isSpecialRoot ? [{ nodeKey: Buffer.alloc(16, 0) }] : [];
  let resolvedNodeKey: Buffer | null = null;
  let name: string | undefined;
  for (const candidate of nodeCandidates) {
    const candidateName = decryptNodeName(typeof node.a === 'string' ? node.a : undefined, candidate.nodeKey)
      ?? describeMegaSpecialNodeName(nodeType);
    if (!candidateName) {
      continue;
    }
    resolvedNodeKey = candidate.nodeKey;
    name = candidateName;
    break;
  }
  if (!resolvedNodeKey || !name) {
    return null;
  }

  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : undefined;
  const ownerEmail = ownerHandle ? (typeof usersByHandle.get(ownerHandle)?.m === 'string' ? String(usersByHandle.get(ownerHandle)?.m) : undefined) : undefined;
  const accessLevel = megaIncomingAccessLevelFromMeta(nodeMeta);
  const shareHandle = deriveShareHandle(typeof node.k === 'string' ? node.k : undefined, shareKeys) ?? handle;

  return {
    handle,
    parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
    nodeType,
    isFolder: nodeType !== 0,
    size: Number(node.s ?? 0) || 0,
    name,
    modifiedAt: typeof node.ts === 'number' && Number.isFinite(node.ts) ? Math.trunc(node.ts) : undefined,
    nodeKey: resolvedNodeKey,
    encodedKey: typeof node.k === 'string' ? node.k : undefined,
    encodedAttributes: typeof node.a === 'string' ? node.a : undefined,
    ownerHandle,
    ownerEmail,
    accessLevel,
    shareHandle,
  };
}

export function resolveMegaCloudDriveHandle(snapshot: MegaFetchNodesSnapshot): string | undefined {
  for (const node of snapshot.nodes) {
    if (Number(node.t ?? 0) === 2 && typeof node.h === 'string' && node.h.trim()) {
      return node.h.trim();
    }
  }
  for (const node of snapshot.nodes) {
    const handle = typeof node.h === 'string' ? node.h.trim() : '';
    const parent = typeof node.p === 'string' ? node.p.trim() : '';
    const nodeType = Number(node.t ?? 0);
    if (handle && !parent && nodeType !== 0) {
      return handle;
    }
  }
  return undefined;
}

export function describeMegaSpecialNodeName(nodeType: number): string | undefined {
  switch (nodeType) {
    case 2:
      return 'Cloud Drive';
    case 3:
      return 'Inbox';
    case 4:
      return 'Rubbish Bin';
    default:
      return undefined;
  }
}

export function megaNodeExplicitFileType(nodeMeta: Record<string, unknown>): boolean {
  if (!('t' in nodeMeta)) {
    return false;
  }
  const raw = nodeMeta.t;
  if (raw === undefined || raw === null) {
    return false;
  }
  return Number(raw) === 0;
}

export function megaIncomingAccessLevelFromMeta(nodeMeta: Record<string, unknown>): string | undefined {
  const raw = nodeMeta.r;
  const level =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number.parseInt(raw.trim(), 10)
        : NaN;
  return Number.isFinite(level) ? describeAccessLevel(level) : undefined;
}

export function deriveShareHandle(encodedKey: string | undefined, shareKeys: ReadonlyMap<string, Buffer>): string | undefined {
  const key = encodedKey?.trim();
  if (!key) {
    return undefined;
  }
  for (const segment of key.split('/')) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const handle = segment.slice(0, colonIndex).trim();
    if (isMegaNodeHandle(handle) && shareKeys.has(handle)) {
      return handle;
    }
  }
  return undefined;
}

export function listMegaNodeKeyOwners(encodedKey: string | undefined): string[] {
  const encoded = encodedKey?.trim();
  if (!encoded) {
    return [];
  }
  const owners: string[] = [];
  for (const segment of encoded.split('/')) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const owner = segment.slice(0, colonIndex).trim();
    if (owner && !owners.includes(owner)) {
      owners.push(owner);
    }
  }
  return owners;
}

export function decryptShareKey(value: string, session: MegaSession): Buffer | null {
  const payload = value.trim();
  if (!payload) {
    return null;
  }
  if (payload.length > 43) {
    if (!session.privateKey) {
      if (!warnedMissingPrivateKeyForShareKey) {
        warnedMissingPrivateKeyForShareKey = true;
        console.warn(
          '[MEGA] RSA-encrypted share key found but session has no private key.',
          'This share cannot be decrypted — reconnect MEGA so Nearbytes can obtain the RSA private key.',
          { email: session.email, skLength: payload.length }
        );
      }
      return null;
    }
    const cleartext = rsaRawDecryptMpi(decodeMegaBase64Url(payload), session.privateKey);
    return cleartext.length >= 16 ? cleartext.subarray(0, 16) : null;
  }

  const encrypted = decodeMegaBase64Url(payload);
  if (encrypted.length !== 16) {
    return null;
  }
  return decryptAesEcb(encrypted, session.masterKey);
}

export function decryptNodeKeys(
  node: MegaNodeRecord,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>,
  availableNodeKeys: ReadonlyMap<string, Buffer> = new Map()
): Array<{ nodeKey: Buffer; keyOwner?: string }> {
  const encoded = typeof node.k === 'string' ? node.k.trim() : '';
  const nodeHandle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!encoded) {
    return [];
  }

  const candidates: Array<{ keyOwner: string; payload: string }> = [];
  if (encoded.length === 22 || encoded.length === 43) {
    candidates.push({ keyOwner: session.userHandle, payload: encoded });
  } else {
    const ownedSegments: Array<{ owner: string; payload: string }> = [];
    for (const segment of encoded.split('/')) {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) {
        continue;
      }
      const owner = segment.slice(0, colonIndex).trim();
      const candidate = segment.slice(colonIndex + 1).trim();
      if (!owner || !candidate) {
        continue;
      }
      ownedSegments.push({ owner, payload: candidate });
    }
    for (const segment of ownedSegments) {
      if (segment.owner === session.userHandle || shareKeys.has(segment.owner)) {
        candidates.push({ keyOwner: segment.owner, payload: segment.payload });
      }
    }
    if (candidates.length === 0 && encoded.length > 12 && encoded[11] === ':') {
      const owner = encoded.slice(0, 11).trim();
      const candidate = encoded.slice(12).trim();
      if (owner === session.userHandle || shareKeys.has(owner)) {
        candidates.push({ keyOwner: owner, payload: candidate });
      }
    }

    if (candidates.length === 0 && nodeHandle && shareKeys.has(nodeHandle)) {
      for (const segment of ownedSegments) {
        candidates.push({ keyOwner: nodeHandle, payload: segment.payload });
      }
      if (candidates.length === 0 && encoded.length > 12 && encoded[11] === ':') {
        const candidate = encoded.slice(12).trim();
        if (candidate) {
          candidates.push({ keyOwner: nodeHandle, payload: candidate });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const decrypted: Array<{ nodeKey: Buffer; keyOwner?: string }> = [];
  for (const candidate of candidates) {
    const dedupeKey = `${candidate.keyOwner}:${candidate.payload}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const encrypted = decodeMegaBase64Url(candidate.payload);
    if (candidate.payload.length > 43) {
      if (!session.privateKey) {
        continue;
      }
      const cleartext = rsaRawDecryptMpi(encrypted, session.privateKey);
      const keyLength = Number(node.t ?? 0) !== 0 ? 16 : 32;
      if (cleartext.length >= keyLength) {
        decrypted.push({ nodeKey: cleartext.subarray(0, keyLength), keyOwner: candidate.keyOwner });
      }
      continue;
    }

    const candidateDecryptionKeys =
      candidate.keyOwner === session.userHandle
        ? [session.masterKey]
        : [shareKeys.get(candidate.keyOwner), availableNodeKeys.get(candidate.keyOwner)].filter(
            (value): value is Buffer => Buffer.isBuffer(value)
          );
    if (candidateDecryptionKeys.length === 0 || encrypted.length === 0 || encrypted.length % 16 !== 0) {
      continue;
    }
    for (const key of candidateDecryptionKeys) {
      decrypted.push({ nodeKey: decryptAesEcb(encrypted, key), keyOwner: candidate.keyOwner });
    }
  }
  return decrypted;
}

export function decryptNodeName(attributes: string | undefined, nodeKey: Buffer): string | null {
  const encoded = attributes?.trim();
  if (!encoded) {
    return null;
  }

  const ciphertext = decodeMegaBase64Url(encoded);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    return null;
  }
  const plaintext = Buffer.from(
    nobleAesCbc(deriveAttributeKey(nodeKey), ZERO_IV, { disablePadding: true }).decrypt(ciphertext)
  ).toString('utf8').replace(/\u0000+$/u, '');
  if (!plaintext.startsWith('MEGA')) {
    return null;
  }
  try {
    const parsed = JSON.parse(plaintext.slice(4)) as { n?: unknown };
    return typeof parsed.n === 'string' && parsed.n.trim() ? parsed.n : null;
  } catch {
    return null;
  }
}

export function deriveAttributeKey(nodeKey: Buffer): Buffer {
  if (nodeKey.length >= 32) {
    const result = Buffer.alloc(16);
    for (let index = 0; index < 16; index += 1) {
      result[index] = nodeKey[index]! ^ nodeKey[index + 16]!;
    }
    return result;
  }
  return nodeKey.subarray(0, 16);
}

export async function downloadAuthenticatedMegaFileContent(
  fetchImpl: typeof fetch,
  apiClient: MegaApiClient,
  session: MegaSession,
  handle: string,
  nodeKey: Buffer,
  expectedSize?: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const response = await keepMegaSyncAliveWhile(
    apiClient.requestSingle<Record<string, unknown> | number>(
      { a: 'g', g: 1, n: handle },
      { sessionId: session.sid, signal }
    ),
    signal
  );
  if (typeof response === 'number') {
    throw new Error(`MEGA API error ${response}.`);
  }
  const url = assertString(response.g, `MEGA did not return a download URL for ${handle}.`);
  const download = await keepMegaSyncAliveWhile(fetchImpl(url, { signal }), signal);
  if (!download.ok) {
    throw new Error(`MEGA file download failed with HTTP ${download.status}.`);
  }
  const ciphertext = Buffer.from(await keepMegaSyncAliveWhile(download.arrayBuffer(), signal));
  const plaintext = decryptFileCiphertext(ciphertext, nodeKey);
  if (typeof expectedSize === 'number' && expectedSize > 0 && plaintext.length !== expectedSize) {
    throw new Error(`MEGA file download size mismatch for handle ${handle}.`);
  }
  return plaintext;
}

export function decryptFileCiphertext(ciphertext: Buffer, nodeKey: Buffer): Buffer {
  const iv = Buffer.alloc(16, 0);
  if (nodeKey.length >= 24) {
    nodeKey.copy(iv, 0, 16, 24);
  }
  return Buffer.from(nobleAesCtr(deriveAttributeKey(nodeKey), iv).decrypt(ciphertext));
}