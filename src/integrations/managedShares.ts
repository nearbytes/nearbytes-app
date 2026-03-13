import { promises as fs } from 'fs';
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
import { ensureNearbytesMarkers } from '../config/sourceDiscovery.js';
import { joinLinkSpaceToSecretString, parseJoinLink, parseJoinLinkJson } from '../domain/joinLinkCodec.js';
import { MultiRootStorageBackend } from '../storage/multiRoot.js';
import type { MultiRootRuntimeSnapshot } from '../storage/multiRoot.js';
import { createDefaultTransportAdapters, createProviderCatalog, type TransportAdapter } from './adapters.js';
import { createPlannerContext, endpointMatchKey, planJoinLink } from './planner.js';
import { JsonFileSecretStore } from './secretStore.js';
import { createIntegrationRuntime, type IntegrationRuntime, type IntegrationRuntimeOptions } from './runtime.js';
import {
  loadIntegrationState,
  resolveIntegrationStatePath,
  saveIntegrationState,
  type IntegrationStateSnapshot,
} from './store.js';
import type {
  AcceptManagedShareInput,
  AttachManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  JoinLink,
  JoinLinkPlan,
  JoinLinkSpace,
  ManagedShare,
  ManagedShareAttachment,
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
}

export class ManagedShareService {
  private readonly adapters: Map<string, TransportAdapter>;
  private readonly integrationStatePath: string;
  private readonly mirrorRoot: string;
  private readonly runtime: IntegrationRuntime;

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
    this.mirrorRoot = path.resolve(options.mirrorRoot ?? path.join(path.dirname(this.integrationStatePath), 'mirrors'));
  }

  async listAccounts(): Promise<{
    accounts: ProviderAccount[];
    providers: ProviderCatalogEntry[];
    preferredProviders: string[];
  }> {
    const state = await this.loadState();
    await this.ensureDefaultManagedShares(state);
    await this.ensureManagedShareSyncs(state);
    const setupStates = await this.getProviderSetupStates();
    const refreshedState = await this.loadState();
    const accounts = refreshedState.accounts.filter((account) => isProviderEnabled(account.provider));
    return {
      accounts,
      providers: createProviderCatalog(Array.from(this.adapters.values()), refreshedState.accounts, setupStates),
      preferredProviders: refreshedState.preferredProviders.filter((provider) => isProviderEnabled(provider)),
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

    await this.ensureDefaultManagedShare(provider, merged.account.id);
    return {
      status: 'connected',
      account: merged.account,
    };
  }

  async disconnectAccount(accountId: string): Promise<void> {
    const state = await this.loadState();
    const account = state.accounts.find((entry) => entry.id === accountId);
    if (!account) {
      throw new ManagedShareServiceError(404, 'ACCOUNT_NOT_FOUND', `Provider account not found: ${accountId}`);
    }

    const shareIds = new Set(state.managedShares.filter((share) => share.accountId === accountId).map((share) => share.id));
    const ownedShares = state.managedShares.filter((share) => share.accountId === accountId);
    let config = cloneConfig(this.options.storage.getRootsConfig());
    for (const shareId of shareIds) {
      config = removeManagedShareFromConfig(config, shareId);
    }
    await this.persistRootsConfig(config);
    for (const share of ownedShares) {
      const adapter = this.adapters.get(normalizeProvider(share.provider));
      await adapter?.detachManagedShare?.(share, account).catch(() => {
        // Ignore cleanup failures when removing account state.
      });
    }
    await this.adapters.get(normalizeProvider(account.provider))?.disconnect?.(account).catch(() => {
      // Ignore provider-specific disconnect failures after config cleanup.
    });

    const remainingAccounts = state.accounts.filter((entry) => entry.id !== accountId);
    const remainingShares = state.managedShares.filter((share) => share.accountId !== accountId);
    const preferredProviders = state.preferredProviders.filter(
      (provider) => provider !== normalizeProvider(account.provider)
    );
    await this.saveState({
      ...state,
      accounts: remainingAccounts,
      managedShares: remainingShares,
      preferredProviders,
    });
  }

  async listManagedShares(): Promise<{ shares: ManagedShareSummary[] }> {
    const state = await this.loadState();
    await this.ensureDefaultManagedShares(state);
    await this.ensureManagedShareSyncs(state);
    const refreshedState = await this.loadState();
    const visibleShares = refreshedState.managedShares.filter((share) => isProviderEnabled(share.provider));
    return {
      shares: await Promise.all(visibleShares.map((share) => this.buildManagedShareSummary(share))),
    };
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
    const localPath = path.resolve(
      input.localPath ?? path.join(this.mirrorRoot, createMirrorFolderName(provider, input.label, shareId))
    );
    await ensureMirrorFolder(localPath);

    const initialDescriptor = {
      managedShareId: shareId,
      ...(input.remoteDescriptor ?? {}),
    };
    const providerOverlay: Partial<ManagedShare> = (await adapter?.createManagedShare?.(
      {
        ...input,
        localPath,
        remoteDescriptor: initialDescriptor,
      },
      account
    )) ?? {
      remoteDescriptor: initialDescriptor,
    };
    const remoteDescriptor = {
      ...initialDescriptor,
      ...(providerOverlay.remoteDescriptor ?? {}),
    };

    const share: ManagedShare = {
      id: shareId,
      provider,
      accountId: input.accountId,
      label: providerOverlay.label?.trim() || input.label.trim(),
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

    await this.saveState({
      ...state,
      managedShares: [...state.managedShares, nextShare],
    });
    await adapter?.ensureSync?.(nextShare, account);

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

  async acceptManagedShare(input: AcceptManagedShareInput): Promise<ManagedShareSummary> {
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
    const accepted = (await adapter?.acceptInvite?.(input, account)) ?? {};
    return this.createManagedShare({
      provider,
      accountId: input.accountId,
      label: accepted.label?.trim() || input.label,
      localPath: input.localPath,
      role: 'recipient',
      volumeId: input.volumeId,
      remoteDescriptor: {
        ...(input.remoteDescriptor ?? {}),
        ...(accepted.remoteDescriptor ?? {}),
      },
      capabilities: accepted.capabilities ?? ['mirror', 'read', 'write', 'accept'],
    });
  }

  async getManagedShareState(shareId: string): Promise<ManagedShareSummary> {
    const state = await this.loadState();
    await this.ensureManagedShareSyncs(state);
    const share = state.managedShares.find((entry) => entry.id === shareId);
    if (!share) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }
    if (!isProviderEnabled(share.provider)) {
      throw new ManagedShareServiceError(404, 'SHARE_NOT_FOUND', `Managed share not found: ${shareId}`);
    }
    return this.buildManagedShareSummary(share);
  }

  async handleProviderCallback(provider: string, query: URLSearchParams): Promise<string> {
    const adapter = this.adapters.get(normalizeProvider(provider));
    if (!adapter?.handleOAuthCallback) {
      throw new ManagedShareServiceError(404, 'UNKNOWN_PROVIDER', `No external callback is registered for ${provider}`);
    }
    return adapter.handleOAuthCallback(query);
  }

  private async ensureManagedShareSyncs(state: IntegrationStateSnapshot): Promise<void> {
    await Promise.all(
      state.managedShares.map(async (share) => {
        const account = state.accounts.find((entry) => entry.id === share.accountId);
        if (!account || account.state !== 'connected') {
          return;
        }
        await this.adapters.get(normalizeProvider(share.provider))?.ensureSync?.(share, account).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.runtime.logger.warn(`Managed share sync bootstrap failed for ${share.id}: ${message}`);
        });
      })
    );
  }

  private async ensureDefaultManagedShares(state: IntegrationStateSnapshot): Promise<void> {
    for (const account of state.accounts) {
      if (account.state !== 'connected') {
        continue;
      }
      await this.ensureDefaultManagedShare(normalizeProvider(account.provider), account.id);
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
        .filter((account) => account.state === 'connected')
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
  }): Promise<{
    plan: JoinLinkPlan;
    space: JoinLinkSpace;
    secret: string;
    volumeId: string | null;
    actions: Array<{
      attachmentId: string;
      endpointTransport?: string;
      provider?: string;
      status: 'attached' | 'planned' | 'needs-account' | 'unsupported';
      shareId?: string;
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
      status: 'attached' | 'planned' | 'needs-account' | 'unsupported';
      shareId?: string;
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
      const account = workingAccounts.find((entry) => normalizeProvider(entry.provider) === provider);
      if (!account) {
        actions.push({
          attachmentId: planned.attachment.id,
          endpointTransport: endpoint.transport,
          provider,
          status: 'needs-account',
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
          remoteDescriptor: endpoint.descriptor,
        });
        share = created.share;
        workingShares.push(created.share);
      } else if (share && input.volumeId) {
        await this.attachManagedShare(share.id, { volumeId: input.volumeId });
      }

      actions.push({
        attachmentId: planned.attachment.id,
        endpointTransport: endpoint.transport,
        provider,
        status: share && input.volumeId ? 'attached' : 'planned',
        shareId: share?.id,
        detail: share
          ? input.volumeId
            ? 'Attached the managed share to this space.'
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

  private async buildManagedShareSummary(share: ManagedShare): Promise<ManagedShareSummary> {
    const config = this.options.storage.getRootsConfig();
    const runtime = await this.options.storage.getRuntimeSnapshot();
    const remoteMetrics = await this.resolveShareStorageMetrics(share);
    return {
      share,
      attachments: computeManagedShareAttachments(config, share),
      state: await this.resolveTransportState(share, runtime),
      storage: summarizeManagedShareStorage(config, runtime, share, remoteMetrics),
    };
  }

  private async resolveTransportState(share: ManagedShare, runtime?: MultiRootRuntimeSnapshot): Promise<TransportState> {
    const snapshot = runtime ?? (await this.options.storage.getRuntimeSnapshot());
    const status = share.sourceId ? snapshot.sources.find((entry) => entry.id === share.sourceId) : undefined;
    const adapter = this.adapters.get(normalizeProvider(share.provider));
    const state = await this.loadState();
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

  private async loadState(): Promise<IntegrationStateSnapshot> {
    return loadIntegrationState(this.integrationStatePath);
  }

  private async saveState(snapshot: IntegrationStateSnapshot): Promise<void> {
    await saveIntegrationState(snapshot, this.integrationStatePath);
  }

  private async persistRootsConfig(config: RootsConfig): Promise<void> {
    await saveRootsConfig(this.options.rootsConfigPath, config);
    this.options.storage.updateRootsConfig(config);
    await this.options.storage.reconcileConfiguredVolumes();
    await ensureNearbytesMarkers(config.sources);
  }

  private async ensureDefaultManagedShare(provider: string, accountId: string): Promise<void> {
    if (provider !== 'mega') {
      return;
    }

    const state = await this.loadState();
    if (state.managedShares.some((share) => normalizeProvider(share.provider) === provider && share.accountId === accountId)) {
      return;
    }

    const localPath = this.findDefaultProviderSharePath(provider);
    if (localPath) {
      const config = cloneConfig(this.options.storage.getRootsConfig());
      const existingSource = config.sources.find((source) => path.resolve(source.path) === path.resolve(localPath));
      if (existingSource) {
        const shareId = createId('share', provider, state.managedShares.length + 1);
        const adoptedShare: ManagedShare = {
          id: shareId,
          provider,
          accountId,
          label: 'nearbytes',
          role: 'owner',
          localPath: path.resolve(localPath),
          sourceId: existingSource.id,
          syncMode: 'mirror',
          remoteDescriptor: {
            remotePath: this.runtime.mega.remoteBasePath,
            shareName: 'nearbytes',
            managedShareId: shareId,
          },
          capabilities: ['mirror', 'read', 'write', 'invite'],
          invitationEmails: [],
          createdAt: this.runtime.now(),
          updatedAt: this.runtime.now(),
        };
        const { config: nextConfig } = ensureManagedShareSource(config, adoptedShare, adoptedShare.localPath);
        await this.persistRootsConfig(nextConfig);
        await this.saveState({
          ...state,
          managedShares: [...state.managedShares, adoptedShare],
        });
        return;
      }
    }

    await this.createManagedShare({
      provider,
      accountId,
      label: 'nearbytes',
      localPath,
      remoteDescriptor: {
        remotePath: this.runtime.mega.remoteBasePath,
        shareName: 'nearbytes',
      },
    });
  }

  private findDefaultProviderSharePath(provider: string): string | undefined {
    const config = this.options.storage.getRootsConfig();
    const providerSources = config.sources.filter(
      (source) => normalizeProvider(source.provider) === provider && !source.integration
    );
    const preferred =
      providerSources.find((source) => path.basename(source.path).trim().toLowerCase() === 'nearbytes') ??
      providerSources[0];
    return preferred ? path.resolve(preferred.path) : undefined;
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
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

function defaultProviderLabel(provider: string): string {
  if (provider === 'gdrive') return 'Google Drive';
  if (provider === 'mega') return 'MEGA';
  if (provider === 'github') return 'GitHub';
  return provider;
}

function createId(prefix: string, provider: string, serial: number): string {
  return `${prefix}-${provider}-${serial}-${Math.random().toString(16).slice(2, 8)}`;
}

function createMirrorFolderName(provider: string, label: string, shareId: string): string {
  const base = sanitizeManagedFolderLabel(label) || `${defaultProviderLabel(provider)} share`;
  return `${base} ${shareId.slice(-6)}`.trim();
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
    enabled: true,
    writable: true,
    reservePercent: 5,
    opportunisticPolicy: 'drop-older-blocks',
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
  if (
    typeof share.remoteDescriptor.remotePathHint === 'string' &&
    share.remoteDescriptor.remotePathHint.trim() !== ''
  ) {
    keys.add(`${share.provider}:path:${share.remoteDescriptor.remotePathHint.trim().toLowerCase()}`);
  }
  return keys;
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
