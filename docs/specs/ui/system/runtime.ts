import { getContext, setContext } from 'svelte';
import type { Auth, ChatAttachment, IdentityProfile, SourceReferenceBundle, VolumeChatState } from './contracts.js';
import type { DesktopRuntimeLogEntry } from './desktop.js';
import type {
  AppConfig,
  DiscoveredNearbytesSource,
  IncomingManagedShareOffer,
  IncomingProviderContactInvite,
  LocalNetworkPeer,
  LocalNetworkPeersResponse,
  ManagedShare,
  ManagedShareSummary,
  ProviderAccount,
  ProviderAuthSession,
  ProviderCatalogEntry,
  ProviderSetupState,
  ReconcileSourcesResponse,
  RootsConfig,
  RootsRuntimeSnapshot,
  SourceWatchHandlers,
  StorageLocationRepairReport,
  StorageLocationRepairResult,
  VolumeWatchConnection,
  VolumeWatchHandlers,
} from './runtimeContracts.js';

const DESIGN_RUNTIME_CONTEXT = Symbol('nearbytes-design-runtime');

export interface VolumeChatRuntime {
  listChat(auth: Auth): Promise<VolumeChatState>;
  publishIdentity(auth: Auth, identitySecret: string, profile: IdentityProfile): Promise<void>;
  sendChatMessage(
    auth: Auth,
    identitySecret: string,
    input: { body?: string; attachment?: ChatAttachment }
  ): Promise<void>;
  exportSourceReferenceBundleFromDrag(auth: Auth, payloadText: string): Promise<SourceReferenceBundle>;
}

export interface StoragePanelRuntime {
  acceptManagedShare(input: {
    provider: string;
    accountId: string;
    label: string;
    volumeId?: string;
    localPath?: string;
    remoteDescriptor?: Record<string, unknown>;
    capabilities?: string[];
  }): Promise<{ summary: ManagedShareSummary }>;
  acceptIncomingProviderContactInvite(input: {
    provider: string;
    accountId: string;
    inviteId: string;
  }): Promise<void>;
  attachManagedShare(shareId: string, volumeId: string): Promise<{ summary: ManagedShareSummary }>;
  chooseDirectoryPath(initialPath?: string): Promise<string | null>;
  configureProviderSetup(
    provider: string,
    input: {
      clientId?: string;
      clientSecret?: string;
    }
  ): Promise<{ setup: ProviderSetupState }>;
  connectProviderAccount(
    input: {
      provider: string;
      mode?: 'login' | 'signup' | 'confirm-signup';
      label?: string;
      email?: string;
      preferred?: boolean;
      authSessionId?: string;
      credentials?: {
        name?: string;
        email?: string;
        password?: string;
        mfaCode?: string;
        confirmationLink?: string;
      };
    },
    options?: { signal?: AbortSignal }
  ): Promise<{
    status: 'connected' | 'pending' | 'failed';
    account?: ProviderAccount;
    authSession?: ProviderAuthSession;
  }>;
  createManagedShare(input: {
    provider: string;
    accountId: string;
    label: string;
    localPath?: string;
    role?: ManagedShare['role'];
    volumeId?: string;
    remoteDescriptor?: Record<string, unknown>;
    capabilities?: string[];
  }): Promise<{ summary: ManagedShareSummary }>;
  consolidateRoot(
    sourceId: string,
    targetId: string
  ): Promise<{
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
    result: {
      sourceId: string;
      targetId: string;
      movedFiles: number;
      renamedFiles: number;
      copiedFiles: number;
      removedSourceFiles: number;
      skippedExisting: number;
      bytesTransferred: number;
      sameDevice: boolean;
    };
  }>;
  disconnectProviderAccount(accountId: string): Promise<void>;
  discoverSources(params?: {
    maxDepth?: number;
    maxDirectories?: number;
  }): Promise<{
    scannedAt: number;
    sourceCount: number;
    sources: DiscoveredNearbytesSource[];
  }>;
  getAppConfig(options?: { signal?: AbortSignal }): Promise<{ config: AppConfig }>;
  readDesktopRuntimeLogs(): Promise<{ generatedAt: number; entries: DesktopRuntimeLogEntry[] } | null>;
  getManagedShareState(shareId: string): Promise<{ summary: ManagedShareSummary }>;
  getStorageLocationRepairReport(sourceId: string): Promise<{ report: StorageLocationRepairReport }>;
  getRootsConfig(options?: { signal?: AbortSignal; includeUsage?: boolean }): Promise<{
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
  }>;
  hasDesktopDirectoryPicker(): boolean;
  installProviderHelper(
    provider: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ setup: ProviderSetupState }>;
  inviteManagedShare(
    shareId: string,
    emails: string[],
    accessLevel?: 'read' | 'read/write' | 'full access'
  ): Promise<{ summary: ManagedShareSummary }>;
  listLocalNetworkPeers(options?: { signal?: AbortSignal }): Promise<LocalNetworkPeersResponse>;
  listIncomingManagedShares(options?: { signal?: AbortSignal; fast?: boolean }): Promise<{ shares: IncomingManagedShareOffer[] }>;
  listIncomingProviderContactInvites(
    options?: { signal?: AbortSignal; fast?: boolean }
  ): Promise<{ invites: IncomingProviderContactInvite[] }>;
  listManagedShares(options?: { signal?: AbortSignal; fast?: boolean }): Promise<{ shares: ManagedShareSummary[] }>;
  listProviderAccounts(
    options?: { signal?: AbortSignal; fast?: boolean }
  ): Promise<{ accounts: ProviderAccount[]; providers: ProviderCatalogEntry[]; preferredProviders: string[] }>;
  syncLocalNetworkPeer(peerId: string, options?: { signal?: AbortSignal }): Promise<{ peer: LocalNetworkPeer }>;
  updateProviderEnabled(provider: string, enabled: boolean): Promise<{ config: AppConfig }>;
  openPathInFileManager(targetPath: string): Promise<void>;
  openRootInFileManager(rootId: string): Promise<void>;
  readMirrorLocalNetworkPeers(): Promise<LocalNetworkPeersResponse | null>;
  repairStorageLocation(
    sourceId: string,
    action: 'trash' | 'delete'
  ): Promise<{ result: StorageLocationRepairResult; report: StorageLocationRepairReport }>;
  removeManagedShare(shareId: string): Promise<void>;
  watchSources(handlers: SourceWatchHandlers): VolumeWatchConnection;
  updateRootsConfig(config: RootsConfig): Promise<{
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
  }>;
}

export interface EventFlowRuntime {
  getRootsConfig(options?: { signal?: AbortSignal; includeUsage?: boolean }): Promise<{
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
  }>;
  watchSources(handlers: SourceWatchHandlers): VolumeWatchConnection;
  watchVolume(auth: Auth, handlers: VolumeWatchHandlers): VolumeWatchConnection;
  getTimeline(auth: Auth): Promise<{ eventCount: number }>;
}

export interface DesignSystemRuntime {
  chat: VolumeChatRuntime;
  storage: StoragePanelRuntime;
  flow: EventFlowRuntime;
}

function missingRuntime(method: string): never {
  throw new Error(`Design runtime is not configured for ${method}.`);
}

function createMissingRuntime(): DesignSystemRuntime {
  return {
    chat: {
      async listChat() {
        return missingRuntime('chat.listChat');
      },
      async publishIdentity() {
        return missingRuntime('chat.publishIdentity');
      },
      async sendChatMessage() {
        return missingRuntime('chat.sendChatMessage');
      },
      async exportSourceReferenceBundleFromDrag() {
        return missingRuntime('chat.exportSourceReferenceBundleFromDrag');
      },
    },
    storage: {
      async acceptManagedShare() {
        return missingRuntime('storage.acceptManagedShare');
      },
      async acceptIncomingProviderContactInvite() {
        return missingRuntime('storage.acceptIncomingProviderContactInvite');
      },
      async attachManagedShare() {
        return missingRuntime('storage.attachManagedShare');
      },
      async chooseDirectoryPath() {
        return missingRuntime('storage.chooseDirectoryPath');
      },
      async configureProviderSetup() {
        return missingRuntime('storage.configureProviderSetup');
      },
      async connectProviderAccount() {
        return missingRuntime('storage.connectProviderAccount');
      },
      async createManagedShare() {
        return missingRuntime('storage.createManagedShare');
      },
      async consolidateRoot() {
        return missingRuntime('storage.consolidateRoot');
      },
      async disconnectProviderAccount() {
        return missingRuntime('storage.disconnectProviderAccount');
      },
      async discoverSources() {
        return missingRuntime('storage.discoverSources');
      },
      async getAppConfig() {
        return missingRuntime('storage.getAppConfig');
      },
      async readDesktopRuntimeLogs() {
        return missingRuntime('storage.readDesktopRuntimeLogs');
      },
      async getManagedShareState() {
        return missingRuntime('storage.getManagedShareState');
      },
      async getStorageLocationRepairReport() {
        return missingRuntime('storage.getStorageLocationRepairReport');
      },
      async getRootsConfig() {
        return missingRuntime('storage.getRootsConfig');
      },
      hasDesktopDirectoryPicker() {
        return missingRuntime('storage.hasDesktopDirectoryPicker');
      },
      async installProviderHelper() {
        return missingRuntime('storage.installProviderHelper');
      },
      async inviteManagedShare() {
        return missingRuntime('storage.inviteManagedShare');
      },
      async listLocalNetworkPeers() {
        return missingRuntime('storage.listLocalNetworkPeers');
      },
      async listIncomingManagedShares() {
        return missingRuntime('storage.listIncomingManagedShares');
      },
      async listIncomingProviderContactInvites() {
        return missingRuntime('storage.listIncomingProviderContactInvites');
      },
      async listManagedShares() {
        return missingRuntime('storage.listManagedShares');
      },
      async listProviderAccounts() {
        return missingRuntime('storage.listProviderAccounts');
      },
      async syncLocalNetworkPeer() {
        return missingRuntime('storage.syncLocalNetworkPeer');
      },
      async updateProviderEnabled() {
        return missingRuntime('storage.updateProviderEnabled');
      },
      async openPathInFileManager() {
        return missingRuntime('storage.openPathInFileManager');
      },
      async openRootInFileManager() {
        return missingRuntime('storage.openRootInFileManager');
      },
      async readMirrorLocalNetworkPeers() {
        return missingRuntime('storage.readMirrorLocalNetworkPeers');
      },
      async repairStorageLocation() {
        return missingRuntime('storage.repairStorageLocation');
      },
      async removeManagedShare() {
        return missingRuntime('storage.removeManagedShare');
      },
      watchSources() {
        return missingRuntime('storage.watchSources');
      },
      async updateRootsConfig() {
        return missingRuntime('storage.updateRootsConfig');
      },
    },
    flow: {
      async getRootsConfig() {
        return missingRuntime('flow.getRootsConfig');
      },
      watchSources() {
        return missingRuntime('flow.watchSources');
      },
      watchVolume() {
        return missingRuntime('flow.watchVolume');
      },
      async getTimeline() {
        return missingRuntime('flow.getTimeline');
      },
    },
  };
}

export function setDesignRuntimeContext(runtime: DesignSystemRuntime): DesignSystemRuntime {
  return setContext(DESIGN_RUNTIME_CONTEXT, runtime);
}

export function getDesignRuntimeContext(): DesignSystemRuntime {
  return getContext<DesignSystemRuntime>(DESIGN_RUNTIME_CONTEXT) ?? createMissingRuntime();
}
