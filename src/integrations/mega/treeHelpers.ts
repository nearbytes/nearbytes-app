import { Buffer } from 'buffer';
import { cbc as nobleAesCbc, ctr as nobleAesCtr } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { MegaApiError, MegaSession } from './core.js';
import { encryptAesEcb } from './crypto.js';
import {
  buildMegaFetchNodesCommand,
  decodeMegaBase64Url,
  encodeMegaBase64Url,
  parseMegaFetchNodesSnapshot,
  type MegaApiClient,
  type MegaFetchNodesSnapshot,
  type MegaNodeRecord,
  type MegaUserRecord,
} from './protocol.js';
import {
  ACTION_PACKET_HANDLE_KEYS,
  ACCOUNT_LEVEL_ACTIONS,
  EXPECTED_MEGA_TOP_LEVEL_NAMES,
  MEGA_CREATE_RECOVERY_ATTEMPTS,
  MEGA_NODE_APPEAR_ATTEMPTS,
  MEGA_NODE_APPEAR_DELAYS_MS,
  MEGA_PUT_NODES_PLACEHOLDER_HANDLE,
  MEGA_REDACTED_ACTION_PACKET_LOG_KEYS,
  MEGA_SYNC_TIMEOUT_CODE,
  MEGA_UPLOAD_RECOVERY_ATTEMPTS,
  ZERO_IV,
} from './adapterConstants.js';
import type {
  DecryptedMegaNode,
  DecryptedMegaTree,
  MegaFetchedTree,
  MegaMirrorManifest,
  MegaOwnerRemoteRoot,
  MegaOwnerUploadState,
  MegaShareCryptoContext,
} from './adapterTypes.js';
import {
  collectMegaShareKeys,
  fetchMegaKeyManagerState,
  fetchMegaPendingInShareKeys,
  mergeMegaPendingInShares,
  mergeMegaShareKeyMaps,
  resolveMegaKeyManagerShareKeys,
} from './keyManager.js';
import {
  decryptNodeKeys,
  decryptNodeRecord,
  decryptShareKey,
  describeMegaSpecialNodeName,
  deriveShareHandle,
  downloadAuthenticatedMegaFileContent,
  fingerprintMegaShareKey,
  listMegaNodeKeyOwners,
  megaIncomingAccessLevelFromMeta,
  resolveMegaCloudDriveHandle,
  resolveTreeRootHandle,
} from './nodeCrypto.js';
import {
  debugMegaLog,
  getMegaRetryDelayMs,
  isMegaAccessDeniedError,
  isMegaEventuallyConsistentMutationError,
  isMegaMissingRequestedRootError,
  isMegaRateLimitedError,
  isMegaRetryableApiError,
  isMegaRetryableTransportError,
  isMegaTemporaryLockError,
  touchMegaSyncActivity,
  waitForMegaRetry,
  withMegaApiRetry,
} from './errors.js';
import { getMegaNodeFs, randomBytes } from './runtime.js';
import { keepMegaSyncAliveWhile } from './syncUtils.js';
import {
  assertString,
  getStringDescriptor,
  normalizeMegaIncomingShareName,
  normalizeMegaRemoteDisplayPath,
  xorBuffers,
} from './shareHelpers.js';
import { deserializeEvent } from 'nearbytes-log';
import { normalizeVolumeId, parseCanonicalEventRelativePath } from 'nearbytes-log';
import type { SerializedEvent } from 'nearbytes-crypto';
import type { MirrorRemoteEntry } from '../adapters.js';
import { managedSharePath as path } from '../managedSharePath.js';
import type { ManagedShare } from '../types.js';
import type { IntegrationRuntime } from '../runtime.js';
import type {
  ProviderRefreshManifestEntry,
  ProviderRefreshRemoteAdapter,
  ProviderRefreshRemoteEntry,
} from '../providerRefreshWorker.js';

export function createMegaShareCryptoExtraKeys(
  shareCrypto: MegaShareCryptoContext | undefined
): ReadonlyMap<string, Buffer> | undefined {
  if (!shareCrypto) {
    return undefined;
  }
  return new Map([[shareCrypto.shareHandle, Buffer.from(shareCrypto.shareKey)]]);
}

export class MegaOwnerRemoteAdapter {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly apiClient: MegaApiClient,
    private readonly session: MegaSession,
    private readonly ownerUploadState: MegaOwnerUploadState,
    private readonly signal?: AbortSignal
  ) { }

  reconcileUploadsByRemoteSize(): boolean {
    return true;
  }

  async confirmEntry(relativePath: string, expectedSize: number): Promise<boolean> {
    const normalized = normalizeRelativePath(relativePath);
    let node = findNodeByRelativePath(this.ownerUploadState.root.tree, this.ownerUploadState.root.root.handle, normalized);
    node = node && !node.isFolder ? node : undefined;
    if (node && node.size === expectedSize) {
      return true;
    }

    const fetched = await fetchMegaDecryptedTree(
      this.apiClient,
      this.session,
      this.ownerUploadState.root.root.handle,
      { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
      this.signal
    );
    replaceMegaOwnerUploadStateFromTree(this.ownerUploadState, fetched.tree);
    const resolved = findNodeByRelativePath(fetched.tree, this.ownerUploadState.root.root.handle, normalized);
    const confirmed = resolved && !resolved.isFolder ? resolved : undefined;
    const matches = Boolean(confirmed && confirmed.size === expectedSize);
    if (!matches) {
      debugMegaLog('[MEGA:owner-adapter] remote entry confirmation failed.', {
        relativePath: normalized,
        expectedSize,
        actualSize: confirmed?.size,
        found: Boolean(confirmed),
      });
    }
    return matches;
  }

  async list(): Promise<readonly MirrorRemoteEntry[]> {
    debugMegaLog('[MEGA:owner-adapter] listing remote entries.', {
      rootHandle: this.ownerUploadState.root.root.handle,
      rootPath: this.ownerUploadState.root.path,
    });
    const listEntriesFromTree = async (tree: DecryptedMegaTree): Promise<MirrorRemoteEntry[]> => {
      const entries: MirrorRemoteEntry[] = [];
      await visitTree(tree, async (relativePath, node) => {
        if (!isMirrorRelativePath(relativePath) || node.isFolder) {
          return;
        }
        entries.push({
          path: normalizeRelativePath(relativePath),
          size: node.size,
        });
      });
      return entries.sort((left, right) => left.path.localeCompare(right.path));
    };

    const fetched = await fetchMegaDecryptedTree(
      this.apiClient,
      this.session,
      this.ownerUploadState.root.root.handle,
      { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
      this.signal
    );
    let selectedTree = fetched.tree;
    let selectedEntries = await listEntriesFromTree(fetched.tree);

    if (selectedEntries.length > 0) {
      const confirmed = await fetchMegaDecryptedTree(
        this.apiClient,
        this.session,
        this.ownerUploadState.root.root.handle,
        { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
        this.signal
      );
      const confirmedEntries = await listEntriesFromTree(confirmed.tree);
      const initialCount = selectedEntries.length;
      const selectedSignature = JSON.stringify(selectedEntries);
      const confirmedSignature = JSON.stringify(confirmedEntries);
      if (selectedSignature !== confirmedSignature) {
        selectedTree = confirmed.tree;
        selectedEntries = confirmedEntries;
        debugMegaLog('[MEGA:owner-adapter] remote entry listing changed between consecutive fetches; using the confirmed snapshot.', {
          initialCount,
          confirmedCount: confirmedEntries.length,
        });
      }
    }

    const duplicateHandles = collectDuplicateSiblingFileHandles(selectedTree);
    if (duplicateHandles.length > 0) {
      debugMegaLog('[MEGA:owner-adapter] removing duplicate sibling file nodes from MEGA.', {
        count: duplicateHandles.length,
        handles: duplicateHandles,
      });
      for (const handle of duplicateHandles) {
        try {
          await deleteMegaNode(this.apiClient, this.session, handle, this.signal);
        } catch (error) {
          debugMegaLog('[MEGA:owner-adapter] failed to remove duplicate node; will retry next cycle.', {
            handle,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const refreshed = await fetchMegaDecryptedTree(
        this.apiClient,
        this.session,
        this.ownerUploadState.root.root.handle,
        { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
        this.signal
      );
      selectedTree = refreshed.tree;
      selectedEntries = await listEntriesFromTree(refreshed.tree);
    }

    replaceMegaOwnerUploadStateFromTree(this.ownerUploadState, selectedTree);
    debugMegaLog('[MEGA:owner-adapter] remote entries listed.', {
      count: selectedEntries.length,
      paths: selectedEntries.map((entry) => entry.path),
    });
    return selectedEntries;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const normalized = normalizeRelativePath(relativePath);
    debugMegaLog('[MEGA:owner-adapter] downloading file from owner root.', { relativePath: normalized });
    let node = findNodeByRelativePath(this.ownerUploadState.root.tree, this.ownerUploadState.root.root.handle, normalized);
    node = node && !node.isFolder ? node : undefined;
    if (!node) {
      const fetched = await fetchMegaDecryptedTree(
        this.apiClient,
        this.session,
        this.ownerUploadState.root.root.handle,
        { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
        this.signal
      );
      replaceMegaOwnerUploadStateFromTree(this.ownerUploadState, fetched.tree);
      const resolved = findNodeByRelativePath(fetched.tree, this.ownerUploadState.root.root.handle, normalized);
      node = resolved && !resolved.isFolder ? resolved : undefined;
    }
    if (!node) {
      throw new Error(`MEGA owner folder is missing ${normalized}.`);
    }
    return downloadAuthenticatedMegaFileContent(
      this.fetchImpl,
      this.apiClient,
      this.session,
      node.handle,
      node.nodeKey,
      node.size,
      this.signal
    );
  }

  async upload(
    relativePath: string,
    data: Uint8Array,
    options: { readonly waitForVisibility?: boolean } = {}
  ): Promise<void> {
    const normalized = normalizeRelativePath(relativePath);
    const folderSegments = normalized.split('/').slice(0, -1);
    const name = normalized.split('/').at(-1)?.trim() ?? '';
    if (!name) {
      throw new Error('MEGA upload path must include a file name.');
    }

    debugMegaLog('[MEGA:owner-adapter] preparing upload.', {
      relativePath: normalized,
      name,
      folderSegments,
      dataSize: data.length,
    });

    const parent = await ensureTreePathWithCache(
      this.apiClient,
      this.session,
      this.ownerUploadState,
      folderSegments,
      this.signal,
    );
    const existing = this.ownerUploadState.filesByPath.get(normalized);
    const canonicalEventPath = parseCanonicalEventRelativePath(normalized);
    if (existing && canonicalEventPath) {
      debugMegaLog('[MEGA:owner-adapter] upload skipped (canonical event already exists on remote).', {
        relativePath: normalized,
        existingHandle: existing.handle,
      });
      return;
    }
    if (existing && !normalized.startsWith('channels/') && existing.size === data.length) {
      debugMegaLog('[MEGA:owner-adapter] upload skipped (already exists on remote).', {
        relativePath: normalized,
        existingHandle: existing.handle,
      });
      return;
    }
    if (existing && existing.size !== data.length) {
      await deleteMegaNode(this.apiClient, this.session, existing.handle, this.signal);
      this.ownerUploadState.filesByPath.delete(normalized);
    }

    debugMegaLog('[MEGA:owner-adapter] uploading file to MEGA.', {
      relativePath: normalized,
      parentHandle: parent.handle,
      name,
      dataSize: data.length,
    });
    const uploaded = await uploadMegaOwnerFile(
      this.fetchImpl,
      this.apiClient,
      this.session,
      parent.handle,
      name,
      Buffer.from(data),
      this.ownerUploadState.shareCrypto,
      this.signal,
      this.ownerUploadState.extraShareKeys,
      { waitForVisibility: options.waitForVisibility }
    );
    this.ownerUploadState.filesByPath.set(normalized, {
      handle: uploaded.handle,
      size: data.length,
    });
    debugMegaLog('[MEGA:owner-adapter] upload completed.', { relativePath: normalized });
  }
}

export function isMirrorRelativePath(value: string): boolean {
  return value.startsWith('blocks/') || value.startsWith('channels/');
}

export function extractReferencedRuntimeSourceBlockPaths(eventBytes: Uint8Array): string[] {
  try {
    const serialized = JSON.parse(Buffer.from(eventBytes).toString('utf8')) as SerializedEvent;
    const parsed = deserializeEvent(serialized);
    return Array.from(new Set(parsed.envelope.blockRefs.map((blockHash: string) => `blocks/${blockHash}.bin`)));
  } catch {
    return [];
  }
}

export function compareOwnerMirrorRelativePaths(left: string, right: string): number {
  const leftIsChannel = left.startsWith('channels/');
  const rightIsChannel = right.startsWith('channels/');
  if (leftIsChannel !== rightIsChannel) {
    return leftIsChannel ? -1 : 1;
  }
  return left.localeCompare(right);
}

export function isRuntimeSourceMirrorFileMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (code === 'ENOENT') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('File not found:') || message.startsWith('File not found in any root:');
}

export function isMirrorContainerPath(value: string): boolean {
  return value === 'blocks' || value === 'channels';
}

export function isRecipientMirrorContainerPath(value: string): boolean {
  if (isMirrorContainerPath(value)) {
    return true;
  }
  const normalized = normalizeRelativePath(value);
  if (!normalized.startsWith('channels/')) {
    return false;
  }
  return Boolean(normalizeVolumeId(normalized.slice('channels/'.length)));
}

export function shouldApplyRecipientMirrorPath(share: ManagedShare, relativePath: string): boolean {
  if (share.role !== 'recipient') {
    return true;
  }
  const openedVolumeIds = (share.openedVolumeIds ?? [])
    .map((volumeId) => normalizeVolumeId(volumeId) ?? '')
    .filter((volumeId) => volumeId.length > 0);
  if (openedVolumeIds.length === 0) {
    return true;
  }
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === 'channels') {
    return true;
  }
  if (normalized.startsWith('blocks/')) {
    return false;
  }
  const eventPath = parseCanonicalEventRelativePath(normalized);
  if (eventPath) {
    return openedVolumeIds.includes(eventPath.volumeId);
  }
  if (normalized.startsWith('channels/')) {
    const volumeId = normalizeVolumeId(normalized.slice('channels/'.length));
    return volumeId ? openedVolumeIds.includes(volumeId) : false;
  }
  return true;
}

export function resolveMegaMirrorRelativePath(value: string): string | null {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    return null;
  }
  if (isMirrorContainerPath(normalized) || isMirrorRelativePath(normalized)) {
    return normalized;
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const mirrorIndex = segments.findIndex((segment) => segment === 'blocks' || segment === 'channels');
  if (mirrorIndex === -1) {
    return null;
  }
  const suffix = segments.slice(mirrorIndex).join('/');
  return isMirrorContainerPath(suffix) || isMirrorRelativePath(suffix) ? suffix : null;
}

export function summarizeOwnerMirrorResult(
  remotePath: string,
  result: { uploaded: readonly string[]; downloaded: readonly string[] }
): string {
  const parts: string[] = [];
  if (result.uploaded.length > 0) {
    parts.push(`${result.uploaded.length} uploaded`);
  }
  if (result.downloaded.length > 0) {
    parts.push(`${result.downloaded.length} downloaded`);
  }
  return parts.length > 0
    ? `MEGA owner sync is active for ${remotePath}. ${parts.join(', ')}.`
    : `MEGA owner sync is active for ${remotePath}.`;
}

export function findChildNodeByName(
  tree: DecryptedMegaTree,
  parentHandle: string,
  name: string,
  folderOnly?: boolean
): DecryptedMegaNode | undefined {
  return findChildNodesByName(tree, parentHandle, name, folderOnly)[0];
}

export function findChildNodesByName(
  tree: DecryptedMegaTree,
  parentHandle: string,
  name: string,
  folderOnly?: boolean
): DecryptedMegaNode[] {
  const candidates = [...(tree.childrenByParent.get(parentHandle) ?? [])].filter((node) => {
    if (folderOnly && !node.isFolder) {
      return false;
    }
    return node.name === name;
  });
  candidates.sort((left, right) => compareMegaNodeCandidates(tree, left, right));
  return candidates;
}

export function findNodeByRelativePath(
  tree: DecryptedMegaTree,
  rootHandle: string,
  relativePath: string
): DecryptedMegaNode | undefined {
  const segments = normalizeRelativePath(relativePath).split('/').filter((segment) => segment.length > 0);
  let parentHandle = rootHandle;
  let current: DecryptedMegaNode | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    current = findChildNodeByName(tree, parentHandle, segments[index]!, index < segments.length - 1);
    if (!current) {
      return undefined;
    }
    parentHandle = current.handle;
  }
  return current;
}

export async function ensureTreePathWithCache(
  apiClient: MegaApiClient,
  session: MegaSession,
  ownerUploadState: MegaOwnerUploadState,
  segments: readonly string[],
  signal?: AbortSignal,
): Promise<DecryptedMegaNode> {
  const root = ownerUploadState.root.root;
  let current = root;
  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const cachedHandle = ownerUploadState.folderHandlesByPath.get(currentPath);
    if (cachedHandle) {
      current = {
        handle: cachedHandle,
        parentHandle: current.handle,
        nodeType: 1,
        isFolder: true,
        size: 0,
        name: segment,
        nodeKey: Buffer.alloc(16),
        shareHandle: ownerUploadState.shareCrypto?.shareHandle ?? root.shareHandle,
      };
      continue;
    }

    const existing = await findMegaRemoteChildNode(
      apiClient,
      session,
      current.handle,
      segment,
      true,
      signal,
      ownerUploadState.extraShareKeys
    );
    if (existing) {
      ownerUploadState.folderHandlesByPath.set(currentPath, existing.handle);
      current = existing;
      continue;
    }

    const refreshedRoot = await fetchMegaDecryptedTree(
      apiClient,
      session,
      ownerUploadState.root.root.handle,
      { useCache: false, allowTransientFullFallback: false, extraShareKeys: ownerUploadState.extraShareKeys },
      signal
    );
    replaceMegaOwnerUploadStateFromTree(ownerUploadState, refreshedRoot.tree);
    const refreshed = findNodeByRelativePath(refreshedRoot.tree, refreshedRoot.tree.root.handle, currentPath);
    if (refreshed?.isFolder) {
      ownerUploadState.folderHandlesByPath.set(currentPath, refreshed.handle);
      current = refreshed;
      continue;
    }

    const createdHandle = await createMegaFolder(
      apiClient,
      session,
      current.handle,
      segment,
      ownerUploadState.shareCrypto,
      signal,
      ownerUploadState.extraShareKeys
    );
    ownerUploadState.folderHandlesByPath.set(currentPath, createdHandle);
    debugMegaLog('[MEGA:ensureTreePath] folder created.', { segment, parentHandle: current.handle, createdHandle });
    current = {
      handle: createdHandle,
      parentHandle: current.handle,
      nodeType: 1,
      isFolder: true,
      size: 0,
      name: segment,
      nodeKey: Buffer.alloc(16),
      shareHandle: ownerUploadState.shareCrypto?.shareHandle ?? root.shareHandle,
    };
  }
  return current;
}

export function buildMegaOwnerUploadState(
  root: MegaOwnerRemoteRoot,
  shareCrypto: MegaShareCryptoContext | undefined
): MegaOwnerUploadState {
  const ownerUploadState: MegaOwnerUploadState = {
    root,
    shareCrypto,
    extraShareKeys: createMegaShareCryptoExtraKeys(shareCrypto),
    folderHandlesByPath: new Map<string, string>([['', root.root.handle]]),
    filesByPath: new Map(),
  };
  replaceMegaOwnerUploadStateFromTree(ownerUploadState, root.tree);
  return ownerUploadState;
}

export function replaceMegaOwnerUploadStateFromTree(
  ownerUploadState: MegaOwnerUploadState,
  tree: DecryptedMegaTree
): void {
  ownerUploadState.root = {
    ...ownerUploadState.root,
    root: tree.root,
    tree,
  };
  ownerUploadState.folderHandlesByPath.clear();
  ownerUploadState.filesByPath.clear();
  ownerUploadState.folderHandlesByPath.set('', tree.root.handle);
  visitMegaTreeSync(tree, tree.root.handle, '', (relativePath, node) => {
    if (!relativePath) {
      return;
    }
    if (node.isFolder) {
      ownerUploadState.folderHandlesByPath.set(relativePath, node.handle);
      return;
    }
    if (isMirrorRelativePath(relativePath)) {
      ownerUploadState.filesByPath.set(relativePath, {
        handle: node.handle,
        size: node.size,
      });
    }
  });
}

export function visitMegaTreeSync(
  tree: DecryptedMegaTree,
  parentHandle: string,
  parentPath: string,
  visitor: (relativePath: string, node: DecryptedMegaNode) => void
): void {
  const children = [...(tree.childrenByParent.get(parentHandle) ?? [])].sort((left, right) =>
    compareMegaNodeCandidates(tree, left, right)
  );
  for (const child of children) {
    const relativePath = parentPath ? `${parentPath}/${child.name}` : child.name;
    visitor(relativePath, child);
    if (child.isFolder) {
      visitMegaTreeSync(tree, child.handle, relativePath, visitor);
    }
  }
}

export function buildMegaSetShareCommand(
  ownerRoot: MegaOwnerRemoteRoot,
  session: MegaSession,
  invitee: { readonly u: string; readonly e?: string },
  accessLevel: number,
  options: {
    readonly includeNodeKeyRecords?: boolean;
    readonly shareKey?: Buffer;
    readonly secureMode?: boolean;
  } = {}
): {
  readonly command: Record<string, unknown>;
  readonly shareKey: Buffer;
} {
  const shareKey = Buffer.from(options.shareKey ?? randomBytes(16));
  const zeroOwnerKey = encodeMegaBase64Url(Buffer.alloc(16, 0));
  const command: Record<string, unknown> = {
    a: 's2',
    n: ownerRoot.root.handle,
    ok: zeroOwnerKey,
    ha: zeroOwnerKey,
    s: [
      {
        u: invitee.u,
        r: accessLevel,
      },
    ],
  };
  if (!options.secureMode) {
    const shareHandleBytes = decodeMegaBase64Url(ownerRoot.root.handle);
    const paddedShareHandle = Buffer.alloc(16, 0);
    shareHandleBytes.copy(paddedShareHandle, 0, 0, Math.min(shareHandleBytes.length, 16));
    command.ok = encodeMegaBase64Url(encryptAesEcb(shareKey, session.masterKey));
    command.ha = encodeMegaBase64Url(encryptAesEcb(paddedShareHandle, shareKey));
  }
  if (invitee.e) {
    command.e = invitee.e;
  }
  if (options.includeNodeKeyRecords !== false) {
    command.cr = buildMegaShareNodeKeyRecords(ownerRoot, shareKey);
  }
  return { command, shareKey };
}

export function buildMegaRevokeShareCommand(sharedFolderNodeHandle: string, invitee: { readonly u: string; readonly e?: string }): Record<string, unknown> {
  const command: Record<string, unknown> = {
    a: 's2',
    n: sharedFolderNodeHandle,
    s: [
      {
        u: invitee.u,
      },
    ],
  };
  if (invitee.e) {
    command.e = invitee.e;
  }
  return command;
}

export function buildMegaShareNodeKeyRecords(ownerRoot: MegaOwnerRemoteRoot, shareKey: Buffer): readonly unknown[] {
  const shareHandles = [ownerRoot.root.handle];
  const itemHandles: string[] = [];
  const records: Array<number | string> = [];
  const nodes = [ownerRoot.root, ...collectChildNodes(ownerRoot.tree, ownerRoot.root.handle)];
  for (const node of nodes) {
    const itemIndex = itemHandles.length;
    itemHandles.push(node.handle);
    records.push(0, itemIndex, encodeMegaBase64Url(encryptAesEcb(node.nodeKey, shareKey)));
  }
  return [shareHandles, itemHandles, records];
}

export function buildMegaChildNodeShareRecords(
  shareCrypto: MegaShareCryptoContext,
  nodeHandle: string,
  nodeKey: Buffer
): readonly unknown[] {
  return [
    [shareCrypto.shareHandle],
    [nodeHandle],
    [0, 0, encodeMegaBase64Url(encryptAesEcb(nodeKey, shareCrypto.shareKey))],
  ];
}

export function collectChildNodes(tree: DecryptedMegaTree, parentHandle: string): DecryptedMegaNode[] {
  const result: DecryptedMegaNode[] = [];
  const pending = [...(tree.childrenByParent.get(parentHandle) ?? [])];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }
    result.push(current);
    pending.unshift(...(tree.childrenByParent.get(current.handle) ?? []));
  }
  return result;
}

export function collectDuplicateSiblingFileHandles(tree: DecryptedMegaTree): string[] {
  const toDelete: string[] = [];
  for (const [, children] of tree.childrenByParent) {
    const filesByName = new Map<string, DecryptedMegaNode[]>();
    for (const child of children) {
      if (child.isFolder) continue;
      const key = child.name;
      const group = filesByName.get(key);
      if (group) {
        group.push(child);
      } else {
        filesByName.set(key, [child]);
      }
    }
    for (const [, group] of filesByName) {
      if (group.length <= 1) continue;
      group.sort((left, right) => {
        if (left.size !== right.size) return right.size - left.size;
        const leftTime = left.modifiedAt ?? 0;
        const rightTime = right.modifiedAt ?? 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return left.handle.localeCompare(right.handle);
      });
      for (let index = 1; index < group.length; index += 1) {
        toDelete.push(group[index].handle);
      }
    }
  }
  return toDelete;
}

export function compareMegaNodeCandidates(tree: DecryptedMegaTree, left: DecryptedMegaNode, right: DecryptedMegaNode): number {
  const leftScore = scoreMegaNodeCandidate(tree, left);
  const rightScore = scoreMegaNodeCandidate(tree, right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  const leftModifiedAt = left.modifiedAt ?? 0;
  const rightModifiedAt = right.modifiedAt ?? 0;
  if (leftModifiedAt !== rightModifiedAt) {
    return rightModifiedAt - leftModifiedAt;
  }
  return left.handle.localeCompare(right.handle);
}

export function scoreMegaNodeCandidate(tree: DecryptedMegaTree, node: DecryptedMegaNode): number {
  if (!node.isFolder) {
    return 0;
  }
  const children = [...(tree.childrenByParent.get(node.handle) ?? [])];
  const childNames = new Set(children.map((child) => child.name));
  const descendantCount = collectChildNodes(tree, node.handle).length;
  const expectedTopLevelChildren = Number(childNames.has('blocks')) + Number(childNames.has('channels'));
  const directChildCount = children.length;
  return expectedTopLevelChildren * 1_000_000 + directChildCount * 1_000 + descendantCount;
}

export async function fetchMegaNodesSnapshot(
  apiClient: MegaApiClient,
  session: MegaSession,
  partialRoot?: string,
  options: {
    readonly useCache?: boolean;
  } = {},
  signal?: AbortSignal
): Promise<MegaFetchNodesSnapshot> {
  const response = await withMegaApiRetry(
    () => requestMegaNodesSnapshot(apiClient, session, partialRoot, options, signal),
    signal
  );
  return parseMegaFetchNodesSnapshot(response);
}

export async function requestMegaNodesSnapshot(
  apiClient: MegaApiClient,
  session: MegaSession,
  partialRoot?: string,
  options: {
    readonly useCache?: boolean;
  } = {},
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  touchMegaSyncActivity(signal);
  const result = await apiClient.requestSingle<Record<string, unknown> | number>(
    buildMegaFetchNodesCommand({
      ...(partialRoot ? { partialRoot } : {}),
      ...(options.useCache === false ? { useCache: false } : {}),
    }),
    { sessionId: session.sid, signal }
  );
  if (typeof result === 'number') {
    const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
    error.code = result;
    throw error;
  }
  return result;
}

export function decryptMegaTree(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  options: { readonly expectedRootHandle?: string; readonly expectedRootName?: string } = {},
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map(),
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): DecryptedMegaTree {
  const expectedRootHandle = options.expectedRootHandle?.trim() || undefined;
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    if (handle) {
      usersByHandle.set(handle, user);
    }
  }

  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);

  const nodesByHandle = new Map<string, DecryptedMegaNode>();
  const availableNodeKeys = new Map<string, Buffer>();
  const pendingNodes = [...snapshot.nodes];
  let madeProgress = true;
  while (madeProgress && pendingNodes.length > 0) {
    madeProgress = false;
    for (let index = 0; index < pendingNodes.length;) {
      const node = pendingNodes[index]!;
      const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle, availableNodeKeys);
      if (!decrypted) {
        index += 1;
        continue;
      }
      nodesByHandle.set(decrypted.handle, decrypted);
      availableNodeKeys.set(decrypted.handle, Buffer.from(decrypted.nodeKey));
      pendingNodes.splice(index, 1);
      madeProgress = true;
    }
  }

  let undecryptedNodeCount = 0;
  const undecryptedNodes: Array<{
    handle: string;
    parentHandle?: string;
    nodeType: number;
    keyOwners: string;
    knownOwners: string;
    hasNodeHandleKey: boolean;
    hasSharingUser: boolean;
    encodedKeyLength: number;
    encodedAttributesLength: number;
    candidateCount: number;
    candidateKeyOwners: string;
    candidateKeyLengths: string;
  }> = [];
  for (const node of pendingNodes) {
    if (typeof node.h === 'string') {
      undecryptedNodeCount += 1;
      const handle = node.h.trim();
      if (handle && undecryptedNodes.length < 8) {
        const keyOwners = listMegaNodeKeyOwners(typeof node.k === 'string' ? node.k : undefined);
        const candidateKeys = decryptNodeKeys(node, session, shareKeys, availableNodeKeys);
        undecryptedNodes.push({
          handle,
          parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
          nodeType: Number(node.t ?? 0),
          keyOwners: keyOwners.join(','),
          knownOwners: keyOwners.filter((owner) => shareKeys.has(owner)).join(','),
          hasNodeHandleKey: shareKeys.has(handle),
          hasSharingUser: typeof (node as Record<string, unknown>).su === 'string' && String((node as Record<string, unknown>).su).trim() !== '',
          encodedKeyLength: typeof node.k === 'string' ? node.k.trim().length : 0,
          encodedAttributesLength: typeof node.a === 'string' ? node.a.trim().length : 0,
          candidateCount: candidateKeys.length,
          candidateKeyOwners: candidateKeys.map((candidate) => candidate.keyOwner ?? '').join(','),
          candidateKeyLengths: candidateKeys.map((candidate) => String(candidate.nodeKey.length)).join(','),
        });
      }
    }
  }
  if (undecryptedNodeCount > 0 && logger) {
    const rootShareKeyFingerprint = expectedRootHandle
      ? (() => {
          const rootShareKey = shareKeys.get(expectedRootHandle);
          return rootShareKey ? fingerprintMegaShareKey(rootShareKey) : undefined;
        })()
      : undefined;
    logger.warn('MEGA tree decryption: some nodes could not be decrypted.', {
      undecryptedNodeCount,
      totalNodes: snapshot.nodes.length,
      decryptedNodes: nodesByHandle.size,
      shareKeysAvailable: shareKeys.size,
      hasPrivateKey: Boolean(session.privateKey),
      expectedRootHandle,
      rootShareKeyFingerprint,
      undecryptedNodes,
    });
  }

  const childrenByParent = new Map<string, DecryptedMegaNode[]>();
  for (const node of nodesByHandle.values()) {
    if (!node.parentHandle) {
      continue;
    }
    const children = childrenByParent.get(node.parentHandle) ?? [];
    children.push(node);
    childrenByParent.set(node.parentHandle, children);
  }

  const rootHandle = expectedRootHandle?.trim() || resolveTreeRootHandle(nodesByHandle);
  let root = nodesByHandle.get(rootHandle);
  if (!root && expectedRootHandle) {
    const fallbackRoot = buildFallbackDecryptedMegaNode(
      snapshot.nodes.find((node) => typeof node.h === 'string' && node.h.trim() === expectedRootHandle),
      session,
      shareKeys,
      usersByHandle,
      availableNodeKeys,
      options.expectedRootName
    );
    if (fallbackRoot) {
      nodesByHandle.set(fallbackRoot.handle, fallbackRoot);
      root = fallbackRoot;
    }
  }
  if (!root) {
    throw new Error('MEGA tree did not include the requested root node.');
  }

  return {
    root,
    nodesByHandle,
    childrenByParent,
  };
}

export function buildFallbackDecryptedMegaNode(
  node: MegaNodeRecord | undefined,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>,
  usersByHandle: ReadonlyMap<string, MegaUserRecord>,
  availableNodeKeys: ReadonlyMap<string, Buffer>,
  fallbackName?: string
): DecryptedMegaNode | null {
  if (!node) {
    return null;
  }

  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }

  const nodeType = Number(node.t ?? 0);
  const isSpecialRoot = nodeType === 2 || nodeType === 3 || nodeType === 4;
  const normalizedFallbackName = fallbackName?.trim() || describeMegaSpecialNodeName(nodeType) || normalizeMegaIncomingShareName(undefined, handle);
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
  const resolvedNodeKey = nodeCandidates[0]?.nodeKey;
  if (!resolvedNodeKey) {
    return null;
  }

  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : undefined;
  const ownerEmail = ownerHandle
    ? (typeof usersByHandle.get(ownerHandle)?.m === 'string' ? String(usersByHandle.get(ownerHandle)?.m) : undefined)
    : undefined;
  const accessLevel = megaIncomingAccessLevelFromMeta(nodeMeta);
  const shareHandle = deriveShareHandle(typeof node.k === 'string' ? node.k : undefined, shareKeys) ?? handle;

  return {
    handle,
    parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
    nodeType,
    isFolder: nodeType !== 0,
    size: Number(node.s ?? 0) || 0,
    name: normalizedFallbackName,
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

export async function fetchMegaDecryptedTree(
  apiClient: MegaApiClient,
  session: MegaSession,
  rootHandle?: string,
  options: {
    readonly useCache?: boolean;
    readonly allowTransientFullFallback?: boolean;
    readonly fastPartialFallback?: boolean;
    readonly extraShareKeys?: ReadonlyMap<string, Buffer>;
    readonly expectedRootName?: string;
  } = {},
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<MegaFetchedTree> {
  let snapshot: MegaFetchNodesSnapshot;
  if (rootHandle) {
    try {
      snapshot = options.fastPartialFallback
        ? parseMegaFetchNodesSnapshot(
          await keepMegaSyncAliveWhile(requestMegaNodesSnapshot(apiClient, session, rootHandle, options, signal), signal)
        )
        : await keepMegaSyncAliveWhile(fetchMegaNodesSnapshot(apiClient, session, rootHandle, options, signal), signal);
    } catch (error) {
      const transientPartialFetchFailure =
        isMegaTemporaryLockError(error) || isMegaRateLimitedError(error) || isMegaRetryableTransportError(error);
      if (transientPartialFetchFailure && options.allowTransientFullFallback !== true) {
        throw error;
      }
      if (!transientPartialFetchFailure && !isMegaAccessDeniedError(error)) {
        throw error;
      }
      logger?.warn?.('MEGA partial tree fetch failed; falling back to a full node snapshot.', {
        email: session.email,
        rootHandle,
        message: error instanceof Error ? error.message : String(error),
      });
      snapshot = await keepMegaSyncAliveWhile(fetchMegaNodesSnapshot(apiClient, session, undefined, options, signal), signal);
    }
  } else {
    snapshot = await keepMegaSyncAliveWhile(fetchMegaNodesSnapshot(apiClient, session, undefined, options, signal), signal);
  }

  const keyManager = await keepMegaSyncAliveWhile(fetchMegaKeyManagerState(apiClient, session, signal, logger), signal);
  const pendingKeys = snapshotIncludesIncomingShareNodes(snapshot)
    ? await keepMegaSyncAliveWhile(fetchMegaPendingInShareKeys(apiClient, session, signal, logger), signal)
    : new Map();
  const mergedKeyManager = {
    ...keyManager,
    pendingInShares: mergeMegaPendingInShares(keyManager.pendingInShares, pendingKeys),
  };
  const resolveShareKeysForSnapshot = async (activeSnapshot: MegaFetchNodesSnapshot): Promise<ReadonlyMap<string, Buffer>> =>
    mergeMegaShareKeyMaps(
      options.extraShareKeys,
      await keepMegaSyncAliveWhile(
        resolveMegaKeyManagerShareKeys(apiClient, session, mergedKeyManager, signal, logger, activeSnapshot),
        signal
      )
    );
  const shareKeys = await resolveShareKeysForSnapshot(snapshot);
  const expectedRootHandle = rootHandle?.trim() || resolveMegaCloudDriveHandle(snapshot);
  const treeOptions = {
    expectedRootHandle,
    expectedRootName: options.expectedRootName,
  };
  try {
    return {
      snapshot,
      tree: decryptMegaTree(snapshot, session, treeOptions, shareKeys, logger),
    };
  } catch (error) {
    if (
      !expectedRootHandle ||
      !(error instanceof Error) ||
      error.message !== 'MEGA tree did not include the requested root node.'
    ) {
      throw error;
    }
    logger?.warn?.('MEGA partial tree decryption missed the requested root; falling back to a full node snapshot.', {
      email: session.email,
      rootHandle: expectedRootHandle,
    });
    const fullSnapshot = await keepMegaSyncAliveWhile(fetchMegaNodesSnapshot(apiClient, session, undefined, options, signal), signal);
    const fullShareKeys = await resolveShareKeysForSnapshot(fullSnapshot);
    let fallbackTree: DecryptedMegaTree;
    try {
      fallbackTree = decryptMegaTree(fullSnapshot, session, treeOptions, fullShareKeys, logger);
    } catch (fallbackError) {
      const missingRequestedRoot =
        expectedRootHandle &&
        fallbackError instanceof Error &&
        fallbackError.message === 'MEGA tree did not include the requested root node.';
      if (!missingRequestedRoot) {
        throw fallbackError;
      }
      logger?.warn?.('MEGA full snapshot fallback resolved a different root than requested; using the decrypted root that is available.', {
        email: session.email,
        requestedRootHandle: expectedRootHandle,
      });
      try {
        fallbackTree = decryptMegaTree(
          fullSnapshot,
          session,
          { expectedRootName: options.expectedRootName },
          fullShareKeys,
          logger
        );
      } catch (relaxedError) {
        if (relaxedError instanceof Error && relaxedError.message === 'MEGA tree root could not be determined.') {
          throw fallbackError;
        }
        throw relaxedError;
      }
    }
    return {
      snapshot: fullSnapshot,
      tree: fallbackTree,
    };
  }
}

export async function findMegaRemoteChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<DecryptedMegaNode | undefined> {
  try {
    const fetched = await fetchMegaDecryptedTree(apiClient, session, parentHandle, { extraShareKeys }, signal);
    return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
  } catch (error) {
    if (!isMegaMissingRequestedRootError(error)) {
      throw error;
    }
    const fetched = await fetchMegaDecryptedTree(apiClient, session, undefined, { extraShareKeys }, signal);
    return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
  }
}

export function snapshotIncludesIncomingShareNodes(snapshot: MegaFetchNodesSnapshot): boolean {
  return snapshot.nodes.some((node) => {
    const sharingUser = (node as Record<string, unknown>).su;
    return typeof sharingUser === 'string' && sharingUser.trim() !== '';
  });
}

export async function waitForMegaChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<DecryptedMegaNode | undefined> {
  for (let attempt = 0; attempt < MEGA_NODE_APPEAR_ATTEMPTS; attempt += 1) {
    const node = await findMegaRemoteChildNode(apiClient, session, parentHandle, name, folderOnly, signal, extraShareKeys);
    if (node) {
      return node;
    }
    if (attempt < MEGA_NODE_APPEAR_DELAYS_MS.length) {
      await waitForMegaRetry(MEGA_NODE_APPEAR_DELAYS_MS[attempt]!, signal);
    }
  }
  return undefined;
}

export async function fetchOwnerRootByPath(
  apiClient: MegaApiClient,
  session: MegaSession,
  remotePath: string,
  signal?: AbortSignal
): Promise<MegaOwnerRemoteRoot> {
  const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
  const cloudHandle = resolveMegaCloudDriveHandle(snapshot);
  if (!cloudHandle) {
    throw new Error('MEGA snapshot did not include a Cloud Drive root.');
  }

  let currentHandle = cloudHandle;
  const segments = normalizeMegaRemoteDisplayPath(remotePath).split('/').filter((entry) => entry.length > 0);
  for (const segment of segments) {
    const fetched = await fetchMegaDecryptedTree(
      apiClient,
      session,
      currentHandle,
      { useCache: false, allowTransientFullFallback: false },
      signal
    );
    const next = findChildNodeByName(fetched.tree, currentHandle, segment, true);
    if (!next) {
      throw new Error(`MEGA path ${remotePath} is missing ${segment}.`);
    }
    currentHandle = next.handle;
  }

  const fetched = await fetchMegaDecryptedTree(
    apiClient,
    session,
    currentHandle,
    { useCache: false, allowTransientFullFallback: false },
    signal
  );
  return {
    path: normalizeMegaRemoteDisplayPath(remotePath),
    root: fetched.tree.root,
    tree: fetched.tree,
  };
}

export async function createMegaFolder(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  shareCrypto: MegaShareCryptoContext | undefined,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<string> {
  for (let attempt = 0; attempt < MEGA_CREATE_RECOVERY_ATTEMPTS; attempt += 1) {
    const nodeKey = randomBytes(16);
    try {
      const request = {
        a: 'p',
        ...(shareCrypto ? { v: 3, sm: 1 } : {}),
        t: parentHandle,
        i: createMegaMutationRequestId(),
        ...(shareCrypto ? { cr: buildMegaChildNodeShareRecords(shareCrypto, MEGA_PUT_NODES_PLACEHOLDER_HANDLE, nodeKey) } : {}),
        n: [
          {
            h: MEGA_PUT_NODES_PLACEHOLDER_HANDLE,
            t: 1,
            a: encryptMegaAttributes(name, nodeKey),
            k: encodeMegaBase64Url(encryptMegaNodeKeyForOwner(nodeKey, session.masterKey)),
          },
        ],
      } satisfies Record<string, unknown>;
      touchMegaSyncActivity(signal);
      const response = await apiClient.requestSingle<Record<string, unknown> | number>(request, { sessionId: session.sid, signal });
      if (typeof response === 'number' && response !== 0) {
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      const committedNode = await waitForMegaChildNode(apiClient, session, parentHandle, name, true, signal, extraShareKeys);
      if (!committedNode || !committedNode.isFolder) {
        throw new Error(`MEGA did not make the created folder visible for ${name}.`);
      }
      return committedNode.handle;
    } catch (error) {
      const recovered = await tryFindMegaRemoteChildNode(
        apiClient,
        session,
        parentHandle,
        name,
        true,
        signal,
        extraShareKeys
      );
      if (recovered?.isFolder) {
        return recovered.handle;
      }
      if (
        !isMegaRetryableApiError(error) &&
        !isMegaRetryableTransportError(error) &&
        !isMegaEventuallyConsistentMutationError(error)
      ) {
        throw error;
      }
      if (attempt >= MEGA_CREATE_RECOVERY_ATTEMPTS - 1) {
        throw error;
      }
      await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
    }
  }
  throw new Error(`MEGA did not create ${name}.`);
}

export async function uploadMegaOwnerFile(
  fetchImpl: typeof fetch,
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  data: Buffer,
  shareCrypto: MegaShareCryptoContext | undefined,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>,
  options: {
    readonly waitForVisibility?: boolean;
  } = {}
): Promise<DecryptedMegaNode> {
  const waitForVisibility = options.waitForVisibility !== false;
  for (let attempt = 0; attempt < MEGA_UPLOAD_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      const transferKey = randomBytes(16);
      const iv = randomBytes(8);
      touchMegaSyncActivity(signal);
      const uploadReservation = await apiClient.requestSingle<Record<string, unknown> | number>(
        {
          a: 'u',
          ssl: 2,
          v: 2,
          s: data.length,
          t: [parentHandle],
        },
        { sessionId: session.sid, signal }
      );
      if (typeof uploadReservation === 'number') {
        const error = new Error(`MEGA API error ${uploadReservation}.`) as MegaApiError;
        error.code = uploadReservation;
        throw error;
      }

      const uploadUrl = assertString(uploadReservation.p, `MEGA did not return an upload URL for ${name}.`);
      const encrypted = encryptMegaFileContent(data, transferKey, iv);
      const crc = computeMegaUploadChecksum(encrypted);
      touchMegaSyncActivity(signal);
      const uploadResponse = await fetchImpl(`${uploadUrl}/0?d=${encodeMegaBase64Url(crc)}`, {
        method: 'POST',
        body: new Uint8Array(encrypted),
        signal,
      });
      if (!uploadResponse.ok) {
        throw new Error(`MEGA upload failed with HTTP ${uploadResponse.status}.`);
      }
      const uploadToken = Buffer.from(await uploadResponse.arrayBuffer());
      if (uploadToken.length === 0) {
        throw new Error(`MEGA did not return an upload token for ${name}.`);
      }

      const sentNodeKey = buildMegaFileNodeKey(transferKey, iv, computeMegaMetaMac(data, transferKey, iv));
      const uploadHandle = normalizeMegaUploadTokenHandle(uploadToken);
      touchMegaSyncActivity(signal);
      const response = await apiClient.requestSingle<Record<string, unknown> | number>(
        {
          a: 'p',
          v: 3,
          ...(shareCrypto ? { sm: 1 } : {}),
          t: parentHandle,
          i: createMegaMutationRequestId(),
          ...(shareCrypto ? { cr: buildMegaChildNodeShareRecords(shareCrypto, uploadHandle, sentNodeKey) } : {}),
          n: [
            {
              h: uploadHandle,
              t: 0,
              a: encryptMegaAttributes(name, transferKey),
              k: encodeMegaBase64Url(encryptMegaNodeKeyForOwner(sentNodeKey, session.masterKey)),
            },
          ],
        },
        { sessionId: session.sid, signal }
      );
      if (typeof response === 'number' && response !== 0) {
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      if (!waitForVisibility) {
        return {
          handle: uploadHandle,
          parentHandle,
          nodeType: 0,
          isFolder: false,
          size: data.length,
          name,
          nodeKey: sentNodeKey,
        };
      }
      const committedNode = await waitForMegaChildNode(apiClient, session, parentHandle, name, false, signal, extraShareKeys);
      if (!committedNode || committedNode.isFolder) {
        throw new Error(`MEGA did not make the uploaded file visible for ${name}.`);
      }
      return committedNode;
    } catch (error) {
      const recovered = await tryFindMegaRemoteChildNode(
        apiClient,
        session,
        parentHandle,
        name,
        false,
        signal,
        extraShareKeys
      );
      if (recovered && !recovered.isFolder) {
        return recovered;
      }
      if (
        !isMegaRetryableApiError(error) &&
        !isMegaRetryableTransportError(error) &&
        !isMegaEventuallyConsistentMutationError(error)
      ) {
        throw error;
      }
      if (attempt >= MEGA_UPLOAD_RECOVERY_ATTEMPTS - 1) {
        throw error;
      }
      await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
    }
  }
  throw new Error(`MEGA did not upload ${name}.`);
}

export async function deleteMegaNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  nodeHandle: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < MEGA_UPLOAD_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      touchMegaSyncActivity(signal);
      const response = await apiClient.requestSingle<Record<string, unknown> | number>(
        { a: 'd', i: createMegaMutationRequestId(), n: nodeHandle },
        { sessionId: session.sid, signal }
      );
      if (response === -9) {
        return;
      }
      if (typeof response === 'number' && response !== 0) {
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      return;
    } catch (error) {
      if ((error as MegaApiError | undefined)?.code === -9) {
        return;
      }
      if (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error)) {
        throw error;
      }
      if (attempt >= MEGA_UPLOAD_RECOVERY_ATTEMPTS - 1) {
        throw error;
      }
      await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
    }
  }
}

export async function tryFindMegaRemoteChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<DecryptedMegaNode | undefined> {
  try {
    return await findMegaRemoteChildNode(apiClient, session, parentHandle, name, folderOnly, signal, extraShareKeys);
  } catch (error) {
    if (isMegaRetryableApiError(error) || isMegaRetryableTransportError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function encryptMegaNodeKeyForOwner(nodeKey: Buffer, masterKey: Buffer): Buffer {
  return encryptAesEcb(nodeKey, masterKey);
}

export function createMegaMutationRequestId(): number {
  return randomBytes(4).readUInt32BE(0);
}

export function normalizeMegaUploadTokenHandle(uploadToken: Buffer): string {
  const ascii = uploadToken.toString('utf8').trim();
  if (/^[A-Za-z0-9_-]{6,}$/u.test(ascii)) {
    return ascii;
  }
  return encodeMegaBase64Url(uploadToken);
}

export function encryptMegaAttributes(name: string, key: Buffer): string {
  const raw = Buffer.from(`MEGA${JSON.stringify({ n: name })}`, 'utf8');
  const paddedLength = Math.ceil(raw.length / 16) * 16;
  const padded = Buffer.concat([raw, Buffer.alloc(paddedLength - raw.length, 0)]);
  return encodeMegaBase64Url(Buffer.from(nobleAesCbc(key.subarray(0, 16), ZERO_IV, { disablePadding: true }).encrypt(padded)));
}

export function encryptMegaFileContent(data: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const counter = Buffer.alloc(16, 0);
  iv.copy(counter, 0);
  return Buffer.from(nobleAesCtr(transferKey, counter).encrypt(data));
}

export function buildMegaFileNodeKey(transferKey: Buffer, iv: Buffer, metaMac: Buffer): Buffer {
  const secondHalf = Buffer.concat([iv.subarray(0, 8), metaMac.subarray(0, 8)]);
  return Buffer.concat([xorBuffers(transferKey, secondHalf), secondHalf]);
}

export function computeMegaMetaMac(data: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const cipher = transferKey.subarray(0, 16);
  const chunkMacs: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(nextMegaChunkBoundary(offset), data.length);
    chunkMacs.push(computeMegaChunkMac(data.subarray(offset, end), cipher, iv));
    offset = end;
  }

  let mac: Buffer = Buffer.alloc(16, 0);
  for (const chunkMac of chunkMacs) {
    mac = encryptAesEcb(xorBuffers(mac, chunkMac), cipher) as Buffer;
  }
  mac = Buffer.from(mac);
  mac.writeUInt32LE((mac.readUInt32LE(0) ^ mac.readUInt32LE(4)) >>> 0, 0);
  mac.writeUInt32LE((mac.readUInt32LE(8) ^ mac.readUInt32LE(12)) >>> 0, 4);
  return mac.subarray(0, 8);
}

export function computeMegaChunkMac(chunk: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const mac = Buffer.concat([iv.subarray(0, 8), iv.subarray(0, 8)]);
  for (let offset = 0; offset < chunk.length; offset += 16) {
    const block = Buffer.alloc(16, 0);
    chunk.copy(block, 0, offset, Math.min(offset + 16, chunk.length));
    mac.set(encryptAesEcb(xorBuffers(block, mac), transferKey));
  }
  return mac;
}

export function nextMegaChunkBoundary(position: number): number {
  const segmentSize = 131_072;
  let chunkStart = 0;
  for (let multiplier = 1; multiplier <= 8; multiplier += 1) {
    const chunkEnd = chunkStart + multiplier * segmentSize;
    if (position >= chunkStart && position < chunkEnd) {
      return chunkEnd;
    }
    chunkStart = chunkEnd;
  }
  return Math.floor((position - chunkStart) / (8 * segmentSize)) * (8 * segmentSize) + chunkStart + 8 * segmentSize;
}

export function computeMegaUploadChecksum(data: Buffer): Buffer {
  const crc = Buffer.alloc(12, 0);
  let offset = 0;
  const alignedBytes = data.length - (data.length % crc.length);
  while (offset < alignedBytes) {
    for (let index = 0; index < crc.length; index += 1) {
      crc[index] = crc[index]! ^ data[offset + index]!;
    }
    offset += crc.length;
  }
  for (let index = 0; offset + index < data.length; index += 1) {
    crc[index] = crc[index]! ^ data[offset + index]!;
  }
  return crc;
}

export async function visitTree(
  tree: DecryptedMegaTree,
  visit: (relativePath: string, node: DecryptedMegaNode) => Promise<void>
): Promise<void> {
  const walk = async (parentHandle: string, prefix = ''): Promise<void> => {
    const children = [...(tree.childrenByParent.get(parentHandle) ?? [])].sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = prefix ? path.join(prefix, sanitizePathSegment(child.name)) : sanitizePathSegment(child.name);
      await visit(relativePath, child);
      if (child.isFolder) {
        await walk(child.handle, relativePath);
      }
    }
  };
  await walk(tree.root.handle);
}

export function actionPacketBatchTouchesShare(
  packets: readonly Record<string, unknown>[],
  rootHandle: string,
  manifest: MegaMirrorManifest
): boolean {
  if (!packets.length) {
    return false;
  }
  const relevantHandles = new Set<string>(manifest.knownHandles ?? []);
  relevantHandles.add(rootHandle);
  return packets.some((packet) => actionPacketTouchesShare(packet, relevantHandles));
}

export function actionPacketTouchesShare(packet: Record<string, unknown>, relevantHandles: ReadonlySet<string>): boolean {
  const handles = collectActionPacketHandles(packet);
  if (handles.some((handle) => relevantHandles.has(handle))) {
    return true;
  }
  const action = typeof packet.a === 'string' ? packet.a.trim() : '';
  return action === 't';
}

export function collectActionPacketHandles(packet: Record<string, unknown>): string[] {
  const result = new Set<string>();
  collectPacketHandlesRecursive(packet, result);
  return [...result];
}

export function summarizeActionPacketActions(packets: readonly Record<string, unknown>[]): string[] {
  const actions = new Set<string>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action) {
      actions.add(action);
    }
  }
  return [...actions];
}

export function createMegaActionPacketLogDetails(
  packets: readonly Record<string, unknown>[]
): Array<{
  readonly action: string;
  readonly handles: string[];
  readonly keys: string[];
  readonly packet: unknown;
}> {
  return packets.map((packet) => ({
    action: typeof packet.a === 'string' ? packet.a.trim() : '',
    handles: collectActionPacketHandles(packet),
    keys: Object.keys(packet).sort(),
    packet: sanitizeMegaActionPacketForLogging(packet),
  }));
}

export function sanitizeMegaActionPacketForLogging(value: unknown, parentKey?: string): unknown {
  if (parentKey && MEGA_REDACTED_ACTION_PACKET_LOG_KEYS.has(parentKey)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const limit = 25;
    const sanitized = value.slice(0, limit).map((entry) => sanitizeMegaActionPacketForLogging(entry, parentKey));
    if (value.length > limit) {
      sanitized.push(`[${value.length - limit} more item(s)]`);
    }
    return sanitized;
  }
  if (!value || typeof value !== 'object') {
    return value === undefined ? undefined : String(value);
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const entry = sanitizeMegaActionPacketForLogging(entryValue, key);
    if (entry !== undefined) {
      sanitized[key] = entry;
    }
  }
  return sanitized;
}

export function collectRecipientImmediatePacketHandles(
  packets: readonly Record<string, unknown>[],
  rootHandle: string
): string[] {
  const handles: string[] = [];
  const seen = new Set<string>();
  const addHandle = (handle: string | undefined): void => {
    const normalized = handle?.trim();
    if (!normalized || normalized === rootHandle || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    handles.push(normalized);
  };

  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action === 't') {
      const tree = packet.t;
      const fetchedNodes =
        tree && typeof tree === 'object' && Array.isArray((tree as { f?: unknown }).f)
          ? (tree as { f: unknown[] }).f
          : [];
      const pendingParentHandles: string[] = [];
      for (const node of fetchedNodes) {
        if (!node || typeof node !== 'object') {
          continue;
        }
        addHandle(typeof (node as { h?: unknown }).h === 'string' ? (node as { h: string }).h : undefined);
        const parentHandle = typeof (node as { p?: unknown }).p === 'string' ? (node as { p: string }).p : undefined;
        if (parentHandle && parentHandle.trim() && parentHandle.trim() !== rootHandle) {
          pendingParentHandles.push(parentHandle);
        }
      }
      for (const parentHandle of pendingParentHandles) {
        addHandle(parentHandle);
      }
      continue;
    }
    if (action === 'd') {
      continue;
    }
    for (const handle of collectActionPacketHandles(packet)) {
      addHandle(handle);
    }
  }
  return handles;
}

export function collectRecipientImmediatePacketNodes(
  packets: readonly Record<string, unknown>[]
): MegaNodeRecord[] {
  const nodesByHandle = new Map<string, MegaNodeRecord>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action !== 't') {
      continue;
    }
    const tree = packet.t;
    const fetchedNodes =
      tree && typeof tree === 'object' && Array.isArray((tree as { f?: unknown }).f)
        ? (tree as { f: unknown[] }).f
        : [];
    for (const node of fetchedNodes) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      const handle = typeof (node as { h?: unknown }).h === 'string' ? (node as { h: string }).h.trim() : '';
      if (!handle) {
        continue;
      }
      nodesByHandle.set(handle, node as MegaNodeRecord);
    }
  }
  return [...nodesByHandle.values()];
}

export function collectRecipientDeletedPacketHandles(
  packets: readonly Record<string, unknown>[],
  rootHandle: string
): string[] {
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action !== 'd') {
      continue;
    }
    const handle = getActionPacketString(packet, 'n') ?? getActionPacketString(packet, 'h');
    if (!handle || handle === rootHandle || seen.has(handle)) {
      continue;
    }
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

export function buildMegaUsersByHandleFromActionPackets(
  packets: readonly Record<string, unknown>[]
): Map<string, MegaUserRecord> {
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const packet of packets) {
    const tree = packet.t;
    const users =
      tree && typeof tree === 'object' && Array.isArray((tree as { u?: unknown }).u)
        ? (tree as { u: unknown[] }).u
        : Array.isArray((packet as { u?: unknown }).u)
          ? ((packet as { u: unknown[] }).u)
          : [];
    for (const user of users) {
      if (!user || typeof user !== 'object') {
        continue;
      }
      const handle = typeof (user as { u?: unknown }).u === 'string' ? (user as { u: string }).u.trim() : '';
      if (!handle) {
        continue;
      }
      usersByHandle.set(handle, user as MegaUserRecord);
    }
  }
  return usersByHandle;
}

export function resolveRecipientPacketNodePath(
  node: DecryptedMegaNode,
  rootHandle: string,
  handlePathIndex: ReadonlyMap<string, string>,
  packetNodesByHandle: ReadonlyMap<string, DecryptedMegaNode>,
  visited = new Set<string>()
): string | undefined {
  const existingPath = handlePathIndex.get(node.handle);
  if (existingPath) {
    return existingPath;
  }
  if (node.parentHandle === rootHandle) {
    return sanitizePathSegment(node.name);
  }
  if (!node.parentHandle || visited.has(node.handle)) {
    return undefined;
  }

  const parentPath = handlePathIndex.get(node.parentHandle);
  if (parentPath) {
    return normalizeRelativePath(path.join(parentPath, sanitizePathSegment(node.name)));
  }

  const packetParent = packetNodesByHandle.get(node.parentHandle);
  if (!packetParent) {
    return undefined;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(node.handle);
  const resolvedParentPath = resolveRecipientPacketNodePath(
    packetParent,
    rootHandle,
    handlePathIndex,
    packetNodesByHandle,
    nextVisited,
  );
  if (!resolvedParentPath) {
    return undefined;
  }
  return normalizeRelativePath(path.join(resolvedParentPath, sanitizePathSegment(node.name)));
}

export function extractMegaShareKeysFromActionPackets(
  packets: readonly Record<string, unknown>[],
  session: MegaSession
): Map<string, Buffer> {
  const shareKeys = new Map<string, Buffer>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action !== 's' && action !== 's2') {
      continue;
    }

    const shareHandle = getActionPacketString(packet, 'n') ?? getActionPacketString(packet, 'h');
    if (!shareHandle) {
      continue;
    }

    const ownerHandle = getActionPacketString(packet, 'o');
    const encodedShareKey = ownerHandle === session.userHandle
      ? getActionPacketString(packet, 'ok') ?? getActionPacketString(packet, 'k')
      : getActionPacketString(packet, 'k') ?? getActionPacketString(packet, 'ok');
    if (!encodedShareKey) {
      continue;
    }

    const shareKey = decryptShareKey(encodedShareKey, session);
    if (!shareKey) {
      continue;
    }
    shareKeys.set(shareHandle, Buffer.from(shareKey));
  }
  return shareKeys;
}

export function getActionPacketString(packet: Record<string, unknown>, key: string): string | undefined {
  const value = packet[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function removeManifestEntriesUnderPath(
  relativePath: string,
  entries: Record<string, ProviderRefreshManifestEntry>,
  handlePathIndex: Map<string, string>,
): string[] {
  const normalizedPath = normalizeRelativePath(relativePath);
  const removedPaths: string[] = [];
  for (const [entryPath, entry] of Object.entries(entries)) {
    if (entryPath !== normalizedPath && !entryPath.startsWith(`${normalizedPath}/`)) {
      continue;
    }
    removedPaths.push(entryPath);
    delete entries[entryPath];
    if (typeof entry.handle === 'string' && entry.handle.trim()) {
      handlePathIndex.delete(entry.handle);
    }
  }
  return removedPaths;
}

export function collectPacketHandlesRecursive(value: unknown, result: Set<string>, key?: string): void {
  if (typeof value === 'string') {
    if (key && ACTION_PACKET_HANDLE_KEYS.has(key) && value.trim()) {
      result.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPacketHandlesRecursive(entry, result, key);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    collectPacketHandlesRecursive(entryValue, result, entryKey);
  }
}

export function shouldResetScCursor(error: unknown): boolean {
  return typeof (error as MegaApiError | undefined)?.code === 'number' && (error as MegaApiError).code === -6;
}

export function allActionsAreAccountLevel(actions: readonly string[]): boolean {
  return actions.length > 0 && actions.every((action) => ACCOUNT_LEVEL_ACTIONS.has(action));
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, ' ').trim();
  return cleaned || 'unnamed';
}

export function createNodeFingerprint(node: DecryptedMegaNode): string {
  return Buffer.from(
    sha256(
      Buffer.from(
        [
          node.handle,
          String(node.size),
          node.encodedAttributes ?? '',
          node.encodedKey ?? '',
        ].join('\n'),
        'utf8'
      )
    )
  ).toString('hex');
}

export function createProviderRefreshManifestEntry(node: DecryptedMegaNode): ProviderRefreshManifestEntry {
  return {
    fingerprint: createNodeFingerprint(node),
    kind: node.isFolder ? 'folder' : 'file',
    ...(node.isFolder ? {} : { size: node.size }),
    handle: node.handle,
    ...(node.parentHandle ? { parentHandle: node.parentHandle } : {}),
  };
}

export function buildManifestHandlePathIndex(entries: Record<string, ProviderRefreshManifestEntry>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [relativePath, entry] of Object.entries(entries)) {
    if (entry.handle) {
      index.set(entry.handle, relativePath);
    }
  }
  return index;
}

export function collectManifestHandles(entries: Record<string, ProviderRefreshManifestEntry>, rootHandle: string): string[] {
  const handles = new Set<string>([rootHandle]);
  for (const entry of Object.values(entries)) {
    if (entry.handle) {
      handles.add(entry.handle);
    }
    if (entry.parentHandle) {
      handles.add(entry.parentHandle);
    }
  }
  return [...handles].sort();
}

export function resolveRecipientFetchedNodePath(
  node: DecryptedMegaNode,
  rootHandle: string,
  handlePathIndex: ReadonlyMap<string, string>,
  mirrorRootName?: string
): string | undefined {
  const normalizedMirrorRootName = mirrorRootName?.trim().toLowerCase();
  if (normalizedMirrorRootName && node.isFolder && node.name.trim().toLowerCase() === normalizedMirrorRootName) {
    return '';
  }
  if (node.isFolder && isMirrorContainerPath(sanitizePathSegment(node.name))) {
    return sanitizePathSegment(node.name);
  }
  if (node.parentHandle === rootHandle) {
    return sanitizePathSegment(node.name);
  }
  if (node.parentHandle) {
    const parentPath = handlePathIndex.get(node.parentHandle);
    if (parentPath) {
      return normalizeRelativePath(path.join(parentPath, sanitizePathSegment(node.name)));
    }
  }
  if (node.isFolder) {
    const volumeId = normalizeVolumeId(node.name);
    if (volumeId) {
      return normalizeRelativePath(path.join('channels', volumeId));
    }
  }
  return handlePathIndex.get(node.handle);
}

export function resolveMegaRecipientMirrorRootName(share: ManagedShare): string | undefined {
  const explicitShareName = getStringDescriptor(share.remoteDescriptor, 'shareName')?.trim();
  if (explicitShareName) {
    return explicitShareName;
  }
  const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath')?.trim();
  if (!remotePath) {
    return undefined;
  }
  const normalizedRemotePath = normalizeMegaRemoteDisplayPath(remotePath);
  const segments = normalizedRemotePath.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1);
}

export function collectTreeHandles(tree: DecryptedMegaTree): string[] {
  return [...tree.nodesByHandle.keys()].sort();
}

export function listMegaTopLevelEntryNames(tree: DecryptedMegaTree): string[] {
  return [...(tree.childrenByParent.get(tree.root.handle) ?? [])]
    .map((node) => node.name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

export function listUnsupportedMegaTopLevelEntryNames(names: readonly string[]): string[] {
  return names.filter((name) => !EXPECTED_MEGA_TOP_LEVEL_NAMES.has(name));
}

export function logUnsupportedMegaTopLevelEntries(
  runtime: Pick<IntegrationRuntime, 'logger'>,
  shareId: string,
  previousNames: readonly string[] | undefined,
  currentTopLevelNames: readonly string[]
): void {
  const previousUnsupported = new Set(previousNames ?? []);
  const currentUnsupported = listUnsupportedMegaTopLevelEntryNames(currentTopLevelNames);
  const currentUnsupportedSet = new Set(currentUnsupported);
  const added = currentUnsupported.filter((name) => !previousUnsupported.has(name));
  const removed = [...previousUnsupported]
    .filter((name) => !currentUnsupportedSet.has(name))
    .sort((left, right) => left.localeCompare(right));
  if (added.length === 0 && removed.length === 0) {
    return;
  }
  runtime.logger.log('MEGA readonly share reported unsupported top-level entries.', {
    shareId,
    added,
    removed,
    current: currentUnsupported,
  });
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function summarizeRefreshResult(
  prefix: string,
  result: { downloaded: string[]; removed: string[] }
): string {
  const changes: string[] = [];
  if (result.downloaded.length > 0) {
    changes.push(`${result.downloaded.length} downloaded`);
  }
  if (result.removed.length > 0) {
    changes.push(`${result.removed.length} removed`);
  }
  return changes.length > 0 ? `${prefix} ${changes.join(', ')}.` : prefix;
}

export function logMegaMirrorRefreshEvents(
  runtime: Pick<IntegrationRuntime, 'logger'>,
  shareId: string,
  previousEntries: Record<string, ProviderRefreshManifestEntry>,
  result: {
    downloaded: string[];
    skipped: string[];
    invalid?: string[];
    skippedDetails?: Record<string, { code?: string; detail?: string }>;
    manifest: { entries: Record<string, ProviderRefreshManifestEntry> };
  }
): void {
  for (const relativePath of result.invalid ?? []) {
    const detail = result.skippedDetails?.[relativePath];
    runtime.logger.warn('MEGA readonly share skipped invalid entry.', {
      shareId,
      path: relativePath,
      code: detail?.code,
      detail: detail?.detail,
    });
  }

  for (const relativePath of result.downloaded) {
    const nextEntry = result.manifest.entries[relativePath];
    if (!nextEntry || nextEntry.kind !== 'file') {
      continue;
    }
    const previousEntry = previousEntries[relativePath];
    const basePayload = {
      shareId,
      path: relativePath,
      size: nextEntry.size ?? 0,
    };
    if (!previousEntry || previousEntry.kind !== 'file') {
      if (relativePath.startsWith('blocks/')) {
        runtime.logger.log('MEGA readonly share reported new block.', basePayload);
      } else {
        runtime.logger.log('MEGA readonly share reported new file.', basePayload);
      }
      continue;
    }
    runtime.logger.log(
      relativePath.startsWith('blocks/')
        ? 'MEGA readonly share reported updated block.'
        : 'MEGA readonly share reported updated file.',
      {
        ...basePayload,
        previousSize: previousEntry.size ?? 0,
      }
    );
  }
}

export class MegaReadonlyRemoteAdapter implements ProviderRefreshRemoteAdapter {
  private readonly nodesByPath = new Map<string, DecryptedMegaNode>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly apiClient: MegaApiClient,
    private readonly session: MegaSession,
    private readonly tree: DecryptedMegaTree,
    private readonly signal?: AbortSignal
  ) { }

  async list(): Promise<readonly ProviderRefreshRemoteEntry[]> {
    this.nodesByPath.clear();
    const entries: ProviderRefreshRemoteEntry[] = [];
    await visitTree(this.tree, async (relativePath, node) => {
      const normalizedPath = resolveMegaMirrorRelativePath(relativePath);
      if (!normalizedPath) {
        return;
      }
      this.nodesByPath.set(normalizedPath, node);
      entries.push({
        path: normalizedPath,
        kind: node.isFolder ? 'folder' : 'file',
        fingerprint: createNodeFingerprint(node),
        size: node.isFolder ? undefined : node.size,
        handle: node.handle,
        parentHandle: node.parentHandle,
      });
    });
    return entries;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const normalizedPath = normalizeRelativePath(relativePath);
    const node = this.nodesByPath.get(normalizedPath);
    if (!node || node.isFolder) {
      throw new Error(`MEGA mirror entry not found: ${normalizedPath}`);
    }
    return downloadAuthenticatedMegaFileContent(
      this.fetchImpl,
      this.apiClient,
      this.session,
      node.handle,
      node.nodeKey,
      node.size,
      this.signal
    );
  }
}

export function describeMegaSyncFailure(
  error: unknown,
  localPath: string,
  signal?: AbortSignal
): { code: string; summary: string; detail: string } {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const aborted = Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');

  if (aborted) {
    return {
      code: MEGA_SYNC_TIMEOUT_CODE,
      summary: 'MEGA mirror timed out',
      detail:
        'Nearbytes waited too long for MEGA while refreshing this mirror. It stopped this sync attempt and will retry automatically. Open the runtime logs if this keeps happening.',
    };
  }

  if (/ENOENT: no such file or directory/i.test(rawMessage) && rawMessage.includes(localPath)) {
    return {
      code: 'MEGA_LOCAL_MIRROR_CHANGED',
      summary: 'MEGA mirror changed mid-refresh',
      detail:
        'Nearbytes saw the local MEGA mirror change while files were being refreshed. It will retry automatically. Open the runtime logs if the same location keeps failing.',
    };
  }

  if (isMegaRetryableApiError(error)) {
    const code = (error as MegaApiError).code;
    if (code === -3) {
      return {
        code: 'MEGA_API_LOCKED',
        summary: 'MEGA asked Nearbytes to retry',
        detail:
          'MEGA temporarily locked this mirror refresh request. Nearbytes will keep the current local mirror and retry automatically.',
      };
    }
    if (code === -4) {
      return {
        code: 'MEGA_RATE_LIMITED',
        summary: 'MEGA rate limited this refresh',
        detail:
          'MEGA temporarily rate limited this mirror refresh request. Nearbytes will keep the current local mirror and retry automatically.',
      };
    }
  }

  if (isMegaRateLimitedError(error)) {
    return {
      code: 'MEGA_RATE_LIMITED',
      summary: 'MEGA rate limited this refresh',
      detail:
        'MEGA temporarily rate limited this mirror refresh request. Nearbytes will keep the current local mirror and retry automatically.',
    };
  }

  if (/fetch failed/i.test(rawMessage)) {
    return {
      code: 'MEGA_FETCH_FAILED',
      summary: 'MEGA refresh request failed',
      detail:
        'Nearbytes could not complete a MEGA network request while refreshing this mirror. Check connectivity and inspect the runtime logs for the failing request.',
    };
  }

  if (isMegaMissingRequestedRootError(error)) {
    return {
      code: 'MEGA_SHARE_KEY_PENDING',
      summary: 'Waiting for MEGA share key',
      detail:
        'Nearbytes can see this incoming MEGA share, but MEGA has not delivered a usable decryption key for the root yet. Nearbytes will retry automatically.',
    };
  }

  return {
    code: 'MEGA_SYNC_FAILED',
    summary: 'MEGA mirror refresh failed',
    detail: rawMessage,
  };
}

export async function hasUsableMegaMirror(localPath: string): Promise<boolean> {
  try {
    const fs = await getMegaNodeFs();
    const stats = await fs.stat(localPath);
    if (!stats.isDirectory()) {
      return false;
    }
    const entries = await fs.readdir(localPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}