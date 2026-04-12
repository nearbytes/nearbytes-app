import type {
  Auth,
  ChatAttachment,
  IdentityProfile,
  SourceReferenceBundle,
  VolumeChatState,
} from './contracts.js';
import type { DesktopRuntimeLogEntry } from './desktop.js';
import { parseNearbytesDragPayload } from './nearbytesDrag.js';
import type { DesignSystemRuntime } from './runtime.js';
import type {
  AppConfig,
  DiscoveredNearbytesSource,
  IncomingManagedShareOffer,
  IncomingProviderContactInvite,
  LocalNetworkPeer,
  LocalNetworkPeersResponse,
  ManagedShareSummary,
  ProviderAccount,
  ProviderCatalogEntry,
  ProviderSetupState,
  RootsConfig,
  RootsRuntimeSnapshot,
  SourceConfigEntry,
  SourceProvider,
  SourceWatchHandlers,
  StorageLocationRepairReport,
  VolumeDestinationConfig,
  VolumeWatchHandlers,
} from './runtimeContracts.js';

type StudioData = typeof import('../studio-data.js').STUDIO_DATA;
type StudioStateSnapshot = Record<string, unknown>;

type WatchConnection = {
  close(): void;
};

const NOW = 1_744_560_000_000;

export function createStudioDesignRuntime(input: {
  data: StudioData;
  getState: () => StudioStateSnapshot;
}): DesignSystemRuntime {
  const { data, getState } = input;

  function snapshot(): StudioStateSnapshot {
    return getState();
  }

  function activeHub() {
    const nextHubId = String(snapshot().hubId ?? '');
    return data.hubs.find((hub) => hub.id === nextHubId) ?? data.hubs[0];
  }

  function knownVolumes() {
    return data.hubs.map((hub) => ({
      volumeId: hub.id,
      label: hub.name,
    }));
  }

  function volumeDestinations(sourceIds: string[]): VolumeDestinationConfig[] {
    return sourceIds.map((sourceId, index) => ({
      sourceId,
      enabled: true,
      storeEvents: true,
      storeBlocks: true,
      copySourceBlocks: index < 2,
      reservePercent: sourceId === 'src-local' ? 5 : sourceId === 'src-dropbox' ? 8 : 12,
      fullPolicy: 'block-writes',
    }));
  }

  function buildSources(): SourceConfigEntry[] {
    return [
      {
        id: 'src-local',
        provider: 'local',
        path: '/Studio/Nearbytes/Local',
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'block-writes',
      },
      {
        id: 'src-dropbox',
        provider: 'dropbox',
        path: '/Dropbox/Nearbytes',
        enabled: true,
        writable: true,
        reservePercent: 8,
        opportunisticPolicy: 'block-writes',
      },
      {
        id: 'src-mega',
        provider: 'mega',
        path: '/MEGA/Nearbytes',
        enabled: true,
        writable: true,
        reservePercent: 12,
        opportunisticPolicy: 'block-writes',
        integration: {
          kind: 'provider-managed',
          provider: 'mega',
          managedShareId: 'share-mega-studio',
        },
      },
    ];
  }

  function buildRootsConfig(): RootsConfig {
    const sources = buildSources();
    return {
      version: 2,
      sources,
      defaultVolume: {
        destinations: volumeDestinations(['src-local', 'src-dropbox']),
      },
      volumes: data.hubs.map((hub, index) => ({
        volumeId: hub.id,
        destinations: volumeDestinations(index === 0 ? ['src-local', 'src-mega'] : ['src-local', 'src-dropbox']),
      })),
    };
  }

  function usageForHub(hubId: string, scale = 1) {
    const hub = data.hubs.find((candidate) => candidate.id === hubId);
    const fileCount = hub?.files.length ?? 0;
    const eventCount = hub?.timeline.length ?? 0;
    return {
      volumeId: hubId,
      historyBytes: Math.max(48_000, eventCount * 48_000 * scale),
      historyFileCount: Math.max(1, eventCount),
      fileBytes: Math.max(120_000, fileCount * 640_000 * scale),
      fileCount: Math.max(1, fileCount),
    };
  }

  function runtimeStatus(sourceId: string, provider: SourceProvider, path: string, availableBytes: number) {
    const scale = sourceId === 'src-local' ? 1.3 : sourceId === 'src-dropbox' ? 1 : 0.75;
    return {
      id: sourceId,
      kind: 'source' as const,
      provider,
      path,
      enabled: true,
      writable: true,
      reservePercent: sourceId === 'src-local' ? 5 : sourceId === 'src-dropbox' ? 8 : 12,
      opportunisticPolicy: 'block-writes' as const,
      exists: true,
      isDirectory: true,
      canWrite: true,
      availableBytes,
      usage: {
        totalBytes: 0,
        channelBytes: 0,
        blockBytes: 0,
        otherBytes: 0,
        blockCount: 0,
        volumeUsages: data.hubs.map((hub) => usageForHub(hub.id, scale)),
      },
    };
  }

  function buildRuntimeSnapshot(config = buildRootsConfig()): RootsRuntimeSnapshot {
    const sources = config.sources.map((source) => {
      const status =
        source.id === 'src-local'
          ? runtimeStatus(source.id, source.provider, source.path, 214 * 1024 * 1024 * 1024)
          : source.id === 'src-dropbox'
            ? runtimeStatus(source.id, source.provider, source.path, 72 * 1024 * 1024 * 1024)
            : runtimeStatus(source.id, source.provider, source.path, 18 * 1024 * 1024 * 1024);
      status.enabled = source.enabled;
      status.writable = source.writable;
      status.reservePercent = source.reservePercent;
      status.opportunisticPolicy = source.opportunisticPolicy;
      status.path = source.path;
      return status;
    });

    return {
      sources,
      writeFailures: [],
    };
  }

  function buildProviderSetupState(detail: string): ProviderSetupState {
    return {
      status: 'ready',
      detail,
    };
  }

  function buildProviderAccounts(): ProviderAccount[] {
    return [
      {
        id: 'acct-mega',
        provider: 'mega',
        label: 'Studio MEGA',
        email: 'studio@nearbytes.local',
        state: 'connected',
        createdAt: NOW - 10_000,
        updatedAt: NOW,
      },
    ];
  }

  function buildProviderCatalog(): ProviderCatalogEntry[] {
    return [
      {
        provider: 'local-network',
        label: 'Local network',
        description: 'Nearby Nearbytes peers appear automatically.',
        badges: ['Auto'],
        enabled: true,
        isConnected: true,
        connectionState: 'connected',
        setup: buildProviderSetupState('LAN discovery is active in the design runtime.'),
      },
      {
        provider: 'mega',
        label: 'MEGA',
        description: 'Managed incoming and owned shared locations.',
        badges: [],
        enabled: true,
        isConnected: true,
        connectionState: 'connected',
        accountId: 'acct-mega',
        setup: buildProviderSetupState('MEGA is connected in the design runtime.'),
      },
      {
        provider: 'gdrive',
        label: 'Google Drive',
        description: 'Optional cloud mirror locations.',
        badges: ['Optional'],
        enabled: true,
        isConnected: false,
        connectionState: 'available',
        setup: buildProviderSetupState('Google Drive is available for preview.'),
      },
      {
        provider: 'github',
        label: 'GitHub',
        description: 'Repo-backed publishing and mirror preview.',
        badges: ['Repo'],
        enabled: true,
        isConnected: false,
        connectionState: 'available',
        setup: buildProviderSetupState('GitHub is available for preview.'),
      },
    ];
  }

  function buildManagedShares(): ManagedShareSummary[] {
    const currentHub = activeHub();
    return [
      {
        share: {
          id: 'share-mega-studio',
          provider: 'mega',
          accountId: 'acct-mega',
          label: `${currentHub.name} mirror`,
          role: 'owner',
          localPath: '/MEGA/Nearbytes/Studio',
          sourceId: 'src-mega',
          syncMode: 'mirror',
          remoteDescriptor: { accessLevel: 'read/write' },
          capabilities: ['read', 'write'],
          invitationEmails: ['collab@nearbytes.local'],
          createdAt: NOW - 50_000,
          updatedAt: NOW - 1_000,
        },
        attachments: [
          {
            id: 'attach-mega-current',
            shareId: 'share-mega-studio',
            sourceId: 'src-mega',
            volumeId: currentHub.id,
            createdAt: NOW - 45_000,
          },
        ],
        state: {
          status: 'ready',
          detail: 'Local mirror is healthy.',
          badges: ['Mirror'],
          lastSyncAt: NOW - 10_000,
        },
        collaborators: [
          {
            label: 'Ada',
            email: 'ada@nearbytes.local',
            role: 'read/write',
            status: 'active',
            source: 'provider',
          },
        ],
        storage: {
          sourcePath: '/MEGA/Nearbytes/Studio',
          enabled: true,
          writable: true,
          keepFullCopy: true,
          reservePercent: 12,
          availableBytes: 18 * 1024 * 1024 * 1024,
          usageTotalBytes: 2_400_000,
          remoteAvailableBytes: 18 * 1024 * 1024 * 1024,
          remoteTotalBytes: 20 * 1024 * 1024 * 1024,
          remoteUsedBytes: 2 * 1024 * 1024 * 1024,
        },
      },
      {
        share: {
          id: 'share-gdrive-research',
          provider: 'gdrive',
          accountId: 'acct-gdrive',
          label: 'Research incoming',
          role: 'recipient',
          localPath: '/Google Drive/Nearbytes/Research',
          sourceId: 'src-dropbox',
          syncMode: 'mirror',
          remoteDescriptor: { accessLevel: 'read' },
          capabilities: ['read'],
          invitationEmails: [],
          createdAt: NOW - 150_000,
          updatedAt: NOW - 2_000,
        },
        attachments: [
          {
            id: 'attach-gdrive-research',
            shareId: 'share-gdrive-research',
            sourceId: 'src-dropbox',
            volumeId: 'research',
            createdAt: NOW - 140_000,
          },
        ],
        state: {
          status: 'syncing',
          detail: 'Mirror is catching up.',
          badges: ['Incoming'],
          lastSyncAt: NOW - 40_000,
        },
        collaborators: [
          {
            label: 'Research team',
            role: 'read',
            status: 'active',
            source: 'provider',
          },
        ],
        storage: {
          sourcePath: '/Dropbox/Nearbytes',
          enabled: true,
          writable: false,
          keepFullCopy: true,
          reservePercent: 8,
          availableBytes: 72 * 1024 * 1024 * 1024,
          usageTotalBytes: 1_800_000,
        },
      },
    ];
  }

  function buildIncomingManagedShares(): IncomingManagedShareOffer[] {
    return [
      {
        id: 'incoming-mega-1',
        provider: 'mega',
        accountId: 'acct-mega',
        label: 'Incoming storyboard',
        ownerLabel: 'Clarity team',
        detail: 'Writable incoming hub preview.',
        remoteDescriptor: { accessLevel: 'read/write' },
        suggestedLocalPath: '/MEGA/Nearbytes/Incoming Storyboard',
      },
    ];
  }

  function buildIncomingProviderInvites(): IncomingProviderContactInvite[] {
    return [
      {
        id: 'invite-gdrive-1',
        provider: 'gdrive',
        accountId: 'acct-gdrive',
        label: 'Research drive',
        detail: 'Shared storage location is ready to attach.',
      },
    ];
  }

  function buildLocalPeers(): LocalNetworkPeersResponse {
    const peers: LocalNetworkPeer[] = [
      {
        peerId: 'peer-studio-lan',
        label: 'Nearby MacBook',
        address: '192.168.1.21',
        port: 8444,
        endpointUrl: 'https://192.168.1.21:8444',
        capabilities: ['events', 'blocks'],
        volumeIds: ['studio', 'research'],
        firstSeenAt: NOW - 300_000,
        lastSeenAt: NOW - 8_000,
        lastHelloAt: NOW - 8_000,
        lastSyncAt: NOW - 24_000,
        lastSyncStartedAt: NOW - 28_000,
        lastSyncError: null,
        lastSyncNotice: 'Mirror updated',
        lastImportedEvents: 4,
        lastImportedBlocks: 2,
        status: 'ready',
        detail: 'LAN preview peer',
      },
    ];

    return {
      service: {
        protocol: 'nearbytes-lan-v1',
        peerId: 'studio-design-peer',
        label: 'Design runtime',
        listening: true,
        port: 8444,
        discovery: 'dns-sd+multicast-fallback',
        transport: 'webrtc',
        serviceType: '_nearbytes._tcp',
        announceIntervalMs: 5000,
        peerCount: peers.length,
      },
      peers,
    };
  }

  function buildRepairReport(sourceId: string): StorageLocationRepairReport {
    if (sourceId !== 'src-mega') {
      return {
        sourceId,
        path: sourceId === 'src-local' ? '/Studio/Nearbytes/Local' : '/Dropbox/Nearbytes',
        issueCount: 0,
        cleanupCandidateCount: 0,
        issues: [],
      };
    }
    return {
      sourceId,
      path: '/MEGA/Nearbytes',
      issueCount: 1,
      cleanupCandidateCount: 1,
      issues: [
        {
          code: 'invalid-event-file-name',
          severity: 'warn',
          relativePath: 'channels/conflicted-copy',
          absolutePath: '/MEGA/Nearbytes/channels/conflicted-copy',
          detail: 'A provider conflict copy does not match the Nearbytes event naming layout.',
        },
      ],
    };
  }

  function buildDiscoveredSources(): DiscoveredNearbytesSource[] {
    return [
      {
        provider: 'dropbox',
        path: '/Dropbox/Nearbytes/Imported',
        markerFile: '.nearbytes-root',
        autoUpdate: true,
        sourceType: 'marker',
      },
      {
        provider: 'local',
        path: '/Studio/External SSD/Nearbytes',
        markerFile: '.nearbytes-root',
        autoUpdate: false,
        sourceType: 'suggested',
      },
    ];
  }

  function buildLogs(): DesktopRuntimeLogEntry[] {
    const currentHub = activeHub();
    return [
      {
        id: 'runtime-log-main',
        label: 'runtime.log',
        path: '/tmp/nearbytes/runtime.log',
        exists: true,
        size: 1_240,
        updatedAt: NOW - 2_000,
        content: `[info] studio runtime mounted for ${currentHub.name}\n[info] mocked storage snapshot applied\n`,
      },
      {
        id: 'sync-log-main',
        label: 'sync.log',
        path: '/tmp/nearbytes/sync.log',
        exists: true,
        size: 860,
        updatedAt: NOW - 5_000,
        content: '[info] mocked MEGA mirror healthy\n',
      },
    ];
  }

  function buildChatState(): VolumeChatState {
    const currentHub = activeHub();
    const publishedAt = NOW;
    return {
      identities: [
        {
          eventHash: `${currentHub.id}:identity:ada`,
          authorPublicKey: 'ada-public-key',
          publishedAt,
          record: {
            p: 'nb.identity.record.v1',
            k: 'ada-public-key',
            ts: publishedAt,
            profile: {
              displayName: 'Ada',
              bio: 'Current speaking identity',
            },
            sig: 'studio',
          },
        },
        {
          eventHash: `${currentHub.id}:identity:reader`,
          authorPublicKey: 'reader-public-key',
          publishedAt: publishedAt - 12_000,
          record: {
            p: 'nb.identity.record.v1',
            k: 'reader-public-key',
            ts: publishedAt - 12_000,
            profile: {
              displayName: 'Reader',
              bio: 'Read-only publication identity',
            },
            sig: 'studio',
          },
        },
      ],
      messages: currentHub.chat.map((message, index) => {
        const publicKey = message.self ? 'ada-public-key' : 'reader-public-key';
        const timestamp = NOW - (currentHub.chat.length - index) * 240_000;
        return {
          eventHash: `${currentHub.id}:chat:${index}`,
          authorPublicKey: publicKey,
          publishedAt: timestamp,
          message: {
            p: 'nb.chat.message.v1',
            k: `${currentHub.id}:chat:${index}`,
            ts: timestamp,
            body: message.text,
            sig: 'studio',
          },
        };
      }),
      isOffline: true,
    };
  }

  function currentRootsConfigResponse(config = buildRootsConfig()) {
    return {
      configPath: '/studio/mock/roots.json',
      config,
      runtime: buildRuntimeSnapshot(config),
    };
  }

  function emitSourceReady(handlers: SourceWatchHandlers): WatchConnection {
    const timer = setTimeout(() => {
      handlers.onReady?.({
        autoUpdate: true,
        mode: 'none',
        providers: ['local', 'dropbox', 'mega'],
      });
    }, 0);
    return {
      close() {
        clearTimeout(timer);
      },
    };
  }

  function emitVolumeReady(auth: Auth, handlers: VolumeWatchHandlers): WatchConnection {
    const timer = setTimeout(() => {
      handlers.onReady?.({
        volumeId: activeHub().id,
        autoUpdate: true,
        mode: 'none',
        providers: ['local', 'dropbox', 'mega'],
      });
      if (auth) {
        handlers.onUpdate?.({
          volumeId: activeHub().id,
          change: 'change',
          path: `channels/${activeHub().id}/studio-preview`,
          timestamp: NOW,
        });
      }
    }, 0);
    return {
      close() {
        clearTimeout(timer);
      },
    };
  }

  return {
    chat: {
      async listChat() {
        return buildChatState();
      },
      async publishIdentity(_auth: Auth, _identitySecret: string, _profile: IdentityProfile) {
        return;
      },
      async sendChatMessage(
        _auth: Auth,
        _identitySecret: string,
        _input: { body?: string; attachment?: ChatAttachment }
      ) {
        return;
      },
      async exportSourceReferenceBundleFromDrag(_auth: Auth, payloadText: string): Promise<SourceReferenceBundle> {
        const payload = parseNearbytesDragPayload(payloadText);
        if (!payload) {
          throw new Error('Dragged Nearbytes payload is invalid.');
        }
        const hub = activeHub();
        return {
          p: 'nb.src.refs.v1',
          s: hub.id,
          items: payload.filenames.map((filename, index) => ({
            name: filename,
            mime: payload.mimeType || undefined,
            createdAt: NOW - index * 1_000,
            ref: {
              p: 'nb.src.ref.v1',
              s: hub.id,
              c: {
                t: 'b',
                h: `${hub.id}:${filename}:${index}`,
                z: 240_000 + index * 10_000,
              },
              x: `studio-ref-${index}`,
            },
          })),
        };
      },
    },
    storage: {
      async acceptManagedShare(input) {
        const summary = buildManagedShares().find((entry) => entry.share.provider === input.provider) ?? buildManagedShares()[0];
        return { summary };
      },
      async acceptIncomingProviderContactInvite() {
        return;
      },
      async attachManagedShare(shareId, volumeId) {
        const summary = buildManagedShares().find((entry) => entry.share.id === shareId) ?? buildManagedShares()[0];
        return {
          summary: {
            ...summary,
            attachments: [
              ...summary.attachments,
              {
                id: `${shareId}:${volumeId}`,
                shareId,
                sourceId: summary.share.sourceId ?? 'src-local',
                volumeId,
                createdAt: NOW,
              },
            ],
          },
        };
      },
      async chooseDirectoryPath(initialPath = '') {
        return initialPath || '/Studio/Chosen Folder';
      },
      async configureProviderSetup(_provider, _input) {
        return {
          setup: buildProviderSetupState('Studio setup saved locally.'),
        };
      },
      async connectProviderAccount(input) {
        const provider = input.provider;
        return {
          status: 'connected' as const,
          account: {
            id: `acct-${provider}`,
            provider,
            label: `${provider} studio`,
            email: `studio+${provider}@nearbytes.local`,
            state: 'connected',
            createdAt: NOW,
            updatedAt: NOW,
          },
        };
      },
      async createManagedShare(input) {
        const summary = buildManagedShares()[0];
        return {
          summary: {
            ...summary,
            share: {
              ...summary.share,
              id: `share-${input.provider}-studio`,
              provider: input.provider,
              accountId: input.accountId,
              label: input.label,
              localPath: input.localPath ?? summary.share.localPath,
              role: input.role ?? 'owner',
              remoteDescriptor: input.remoteDescriptor ?? summary.share.remoteDescriptor,
              capabilities: input.capabilities ?? summary.share.capabilities,
            },
          },
        };
      },
      async consolidateRoot(sourceId, targetId) {
        const config = buildRootsConfig();
        return {
          ...currentRootsConfigResponse({
            ...config,
            sources: config.sources.filter((source) => source.id !== sourceId),
          }),
          result: {
            sourceId,
            targetId,
            movedFiles: 3,
            renamedFiles: 0,
            copiedFiles: 3,
            removedSourceFiles: 3,
            skippedExisting: 0,
            bytesTransferred: 3_200_000,
            sameDevice: false,
          },
        };
      },
      async disconnectProviderAccount() {
        return;
      },
      async discoverSources() {
        const sources = buildDiscoveredSources();
        return {
          scannedAt: NOW,
          sourceCount: sources.length,
          sources,
        };
      },
      async getAppConfig() {
        const config: AppConfig = {
          version: 1,
          features: {
            providers: {
              googleDrive: true,
              mega: true,
              github: true,
              localNetwork: true,
            },
            performance: {
              appMetrics: true,
            },
          },
        };
        return { config };
      },
      async readDesktopRuntimeLogs() {
        return {
          generatedAt: NOW,
          entries: buildLogs(),
        };
      },
      async getManagedShareState(shareId) {
        const summary = buildManagedShares().find((entry) => entry.share.id === shareId) ?? buildManagedShares()[0];
        return { summary };
      },
      async getStorageLocationRepairReport(sourceId) {
        return {
          report: buildRepairReport(sourceId),
        };
      },
      async getRootsConfig() {
        return currentRootsConfigResponse();
      },
      hasDesktopDirectoryPicker() {
        return true;
      },
      async installProviderHelper() {
        return {
          setup: buildProviderSetupState('Studio helper install completed instantly.'),
        };
      },
      async inviteManagedShare(shareId) {
        const summary = buildManagedShares().find((entry) => entry.share.id === shareId) ?? buildManagedShares()[0];
        return { summary };
      },
      async listLocalNetworkPeers() {
        return buildLocalPeers();
      },
      async listIncomingManagedShares() {
        return {
          shares: buildIncomingManagedShares(),
        };
      },
      async listIncomingProviderContactInvites() {
        return {
          invites: buildIncomingProviderInvites(),
        };
      },
      async listManagedShares() {
        return {
          shares: buildManagedShares(),
        };
      },
      async listProviderAccounts() {
        return {
          accounts: buildProviderAccounts(),
          providers: buildProviderCatalog(),
          preferredProviders: ['mega', 'local-network'],
        };
      },
      async syncLocalNetworkPeer(peerId) {
        const peer = buildLocalPeers().peers.find((entry) => entry.peerId === peerId) ?? buildLocalPeers().peers[0];
        return { peer };
      },
      async updateProviderEnabled() {
        const config: AppConfig = {
          version: 1,
          features: {
            providers: {
              googleDrive: true,
              mega: true,
              github: true,
              localNetwork: true,
            },
            performance: {
              appMetrics: true,
            },
          },
        };
        return { config };
      },
      async openPathInFileManager() {
        return;
      },
      async openRootInFileManager() {
        return;
      },
      async readMirrorLocalNetworkPeers() {
        return buildLocalPeers();
      },
      async repairStorageLocation(sourceId, action) {
        return {
          result: {
            sourceId,
            removedCount: buildRepairReport(sourceId).cleanupCandidateCount,
            issueCount: buildRepairReport(sourceId).issueCount,
            cleanupCandidateCount: buildRepairReport(sourceId).cleanupCandidateCount,
            action,
          },
          report: {
            ...buildRepairReport(sourceId),
            issueCount: 0,
            cleanupCandidateCount: 0,
            issues: [],
          },
        };
      },
      async removeManagedShare() {
        return;
      },
      watchSources(handlers) {
        return emitSourceReady(handlers);
      },
      async updateRootsConfig(config) {
        return currentRootsConfigResponse(config);
      },
    },
    flow: {
      async getRootsConfig() {
        return currentRootsConfigResponse();
      },
      watchSources(handlers) {
        return emitSourceReady(handlers);
      },
      watchVolume(auth, handlers) {
        return emitVolumeReady(auth, handlers);
      },
      async getTimeline() {
        return {
          eventCount: activeHub().timeline.length,
        };
      },
    },
  };
}
