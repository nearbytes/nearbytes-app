import { Buffer } from 'buffer';
import type { MegaKeyManagerRecord } from './core.js';
import type { MegaFetchNodesSnapshot } from './protocol.js';
import type { ProviderRefreshManifestEntry } from '../providerRefreshWorker.js';

export interface MegaShareInviteTarget {
  readonly u: string;
  readonly e?: string;
}

export interface MegaAdapterOptions {
  readonly fetchImpl?: typeof fetch;
}

export interface MegaMirrorManifest {
  readonly rootHandle?: string;
  readonly lastScsn?: string;
  readonly knownHandles?: readonly string[];
  readonly unsupportedTopLevelNames?: readonly string[];
  readonly entries: Record<string, ProviderRefreshManifestEntry>;
}

export interface MegaRecipientProbeContext {
  readonly source: 'sc' | 'sync';
  readonly rootHandle: string;
  readonly triggerHandle: string;
  readonly packetReceivedAt: number;
  readonly scsn?: string;
  readonly fetchStartedAt?: number;
  readonly fetchCompletedAt?: number;
}

export interface MegaFetchedTree {
  readonly snapshot: MegaFetchNodesSnapshot;
  readonly tree: DecryptedMegaTree;
}

export interface DecryptedMegaNode {
  readonly handle: string;
  readonly parentHandle?: string;
  readonly nodeType: number;
  readonly isFolder: boolean;
  readonly size: number;
  readonly name: string;
  readonly modifiedAt?: number;
  readonly nodeKey: Buffer;
  readonly encodedKey?: string;
  readonly encodedAttributes?: string;
  readonly ownerHandle?: string;
  readonly ownerEmail?: string;
  readonly accessLevel?: string;
  readonly shareHandle?: string;
}

export interface DecryptedMegaTree {
  readonly root: DecryptedMegaNode;
  readonly nodesByHandle: ReadonlyMap<string, DecryptedMegaNode>;
  readonly childrenByParent: ReadonlyMap<string, readonly DecryptedMegaNode[]>;
}

export interface MegaDecryptTreeOptions {
  readonly expectedRootHandle?: string;
  readonly expectedRootName?: string;
}

export interface MegaKeyManagerState {
  readonly shareKeys: ReadonlyMap<string, Buffer>;
  readonly pendingInShares: ReadonlyMap<string, MegaPendingInShareRecord>;
  readonly authRingEd25519: ReadonlyMap<string, number>;
  readonly privateCu25519?: Buffer;
  readonly records: readonly MegaKeyManagerRecord[];
}

export interface MegaPendingInShareRecord {
  readonly ownerHandle: string;
  readonly encryptedShareKey: Buffer;
}

export interface MegaOwnerRemoteRoot {
  readonly path: string;
  readonly root: DecryptedMegaNode;
  readonly tree: DecryptedMegaTree;
  readonly scsn?: string;
}

export interface MegaShareCryptoContext {
  readonly shareHandle: string;
  readonly shareKey: Buffer;
}

export interface MegaKnownRemoteFile {
  readonly handle: string;
  readonly size: number;
}

export interface MegaOwnerUploadState {
  root: MegaOwnerRemoteRoot;
  readonly shareCrypto: MegaShareCryptoContext | undefined;
  readonly extraShareKeys: ReadonlyMap<string, Buffer> | undefined;
  readonly folderHandlesByPath: Map<string, string>;
  readonly filesByPath: Map<string, MegaKnownRemoteFile>;
}

export interface MegaOwnerSyncResult {
  readonly uploaded: string[];
  readonly downloaded: string[];
  readonly skipped: string[];
}

export interface MegaIncomingShareDiscoveryDiag {
  readonly nodesWithSharingUser: number;
  readonly skippedExplicitFile: number;
  readonly skippedNoDecrypt: number;
  readonly skippedShareHandleMismatch: number;
  readonly provisionalOfferCount: number;
  readonly offerCount: number;
  readonly skippedNoDecryptSample: ReadonlyArray<{
    handle: string;
    ownerHandle?: string;
    parentHandle?: string;
    hasShareKey: boolean;
    nodeKeyOwners: string;
    matchedKeyOwners: string;
    hasSk: boolean;
  }>;
}