import { promises as fs, type Dirent } from 'fs';
import path from 'path';
import { isProviderEnabled } from '../config/appConfig.js';
import {
  getExplicitVolumePolicy,
  saveRootsConfig,
  type RootProvider,
  type RootsConfig,
  type SourceConfigEntry,
  type VolumeDestinationConfig,
} from '../config/roots.js';
import { ensureNearbytesMarkers, inspectNearbytesRoot, normalizeNearbytesRoot } from '../config/sourceDiscovery.js';
import { joinLinkSpaceToSecretString, parseJoinLink, parseJoinLinkJson } from '../domain/joinLinkCodec.js';
import { MultiRootStorageBackend } from '../storage/multiRoot.js';
import type { MultiRootRuntimeSnapshot } from '../storage/multiRoot.js';
import { getDefaultStorageDir, getDefaultStorageHomeDir, getProviderStorageFolderName, resolveStorageHomeDir } from '../storagePath.js';
import {
  createDefaultTransportAdapters,
  createProviderCatalog,
  type ManagedShareMirrorEntry,
  type TransportAdapter,
} from './adapters.js';
import { createPlannerContext, endpointMatchKey, planJoinLink } from './planner.js';
import { JsonFileSecretStore } from './secretStore.js';
import { createIntegrationRuntime, type IntegrationRuntime, type IntegrationRuntimeOptions } from './runtime.js';
import {
  loadIntegrationState,
  resolveIntegrationStatePath,
  saveIntegrationState,
  type IntegrationMaintenanceSnapshot,
  type IntegrationStateSnapshot,
} from './store.js';
import type {
  AcceptManagedShareInput,
  AttachManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  IncomingManagedShareOffer,
  IncomingProviderContactInvite,
  JoinLink,
  JoinLinkPlan,
  JoinLinkSpace,
  ManagedShare,
  ManagedShareAttachment,
  ManagedShareCollaborator,
  ManagedShareSummary,
  ProviderAccount,
  ProviderCatalogEntry,
  ProviderSetupState,
  ShareStorageMetrics,
  TransportState,
} from './types.js';

const DEFAULT_DESTINATION: VolumeDestinationConfig = {
  sourceId: '',
  enabled: true,
  storeEvents: true,
  storeBlocks: true,
  copySourceBlocks: true,
  reservePercent: 5,
  fullPolicy: 'block-writes',
};

const MEGA_BASE_SHARE_FOLDER_NAME = 'nearbytes';
const BACKGROUND_MAINTENANCE_SCHEMA_VERSION = 1;
const BACKGROUND_MAINTENANCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAST_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS = 750;
const FULL_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS = 6_000;
const FULL_MEGA_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS = 5_000;
const FAST_MANAGED_SHARE_SUMMARY_TIMEOUT_MS = 2_000;
const FULL_MANAGED_SHARE_SUMMARY_TIMEOUT_MS = FULL_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS + 1_000;

export class ManagedShareServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ManagedShareServiceError';
  }
}

export interface ManagedShareServiceOptions {
  readonly storage: MultiRootStorageBackend;
  readonly rootsConfigPath: string;
  readonly integrationStatePath?: string;
  readonly mirrorRoot?: string;
  readonly adapters?: readonly TransportAdapter[];
  readonly runtime?: Partial<IntegrationRuntimeOptions>;
  readonly readMaintenanceMode?: 'background' | 'inline';
}

interface IntegrationReadOptions {
  readonly fast?: boolean;
}

export class ManagedShareService {
  private readonly adapters: Map<string, TransportAdapter>;
  private readonly integrationStatePath: string;
  private readonly mirrorRoot: string;
  private readonly runtime: IntegrationRuntime;
  private readonly readMaintenanceMode: 'background' | 'inline';
  private readonly syncBootstrapTasks = new Map<string, Promise<void>>();
  private readonly autoRepairCooldowns = new Map<string, number>();
  private readonly pendingMarkerRefreshes = new Set<string>();
  private maintenanceRequested = false;
  private maintenanceTask: Promise<void> | null = null;

  constructor(private readonly options: ManagedShareServiceOptions) {
    this.runtime = createIntegrationRuntime({
      ...options.runtime,
      secretStore:
        options.runtime?.secretStore ??
        new JsonFileSecretStore({
          filePath: path.join(path.dirname(options.rootsConfigPath), 'integration-secrets.json'),
        }),
    });
    this.adapters = new Map(
      (options.adapters ?? createDefaultTransportAdapters(this.runtime)).map((adapter) => [adapter.provider, adapter])
    );
    this.integrationStatePath = resolveIntegrationStatePath(
      options.integrationStatePath ?? path.join(path.dirname(options.rootsConfigPath), 'integrations.json')
    );
    this.mirrorRoot = path.resolve(options.mirrorRoot ?? resolveManagedShareBaseRoot(options.storage.getRootsConfig()));
    this.readMaintenanceMode = options.readMaintenanceMode ?? 'inline';
  }

  async dispose(): Promise<void> {
    this.maintenanceRequested = false;
    await Promise.all(
      Array.from(this.adapters.values(), async (adapter) => {
        await adapter.dispose?.();
      })
    );
  }

  async warmupBackgroundActivity(reason = 'startup'): Promise<void> {
    const state = await this.loadState();
    this.runtime.logger.log('Managed share provider warmup started.', {
      reason,
      accounts: state.accounts.map((account) => ({
        id: account.id,
        provider: normalizeProvider(account.provider),
        state: account.state,
      })),
      managedShareCount: state.managedShares.length,
    });
    this.scheduleManagedShareSyncs(state);
    if (this.readMaintenanceMode === 'background') {
      this.requestBackgroundMaintenance(reason, state);
    }
  }

  private isOperationalAccount(account: ProviderAccount): boolean {
    return account.state === 'connected';
  }

  private isMegaHelperOperationalAccount(account: ProviderAccount): boolean {
    const provider = normalizeProvider(account.provider);
    return provider === 'mega' && (account.state === 'connected' || account.state === 'attention');
  }

  private canSyncManagedShare(share: ManagedShare, account: ProviderAccount): boolean {
    if (normalizeProvider(share.provider) === 'mega' && share.role === 'owner') {
      return this.isMegaHelperOperationalAccount(account);
    }
    return this.isOperationalAccount(account);
  }

  private presentationAccount(account: ProviderAccount): ProviderAccount {
    return account;
  }

  async listAccounts(options: IntegrationReadOptions = {}): Promise<{
    accounts: ProviderAccount[];
    providers: ProviderCatalogEntry[];
    preferredProviders: string[];
  }> {
    const state = await this.loadState();
    if (this.readMaintenanceMode === 'inline') {
      const preparedState = await this.withSoftTimeout(
        (async () => {
          const repairedState = await this.repairManagedShareState(state);
          await this.ensureDefaultManagedShares(repairedState, { createMissing: true });
          return this.loadState();
        })(),
        state,
        2_500,
        'Provider account refresh timed out; using the last known provider state.'
      );
      this.scheduleManagedShareSyncs(preparedState);
      const setupStates = await this.getProviderSetupStates();
      const accounts = preparedState.accounts
        .filter((account) => isProviderEnabled(account.provider))
        .map((account) => this.presentationAccount(account));
      return {
        accounts,
        providers: createProviderCatalog(Array.from(this.adapters.values()), accounts, setupStates),
        preferredProviders: preparedState.preferredProviders.filter((provider) => isProviderEnabled(provider)),
      };
    }
    if (options.fast !== true) {
      this.requestBackgroundMaintenance('listAccounts', state);
      this.scheduleManagedShareSyncs(state);
    }
    const setupStates = options.fast
      ? this.fallbackProviderSetupStates()
      : await this.withSoftTimeout(
          this.getProviderSetupStates(),
          this.fallbackProviderSetupStates(),
          500,
          'Provider setup discovery timed out; using the last known provider setup state.'
        );
    const accounts = state.accounts
      .filter((account) => isProviderEnabled(account.provider))
      .map((account) => this.presentationAccount(account));
    return {
      accounts,
      providers: createProviderCatalog(Array.from(this.adapters.values()), accounts, setupStates),
      preferredProviders: state.preferredProviders.filter((provider) => isProviderEnabled(provider)),
    };
  }

  async configureProvider(input: ConfigureProviderInput): Promise<ProviderSetupState> {
    const provider = normalizeProvider(input.provider);
    const adapter = this.adapters.get(provider);
    if (!adapter?.configure) {
      throw new ManagedShareServiceError(501, 'NOT_IMPLEMENTED', `Provider setup is not supported for ${provider}`);
    }
    return adapter.configure({
      ...input,
      provider,
    });
  }

  async installProvider(providerInput: string): Promise<ProviderSetupState> {
    const provider = normalizeProvider(providerInput);
    const adapter = this.adapters.get(provider);
    if (!adapter?.install) {
      throw new ManagedShareServiceError(501, 'NOT_IMPLEMENTED', `Provider install is not supported for ${provider}`);
    }
    return adapter.install();
  }

  async connectAccount(
    input: ConnectProviderAccountInput,
    context?: { callbackBaseUrl?: string }
  ): Promise<ConnectProviderAccountResult> {
    const provider = normalizeProvider(input.provider);
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new ManagedShareServiceError(400, 'UNKNOWN_PROVIDER', `Unsupported provider: ${input.provider}`);
    }

    const state = await this.loadState();
    const existing = state.accounts.find((account) => normalizeProvider(account.provider) === provider);
    const proposedAccountId = input.accountId?.trim() || existing?.id || createId('acct', provider, state.accounts.length + 1);

    const setup = await adapter.getSetupState?.();
    if (setup?.status === 'needs-install' && adapter.install) {
      await adapter.install();
    } else if (setup?.status === 'needs-config') {
      throw new ManagedShareServiceError(400, 'PROVIDER_NOT_CONFIGURED', setup.detail);
    } else if (setup?.status === 'unsupported') {
      throw new ManagedShareServiceError(501, 'NOT_IMPLEMENTED', setup.detail);
    }

    if (!adapter.connect) {
      const nextAccount = this.upsertConnectedAccount(state, existing, {
        id: proposedAccountId,
        provider,
        label: input.label?.trim() || existing?.label || defaultProviderLabel(provider),
        email: input.email?.trim() || existing?.email,
        state: 'connected',
        detail: `${defaultProviderLabel(provider)} is connected.`,
      });
      const preferredProviders = mergePreferredProviders(state.preferredProviders, provider, input.preferred === true);
      await this.saveState({
        ...state,
        accounts: nextAccount.accounts,
        preferredProviders,
      });
      return {
        status: 'connected',
        account: nextAccount.account,
      };
    }

    const result = await adapter.connect(
      {
        ...input,
        provider,
        accountId: proposedAccountId,
      },
      context
    );
    if (result.status !== 'connected' || !result.account) {
      return result;
    }

    const merged = this.upsertConnectedAccount(state, existing, {
      ...result.account,
      id: result.account.id || proposedAccountId,
      provider,
      label: result.account.label?.trim() || input.label?.trim() || existing?.label || defaultProviderLabel(provider),
      email: result.account.email?.trim() || input.email?.trim() || existing?.email,
      state: 'connected',
      detail: result.account.detail,
    });
    const preferredProviders = mergePreferredProviders(state.preferredProviders, provider, input.preferred === true);
    await this.saveState({
      ...state,
      accounts: merged.accounts,
      preferredProviders,
    });

    const connectedState: IntegrationStateSnapshot = {
      ...state,
      accounts: merged.accounts,
      preferredProviders,
    };
    const reconciledMirrors = await this.reconcileProviderManagedShares(provider, merged.account, connectedState);
    const incomingDiscoveryTimeoutMs = this.providerIncomingShareDiscoveryTimeoutMs(provider);
    const reconciledIncoming = await this.withSoftTimeout(
      this.reconcileIncomingManagedShares(provider, merged.account, reconciledMirrors.state),
      {
        state: reconciledMirrors.state,
        adoptedShares: 0,
      },
      incomingDiscoveryTimeoutMs,
      `Incoming managed share discovery timed out during connect for ${provider}:${merged.account.id}`
    );
    await this.ensureDefaultManagedShare(provider, merged.account, {
      stateSnapshot: reconciledIncoming.state,
      createMissing: true,
    });
    return {
      status: 'connected',
      account: merged.account,
    };
  }

  async disconnectAccount(accountId: string, options: { skipManagedShareMigration?: boolean } = {}): Promise<void> {
    const state = await this.loadState();
    const account = state.accounts.find((entry) => entry.id === accountId);
    if (!account) {
      throw new ManagedShareServiceError(404, 'ACCOUNT_NOT_FOUND', `Provider account not found: ${accountId}`);
    }

    let workingState = state;
    const ownedShares = workingState.managedShares.filter((share) => share.accountId === accountId);
    for (const share of ownedShares) {
      const retired = await this.retireManagedShareEntry(share, workingState, account, {
        skipMigration: options.skipManagedShareMigration === true,
      });
      workingState = retired.state;
    }
    await this.adapters.get(normalizeProvider(account.provider))?.disconnect?.(account).catch(() => {
      // Ignore provider-specific disconnect failures after config cleanup.
    });

    const remainingAccounts = workingState.accounts.filter((entry) => entry.id !== accountId);
    const remainingShares = workingState.managedShares.filter((share) => share.accountId !== accountId);
    const preferredProviders = workingState.preferredProviders.filter(
      (provider) => provider !== normalizeProvider(account.provider)
    );
    await this.saveState({
      ...workingState,
      accounts: remainingAccounts,
      managedShares: remainingShares,
      preferredProviders,
    });
  }

  async listManagedShares(options: IntegrationReadOptions = {}): Promise<{ shares: ManagedShareSummary[] }> {
    const state = await this.loadState();
    const preferFastRemoteDetails = options.fast === true;
    const skipAncillaryRemoteDetails = this.readMaintenanceMode === 'background' || options.fast === true;
    let preparedState =
      this.readMaintenanceMode === 'inline'
        ? await this.withSoftTimeout(
            (async () => {
              const repairedState = await this.repairManagedShareState(state);
              const reconciledState = await this.reconcileConnectedManagedShareInventories(repairedState);
              await this.ensureDefaultManagedShares(reconciledState, { createMissing: true });
              return this.loadState();
            })(),
            state,
            1_500,
            'Managed share inventory refresh timed out; using the last known share state.'
          )
        : state;
    if (this.readMaintenanceMode === 'background') {
      this.requestBackgroundMaintenance('listManagedShares', preparedState);
    }
    if (this.readMaintenanceMode === 'inline' && options.fast !== true) {
      this.scheduleManagedShareSyncs(preparedState);
    }
    const config = this.options.storage.getRootsConfig();
    const runtime = await this.withSoftTimeout(
      this.options.storage.getRuntimeSnapshot({ includeUsage: false }),
      {
        sources: [],
        writeFailures: [],
      },
      2_500,
      'Managed share runtime snapshot timed out; using fallback runtime state.'
    );
    const summaryTimeoutMs = preferFastRemoteDetails
      ? FAST_MANAGED_SHARE_SUMMARY_TIMEOUT_MS
      : FULL_MANAGED_SHARE_SUMMARY_TIMEOUT_MS;
    const buildSummaries = async (stateSnapshot: IntegrationStateSnapshot): Promise<ManagedShareSummary[]> => {
      const shares = stateSnapshot.managedShares.filter((share) => isProviderEnabled(share.provider));
      return Promise.all(
        shares.map((share) =>
          this.withSoftTimeout(
            this.buildManagedShareSummary(share, {
              config,
              runtime,
              state: stateSnapshot,
              preferFastRemoteDetails,
              skipAncillaryRemoteDetails,
              skipRemoteChecks: options.fast === true,
            }),
            this.fallbackManagedShareSummary(share, config, runtime, stateSnapshot),
            summaryTimeoutMs,
            `Managed share summary timed out for ${share.id}`
          )
        )
      );
    };

    let summaries = await buildSummaries(preparedState);
    const repairableShares = summaries.filter((summary) => this.shouldAutoRepairManagedShare(summary));

    if (repairableShares.length > 0) {
      if (this.readMaintenanceMode === 'inline' && options.fast !== true) {
        await Promise.all(repairableShares.map((summary) => this.autoRepairManagedShare(summary)));
        preparedState = await this.loadState();
        summaries = await buildSummaries(preparedState);
      } else {
        void Promise.all(repairableShares.map((summary) => this.autoRepairManagedShare(summary)));
      }
    }

    const markerRefreshableShares = summaries.filter((summary) => this.shouldRefreshManagedShareMarker(summary));
    if (markerRefreshableShares.length > 0) {
      if (this.readMaintenanceMode === 'inline' && options.fast !== true) {
        await Promise.all(markerRefreshableShares.map((summary) => this.refreshManagedShareMarker(summary.share.id)));
        preparedState = await this.loadState();
        summaries = await buildSummaries(preparedState);
      } else {
        void Promise.all(markerRefreshableShares.map((summary) => this.refreshManagedShareMarker(summary.share.id)));
      }
    }
    if (this.readMaintenanceMode === 'inline' && options.fast !== true && repairableShares.length > 0) {
      await Promise.all(repairableShares.map((summary) => this.hydrateManagedShareRootFromPeers(summary.share)));
      preparedState = await this.loadState();
      summaries = await buildSummaries(preparedState);
    }
    if (this.readMaintenanceMode === 'background') {
      this.scheduleManagedShareSyncs(preparedState);
    }

    return {
      shares: summaries,
    };
  }

  async repairManagedShare(shareId: string): Promise<ManagedShareSummary> {
    const { account, adapter, nextShare } = await this.prepareManagedShareForSync(shareId);
    if (account && this.canSyncManagedShare(nextShare, account)) {
      await adapter?.ensureSync?.(nextShare, account);
    }

    return this.buildManagedShareSummary(nextShare);
  }

  async listIncomingManagedShares(options: IntegrationReadOptions = {}): Promise<{ shares: IncomingManagedShareOffer[] }> {
    const state = await this.loadState();
    const preparedState =
      this.readMaintenanceMode === 'inline'
        ? await this.withSoftTimeout(
            this.repairManagedShareState(state),
            state,
            1_500,
            'Incoming managed share refresh timed out; using the last known state.'
          )
        : state;
    if (options.fast === true) {
      return {
        shares: [],
      };
    }
      if (this.readMaintenanceMode === 'background') {
        this.requestBackgroundMaintenance('listIncomingManagedShares', preparedState);
      }
    const attachedKeys = buildAttachedShareKeys(preparedState.managedShares);
    const offers = await Promise.all(
      preparedState.accounts
        .filter((account) => this.isOperationalAccount(account) && isProviderEnabled(account.provider))
        .map(async (account) => {
          const adapter = this.adapters.get(normalizeProvider(account.provider));
          if (!adapter?.listIncomingShares) {
            return {
              account,
              offers: [] satisfies IncomingManagedShareOffer[],
              errorDetail: null,
            };
          }
          try {
            const discoveryTimeoutMs = this.providerIncomingShareDiscoveryTimeoutMs(account.provider);
            const discovered = await this.withSoftTimeout(
              adapter.listIncomingShares(account),
              [] satisfies IncomingManagedShareOffer[],
              discoveryTimeoutMs,
              `Incoming managed share discovery timed out for ${account.provider}:${account.id}`
            );
            return {
              account,
              offers: discovered,
              errorDetail: null,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.runtime.logger.warn(`Incoming managed share discovery failed for ${account.provider}:${account.id}: ${message}`);
            return {
              account,
              offers: [] satisfies IncomingManagedShareOffer[],
              errorDetail: normalizeProvider(account.provider) === 'mega'
                ? describeMegaAccountRecovery(message)
                : null,
            };
          }
        })
    );

    let nextState = preparedState;
    for (const result of offers) {
      if (normalizeProvider(result.account.provider) !== 'mega') {
        continue;
      }
      if (result.errorDetail) {
        nextState = this.withAccountPresentationState(nextState, result.account.id, 'attention', result.errorDetail);
        continue;
      }
      nextState = this.withAccountPresentationState(nextState, result.account.id, 'connected');
    }
    if (nextState !== preparedState) {
      await this.saveState(nextState);
    }

    return {
      shares: offers
        .flatMap((entry) => entry.offers)
        .filter((offer) => !buildIncomingManagedShareOfferKeys(offer).some((key) => attachedKeys.has(key)))
        .sort((left, right) => {
          const providerOrder = left.provider.localeCompare(right.provider);
          if (providerOrder !== 0) {
            return providerOrder;
          }
          return left.label.localeCompare(right.label);
        }),
    };
  }

  async listIncomingProviderContactInvites(
    options: IntegrationReadOptions = {}
  ): Promise<{ invites: IncomingProviderContactInvite[] }> {
    const state = await this.loadState();
    if (options.fast === true) {
      return {
        invites: [],
      };
    }
    const invites = await Promise.all(
      state.accounts
        .filter((account) => this.isOperationalAccount(account) && isProviderEnabled(account.provider))
        .map(async (account) => {
          const adapter = this.adapters.get(normalizeProvider(account.provider));
          if (!adapter?.listIncomingContactInvites) {
            return [] satisfies IncomingProviderContactInvite[];
          }
          try {
            return await this.withSoftTimeout(
              adapter.listIncomingContactInvites(account),
              [] satisfies IncomingProviderContactInvite[],
              1_500,
              `Incoming contact invite lookup timed out for ${account.provider}:${account.id}`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.runtime.logger.warn(`Incoming contact invite lookup failed for ${account.provider}:${account.id}: ${message}`);
            return [] satisfies IncomingProviderContactInvite[];
          }
        })
    );
    return {
      invites: invites.flat().sort((left, right) => left.label.localeCompare(right.label)),
    };
  }

  async acceptIncomingProviderContactInvite(providerInput: string, accountId: string, inviteId: string): Promise<void> {
    const provider = normalizeProvider(providerInput);
    const adapter = this.adapters.get(provider);
    if (!adapter?.acceptIncomingContactInvite) {
      throw new ManagedShareServiceError(501, 'NOT_IMPLEMENTED', `Provider contact invites are not supported for ${provider}`);
    }
    const state = await this.loadState();
    const account = state.accounts.find((entry) => entry.id === accountId);
    if (!account) {
      throw new ManagedShareServiceError(404, 'ACCOUNT_NOT_FOUND', `Provider account not found: ${accountId}`);
    }
    await adapter.acceptIncomingContactInvite(account, inviteId);
  }

  async createManagedShare(input: CreateManagedShareInput): Promise<ManagedShareSummary> {
    const state = await this.loadState();
    const provider = normalizeProvider(input.provider);
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new ManagedShareServiceError(400, 'UNKNOWN_PROVIDER', `Unsupported provider: ${input.provider}`);
    }
    const account = state.accounts.find((entry) => entry.id === input.accountId);
    if (!account) {
      throw new ManagedShareServiceError(404, 'ACCOUNT_NOT_FOUND', `Provider account not found: ${input.accountId}`);
    }
    if (normalizeProvider(account.provider) !== provider) {
      throw new ManagedShareServiceError(400, 'ACCOUNT_PROVIDER_MISMATCH', 'Account provider does not match share provider');
    }

    const now = Date.now();
    const shareId = createId('share', provider, state.managedShares.length + 1);
    const requestedLocalPath = path.resolve(
      input.localPath ??
        resolveManagedShareLocalPath(
          this.mirrorRoot,
          provider,
          account,
          input.label,
          shareId,
          input.remoteDescriptor,
          input.role ?? 'owner'
        )
    );
    await ensureMirrorFolder(requestedLocalPath);

    const initialDescriptor = {
      managedShareId: shareId,
      ...(input.remoteDescriptor ?? {}),
    };
    const providerOverlay: Partial<ManagedShare> =
      input.role === 'recipient'
        ? {
            remoteDescriptor: initialDescriptor,
            capabilities: input.capabilities,
          }
        : (await adapter?.createManagedShare?.(
            {
              ...input,
              localPath: requestedLocalPath,
              remoteDescriptor: initialDescriptor,
            },
            account
          )) ?? {
            remoteDescriptor: initialDescriptor,
          };
    const localPath = path.resolve(
      typeof providerOverlay.localPath === 'string' && providerOverlay.localPath.trim() !== ''
        ? providerOverlay.localPath
        : requestedLocalPath
    );
    await ensureMirrorFolder(localPath);
    const remoteDescriptor = {
      ...initialDescriptor,
      ...(providerOverlay.remoteDescriptor ?? {}),
    };

    const share: ManagedShare = {
      id: shareId,
      provider,
      accountId: input.accountId,
      label:
        (typeof providerOverlay.label === 'string' ? providerOverlay.label.trim() : '') ||
        (typeof input.label === 'string' ? input.label.trim() : '') ||
        defaultProviderLabel(provider),
      role: input.role ?? 'owner',
      localPath,
      sourceId: undefined,
      syncMode: 'mirror',
      remoteDescriptor,
      capabilities: uniqueStrings(providerOverlay.capabilities ?? input.capabilities ?? ['mirror', 'read', 'write', 'invite']),
      invitationEmails: [],
      createdAt: now,
      updatedAt: now,
    };

    let config = cloneConfig(this.options.storage.getRootsConfig());
    const { config: sourceConfig, sourceId } = ensureManagedShareSource(config, share, localPath);
    config = sourceConfig;
    const nextShare = { ...share, sourceId };
    if (input.volumeId) {
      config = ensureVolumeAttachment(config, input.volumeId, sourceId);
    }
    await this.persistRootsConfig(config);

    const nextState: IntegrationStateSnapshot = {
      ...state,
      managedShares: [...state.managedShares, nextShare],
    };
    await this.saveState(nextState);
    this.scheduleManagedShareSync(nextShare, nextState);

    return this.buildManagedShareSummary(nextShare);
  }

  async inviteManagedShare(shareId: string, emails: readonly string[]): Promise<ManagedShareSummary> {
    const state = await this.loadState();
    const share = state.managedShares.find((entry) => entry.id === shareId);
    if (!share) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }
    const adapter = this.adapters.get(normalizeProvider(share.provider));
    if (!adapter) {
      throw new ManagedShareServiceError(400, 'UNKNOWN_PROVIDER', `Unsupported provider: ${share.provider}`);
    }
    const account = state.accounts.find((entry) => entry.id === share.accountId);
    if (!account) {
      throw new ManagedShareServiceError(404, 'ACCOUNT_NOT_FOUND', `Provider account not found: ${share.accountId}`);
    }
    await adapter.invite?.(share, { emails: [...emails] }, account);
    const nextShare: ManagedShare = {
      ...share,
      invitationEmails: uniqueStrings([...share.invitationEmails, ...emails]),
      updatedAt: Date.now(),
    };
    await this.saveState({
      ...state,
      managedShares: state.managedShares.map((entry) => (entry.id === shareId ? nextShare : entry)),
    });
    return this.buildManagedShareSummary(nextShare);
  }

  async attachManagedShare(shareId: string, input: AttachManagedShareInput): Promise<ManagedShareSummary> {
    const state = await this.loadState();
    const share = state.managedShares.find((entry) => entry.id === shareId);
    if (!share || !share.sourceId) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }

    const config = ensureVolumeAttachment(
      cloneConfig(this.options.storage.getRootsConfig()),
      input.volumeId,
      share.sourceId
    );
    await this.persistRootsConfig(config);

    return this.buildManagedShareSummary(share);
  }

  async removeManagedShare(shareId: string): Promise<void> {
    const state = await this.loadState();
    const share = state.managedShares.find((entry) => entry.id === shareId);
    if (!share) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }

    const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
    await this.retireManagedShareEntry(share, state, account);
  }

  async acceptManagedShare(input: AcceptManagedShareInput): Promise<ManagedShareSummary> {
    const state = await this.loadState();
    const repairedState = await this.repairManagedShareState(state);
    const provider = normalizeProvider(input.provider);
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new ManagedShareServiceError(400, 'UNKNOWN_PROVIDER', `Unsupported provider: ${input.provider}`);
    }
    const account = repairedState.accounts.find((entry) => entry.id === input.accountId);
    if (!account) {
      throw new ManagedShareServiceError(404, 'ACCOUNT_NOT_FOUND', `Provider account not found: ${input.accountId}`);
    }
    const accepted = (await adapter?.acceptInvite?.(input, account)) ?? {};
    const remoteDescriptor = {
      ...(input.remoteDescriptor ?? {}),
      ...(accepted.remoteDescriptor ?? {}),
    };
    const existing = findManagedShareByRemoteDescriptor(
      repairedState.managedShares,
      provider,
      input.accountId,
      remoteDescriptor
    );
    if (existing) {
      if (input.volumeId && existing.sourceId) {
        const config = ensureVolumeAttachment(
          cloneConfig(this.options.storage.getRootsConfig()),
          input.volumeId,
          existing.sourceId
        );
        await this.persistRootsConfig(config);
      }
      return this.buildManagedShareSummary(existing);
    }
    return this.createManagedShare({
      provider,
      accountId: input.accountId,
      label: accepted.label?.trim() || input.label,
      localPath: input.localPath,
      role: 'recipient',
      volumeId: input.volumeId,
      remoteDescriptor,
      capabilities: accepted.capabilities ?? ['mirror', 'read', 'write', 'accept'],
    });
  }

  async getManagedShareState(shareId: string): Promise<ManagedShareSummary> {
    let state = await this.loadState();
    if (this.readMaintenanceMode === 'inline') {
      const repairedState = await this.repairManagedShareState(state);
      state = repairedState;
      state = await this.loadState();
    }
    const share = state.managedShares.find((entry) => entry.id === shareId);
    if (!share) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }
    if (!isProviderEnabled(share.provider)) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }
    if (this.readMaintenanceMode === 'inline') {
      this.scheduleManagedShareSync(share, state);
    }
    return this.buildManagedShareSummary(share);
  }

  async reconcileProviderManagedShareInventory(providerInput: string): Promise<{
    provider: string;
    adoptedShares: number;
    retiredShares: number;
    migratedShares: number;
  }> {
    const provider = normalizeProvider(providerInput);
    const state = await this.loadState();
    const connectedAccounts = state.accounts.filter(
      (account) => normalizeProvider(account.provider) === provider && this.isOperationalAccount(account)
    );

    let workingState = state;
    let adoptedShares = 0;
    let retiredShares = 0;
    let migratedShares = 0;

    if (connectedAccounts.length === 0) {
      const retired = await this.retireProviderManagedShares(provider, workingState);
      workingState = retired.state;
      retiredShares += retired.retiredShares;
      migratedShares += retired.migratedShares;
    } else {
      for (const account of connectedAccounts) {
        const reconciled = await this.reconcileProviderManagedShares(provider, account, workingState);
        workingState = reconciled.state;
        adoptedShares += reconciled.adoptedShares;
        retiredShares += reconciled.retiredShares;
        migratedShares += reconciled.migratedShares;
      }
    }

    return {
      provider,
      adoptedShares,
      retiredShares,
      migratedShares,
    };
  }

  async handleProviderCallback(provider: string, query: URLSearchParams): Promise<string> {
    const adapter = this.adapters.get(normalizeProvider(provider));
    if (!adapter?.handleOAuthCallback) {
      throw new ManagedShareServiceError(404, 'UNKNOWN_PROVIDER', `No external callback is registered for ${provider}`);
    }
    return adapter.handleOAuthCallback(query);
  }

  private async reconcileConnectedManagedShareInventories(
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<IntegrationStateSnapshot> {
    let state = stateSnapshot;
    for (const account of state.accounts.filter((entry) => this.isOperationalAccount(entry) || this.isMegaHelperOperationalAccount(entry))) {
      const provider = normalizeProvider(account.provider);
      const adapter = this.adapters.get(provider);
      this.runtime.logger.log('Managed share provider reconciliation started.', {
        provider,
        accountId: account.id,
        accountState: account.state,
      });
      if (adapter?.listManagedShareMirrors) {
        const reconciled = await this.reconcileProviderManagedShares(provider, account, state);
        state = reconciled.state;
        this.runtime.logger.log('Managed share mirror inventory reconciled.', {
          provider,
          accountId: account.id,
          adoptedShares: reconciled.adoptedShares,
          retiredShares: reconciled.retiredShares,
          migratedShares: reconciled.migratedShares,
        });
      }
      if (adapter?.listIncomingShares && this.isOperationalAccount(account)) {
        const reconciledIncoming = await this.reconcileIncomingManagedShares(provider, account, state);
        state = reconciledIncoming.state;
        this.runtime.logger.log('Managed share incoming inventory reconciled.', {
          provider,
          accountId: account.id,
          adoptedShares: reconciledIncoming.adoptedShares,
        });
      }
    }
    return state;
  }

  private async reconcileIncomingManagedShares(
    provider: string,
    account: ProviderAccount,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<{
    state: IntegrationStateSnapshot;
    adoptedShares: number;
  }> {
    const adapter = this.adapters.get(provider);
    if (!adapter?.listIncomingShares) {
      return {
        state: stateSnapshot,
        adoptedShares: 0,
      };
    }

    let offers: IncomingManagedShareOffer[] = [];
    try {
      offers = await adapter.listIncomingShares(account);
      this.runtime.logger.log('Managed share incoming inventory discovered.', {
        provider,
        accountId: account.id,
        offerCount: offers.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runtime.logger.warn(`Incoming managed share reconciliation failed for ${provider}:${account.id}: ${message}`);
      return {
        state: stateSnapshot,
        adoptedShares: 0,
      };
    }

    let state = stateSnapshot;
    let adoptedShares = 0;
    for (const offer of offers) {
      const existing = findManagedShareByRemoteDescriptor(state.managedShares, provider, account.id, offer.remoteDescriptor);
      if (existing) {
        await this.prepareManagedShareForSync(existing.id);
        state = await this.loadState();
        continue;
      }

      await this.acceptManagedShare({
        provider,
        accountId: account.id,
        label: offer.label,
        localPath: offer.suggestedLocalPath,
        remoteDescriptor: offer.remoteDescriptor,
      });
      state = await this.loadState();
      adoptedShares += 1;
    }

    return {
      state,
      adoptedShares,
    };
  }

  private async reconcileProviderManagedShares(
    provider: string,
    account: ProviderAccount,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<{
    state: IntegrationStateSnapshot;
    adoptedShares: number;
    retiredShares: number;
    migratedShares: number;
  }> {
    const adapter = this.adapters.get(provider);
    if (!adapter?.listManagedShareMirrors) {
      return {
        state: stateSnapshot,
        adoptedShares: 0,
        retiredShares: 0,
        migratedShares: 0,
      };
    }

    let state = stateSnapshot;
    let adoptedShares = 0;
    let retiredShares = 0;
    let migratedShares = 0;
    let mirrors: ManagedShareMirrorEntry[] = [];
    try {
      mirrors = dedupeManagedShareMirrors(await adapter.listManagedShareMirrors(account), provider);
      this.runtime.logger.log('Managed share mirror inventory discovered.', {
        provider,
        accountId: account.id,
        mirrorCount: mirrors.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runtime.logger.warn(`Managed share inventory discovery failed for ${provider}:${account.id}: ${message}`);
      return {
        state,
        adoptedShares,
        retiredShares,
        migratedShares,
      };
    }
    const retainedShareIds = new Set<string>();

    for (const mirror of mirrors) {
      const adopted = await this.adoptManagedShareMirror(provider, account, mirror, state);
      state = adopted.state;
      retainedShareIds.add(adopted.shareId);
      if (adopted.adopted) {
        adoptedShares += 1;
      }
      if (adopted.migrated) {
        migratedShares += 1;
      }
    }

    const trackedShares = state.managedShares.filter((share) =>
      normalizeProvider(share.provider) === provider &&
      share.accountId === account.id &&
      this.shouldManageShareThroughMirrorInventory(provider, share) &&
      !retainedShareIds.has(share.id)
    );
    for (const share of trackedShares) {
      const retired = await this.retireManagedShareEntry(share, state, account);
      state = retired.state;
      retiredShares += 1;
      if (retired.migrated) {
        migratedShares += 1;
      }
    }

    return {
      state,
      adoptedShares,
      retiredShares,
      migratedShares,
    };
  }

  private async retireProviderManagedShares(
    provider: string,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<{
    state: IntegrationStateSnapshot;
    retiredShares: number;
    migratedShares: number;
  }> {
    let state = stateSnapshot;
    let retiredShares = 0;
    let migratedShares = 0;
    const shares = state.managedShares.filter((share) => normalizeProvider(share.provider) === provider);
    for (const share of shares) {
      const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
      const retired = await this.retireManagedShareEntry(share, state, account);
      state = retired.state;
      retiredShares += 1;
      if (retired.migrated) {
        migratedShares += 1;
      }
    }
    return {
      state,
      retiredShares,
      migratedShares,
    };
  }

  private async adoptManagedShareMirror(
    provider: string,
    account: ProviderAccount,
    mirror: ManagedShareMirrorEntry,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<{
    state: IntegrationStateSnapshot;
    shareId: string;
    adopted: boolean;
    migrated: boolean;
  }> {
    let state = stateSnapshot;
    let migrated = false;
    const existing = this.findMatchingManagedShareMirror(provider, account.id, mirror, state.managedShares);
    if (existing && normalizeComparablePath(existing.localPath) !== normalizeComparablePath(mirror.localPath)) {
      const moved = await this.moveManagedShareSourceIntoPrimaryLocalRoot(existing);
      state = moved.state;
      migrated = moved.migrated;
    }

    const shareId = existing?.id ?? createId('share', provider, state.managedShares.length + 1);
    const nextShare: ManagedShare = {
      id: shareId,
      provider,
      accountId: account.id,
      label:
        existing?.label?.trim() ||
        (typeof mirror.label === 'string' ? mirror.label.trim() : '') ||
        defaultProviderMirrorLabel(provider, mirror.remotePath),
      role: existing?.role ?? 'owner',
      localPath: path.resolve(mirror.localPath),
      sourceId: existing?.sourceId,
      syncMode: 'mirror',
      remoteDescriptor: mergeManagedShareMirrorDescriptor(provider, existing?.remoteDescriptor, mirror, shareId),
      capabilities: existing?.capabilities ?? ['mirror', 'read', 'write', 'invite'],
      invitationEmails: existing?.invitationEmails ?? [],
      createdAt: existing?.createdAt ?? this.runtime.now(),
      updatedAt: this.runtime.now(),
    };

    const config = cloneConfig(this.options.storage.getRootsConfig());
    const { config: nextConfig, sourceId } = ensureManagedShareSource(config, nextShare, nextShare.localPath);
    const adoptedShare = {
      ...nextShare,
      sourceId,
    };
    await this.persistRootsConfig(nextConfig);

    const nextState: IntegrationStateSnapshot = {
      ...state,
      managedShares: existing
        ? state.managedShares.map((entry) => (entry.id === existing.id ? adoptedShare : entry))
        : [...state.managedShares, adoptedShare],
    };
    await this.saveState(nextState);

    return {
      state: nextState,
      shareId: adoptedShare.id,
      adopted: !existing,
      migrated,
    };
  }

  private async retireManagedShareEntry(
    share: ManagedShare,
    stateSnapshot: IntegrationStateSnapshot,
    account: ProviderAccount | null,
    options: {
      readonly skipMigration?: boolean;
    } = {}
  ): Promise<{
    state: IntegrationStateSnapshot;
    migrated: boolean;
  }> {
    const moved = options.skipMigration
      ? { migrated: false }
      : await this.moveManagedShareSourceIntoPrimaryLocalRoot(share);
    const adapter = this.adapters.get(normalizeProvider(share.provider));
    await adapter?.detachManagedShare?.(share, account).catch(() => {
      // Ignore cleanup failures when removing local managed-share state.
    });

    const nextConfig = removeManagedShareFromConfig(cloneConfig(this.options.storage.getRootsConfig()), share.id);
    await this.persistRootsConfig(nextConfig);

    const nextState: IntegrationStateSnapshot = {
      ...stateSnapshot,
      managedShares: stateSnapshot.managedShares.filter((entry) => entry.id !== share.id),
    };
    await this.saveState(nextState);
    return {
      state: nextState,
      migrated: moved.migrated,
    };
  }

  private async moveManagedShareSourceIntoPrimaryLocalRoot(share: ManagedShare): Promise<{
    state: IntegrationStateSnapshot;
    migrated: boolean;
  }> {
    const config = cloneConfig(this.options.storage.getRootsConfig());
    const source =
      (share.sourceId ? config.sources.find((entry) => entry.id === share.sourceId) : null) ??
      config.sources.find((entry) => entry.integration?.managedShareId === share.id) ??
      null;
    if (!source) {
      return {
        state: await this.loadState(),
        migrated: false,
      };
    }

    const target = await this.ensurePrimaryLocalMigrationSource(source.id);
    if (
      !target ||
      target.id === source.id ||
      normalizeComparablePath(target.path) === normalizeComparablePath(source.path)
    ) {
      return {
        state: await this.loadState(),
        migrated: false,
      };
    }

    const consolidated = await this.options.storage.consolidateRoot(source.id, target.id);
    await this.persistRootsConfig(consolidated.config);
    return {
      state: await this.loadState(),
      migrated:
        consolidated.result.movedFiles > 0 ||
        consolidated.result.removedSourceFiles > 0 ||
        consolidated.result.skippedExisting > 0,
    };
  }

  private async ensurePrimaryLocalMigrationSource(excludingSourceId?: string): Promise<SourceConfigEntry | null> {
    const config = cloneConfig(this.options.storage.getRootsConfig());
    const existing = findPrimaryLocalSource(config, excludingSourceId);
    if (existing) {
      return existing;
    }

    const fallbackPath = path.resolve(getDefaultStorageDir());
    const candidate =
      config.sources.find((source) => normalizeComparablePath(source.path) === normalizeComparablePath(fallbackPath)) ??
      null;
    const nextSource: SourceConfigEntry = candidate
      ? {
          ...candidate,
          provider: 'local',
          path: fallbackPath,
          enabled: true,
          writable: true,
        }
      : {
          id: nextLocalSourceId(config),
          provider: 'local',
          path: fallbackPath,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        };
    const nextConfig: RootsConfig = candidate
      ? {
          ...config,
          sources: config.sources.map((source) => (source.id === candidate.id ? nextSource : source)),
        }
      : {
          ...config,
          sources: [...config.sources, nextSource],
        };
    await this.persistRootsConfig(nextConfig);
    return nextSource;
  }

  private findMatchingManagedShareMirror(
    provider: string,
    accountId: string,
    mirror: ManagedShareMirrorEntry,
    shares: readonly ManagedShare[]
  ): ManagedShare | undefined {
    const remotePath = normalizeManagedShareRemotePath(provider, mirror.remotePath);
    return shares.find((share) =>
      normalizeProvider(share.provider) === provider &&
      share.accountId === accountId &&
      getManagedShareRemotePath(provider, share.remoteDescriptor) === remotePath
    ) ?? shares.find((share) =>
      normalizeProvider(share.provider) === provider &&
      share.accountId === accountId &&
      normalizeComparablePath(share.localPath) === normalizeComparablePath(mirror.localPath) &&
      this.shouldManageShareThroughMirrorInventory(provider, share)
    );
  }

  private shouldManageShareThroughMirrorInventory(provider: string, share: ManagedShare): boolean {
    if (provider === 'mega' && isMegaOwnerBaseShare(share)) {
      return false;
    }
    const remotePath = getManagedShareRemotePath(provider, share.remoteDescriptor);
    if (!remotePath) {
      return false;
    }
    if (provider === 'mega') {
      return isManagedMirrorRemotePath(remotePath, this.runtime.mega.remoteBasePath);
    }
    return false;
  }

  private shouldAutoRepairManagedShare(summary: ManagedShareSummary): boolean {
    if (summary.state.status !== 'attention' && summary.state.status !== 'needs-auth') {
      return false;
    }
    if (!summary.state.badges.some((badge) => badge === 'Repair' || badge === 'Reconnect')) {
      return false;
    }
    const lastAttemptAt = this.autoRepairCooldowns.get(summary.share.id) ?? 0;
    return Date.now() - lastAttemptAt >= 30_000;
  }

  private async autoRepairManagedShare(summary: ManagedShareSummary): Promise<void> {
    this.autoRepairCooldowns.set(summary.share.id, Date.now());
    try {
      if (this.isSourceConflictState(summary.state)) {
        await this.resolveManagedShareSourceConflict(summary.share.id);
        return;
      }
      await this.repairManagedShare(summary.share.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runtime.logger.warn(`Managed share auto-repair failed for ${summary.share.id}: ${message}`);
    }
  }

  private isSourceConflictState(state: TransportState): boolean {
    const code = state.diagnostic?.code?.trim().toLowerCase() ?? '';
    if (code.includes('conflict')) {
      return true;
    }

    const detail = [state.detail, state.diagnostic?.summary, state.diagnostic?.detail]
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .join(' ')
      .toLowerCase();
    return /conflict|conflicting cop(?:y|ies)/i.test(detail);
  }

  private async resolveManagedShareSourceConflict(shareId: string): Promise<void> {
    const { account, adapter, nextShare } = await this.prepareManagedShareForSync(shareId);
    await this.options.storage.resolveSourceConflicts({
      sourceIds: nextShare.sourceId ? [nextShare.sourceId] : undefined,
      resetTargets: true,
      ensureMarker: false,
      rewriteMarker: false,
    });
    await this.options.storage.reconcileConfiguredVolumes();
    await this.hydrateManagedShareRootFromPeers(nextShare);
    this.pendingMarkerRefreshes.add(shareId);
    if (account && this.isOperationalAccount(account)) {
      await adapter?.ensureSync?.(nextShare, account);
    }
  }

  private async hydrateManagedShareRootFromPeers(share: ManagedShare): Promise<void> {
    if (!share.sourceId) {
      return;
    }
    const localPath = path.resolve(share.localPath);
    const config = this.options.storage.getRootsConfig();
    const peerSources = config.sources.filter(
      (source) => source.enabled && source.id !== share.sourceId && normalizeComparablePath(source.path) !== normalizeComparablePath(localPath)
    );
    for (const source of peerSources) {
      await copyIfPresent(path.join(source.path, 'blocks'), path.join(localPath, 'blocks'));
      await copyIfPresent(path.join(source.path, 'channels'), path.join(localPath, 'channels'));
    }
    await normalizeNearbytesRoot(localPath, { rewriteMarker: true });
  }

  private shouldRefreshManagedShareMarker(summary: ManagedShareSummary): boolean {
    return this.pendingMarkerRefreshes.has(summary.share.id) && summary.state.status === 'ready';
  }

  private async refreshManagedShareMarker(shareId: string): Promise<void> {
    try {
      const { account, adapter, nextShare } = await this.prepareManagedShareForSync(shareId);
      await this.hydrateManagedShareRootFromPeers(nextShare);
      await normalizeNearbytesRoot(nextShare.localPath, {
        rewriteMarker: true,
      });
      if (account && this.canSyncManagedShare(nextShare, account)) {
        await adapter?.ensureSync?.(nextShare, account);
      }
      this.pendingMarkerRefreshes.delete(shareId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runtime.logger.warn(`Managed share marker refresh failed for ${shareId}: ${message}`);
    }
  }

  private scheduleManagedShareSyncs(state: IntegrationStateSnapshot): void {
    for (const share of state.managedShares) {
      this.scheduleManagedShareSync(share, state);
    }
  }

  private scheduleManagedShareSync(share: ManagedShare, state: IntegrationStateSnapshot): void {
    const account = state.accounts.find((entry) => entry.id === share.accountId);
    if (!account || !this.canSyncManagedShare(share, account) || this.syncBootstrapTasks.has(share.id)) {
      return;
    }
    this.runtime.logger.log('Managed share sync bootstrap scheduled.', {
      provider: normalizeProvider(share.provider),
      shareId: share.id,
      accountId: account.id,
      role: share.role,
      localPath: share.localPath,
      remoteDescriptor: share.remoteDescriptor,
    });
    const task = this.adapters
      .get(normalizeProvider(share.provider))
      ?.ensureSync?.(share, account)
      .then(() => {
        this.runtime.logger.log('Managed share sync bootstrap completed.', {
          provider: normalizeProvider(share.provider),
          shareId: share.id,
          accountId: account.id,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.runtime.logger.warn(`Managed share sync bootstrap failed for ${share.id}: ${message}`);
      })
      .finally(() => {
        this.syncBootstrapTasks.delete(share.id);
      });
    if (task) {
      this.syncBootstrapTasks.set(share.id, task);
    }
  }

  private fallbackTransportState(
    share: ManagedShare,
    runtime: MultiRootRuntimeSnapshot,
    account: ProviderAccount | null
  ): TransportState {
    const status = share.sourceId ? runtime.sources.find((entry) => entry.id === share.sourceId) : undefined;
    if (!status) {
      return {
        status: 'attention',
        detail: 'The local share folder is not attached yet.',
        badges: ['Repair'],
      };
    }
    if (!status.exists || !status.isDirectory) {
      return {
        status: 'attention',
        detail: 'The local share folder is missing or invalid.',
        badges: ['Repair'],
      };
    }
    if (!account) {
      return {
        status: 'needs-auth',
        detail: `${defaultProviderLabel(normalizeProvider(share.provider))} needs to reconnect.`,
        badges: ['Reconnect'],
      };
    }
    return {
      status: 'idle',
      detail: `${defaultProviderLabel(normalizeProvider(share.provider))} shared storage is being checked.`,
      badges: ['Checking'],
    };
  }

  private buildSyncBootstrapState(share: ManagedShare): TransportState {
    const providerLabel = defaultProviderLabel(normalizeProvider(share.provider));
    const detail = `Nearbytes is preparing this ${providerLabel} shared location locally. This is a transient startup state while the local mirror is being checked and started.`;
    return {
      status: 'syncing',
      detail,
      badges: ['Preparing'],
      diagnostic: {
        code: 'MIRROR_PREPARING',
        title: `${providerLabel} mirror is preparing`,
        summary: 'Preparing local mirror',
        detail,
        facts:
          normalizeProvider(share.provider) === 'mega'
            ? [{ label: 'Inspect', value: 'Open the MEGA runtime logs from the provider card to watch startup progress.' }]
            : [{ label: 'Inspect', value: 'Refresh this panel to check whether the mirror finished starting.' }],
      },
    };
  }

  private buildTimedOutTransportState(share: ManagedShare, fallbackState: TransportState): TransportState {
    if (normalizeProvider(share.provider) !== 'mega') {
      return fallbackState;
    }
    return {
      status: 'attention',
      detail: 'Nearbytes could not reach the local MEGA helper in time. Local MEGA sync is currently unavailable.',
      badges: ['Repair'],
    };
  }

  private fallbackCollaborators(share: ManagedShare): ManagedShareCollaborator[] {
    return uniqueStrings(share.invitationEmails).map((email) => ({
      label: email,
      email,
      status: 'invited',
      source: 'nearbytes',
    }));
  }

  private fallbackManagedShareSummary(
    share: ManagedShare,
    config: RootsConfig,
    runtime: MultiRootRuntimeSnapshot,
    stateSnapshot: IntegrationStateSnapshot
  ): ManagedShareSummary {
    const account = stateSnapshot.accounts.find((entry) => entry.id === share.accountId) ?? null;
    return {
      share,
      attachments: computeManagedShareAttachments(config, share),
      state: this.fallbackTransportState(share, runtime, account),
      collaborators: this.fallbackCollaborators(share),
      storage: summarizeManagedShareStorage(config, runtime, share, undefined),
    };
  }

  private async withSoftTimeout<T>(
    promise: Promise<T>,
    fallback: T,
    timeoutMs: number,
    warning: string
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        this.runtime.logger.warn(warning);
        resolve(fallback);
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private providerIncomingShareDiscoveryTimeoutMs(provider: string): number {
    return normalizeProvider(provider) === 'mega' ? 12_000 : 1_500;
  }

  private requestBackgroundMaintenance(reason: string, stateSnapshot: IntegrationStateSnapshot): void {
    if (!this.shouldRunBackgroundMaintenance(stateSnapshot)) {
      return;
    }
    this.maintenanceRequested = true;
    if (this.maintenanceTask) {
      return;
    }
    this.maintenanceTask = this.runBackgroundMaintenanceLoop(reason)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.runtime.logger.warn(`Managed share maintenance failed after ${reason}: ${message}`);
      })
      .finally(() => {
        this.maintenanceTask = null;
        if (this.maintenanceRequested) {
          void this.loadState()
            .then((latestState) => {
              this.requestBackgroundMaintenance('follow-up', latestState);
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              this.runtime.logger.warn(`Managed share maintenance follow-up scheduling failed: ${message}`);
            });
        }
      });
  }

  private async runBackgroundMaintenanceLoop(initialReason: string): Promise<void> {
    let reason = initialReason;
    while (this.maintenanceRequested) {
      this.maintenanceRequested = false;
      this.runtime.logger.log('Managed share background maintenance started.', { reason });
      try {
        const state = await this.loadState();
        const repairedState = await this.repairManagedShareState(state);
        const reconciledState = await this.reconcileConnectedManagedShareInventories(repairedState);
        await this.ensureDefaultManagedShares(reconciledState, { createMissing: true });
        const refreshedState = await this.loadState();
        const stampedState = await this.persistBackgroundMaintenanceSnapshot(refreshedState);
        this.scheduleManagedShareSyncs(stampedState);
        this.runtime.logger.log('Managed share background maintenance completed.', {
          reason,
          accountCount: stampedState.accounts.length,
          managedShareCount: stampedState.managedShares.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.runtime.logger.warn(`Managed share maintenance pass failed after ${reason}: ${message}`);
      }
      reason = 'queued maintenance';
    }
  }

  async waitForBackgroundMaintenance(): Promise<void> {
    while (this.maintenanceTask) {
      await this.maintenanceTask;
    }
  }

  private shouldRunBackgroundMaintenance(stateSnapshot: IntegrationStateSnapshot): boolean {
    if (this.hasMissingDefaultManagedShares(stateSnapshot)) {
      return true;
    }
    const signature = this.computeBackgroundMaintenanceSignature(stateSnapshot);
    return !this.hasFreshBackgroundMaintenance(stateSnapshot, signature);
  }

  private hasMissingDefaultManagedShares(stateSnapshot: IntegrationStateSnapshot): boolean {
    return stateSnapshot.accounts.some((account) => {
      const provider = normalizeProvider(account.provider);
      if (provider !== 'mega' || !this.isMegaHelperOperationalAccount(account)) {
        return false;
      }
      return !stateSnapshot.managedShares.some((share) =>
        normalizeProvider(share.provider) === 'mega' &&
        share.accountId === account.id &&
        isMegaOwnerBaseShare(share)
      );
    });
  }

  private hasFreshBackgroundMaintenance(stateSnapshot: IntegrationStateSnapshot, signature: string): boolean {
    const maintenance = stateSnapshot.maintenance;
    if (!maintenance) {
      return false;
    }
    if (maintenance.mode !== 'background' || maintenance.schemaVersion !== BACKGROUND_MAINTENANCE_SCHEMA_VERSION) {
      return false;
    }
    if (maintenance.signature !== signature) {
      return false;
    }
    return this.runtime.now() - maintenance.completedAt < BACKGROUND_MAINTENANCE_MAX_AGE_MS;
  }

  private computeBackgroundMaintenanceSignature(stateSnapshot: IntegrationStateSnapshot): string {
    return JSON.stringify({
      schemaVersion: BACKGROUND_MAINTENANCE_SCHEMA_VERSION,
      roots: this.options.storage.getRootsConfig().sources.map((source) => ({
        id: source.id,
        provider: source.provider,
        path: path.resolve(source.path),
        enabled: source.enabled,
        writable: source.writable,
        integration: source.integration
          ? {
              kind: source.integration.kind,
              provider: source.integration.provider,
              managedShareId: source.integration.managedShareId,
            }
          : null,
      })),
      accounts: stateSnapshot.accounts.map((account) => ({
        id: account.id,
        provider: normalizeProvider(account.provider),
        email: account.email ?? null,
        state: account.state,
      })),
      managedShares: stateSnapshot.managedShares.map((share) => ({
        id: share.id,
        provider: normalizeProvider(share.provider),
        accountId: share.accountId,
        role: share.role,
        localPath: path.resolve(share.localPath),
        sourceId: share.sourceId ?? null,
        remoteDescriptor: share.remoteDescriptor,
        capabilities: [...share.capabilities],
        invitationEmails: [...share.invitationEmails],
      })),
    });
  }

  private async persistBackgroundMaintenanceSnapshot(
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<IntegrationStateSnapshot> {
    const signature = this.computeBackgroundMaintenanceSignature(stateSnapshot);
    if (this.hasFreshBackgroundMaintenance(stateSnapshot, signature)) {
      return stateSnapshot;
    }
    const maintenance: IntegrationMaintenanceSnapshot = {
      mode: 'background',
      schemaVersion: BACKGROUND_MAINTENANCE_SCHEMA_VERSION,
      signature,
      completedAt: this.runtime.now(),
    };
    const nextState: IntegrationStateSnapshot = {
      ...stateSnapshot,
      maintenance,
    };
    await this.saveState(nextState);
    return nextState;
  }

  private async ensureDefaultManagedShares(
    state: IntegrationStateSnapshot,
    options: {
      readonly createMissing?: boolean;
    } = {}
  ): Promise<void> {
    for (const account of state.accounts) {
      if (!this.isMegaHelperOperationalAccount(account)) {
        continue;
      }
      await this.ensureDefaultManagedShare(normalizeProvider(account.provider), account, {
        stateSnapshot: state,
        createMissing: options.createMissing,
      });
    }
  }

  private async getProviderSetupStates(): Promise<Map<string, ProviderSetupState>> {
    const entries = await Promise.all(
      Array.from(this.adapters.values()).map(async (adapter) => [
        adapter.provider,
        (await adapter.getSetupState?.()) ?? {
          status: 'ready',
          detail: adapter.description,
        },
      ] as const)
    );
    return new Map(entries);
  }

  private fallbackProviderSetupStates(): Map<string, ProviderSetupState> {
    return new Map(
      Array.from(this.adapters.values()).map((adapter) => [
        adapter.provider,
        {
          status: 'ready',
          detail: adapter.description,
        } satisfies ProviderSetupState,
      ])
    );
  }

  async parseJoinLink(input: {
    serialized?: string;
    link?: unknown;
    preferredProviders?: readonly string[];
  }): Promise<{ plan: JoinLinkPlan; space: JoinLinkSpace }> {
    const link = this.parseJoinLinkInput(input.serialized, input.link);
    const state = await this.loadState();
    const context = createPlannerContext({
      attachedShareKeys: buildAttachedShareKeys(state.managedShares),
      connectedProviders: state.accounts
        .filter((account) => this.isOperationalAccount(account))
        .map((account) => account.provider),
      preferredProviders: input.preferredProviders ?? state.preferredProviders,
      supportedProviders: Array.from(this.adapters.keys()),
    });
    return {
      plan: planJoinLink(link, context),
      space: link.space,
    };
  }

  async openJoinLink(input: {
    serialized?: string;
    link?: unknown;
    volumeId?: string;
    preferredProviders?: readonly string[];
    allowCredentialBootstrap?: boolean;
  }, context: {
    callbackBaseUrl?: string;
  } = {}): Promise<{
    plan: JoinLinkPlan;
    space: JoinLinkSpace;
    secret: string | null;
    volumeId: string | null;
    actions: Array<{
      attachmentId: string;
      endpointTransport?: string;
      provider?: string;
      status: 'attached' | 'planned' | 'needs-account' | 'pending-auth' | 'unsupported';
      accountId?: string;
      shareId?: string;
      suggestedLocalPath?: string;
      usedCredentialBootstrap?: boolean;
      detail: string;
    }>;
  }> {
    const parsed = await this.parseJoinLink(input);
    const state = await this.loadState();
    const workingAccounts = [...state.accounts];
    const workingShares = [...state.managedShares];
    const actions: Array<{
      attachmentId: string;
      endpointTransport?: string;
      provider?: string;
      status: 'attached' | 'planned' | 'needs-account' | 'pending-auth' | 'unsupported';
      accountId?: string;
      shareId?: string;
      suggestedLocalPath?: string;
      usedCredentialBootstrap?: boolean;
      detail: string;
    }> = [];

    for (const planned of parsed.plan.attachments) {
      const selected = planned.selectedEndpoint;
      if (!selected) {
        actions.push({
          attachmentId: planned.attachment.id,
          status: 'unsupported',
          detail: 'No supported transport is available for this attachment yet.',
        });
        continue;
      }

      const endpoint = selected.endpoint;
      if (endpoint.transport !== 'provider-share') {
        actions.push({
          attachmentId: planned.attachment.id,
          endpointTransport: endpoint.transport,
          provider: endpoint.provider,
          status: 'planned',
          detail: selected.reason,
        });
        continue;
      }

      const provider = normalizeProvider(endpoint.provider ?? '');
      const suggestedLocalPath = resolveJoinLinkSuggestedLocalPath(endpoint);
      let account = workingAccounts.find(
        (entry) => normalizeProvider(entry.provider) === provider && this.isOperationalAccount(entry)
      );
      let usedCredentialBootstrap = false;

      if (!account && input.allowCredentialBootstrap && endpoint.bootstrap?.account) {
        try {
          const connected = await this.connectAccount(
            {
              provider,
              mode: endpoint.bootstrap.account.mode,
              label: endpoint.bootstrap.account.label,
              email: endpoint.bootstrap.account.email,
              preferred: endpoint.bootstrap.account.preferred,
              credentials: endpoint.bootstrap.account.credentials,
            },
            context
          );
          usedCredentialBootstrap = true;
          if (connected.status === 'connected' && connected.account) {
            const nextAccounts = workingAccounts.filter(
              (entry) => normalizeProvider(entry.provider) !== provider
            );
            nextAccounts.push(connected.account);
            workingAccounts.splice(0, workingAccounts.length, ...nextAccounts);
            account = connected.account;
          } else {
            actions.push({
              attachmentId: planned.attachment.id,
              endpointTransport: endpoint.transport,
              provider,
              status: 'pending-auth',
              accountId: connected.account?.id ?? connected.authSession?.accountId,
              suggestedLocalPath,
              usedCredentialBootstrap,
              detail:
                connected.authSession?.detail ||
                `Finish ${provider || 'provider'} sign-in to continue attaching this route.`,
            });
            continue;
          }
        } catch (error) {
          actions.push({
            attachmentId: planned.attachment.id,
            endpointTransport: endpoint.transport,
            provider,
            status: 'needs-account',
            suggestedLocalPath,
            usedCredentialBootstrap: true,
            detail: error instanceof Error ? error.message : selected.reason,
          });
          continue;
        }
      }

      if (!account) {
        actions.push({
          attachmentId: planned.attachment.id,
          endpointTransport: endpoint.transport,
          provider,
          status: 'needs-account',
          suggestedLocalPath,
          detail: selected.reason,
        });
        continue;
      }

      const matchKey = endpointMatchKey(endpoint);
      let share = workingShares.find((entry) =>
        buildManagedShareMatchKeys(entry).has(matchKey ?? '')
      );

      if (!share && input.volumeId) {
        const created = await this.acceptManagedShare({
          provider,
          accountId: account.id,
          label: planned.attachment.label,
          volumeId: input.volumeId,
          localPath: suggestedLocalPath,
          remoteDescriptor: endpoint.descriptor,
        });
        share = created.share;
        workingShares.push(created.share);
      } else if (share && input.volumeId) {
        const existingShare = share;
        const existingShareId = existingShare.id;
        await this.adapters.get(provider)?.ensureSync?.(existingShare, account).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.runtime.logger.warn(`Managed share sync bootstrap failed for ${existingShareId}: ${message}`);
        });
        await this.attachManagedShare(existingShareId, { volumeId: input.volumeId });
      }

      actions.push({
        attachmentId: planned.attachment.id,
        endpointTransport: endpoint.transport,
        provider,
        accountId: account.id,
        status: share && input.volumeId ? 'attached' : 'planned',
        shareId: share?.id,
        suggestedLocalPath,
        usedCredentialBootstrap,
        detail: share
          ? input.volumeId
            ? usedCredentialBootstrap
              ? 'Connected the provider from this link and attached the managed share to this hub.'
              : 'Attached the managed share to this hub.'
            : 'Matched an existing managed share.'
          : 'A connected provider is available for this route.',
      });
    }

    return {
      plan: parsed.plan,
      space: parsed.space,
      secret: joinLinkSpaceToSecretString(parsed.space),
      volumeId: input.volumeId ?? null,
      actions,
    };
  }

  private parseJoinLinkInput(serialized: string | undefined, link: unknown): JoinLink {
    if (typeof serialized === 'string' && serialized.trim() !== '') {
      const parsed = parseJoinLinkJson(serialized);
      if (!parsed) {
        throw new ManagedShareServiceError(400, 'INVALID_JOIN_LINK', 'Join link JSON is invalid');
      }
      return parsed;
    }
    if (link !== undefined) {
      try {
        return parseJoinLink(link);
      } catch (error) {
        throw new ManagedShareServiceError(
          400,
          'INVALID_JOIN_LINK',
          error instanceof Error ? error.message : 'Join link is invalid'
        );
      }
    }
    throw new ManagedShareServiceError(400, 'INVALID_JOIN_LINK', 'Join link payload is required');
  }

  private async buildManagedShareSummary(
    share: ManagedShare,
    options: {
      readonly config?: RootsConfig;
      readonly runtime?: MultiRootRuntimeSnapshot;
      readonly state?: IntegrationStateSnapshot;
      readonly preferFastRemoteDetails?: boolean;
      readonly skipAncillaryRemoteDetails?: boolean;
      readonly skipRemoteChecks?: boolean;
    } = {}
  ): Promise<ManagedShareSummary> {
    const config = options.config ?? this.options.storage.getRootsConfig();
    const runtime = options.runtime ?? (await this.options.storage.getRuntimeSnapshot({ includeUsage: false }));
    const state = options.state ?? (await this.loadState());
    const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
    const fallbackState = this.fallbackTransportState(share, runtime, account);
    const fallbackCollaborators = this.fallbackCollaborators(share);
    const preferFastRemoteDetails = options.preferFastRemoteDetails === true;
    const skipAncillaryRemoteDetails = options.skipAncillaryRemoteDetails === true;
    const skipRemoteChecks = options.skipRemoteChecks === true;
    const transportStateTimeoutMs = preferFastRemoteDetails
      ? FAST_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS
      : normalizeProvider(share.provider) === 'mega'
        ? FULL_MEGA_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS
        : FULL_MANAGED_SHARE_TRANSPORT_STATE_TIMEOUT_MS;
    if (skipRemoteChecks) {
      return {
        share,
        attachments: computeManagedShareAttachments(config, share),
        state: fallbackState,
        collaborators: fallbackCollaborators,
        storage: summarizeManagedShareStorage(config, runtime, share, undefined),
      };
    }
    const [remoteMetrics, transportState, collaborators] = await Promise.all([
      skipAncillaryRemoteDetails
        ? Promise.resolve(undefined)
        : this.withSoftTimeout(
            this.resolveShareStorageMetrics(share),
            undefined,
            1_500,
            `Managed share metrics timed out for ${share.id}`
          ),
      this.withSoftTimeout(
        this.resolveTransportState(share, runtime, state),
        this.buildTimedOutTransportState(share, fallbackState),
        transportStateTimeoutMs,
        `Managed share state timed out for ${share.id}`
      ),
      skipAncillaryRemoteDetails
        ? Promise.resolve(fallbackCollaborators)
        : this.withSoftTimeout(
            this.resolveShareCollaborators(share, state),
            fallbackCollaborators,
            1_500,
            `Managed share collaborators timed out for ${share.id}`
          ),
    ]);
    return {
      share,
      attachments: computeManagedShareAttachments(config, share),
      state: transportState,
      collaborators,
      storage: summarizeManagedShareStorage(config, runtime, share, remoteMetrics),
    };
  }

  private async resolveTransportState(
    share: ManagedShare,
    runtime?: MultiRootRuntimeSnapshot,
    stateSnapshot?: IntegrationStateSnapshot
  ): Promise<TransportState> {
    const snapshot = runtime ?? (await this.options.storage.getRuntimeSnapshot({ includeUsage: false }));
    const status = share.sourceId ? snapshot.sources.find((entry) => entry.id === share.sourceId) : undefined;
    const adapter = this.adapters.get(normalizeProvider(share.provider));
    const state = stateSnapshot ?? (await this.loadState());
    const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
    if (!status) {
      return {
        status: 'attention',
        detail: 'The local share folder is not attached yet.',
        badges: ['Repair'],
      };
    }
    if (!status.exists || !status.isDirectory) {
      return {
        status: 'attention',
        detail: 'The local share folder is missing or invalid.',
        badges: ['Repair'],
      };
    }
    if (this.syncBootstrapTasks.has(share.id)) {
      return this.buildSyncBootstrapState(share);
    }
    if (adapter?.getState) {
      try {
        return await adapter.getState(share, account);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: /login|session|auth|connected/i.test(message) ? 'needs-auth' : 'attention',
          detail: message,
          badges: [/login|session|auth|connected/i.test(message) ? 'Reconnect' : 'Repair'],
        };
      }
    }
    return {
      status: 'ready',
      detail: 'Local share folder is attached and ready.',
      badges: ['Share'],
    };
  }

  private async resolveShareStorageMetrics(share: ManagedShare): Promise<ShareStorageMetrics | undefined> {
    const adapter = this.adapters.get(normalizeProvider(share.provider));
    if (!adapter?.getShareStorageMetrics) {
      return undefined;
    }
    const state = await this.loadState();
    const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
    try {
      return await adapter.getShareStorageMetrics(share, account);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runtime.logger.warn(`Managed share metrics failed for ${share.id}: ${message}`);
      return undefined;
    }
  }

  private async resolveShareCollaborators(
    share: ManagedShare,
    stateSnapshot?: IntegrationStateSnapshot
  ): Promise<ManagedShareCollaborator[]> {
    const adapter = this.adapters.get(normalizeProvider(share.provider));
    const state = stateSnapshot ?? (await this.loadState());
    const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
    const byKey = new Map<string, ManagedShareCollaborator>();

    if (adapter?.getCollaborators) {
      try {
        for (const collaborator of await adapter.getCollaborators(share, account)) {
          const key =
            collaborator.email?.trim().toLowerCase() ||
            (typeof collaborator.label === 'string' ? collaborator.label.trim().toLowerCase() : '');
          if (key) {
            byKey.set(key, collaborator);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.runtime.logger.warn(`Managed share collaborator lookup failed for ${share.id}: ${message}`);
      }
    }

    for (const email of share.invitationEmails) {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || byKey.has(normalizedEmail)) {
        continue;
      }
      byKey.set(normalizedEmail, {
        label: email.trim(),
        email: email.trim(),
        status: 'invited',
        source: 'nearbytes',
      });
    }

    return Array.from(byKey.values()).sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'active' ? -1 : 1;
      }
      return (left.email ?? left.label).localeCompare(right.email ?? right.label);
    });
  }

  private async loadState(): Promise<IntegrationStateSnapshot> {
    return loadIntegrationState(this.integrationStatePath);
  }

  private async repairManagedShareState(stateSnapshot: IntegrationStateSnapshot): Promise<IntegrationStateSnapshot> {
    let state = stateSnapshot;
    const activeSourceManagedShareIds = new Set(
      this.options.storage
        .getRootsConfig()
        .sources
        .map((source) => source.integration?.managedShareId?.trim())
        .filter((value): value is string => Boolean(value))
    );
    const dedupedShares = dedupeManagedShares(state.managedShares, activeSourceManagedShareIds);
    if (!sameManagedShareIds(state.managedShares, dedupedShares)) {
      state = {
        ...state,
        managedShares: dedupedShares,
      };
      await this.saveState(state);
    }

    for (const account of state.accounts) {
      if (normalizeProvider(account.provider) !== 'mega') {
        continue;
      }
      let relocatedRecipient = false;
      const shares = state.managedShares.filter((share) => share.accountId === account.id);
      for (const share of shares) {
        let currentShare = state.managedShares.find((entry) => entry.id === share.id) ?? share;
        const repairedOwner = await this.repairMegaOwnerBaseShareIfNeeded(currentShare, account, state);
        if (repairedOwner !== state) {
          state = repairedOwner;
          currentShare = state.managedShares.find((entry) => entry.id === share.id) ?? currentShare;
        }
        const normalized = await this.repairMegaIncomingRecipientShareIfNeeded(currentShare, state);
        if (normalized !== state) {
          state = normalized;
          currentShare = state.managedShares.find((entry) => entry.id === share.id) ?? currentShare;
        }
        const repaired = await this.relocateMegaRecipientShareIfNeeded(currentShare, account, state);
        if (repaired !== state) {
          relocatedRecipient = true;
          state = repaired;
        }
      }
      if (relocatedRecipient) {
        await this.ensureDefaultManagedShare('mega', account, {
          stateSnapshot: state,
          createMissing: true,
        });
        state = await this.loadState();
      }
    }

    return state;
  }

  private async prepareManagedShareForSync(shareId: string): Promise<{
    state: IntegrationStateSnapshot;
    share: ManagedShare;
    nextShare: ManagedShare;
    account: ProviderAccount | null;
    adapter: TransportAdapter | undefined;
  }> {
    const state = await this.loadState();
    const share = state.managedShares.find((entry) => entry.id === shareId);
    if (!share) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }

    const adapter = this.adapters.get(normalizeProvider(share.provider));
    const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
    const localPath = path.resolve(share.localPath);
    await ensureMirrorFolder(localPath);

    const currentConfig = cloneConfig(this.options.storage.getRootsConfig());
    const currentConfigSignature = JSON.stringify(currentConfig);
    const { config: nextConfig, sourceId } = ensureManagedShareSource(currentConfig, share, localPath);
    const nextConfigSignature = JSON.stringify(nextConfig);
    const nextShare =
      share.sourceId === sourceId
        ? share
        : {
            ...share,
            sourceId,
            updatedAt: this.runtime.now(),
          };

    if (nextConfigSignature !== currentConfigSignature) {
      await this.persistRootsConfig(nextConfig);
    }
    if (nextShare !== share) {
      await this.saveState({
        ...state,
        managedShares: state.managedShares.map((entry) => (entry.id === shareId ? nextShare : entry)),
      });
    }

    return {
      state,
      share,
      nextShare,
      account,
      adapter,
    };
  }

  private async saveState(snapshot: IntegrationStateSnapshot): Promise<void> {
    await saveIntegrationState(snapshot, this.integrationStatePath);
  }

  private async persistRootsConfig(config: RootsConfig): Promise<void> {
    await saveRootsConfig(this.options.rootsConfigPath, config);
    this.options.storage.updateRootsConfig(config);
    this.options.storage.scheduleReconcileConfiguredVolumes();
    await ensureNearbytesMarkers(config.sources);
  }

  private async ensureDefaultManagedShare(
    provider: string,
    account: ProviderAccount,
    options: {
      readonly stateSnapshot?: IntegrationStateSnapshot;
      readonly createMissing?: boolean;
    } = {}
  ): Promise<void> {
    if (provider !== 'mega') {
      return;
    }

    const state = options.stateSnapshot ?? (await this.loadState());
    const existing = state.managedShares.find((share) =>
      normalizeProvider(share.provider) === 'mega' &&
      share.accountId === account.id &&
      isMegaOwnerBaseShare(share)
    );
    if (existing) {
      return;
    }
    if (options.createMissing !== true) {
      return;
    }

    const localPath = path.resolve(
      resolveManagedShareLocalPath(
        this.mirrorRoot,
        'mega',
        account,
        'nearbytes',
        'share-mega-legacy-placeholder',
        {
          remotePath: '/nearbytes',
          shareName: 'nearbytes',
          legacyLocalMirror: true,
        },
        'owner'
      )
    );
    const inspection = await inspectNearbytesRoot(localPath);
    await ensureMirrorFolder(localPath);
    await normalizeNearbytesRoot(localPath);

    const shareId = createId('share', 'mega', state.managedShares.length + 1);
    const recoveredShare: ManagedShare = {
      id: shareId,
      provider: 'mega',
      accountId: account.id,
      label: 'nearbytes',
      role: 'owner',
      localPath,
      sourceId: undefined,
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
        ...(inspection ? { legacyLocalMirror: true } : {}),
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: this.runtime.now(),
      updatedAt: this.runtime.now(),
    };

    const { config, sourceId } = ensureManagedShareSource(
      cloneConfig(this.options.storage.getRootsConfig()),
      recoveredShare,
      localPath
    );
    await this.persistRootsConfig(config);
    await this.saveState({
      ...state,
      managedShares: [...state.managedShares, { ...recoveredShare, sourceId }],
    });
  }

  private async repairMegaOwnerBaseShareIfNeeded(
    share: ManagedShare,
    account: ProviderAccount,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<IntegrationStateSnapshot> {
    if (!isMegaOwnerBaseShare(share)) {
      return stateSnapshot;
    }

    const expectedLocalPath = path.resolve(
      resolveManagedShareLocalPath(
        this.mirrorRoot,
        'mega',
        account,
        share.label,
        share.id,
        share.remoteDescriptor,
        share.role
      )
    );
    const providerRoot = path.resolve(resolveProviderManagedShareRoot(this.mirrorRoot, 'mega', account));
    const currentLocalPath = path.resolve(share.localPath);

    if (normalizeComparablePath(currentLocalPath) !== normalizeComparablePath(expectedLocalPath)) {
      await relocateMegaOwnerBaseShareRoot(currentLocalPath, expectedLocalPath, providerRoot);
      const { config: nextConfig, sourceId } = ensureManagedShareSource(
        cloneConfig(this.options.storage.getRootsConfig()),
        {
          ...share,
          localPath: expectedLocalPath,
        },
        expectedLocalPath
      );
      const nextShare: ManagedShare = {
        ...share,
        localPath: expectedLocalPath,
        sourceId,
        updatedAt: this.runtime.now(),
      };
      const nextState: IntegrationStateSnapshot = {
        ...stateSnapshot,
        managedShares: stateSnapshot.managedShares.map((entry) => (entry.id === share.id ? nextShare : entry)),
      };
      await this.persistRootsConfig(nextConfig);
      await this.saveState(nextState);
      stateSnapshot = nextState;
    }

    const currentShare = stateSnapshot.managedShares.find((entry) => entry.id === share.id) ?? share;
    const attached = computeManagedShareAttachments(this.options.storage.getRootsConfig(), currentShare);
    if (attached.length === 0 && currentShare.remoteDescriptor.legacyLocalMirror === true) {
      const nextConfig = await this.attachTrackedLocalVolumesToMegaOwnerBaseShare(currentShare);
      if (nextConfig) {
        stateSnapshot = await this.loadState();
      }
    }

    await normalizeMegaOwnerBaseShareRoot(expectedLocalPath, providerRoot);
    return stateSnapshot;
  }

  private async attachTrackedLocalVolumesToMegaOwnerBaseShare(
    share: ManagedShare
  ): Promise<RootsConfig | null> {
    const sourceId =
      share.sourceId ??
      this.options.storage.getRootsConfig().sources.find((source) => source.integration?.managedShareId === share.id)?.id;
    if (!sourceId) {
      return null;
    }

    const trackedVolumeIds = await collectTrackedVolumeIdsFromNonManagedRoots(
      this.options.storage.getRootsConfig().sources,
      sourceId
    );
    if (trackedVolumeIds.length === 0) {
      return null;
    }

    let nextConfig = cloneConfig(this.options.storage.getRootsConfig());
    let changed = false;
    for (const volumeId of trackedVolumeIds) {
      const updated = ensureVolumeAttachment(nextConfig, volumeId, sourceId);
      if (updated !== nextConfig) {
        nextConfig = updated;
        changed = true;
      }
    }
    if (!changed) {
      return null;
    }

    await this.persistRootsConfig(nextConfig);
    return nextConfig;
  }

  private async relocateMegaRecipientShareIfNeeded(
    share: ManagedShare,
    account: ProviderAccount,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<IntegrationStateSnapshot> {
    if (normalizeProvider(share.provider) !== 'mega' || share.role !== 'recipient') {
      return stateSnapshot;
    }

    const providerRoot = path.resolve(resolveProviderManagedShareRoot(this.mirrorRoot, 'mega', account));
    if (normalizeComparablePath(share.localPath) !== normalizeComparablePath(providerRoot)) {
      return stateSnapshot;
    }

    const expectedLocalPath = path.resolve(
      resolveManagedShareLocalPath(
        this.mirrorRoot,
        'mega',
        account,
        share.label,
        share.id,
        share.remoteDescriptor,
        share.role
      )
    );
    if (normalizeComparablePath(share.localPath) === normalizeComparablePath(expectedLocalPath)) {
      return stateSnapshot;
    }

    const nextShare: ManagedShare = {
      ...share,
      localPath: expectedLocalPath,
      updatedAt: this.runtime.now(),
    };
    const { config: nextConfig, sourceId } = ensureManagedShareSource(
      cloneConfig(this.options.storage.getRootsConfig()),
      nextShare,
      expectedLocalPath
    );
    const relocatedShare = {
      ...nextShare,
      sourceId,
    };
    const nextState: IntegrationStateSnapshot = {
      ...stateSnapshot,
      managedShares: stateSnapshot.managedShares.map((entry) => (entry.id === share.id ? relocatedShare : entry)),
    };

    await ensureMirrorFolder(expectedLocalPath);
    await this.persistRootsConfig(nextConfig);
    await this.saveState(nextState);

    if (this.isOperationalAccount(account)) {
      await this.adapters.get(normalizeProvider(share.provider))?.ensureSync?.(relocatedShare, account).catch(() => {
        // Ignore sync relocation failures here; the repaired local path is still persisted.
      });
    }

    return nextState;
  }

  private async repairMegaIncomingRecipientShareIfNeeded(
    share: ManagedShare,
    stateSnapshot: IntegrationStateSnapshot
  ): Promise<IntegrationStateSnapshot> {
    if (
      normalizeProvider(share.provider) !== 'mega' ||
      share.role !== 'recipient' ||
      !isMegaIncomingRemotePath(getManagedShareRemotePath('mega', share.remoteDescriptor))
    ) {
      return stateSnapshot;
    }

    const liveSyncIncomingShare = supportsLiveSyncForMegaIncomingShare(share);
    const nextCapabilities = uniqueStrings(
      share.capabilities.filter((capability) => capability !== 'invite' && (liveSyncIncomingShare || capability !== 'write'))
    );
    const normalizedCapabilities = uniqueStrings([
      'mirror',
      'read',
      liveSyncIncomingShare ? 'write' : 'accept',
      ...nextCapabilities,
      ...(liveSyncIncomingShare ? ['accept'] : []),
    ]);
    const capabilitiesChanged =
      normalizedCapabilities.length !== share.capabilities.length ||
      normalizedCapabilities.some((capability, index) => capability !== share.capabilities[index]);

    const nextShare = capabilitiesChanged
      ? {
          ...share,
          capabilities: normalizedCapabilities,
          updatedAt: this.runtime.now(),
        }
      : share;

    const currentConfig = cloneConfig(this.options.storage.getRootsConfig());
    const currentConfigSignature = JSON.stringify(currentConfig);
    const { config: nextConfig, sourceId } = ensureManagedShareSource(
      currentConfig,
      nextShare,
      path.resolve(nextShare.localPath)
    );
    const nextConfigSignature = JSON.stringify(nextConfig);
    const repairedShare =
      nextShare.sourceId === sourceId
        ? nextShare
        : {
            ...nextShare,
            sourceId,
            updatedAt: this.runtime.now(),
          };

    if (!capabilitiesChanged && nextConfigSignature === currentConfigSignature && repairedShare === share) {
      return stateSnapshot;
    }

    if (nextConfigSignature !== currentConfigSignature) {
      await this.persistRootsConfig(nextConfig);
    }

    const nextState: IntegrationStateSnapshot = {
      ...stateSnapshot,
      managedShares: stateSnapshot.managedShares.map((entry) => (entry.id === share.id ? repairedShare : entry)),
    };
    await this.saveState(nextState);
    return nextState;
  }

  private upsertConnectedAccount(
    state: IntegrationStateSnapshot,
    existing: ProviderAccount | undefined,
    candidate: Omit<ProviderAccount, 'createdAt' | 'updatedAt'>
  ): { accounts: ProviderAccount[]; account: ProviderAccount } {
    const now = this.runtime.now();
    const nextAccount: ProviderAccount = existing
      ? {
          ...existing,
          ...candidate,
          createdAt: existing.createdAt,
          updatedAt: now,
        }
      : {
          ...candidate,
          createdAt: now,
          updatedAt: now,
        };
    return {
      account: nextAccount,
      accounts: existing
        ? state.accounts.map((account) => (account.id === existing.id ? nextAccount : account))
        : [...state.accounts, nextAccount],
    };
  }

  private withAccountPresentationState(
    state: IntegrationStateSnapshot,
    accountId: string,
    nextPresentationState: ProviderAccount['state'],
    detail?: string
  ): IntegrationStateSnapshot {
    let changed = false;
    const accounts = state.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }
      const nextDetail =
        nextPresentationState === 'attention'
          ? detail?.trim() || account.detail
          : detail?.trim() || (account.state === 'attention' ? `${defaultProviderLabel(account.provider)} is connected.` : account.detail);
      if (account.state === nextPresentationState && (account.detail ?? '') === (nextDetail ?? '')) {
        return account;
      }
      changed = true;
      return {
        ...account,
        state: nextPresentationState,
        detail: nextDetail,
        updatedAt: this.runtime.now(),
      };
    });
    if (!changed) {
      return state;
    }
    return {
      ...state,
      accounts,
    };
  }
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

function describeMegaAccountRecovery(message: string): string {
  const normalized = message.trim();
  if (/MEGA API error -16|blocked|account locked|credential stuffing/i.test(normalized)) {
    return `MEGA says this account is locked. Unlock it on mega.io, complete the password-change flow, then reconnect it in Nearbytes. ${normalized}`.trim();
  }
  if (/MEGA API error -15|bad session|session id/i.test(normalized)) {
    return `MEGA revoked the saved session. If the account was security-locked, finish the unlock and password-change flow on mega.io, then reconnect it in Nearbytes. ${normalized}`.trim();
  }
  return `Reconnect this MEGA account to resume incoming-share discovery. ${normalized}`.trim();
}

function dedupeManagedShareMirrors(
  mirrors: readonly ManagedShareMirrorEntry[],
  provider: string
): ManagedShareMirrorEntry[] {
  const unique = new Map<string, ManagedShareMirrorEntry>();
  for (const mirror of mirrors) {
    const remotePath = normalizeManagedShareRemotePath(provider, mirror.remotePath);
    if (!remotePath || unique.has(remotePath)) {
      continue;
    }
    unique.set(remotePath, {
      label: typeof mirror.label === 'string' ? mirror.label.trim() : '',
      localPath: path.resolve(mirror.localPath),
      remotePath,
    });
  }
  return Array.from(unique.values());
}

function getManagedShareRemotePath(provider: string, descriptor: Record<string, unknown>): string | null {
  const remotePath = typeof descriptor.remotePath === 'string' ? descriptor.remotePath.trim() : '';
  if (!remotePath) {
    return null;
  }
  return normalizeManagedShareRemotePath(provider, remotePath);
}

function normalizeManagedShareRemotePath(provider: string, remotePath: string): string {
  if (normalizeProvider(provider) === 'mega') {
    const normalized = path.posix.normalize(remotePath.trim().replace(/\\/g, '/')).replace(/\/+$/u, '');
    return (normalized || '/').toLowerCase();
  }
  return remotePath.trim().toLowerCase();
}

function isManagedMirrorRemotePath(remotePath: string, remoteBasePath: string): boolean {
  const normalizedRemote = normalizeManagedShareRemotePath('mega', remotePath);
  const normalizedBase = normalizeManagedShareRemotePath('mega', remoteBasePath);
  return normalizedRemote === normalizedBase || normalizedRemote.startsWith(`${normalizedBase}/`);
}

function mergeManagedShareMirrorDescriptor(
  provider: string,
  current: Record<string, unknown> | undefined,
  mirror: ManagedShareMirrorEntry,
  shareId: string
): Record<string, unknown> {
  const descriptor: Record<string, unknown> = {
    ...(current ?? {}),
    remotePath: normalizeManagedShareRemotePath(provider, mirror.remotePath),
    managedShareId: shareId,
  };
  if (provider === 'mega') {
    descriptor.shareName =
      (typeof mirror.label === 'string' ? mirror.label.trim() : '') ||
      defaultProviderMirrorLabel(provider, mirror.remotePath);
  }
  return descriptor;
}

function defaultProviderLabel(provider: string): string {
  if (provider === 'gdrive') return 'Google Drive';
  if (provider === 'mega') return 'MEGA';
  if (provider === 'github') return 'GitHub';
  return provider;
}

function defaultProviderMirrorLabel(provider: string, remotePath: string): string {
  if (provider === 'mega') {
    const normalized = normalizeManagedShareRemotePath(provider, remotePath);
    const base = normalized === '/' ? '' : path.posix.basename(normalized);
    return base || 'nearbytes';
  }
  return defaultProviderLabel(provider);
}

function createId(prefix: string, provider: string, serial: number): string {
  return `${prefix}-${provider}-${serial}-${Math.random().toString(16).slice(2, 8)}`;
}

function nextLocalSourceId(config: RootsConfig): string {
  const existing = new Set(config.sources.map((source) => source.id));
  const prefix = 'src-local';
  let counter = config.sources.length + 1;
  while (existing.has(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
}

function createMirrorFolderName(provider: string, label: string, shareId: string): string {
  const base = sanitizeManagedFolderLabel(label) || `${defaultProviderLabel(provider)} share`;
  return `${base} ${shareId.slice(-6)}`.trim();
}

function resolveManagedShareLocalPath(
  managedShareBaseRoot: string,
  provider: string,
  account: ProviderAccount,
  label: string,
  shareId: string,
  remoteDescriptor?: Record<string, unknown>,
  role: ManagedShare['role'] = 'owner'
): string {
  const providerRoot = resolveProviderManagedShareRoot(managedShareBaseRoot, provider, account, remoteDescriptor, role);
  if (isProviderBaseShare(label, remoteDescriptor, role)) {
    return path.join(providerRoot, MEGA_BASE_SHARE_FOLDER_NAME);
  }
  return path.join(providerRoot, createMirrorFolderName(provider, label, shareId));
}

function resolveProviderManagedShareRoot(
  managedShareBaseRoot: string,
  provider: string,
  account: ProviderAccount,
  remoteDescriptor?: Record<string, unknown>,
  role: ManagedShare['role'] = 'owner'
): string {
  const providerRoot = path.join(managedShareBaseRoot, getProviderStorageFolderName(provider));
  if (provider === 'mega') {
    if (role === 'recipient') {
      const ownerEmail = typeof remoteDescriptor?.ownerEmail === 'string' ? remoteDescriptor.ownerEmail.trim() : '';
      if (ownerEmail) {
        return path.join(providerRoot, createManagedShareIdentityFolderName(ownerEmail));
      }
    }
    return path.join(providerRoot, createManagedShareAccountFolderName(account));
  }
  return providerRoot;
}

function createManagedShareAccountFolderName(account: ProviderAccount): string {
  const candidate = sanitizeManagedFolderLabel(account.email?.trim() || account.id.trim() || account.label?.trim()).toLowerCase();
  return candidate.replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || account.id.trim().toLowerCase();
}

function createManagedShareIdentityFolderName(value: string): string {
  const candidate = sanitizeManagedFolderLabel(value.trim()).toLowerCase();
  return candidate.replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'mega-account';
}

function isProviderBaseShare(
  label: string,
  remoteDescriptor?: Record<string, unknown>,
  role: ManagedShare['role'] = 'owner'
): boolean {
  if (role !== 'owner') {
    return false;
  }
  const normalizedLabel = sanitizeManagedFolderLabel(label).toLowerCase();
  const shareName = typeof remoteDescriptor?.shareName === 'string' ? remoteDescriptor.shareName.trim().toLowerCase() : '';
  const remotePath =
    typeof remoteDescriptor?.remotePath === 'string'
      ? remoteDescriptor.remotePath.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
      : '';
  const ownerEmail =
    typeof remoteDescriptor?.ownerEmail === 'string' ? remoteDescriptor.ownerEmail.trim().toLowerCase() : '';
  if (remotePath === '/nearbytes') {
    return true;
  }
  if (ownerEmail) {
    return false;
  }
  return normalizedLabel === 'nearbytes' || shareName === 'nearbytes';
}

function isMegaOwnerBaseShare(share: ManagedShare): boolean {
  return normalizeProvider(share.provider) === 'mega' &&
    share.role === 'owner' &&
    getManagedShareRemotePath('mega', share.remoteDescriptor) === '/nearbytes';
}

function sanitizeManagedFolderLabel(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .slice(0, 56)
    .trim();
}

async function ensureMirrorFolder(localPath: string): Promise<void> {
  await fs.mkdir(path.join(localPath, 'blocks'), { recursive: true });
  await fs.mkdir(path.join(localPath, 'channels'), { recursive: true });
}

async function relocateMegaOwnerBaseShareRoot(
  sourceRoot: string,
  canonicalRoot: string,
  providerRoot: string
): Promise<void> {
  await ensureMirrorFolder(canonicalRoot);
  await normalizeNearbytesRoot(canonicalRoot);
  const entries = await readDirectoryEntries(sourceRoot);
  for (const entry of entries) {
    if (entry.name === path.basename(canonicalRoot)) {
      continue;
    }
    const sourcePath = path.join(sourceRoot, entry.name);
    if (isMegaCanonicalEntryName(entry.name)) {
      await mergePathIntoCanonicalMegaRoot(sourcePath, path.join(canonicalRoot, entry.name));
      continue;
    }
    await moveEntryToMegaDebris(sourcePath, providerRoot, entry.name);
  }
}

async function normalizeMegaOwnerBaseShareRoot(canonicalRoot: string, providerRoot: string): Promise<void> {
  await ensureMirrorFolder(canonicalRoot);
  await normalizeNearbytesRoot(canonicalRoot);
  const entries = await readDirectoryEntries(canonicalRoot);
  for (const entry of entries) {
    if (isMegaAllowedCanonicalEntry(entry.name, entry.isDirectory())) {
      continue;
    }
    const entryPath = path.join(canonicalRoot, entry.name);
    if (entry.isDirectory() && isNestedMegaShareRootName(entry.name)) {
      await drainNestedMegaShareRoot(entryPath, canonicalRoot, providerRoot);
      continue;
    }
    await moveEntryToMegaDebris(entryPath, providerRoot, `${path.basename(canonicalRoot)} ${entry.name}`);
  }
}

async function drainNestedMegaShareRoot(nestedRoot: string, canonicalRoot: string, providerRoot: string): Promise<void> {
  const nestedBlocks = path.join(nestedRoot, 'blocks');
  const nestedChannels = path.join(nestedRoot, 'channels');
  if (await isDirectoryPath(nestedBlocks)) {
    await mergePathIntoCanonicalMegaRoot(nestedBlocks, path.join(canonicalRoot, 'blocks'));
  }
  if (await isDirectoryPath(nestedChannels)) {
    await mergePathIntoCanonicalMegaRoot(nestedChannels, path.join(canonicalRoot, 'channels'));
  }
  try {
    await moveEntryToMegaDebris(nestedRoot, providerRoot, path.basename(nestedRoot));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
    if (code !== 'EPERM') {
      throw error;
    }
    await fs.rm(nestedRoot, { recursive: true, force: true });
  }
}

async function mergePathIntoCanonicalMegaRoot(sourcePath: string, targetPath: string): Promise<void> {
  const stats = await safeStatPath(sourcePath);
  if (!stats) {
    return;
  }
  if (stats.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true });
    const entries = await readDirectoryEntries(sourcePath);
    for (const entry of entries) {
      await mergePathIntoCanonicalMegaRoot(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
    }
    await fs.rm(sourcePath, { recursive: true, force: true });
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch {
    await fs.copyFile(sourcePath, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
}

async function copyIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await safeStatPath(sourcePath))) {
    return;
  }
  await copyPathIntoTarget(sourcePath, targetPath);
}

async function copyPathIntoTarget(sourcePath: string, targetPath: string): Promise<void> {
  const stats = await safeStatPath(sourcePath);
  if (!stats) {
    return;
  }
  if (stats.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true });
    const entries = await readDirectoryEntries(sourcePath);
    for (const entry of entries) {
      await copyPathIntoTarget(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
    }
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function moveEntryToMegaDebris(sourcePath: string, providerRoot: string, label: string): Promise<void> {
  const debrisRoot = path.join(providerRoot, '.debris');
  await fs.mkdir(debrisRoot, { recursive: true });
  const baseLabel = sanitizeMegaDebrisLabel(label);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = `${Date.now().toString(36)}${attempt === 0 ? '' : `-${attempt}`}`;
    const destination = path.join(debrisRoot, `${baseLabel} ${suffix}`.trim());
    try {
      await fs.rename(sourcePath, destination);
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
      if (code === 'ENOENT') {
        return;
      }
      if (code === 'EEXIST') {
        continue;
      }
      throw error;
    }
  }
}

function sanitizeMegaDebrisLabel(value: string): string {
  return value.replace(/[\\/]+/gu, ' ').replace(/\s+/gu, ' ').trim() || 'debris';
}

function isMegaCanonicalEntryName(name: string): boolean {
  return name === 'blocks' || name === 'channels' || name === 'Nearbytes.html' || name === '.nearbytes';
}

function isMegaAllowedCanonicalEntry(name: string, isDirectory: boolean): boolean {
  if (name === 'Nearbytes.html') {
    return !isDirectory;
  }
  if (name === 'blocks' || name === 'channels') {
    return isDirectory;
  }
  return false;
}

function isNestedMegaShareRootName(name: string): boolean {
  return /^nearbytes(?:\s|$)/iu.test(name);
}

async function readDirectoryEntries(dirPath: string): Promise<import('fs').Dirent[]> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function safeStatPath(targetPath: string): Promise<import('fs').Stats | null> {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function isDirectoryPath(targetPath: string): Promise<boolean> {
  const stats = await safeStatPath(targetPath);
  return Boolean(stats?.isDirectory());
}

function resolveManagedShareBaseRoot(config: RootsConfig): string {
  const preferredLocalSource =
    config.sources.find(
      (source) => source.enabled && normalizeProvider(source.provider) === 'local' && !isUnsafeManagedSharePath(source.path)
    ) ??
    config.sources.find(
      (source) => normalizeProvider(source.provider) === 'local' && !isUnsafeManagedSharePath(source.path)
    );
  const configuredStorageRoot = path.resolve(getDefaultStorageDir());
  const fallbackBaseRoot = isUnsafeManagedSharePath(configuredStorageRoot)
    ? getDefaultStorageHomeDir()
    : resolveStorageHomeDir(configuredStorageRoot);
  return preferredLocalSource ? resolveStorageHomeDir(preferredLocalSource.path) : fallbackBaseRoot;
}

function findPrimaryLocalSource(config: RootsConfig, excludingSourceId?: string): SourceConfigEntry | null {
  const eligible = config.sources.filter(
    (source) =>
      source.id !== excludingSourceId &&
      normalizeProvider(source.provider) === 'local' &&
      !isUnsafeManagedSharePath(source.path)
  );
  return (
    eligible.find((source) => source.enabled && source.writable) ??
    eligible.find((source) => source.enabled) ??
    eligible[0] ??
    null
  );
}

function isUnsafeManagedSharePath(targetPath: string): boolean {
  const currentWorkingDirectory = process.cwd?.();
  if (!currentWorkingDirectory || !targetPath.trim()) {
    return false;
  }
  return isPathInside(path.resolve(currentWorkingDirectory), path.resolve(targetPath));
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const normalizedParent = normalizeComparablePath(parentPath);
  const normalizedChild = normalizeComparablePath(childPath);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function normalizeComparablePath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/').replace(/\/+$/u, '');
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return normalized.toLowerCase();
  }
  return normalized;
}

function ensureManagedShareSource(
  config: RootsConfig,
  share: ManagedShare,
  localPath: string
): {
  config: RootsConfig;
  sourceId: string;
} {
  const existing =
    config.sources.find((source) => source.integration?.managedShareId === share.id) ??
    config.sources.find((source) => path.resolve(source.path) === localPath);
  const sourceId = existing?.id ?? nextManagedSourceId(config, share.provider);
  const nextSource: SourceConfigEntry = {
    id: sourceId,
    provider: mapProviderToSourceProvider(share.provider),
    path: localPath,
    enabled: existing?.enabled ?? true,
    writable: managedShareAllowsWrites(share),
    reservePercent: existing?.reservePercent ?? 5,
    opportunisticPolicy: existing?.opportunisticPolicy ?? 'drop-older-blocks',
    integration: {
      kind: 'provider-managed',
      provider: share.provider,
      managedShareId: share.id,
    },
  };

  if (existing) {
    return {
      config: {
        ...config,
        sources: config.sources.map((source) => (source.id === existing.id ? nextSource : source)),
      },
      sourceId: existing.id,
    };
  }

  return {
    config: {
      ...config,
      sources: [...config.sources, nextSource],
    },
    sourceId,
  };
}

function summarizeManagedShareStorage(
  config: RootsConfig,
  runtime: MultiRootRuntimeSnapshot,
  share: ManagedShare,
  remoteMetrics?: ShareStorageMetrics
): ManagedShareSummary['storage'] {
  if (!share.sourceId) {
    return undefined;
  }
  const source = config.sources.find((entry) => entry.id === share.sourceId);
  const status = runtime.sources.find((entry) => entry.id === share.sourceId);
  const destination = config.defaultVolume.destinations.find((entry) => entry.sourceId === share.sourceId);
  return {
    sourcePath: source?.path,
    enabled: source?.enabled,
    writable: source?.writable,
    keepFullCopy: Boolean(
      destination?.enabled &&
      destination.storeEvents &&
      destination.storeBlocks &&
      destination.copySourceBlocks
    ),
    reservePercent:
      destination?.reservePercent ??
      source?.reservePercent,
    availableBytes: status?.availableBytes,
    usageTotalBytes: status?.usage.totalBytes,
    lastWriteFailureMessage: status?.lastWriteFailure?.message,
    remoteAvailableBytes: remoteMetrics?.remoteAvailableBytes,
    remoteTotalBytes: remoteMetrics?.remoteTotalBytes,
    remoteUsedBytes: remoteMetrics?.remoteUsedBytes,
  };
}

function mapProviderToSourceProvider(provider: string): RootProvider {
  if (provider === 'mega') return 'mega';
  if (provider === 'gdrive') return 'gdrive';
  if (provider === 'dropbox') return 'dropbox';
  if (provider === 'onedrive') return 'onedrive';
  if (provider === 'icloud') return 'icloud';
  return 'local';
}

function nextManagedSourceId(config: RootsConfig, provider: string): string {
  const existing = new Set(config.sources.map((source) => source.id));
  const prefix = `src-${provider}-managed`;
  let counter = config.sources.length + 1;
  while (existing.has(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
}

function ensureVolumeAttachment(config: RootsConfig, volumeId: string, sourceId: string): RootsConfig {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const existingPolicy = getExplicitVolumePolicy(config, normalizedVolumeId);
  if (existingPolicy?.destinations.some((destination) => destination.sourceId === sourceId)) {
    return config;
  }

  if (!existingPolicy) {
    return {
      ...config,
      volumes: [
        ...config.volumes,
        {
          volumeId: normalizedVolumeId,
          destinations: [
            {
              ...DEFAULT_DESTINATION,
              sourceId,
            },
          ],
        },
      ],
    };
  }

  return {
    ...config,
    volumes: config.volumes.map((volume) =>
      volume.volumeId === normalizedVolumeId
        ? {
            volumeId: volume.volumeId,
            destinations: [
              ...volume.destinations,
              {
                ...DEFAULT_DESTINATION,
                sourceId,
              },
            ],
          }
        : volume
    ),
  };
}

function cloneConfig(config: RootsConfig): RootsConfig {
  return {
    version: config.version,
    sources: config.sources.map((source) => ({ ...source })),
    defaultVolume: {
      destinations: config.defaultVolume.destinations.map((destination) => ({ ...destination })),
    },
    volumes: config.volumes.map((volume) => ({
      volumeId: volume.volumeId,
      destinations: volume.destinations.map((destination) => ({ ...destination })),
    })),
  };
}

function removeManagedShareFromConfig(config: RootsConfig, shareId: string): RootsConfig {
  const sourceIds = new Set(
    config.sources
      .filter((source) => source.integration?.managedShareId === shareId)
      .map((source) => source.id)
  );

  return {
    version: config.version,
    sources: config.sources.filter((source) => !sourceIds.has(source.id)),
    defaultVolume: {
      destinations: config.defaultVolume.destinations.filter((destination) => !sourceIds.has(destination.sourceId)),
    },
    volumes: config.volumes
      .map((volume) => ({
        volumeId: volume.volumeId,
        destinations: volume.destinations.filter((destination) => !sourceIds.has(destination.sourceId)),
      }))
      .filter((volume) => volume.destinations.length > 0),
  };
}

function computeManagedShareAttachments(config: RootsConfig, share: ManagedShare): ManagedShareAttachment[] {
  const sourceId =
    share.sourceId ??
    config.sources.find((source) => source.integration?.managedShareId === share.id)?.id;
  if (!sourceId) {
    return [];
  }

  const attachments: ManagedShareAttachment[] = [];
  for (const volume of config.volumes) {
    if (!volume.destinations.some((destination) => destination.sourceId === sourceId)) {
      continue;
    }
    attachments.push({
      id: `attach-${share.id}-${volume.volumeId}`,
      shareId: share.id,
      sourceId,
      volumeId: volume.volumeId,
      createdAt: share.createdAt,
    });
  }
  return attachments;
}

async function collectTrackedVolumeIdsFromNonManagedRoots(
  sources: readonly SourceConfigEntry[],
  excludedSourceId: string
): Promise<string[]> {
  const volumeIds = new Set<string>();
  for (const source of sources) {
    if (source.id === excludedSourceId || source.enabled !== true) {
      continue;
    }
    if (source.integration?.kind === 'provider-managed') {
      continue;
    }
    const channelsPath = path.join(source.path, 'channels');
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(channelsPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const volumeId = entry.name.trim().toLowerCase();
      if (/^[a-f0-9]{64,200}$/i.test(volumeId)) {
        volumeIds.add(volumeId);
      }
    }
  }
  return [...volumeIds].sort((left, right) => left.localeCompare(right));
}

function buildAttachedShareKeys(shares: readonly ManagedShare[]): Set<string> {
  const keys = new Set<string>();
  for (const share of shares) {
    for (const key of buildManagedShareMatchKeys(share)) {
      keys.add(key);
    }
  }
  return keys;
}

function buildManagedShareMatchKeys(share: ManagedShare): Set<string> {
  const keys = new Set<string>();
  keys.add(`managed:${share.id.toLowerCase()}`);
  if (typeof share.remoteDescriptor.managedShareId === 'string' && share.remoteDescriptor.managedShareId.trim() !== '') {
    keys.add(`managed:${share.remoteDescriptor.managedShareId.trim().toLowerCase()}`);
  }
  if (typeof share.remoteDescriptor.shareId === 'string' && share.remoteDescriptor.shareId.trim() !== '') {
    keys.add(`${share.provider}:share:${share.remoteDescriptor.shareId.trim().toLowerCase()}`);
  }
  if (typeof share.remoteDescriptor.remoteId === 'string' && share.remoteDescriptor.remoteId.trim() !== '') {
    keys.add(`${share.provider}:remote:${share.remoteDescriptor.remoteId.trim().toLowerCase()}`);
  }
  if (typeof share.remoteDescriptor.folderId === 'string' && share.remoteDescriptor.folderId.trim() !== '') {
    keys.add(`${share.provider}:remote:${share.remoteDescriptor.folderId.trim().toLowerCase()}`);
  }
  if (typeof share.remoteDescriptor.remotePath === 'string' && share.remoteDescriptor.remotePath.trim() !== '') {
    keys.add(`${share.provider}:path:${share.remoteDescriptor.remotePath.trim().toLowerCase()}`);
  }
  if (
    typeof share.remoteDescriptor.remotePathHint === 'string' &&
    share.remoteDescriptor.remotePathHint.trim() !== ''
  ) {
    keys.add(`${share.provider}:path:${share.remoteDescriptor.remotePathHint.trim().toLowerCase()}`);
  }
  const repositoryKey = buildRepositoryMatchKey(share.provider, share.remoteDescriptor);
  if (repositoryKey) {
    keys.add(repositoryKey);
  }
  return keys;
}

function managedShareAllowsWrites(share: ManagedShare): boolean {
  if (!share.capabilities.includes('write')) {
    return false;
  }
  if (
    normalizeProvider(share.provider) === 'mega' &&
    share.role === 'recipient' &&
    isMegaIncomingRemotePath(getManagedShareRemotePath('mega', share.remoteDescriptor)) &&
    !supportsLiveSyncForMegaIncomingShare(share)
  ) {
    return false;
  }
  return true;
}

function supportsLiveSyncForMegaIncomingShare(_share: ManagedShare): boolean {
  return false;
}

function buildRemoteDescriptorMatchKeys(provider: string, descriptor: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  if (typeof descriptor.remotePath === 'string' && descriptor.remotePath.trim() !== '') {
    keys.add(`${provider}:path:${descriptor.remotePath.trim().toLowerCase()}`);
  }
  if (typeof descriptor.remoteId === 'string' && descriptor.remoteId.trim() !== '') {
    keys.add(`${provider}:remote:${descriptor.remoteId.trim().toLowerCase()}`);
  }
  if (typeof descriptor.folderId === 'string' && descriptor.folderId.trim() !== '') {
    keys.add(`${provider}:remote:${descriptor.folderId.trim().toLowerCase()}`);
  }
  if (typeof descriptor.shareId === 'string' && descriptor.shareId.trim() !== '') {
    keys.add(`${provider}:share:${descriptor.shareId.trim().toLowerCase()}`);
  }
  const repositoryKey = buildRepositoryMatchKey(provider, descriptor);
  if (repositoryKey) {
    keys.add(repositoryKey);
  }
  return Array.from(keys.values());
}

function buildIncomingManagedShareOfferKeys(offer: IncomingManagedShareOffer): string[] {
  return buildRemoteDescriptorMatchKeys(offer.provider, offer.remoteDescriptor);
}

function findManagedShareByRemoteDescriptor(
  shares: readonly ManagedShare[],
  provider: string,
  accountId: string,
  remoteDescriptor: Record<string, unknown>
): ManagedShare | undefined {
  const matchKeys = buildRemoteDescriptorMatchKeys(provider, remoteDescriptor);
  if (matchKeys.length === 0) {
    return undefined;
  }
  return shares.find((share) =>
    normalizeProvider(share.provider) === provider &&
    share.accountId === accountId &&
    matchKeys.some((key) => buildManagedShareMatchKeys(share).has(key))
  );
}

function dedupeManagedShares(
  shares: readonly ManagedShare[],
  activeSourceManagedShareIds: ReadonlySet<string>
): ManagedShare[] {
  const unique = new Map<string, ManagedShare>();
  for (const share of shares) {
    const identity = primaryManagedShareIdentityKey(share);
    const existing = unique.get(identity);
    if (!existing) {
      unique.set(identity, share);
      continue;
    }
    unique.set(identity, pickPreferredManagedShare(existing, share, activeSourceManagedShareIds));
  }
  return Array.from(unique.values());
}

function sameManagedShareIds(left: readonly ManagedShare[], right: readonly ManagedShare[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((share, index) => share.id === right[index]?.id);
}

function primaryManagedShareIdentityKey(share: ManagedShare): string {
  const provider = normalizeProvider(share.provider);
  const firstMatchKey = buildRemoteDescriptorMatchKeys(provider, share.remoteDescriptor)[0];
  return `${provider}:${share.accountId}:${firstMatchKey ?? `managed:${share.id.toLowerCase()}`}`;
}

function pickPreferredManagedShare(
  left: ManagedShare,
  right: ManagedShare,
  activeSourceManagedShareIds: ReadonlySet<string>
): ManagedShare {
  const score = (share: ManagedShare): number =>
    (activeSourceManagedShareIds.has(share.id) ? 8 : 0) +
    (share.role === 'owner' ? 4 : 0) +
    (share.sourceId ? 2 : 0) +
    (share.capabilities.length > 0 ? 1 : 0);

  const leftScore = score(left);
  const rightScore = score(right);
  if (rightScore !== leftScore) {
    return rightScore > leftScore ? right : left;
  }
  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt > left.updatedAt ? right : left;
  }
  if (right.createdAt !== left.createdAt) {
    return right.createdAt < left.createdAt ? right : left;
  }
  return right.id.localeCompare(left.id) > 0 ? right : left;
}

function resolveJoinLinkSuggestedLocalPath(endpoint: import('./types.js').TransportEndpoint): string | undefined {
  const explicit = endpoint.bootstrap?.storage?.localPath?.trim();
  if (explicit) {
    return explicit;
  }
  const hint = endpoint.bootstrap?.storage?.localPathHint?.trim();
  return hint || undefined;
}

function buildRepositoryMatchKey(provider: string, descriptor: Record<string, unknown>): string | undefined {
  const repoFullName = typeof descriptor.repoFullName === 'string' ? descriptor.repoFullName.trim().toLowerCase() : '';
  const repoOwner = typeof descriptor.repoOwner === 'string' ? descriptor.repoOwner.trim().toLowerCase() : '';
  const repoName = typeof descriptor.repoName === 'string' ? descriptor.repoName.trim().toLowerCase() : '';
  const branch = typeof descriptor.branch === 'string' ? descriptor.branch.trim().toLowerCase() : '';
  const basePath = typeof descriptor.basePath === 'string' ? descriptor.basePath.trim().toLowerCase() : '';
  const repository = repoFullName || (repoOwner && repoName ? `${repoOwner}/${repoName}` : '');
  if (!repository) {
    return undefined;
  }
  return `${provider}:repo:${repository}:${branch}:${basePath}`;
}

function isMegaIncomingRemotePath(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? '';
  return normalized !== '' && !normalized.startsWith('/') && normalized.includes(':');
}

function mergePreferredProviders(existing: readonly string[], provider: string, preferred: boolean): string[] {
  if (!preferred) {
    return uniqueStrings(existing);
  }
  return uniqueStrings([...existing, provider]);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
