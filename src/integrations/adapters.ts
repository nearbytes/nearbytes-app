import { isProviderEnabled } from '../config/appConfig.js';
import { GoogleDriveTransportAdapter } from './googleDrive.js';
import { GitHubTransportAdapter } from './github.js';
import { MegaTransportAdapter } from './mega.js';
import type { IntegrationRuntime } from './runtime.js';
import type {
  AcceptManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  IncomingManagedShareOffer,
  IncomingProviderContactInvite,
  ManagedShareCollaborator,
  InviteManagedShareInput,
  ManagedShare,
  ProviderAccount,
  ProviderCatalogEntry,
  ProviderSetupState,
  ShareStorageMetrics,
  TransportEndpoint,
  TransportState,
} from './types.js';

export interface MirrorRemoteEntry {
  readonly path: string;
  readonly size: number;
}

export interface ManagedShareMirrorEntry {
  readonly label: string;
  readonly localPath: string;
  readonly remotePath: string;
}

export interface ManagedShareRemoteEntryProbe {
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly size?: number;
  readonly handle?: string;
  readonly modifiedAt?: string;
}

export interface ProviderShareInventoryDebugEntry {
  readonly shareHandle: string;
  readonly rootHandle?: string;
  readonly ownerEmail?: string;
  readonly label: string;
}

export interface MirrorRemoteAdapter {
  list(): Promise<readonly MirrorRemoteEntry[]>;
  download(path: string): Promise<Uint8Array>;
  upload(path: string, data: Uint8Array): Promise<void>;
  /**
   * When true, replaces remote files when a path exists remotely but the stored size differs from local
   * (MEGA owner writable mirror). Other mirrors keep the legacy behavior (skip if path exists).
   */
  reconcileUploadsByRemoteSize?(): boolean;
}

export interface TransportAdapter {
  readonly provider: string;
  readonly label: string;
  readonly description: string;
  readonly supportsAccountConnection: boolean;
  dispose?(): Promise<void>;
  getSetupState?(): Promise<ProviderSetupState>;
  configure?(input: ConfigureProviderInput): Promise<ProviderSetupState>;
  install?(): Promise<ProviderSetupState>;
  probe(endpoint: TransportEndpoint): Promise<TransportState>;
  connect?(
    input: ConnectProviderAccountInput,
    context?: { callbackBaseUrl?: string }
  ): Promise<ConnectProviderAccountResult>;
  handleOAuthCallback?(query: URLSearchParams): Promise<string>;
  disconnect?(account: ProviderAccount): Promise<void>;
  createManagedShare?(input: CreateManagedShareInput, account: ProviderAccount): Promise<Partial<ManagedShare>>;
  invite?(share: ManagedShare, input: InviteManagedShareInput, account: ProviderAccount): Promise<void>;
  acceptInvite?(input: AcceptManagedShareInput, account: ProviderAccount): Promise<Partial<ManagedShare>>;
  listIncomingShares?(account: ProviderAccount): Promise<IncomingManagedShareOffer[]>;
  listManagedShareMirrors?(account: ProviderAccount): Promise<ManagedShareMirrorEntry[]>;
  listIncomingContactInvites?(account: ProviderAccount): Promise<IncomingProviderContactInvite[]>;
  acceptIncomingContactInvite?(account: ProviderAccount, inviteId: string): Promise<void>;
  getState?(share: ManagedShare, account: ProviderAccount | null): Promise<TransportState>;
  getCollaborators?(share: ManagedShare, account: ProviderAccount | null): Promise<ManagedShareCollaborator[]>;
  getShareStorageMetrics?(share: ManagedShare, account: ProviderAccount | null): Promise<ShareStorageMetrics | undefined>;
  ensureSync?(share: ManagedShare, account: ProviderAccount): Promise<void>;
  detachManagedShare?(share: ManagedShare, account: ProviderAccount | null): Promise<void>;
  probeManagedShareRemoteEntry?(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<ManagedShareRemoteEntryProbe | null>;
  forceManagedShareUpload?(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<void>;
  getShareInventoryDebug?(account: ProviderAccount): Promise<{
    incoming: ProviderShareInventoryDebugEntry[];
    outgoing: ProviderShareInventoryDebugEntry[];
  }>;
}

export function createDefaultTransportAdapters(runtime: IntegrationRuntime): TransportAdapter[] {
  const adapters: TransportAdapter[] = [];
  if (isProviderEnabled('gdrive')) {
    adapters.push(new GoogleDriveTransportAdapter(runtime));
  }
  if (isProviderEnabled('mega')) {
    adapters.push(new MegaTransportAdapter(runtime));
  }
  if (isProviderEnabled('github')) {
    adapters.push(new GitHubTransportAdapter(runtime));
  }
  return adapters;
}

export function createProviderCatalog(
  adapters: readonly TransportAdapter[],
  accounts: readonly ProviderAccount[],
  setupStates: ReadonlyMap<string, ProviderSetupState>
): ProviderCatalogEntry[] {
  const accountByProvider = new Map<string, ProviderAccount>();
  for (const account of accounts) {
    const key = account.provider.trim().toLowerCase();
    if (!accountByProvider.has(key)) {
      accountByProvider.set(key, account);
    }
  }

  return adapters.map((adapter) => {
    const account = accountByProvider.get(adapter.provider);
    const isActiveAccount = account?.state === 'connected' || account?.state === 'attention';
    return {
      provider: adapter.provider,
      label: adapter.label,
      description: adapter.description,
      badges: account
        ? []
        : adapter.provider === 'gdrive'
          ? ['OAuth']
          : adapter.provider === 'mega'
            ? ['Native']
            : adapter.provider === 'github'
              ? ['Device flow']
              : ['Available'],
      isConnected: isActiveAccount,
      connectionState:
        isActiveAccount ? 'connected' : adapter.supportsAccountConnection ? 'available' : 'setup',
      accountId: account?.id,
      setup:
        setupStates.get(adapter.provider) ?? {
          status: 'ready',
          detail: adapter.description,
        },
    } satisfies ProviderCatalogEntry;
  });
}
