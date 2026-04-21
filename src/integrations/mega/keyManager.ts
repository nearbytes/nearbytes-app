import { Buffer } from 'buffer';
import {
  MEGA_AUTH_METHOD_SEEN,
  MEGA_AUTH_RING_RECORD_SIZE,
  MEGA_KEY_MANAGER_ATTR_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG,
  MEGA_KEY_MANAGER_BACKUPS_TAG,
  MEGA_KEY_MANAGER_CREATION_TIME_TAG,
  MEGA_KEY_MANAGER_GENERATION_TAG,
  MEGA_KEY_MANAGER_IDENTITY_TAG,
  MEGA_KEY_MANAGER_PENDING_INSHARES_TAG,
  MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
  MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_RSA_TAG,
  MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
  MEGA_KEY_MANAGER_VERSION_TAG,
  MEGA_KEY_MANAGER_WARNINGS_TAG,
  type MegaApiError,
  type MegaKeyManagerRecord,
  type MegaKeyManagerRecoveryPayload,
  type MegaSession,
} from './core.js';
import {
  decodeMegaBase64Url,
  encodeMegaBase64Url,
  type MegaApiClient,
  type MegaFetchNodesSnapshot,
  type MegaNodeRecord,
} from './protocol.js';
import {
  decryptAesEcb,
  decryptMegaKeyManagerContainer,
  deriveMegaPairwiseKey,
  encryptMegaKeyManagerContainer,
  parseMegaPrivateAttributeRecords,
} from './crypto.js';
import { withMegaApiRetry } from './errors.js';
import {
  MEGA_SHARE_KEY_FLAG_IN_USE,
  MEGA_SHARE_KEY_FLAG_TRUSTED,
  MEGA_SHARE_KEY_RECORD_SIZE,
} from './adapterConstants.js';
import type {
  MegaIncomingShareDiscoveryDiag,
  MegaKeyManagerState,
  MegaPendingInShareRecord,
} from './adapterTypes.js';
import {
  decryptNodeRecord,
  decryptShareKey,
  fingerprintMegaShareKey,
  listMegaNodeKeyOwners,
  megaIncomingAccessLevelFromMeta,
} from './nodeCrypto.js';
import {
  buildMegaUsersByHandle,
  getStringDescriptor,
  isMegaKeyOwnerHandle,
  isMegaRecordHandle,
  isMegaUserHandle,
  normalizeMegaIncomingOwnerIdentity,
  normalizeMegaIncomingOwnerLabel,
  normalizeMegaIncomingShareName,
} from './shareHelpers.js';
import type { IntegrationRuntime } from '../runtime.js';
import type { IncomingManagedShareOffer } from '../types.js';
import type { ProviderShareInventoryDebugEntry } from '../adapters.js';

export async function fetchMegaKeyManagerState(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<MegaKeyManagerState> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown> | number>(
        { a: 'uga', u: session.userHandle, ua: '^!keys', v: 1 },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);
    return parseMegaKeyManagerState(response, session.masterKey);
  } catch (error) {
    if ((error as MegaApiError | undefined)?.code !== -9) {
      logger?.warn?.('MEGA key-manager state fetch failed.', {
        email: session.email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return createEmptyMegaKeyManagerState();
  }
}

export async function fetchMegaPrivateAttributeRecords(
  apiClient: MegaApiClient,
  session: MegaSession,
  attributeName: string,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<ReadonlyMap<string, Buffer> | null> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown> | number>(
        { a: 'uga', u: session.userHandle, ua: attributeName, v: 1 },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);

    const encodedValue = typeof response.av === 'string' ? response.av.trim() : '';
    if (!encodedValue) {
      return null;
    }
    return parseMegaPrivateAttributeRecords(decodeMegaBase64Url(encodedValue), session.masterKey);
  } catch (error) {
    if ((error as MegaApiError | undefined)?.code !== -9) {
      logger?.warn?.('MEGA private attribute fetch failed during ^!keys recovery.', {
        email: session.email,
        attributeName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

export async function fetchMegaPrivateAttributeValue(
  apiClient: MegaApiClient,
  session: MegaSession,
  attributeName: string,
  recordName: string,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<Buffer | null> {
  const records = await fetchMegaPrivateAttributeRecords(apiClient, session, attributeName, signal, logger);
  const value = records?.get(recordName);
  return value ? Buffer.from(value) : null;
}

export function listIncomingMegaShareOffersWithDiag(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer>,
  provider: string,
  accountId: string
): { offers: IncomingManagedShareOffer[]; diag: MegaIncomingShareDiscoveryDiag } {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);
  const offersByHandle = new Map<string, IncomingManagedShareOffer>();
  let skippedExplicitFile = 0;
  let skippedNoDecrypt = 0;
  let skippedShareHandleMismatch = 0;
  let provisionalOfferCount = 0;
  let nodesWithSharingUser = 0;
  const skippedNoDecryptSample: Array<{
    handle: string;
    ownerHandle?: string;
    parentHandle?: string;
    hasShareKey: boolean;
    nodeKeyOwners: string;
    matchedKeyOwners: string;
    hasSk: boolean;
  }> = [];

  for (const node of snapshot.nodes) {
    const nodeMeta = node as Record<string, unknown>;
    const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : '';
    if (!ownerHandle) {
      continue;
    }
    nodesWithSharingUser += 1;
    if (megaIncomingAccessLevelFromMeta(nodeMeta) !== undefined && typeof nodeMeta.t !== 'undefined' && Number(nodeMeta.t) === 0) {
      skippedExplicitFile += 1;
      continue;
    }
    const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle);
    if (!decrypted || !decrypted.ownerHandle) {
      skippedNoDecrypt += 1;
      const provisional = buildProvisionalIncomingMegaShareOffer(node, usersByHandle, provider, accountId);
      const provisionalHandle = provisional
        ? getStringDescriptor(provisional.remoteDescriptor, 'shareHandle') ?? getStringDescriptor(provisional.remoteDescriptor, 'rootHandle')
        : undefined;
      if (provisional && provisionalHandle && !offersByHandle.has(provisionalHandle)) {
        offersByHandle.set(provisionalHandle, provisional);
        provisionalOfferCount += 1;
      }
      if (skippedNoDecryptSample.length < 5) {
        const nodeKeyOwners = listMegaNodeKeyOwners(typeof nodeMeta.k === 'string' ? nodeMeta.k : undefined);
        skippedNoDecryptSample.push({
          handle: typeof node.h === 'string' ? node.h.trim() : '',
          ownerHandle: ownerHandle || undefined,
          parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
          hasShareKey: nodeKeyOwners.some((candidateOwner) => shareKeys.has(candidateOwner)),
          nodeKeyOwners: nodeKeyOwners.join(','),
          matchedKeyOwners: nodeKeyOwners.filter((candidateOwner) => shareKeys.has(candidateOwner)).join(','),
          hasSk: typeof nodeMeta.sk === 'string' && nodeMeta.sk.trim() !== '',
        });
      }
      continue;
    }
    if (decrypted.shareHandle !== decrypted.handle) {
      skippedShareHandleMismatch += 1;
    }
    const shareHandle = decrypted.shareHandle?.trim() || decrypted.handle;
    const rootHandle = decrypted.handle;
    offersByHandle.set(
      shareHandle,
      createIncomingMegaShareOffer(
        shareHandle,
        rootHandle,
        decrypted.name,
        decrypted.ownerHandle,
        decrypted.ownerEmail,
        decrypted.accessLevel ?? 'read',
        provider,
        accountId
      )
    );
  }

  const offers = Array.from(offersByHandle.values()).sort((left, right) => left.label.localeCompare(right.label));
  const diag: MegaIncomingShareDiscoveryDiag = {
    nodesWithSharingUser,
    skippedExplicitFile,
    skippedNoDecrypt,
    skippedShareHandleMismatch,
    provisionalOfferCount,
    offerCount: offers.length,
    skippedNoDecryptSample,
  };
  return { offers, diag };
}

export function snapshotHasIncomingShareCandidates(snapshot: MegaFetchNodesSnapshot): boolean {
  return snapshot.nodes.some((node) => {
    const sharingUser = (node as Record<string, unknown>).su;
    return typeof sharingUser === 'string' && sharingUser.trim() !== '';
  });
}

export function createIncomingMegaShareOffer(
  shareHandle: string,
  rootHandle: string,
  name: string | undefined,
  ownerHandle: string | undefined,
  ownerEmail: string | undefined,
  accessLevel: string | undefined,
  provider: string,
  accountId: string
): IncomingManagedShareOffer {
  const normalizedShareHandle = shareHandle.trim();
  const normalizedRootHandle = rootHandle.trim() || normalizedShareHandle;
  const shareName = normalizeMegaIncomingShareName(name, normalizedRootHandle || normalizedShareHandle);
  const ownerIdentity = normalizeMegaIncomingOwnerIdentity(ownerEmail, ownerHandle);
  const ownerLabel = normalizeMegaIncomingOwnerLabel(ownerEmail, ownerHandle);
  const remotePath = `${ownerIdentity}:${shareName}`;
  return {
    id: `mega:incoming:${normalizedShareHandle || normalizedRootHandle}`,
    provider,
    accountId,
    label: shareName,
    ownerLabel,
    detail: `${ownerLabel} shared this MEGA location${accessLevel ? ` with ${accessLevel}` : ''}.`,
    remoteDescriptor: {
      remotePath,
      shareName,
      ownerEmail: ownerIdentity,
      accessLevel: accessLevel ?? 'read',
      shareHandle: normalizedShareHandle || normalizedRootHandle,
      rootHandle: normalizedRootHandle || normalizedShareHandle,
    },
  };
}

export function buildProvisionalIncomingMegaShareOffer(
  node: MegaNodeRecord,
  usersByHandle: ReadonlyMap<string, { m?: string }>,
  provider: string,
  accountId: string
): IncomingManagedShareOffer | null {
  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }
  const nodeMeta = node as Record<string, unknown>;
  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : '';
  if (!ownerHandle) {
    return null;
  }
  const ownerEmail = typeof usersByHandle.get(ownerHandle)?.m === 'string'
    ? String(usersByHandle.get(ownerHandle)?.m)
    : undefined;
  return createIncomingMegaShareOffer(
    handle,
    handle,
    undefined,
    ownerHandle,
    ownerEmail,
    megaIncomingAccessLevelFromMeta(nodeMeta) ?? 'read',
    provider,
    accountId
  );
}

export function listIncomingMegaShareOffers(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer>,
  provider: string,
  accountId: string
): IncomingManagedShareOffer[] {
  return listIncomingMegaShareOffersWithDiag(snapshot, session, extraShareKeys, provider, accountId).offers;
}

export function buildMegaShareInventoryDebugEntries(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map()
): {
  incoming: ProviderShareInventoryDebugEntry[];
  outgoing: ProviderShareInventoryDebugEntry[];
} {
  const incoming = listIncomingMegaShareOffers(snapshot, session, extraShareKeys, 'mega', 'debug')
    .map((offer) => ({
      shareHandle:
        getStringDescriptor(offer.remoteDescriptor, 'shareHandle') ??
        getStringDescriptor(offer.remoteDescriptor, 'rootHandle') ??
        '',
      rootHandle:
        getStringDescriptor(offer.remoteDescriptor, 'rootHandle') ??
        getStringDescriptor(offer.remoteDescriptor, 'shareHandle'),
      ownerEmail: getStringDescriptor(offer.remoteDescriptor, 'ownerEmail'),
      label: offer.label,
    }))
    .filter((entry) => entry.shareHandle.length > 0);

  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);
  const outgoingByHandle = new Map<string, ProviderShareInventoryDebugEntry>();
  for (const shareRecord of snapshot.outgoingShares) {
    const shareHandle =
      typeof shareRecord.t === 'string'
        ? shareRecord.t.trim()
        : typeof shareRecord.h === 'string'
          ? shareRecord.h.trim()
          : '';
    if (!shareHandle) {
      continue;
    }
    if (outgoingByHandle.has(shareHandle)) {
      continue;
    }
    const matchingNode = snapshot.nodes.find((node) => typeof node.h === 'string' && node.h.trim() === shareHandle);
    const decrypted = matchingNode ? decryptNodeRecord(matchingNode, session, shareKeys, usersByHandle) : null;
    outgoingByHandle.set(shareHandle, {
      shareHandle,
      rootHandle: shareHandle,
      ownerEmail: session.email,
      label: normalizeMegaIncomingShareName(decrypted?.name, shareHandle),
    });
  }

  return {
    incoming: incoming.sort((left, right) => left.label.localeCompare(right.label)),
    outgoing: Array.from(outgoingByHandle.values()).sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export function registerMegaShareKeyHandlesForNode(shareKeys: Map<string, Buffer>, node: MegaNodeRecord, shareKey: Buffer): void {
  const handles = new Set<string>();
  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (isMegaRecordHandle(handle)) {
    handles.add(handle);
  }
  const encoded = typeof node.k === 'string' ? node.k.trim() : '';
  if (encoded) {
    if (encoded.length > 12 && encoded[11] === ':') {
      const owner = encoded.slice(0, 11).trim();
      if (isMegaKeyOwnerHandle(owner)) {
        handles.add(owner);
      }
    }
    for (const segment of encoded.split('/')) {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) {
        continue;
      }
      const owner = segment.slice(0, colonIndex).trim();
      if (isMegaKeyOwnerHandle(owner)) {
        handles.add(owner);
      }
    }
  }
  for (const current of handles) {
    if (current) {
      shareKeys.set(current, shareKey);
    }
  }
}

export function collectMegaShareKeyRelatedHandles(rootHandle: string, snapshot: MegaFetchNodesSnapshot): string[] {
  const handles = new Set<string>();
  const normalizedRootHandle = rootHandle.trim();
  if (isMegaRecordHandle(normalizedRootHandle)) {
    handles.add(normalizedRootHandle);
  }

  const rootNode = snapshot.nodes.find(
    (node) => typeof node.h === 'string' && node.h.trim() === normalizedRootHandle
  );
  if (!rootNode) {
    return [...handles];
  }

  for (const owner of listMegaNodeKeyOwners(typeof rootNode.k === 'string' ? rootNode.k : undefined)) {
    if (isMegaKeyOwnerHandle(owner)) {
      handles.add(owner);
    }
  }

  const ownerHandle = typeof (rootNode as Record<string, unknown>).su === 'string'
    ? String((rootNode as Record<string, unknown>).su).trim()
    : '';
  if (isMegaRecordHandle(ownerHandle)) {
    handles.add(ownerHandle);
  }

  return [...handles];
}

export function propagateMegaResolvedShareKeyAliases(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  shareKeys: Map<string, Buffer>
): void {
  for (const node of snapshot.nodes) {
    const nodeHandle = typeof node.h === 'string' ? node.h.trim() : '';
    const ownerHandles = listMegaNodeKeyOwners(typeof node.k === 'string' ? node.k : undefined)
      .filter((owner) => owner !== session.userHandle);
    const hasIncomingShareMetadata = typeof (node as Record<string, unknown>).su === 'string'
      && String((node as Record<string, unknown>).su).trim() !== '';
    if (!hasIncomingShareMetadata && ownerHandles.length === 0) {
      continue;
    }

    const shareKey =
      (nodeHandle ? shareKeys.get(nodeHandle) : undefined)
      ?? ownerHandles.map((owner) => shareKeys.get(owner)).find((candidate): candidate is Buffer => Buffer.isBuffer(candidate));
    if (!shareKey) {
      continue;
    }
    registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
  }
}

export function collectMegaShareKeys(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map()
): Map<string, Buffer> {
  const shareKeys = new Map<string, Buffer>();
  for (const [handle, shareKey] of extraShareKeys.entries()) {
    shareKeys.set(handle, shareKey);
  }
  for (const node of snapshot.nodes) {
    if (
      typeof node.h !== 'string' ||
      typeof (node as Record<string, unknown>).su !== 'string' ||
      typeof (node as Record<string, unknown>).sk !== 'string'
    ) {
      continue;
    }
    const shareKey = decryptShareKey(String((node as Record<string, unknown>).sk), session);
    if (shareKey) {
      registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
    }
  }
  for (const shareRecord of snapshot.outgoingShares) {
    const handle =
      typeof shareRecord.t === 'string'
        ? shareRecord.t.trim()
        : typeof shareRecord.h === 'string'
          ? shareRecord.h.trim()
          : '';
    const encodedShareKey = typeof shareRecord.sk === 'string' ? shareRecord.sk.trim() : '';
    if (!handle || !encodedShareKey || shareKeys.has(handle)) {
      continue;
    }
    const shareKey = decryptShareKey(encodedShareKey, session);
    if (shareKey) {
      const node = snapshot.nodes.find((entry) => typeof entry.h === 'string' && entry.h.trim() === handle);
      if (node) {
        registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
      } else {
        shareKeys.set(handle, shareKey);
      }
    }
  }
  for (const shareRecord of snapshot.pendingShares) {
    const handle =
      typeof shareRecord.t === 'string'
        ? shareRecord.t.trim()
        : typeof shareRecord.h === 'string'
          ? shareRecord.h.trim()
          : '';
    const encodedShareKey = typeof shareRecord.sk === 'string' ? shareRecord.sk.trim() : '';
    if (!handle || !encodedShareKey || shareKeys.has(handle)) {
      continue;
    }
    const shareKey = decryptShareKey(encodedShareKey, session);
    if (shareKey) {
      const node = snapshot.nodes.find((entry) => typeof entry.h === 'string' && entry.h.trim() === handle);
      if (node) {
        registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
      } else {
        shareKeys.set(handle, shareKey);
      }
    }
  }
  propagateMegaResolvedShareKeyAliases(snapshot, session, shareKeys);
  return shareKeys;
}

export function mergeMegaShareKeyMaps(
  ...maps: Array<ReadonlyMap<string, Buffer> | undefined>
): ReadonlyMap<string, Buffer> {
  const merged = new Map<string, Buffer>();
  for (const current of maps) {
    if (!current || current.size === 0) {
      continue;
    }
    for (const [handle, shareKey] of current.entries()) {
      if (shareKey.length === 0) {
        merged.delete(handle);
        continue;
      }
      merged.set(handle, Buffer.from(shareKey));
    }
  }
  return merged;
}

export function createEmptyMegaKeyManagerState(): MegaKeyManagerState {
  return {
    shareKeys: new Map(),
    pendingInShares: new Map(),
    authRingEd25519: new Map(),
    privateCu25519: undefined,
    records: [],
  };
}

export function parseMegaKeyManagerState(response: Record<string, unknown>, masterKey: Buffer): MegaKeyManagerState {
  const encodedValue = typeof response.av === 'string' ? response.av.trim() : '';
  if (!encodedValue) {
    return createEmptyMegaKeyManagerState();
  }

  const container = decodeMegaBase64Url(encodedValue);
  const plaintext = decryptMegaKeyManagerContainer(container, masterKey);
  const shareKeys = new Map<string, Buffer>();
  const pendingInShares = new Map<string, MegaPendingInShareRecord>();
  const authRingEd25519 = new Map<string, number>();
  const records: MegaKeyManagerRecord[] = [];
  let privateCu25519: Buffer | undefined;

  for (const { tag, payload } of iterateMegaKeyManagerRecords(plaintext)) {
    records.push({ tag, payload: Buffer.from(payload) });
    switch (tag) {
      case MEGA_KEY_MANAGER_SHARE_KEYS_TAG:
        for (const [handle, shareKey] of parseMegaKeyManagerShareKeys(payload)) {
          shareKeys.set(handle, shareKey);
        }
        break;
      case MEGA_KEY_MANAGER_PENDING_INSHARES_TAG:
        for (const [handle, record] of parseMegaKeyManagerPendingInShares(payload)) {
          pendingInShares.set(handle, record);
        }
        break;
      case MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG:
        for (const [handle, authMethod] of parseMegaKeyManagerAuthRing(payload)) {
          authRingEd25519.set(handle, authMethod);
        }
        break;
      case MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG:
        privateCu25519 = Buffer.from(payload);
        break;
      default:
        break;
    }
  }

  return {
    shareKeys,
    pendingInShares,
    authRingEd25519,
    privateCu25519,
    records,
  };
}

export function* iterateMegaKeyManagerRecords(value: Buffer): Generator<{ tag: number; payload: Buffer }> {
  let offset = 0;
  while (offset + 4 <= value.length) {
    const tag = value[offset] ?? 0;
    const length = ((value[offset + 1] ?? 0) << 16) | ((value[offset + 2] ?? 0) << 8) | (value[offset + 3] ?? 0);
    offset += 4;
    if (offset + length > value.length) {
      throw new Error('MEGA key-manager record is malformed.');
    }
    yield {
      tag,
      payload: value.subarray(offset, offset + length),
    };
    offset += length;
  }
  if (offset !== value.length) {
    throw new Error('MEGA key-manager payload is malformed.');
  }
}

export function findMegaKeyManagerRecord(
  records: readonly MegaKeyManagerRecord[],
  tag: number
): MegaKeyManagerRecord | undefined {
  return records.find((record) => record.tag === tag);
}

export function readMegaKeyManagerUint32(payload?: Buffer): number | undefined {
  return payload?.length === 4 ? payload.readUInt32BE(0) : undefined;
}

export function buildMegaKeyManagerUint32(value: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(value >>> 0, 0);
  return payload;
}

export function parseMegaKeyManagerShareKeys(value: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (let entryOffset = 0; entryOffset + MEGA_SHARE_KEY_RECORD_SIZE <= value.length; entryOffset += MEGA_SHARE_KEY_RECORD_SIZE) {
    const handle = encodeMegaBase64Url(value.subarray(entryOffset, entryOffset + 6));
    const shareKey = value.subarray(entryOffset + 6, entryOffset + 22);
    result.set(handle, Buffer.from(shareKey));
  }
  if (value.length % MEGA_SHARE_KEY_RECORD_SIZE !== 0) {
    throw new Error('MEGA key-manager share-key payload is malformed.');
  }
  return result;
}

export function parseMegaKeyManagerShareKeyEntries(
  value: Buffer
): Array<{ handle: string; shareKey: Buffer; flags: number }> {
  const result: Array<{ handle: string; shareKey: Buffer; flags: number }> = [];
  for (let entryOffset = 0; entryOffset + MEGA_SHARE_KEY_RECORD_SIZE <= value.length; entryOffset += MEGA_SHARE_KEY_RECORD_SIZE) {
    result.push({
      handle: encodeMegaBase64Url(value.subarray(entryOffset, entryOffset + 6)),
      shareKey: Buffer.from(value.subarray(entryOffset + 6, entryOffset + 22)),
      flags: value[entryOffset + 22] ?? 0,
    });
  }
  if (value.length % MEGA_SHARE_KEY_RECORD_SIZE !== 0) {
    throw new Error('MEGA key-manager share-key payload is malformed.');
  }
  return result;
}

export function parseMegaKeyManagerPendingOutShares(value: Buffer): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  let offset = 0;
  while (offset < value.length) {
    const targetLength = value[offset];
    if (targetLength === undefined || offset + 7 > value.length) {
      throw new Error('MEGA key-manager pending outshare payload is malformed.');
    }
    offset += 1;
    const handle = encodeMegaBase64Url(value.subarray(offset, offset + 6));
    offset += 6;

    let target: string;
    if (targetLength === 0) {
      if (offset + 8 > value.length) {
        throw new Error('MEGA key-manager pending outshare payload is malformed.');
      }
      target = encodeMegaBase64Url(value.subarray(offset, offset + 8));
      offset += 8;
    } else {
      if (offset + targetLength > value.length) {
        throw new Error('MEGA key-manager pending outshare payload is malformed.');
      }
      target = value.subarray(offset, offset + targetLength).toString('utf8');
      offset += targetLength;
    }

    const targets = result.get(handle) ?? new Set<string>();
    targets.add(target);
    result.set(handle, targets);
  }
  return result;
}

export function serializeMegaKeyManagerShareKeyEntries(
  entries: ReadonlyArray<{ handle: string; shareKey: Buffer; flags: number }>
): Buffer {
  const buffers: Buffer[] = [];
  for (const entry of entries) {
    const handle = entry.handle.trim();
    const handleBytes = decodeMegaBase64Url(handle);
    if (handleBytes.length !== 6) {
      throw new Error(`MEGA key-manager share handle is invalid: ${handle}`);
    }
    if (entry.shareKey.length !== 16) {
      throw new Error(`MEGA key-manager share key has invalid length for ${handle}: ${entry.shareKey.length}`);
    }
    buffers.push(handleBytes, Buffer.from(entry.shareKey), Buffer.from([entry.flags & 0xff]));
  }
  return Buffer.concat(buffers);
}

export function serializeMegaKeyManagerPendingOutShares(entries: ReadonlyMap<string, ReadonlySet<string>>): Buffer {
  const buffers: Buffer[] = [];
  for (const handle of [...entries.keys()].sort()) {
    const handleBytes = decodeMegaBase64Url(handle);
    if (handleBytes.length !== 6) {
      throw new Error(`MEGA key-manager pending outshare handle is invalid: ${handle}`);
    }
    const targets = [...(entries.get(handle) ?? new Set<string>())].sort();
    for (const target of targets) {
      const normalizedTarget = target.trim();
      if (!normalizedTarget) {
        continue;
      }
      if (isMegaUserHandle(normalizedTarget)) {
        const targetBytes = decodeMegaBase64Url(normalizedTarget);
        if (targetBytes.length !== 8) {
          throw new Error(`MEGA key-manager pending outshare user handle is invalid: ${normalizedTarget}`);
        }
        buffers.push(Buffer.from([0]), handleBytes, targetBytes);
        continue;
      }
      const targetBytes = Buffer.from(normalizedTarget, 'utf8');
      if (targetBytes.length >= 0x100) {
        throw new Error(`MEGA key-manager pending outshare email is too long: ${normalizedTarget}`);
      }
      buffers.push(Buffer.from([targetBytes.length]), handleBytes, targetBytes);
    }
  }
  return Buffer.concat(buffers);
}

export function buildMegaKeyManagerRecordHeader(tag: number, length: number): Buffer {
  return Buffer.from([tag & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

export function serializeMegaKeyManagerRecords(records: readonly MegaKeyManagerRecord[]): Buffer {
  const chunks: Buffer[] = [];
  for (const record of records) {
    chunks.push(buildMegaKeyManagerRecordHeader(record.tag, record.payload.length), Buffer.from(record.payload));
  }
  return Buffer.concat(chunks);
}

export function buildMegaRecoveryKeyManagerContainer(payload: MegaKeyManagerRecoveryPayload, masterKey: Buffer): Buffer {
  const records: MegaKeyManagerRecord[] = [
    {
      tag: MEGA_KEY_MANAGER_VERSION_TAG,
      payload: Buffer.from([payload.version & 0xff]),
    },
    {
      tag: MEGA_KEY_MANAGER_CREATION_TIME_TAG,
      payload: Buffer.from(payload.creationTime),
    },
    {
      tag: MEGA_KEY_MANAGER_IDENTITY_TAG,
      payload: Buffer.from(payload.identity),
    },
    {
      tag: MEGA_KEY_MANAGER_GENERATION_TAG,
      payload: buildMegaKeyManagerUint32(payload.generation),
    },
    {
      tag: MEGA_KEY_MANAGER_ATTR_TAG,
      payload: Buffer.from(payload.attr),
    },
    {
      tag: MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG,
      payload: Buffer.from(payload.privateEd25519),
    },
    {
      tag: MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG,
      payload: Buffer.from(payload.privateCu25519),
    },
    {
      tag: MEGA_KEY_MANAGER_PRIVATE_RSA_TAG,
      payload: Buffer.from(payload.privateRsa),
    },
    {
      tag: MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG,
      payload: Buffer.from(payload.authRingEd25519),
    },
    {
      tag: MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG,
      payload: Buffer.from(payload.authRingCu25519),
    },
    {
      tag: MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_PENDING_INSHARES_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_BACKUPS_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_WARNINGS_TAG,
      payload: Buffer.alloc(0),
    },
  ];

  for (const record of payload.otherRecords) {
    records.push({
      tag: record.tag,
      payload: Buffer.from(record.payload),
    });
  }

  return encryptMegaKeyManagerContainer(serializeMegaKeyManagerRecords(records), masterKey);
}

export function buildMegaKeyManagerContainerWithShareKey(
  state: MegaKeyManagerState,
  shareHandle: string,
  shareKey: Buffer,
  options: {
    readonly trusted?: boolean;
    readonly inUse?: boolean;
    readonly pendingOutShareTarget?: string;
    readonly removePendingOutShare?: boolean;
  },
  masterKey: Buffer
): Buffer | null {
  if (state.records.length === 0) {
    return null;
  }

  const updatedRecords: MegaKeyManagerRecord[] = state.records.map((record) => ({
    tag: record.tag,
    payload: Buffer.from(record.payload),
  }));
  const generationIndex = updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_GENERATION_TAG);
  if (generationIndex < 0 || updatedRecords[generationIndex]!.payload.length !== 4) {
    return null;
  }

  const shareKeyIndex = updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_SHARE_KEYS_TAG);
  const shareKeyEntries =
    shareKeyIndex >= 0
      ? parseMegaKeyManagerShareKeyEntries(updatedRecords[shareKeyIndex]!.payload)
      : [];
  const pendingOutShares =
    updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG) >= 0
      ? parseMegaKeyManagerPendingOutShares(
          updatedRecords[updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG)]!.payload
        )
      : new Map<string, Set<string>>();
  const normalizedHandle = shareHandle.trim();
  const applyFlags = (currentFlags: number): number => {
    let nextFlags = currentFlags;
    if (options.trusted !== undefined) {
      nextFlags = options.trusted
        ? nextFlags | MEGA_SHARE_KEY_FLAG_TRUSTED
        : nextFlags & ~MEGA_SHARE_KEY_FLAG_TRUSTED;
    }
    if (options.inUse !== undefined) {
      nextFlags = options.inUse
        ? nextFlags | MEGA_SHARE_KEY_FLAG_IN_USE
        : nextFlags & ~MEGA_SHARE_KEY_FLAG_IN_USE;
    }
    return nextFlags;
  };
  const pendingOutShareTarget = options.pendingOutShareTarget?.trim() ?? '';

  let changed = false;
  const existingEntry = shareKeyEntries.find((entry) => entry.handle === normalizedHandle);
  if (existingEntry) {
    const nextFlags = applyFlags(existingEntry.flags);
    if (!existingEntry.shareKey.equals(shareKey) || existingEntry.flags !== nextFlags) {
      existingEntry.shareKey = Buffer.from(shareKey);
      existingEntry.flags = nextFlags;
      changed = true;
    }
  } else {
    shareKeyEntries.push({
      handle: normalizedHandle,
      shareKey: Buffer.from(shareKey),
      flags: applyFlags(0),
    });
    changed = true;
  }

  if (pendingOutShareTarget) {
    const targets = new Set(pendingOutShares.get(normalizedHandle) ?? []);
    if (options.removePendingOutShare) {
      if (targets.delete(pendingOutShareTarget)) {
        changed = true;
      }
    } else if (!targets.has(pendingOutShareTarget)) {
      targets.add(pendingOutShareTarget);
      changed = true;
    }

    if (targets.size > 0) {
      pendingOutShares.set(normalizedHandle, targets);
    } else {
      pendingOutShares.delete(normalizedHandle);
    }
  }

  if (!changed) {
    return Buffer.alloc(0);
  }

  const generation = updatedRecords[generationIndex]!.payload.readUInt32BE(0);
  const nextGeneration = Buffer.alloc(4);
  nextGeneration.writeUInt32BE((generation + 1) >>> 0, 0);
  updatedRecords[generationIndex] = {
    tag: MEGA_KEY_MANAGER_GENERATION_TAG,
    payload: nextGeneration,
  };

  const shareKeyRecord: MegaKeyManagerRecord = {
    tag: MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
    payload: serializeMegaKeyManagerShareKeyEntries(shareKeyEntries),
  };
  if (shareKeyIndex >= 0) {
    updatedRecords[shareKeyIndex] = shareKeyRecord;
  } else {
    const insertionIndex = updatedRecords.findIndex((record) => record.tag > MEGA_KEY_MANAGER_SHARE_KEYS_TAG);
    if (insertionIndex >= 0) {
      updatedRecords.splice(insertionIndex, 0, shareKeyRecord);
    } else {
      updatedRecords.push(shareKeyRecord);
    }
  }

  const pendingOutSharePayload = serializeMegaKeyManagerPendingOutShares(pendingOutShares);
  const pendingOutShareRecordIndex = updatedRecords.findIndex(
    (record) => record.tag === MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG
  );
  if (pendingOutSharePayload.length > 0) {
    const pendingOutShareRecord: MegaKeyManagerRecord = {
      tag: MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
      payload: pendingOutSharePayload,
    };
    if (pendingOutShareRecordIndex >= 0) {
      updatedRecords[pendingOutShareRecordIndex] = pendingOutShareRecord;
    } else {
      const insertionIndex = updatedRecords.findIndex((record) => record.tag > MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG);
      if (insertionIndex >= 0) {
        updatedRecords.splice(insertionIndex, 0, pendingOutShareRecord);
      } else {
        updatedRecords.push(pendingOutShareRecord);
      }
    }
  } else if (pendingOutShareRecordIndex >= 0) {
    updatedRecords.splice(pendingOutShareRecordIndex, 1);
  }

  return encryptMegaKeyManagerContainer(serializeMegaKeyManagerRecords(updatedRecords), masterKey);
}

export function parseMegaKeyManagerAuthRing(value: Buffer): Map<string, number> {
  if (value.length % MEGA_AUTH_RING_RECORD_SIZE !== 0) {
    throw new Error('MEGA key-manager auth-ring payload is malformed.');
  }
  const result = new Map<string, number>();
  for (let offset = 0; offset < value.length; offset += MEGA_AUTH_RING_RECORD_SIZE) {
    const handle = encodeMegaBase64Url(value.subarray(offset, offset + 8));
    const authMethod = value.readInt8(offset + 28);
    result.set(handle, authMethod);
  }
  return result;
}

export function parseMegaKeyManagerPendingInShares(value: Buffer): Map<string, MegaPendingInShareRecord> {
  const result = new Map<string, MegaPendingInShareRecord>();
  for (const { tag, payload } of parseMegaLtlvRecords(value)) {
    if (payload.length < 8) {
      throw new Error('MEGA key-manager pending inshare payload is malformed.');
    }
    result.set(encodeMegaBase64Url(tag), {
      ownerHandle: encodeMegaBase64Url(payload.subarray(0, 8)),
      encryptedShareKey: Buffer.from(payload.subarray(8)),
    });
  }
  return result;
}

export function parseMegaLtlvRecords(value: Buffer): Array<{ tag: Buffer; payload: Buffer }> {
  const records: Array<{ tag: Buffer; payload: Buffer }> = [];
  let offset = 0;
  while (offset < value.length) {
    const tagLength = value[offset];
    if (tagLength === undefined) {
      throw new Error('MEGA key-manager LTLV tag length is missing.');
    }
    offset += 1;
    if (offset + tagLength + 2 > value.length) {
      throw new Error('MEGA key-manager LTLV tag is malformed.');
    }
    const tag = Buffer.from(value.subarray(offset, offset + tagLength));
    offset += tagLength;
    let payloadLength = value.readUInt16BE(offset);
    offset += 2;
    if (payloadLength === 0xffff) {
      if (offset + 4 > value.length) {
        throw new Error('MEGA key-manager LTLV extended length is malformed.');
      }
      payloadLength = value.readUInt32BE(offset);
      offset += 4;
    }
    if (offset + payloadLength > value.length) {
      throw new Error('MEGA key-manager LTLV value is malformed.');
    }
    records.push({
      tag,
      payload: Buffer.from(value.subarray(offset, offset + payloadLength)),
    });
    offset += payloadLength;
  }
  return records;
}

export async function resolveMegaKeyManagerShareKeys(
  apiClient: MegaApiClient,
  session: MegaSession,
  keyManager: MegaKeyManagerState,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'> & Partial<Pick<IntegrationRuntime['logger'], 'log'>>,
  snapshot?: MegaFetchNodesSnapshot
): Promise<ReadonlyMap<string, Buffer>> {
  const resolved = new Map(keyManager.shareKeys);
  const usersByHandle = buildMegaUsersByHandle(snapshot ?? {
    nodes: [], versions: [], outgoingShares: [], pendingShares: [], users: [], incomingPendingContacts: [], outgoingPendingContacts: [], publicLinks: []
  });
  if (
    keyManager.pendingInShares.size === 0 ||
    !keyManager.privateCu25519 ||
    keyManager.privateCu25519.length !== 32
  ) {
    if (keyManager.pendingInShares.size > 0) {
      logger?.warn?.('MEGA pending inshare keys are present but recipient key-manager state cannot decrypt them.', {
        email: session.email,
        pendingInShareCount: keyManager.pendingInShares.size,
        hasPrivateCu25519: Boolean(keyManager.privateCu25519),
        privateCu25519Length: keyManager.privateCu25519?.length ?? 0,
      });
    }
    return resolved;
  }

  const publicKeyCache = new Map<string, Promise<Buffer | null>>();
  const getOwnerPublicCu25519 = (ownerHandle: string): Promise<Buffer | null> => {
    let task = publicKeyCache.get(ownerHandle);
    if (!task) {
      task = fetchMegaUserPublicCu25519(apiClient, session, ownerHandle, signal, logger);
      publicKeyCache.set(ownerHandle, task);
    }
    return task;
  };

  for (const [shareHandle, pendingInShare] of keyManager.pendingInShares) {
    const matchingNode = snapshot?.nodes.find((node) => typeof node.h === 'string' && node.h.trim() === shareHandle);
    const existingShareKey = resolved.get(shareHandle);
    let pendingCandidateShareKey: Buffer | undefined;
    if (pendingInShare.encryptedShareKey.length > 0) {
      const authMethod = keyManager.authRingEd25519.get(pendingInShare.ownerHandle) ?? -1;
      if (authMethod < MEGA_AUTH_METHOD_SEEN) {
        logger?.warn?.('MEGA pending inshare key continuing even though the sharer auth ring is below SEEN.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          authMethod,
        });
      }

      const ownerPublicKey = await getOwnerPublicCu25519(pendingInShare.ownerHandle);
      if (!ownerPublicKey || ownerPublicKey.length !== 32) {
        logger?.warn?.('MEGA pending inshare key skipped because the sharer public Cu25519 key is unavailable.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          publicCu25519Length: ownerPublicKey?.length ?? 0,
        });
      } else {
        const pairwiseKey = await deriveMegaPairwiseKey(keyManager.privateCu25519, ownerPublicKey);
        const decryptedShareKey = decryptAesEcb(pendingInShare.encryptedShareKey, pairwiseKey);
        if (decryptedShareKey.length < 16) {
          logger?.warn?.('MEGA pending inshare key decrypted to an invalid length.', {
            email: session.email,
            shareHandle,
            ownerHandle: pendingInShare.ownerHandle,
            decryptedLength: decryptedShareKey.length,
          });
        } else {
          pendingCandidateShareKey = Buffer.from(decryptedShareKey.subarray(0, 16));
        }
      }
    } else {
      logger?.warn?.('MEGA pending inshare entry has no encrypted share key payload.', {
        email: session.email,
        shareHandle,
        ownerHandle: pendingInShare.ownerHandle,
      });
    }

    if (matchingNode && pendingCandidateShareKey) {
      const validationShareKeys = new Map(resolved);
      registerMegaShareKeyHandlesForNode(validationShareKeys, matchingNode, pendingCandidateShareKey);
      const decryptedNode = decryptNodeRecord(matchingNode, session, validationShareKeys, usersByHandle);
      if (decryptedNode) {
        resolved.set(shareHandle, pendingCandidateShareKey);
        logger?.log?.('MEGA pending inshare key resolved from pairwise encryption.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          shareKeyFingerprint: fingerprintMegaShareKey(pendingCandidateShareKey),
        });
        continue;
      }
      logger?.warn?.('MEGA pending inshare key was rejected because it does not decrypt the incoming root node.', {
        email: session.email,
        shareHandle,
        ownerHandle: pendingInShare.ownerHandle,
      });
    }

    if (snapshot && matchingNode) {
      const aliasCandidates = [shareHandle, ...listMegaNodeKeyOwners(typeof matchingNode.k === 'string' ? matchingNode.k : undefined)];
      let validatedExistingHandle: string | undefined;
      let validatedExistingShareKey: Buffer | undefined;
      for (const candidateHandle of aliasCandidates) {
        const candidateShareKey = resolved.get(candidateHandle);
        if (!candidateShareKey || candidateShareKey.length === 0) {
          continue;
        }
        const validationShareKeys = new Map(resolved);
        registerMegaShareKeyHandlesForNode(validationShareKeys, matchingNode, candidateShareKey);
        const decryptedNode = decryptNodeRecord(matchingNode, session, validationShareKeys, usersByHandle);
        if (!decryptedNode) {
          continue;
        }
        validatedExistingHandle = candidateHandle;
        validatedExistingShareKey = Buffer.from(candidateShareKey);
        break;
      }
      if (validatedExistingShareKey) {
        if (validatedExistingHandle !== shareHandle) {
          resolved.set(shareHandle, Buffer.from(validatedExistingShareKey));
          logger?.log?.('MEGA existing share key aliased from an alternate incoming root handle.', {
            email: session.email,
            shareHandle,
            matchedHandle: validatedExistingHandle,
            ownerHandle: pendingInShare.ownerHandle,
            shareKeyFingerprint: fingerprintMegaShareKey(validatedExistingShareKey),
          });
        }
        continue;
      }
      if (existingShareKey) {
        logger?.warn?.('MEGA existing share key failed to decrypt the incoming root; retrying pending inshare resolution.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          existingShareKeyFingerprint: fingerprintMegaShareKey(existingShareKey),
        });
        resolved.set(shareHandle, Buffer.alloc(0));
      }
    } else if (existingShareKey) {
      continue;
    }
    if (!pendingCandidateShareKey) {
      continue;
    }
    resolved.set(shareHandle, pendingCandidateShareKey);
    logger?.log?.('MEGA pending inshare key resolved from pairwise encryption.', {
      email: session.email,
      shareHandle,
      ownerHandle: pendingInShare.ownerHandle,
      shareKeyFingerprint: fingerprintMegaShareKey(pendingCandidateShareKey),
    });
  }

  return resolved;
}

export function mergeMegaPendingInShares(
  base: ReadonlyMap<string, MegaPendingInShareRecord>,
  extra: ReadonlyMap<string, MegaPendingInShareRecord>
): ReadonlyMap<string, MegaPendingInShareRecord> {
  if (extra.size === 0) {
    return base;
  }
  const merged = new Map(base);
  for (const [shareHandle, record] of extra.entries()) {
    const existing = merged.get(shareHandle);
    if (!existing) {
      merged.set(shareHandle, record);
      continue;
    }
    merged.set(shareHandle, {
      ownerHandle: existing.ownerHandle || record.ownerHandle,
      encryptedShareKey: record.encryptedShareKey.length > 0 ? record.encryptedShareKey : existing.encryptedShareKey,
    });
  }
  return merged;
}

export async function fetchMegaPendingInShareKeys(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<ReadonlyMap<string, MegaPendingInShareRecord>> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown>>(
        { a: 'pk' },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);
    return parseMegaPendingInShareKeysResponse(response);
  } catch (error) {
    const errorCode = typeof (error as MegaApiError | undefined)?.code === 'number'
      ? (error as MegaApiError).code
      : undefined;
    if (errorCode === -9) {
      return new Map();
    }
    logger?.warn?.('MEGA pending inshare key fetch failed.', {
      email: session.email,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

export function parseMegaPendingInShareKeysResponse(response: Record<string, unknown>): Map<string, MegaPendingInShareRecord> {
  const result = new Map<string, MegaPendingInShareRecord>();
  for (const [ownerHandleRaw, pendingEntries] of Object.entries(response)) {
    const ownerHandle = ownerHandleRaw.trim();
    if (!ownerHandle || ownerHandle === 'd' || !pendingEntries || typeof pendingEntries !== 'object' || Array.isArray(pendingEntries)) {
      continue;
    }
    for (const [shareHandleRaw, encodedKey] of Object.entries(pendingEntries as Record<string, unknown>)) {
      const shareHandle = shareHandleRaw.trim();
      if (!shareHandle || typeof encodedKey !== 'string' || !encodedKey.trim()) {
        continue;
      }
      result.set(shareHandle, {
        ownerHandle,
        encryptedShareKey: decodeMegaBase64Url(encodedKey),
      });
    }
  }
  return result;
}

export async function fetchMegaUserPublicCu25519(
  apiClient: MegaApiClient,
  session: MegaSession,
  userHandle: string,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<Buffer | null> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown>>(
        { a: 'uga', u: userHandle, ua: '+puCu255', v: 1 },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);
    const encoded = typeof response.av === 'string' ? response.av.trim() : '';
    if (!encoded) {
      return null;
    }
    return decodeMegaBase64Url(encoded);
  } catch (error) {
    logger?.warn?.('MEGA failed to fetch a sharer Cu25519 public key for pending incoming shares.', {
      email: session.email,
      userHandle,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}