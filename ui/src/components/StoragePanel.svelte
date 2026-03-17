<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    acceptManagedShare,
    acceptIncomingProviderContactInvite,
    attachManagedShare,
    chooseDirectoryPath,
    configureProviderSetup,
    connectProviderAccount,
    createManagedShare,
    consolidateRoot,
    disconnectProviderAccount,
    discoverSources,
    getRootsConfig,
    hasDesktopDirectoryPicker,
    installProviderHelper,
    inviteManagedShare,
    listIncomingManagedShares,
    listIncomingProviderContactInvites,
    listManagedShares,
    listProviderAccounts,
    openRootInFileManager,
    removeManagedShare,
    type DiscoveredNearbytesSource,
    type IncomingManagedShareOffer,
    type IncomingProviderContactInvite,
    type ManagedShareSummary,
    type ProviderAccount,
    type ProviderAuthSession,
    type ProviderCatalogEntry,
    type ReconcileSourcesResponse,
    type RootsConfig,
    type RootsRuntimeSnapshot,
    type SourceConfigEntry,
    type SourceProvider,
    type StorageFullPolicy,
    type VolumeDestinationConfig,
    type VolumePolicyEntry,
    updateRootsConfig,
  } from '../lib/api.js';
  import ArmedActionButton from './ArmedActionButton.svelte';
  import ShareCard from './ShareCard.svelte';
  import {
    ArrowRightLeft,
    FolderOpen,
    HardDrive,
    Link2,
    Plus,
    RefreshCw,
    Search,
    Shield,
    Trash2,
  } from 'lucide-svelte';

  let {
    mode = 'volume',
    volumeId = null,
    currentVolumePresentation = null,
    knownVolumes = [],
    onOpenVolumeRouting = undefined,
    onOpenStorageSetup = undefined,
    discoveryDetails = null,
    refreshToken = 0,
    focusSection = null,
  } = $props<{
    mode?: 'global' | 'volume';
    volumeId: string | null;
    currentVolumePresentation?: {
      volumeId: string;
      label: string;
      filePayload: string;
      fileMimeType: string;
      fileName: string;
    } | null;
    knownVolumes?: Array<{ volumeId: string; label: string }>;
    onOpenVolumeRouting?: ((volumeId: string) => void) | undefined;
    onOpenStorageSetup?: (() => void) | undefined;
    discoveryDetails?: ReconcileSourcesResponse | null;
    refreshToken?: number;
    focusSection?: 'discovery' | 'defaults' | 'shares' | null;
  }>();

  type StatusTone = 'good' | 'warn' | 'muted';
  type HubLocationMode = 'store' | 'publish' | 'off';
  type ProviderFlowStep = {
    label: string;
    detail: string;
    state: 'done' | 'active' | 'pending';
  };

  type CollaboratorView = {
    label: string;
    status: 'active' | 'invited';
  };

  const DISMISSED_DISCOVERY_KEY = 'nearbytes-source-discovery-dismissed-v1';
  const RESERVE_OPTIONS = [0, 5, 10, 15, 20, 25, 30];
  const DEFAULT_RESERVE_PERCENT = 5;
  const DISCOVERY_SCAN_MAX_DEPTH = 1;
  const DISCOVERY_SCAN_MAX_DIRECTORIES = 600;
  const DEFAULT_DESTINATION: VolumeDestinationConfig = {
    sourceId: '',
    enabled: true,
    storeEvents: true,
    storeBlocks: true,
    copySourceBlocks: true,
    reservePercent: DEFAULT_RESERVE_PERCENT,
    fullPolicy: 'block-writes',
  };

  let configPath = $state<string | null>(null);
  let configDraft = $state<RootsConfig | null>(null);
  let runtime = $state<RootsRuntimeSnapshot | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');
  let successMessage = $state('');
  let discoveryLoading = $state(false);
  let discoveryError = $state('');
  let discoveredSources = $state<DiscoveredNearbytesSource[]>([]);
  let dismissedDiscoveries = $state<string[]>(loadDismissedDiscoveries());
  let movingSourceId = $state<string | null>(null);
  let providerAccounts = $state<ProviderAccount[]>([]);
  let providerCatalog = $state<ProviderCatalogEntry[]>([]);
  let managedShares = $state<ManagedShareSummary[]>([]);
  let incomingManagedShareOffers = $state<IncomingManagedShareOffer[]>([]);
  let incomingProviderContactInvites = $state<IncomingProviderContactInvite[]>([]);
  let integrationBusyKey = $state<string | null>(null);
  let providerAuthSessions = $state<Record<string, ProviderAuthSession>>({});
  let providerFlowStates = $state<Record<string, ProviderFlowState>>({});
  let providerCredentialDrafts = $state<Record<string, {
    mode: 'login' | 'signup';
    name: string;
    email: string;
    password: string;
    mfaCode: string;
    useMfa: boolean;
    confirmationLink: string;
  }>>({});
  let providerSetupDrafts = $state<Record<string, { clientId: string }>>({});
  let providerShareDrafts = $state<Record<string, { repoOwner: string; repoName: string; branch: string; basePath: string }>>({});
  let providerLocationNameDrafts = $state<Record<string, string>>({});
  let providerCreateComposerOpen = $state<Record<string, boolean>>({});
  let managedShareInviteDrafts = $state<Record<string, string>>({});
  let providerDisconnectArmed = $state<Record<string, boolean>>({});
  let providerConnectionDialog = $state<string | null>(null);
  let hubLocationDialogVolumeId = $state<string | null>(null);
  let selectedGlobalProvider = $state('local');
  let autosaveStatus = $state<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  let lastSavedSignature = $state('');
  let lastRefreshToken = $state(0);
  let activeReserveEditorKey = $state<string | null>(null);
  let discoveryRunId = 0;

  type ShareBadge = {
    label: string;
    tone?: 'good' | 'muted' | 'warn' | 'durable' | 'replica' | 'off';
    description?: string;
  };
  type ShareAttachmentChip = { volumeId: string; label: string; known: boolean };
  type ProviderFlowState = {
    phase:
      | 'installing'
      | 'connecting'
      | 'waiting-confirmation'
      | 'confirming'
      | 'polling'
      | 'cancelled';
    title: string;
    detail: string;
    canCancel: boolean;
    canReset: boolean;
  };
  type UnifiedShareView = {
    provider: string;
    title: string;
    copy: string;
    active: boolean;
    statusBadges: ShareBadge[];
    meta: string[];
    readable: boolean;
    writable: boolean;
    defaultEnabled: boolean;
    reservePercent: number;
    reserveKey: string;
    warning?: string;
    attachments: ShareAttachmentChip[];
    onToggleReadable: () => void;
    onToggleWritable: () => void;
    onToggleDefault: () => void;
    onReserveChange: (nextValue: number) => void;
    onOpen?: () => void;
    openDisabled?: boolean;
    openTitle?: string;
    onMove?: () => void;
    moveDisabled?: boolean;
    moveLabel?: string;
    onRemove?: () => void;
    canRemove?: boolean;
    removeResetKey?: string;
  };

  const providerSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const providerAbortControllers = new Map<string, AbortController>();

  onMount(() => {
    void loadPanel();
  });

  onDestroy(() => {
    for (const timer of providerSessionTimers.values()) {
      clearTimeout(timer);
    }
    providerSessionTimers.clear();
    for (const controller of providerAbortControllers.values()) {
      controller.abort();
    }
    providerAbortControllers.clear();
  });

  $effect(() => {
    if (refreshToken === 0 || refreshToken === lastRefreshToken) return;
    lastRefreshToken = refreshToken;
    void loadPanel({ background: configDraft !== null });
  });

  $effect(() => {
    persistDismissedDiscoveries(dismissedDiscoveries);
  });

  $effect(() => {
    if (mode === 'global') return;
  });

  $effect(() => {
    if (mode !== 'volume' || !volumeId || hubLocationDialogVolumeId !== volumeId) {
      hubLocationDialogVolumeId = null;
    }
  });

  $effect(() => {
    const availableProviders = new Set(['local', ...providerCatalog.map((provider) => provider.provider)]);
    if (!availableProviders.has(selectedGlobalProvider)) {
      selectedGlobalProvider = 'local';
    }
  });

  $effect(() => {
    if (!configDraft || loading) return;
    const nextSignature = serializeConfig(configDraft);
    if (nextSignature === lastSavedSignature) return;
    autosaveStatus = 'pending';
    const timer = setTimeout(() => {
      void autosavePanel(nextSignature);
    }, 450);
    return () => {
      clearTimeout(timer);
    };
  });

  function loadDismissedDiscoveries(): string[] {
    try {
      const raw = localStorage.getItem(DISMISSED_DISCOVERY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value) => typeof value === 'string')
        .map((value) => normalizeComparablePath(value))
        .filter((value, index, values) => value !== '' && values.indexOf(value) === index);
    } catch {
      return [];
    }
  }

  function persistDismissedDiscoveries(values: string[]): void {
    try {
      localStorage.setItem(DISMISSED_DISCOVERY_KEY, JSON.stringify(values));
    } catch {
      // Ignore local storage failures.
    }
  }

  function cloneConfig(config: RootsConfig): RootsConfig {
    return {
      version: 2,
      sources: config.sources.map((source) => ({
        ...source,
        reservePercent: source.reservePercent ?? DEFAULT_RESERVE_PERCENT,
      })),
      defaultVolume: {
        destinations: config.defaultVolume.destinations.map((destination) => ({
          ...destination,
          reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
        })),
      },
      volumes: config.volumes.map((volume) => ({
        volumeId: volume.volumeId,
        destinations: volume.destinations.map((destination) => ({
          ...destination,
          reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
        })),
      })),
    };
  }

  function serializeConfig(config: RootsConfig): string {
    return JSON.stringify(config);
  }

  function normalizeComparablePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
  }

  function detectProviderFromPath(value: string): SourceProvider {
    const lower = value.toLowerCase();
    if (lower.includes('dropbox')) return 'dropbox';
    if (lower.includes('onedrive')) return 'onedrive';
    if (lower.includes('icloud') || lower.includes('clouddocs') || lower.includes('mobile documents')) {
      return 'icloud';
    }
    if (lower.includes('google drive') || lower.includes('googledrive') || lower.includes('gdrive')) {
      return 'gdrive';
    }
    if (lower.includes('mega')) return 'mega';
    return 'local';
  }

  function formatProvider(provider: SourceProvider): string {
    if (provider === 'gdrive') return 'Google Drive';
    if (provider === 'dropbox') return 'Dropbox';
    if (provider === 'mega') return 'MEGA';
    if (provider === 'icloud') return 'Apple/iCloud';
    if (provider === 'onedrive') return 'OneDrive';
    return 'Local folder';
  }

  function compactPath(value: string): string {
    const normalized = value.trim().replace(/\\/g, '/');
    if (normalized === '') return 'Choose a folder';
    const parts = normalized.split('/').filter((part) => part.length > 0);
    return parts[parts.length - 1] ?? normalized;
  }

  function formatPercent(value: number): string {
    return `${value}%`;
  }

  function formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'n/a';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function connectedProviderCount(): number {
    return providerAccounts.filter((account) => account.state === 'connected').length;
  }

  function readyMirrorCount(): number {
    return managedShares.filter((summary) => summary.state.status === 'ready').length;
  }

  function isLocalMachineShare(source: SourceConfigEntry): boolean {
    return !source.integration || source.integration.kind !== 'provider-managed';
  }

  function activeFolderCount(): number {
    return localShares().filter((source) => source.enabled).length;
  }

  function connectedAccountForProvider(provider: string): ProviderAccount | null {
    return providerAccounts.find((account) => account.provider === provider) ?? null;
  }

  function pendingSessionForProvider(provider: string): ProviderAuthSession | null {
    return providerAuthSessions[provider] ?? null;
  }

  function providerCredentialDraft(provider: string): {
    mode: 'login' | 'signup';
    name: string;
    email: string;
    password: string;
    mfaCode: string;
    useMfa: boolean;
    confirmationLink: string;
  } {
    return providerCredentialDrafts[provider] ?? {
      mode: 'login',
      name: '',
      email: '',
      password: '',
      mfaCode: '',
      useMfa: false,
      confirmationLink: '',
    };
  }

  function providerSetupDraft(provider: string): { clientId: string } {
    return providerSetupDrafts[provider] ?? { clientId: '' };
  }

  function providerFlowState(provider: string): ProviderFlowState | null {
    return providerFlowStates[provider] ?? null;
  }

  function providerShareDraft(provider: string): { repoOwner: string; repoName: string; branch: string; basePath: string } {
    return providerShareDrafts[provider] ?? {
      repoOwner: '',
      repoName: '',
      branch: 'main',
      basePath: '',
    };
  }

  function providerLocationNameDraft(provider: string): string {
    return providerLocationNameDrafts[provider] ?? '';
  }

  function isInlineLocationComposerProvider(provider: string): boolean {
    return provider !== 'github';
  }

  function isProviderCreateComposerOpen(provider: string): boolean {
    return providerCreateComposerOpen[provider] ?? false;
  }

  function setProviderCredential(
    provider: string,
    field: 'mode' | 'name' | 'email' | 'password' | 'mfaCode' | 'useMfa' | 'confirmationLink',
    value: string | boolean
  ): void {
    providerCredentialDrafts = {
      ...providerCredentialDrafts,
      [provider]: {
        ...providerCredentialDraft(provider),
        [field]: value,
      },
    };
  }

  function setProviderSetupField(
    provider: string,
    field: 'clientId',
    value: string
  ): void {
    providerSetupDrafts = {
      ...providerSetupDrafts,
      [provider]: {
        ...providerSetupDraft(provider),
        [field]: value,
      },
    };
  }

  function setProviderShareField(
    provider: string,
    field: 'repoOwner' | 'repoName' | 'branch' | 'basePath',
    value: string
  ): void {
    providerShareDrafts = {
      ...providerShareDrafts,
      [provider]: {
        ...providerShareDraft(provider),
        [field]: value,
      },
    };
  }

  function setProviderLocationName(provider: string, value: string): void {
    providerLocationNameDrafts = {
      ...providerLocationNameDrafts,
      [provider]: value,
    };
  }

  function setProviderCreateComposerOpenState(provider: string, open: boolean): void {
    providerCreateComposerOpen = {
      ...providerCreateComposerOpen,
      [provider]: open,
    };
  }

  function openProviderCreateComposer(provider: string): void {
    setProviderCreateComposerOpenState(provider, true);
  }

  function closeProviderCreateComposer(provider: string): void {
    setProviderCreateComposerOpenState(provider, false);
    setProviderLocationName(provider, '');
  }

  function setProviderFlowState(provider: string, state: ProviderFlowState | null): void {
    if (state === null) {
      if (!(provider in providerFlowStates)) return;
      const next = { ...providerFlowStates };
      delete next[provider];
      providerFlowStates = next;
      return;
    }
    providerFlowStates = {
      ...providerFlowStates,
      [provider]: state,
    };
  }

  function beginProviderRequest(provider: string, state: ProviderFlowState): AbortController {
    const existing = providerAbortControllers.get(provider);
    existing?.abort();
    const controller = new AbortController();
    providerAbortControllers.set(provider, controller);
    setProviderFlowState(provider, state);
    return controller;
  }

  function finishProviderRequest(provider: string, controller: AbortController, clearFlow = true): void {
    if (providerAbortControllers.get(provider) === controller) {
      providerAbortControllers.delete(provider);
    }
    if (clearFlow && providerAbortControllers.get(provider) === undefined) {
      setProviderFlowState(provider, null);
    }
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === 'AbortError'
      : error instanceof Error && error.name === 'AbortError';
  }

  function hasProviderDraft(provider: string): boolean {
    const draft = providerCredentialDraft(provider);
    return Boolean(
      draft.name.trim() ||
        draft.email.trim() ||
        draft.password ||
        draft.mfaCode.trim() ||
        draft.confirmationLink.trim() ||
        draft.mode !== 'login' ||
        draft.useMfa
    );
  }

  function canResetProviderFlow(provider: string): boolean {
    return pendingSessionForProvider(provider) !== null || providerFlowState(provider) !== null || hasProviderDraft(provider);
  }

  function canSubmitMegaAction(provider: string): boolean {
    const draft = providerCredentialDraft(provider);
    if (pendingSessionForProvider(provider)) {
      return draft.confirmationLink.trim() !== '';
    }
    if (draft.mode === 'signup') {
      return draft.name.trim() !== '' && draft.email.trim() !== '' && draft.password.trim() !== '';
    }
    if (draft.email.trim() === '' || draft.password.trim() === '') {
      return false;
    }
    return !draft.useMfa || draft.mfaCode.trim() !== '';
  }

  function megaPrimaryActionLabel(provider: string): string {
    if (integrationBusyKey === `confirm:${provider}`) {
      return 'Confirming...';
    }
    if (integrationBusyKey === `connect:${provider}`) {
      const draft = providerCredentialDraft(provider);
      return draft.mode === 'signup' ? 'Creating...' : 'Signing in...';
    }
    if (pendingSessionForProvider(provider)) {
      return 'Confirm account';
    }
    return providerCredentialDraft(provider).mode === 'signup' ? 'Create account' : 'Sign in to MEGA';
  }

  function megaOnboardingCopy(provider: string): string {
    const draft = providerCredentialDraft(provider);
    const pending = pendingSessionForProvider(provider);
    if (pending) {
      return pending.detail || 'Paste the MEGA confirmation link from your email to finish creating the account.';
    }
    if (draft.mode === 'signup') {
      return 'Create the MEGA account here, then finish the email confirmation step inside Nearbytes.';
    }
    return mode === 'volume'
      ? 'Sign in here so Nearbytes can create the live mirror, keep it synced, and send MEGA storage invites for this hub.'
      : 'Sign in here so Nearbytes can create live mirror locations, keep them synced, and send MEGA storage invites.';
  }

  async function submitMegaAction(provider: ProviderCatalogEntry): Promise<void> {
    if (pendingSessionForProvider(provider.provider)) {
      await confirmMegaSignup(provider);
      return;
    }
    await connectProvider(provider);
  }

  function resetProviderDraft(provider: string): void {
    if (!(provider in providerCredentialDrafts)) return;
    const next = { ...providerCredentialDrafts };
    delete next[provider];
    providerCredentialDrafts = next;
  }

  function cancelProviderFlow(provider: string): void {
    const controller = providerAbortControllers.get(provider);
    if (controller) {
      controller.abort();
      providerAbortControllers.delete(provider);
    }
    const timer = providerSessionTimers.get(provider);
    if (timer) {
      clearTimeout(timer);
      providerSessionTimers.delete(provider);
    }
    setProviderFlowState(provider, {
      phase: 'cancelled',
      title: 'Cancelled',
      detail: 'Stopped waiting for this connection step. If the helper was already installing, it may still finish in the background.',
      canCancel: false,
      canReset: true,
    });
    integrationBusyKey = null;
    successMessage = '';
    errorMessage = '';
  }

  function resetProviderFlow(provider: string): void {
    cancelProviderFlow(provider);
    clearProviderSession(provider);
    resetProviderDraft(provider);
    setProviderFlowState(provider, null);
    errorMessage = '';
    successMessage = '';
  }

  function shareStatusTone(summary: ManagedShareSummary): StatusTone {
    if (summary.state.status === 'ready') return 'good';
    if (summary.state.status === 'idle' || summary.state.status === 'syncing') return 'muted';
    return 'warn';
  }

  function shareStatusLabel(summary: ManagedShareSummary): string {
    const primaryBadge = summary.state.badges[0]?.trim();
    if (primaryBadge === 'Repair') return 'Storage unavailable';
    if (primaryBadge === 'Reconnect') return 'Sign-in needed';
    if (primaryBadge === 'Syncing') return 'Syncing';
    if (primaryBadge === 'Share') return 'Connected';
    if (summary.state.status === 'ready') return 'Connected';
    if (summary.state.status === 'syncing') return 'Syncing';
    if (summary.state.status === 'idle') return 'Available';
    if (summary.state.status === 'needs-auth') return 'Sign-in needed';
    if (summary.state.status === 'unsupported') return 'Unsupported';
    return 'Check details';
  }

  function shareAttachmentSummary(summary: ManagedShareSummary): string {
    const count = summary.attachments.length;
    if (count === 0) {
      return 'Not attached to any hub yet.';
    }
    return `${countLabel(count, 'hub')} attached`;
  }

  function sourceAttachmentLabels(sourceId: string): Array<{ volumeId: string; label: string; known: boolean }> {
    if (!configDraft) {
      return [];
    }
    return configDraft.volumes
      .filter((volume) => volume.destinations.some((destination) => destination.sourceId === sourceId))
      .map((volume) => {
        const knownLabel = knownVolumeLabel(volume.volumeId);
        return {
          volumeId: volume.volumeId,
          label: knownLabel ?? `Hub ${volume.volumeId.slice(0, 8)}`,
          known: Boolean(knownLabel),
        };
      });
  }

  function sourceAttachmentSummary(sourceId: string): string {
    const count = sourceAttachmentLabels(sourceId).length;
    if (count === 0) {
      return 'Not attached to any hub yet.';
    }
    return `${countLabel(count, 'hub')} attached`;
  }

  function shareAttachmentLabels(summary: ManagedShareSummary): Array<{ volumeId: string; label: string; known: boolean }> {
    if (summary.attachments.length === 0) {
      return [];
    }
    return summary.attachments.map((attachment) => {
      const knownLabel = knownVolumeLabel(attachment.volumeId);
      return {
        volumeId: attachment.volumeId,
        label: knownLabel ?? `Hub ${attachment.volumeId.slice(0, 8)}`,
        known: Boolean(knownLabel),
      };
    });
  }

  function providerDisconnectImpact(provider: string): {
    shares: number;
    spaces: number;
    inaccessibleSpaces: string[];
  } {
    const shares = providerShares(provider);
    const sourceIds = new Set(shares.map((summary) => summary.share.sourceId).filter((value): value is string => Boolean(value)));
    const attachedVolumeIds = Array.from(
      new Set(shares.flatMap((summary) => summary.attachments.map((attachment) => attachment.volumeId)))
    );
    const inaccessibleSpaces = attachedVolumeIds.filter((attachedVolumeId) => {
      const remainingDestinations = effectiveDestinations(attachedVolumeId).filter(
        (destination) => !sourceIds.has(destination.sourceId)
      );
      return !remainingDestinations.some((destination) => {
        const source = configDraft?.sources.find((entry) => entry.id === destination.sourceId);
        return Boolean(source?.enabled);
      });
    });
    return {
      shares: shares.length,
      spaces: attachedVolumeIds.length,
      inaccessibleSpaces,
    };
  }

  function knownVolumeLabel(targetVolumeId: string): string | null {
    if (currentVolumePresentation && currentVolumePresentation.volumeId === targetVolumeId) {
      return currentVolumePresentation.label.trim() || 'Current hub';
    }
    return knownVolumes.find((entry: { volumeId: string; label: string }) => entry.volumeId === targetVolumeId)?.label ?? null;
  }

  function setProviderDisconnectArmed(provider: string, armed: boolean): void {
    if ((providerDisconnectArmed[provider] ?? false) === armed) {
      return;
    }
    providerDisconnectArmed = {
      ...providerDisconnectArmed,
      [provider]: armed,
    };
  }

  function openProviderConnectionDialog(provider: string): void {
    setProviderDisconnectArmed(provider, false);
    providerConnectionDialog = provider;
  }

  function closeProviderConnectionDialog(): void {
    if (providerConnectionDialog) {
      setProviderDisconnectArmed(providerConnectionDialog, false);
    }
    providerConnectionDialog = null;
  }

  function providerCardStatus(entry: ProviderCatalogEntry): string {
    const pending = pendingSessionForProvider(entry.provider);
    if (pending?.status === 'pending') return 'Almost ready';
    if (pending?.status === 'failed') return 'Try again';
    if (entry.setup.status === 'needs-config') return 'Setup';
    if (entry.setup.status === 'needs-install') return 'Get ready';
    if (entry.setup.status === 'installing') return 'Installing';
    if (entry.setup.status === 'unsupported') return 'Other option';
    if (entry.isConnected) return 'Connected';
    if (entry.connectionState === 'setup') return 'Setup';
    return 'Available';
  }

  function providerCardDetail(entry: ProviderCatalogEntry): string {
    const pending = pendingSessionForProvider(entry.provider);
    if (pending) {
      return pending.detail;
    }
    if (entry.setup.status === 'installing') {
      return 'Nearbytes is preparing the local connection in the background.';
    }
    if (entry.setup.status === 'needs-install' && entry.provider === 'mega') {
      return 'Nearbytes will set up MEGA the first time you create a storage location there.';
    }
    if (entry.provider === 'github') {
      return entry.isConnected
        ? mode === 'volume'
          ? 'Use GitHub as a provider for storage locations for this hub.'
          : 'Use GitHub as a provider for storage locations in Nearbytes.'
        : entry.setup.status === 'needs-config'
          ? 'Add the GitHub app details once, then connect.'
          : 'Use GitHub as another storage location provider.';
    }
    if (entry.provider === 'gdrive') {
      return entry.isConnected
        ? mode === 'volume'
          ? 'Use Google Drive as a provider for storage locations for this hub.'
          : 'Use Google Drive as a provider for storage locations in Nearbytes.'
        : 'Use Google Drive as another storage location provider.';
    }
    if (entry.provider === 'mega') {
      return entry.isConnected
        ? mode === 'volume'
          ? 'Use MEGA as a provider for storage locations for this hub.'
          : 'Use MEGA as a provider for storage locations in Nearbytes.'
        : 'Use MEGA as a storage location provider.';
    }
    return entry.setup.detail || entry.description;
  }

  function providerShares(provider: string): ManagedShareSummary[] {
    return sortManagedShareSummaries(managedShares.filter((summary) => summary.share.provider === provider));
  }

  function incomingManagedSharesForProvider(provider: string): IncomingManagedShareOffer[] {
    return sortIncomingManagedShareOffers(incomingManagedShareOffers.filter((offer) => offer.provider === provider));
  }

  function incomingProviderInvitesForProvider(provider: string): IncomingProviderContactInvite[] {
    return sortIncomingProviderContactInviteEntries(
      incomingProviderContactInvites.filter((invite) => invite.provider === provider)
    );
  }

  function providerPriority(provider: string): number {
    if (provider === 'mega') return 0;
    if (provider === 'gdrive') return 1;
    if (provider === 'github') return 2;
    return 3;
  }

  function sortProviders(entries: readonly ProviderCatalogEntry[]): ProviderCatalogEntry[] {
    return [...entries].sort((left, right) => {
      const connectedOrder = Number(right.isConnected) - Number(left.isConnected);
      if (connectedOrder !== 0) return connectedOrder;
      const providerOrder = providerPriority(left.provider) - providerPriority(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function sortManagedShareSummaries(entries: readonly ManagedShareSummary[]): ManagedShareSummary[] {
    return [...entries].sort((left, right) => {
      const attachedOrder = right.attachments.length - left.attachments.length;
      if (attachedOrder !== 0) return attachedOrder;
      const providerOrder = providerPriority(left.share.provider) - providerPriority(right.share.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.share.label.localeCompare(right.share.label);
    });
  }

  function sortIncomingManagedShareOffers(entries: readonly IncomingManagedShareOffer[]): IncomingManagedShareOffer[] {
    return [...entries].sort((left, right) => {
      const providerOrder = providerPriority(left.provider) - providerPriority(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function sortIncomingProviderContactInviteEntries(entries: readonly IncomingProviderContactInvite[]): IncomingProviderContactInvite[] {
    return [...entries].sort((left, right) => {
      const providerOrder = providerPriority(left.provider) - providerPriority(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function providerShareCount(provider: string): number {
    return providerShares(provider).length;
  }

  function visibleManagedShare(summary: ManagedShareSummary): boolean {
    return sourceById(summary.share.sourceId) !== null;
  }

  function providerVisibleShares(provider: string): ManagedShareSummary[] {
    return providerShares(provider).filter((summary) => visibleManagedShare(summary));
  }

  function providerVisibleShareCount(provider: string): number {
    return providerVisibleShares(provider).length;
  }

  function providerAttachedShareCount(provider: string): number {
    if (mode !== 'volume' || !volumeId) {
      return 0;
    }
    return providerShares(provider).filter((summary) =>
      summary.attachments.some((attachment) => attachment.volumeId === volumeId)
    ).length;
  }

  function providerPrimaryMirrorPath(entry: ProviderCatalogEntry): string | null {
    const share = providerShares(entry.provider).find(
      (summary) => (summary.storage?.sourcePath ?? summary.share.localPath).trim() !== ''
    );
    return share ? summarySourcePath(share) : null;
  }

  function providerMirrorPaths(entry: ProviderCatalogEntry): string[] {
    const unique = new Set<string>();
    for (const share of providerShares(entry.provider)) {
      const resolved = summarySourcePath(share).trim();
      if (resolved) {
        unique.add(resolved);
      }
    }
    return Array.from(unique.values());
  }

  function providerTransparencyFacts(entry: ProviderCatalogEntry): string[] {
    const shareCount = providerVisibleShareCount(entry.provider);
    const attachedCount = providerAttachedShareCount(entry.provider);
    const account = connectedAccountForProvider(entry.provider);
    const facts = [
      entry.isConnected ? account?.email || account?.label || 'Account connected' : 'No account connected',
      countLabel(shareCount, 'live location'),
    ];
    const incomingInviteCount = incomingProviderInvitesForProvider(entry.provider).length;
    const incomingShareCount = incomingManagedSharesForProvider(entry.provider).length;
    if (incomingInviteCount > 0) {
      facts.push(countLabel(incomingInviteCount, 'incoming contact invite'));
    }
    if (incomingShareCount > 0) {
      facts.push(countLabel(incomingShareCount, 'incoming storage location'));
    }
    if (mode === 'volume' && volumeId) {
      facts.push(countLabel(attachedCount, 'attached location'));
    }
    if (entry.provider === 'mega') {
      facts.push(entry.setup.status === 'needs-install' ? 'Needs local helper' : 'Uses local mirror folder');
    }
    return facts.filter((value, index, values) => value && values.indexOf(value) === index);
  }

  function localMachineShareCount(): number {
    return localShares().length;
  }

  function shouldShowProviderDocs(entry: ProviderCatalogEntry): boolean {
    if (entry.provider === 'gdrive') {
      return entry.setup.status === 'needs-config' || entry.setup.status === 'unsupported';
    }
    return Boolean(entry.setup.docsUrl) &&
      (entry.setup.status === 'needs-config' ||
        entry.setup.status === 'needs-install' ||
        entry.setup.status === 'unsupported');
  }

  function managedShareOpenLabel(summary: ManagedShareSummary): string {
    if (summary.share.provider === 'github') {
      const repoFullName = typeof summary.share.remoteDescriptor.repoFullName === 'string' ? summary.share.remoteDescriptor.repoFullName : null;
      const basePath = typeof summary.share.remoteDescriptor.basePath === 'string' ? summary.share.remoteDescriptor.basePath : null;
      return repoFullName && basePath ? `${repoFullName} → ${basePath}` : 'GitHub repository share';
    }
    return summary.share.sourceId ? 'Local mirror folder managed by Nearbytes' : 'Mirror folder needs attention';
  }

  function localShares(): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => isLocalMachineShare(source));
  }

  function managedShareAccessLabel(summary: ManagedShareSummary): string {
    return summary.share.capabilities.includes('write') ? 'Read and write' : 'Read only';
  }

  function summarySourcePath(summary: ManagedShareSummary): string {
    return summary.storage?.sourcePath?.trim() || summary.share.localPath;
  }

  function managedShareRoleLabel(summary: ManagedShareSummary): string {
    return summary.share.role === 'owner' ? 'You own this live location' : 'Received from someone else';
  }

  function managedShareNarrative(summary: ManagedShareSummary): string {
    if (summary.state.status === 'ready') {
      return 'This live location is ready. The folder below is the local mirror that should stay in sync with the provider copy.';
    }
    if (summary.attachments.length === 0) {
      return mode === 'volume'
        ? 'This live location exists, but the current hub is not using it yet.'
        : 'This live location exists in Nearbytes and is ready to attach when you need it.';
    }
    if (summary.state.status === 'syncing') {
      return 'Nearbytes is still waiting for the provider mirror to settle before treating this location as ready.';
    }
    if (summary.state.status === 'needs-auth') {
      return 'Nearbytes cannot use this location until the provider account is connected again.';
    }
    return summary.state.detail;
  }

  function managedShareStorageFacts(summary: ManagedShareSummary): string[] {
    const facts = [
      managedShareRoleLabel(summary),
      managedShareAccessLabel(summary),
      shareAttachmentSummary(summary),
      summary.storage?.keepFullCopy ? 'Keeps a full copy' : 'On-demand copy policy',
      summary.storage?.availableBytes !== undefined ? `Available storage: ${formatSize(summary.storage.availableBytes)} locally` : null,
      summary.storage?.remoteAvailableBytes !== undefined
        ? `Available storage: ${formatSize(summary.storage.remoteAvailableBytes)} in ${providerLabelForManagedShare(summary)}`
        : null,
    ];
    return facts.filter((value): value is string => Boolean(value));
  }

  function canInviteManagedShare(summary: ManagedShareSummary): boolean {
    return summary.share.capabilities.includes('invite');
  }

  function managedShareInviteDraft(shareId: string): string {
    return managedShareInviteDrafts[shareId] ?? '';
  }

  function setManagedShareInviteDraft(shareId: string, value: string): void {
    managedShareInviteDrafts = {
      ...managedShareInviteDrafts,
      [shareId]: value,
    };
  }

  function parseInviteEmails(value: string): string[] {
    return value
      .split(/[\s,;]+/u)
      .map((entry) => entry.trim())
      .filter((entry, index, entries) => entry !== '' && entries.indexOf(entry) === index);
  }

  function invitedCollaborators(summary: ManagedShareSummary): string[] {
    return summary.collaborators.map((collaborator) => collaborator.email ?? collaborator.label);
  }

  function participantCollaborators(summary: ManagedShareSummary): CollaboratorView[] {
    return summary.collaborators
      .filter((collaborator) => collaborator.status === 'active')
      .map((collaborator) => ({
        label: collaborator.email ?? collaborator.label,
        status: collaborator.status,
      }));
  }

  function pendingCollaborators(summary: ManagedShareSummary): CollaboratorView[] {
    return summary.collaborators
      .filter((collaborator) => collaborator.status === 'invited')
      .map((collaborator) => ({
        label: collaborator.email ?? collaborator.label,
        status: collaborator.status,
      }));
  }

  function sourceById(sourceId: string | undefined): SourceConfigEntry | null {
    if (!sourceId) return null;
    return configDraft?.sources.find((source) => source.id === sourceId) ?? null;
  }

  function shareCardBadgeForSource(source: SourceConfigEntry): ShareBadge[] {
    const availability = locationAvailability(source);
    if (availability.label === 'Ready') {
      return [];
    }
    return [
      {
        label: availability.label,
        tone: availability.tone,
        description: locationSummary(source),
      },
    ];
  }

  function shareCardBadgesForManaged(summary: ManagedShareSummary): ShareBadge[] {
    const label = shareStatusLabel(summary);
    if (label === 'Connected' || label === 'Available') {
      return [];
    }
    return [
      {
        label,
        tone: shareStatusTone(summary),
        description: summary.state.detail,
      },
    ];
  }

  function defaultManagedShareLabel(): string {
    return 'Storage location';
  }

  function nextManagedShareLabel(provider: string): string {
    const baseLabel = defaultManagedShareLabel();
    const matchingCount = providerShares(provider).filter((summary) => {
      const label = summary.share.label.trim();
      return label === baseLabel || /^Storage location \d+$/u.test(label);
    }).length;
    return matchingCount === 0 ? baseLabel : `${baseLabel} ${matchingCount + 1}`;
  }

  function providerEmptyShareCopy(provider: ProviderCatalogEntry): string {
    if (!provider.isConnected) {
      return `Connect ${provider.label} first, then Nearbytes will manage its shares here.`;
    }
    if (provider.provider === 'mega') {
      return 'Nearbytes should create or adopt the default nearbytes share automatically. If it does not appear, use Add a location.';
    }
    return 'Create a storage location here to make it available in Nearbytes.';
  }

  function managedShareCreateLabel(provider: string): string {
    if (provider === 'github') {
      return githubShareLabel();
    }
    const draft = providerLocationNameDraft(provider).trim();
    return draft || nextManagedShareLabel(provider);
  }

  function defaultGithubBasePath(label: string): string {
    const slug =
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40) || 'share';
    return `nearbytes/${slug}`;
  }

  function localShareView(source: SourceConfigEntry): UnifiedShareView {
    const status = sourceStatus(source.id);
    const defaultDestination = destinationFor(null, source.id);
    const attachments = sourceAttachmentLabels(source.id);
    return {
      provider: formatProvider(source.provider),
      title: compactPath(source.path),
      copy: locationSummary(source),
      active: protectionTone(defaultDestination, source.id) === 'durable',
      statusBadges: shareCardBadgeForSource(source),
      meta: [
        status?.availableBytes !== undefined ? `Available storage: ${formatSize(status.availableBytes)}` : 'Available storage unknown',
        usageSummary(source.id),
        sourceAttachmentSummary(source.id),
      ],
      readable: source.enabled,
      writable: source.writable,
      defaultEnabled: keepsFullCopy(defaultDestination),
      reservePercent: Number.isFinite(defaultDestination?.reservePercent)
        ? defaultDestination!.reservePercent
        : Number.isFinite(source.reservePercent)
          ? source.reservePercent
          : DEFAULT_RESERVE_PERCENT,
      reserveKey: `source:${source.id}`,
      warning: status?.lastWriteFailure?.message,
      attachments,
      onToggleReadable: () => updateSourceField(source.id, 'enabled', !source.enabled),
      onToggleWritable: () => updateSourceField(source.id, 'writable', !source.writable),
      onToggleDefault: () => setKeepFullCopy(null, source.id, !keepsFullCopy(defaultDestination)),
      onReserveChange: (nextValue) => {
        updateSourceField(source.id, 'reservePercent', nextValue);
        updateDestinationField(null, source.id, 'reservePercent', nextValue);
      },
      onOpen: hasSourcePath(source) ? () => openSourceFolder(source.id) : undefined,
      openDisabled: !hasSourcePath(source),
      openTitle: source.path || 'Open folder',
      onMove: () => void (hasSourcePath(source) ? moveSourceFolder(source.id) : chooseSourceFolder(source.id)),
      moveDisabled: movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id),
      moveLabel: movingSourceId === source.id ? 'Moving...' : hasSourcePath(source) ? 'Move' : 'Choose folder',
      onRemove: canRemoveAnySource() ? () => removeSource(source.id) : undefined,
      canRemove: canRemoveAnySource(),
      removeResetKey: `local:${source.id}:${source.path}:${source.enabled}:${source.writable}:${keepsFullCopy(defaultDestination)}`,
    };
  }

  function managedShareView(summary: ManagedShareSummary): UnifiedShareView | null {
    const source = sourceById(summary.share.sourceId);
    if (!source) {
      return null;
    }
    const defaultDestination = destinationFor(null, source.id);
    const keepFullCopy = keepsFullCopy(defaultDestination);
    return {
      provider: summary.share.provider === 'gdrive' ? 'Google Drive' : summary.share.provider === 'mega' ? 'MEGA' : summary.share.provider === 'github' ? 'GitHub' : summary.share.provider,
      title: summary.share.label,
      copy: managedShareNarrative(summary),
      active: summary.state.status === 'ready',
      statusBadges: shareCardBadgesForManaged(summary),
      meta: [
        shareAttachmentSummary(summary),
        summary.storage?.availableBytes !== undefined
          ? `Available storage: ${formatSize(summary.storage.availableBytes)}`
          : summary.storage?.remoteAvailableBytes !== undefined
            ? `Available storage: ${formatSize(summary.storage.remoteAvailableBytes)} in ${providerLabelForManagedShare(summary)}`
            : 'Available storage unknown',
        typeof summary.storage?.usageTotalBytes === 'number'
          ? `Using ${formatSize(summary.storage.usageTotalBytes)} here.`
          : managedShareOpenLabel(summary),
        summary.storage?.remoteAvailableBytes !== undefined
          && summary.storage?.availableBytes !== undefined
          ? `${formatSize(summary.storage.remoteAvailableBytes)} available in ${providerLabelForManagedShare(summary)}`
          : null,
      ].filter((value): value is string => Boolean(value)),
      readable: source.enabled,
      writable: source.writable,
      defaultEnabled: keepFullCopy,
      reservePercent: Number.isFinite(defaultDestination?.reservePercent)
        ? defaultDestination!.reservePercent
        : Number.isFinite(source.reservePercent)
          ? source.reservePercent
          : DEFAULT_RESERVE_PERCENT,
      reserveKey: `managed:${summary.share.id}`,
      warning: summary.storage?.lastWriteFailureMessage,
      attachments: shareAttachmentLabels(summary),
      onToggleReadable: () => updateSourceField(source.id, 'enabled', !source.enabled),
      onToggleWritable: () => updateSourceField(source.id, 'writable', !source.writable),
      onToggleDefault: () => setKeepFullCopy(null, source.id, !keepFullCopy),
      onReserveChange: (nextValue) => {
        updateSourceField(source.id, 'reservePercent', nextValue);
        updateDestinationField(null, source.id, 'reservePercent', nextValue);
      },
      onOpen: summary.share.sourceId ? () => openSourceFolder(summary.share.sourceId!) : undefined,
      openDisabled: !summary.share.sourceId,
      openTitle: source.path || summary.share.localPath,
      onRemove: () => void removeManagedShareSummary(summary),
      canRemove: true,
      removeResetKey: `managed:${summary.share.id}:${summary.share.label}:${summary.attachments.length}`,
    };
  }

  function providerLabelForManagedShare(summary: ManagedShareSummary): string {
    if (summary.share.provider === 'gdrive') return 'Google Drive';
    if (summary.share.provider === 'mega') return 'MEGA cloud';
    if (summary.share.provider === 'github') return 'GitHub';
    return summary.share.provider;
  }

  function providerLabelForIncoming(provider: string): string {
    if (provider === 'gdrive') return 'Google Drive';
    if (provider === 'mega') return 'MEGA';
    if (provider === 'github') return 'GitHub';
    return provider;
  }

  function generateSourceId(provider: SourceProvider): string {
    const existing = new Set(configDraft?.sources.map((source) => source.id) ?? []);
    const prefix = `src-${provider === 'local' ? 'disk' : provider}`;
    let counter = existing.size + 1;
    while (existing.has(`${prefix}-${counter}`)) {
      counter += 1;
    }
    return `${prefix}-${counter}`;
  }

  function createSource(pathValue = ''): SourceConfigEntry {
    const provider = detectProviderFromPath(pathValue);
    return {
      id: generateSourceId(provider),
      provider,
      path: pathValue,
      enabled: true,
      writable: true,
      reservePercent: DEFAULT_RESERVE_PERCENT,
      opportunisticPolicy: 'drop-older-blocks',
    };
  }

  function duplicateDestinationList(
    destinations: VolumeDestinationConfig[],
    sourceId: string,
    nextSourceId: string
  ): VolumeDestinationConfig[] {
    const normalized = destinations.map((destination) => ({
      ...destination,
      reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
    }));
    const matched = normalized.find((destination) => destination.sourceId === sourceId);
    if (!matched || normalized.some((destination) => destination.sourceId === nextSourceId)) {
      return normalized;
    }
    return [
      ...normalized,
      {
        ...matched,
        sourceId: nextSourceId,
      },
    ];
  }

  function prepareSourceMoveConfig(sourceId: string, nextPath: string): {
    config: RootsConfig;
    targetSource: SourceConfigEntry;
  } {
    if (!configDraft) {
      throw new Error('Config not loaded');
    }
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`Storage location not found: ${sourceId}`);
    }
    const provider = detectProviderFromPath(nextPath);
    const targetSource: SourceConfigEntry = {
      ...source,
      id: generateSourceId(provider),
      provider,
      path: nextPath,
      reservePercent: source.reservePercent ?? DEFAULT_RESERVE_PERCENT,
      moveFromSourceId: source.id,
    };
    return {
      targetSource,
      config: {
        version: configDraft.version,
        sources: [...configDraft.sources.map((entry) => ({ ...entry })), targetSource],
        defaultVolume: {
          destinations: duplicateDestinationList(
            configDraft.defaultVolume.destinations,
            source.id,
            targetSource.id
          ),
        },
        volumes: configDraft.volumes.map((volume) => ({
          volumeId: volume.volumeId,
          destinations: duplicateDestinationList(volume.destinations, source.id, targetSource.id),
        })),
      },
    };
  }

  function hasPendingMove(sourceId: string): boolean {
    return Boolean(configDraft?.sources.some((source) => source.moveFromSourceId === sourceId));
  }

  function sourceStatus(sourceId: string) {
    return runtime?.sources.find((entry) => entry.id === sourceId) ?? null;
  }

  function effectiveDestinations(targetVolumeId: string | null): VolumeDestinationConfig[] {
    if (!configDraft) return [];
    const merged = new Map<string, VolumeDestinationConfig>();
    for (const destination of configDraft.defaultVolume.destinations) {
      merged.set(destination.sourceId, { ...destination });
    }
    if (!targetVolumeId) {
      return Array.from(merged.values());
    }
    const explicit = configDraft.volumes.find((entry) => entry.volumeId === targetVolumeId);
    if (!explicit) {
      return Array.from(merged.values());
    }
    for (const destination of explicit.destinations) {
      merged.set(destination.sourceId, { ...destination });
    }
    return Array.from(merged.values());
  }

  function explicitVolumePolicy(targetVolumeId: string): VolumePolicyEntry | undefined {
    return configDraft?.volumes.find((entry) => entry.volumeId === targetVolumeId);
  }

  function ensureExplicitVolumePolicy(targetVolumeId: string): VolumePolicyEntry {
    if (!configDraft) {
      throw new Error('Config not loaded');
    }
    let entry = configDraft.volumes.find((volume) => volume.volumeId === targetVolumeId);
    if (entry) return entry;
    entry = {
      volumeId: targetVolumeId,
      destinations: effectiveDestinations(targetVolumeId).map((destination) => ({ ...destination })),
    };
    configDraft = {
      ...configDraft,
      volumes: [...configDraft.volumes, entry],
    };
    return configDraft.volumes[configDraft.volumes.length - 1];
  }

  function destinationFor(targetVolumeId: string | null, sourceId: string): VolumeDestinationConfig | null {
    return effectiveDestinations(targetVolumeId).find((destination) => destination.sourceId === sourceId) ?? null;
  }

  function upsertDestination(targetVolumeId: string | null, sourceId: string): void {
    if (!configDraft) return;
    if (targetVolumeId === null) {
      if (configDraft.defaultVolume.destinations.some((destination) => destination.sourceId === sourceId)) {
        return;
      }
      configDraft = {
        ...configDraft,
        defaultVolume: {
          destinations: [...configDraft.defaultVolume.destinations, { ...DEFAULT_DESTINATION, sourceId }],
        },
      };
      return;
    }

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    if (entry.destinations.some((destination) => destination.sourceId === sourceId)) {
      return;
    }
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: [...entry.destinations, { ...DEFAULT_DESTINATION, sourceId }],
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
  }

  function updateDestinationField<K extends keyof VolumeDestinationConfig>(
    targetVolumeId: string | null,
    sourceId: string,
    field: K,
    value: VolumeDestinationConfig[K]
  ): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    if (targetVolumeId === null) {
      configDraft = {
        ...configDraft,
        defaultVolume: {
          destinations: configDraft.defaultVolume.destinations.map((destination) =>
            destination.sourceId === sourceId ? { ...destination, [field]: value } : destination
          ),
        },
      };
      return;
    }

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: entry.destinations.map((destination) =>
        destination.sourceId === sourceId ? { ...destination, [field]: value } : destination
      ),
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
  }

  function removeSource(sourceId: string): void {
    if (!configDraft || configDraft.sources.length <= 1) {
      errorMessage = 'Nearbytes needs at least one storage location.';
      return;
    }
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    if (source?.moveFromSourceId || hasPendingMove(sourceId)) {
      errorMessage = 'Finish the folder move before removing this storage location.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: configDraft.sources.filter((source) => source.id !== sourceId),
      defaultVolume: {
        destinations: configDraft.defaultVolume.destinations.filter((destination) => destination.sourceId !== sourceId),
      },
      volumes: configDraft.volumes
        .map((volume) => ({
          ...volume,
          destinations: volume.destinations.filter((destination) => destination.sourceId !== sourceId),
        }))
        .filter((volume) => volume.destinations.length > 0),
    };
  }

  function removeVolumePolicy(targetVolumeId: string): void {
    if (!configDraft) return;
    configDraft = {
      ...configDraft,
      volumes: configDraft.volumes.filter((entry) => entry.volumeId !== targetVolumeId),
    };
  }

  function updateSourceField<K extends keyof SourceConfigEntry>(
    sourceId: string,
    field: K,
    value: SourceConfigEntry[K]
  ): void {
    if (!configDraft) return;
    configDraft = {
      ...configDraft,
      sources: configDraft.sources.map((source) => {
        if (source.id !== sourceId) return source;
        if (field === 'path') {
          const pathValue = String(value);
          return {
            ...source,
            path: pathValue,
            provider: detectProviderFromPath(pathValue),
          };
        }
        return {
          ...source,
          [field]: value,
        };
      }),
    };
  }

  function isDurableDestination(destination: VolumeDestinationConfig | null, sourceId: string): boolean {
    if (!destination || !destination.enabled) return false;
    const source = configDraft?.sources.find((entry) => entry.id === sourceId);
    if (!source || !source.enabled || !source.writable) return false;
    return (
      destination.storeEvents &&
      destination.storeBlocks &&
      destination.copySourceBlocks &&
      destination.fullPolicy === 'block-writes'
    );
  }

  function durableLocationCount(targetVolumeId: string | null): number {
    if (!configDraft) return 0;
    return configDraft.sources.filter((source) => isDurableDestination(destinationFor(targetVolumeId, source.id), source.id))
      .length;
  }

  function hasDurableDestination(targetVolumeId: string | null): boolean {
    return durableLocationCount(targetVolumeId) > 0;
  }

  function protectionTone(destination: VolumeDestinationConfig | null, sourceId: string): 'durable' | 'replica' | 'off' {
    if (!destination || !destination.enabled) return 'off';
    if (isDurableDestination(destination, sourceId)) return 'durable';
    if (keepsFullCopy(destination)) return 'replica';
    return 'off';
  }

  function protectionLabel(destination: VolumeDestinationConfig | null, sourceId: string): string {
    const tone = protectionTone(destination, sourceId);
    if (tone === 'durable') return 'Full copy';
    if (tone === 'replica') return 'Full copy with trimming';
    return 'Not a full copy';
  }

  function hubLocationMode(targetVolumeId: string, sourceId: string): HubLocationMode {
    const destination = destinationFor(targetVolumeId, sourceId);
    if (!destination || !destination.enabled || !destination.storeEvents) {
      return 'off';
    }
    if (keepsFullCopy(destination)) {
      return 'store';
    }
    return destination.storeBlocks ? 'publish' : 'off';
  }

  function setHubLocationMode(targetVolumeId: string, sourceId: string, mode: HubLocationMode): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    const apply = (destination: VolumeDestinationConfig): VolumeDestinationConfig => {
      if (mode === 'off') {
        return {
          ...destination,
          enabled: false,
          storeEvents: false,
          storeBlocks: false,
          copySourceBlocks: false,
        };
      }
      if (mode === 'publish') {
        return {
          ...destination,
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: false,
        };
      }
      return {
        ...destination,
        enabled: true,
        storeEvents: true,
        storeBlocks: true,
        copySourceBlocks: true,
      };
    };

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: entry.destinations.map((destination) =>
        destination.sourceId === sourceId ? apply(destination) : destination
      ),
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
  }

  function hubStorageHeading(targetVolumeId: string): string {
    return explicitVolumePolicy(targetVolumeId)
      ? 'This hub uses custom storage locations'
      : 'This hub uses the default storage locations';
  }

  function hubStorageIntro(targetVolumeId: string): string {
    return explicitVolumePolicy(targetVolumeId)
      ? 'These choices apply only to this hub.'
      : 'These choices come from your default storage locations. Change any location below if this hub should behave differently.';
  }

  function hubAttachedSources(targetVolumeId: string): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => hubLocationMode(targetVolumeId, source.id) !== 'off');
  }

  function hubAvailableSources(targetVolumeId: string): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => hubLocationMode(targetVolumeId, source.id) === 'off');
  }

  function openHubLocationDialog(targetVolumeId: string): void {
    hubLocationDialogVolumeId = targetVolumeId;
  }

  function closeHubLocationDialog(): void {
    hubLocationDialogVolumeId = null;
  }

  function addSourceToHub(targetVolumeId: string, sourceId: string): void {
    setHubLocationMode(targetVolumeId, sourceId, 'store');
    hubLocationDialogVolumeId = null;
    successMessage = 'Storage location added to this hub.';
  }

  function openStorageSetupFromHubDialog(): void {
    hubLocationDialogVolumeId = null;
    onOpenStorageSetup?.();
  }

  function canRemoveAnySource(): boolean {
    return (configDraft?.sources.length ?? 0) > 1;
  }

  function keepsFullCopy(destination: VolumeDestinationConfig | null): boolean {
    return Boolean(
      destination?.enabled &&
      destination.storeEvents &&
      destination.storeBlocks &&
      destination.copySourceBlocks
    );
  }

  function setKeepFullCopy(
    targetVolumeId: string | null,
    sourceId: string,
    keepFullCopy: boolean
  ): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    const apply = (destination: VolumeDestinationConfig): VolumeDestinationConfig => {
      if (!keepFullCopy) {
        return {
          ...destination,
          enabled: false,
          storeEvents: false,
          storeBlocks: false,
          copySourceBlocks: false,
        };
      }
      return {
        ...destination,
        enabled: true,
        storeEvents: true,
        storeBlocks: true,
        copySourceBlocks: true,
      };
    };

    if (targetVolumeId === null) {
      configDraft = {
        ...configDraft,
        defaultVolume: {
          destinations: configDraft.defaultVolume.destinations.map((destination) =>
            destination.sourceId === sourceId ? apply(destination) : destination
          ),
        },
      };
      return;
    }

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: entry.destinations.map((destination) =>
        destination.sourceId === sourceId ? apply(destination) : destination
      ),
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
  }

  function canReuseOtherGuaranteedCopies(destination: VolumeDestinationConfig | null): boolean {
    return keepsFullCopy(destination) && destination?.fullPolicy === 'drop-older-blocks';
  }

  function knownManagedMirrorPaths(): Set<string> {
    const known = new Set<string>();
    for (const summary of managedShares) {
      const resolved = normalizeComparablePath(summarySourcePath(summary));
      if (resolved) {
        known.add(resolved);
      }
    }
    return known;
  }

  function sourceSuggestionRows(): Array<{
    source: DiscoveredNearbytesSource;
    alreadyAdded: boolean;
    dismissed: boolean;
  }> {
    if (!configDraft) return [];
    const unique = new Map<string, DiscoveredNearbytesSource>();
    const managedMirrorPaths = knownManagedMirrorPaths();
    for (const source of discoveredSources) {
      const key = normalizeComparablePath(source.path);
      if (managedMirrorPaths.has(key)) {
        continue;
      }
      const current = unique.get(key);
      if (!current || sourceSuggestionPriority(source.sourceType) < sourceSuggestionPriority(current.sourceType)) {
        unique.set(key, source);
      }
    }

    const currentSources = configDraft?.sources ?? [];
    return Array.from(unique.values())
      .map((source) => {
        const normalized = normalizeComparablePath(source.path);
        return {
          source,
          alreadyAdded: currentSources.some((entry) => normalizeComparablePath(entry.path) === normalized),
          dismissed: dismissedDiscoveries.includes(normalized),
        };
      })
      .filter((row) => !row.alreadyAdded && !row.dismissed);
  }

  function dismissedSuggestionCount(): number {
    if (!configDraft) return 0;
    const all = new Set<string>();
    for (const source of discoveredSources) {
      all.add(normalizeComparablePath(source.path));
    }
    let count = 0;
    for (const value of dismissedDiscoveries) {
      if (all.has(value)) count += 1;
    }
    return count;
  }

  function restoreDismissedSuggestions(): void {
    dismissedDiscoveries = [];
  }

  function hasSourcePath(source: SourceConfigEntry): boolean {
    return source.path.trim() !== '';
  }

  function sourceSuggestionPriority(value: DiscoveredNearbytesSource['sourceType']): number {
    if (value === 'marker') return 0;
    if (value === 'layout') return 1;
    return 2;
  }

  function sourceSuggestionCopy(source: DiscoveredNearbytesSource): string {
    if (source.sourceType === 'marker') {
      return 'Nearbytes found an existing folder here automatically.';
    }
    if (source.sourceType === 'layout') {
      return 'Nearbytes found stored data here automatically.';
    }
    return 'Suggested synced folder. Add it if you want Nearbytes to use it.';
  }

  function locationAvailability(source: SourceConfigEntry) {
    const status = sourceStatus(source.id);
    if (source.moveFromSourceId) {
      return { label: 'Move target', tone: 'good' as StatusTone };
    }
    if (!source.enabled) {
      return { label: 'Turned off', tone: 'muted' as StatusTone };
    }
    if (!hasSourcePath(source)) {
      return { label: 'Choose a folder', tone: 'warn' as StatusTone };
    }
    if (status?.exists === false) {
      return { label: 'Folder missing', tone: 'warn' as StatusTone };
    }
    if (status && !status.isDirectory) {
      return { label: 'Not a folder', tone: 'warn' as StatusTone };
    }
    return { label: 'Ready', tone: 'good' as StatusTone };
  }

  function locationWriteState(source: SourceConfigEntry) {
    const status = sourceStatus(source.id);
    if (!source.writable) {
      return { label: 'Read only', tone: 'muted' as StatusTone };
    }
    if (!source.enabled) {
      return { label: 'Writing paused', tone: 'muted' as StatusTone };
    }
    if (status && status.exists && !status.canWrite) {
      return { label: 'Cannot write now', tone: 'warn' as StatusTone };
    }
    return { label: 'Can store here', tone: 'good' as StatusTone };
  }

  function locationSummary(source: SourceConfigEntry): string {
    const status = sourceStatus(source.id);
    if (source.moveFromSourceId) {
      return `Nearbytes is moving data here from ${source.moveFromSourceId}. Both folders stay active until the move finishes.`;
    }
    if (hasPendingMove(source.id)) {
      return 'Nearbytes is moving this location to a new folder. Both folders stay active until the move finishes.';
    }
    if (!hasSourcePath(source)) {
      return 'Choose a folder to finish setting up this location.';
    }
    if (!source.enabled) {
      return 'Nearbytes will ignore this location until you turn it back on.';
    }
    if (status?.exists === false) {
      return 'This folder is not available right now. Your choices stay stored, but Nearbytes cannot use this location.';
    }
    if (status && !status.isDirectory) {
      return 'This path exists, but it is not a folder.';
    }
    if (source.writable && status?.canWrite === false) {
      return 'Nearbytes can look here, but it cannot store here right now.';
    }
    if (source.writable) {
      return 'This location is ready.';
    }
    return 'This location is ready for reading only.';
  }

  function usageSummary(sourceId: string): string {
    const totalBytes = sourceStatus(sourceId)?.usage.totalBytes ?? 0;
    if (totalBytes <= 0) {
      return 'Nothing is stored here yet.';
    }
    return `Using ${formatSize(totalBytes)} here.`;
  }

  function protectionSummary(targetVolumeId: string | null): string {
    const count = durableLocationCount(targetVolumeId);
    if (count === 0) return 'Choose a full copy location';
    if (count === 1) return '1 full copy location';
    return `${count} full copy locations`;
  }

  function protectionHint(targetVolumeId: string | null): string {
    if (hasDurableDestination(targetVolumeId)) {
      return targetVolumeId
        ? 'This hub already has at least one location keeping a full copy.'
        : 'New hubs will start with at least one location keeping a full copy.';
    }
    return targetVolumeId
      ? 'Choose at least one writable location below to keep a full copy of this hub.'
      : 'Every new hub needs at least one writable location that keeps a full copy.';
  }

  function copyHelpText(targetVolumeId: string | null, source: SourceConfigEntry): string {
    const destination = destinationFor(targetVolumeId, source.id);
    const status = sourceStatus(source.id);
    if (!keepsFullCopy(destination)) {
      return targetVolumeId
        ? 'This location is not keeping the whole hub.'
        : 'New hubs will not keep a full copy here by default.';
    }
    if (!source.enabled) {
      return 'This location is chosen, but the location itself is turned off right now.';
    }
    if (!source.writable) {
      return 'This location is chosen, but Nearbytes cannot store the whole hub here until writing is allowed.';
    }
    if (status?.exists === false) {
      return 'This location is chosen, but the folder is not available right now.';
    }
    if (status && status.exists && !status.canWrite) {
      return 'This location is chosen, but Nearbytes cannot write to this folder right now.';
    }
    if (canReuseOtherGuaranteedCopies(destination)) {
      return 'If this location runs low on room, Nearbytes may trim older data here, but only after another full copy already has it.';
    }
    return 'This location keeps the whole hub.';
  }

  function hubLocationNote(targetVolumeId: string, source: SourceConfigEntry): string | null {
    const status = sourceStatus(source.id);
    const mode = hubLocationMode(targetVolumeId, source.id);
    if (source.moveFromSourceId) {
      return `Nearbytes is moving data here from ${source.moveFromSourceId}. Both folders stay active until the move finishes.`;
    }
    if (hasPendingMove(source.id)) {
      return 'Nearbytes is moving this location to a new folder. Both folders stay active until the move finishes.';
    }
    if (!hasSourcePath(source)) {
      return 'Choose a folder to finish setting up this location.';
    }
    if (!source.enabled) {
      return 'This location is turned off right now.';
    }
    if (status?.exists === false) {
      return 'This folder is not available right now.';
    }
    if (status && !status.isDirectory) {
      return 'This path exists, but it is not a folder.';
    }
    if (mode !== 'off' && !source.writable) {
      return mode === 'store'
        ? 'Writing is turned off here, so this location cannot keep a full copy yet.'
        : 'Writing is turned off here, so this location cannot publish updates yet.';
    }
    if (mode !== 'off' && status?.canWrite === false) {
      return mode === 'store'
        ? 'Nearbytes cannot write to this folder right now, so it cannot keep a full copy yet.'
        : 'Nearbytes cannot write to this folder right now, so it cannot publish updates yet.';
    }
    if (mode === 'publish') {
      return 'This location will receive new updates for this hub, but it is not keeping the whole hub here.';
    }
    if (mode === 'off') {
      return 'This location is available, but this hub is not using it.';
    }
    return null;
  }

  function applyRootsResponse(response: {
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
  }): void {
    configPath = response.configPath;
    configDraft = cloneConfig(response.config);
    runtime = response.runtime;
    lastSavedSignature = serializeConfig(cloneConfig(response.config));
  }

  function applyIntegrationsResponse(input: {
    accounts: ProviderAccount[];
    providers: ProviderCatalogEntry[];
    shares: ManagedShareSummary[];
    incomingShares: IncomingManagedShareOffer[];
    incomingInvites: IncomingProviderContactInvite[];
  }): void {
    providerAccounts = input.accounts;
    providerCatalog = sortProviders(input.providers);
    managedShares = sortManagedShareSummaries(input.shares);
    incomingManagedShareOffers = sortIncomingManagedShareOffers(input.incomingShares);
    incomingProviderContactInvites = sortIncomingProviderContactInviteEntries(input.incomingInvites);
    providerSetupDrafts = {
      ...providerSetupDrafts,
      ...Object.fromEntries(
        input.providers.map((provider) => [
          provider.provider,
          {
            clientId:
              provider.provider === 'gdrive' || provider.provider === 'github'
                ? provider.setup.config?.clientId ?? providerSetupDraft(provider.provider).clientId
                : providerSetupDraft(provider.provider).clientId,
          },
        ])
      ),
    };
    for (const account of input.accounts) {
      if (account.state === 'connected') {
        clearProviderSession(account.provider);
      }
    }
  }

  async function loadPanel(options?: { background?: boolean }) {
    const keepVisible = options?.background === true && configDraft !== null;
    if (!keepVisible) {
      loading = true;
      errorMessage = '';
      successMessage = '';
    }
    try {
      const [rootsResponse, accountsResponse, sharesResponse, incomingSharesResponse, incomingInvitesResponse] = await Promise.all([
        getRootsConfig(),
        listProviderAccounts(),
        listManagedShares(),
        listIncomingManagedShares(),
        listIncomingProviderContactInvites(),
      ]);
      applyRootsResponse(rootsResponse);
      applyIntegrationsResponse({
        accounts: accountsResponse.accounts,
        providers: accountsResponse.providers,
        shares: sharesResponse.shares,
        incomingShares: incomingSharesResponse.shares,
        incomingInvites: incomingInvitesResponse.invites,
      });
      autosaveStatus = 'idle';
      void refreshDiscoverySuggestions();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load storage locations';
    } finally {
      if (!keepVisible) {
        loading = false;
      }
    }
  }

  async function autosavePanel(expectedSignature: string) {
    if (!configDraft) return;
    errorMessage = '';
    autosaveStatus = 'saving';
    try {
      const response = await updateRootsConfig(configDraft);
      applyRootsResponse(response);
      autosaveStatus = lastSavedSignature === expectedSignature ? 'saved' : 'pending';
      successMessage = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to save';
      autosaveStatus = 'error';
    }
  }

  async function refreshDiscoverySuggestions() {
    const runId = ++discoveryRunId;
    discoveryLoading = true;
    discoveryError = '';
    try {
      const response = await discoverSources({
        maxDepth: DISCOVERY_SCAN_MAX_DEPTH,
        maxDirectories: DISCOVERY_SCAN_MAX_DIRECTORIES,
      });
      if (runId !== discoveryRunId) return;
      discoveredSources = response.sources;
    } catch (error) {
      if (runId !== discoveryRunId) return;
      discoveryError = error instanceof Error ? error.message : 'Failed to scan folders';
    } finally {
      if (runId === discoveryRunId) {
        discoveryLoading = false;
      }
    }
  }

  async function pickFolderPath(initialPath = ''): Promise<string | null> {
    const picked = await chooseDirectoryPath(initialPath);
    return typeof picked === 'string' && picked.trim() !== '' ? picked.trim() : null;
  }

  async function addSourceCard() {
    if (!configDraft) return;
    if (hasDesktopDirectoryPicker()) {
      const selectedPath = await pickFolderPath();
      if (!selectedPath) return;
      const normalized = normalizeComparablePath(selectedPath);
      if (configDraft.sources.some((entry) => normalizeComparablePath(entry.path) === normalized)) {
        successMessage = 'That folder is already saved.';
        return;
      }
      configDraft = {
        ...configDraft,
        sources: [...configDraft.sources, createSource(selectedPath)],
      };
      successMessage = 'Storage location added.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: [...configDraft.sources, createSource()],
    };
  }

  async function chooseSourceFolder(sourceId: string): Promise<void> {
    if (!configDraft) return;
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    const selectedPath = await pickFolderPath(source?.path ?? '');
    if (!selectedPath) return;
    const normalized = normalizeComparablePath(selectedPath);
    const duplicate = configDraft.sources.find(
      (entry) => entry.id !== sourceId && normalizeComparablePath(entry.path) === normalized
    );
    if (duplicate) {
      errorMessage = 'That folder is already in your saved locations.';
      return;
    }
    updateSourceField(sourceId, 'path', selectedPath);
    successMessage = 'Folder updated.';
  }

  async function moveSourceFolder(sourceId: string): Promise<void> {
    if (!configDraft) return;
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    if (!source) return;
    if (source.moveFromSourceId) {
      errorMessage = 'This storage location is already finishing a move.';
      return;
    }
    if (hasPendingMove(sourceId)) {
      errorMessage = 'This storage location is already moving to another folder.';
      return;
    }

    const selectedPath = await pickFolderPath(source.path);
    if (!selectedPath) return;
    const normalized = normalizeComparablePath(selectedPath);
    if (normalizeComparablePath(source.path) === normalized) {
      successMessage = 'Folder unchanged.';
      return;
    }
    const duplicate = configDraft.sources.find(
      (entry) => entry.id !== sourceId && normalizeComparablePath(entry.path) === normalized
    );
    if (duplicate) {
      errorMessage = 'That folder is already in your saved locations.';
      return;
    }

    movingSourceId = sourceId;
    errorMessage = '';
    successMessage = '';
    autosaveStatus = 'saving';
    try {
      const prepared = prepareSourceMoveConfig(sourceId, selectedPath);
      const saved = await updateRootsConfig(prepared.config);
      applyRootsResponse(saved);
      autosaveStatus = 'saved';
      successMessage = 'Move started. Nearbytes is copying data to the new folder.';

      const consolidated = await consolidateRoot(sourceId, prepared.targetSource.id);
      applyRootsResponse(consolidated);
      autosaveStatus = 'saved';
      successMessage = 'Folder moved.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to move folder';
      autosaveStatus = 'error';
    } finally {
      movingSourceId = null;
    }
  }

  function addDiscoveredSource(source: DiscoveredNearbytesSource) {
    if (!configDraft) return;
    const normalized = normalizeComparablePath(source.path);
    if (configDraft.sources.some((entry) => normalizeComparablePath(entry.path) === normalized)) {
      successMessage = 'That folder is already saved.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: [...configDraft.sources, createSource(source.path)],
    };
    successMessage = `Added ${formatProvider(source.provider)} location.`;
  }

  function dismissDiscovery(source: DiscoveredNearbytesSource) {
    const normalized = normalizeComparablePath(source.path);
    if (dismissedDiscoveries.includes(normalized)) return;
    dismissedDiscoveries = [...dismissedDiscoveries, normalized];
  }

  async function openSourceFolder(sourceId: string) {
    errorMessage = '';
    successMessage = '';
    try {
      await openRootInFileManager(sourceId);
      successMessage = 'Opened folder.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
    }
  }

  async function connectProvider(provider: ProviderCatalogEntry): Promise<void> {
    integrationBusyKey = `connect:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    const controller = beginProviderRequest(provider.provider, {
      phase: 'connecting',
      title: provider.provider === 'mega' ? 'Preparing MEGA connection' : `Connecting ${provider.label}`,
      detail:
        provider.provider === 'mega'
          ? 'Checking whether the local helper is ready before sending your credentials.'
          : `Starting the ${provider.label} sign-in flow.`,
      canCancel: true,
      canReset: true,
    });
    try {
      if (provider.setup.status === 'needs-install' && provider.setup.canInstall) {
        setProviderFlowState(provider.provider, {
          phase: 'installing',
          title: `Installing ${provider.label} helper`,
          detail:
            provider.provider === 'mega'
              ? 'Downloading and installing the local MEGAcmd helper. This can take a few seconds.'
              : `Installing the ${provider.label} helper.`,
          canCancel: true,
          canReset: true,
        });
        await installProvider(provider, controller.signal, false);
        if (controller.signal.aborted) {
          return;
        }
      }
      if (provider.setup.status === 'needs-config') {
        throw new Error(provider.setup.detail);
      }

      const draft = providerCredentialDraft(provider.provider);
      setProviderFlowState(provider.provider, {
        phase: 'connecting',
        title:
          provider.provider === 'mega' && draft.mode === 'signup'
            ? 'Creating MEGA account'
            : `Connecting ${provider.label}`,
        detail:
          provider.provider === 'mega' && draft.mode === 'signup'
            ? 'Submitting your account details to MEGA and waiting for the confirmation step.'
            : provider.provider === 'mega'
              ? 'Submitting your MEGA credentials and opening a local session.'
              : `Handing off to ${provider.label} to continue sign-in.`,
        canCancel: true,
        canReset: true,
      });
      if (provider.provider === 'mega') {
        if (draft.mode === 'signup') {
          if (draft.name.trim() === '' || draft.email.trim() === '' || draft.password.trim() === '') {
            throw new Error('Enter your name, email, and password first.');
          }
        } else if (draft.email.trim() === '' || draft.password.trim() === '') {
          throw new Error('Enter the MEGA email and password first.');
        }
      }

      const response = await connectProviderAccount({
        provider: provider.provider,
        mode: provider.provider === 'mega' ? draft.mode : undefined,
        label: provider.label,
        preferred: provider.provider === 'gdrive',
        email: provider.provider === 'mega' ? draft.email.trim() || undefined : undefined,
        credentials:
          provider.provider === 'mega'
            ? {
                name: draft.mode === 'signup' ? draft.name.trim() || undefined : undefined,
                email: draft.email.trim() || undefined,
                password: draft.password,
                mfaCode: draft.mode === 'login' && draft.useMfa ? draft.mfaCode.trim() || undefined : undefined,
              }
            : undefined,
      }, { signal: controller.signal });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Connection request cancelled.',
          canCancel: false,
          canReset: true,
        });
      } else {
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to connect ${provider.label}`;
      }
    } finally {
      finishProviderRequest(provider.provider, controller, pendingSessionForProvider(provider.provider) === null);
      integrationBusyKey = null;
    }
  }

  async function configureProvider(provider: ProviderCatalogEntry): Promise<void> {
    integrationBusyKey = `setup:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const draft = providerSetupDraft(provider.provider);
      if (provider.provider === 'gdrive' && draft.clientId.trim() === '') {
        throw new Error('Paste the Google Desktop app client id first.');
      }
      await configureProviderSetup(provider.provider, {
        clientId: draft.clientId.trim() || undefined,
      });
      successMessage =
        provider.provider === 'gdrive'
          ? 'Google client ID saved. You can connect now.'
          : `${provider.label} setup updated.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to configure ${provider.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function installProvider(
    provider: ProviderCatalogEntry,
    signal?: AbortSignal,
    ownBusyKey = true
  ): Promise<void> {
    const controller = signal ? null : beginProviderRequest(provider.provider, {
      phase: 'installing',
      title: `Installing ${provider.label} helper`,
      detail: `Downloading and installing the ${provider.label} helper locally.`,
      canCancel: true,
      canReset: true,
    });
    if (ownBusyKey) {
      integrationBusyKey = `install:${provider.provider}`;
    }
    errorMessage = '';
    successMessage = '';
    try {
      await installProviderHelper(provider.provider, { signal: signal ?? controller?.signal });
      successMessage = `${provider.label} helper installed.`;
      setProviderFlowState(provider.provider, {
        phase: 'connecting',
        title: `${provider.label} helper ready`,
        detail: 'The local helper is installed. You can continue connecting now.',
        canCancel: false,
        canReset: true,
      });
      await loadPanel();
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Stopped waiting for the helper installation.',
          canCancel: false,
          canReset: true,
        });
      } else {
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to install ${provider.label} helper`;
        throw error;
      }
    } finally {
      if (controller) {
        finishProviderRequest(provider.provider, controller, false);
      }
      if (ownBusyKey) {
        integrationBusyKey = null;
      }
    }
  }

  function openProviderDocs(url: string | undefined): void {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function disconnectProvider(provider: ProviderCatalogEntry): Promise<void> {
    if (!provider.accountId) return;
    integrationBusyKey = `disconnect:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      await disconnectProviderAccount(provider.accountId);
      clearProviderSession(provider.provider);
      successMessage = `${provider.label} disconnected.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to disconnect ${provider.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function createManagedShareForVolume(provider: ProviderCatalogEntry): Promise<void> {
    if (!volumeId || !provider.accountId) return;
    integrationBusyKey = `create:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const remoteDescriptor = provider.provider === 'github' ? githubShareDescriptor(defaultManagedShareLabel()) : undefined;
      await createManagedShare({
        provider: provider.provider,
        accountId: provider.accountId,
        label: defaultManagedShareLabel(),
        volumeId,
        remoteDescriptor,
      });
      successMessage = `${provider.label} location created for this hub.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to create ${provider.label} location`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function createManagedShareForProvider(provider: ProviderCatalogEntry): Promise<void> {
    if (!provider.accountId) return;
    integrationBusyKey = `create:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const label = managedShareCreateLabel(provider.provider);
      await createManagedShare({
        provider: provider.provider,
        accountId: provider.accountId,
        label,
        remoteDescriptor: provider.provider === 'github' ? githubShareDescriptor(label) : undefined,
      });
      if (providerLocationNameDraft(provider.provider).trim()) {
        setProviderLocationName(provider.provider, '');
      }
      setProviderCreateComposerOpenState(provider.provider, false);
      successMessage = `${provider.label} location created.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to create ${provider.label} location`;
    } finally {
      integrationBusyKey = null;
    }
  }

  function handleProviderAddLocation(provider: ProviderCatalogEntry): void {
    if (isInlineLocationComposerProvider(provider.provider)) {
      openProviderCreateComposer(provider.provider);
      return;
    }
    void createManagedShareForProvider(provider);
  }

  async function removeManagedShareSummary(summary: ManagedShareSummary): Promise<void> {
    integrationBusyKey = `remove-share:${summary.share.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await removeManagedShare(summary.share.id);
      successMessage = `${summary.share.label} removed.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to remove ${summary.share.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  function githubShareLabel(): string {
    const draft = providerShareDraft('github');
    const repoName = draft.repoName.trim();
    const basePath = normalizeGithubDraftPath(draft.basePath);
    if (repoName && basePath) {
      const segments = basePath.split('/').filter(Boolean);
      const leaf = segments[segments.length - 1];
      return leaf ? `${repoName}/${leaf}` : repoName;
    }
    if (repoName) {
      return repoName;
    }
    return defaultManagedShareLabel();
  }

  function githubShareDescriptor(label: string): Record<string, unknown> {
    const draft = providerShareDraft('github');
    const repoOwner = draft.repoOwner.trim();
    const repoName = draft.repoName.trim();
    if (!repoOwner || !repoName) {
      throw new Error('Enter the GitHub repo owner and repo name first.');
    }
    return {
      repoOwner,
      repoName,
      branch: draft.branch.trim() || 'main',
      basePath: normalizeGithubDraftPath(draft.basePath) || defaultGithubBasePath(label),
    };
  }

  function normalizeGithubDraftPath(value: string): string {
    return value.trim().replace(/^\/+/u, '').replace(/\/+/gu, '/').replace(/\/+$/u, '');
  }

  function clearProviderSession(provider: string): void {
    const timer = providerSessionTimers.get(provider);
    if (timer) {
      clearTimeout(timer);
      providerSessionTimers.delete(provider);
    }
    if (!(provider in providerAuthSessions)) {
      return;
    }
    const next = { ...providerAuthSessions };
    delete next[provider];
    providerAuthSessions = next;
    if (providerFlowState(provider)?.phase === 'waiting-confirmation') {
      setProviderFlowState(provider, null);
    }
  }

  async function handleProviderConnectResponse(
    provider: ProviderCatalogEntry,
    response: Awaited<ReturnType<typeof connectProviderAccount>>
  ): Promise<void> {
    if (response.status === 'connected' && response.account) {
      clearProviderSession(provider.provider);
      setProviderFlowState(provider.provider, null);
      if (provider.provider === 'mega') {
        setProviderCredential(provider.provider, 'password', '');
        setProviderCredential(provider.provider, 'mfaCode', '');
        setProviderCredential(provider.provider, 'useMfa', false);
        setProviderCredential(provider.provider, 'confirmationLink', '');
      }
      successMessage = `${provider.label} connected.`;
      await loadPanel();
      return;
    }

    if (response.authSession) {
      providerAuthSessions = {
        ...providerAuthSessions,
        [provider.provider]: response.authSession,
      };
    }

    if (response.status === 'failed') {
      setProviderFlowState(provider.provider, null);
      throw new Error(response.authSession?.detail || `Failed to connect ${provider.label}`);
    }

    if (provider.provider === 'mega') {
      setProviderFlowState(provider.provider, {
        phase: 'waiting-confirmation',
        title: 'Waiting for MEGA confirmation',
        detail: response.authSession?.detail || 'Check your inbox, then paste the MEGA confirmation link here.',
        canCancel: false,
        canReset: true,
      });
    } else {
      setProviderFlowState(provider.provider, {
        phase: 'polling',
        title: `Waiting for ${provider.label}`,
        detail: response.authSession?.detail || `Finish the ${provider.label} sign-in flow in the browser.`,
        canCancel: true,
        canReset: true,
      });
    }

    successMessage =
      provider.provider === 'gdrive'
        ? 'Finish Google sign-in in the browser that just opened.'
        : response.authSession?.detail || `${provider.label} is waiting for confirmation.`;
    if (response.authSession && provider.provider !== 'mega') {
      scheduleProviderSessionPoll(provider, response.authSession.id);
    }
  }

  async function confirmMegaSignup(provider: ProviderCatalogEntry): Promise<void> {
    const session = pendingSessionForProvider(provider.provider);
    if (!session) {
      errorMessage = 'Start the MEGA account creation flow first.';
      return;
    }
    const draft = providerCredentialDraft(provider.provider);
    if (draft.confirmationLink.trim() === '') {
      errorMessage = 'Paste the MEGA confirmation link first.';
      return;
    }
    integrationBusyKey = `confirm:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    const controller = beginProviderRequest(provider.provider, {
      phase: 'confirming',
      title: 'Confirming MEGA account',
      detail: 'Sending the confirmation link back to MEGA to finish account creation.',
      canCancel: true,
      canReset: true,
    });
    try {
      const response = await connectProviderAccount({
        provider: provider.provider,
        mode: 'confirm-signup',
        authSessionId: session.id,
        credentials: {
          confirmationLink: draft.confirmationLink.trim(),
        },
      }, { signal: controller.signal });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Confirmation request cancelled.',
          canCancel: false,
          canReset: true,
        });
      } else {
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to confirm ${provider.label} account`;
      }
    } finally {
      finishProviderRequest(provider.provider, controller, pendingSessionForProvider(provider.provider) === null);
      integrationBusyKey = null;
    }
  }

  function scheduleProviderSessionPoll(provider: ProviderCatalogEntry, authSessionId: string): void {
    const previous = providerSessionTimers.get(provider.provider);
    if (previous) {
      clearTimeout(previous);
    }

    const timer = setTimeout(() => {
      void pollProviderSession(provider, authSessionId);
    }, 1200);
    providerSessionTimers.set(provider.provider, timer);
  }

  async function pollProviderSession(provider: ProviderCatalogEntry, authSessionId: string): Promise<void> {
    const controller = beginProviderRequest(provider.provider, {
      phase: 'polling',
      title: `Waiting for ${provider.label}`,
      detail: `Checking whether ${provider.label} finished the sign-in flow.`,
      canCancel: true,
      canReset: true,
    });
    try {
      const response = await connectProviderAccount({
        provider: provider.provider,
        authSessionId,
        preferred: provider.provider === 'gdrive',
      }, { signal: controller.signal });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Stopped waiting for the browser sign-in to finish.',
          canCancel: false,
          canReset: true,
        });
      } else {
        clearProviderSession(provider.provider);
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to finish ${provider.label} sign-in`;
      }
    } finally {
      finishProviderRequest(provider.provider, controller, pendingSessionForProvider(provider.provider) === null);
    }
  }

  async function inviteManagedSharePeers(summary: ManagedShareSummary): Promise<void> {
    const emails = parseInviteEmails(managedShareInviteDraft(summary.share.id));
    if (emails.length === 0) {
      errorMessage = 'Enter at least one email address to invite.';
      return;
    }
    integrationBusyKey = `invite:${summary.share.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await inviteManagedShare(summary.share.id, emails);
      setManagedShareInviteDraft(summary.share.id, '');
      successMessage = `${summary.share.label} location shared with ${emails.join(', ')}.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to invite people to this location';
    } finally {
      integrationBusyKey = null;
    }
  }

  async function acceptProviderContactInviteEntry(invite: IncomingProviderContactInvite): Promise<void> {
    integrationBusyKey = `accept-contact:${invite.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await acceptIncomingProviderContactInvite({
        provider: invite.provider,
        accountId: invite.accountId,
        inviteId: invite.id,
      });
      successMessage = `${invite.label} is now an accepted ${providerLabelForIncoming(invite.provider)} contact.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to accept provider contact invite';
    } finally {
      integrationBusyKey = null;
    }
  }

  async function acceptIncomingManagedShareOffer(offer: IncomingManagedShareOffer): Promise<void> {
    integrationBusyKey = `accept-share:${offer.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await acceptManagedShare({
        provider: offer.provider,
        accountId: offer.accountId,
        label: offer.label,
        volumeId: mode === 'volume' ? volumeId ?? undefined : undefined,
        localPath: offer.suggestedLocalPath,
        remoteDescriptor: offer.remoteDescriptor,
      });
      successMessage = `${offer.label} is ready in ${mode === 'volume' && volumeId ? 'this hub' : 'Nearbytes'}.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to accept incoming storage location';
    } finally {
      integrationBusyKey = null;
    }
  }

  function clampReserve(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_RESERVE_PERCENT;
    return Math.max(0, Math.min(95, parsed));
  }

  function toggleReserveEditor(key: string): void {
    activeReserveEditorKey = activeReserveEditorKey === key ? null : key;
  }

  function closeReserveEditor(key: string): void {
    if (activeReserveEditorKey === key) {
      activeReserveEditorKey = null;
    }
  }

</script>

{#if loading && !configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'}>
    <p class="storage-message">Loading storage locations...</p>
  </section>
{:else if configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'}>
    {#snippet unifiedShareCard(view: UnifiedShareView)}
      <ShareCard
        provider={view.provider}
        title={view.title}
        copy={view.copy}
        active={view.active}
        statusBadges={view.statusBadges}
        meta={view.meta}
      >
        {#snippet metaActions()}
          <div class="inline-reserve-slot">
            {#if activeReserveEditorKey === view.reserveKey}
              <label class="inline-reserve-editor" title="Minimum available storage to leave on this drive.">
                <span>Keep free</span>
                <select
                  class="panel-input inline-reserve-select"
                  value={String(view.reservePercent)}
                  onchange={(event) => {
                    view.onReserveChange(clampReserve((event.currentTarget as HTMLSelectElement).value));
                    closeReserveEditor(view.reserveKey);
                  }}
                  onblur={() => closeReserveEditor(view.reserveKey)}
                >
                  {#each RESERVE_OPTIONS as option}
                    <option value={option}>{formatPercent(option)}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <button type="button" class="inline-reserve-button" onclick={() => toggleReserveEditor(view.reserveKey)}>
                <span>Keep free {formatPercent(view.reservePercent)}</span>
              </button>
            {/if}
          </div>
        {/snippet}
        {#snippet controls()}
          <div class="setting-list">
            <label class="setting-row">
              <span>Use this location</span>
              <input type="checkbox" checked={view.readable} onchange={view.onToggleReadable} />
            </label>
            <label class="setting-row">
              <span>Store here</span>
              <input type="checkbox" checked={view.writable} onchange={view.onToggleWritable} />
            </label>
            <label class="setting-row">
              <span>Default full copy</span>
              <input type="checkbox" checked={view.defaultEnabled} onchange={view.onToggleDefault} />
            </label>
          </div>
        {/snippet}
        {#snippet actions()}
          <div class="storage-card-actions">
            <div class="button-row storage-card-actions-left">
              {#if view.onRemove && view.canRemove}
                <ArmedActionButton
                  class="panel-btn subtle compact icon-btn armed-icon-danger"
                  icon={Trash2}
                  text=""
                  armed={true}
                  autoDisarmMs={3000}
                  title="Remove"
                  ariaLabel="Remove"
                  resetKey={view.removeResetKey}
                  onPress={view.onRemove}
                />
              {/if}
              {#if view.onMove}
                <button
                  type="button"
                  class="panel-btn subtle compact"
                  onclick={view.onMove}
                  disabled={view.moveDisabled}
                >
                  <ArrowRightLeft size={14} strokeWidth={2} />
                  <span>{view.moveLabel ?? 'Move'}</span>
                </button>
              {/if}
            </div>

            <div class="button-row storage-card-actions-right">
              {#if view.onOpen}
                <button
                  type="button"
                  class="panel-btn subtle compact"
                  onclick={view.onOpen}
                  disabled={view.openDisabled}
                  title={view.openTitle}
                >
                  <FolderOpen size={14} strokeWidth={2} />
                  <span>Open</span>
                </button>
              {/if}
            </div>
          </div>
        {/snippet}
        {#snippet footer()}
          {#if view.warning}
            <p class="warning-copy">Last write problem: {view.warning}</p>
          {/if}
          {#if view.attachments.length > 0}
            <div class="fact-row share-volume-row">
              {#each view.attachments as attachment}
                {#if attachment.known}
                  <button
                    type="button"
                    class="mini-pill mini-pill-button"
                    onclick={() => onOpenVolumeRouting?.(attachment.volumeId)}
                  >
                    {attachment.label}
                  </button>
                {:else}
                  <span class="mini-pill">{attachment.label}</span>
                {/if}
              {/each}
            </div>
          {/if}
        {/snippet}
      </ShareCard>
    {/snippet}
    {#snippet addLocationAction(label: string, title: string, onPress: () => void, disabled: boolean)}
      <button type="button" class="panel-btn subtle compact" onclick={onPress} {title} {disabled}>
        <Plus size={14} strokeWidth={2} />
        <span>{label}</span>
      </button>
    {/snippet}
    {#snippet addLocationComposer(provider: ProviderCatalogEntry)}
      <form class="provider-create-inline" onsubmit={(event) => {
        event.preventDefault();
        void createManagedShareForProvider(provider);
      }}>
        <input
          class="panel-input provider-create-inline-input"
          type="text"
          value={providerLocationNameDraft(provider.provider)}
          placeholder={nextManagedShareLabel(provider.provider)}
          oninput={(event) => setProviderLocationName(provider.provider, (event.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="panel-btn primary compact"
          disabled={integrationBusyKey === `create:${provider.provider}`}
        >
          <span>{integrationBusyKey === `create:${provider.provider}` ? 'Creating...' : 'Create'}</span>
        </button>
        <button
          type="button"
          class="panel-btn subtle compact"
          onclick={() => closeProviderCreateComposer(provider.provider)}
          disabled={integrationBusyKey === `create:${provider.provider}`}
        >
          <span>Cancel</span>
        </button>
      </form>
    {/snippet}
    {#if mode === 'global'}
      <div class="provider-tabs" role="tablist" aria-label="Storage providers">
        <button
          type="button"
          class="provider-tab"
          class:active={selectedGlobalProvider === 'local'}
          onclick={() => (selectedGlobalProvider = 'local')}
        >
          <span class="provider-tab-label">This device</span>
          <span class="provider-tab-copy">{countLabel(localMachineShareCount(), 'location')}</span>
        </button>
        {#each providerCatalog as provider (provider.provider)}
          <button
            type="button"
            class="provider-tab"
            class:active={selectedGlobalProvider === provider.provider}
            onclick={() => (selectedGlobalProvider = provider.provider)}
          >
            <span class="provider-tab-label">{provider.label}</span>
            <span class="provider-tab-copy">
              {provider.isConnected ? countLabel(providerVisibleShareCount(provider.provider), 'location') : providerCardStatus(provider)}
            </span>
          </button>
        {/each}
      </div>

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}

      {#if selectedGlobalProvider === 'local'}
      <section class="panel-section">
        <div class="section-head compact global-panel-head">
          <div>
            <h3>Saved locations</h3>
            <p class="section-copy">{activeFolderCount()} active on this device.</p>
          </div>
          <div class="button-row compact-panel-actions">
            {@render addLocationAction('Add a location', 'Add a storage location manually', addSourceCard, false)}
            <button
              type="button"
              class="panel-btn subtle compact icon-btn"
              onclick={() => void refreshDiscoverySuggestions()}
              disabled={discoveryLoading}
              title="Scan again"
            >
              <RefreshCw size={14} strokeWidth={2} />
            </button>
            {#if dismissedSuggestionCount() > 0}
              <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
                <span>Show hidden</span>
              </button>
            {/if}
          </div>
        </div>

        {#if discoveryError}
          <p class="warning-copy">{discoveryError}</p>
        {/if}

        <div class="compact-share-grid">
          {#each localShares() as source (source.id)}
            {@render unifiedShareCard(localShareView(source))}
          {/each}
          {#each sourceSuggestionRows() as row (row.source.path)}
            <article class="location-card suggestion-card">
              <div class="card-head">
                <div class="card-title">
                  <div class="card-icon" title={row.source.path}>
                    <Search size={16} strokeWidth={2.1} />
                  </div>
                  <div title={row.source.path}>
                    <p class="provider-label">{formatProvider(row.source.provider)}</p>
                    <h4>{compactPath(row.source.path)}</h4>
                  </div>
                </div>
              </div>

              <p class="card-copy">{sourceSuggestionCopy(row.source)}</p>

              <div class="button-row">
                <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                  <Plus size={14} strokeWidth={2} />
                  <span>Use folder</span>
                </button>
                <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                  <span>Hide</span>
                </button>
              </div>
            </article>
          {/each}
        </div>
      </section>

      {:else}
        {@const provider = providerCatalog.find((entry) => entry.provider === selectedGlobalProvider) ?? null}
        {@const shares = provider ? providerVisibleShares(provider.provider) : []}
        {#if provider}
          <section class="panel-section">
            <div class="section-head compact global-panel-head">
              <div>
                <h3>{provider.label}</h3>
                <p class="section-copy">{providerCardDetail(provider)}</p>
              </div>
              <div class="button-row compact-panel-actions">
                {#if provider.isConnected}
                  {#if isInlineLocationComposerProvider(provider.provider) && isProviderCreateComposerOpen(provider.provider)}
                    {@render addLocationComposer(provider)}
                  {:else}
                    {@render addLocationAction(
                      'Add a location',
                      `Add a ${provider.label} storage location`,
                      () => handleProviderAddLocation(provider),
                      integrationBusyKey === `create:${provider.provider}`
                    )}
                  {/if}
                {/if}
                {#if shouldShowProviderDocs(provider) && provider.setup.docsUrl}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => openProviderDocs(provider.setup.docsUrl)}
                  >
                    <span>{provider.provider === 'gdrive' ? 'Open Google Console' : 'Open docs'}</span>
                  </button>
                {/if}
                {#if !provider.isConnected && provider.setup.status === 'needs-config'}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => void configureProvider(provider)}
                    disabled={integrationBusyKey === `setup:${provider.provider}`}
                  >
                    <span>{integrationBusyKey === `setup:${provider.provider}` ? 'Saving...' : 'Save setup'}</span>
                  </button>
                {/if}
                {#if provider.isConnected}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => openProviderConnectionDialog(provider.provider)}
                  >
                    <span>{providerCardStatus(provider)}</span>
                  </button>
                {:else if provider.provider !== 'mega'}
                  {#if providerFlowState(provider.provider)?.canCancel}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => cancelProviderFlow(provider.provider)}
                    >
                      <span>Cancel</span>
                    </button>
                  {/if}
                  {#if canResetProviderFlow(provider.provider)}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => resetProviderFlow(provider.provider)}
                      disabled={providerFlowState(provider.provider)?.canCancel === true}
                    >
                      <span>Reset</span>
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => void connectProvider(provider)}
                    disabled={
                      integrationBusyKey === `connect:${provider.provider}` ||
                      provider.setup.status === 'needs-config' ||
                      provider.setup.status === 'unsupported'
                    }
                  >
                    <span>
                      {integrationBusyKey === `connect:${provider.provider}`
                        ? provider.setup.status === 'needs-install'
                          ? 'Installing...'
                          : 'Connecting...'
                        : provider.provider === 'gdrive'
                          ? 'Connect with Google'
                          : 'Connect'}
                    </span>
                  </button>
                {/if}
              </div>
            </div>

            {#if provider.setup.status === 'installing' || (integrationBusyKey === `connect:${provider.provider}` && provider.setup.status === 'needs-install')}
              <div class="inline-progress" aria-label="Installing provider helper">
                <div class="inline-progress-bar"></div>
              </div>
            {/if}

            {#if !provider.isConnected && provider.provider === 'gdrive' && provider.setup.status === 'needs-config'}
                {@const draft = providerSetupDraft(provider.provider)}
                <div class="provider-story-card compact-provider-card">
                  <label class="field-block compact-field">
                    <span>Client ID</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.clientId}
                      placeholder="Google Desktop app client id"
                      oninput={(event) => setProviderSetupField(provider.provider, 'clientId', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <p class="muted-copy">Create an OAuth client in Google Cloud, choose <strong>Desktop app</strong>, then paste the client ID here.</p>
                </div>
            {/if}

            {#if !provider.isConnected && provider.provider === 'github' && provider.setup.status === 'needs-config'}
                {@const draft = providerSetupDraft(provider.provider)}
                <div class="provider-story-card compact-provider-card">
                  <label class="field-block compact-field">
                    <span>Client ID</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.clientId}
                      placeholder="GitHub OAuth app client id"
                      oninput={(event) => setProviderSetupField(provider.provider, 'clientId', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <p class="muted-copy">Create a GitHub OAuth app, enable device flow, then paste the client ID here.</p>
                </div>
            {/if}

            {#if !provider.isConnected && provider.provider === 'mega'}
                {@const draft = providerCredentialDraft(provider.provider)}
                {@const pendingSession = pendingSessionForProvider(provider.provider)}
                <form class="provider-story-card mega-onboarding-card" onsubmit={(event) => {
                  event.preventDefault();
                  void submitMegaAction(provider);
                }}>
                  <div class="mega-onboarding-head">
                    <div>
                      <h4>MEGA account</h4>
                      <p class="provider-story-copy">{megaOnboardingCopy(provider.provider)}</p>
                    </div>
                    <p class="muted-copy compact-mode-copy">{pendingSession ? 'Email confirmation' : draft.mode === 'signup' ? 'Create account' : 'Sign in'}</p>
                  </div>

                  <div class="provider-credentials">
                    {#if pendingSession}
                      <label class="field-block compact-field">
                        <span>Confirmation link</span>
                        <input
                          class="panel-input"
                          type="url"
                          value={draft.confirmationLink}
                          placeholder="https://mega.nz/confirm#..."
                          oninput={(event) => setProviderCredential(provider.provider, 'confirmationLink', (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                    {:else}
                      <div class="segmented-toggle">
                        <button
                          type="button"
                          class="segmented-toggle-btn"
                          class:active={draft.mode === 'login'}
                          onclick={() => setProviderCredential(provider.provider, 'mode', 'login')}
                        >
                          Sign in
                        </button>
                        <button
                          type="button"
                          class="segmented-toggle-btn"
                          class:active={draft.mode === 'signup'}
                          onclick={() => setProviderCredential(provider.provider, 'mode', 'signup')}
                        >
                          Create account
                        </button>
                      </div>
                      {#if draft.mode === 'signup'}
                        <label class="field-block compact-field">
                          <span>Name</span>
                          <input
                            class="panel-input"
                            type="text"
                            value={draft.name}
                            placeholder="Your name"
                            oninput={(event) => setProviderCredential(provider.provider, 'name', (event.currentTarget as HTMLInputElement).value)}
                          />
                        </label>
                      {/if}
                      <label class="field-block compact-field">
                        <span>Email</span>
                        <input
                          class="panel-input"
                          type="email"
                          value={draft.email}
                          placeholder="name@example.com"
                          oninput={(event) => setProviderCredential(provider.provider, 'email', (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                      <label class="field-block compact-field">
                        <span>Password</span>
                        <input
                          class="panel-input"
                          type="password"
                          value={draft.password}
                          placeholder="MEGA password"
                          oninput={(event) => setProviderCredential(provider.provider, 'password', (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                      {#if draft.mode === 'login'}
                        <label class="field-block compact-field">
                          <span class="toggle-only-label">
                            <input
                              type="checkbox"
                              checked={draft.useMfa}
                              onchange={(event) => setProviderCredential(provider.provider, 'useMfa', (event.currentTarget as HTMLInputElement).checked)}
                            />
                            <span>I enabled 2-factor authentication on MEGA</span>
                          </span>
                        </label>
                      {/if}
                      {#if draft.mode === 'login' && draft.useMfa}
                        <label class="field-block compact-field">
                          <span>2FA code</span>
                          <input
                            class="panel-input"
                            type="text"
                            value={draft.mfaCode}
                            placeholder="6-digit code"
                            oninput={(event) => setProviderCredential(provider.provider, 'mfaCode', (event.currentTarget as HTMLInputElement).value)}
                          />
                        </label>
                      {/if}
                    {/if}
                  </div>

                  <div class="mega-onboarding-actions">
                    {#if providerFlowState(provider.provider)?.canCancel}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => cancelProviderFlow(provider.provider)}
                      >
                        <span>Cancel</span>
                      </button>
                    {/if}
                    {#if pendingSession}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => clearProviderSession(provider.provider)}
                        disabled={integrationBusyKey === `confirm:${provider.provider}`}
                      >
                        <span>Start again</span>
                      </button>
                    {:else if canResetProviderFlow(provider.provider)}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => resetProviderFlow(provider.provider)}
                        disabled={providerFlowState(provider.provider)?.canCancel === true}
                      >
                        <span>Reset</span>
                      </button>
                    {/if}
                    <button
                      type="submit"
                      class="panel-btn primary"
                      disabled={
                        !canSubmitMegaAction(provider.provider) ||
                        integrationBusyKey === `connect:${provider.provider}` ||
                        integrationBusyKey === `confirm:${provider.provider}` ||
                        provider.setup.status === 'needs-config' ||
                        provider.setup.status === 'unsupported'
                      }
                    >
                      <span>{megaPrimaryActionLabel(provider.provider)}</span>
                    </button>
                  </div>
                </form>
            {/if}

            {#if provider.isConnected && provider.provider === 'github'}
                {@const draft = providerShareDraft(provider.provider)}
                <div class="provider-credentials">
                  <label class="field-block compact-field">
                    <span>Owner</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.repoOwner}
                      placeholder="nearbytes"
                      oninput={(event) => setProviderShareField(provider.provider, 'repoOwner', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field-block compact-field">
                    <span>Repo</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.repoName}
                      placeholder="nearbytes-sync"
                      oninput={(event) => setProviderShareField(provider.provider, 'repoName', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field-block compact-field">
                    <span>Branch</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.branch}
                      placeholder="main"
                      oninput={(event) => setProviderShareField(provider.provider, 'branch', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field-block">
                    <span>nearbytes path</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.basePath}
                      placeholder={defaultGithubBasePath(githubShareLabel())}
                      oninput={(event) => setProviderShareField(provider.provider, 'basePath', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                </div>
            {/if}

            {#if providerFlowState(provider.provider)}
              <div class="provider-flow-status" data-phase={providerFlowState(provider.provider)?.phase}>
                <p class="provider-flow-title">{providerFlowState(provider.provider)?.title}</p>
                <p class="muted-copy">{providerFlowState(provider.provider)?.detail}</p>
              </div>
            {/if}

            <div class="compact-share-grid">
              {#if shares.length === 0}
                <ShareCard
                  provider={provider.label}
                  title="No shares yet"
                  copy={providerEmptyShareCopy(provider)}
                  statusBadges={[]}
                  meta={[]}
                />
              {:else}
                {#each shares as summary (summary.share.id)}
                  {@const view = managedShareView(summary)}
                  {#if view}
                    {@render unifiedShareCard(view)}
                  {/if}
                {/each}
              {/if}
            </div>
          </section>
        {/if}
      {/if}
    {:else}
      <div class="toolbar-row">
        <button
          type="button"
          class="panel-btn subtle compact icon-btn"
          onclick={() => void refreshDiscoverySuggestions()}
          disabled={discoveryLoading}
          title="Scan again"
        >
          <RefreshCw size={14} strokeWidth={2} />
        </button>
        {#if dismissedSuggestionCount() > 0}
          <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
            <span>Restore hidden suggestions</span>
          </button>
        {/if}
      </div>

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}

      {#if !volumeId}
        <p class="storage-message">Open this hub first, then choose the places that should keep everything.</p>
      {:else}
        {#if discoveryError}
          <p class="warning-copy">{discoveryError}</p>
        {/if}

        <section class="panel-section">
          <div class="section-head">
            <div>
              <h3>{hubStorageHeading(volumeId)}</h3>
              <p class="section-copy">{hubStorageIntro(volumeId)}</p>
            </div>
            <div class="section-actions">
              <button type="button" class="panel-btn subtle compact" onclick={() => openHubLocationDialog(volumeId)}>
                <Plus size={14} strokeWidth={2} />
                <span>Add another location</span>
              </button>
              {#if explicitVolumePolicy(volumeId)}
                <ArmedActionButton
                  class="panel-btn subtle compact danger"
                  icon={Trash2}
                  text="Use default storage locations again"
                  armed={true}
                  autoDisarmMs={3000}
                  onPress={() => removeVolumePolicy(volumeId)}
                />
              {/if}
            </div>
          </div>

          <div class="rule-grid">
            {#if hubAttachedSources(volumeId).length === 0}
              <article class="rule-card">
                <p class="card-copy">This hub is not using any storage location yet. Add one of your saved locations here, or open storage setup to create another.</p>
                <div class="button-row inline-dialog-actions">
                  <button type="button" class="panel-btn subtle compact" onclick={() => openHubLocationDialog(volumeId)}>
                    <Plus size={14} strokeWidth={2} />
                    <span>Choose a saved location</span>
                  </button>
                  <button type="button" class="panel-btn subtle compact" onclick={openStorageSetupFromHubDialog}>
                    <Link2 size={14} strokeWidth={2} />
                    <span>Open storage setup</span>
                  </button>
                </div>
              </article>
            {/if}

            {#each hubAttachedSources(volumeId) as source (source.id)}
              {@const destination = destinationFor(volumeId, source.id)}
              {@const mode = hubLocationMode(volumeId, source.id)}
              {@const note = hubLocationNote(volumeId, source)}
              {@const status = sourceStatus(source.id)}
              <article class="rule-card" class:active={mode !== 'off'}>
                <div class="card-head">
                  <div class="card-title">
                    <div>
                      <p class="provider-label">{formatProvider(source.provider)}</p>
                      <h4>{compactPath(source.path)}</h4>
                    </div>
                  </div>
                </div>

                <div class="toggle-stack">
                  <label class="inline-toggle compact-toggle-line">
                    <input
                      type="radio"
                      name={`hub-location-mode-${source.id}`}
                      checked={mode === 'store'}
                      onchange={() => setHubLocationMode(volumeId, source.id, 'store')}
                    />
                    <div>
                      <span class="toggle-title">Store this hub here</span>
                      <span class="toggle-copy">Keep a full copy of this hub in this location.</span>
                    </div>
                  </label>
                  <label class="inline-toggle compact-toggle-line">
                    <input
                      type="radio"
                      name={`hub-location-mode-${source.id}`}
                      checked={mode === 'publish'}
                      onchange={() => setHubLocationMode(volumeId, source.id, 'publish')}
                    />
                    <div>
                      <span class="toggle-title">Publish this hub updates here</span>
                      <span class="toggle-copy">Write new updates here without keeping the whole hub in this location.</span>
                    </div>
                  </label>
                </div>

                {#if note}
                  <p class="card-copy">{note}</p>
                {/if}

                <div class="fact-row">
                  <span>{status?.availableBytes !== undefined ? `Available storage: ${formatSize(status.availableBytes)}` : 'Available storage unknown'}</span>
                  <span>{usageSummary(source.id)}</span>
                  <div class="inline-reserve-slot">
                    {#if activeReserveEditorKey === `hub:${volumeId}:${source.id}`}
                      <label class="inline-reserve-editor" title="Minimum available storage to leave on this drive.">
                        <span>Keep free</span>
                        <select
                          class="panel-input inline-reserve-select"
                          value={String(Number.isFinite(destination?.reservePercent) ? destination!.reservePercent : DEFAULT_RESERVE_PERCENT)}
                          onchange={(event) => {
                            updateDestinationField(volumeId, source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value));
                            closeReserveEditor(`hub:${volumeId}:${source.id}`);
                          }}
                          onblur={() => closeReserveEditor(`hub:${volumeId}:${source.id}`)}
                        >
                          {#each RESERVE_OPTIONS as option}
                            <option value={option}>{formatPercent(option)}</option>
                          {/each}
                        </select>
                      </label>
                    {:else}
                      <button type="button" class="inline-reserve-button" onclick={() => toggleReserveEditor(`hub:${volumeId}:${source.id}`)}>
                        <span>Keep free {formatPercent(Number.isFinite(destination?.reservePercent) ? destination!.reservePercent : DEFAULT_RESERVE_PERCENT)}</span>
                      </button>
                    {/if}
                  </div>
                </div>

                <div class="storage-card-actions">
                  <div class="button-row storage-card-actions-left">
                    <ArmedActionButton
                      class="panel-btn subtle compact icon-btn armed-icon-danger"
                      icon={Trash2}
                      text=""
                      armed={true}
                      autoDisarmMs={3000}
                      title="Remove"
                      ariaLabel="Remove"
                      onPress={() => setHubLocationMode(volumeId, source.id, 'off')}
                    />
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => void (hasSourcePath(source) ? moveSourceFolder(source.id) : chooseSourceFolder(source.id))}
                      disabled={movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id)}
                      title={hasSourcePath(source) ? 'Move this storage location without interrupting service' : 'Choose folder'}
                    >
                      <ArrowRightLeft size={14} strokeWidth={2} />
                      <span>{movingSourceId === source.id ? 'Moving...' : hasSourcePath(source) ? 'Move' : 'Choose folder'}</span>
                    </button>
                  </div>

                  <div class="button-row storage-card-actions-right">
                    <button type="button" class="panel-btn subtle compact" onclick={() => openSourceFolder(source.id)} disabled={!hasSourcePath(source)}>
                      <FolderOpen size={14} strokeWidth={2} />
                      <span>Open</span>
                    </button>
                  </div>
                </div>

                {#if mode === 'store'}
                  <div class="field-grid compact-visible-fields">
                    <label class="field-block">
                      <span>When this location gets full</span>
                      <select
                        class="panel-input"
                        value={destination?.fullPolicy ?? 'block-writes'}
                        onchange={(event) =>
                          updateDestinationField(volumeId, source.id, 'fullPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}
                      >
                        <option value="block-writes">Keep everything here</option>
                        <option value="drop-older-blocks">Trim older data after another full copy exists</option>
                      </select>
                    </label>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>

        {#if hubLocationDialogVolumeId === volumeId}
          {@const availableSources = hubAvailableSources(volumeId)}
          <div class="provider-dialog-backdrop" role="presentation" onclick={closeHubLocationDialog}></div>
          <div class="provider-dialog" role="dialog" aria-modal="true" aria-label="Add storage location to this hub">
            <div class="section-head compact provider-dialog-head">
              <div>
                <p class="section-step">Hub storage</p>
                <h3>Add another location</h3>
              </div>
              <button type="button" class="panel-btn subtle compact" onclick={closeHubLocationDialog}>
                <span>Close</span>
              </button>
            </div>

            <p class="section-copy">Choose one of your saved storage locations. Nearbytes will add it as a full copy for this hub, and you can fine-tune it right after.</p>

            {#if availableSources.length > 0}
              <div class="rule-grid dialog-rule-grid">
                {#each availableSources as source (source.id)}
                  {@const status = sourceStatus(source.id)}
                  <article class="rule-card active">
                    <div class="card-head">
                      <div class="card-title">
                        <div>
                          <p class="provider-label">{formatProvider(source.provider)}</p>
                          <h4>{compactPath(source.path)}</h4>
                        </div>
                      </div>
                    </div>

                    <p class="card-copy">{locationSummary(source)}</p>

                    <div class="fact-row">
                      <span>{status?.availableBytes !== undefined ? `Available storage: ${formatSize(status.availableBytes)}` : 'Available storage unknown'}</span>
                      <span>{usageSummary(source.id)}</span>
                    </div>

                    <div class="button-row inline-dialog-actions">
                      <button type="button" class="panel-btn subtle compact" onclick={() => addSourceToHub(volumeId, source.id)}>
                        <Plus size={14} strokeWidth={2} />
                        <span>Use this location</span>
                      </button>
                    </div>
                  </article>
                {/each}
              </div>
            {:else}
              <article class="rule-card active">
                <p class="card-copy">You do not have any saved storage locations left to add to this hub.</p>
                <div class="button-row inline-dialog-actions">
                  <button type="button" class="panel-btn subtle compact" onclick={closeHubLocationDialog}>
                    <span>Not now</span>
                  </button>
                </div>
              </article>
            {/if}
          </div>
        {/if}

      {/if}
    {/if}

    {#if providerConnectionDialog}
      {@const dialogProvider = providerCatalog.find((entry) => entry.provider === providerConnectionDialog) ?? null}
      {@const dialogDisconnectImpact = dialogProvider ? providerDisconnectImpact(dialogProvider.provider) : { shares: 0, spaces: 0, inaccessibleSpaces: [] }}
      {@const dialogAccount = dialogProvider ? connectedAccountForProvider(dialogProvider.provider) : null}
      {#if dialogProvider}
        <div class="provider-dialog-backdrop" role="presentation" onclick={closeProviderConnectionDialog}></div>
        <div class="provider-dialog" role="dialog" aria-modal="true" aria-label={`${dialogProvider.label} connection`}>
          <div class="section-head compact provider-dialog-head">
            <div>
              <h3>{dialogProvider.label}</h3>
              <p class="section-copy">Connection details</p>
            </div>
            <button type="button" class="panel-btn subtle compact" onclick={closeProviderConnectionDialog}>
              <span>Close</span>
            </button>
          </div>

          <div class="provider-dialog-grid">
            <div class="provider-path-card">
              <p class="subheading">Account</p>
              <p class="provider-path-copy">{dialogAccount?.email ?? dialogAccount?.label ?? 'No account connected'}</p>
            </div>

            <div class="provider-path-card">
              <p class="subheading">Mirror settings</p>
              <div class="provider-fact-list">
                {#each providerTransparencyFacts(dialogProvider) as fact}
                  <p class="provider-story-copy">{fact}</p>
                {/each}
              </div>
            </div>
          </div>

          {#if providerMirrorPaths(dialogProvider).length > 0}
            <div class="provider-dialog-path-list">
              {#each providerMirrorPaths(dialogProvider) as mirrorPath}
                <div class="provider-path-card">
                  <p class="subheading">Local mirror folder</p>
                  <p class="provider-path-copy">{mirrorPath}</p>
                </div>
              {/each}
            </div>
          {/if}

          {#if dialogProvider.isConnected && providerDisconnectArmed[dialogProvider.provider] && dialogDisconnectImpact.spaces > 0}
            <p class="panel-error">
              {#if dialogDisconnectImpact.inaccessibleSpaces.length > 0}
                Disconnecting {dialogProvider.label} will make {countLabel(dialogDisconnectImpact.inaccessibleSpaces.length, 'hub')} not accessible until you reconnect it.
              {:else}
                Disconnecting {dialogProvider.label} will remove {countLabel(dialogDisconnectImpact.shares, 'location')} from {countLabel(dialogDisconnectImpact.spaces, 'hub')}, but those hubs will stay accessible.
              {/if}
            </p>
          {/if}

          {#if dialogProvider.isConnected && providerDisconnectArmed[dialogProvider.provider] && dialogDisconnectImpact.inaccessibleSpaces.some((targetVolumeId) => knownVolumeLabel(targetVolumeId))}
            <div class="fact-row share-volume-row">
              {#each dialogDisconnectImpact.inaccessibleSpaces as targetVolumeId}
                {@const label = knownVolumeLabel(targetVolumeId)}
                {#if label}
                  <button
                    type="button"
                    class="mini-pill mini-pill-button"
                    onclick={() => onOpenVolumeRouting?.(targetVolumeId)}
                  >
                    {label}
                  </button>
                {/if}
              {/each}
            </div>
          {/if}

          <div class="button-row provider-dialog-actions">
            <button
              type="button"
              class={`panel-btn subtle compact ${providerDisconnectArmed[dialogProvider.provider] ? 'danger' : ''}`}
              onclick={async () => {
                if (providerDisconnectArmed[dialogProvider.provider]) {
                  await disconnectProvider(dialogProvider);
                  closeProviderConnectionDialog();
                  return;
                }
                setProviderDisconnectArmed(dialogProvider.provider, true);
              }}
              disabled={integrationBusyKey === `disconnect:${dialogProvider.provider}`}
            >
              {integrationBusyKey === `disconnect:${dialogProvider.provider}`
                ? 'Disconnecting...'
                : providerDisconnectArmed[dialogProvider.provider]
                  ? 'Confirm disconnect'
                  : 'Disconnect'}
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .storage-panel {
    --panel-border: var(--nb-border, rgba(111, 173, 252, 0.18));
    --panel-soft-border: color-mix(in srgb, var(--nb-border, rgba(111, 173, 252, 0.18)) 70%, transparent);
    --panel-bg: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.88));
    --card-bg: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(252, 244, 238, 0.82));
    --card-bg-strong: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(248, 236, 227, 0.92));
    --text-main: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    --text-soft: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    --text-faint: var(--nb-text-faint, rgba(110, 110, 115, 0.62));
    --teal: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 42%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
    --warn: color-mix(in srgb, var(--nb-warning, #d4945f) 82%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
    --danger: color-mix(in srgb, var(--nb-danger, #c86a6a) 86%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
    display: grid;
    gap: 0.85rem;
    width: 100%;
    min-height: 0;
    padding: 0.9rem;
    overflow: auto;
    border: 1px solid var(--panel-border);
    border-radius: 22px;
    background: var(--panel-bg);
    box-shadow: 0 18px 40px rgba(93, 56, 34, 0.08);
  }

  .section-head,
  .card-head,
  .card-status,
  .toolbar-row,
  .button-row,
  .section-metrics,
  .scan-badges,
  .scan-group-head,
  .fact-row,
  .usage-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .section-head,
  .card-head,
  .scan-group-head {
    justify-content: space-between;
  }

  .toolbar-row {
    margin-bottom: 0.15rem;
  }

  .provider-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.62rem;
    align-items: stretch;
  }

  .provider-tab {
    min-height: 58px;
    min-width: 150px;
    padding: 0.7rem 0.84rem;
    border-radius: 14px;
    border: 1px solid var(--panel-soft-border);
    background: var(--card-bg);
    color: var(--text-main);
    display: grid;
    align-content: center;
    gap: 0.16rem;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
  }

  .provider-tab:hover {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 12%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--card-bg) 96%, rgba(255, 252, 249, 0.92));
  }

  .provider-tab.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 18%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--card-bg-strong) 96%, rgba(255, 255, 255, 0.92));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 72%, rgba(210, 122, 84, 0.08));
  }

  .provider-tab-label {
    font-size: 0.84rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .provider-tab-copy {
    color: var(--text-soft);
    font-size: 0.75rem;
    line-height: 1.2;
  }

  .provider-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(28, 28, 30, 0.18);
    z-index: 30;
  }

  .provider-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 31;
    width: min(640px, calc(100vw - 2rem));
    max-height: min(78vh, 720px);
    overflow: auto;
    display: grid;
    gap: 0.82rem;
    padding: 0.95rem;
    border-radius: 20px;
    border: 1px solid var(--panel-soft-border);
    background: var(--panel-bg);
    box-shadow: 0 24px 60px rgba(93, 56, 34, 0.16);
    transform: translate(-50%, -50%);
  }

  .provider-dialog-head {
    margin-bottom: -0.08rem;
  }

  .provider-dialog-grid,
  .provider-dialog-path-list {
    display: grid;
    gap: 0.72rem;
  }

  .section-actions,
  .inline-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
  }

  .dialog-rule-grid {
    margin-top: 0.15rem;
  }

  .provider-dialog-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .provider-dialog-actions {
    justify-content: flex-end;
  }

  .global-panel-head {
    gap: 0.9rem;
  }

  .compact-panel-actions {
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .provider-create-inline {
    display: inline-grid;
    grid-template-columns: minmax(160px, 220px) auto auto;
    gap: 0.45rem;
    align-items: center;
    min-width: 0;
  }

  .provider-create-inline-input {
    min-width: 0;
    height: 30px;
    padding-block: 0.2rem;
  }

  .compact-provider-card {
    padding: 0.76rem 0.82rem;
  }

  .section-head > div:first-child,
  .scan-copy,
  .usage-main {
    display: grid;
    gap: 0.28rem;
  }

  .eyebrow,
  .section-step,
  .provider-label,
  .scan-group-title {
    margin: 0;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 72%, rgba(110, 110, 115, 0.82));
  }

  h3,
  h4,
  .hero-text,
  .section-copy,
  .path-copy,
  .storage-message,
  .card-copy,
  .scan-note,
  .scan-path,
  .muted-copy,
  .warning-copy {
    margin: 0;
  }

  h3,
  h4 {
    color: var(--text-main);
  }

  h3 {
    font-size: 0.96rem;
    line-height: 1.35;
  }

  h4 {
    font-size: 0.92rem;
  }

  .hero-text,
  .section-copy,
  .path-copy,
  .storage-message,
  .card-copy,
  .scan-note,
  .scan-path,
  .muted-copy {
    color: var(--text-soft);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .warning-copy {
    color: var(--warn);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .panel-section,
  .location-card,
  .rule-card,
  .scan-card,
  .scan-group {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    border-radius: 16px;
    border: 1px solid var(--panel-soft-border);
    background: var(--card-bg);
  }

  .panel-section {
    padding: 0.82rem;
  }

  .location-card,
  .rule-card,
  .scan-card,
  .scan-group {
    padding: 0.85rem;
  }

  .card-grid,
  .rule-grid,
  .scan-card-list,
  .scan-group-list {
    display: grid;
    gap: 0.75rem;
  }

  .card-grid,
  .rule-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .location-card,
  .rule-card {
    background: var(--card-bg);
  }

  .location-card.active,
  .rule-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--card-bg-strong) 95%, rgba(255, 255, 255, 0.92));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 74%, rgba(210, 122, 84, 0.08));
  }

  .card-title {
    display: flex;
    flex: 1 1 0;
    gap: 0.8rem;
    align-items: flex-start;
    min-width: 0;
  }

  .card-title > div,
  .card-head,
  .card-status,
  .inline-toggle > div,
  .usage-main,
  .field-block {
    min-width: 0;
  }

  .card-icon {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.9));
    color: var(--text-soft);
  }

  .summary-pill,
  .status-pill,
  .mini-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    flex: 0 0 auto;
    min-height: 28px;
    max-width: 100%;
    padding: 0.22rem 1.08rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
    color: var(--text-main);
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    box-sizing: border-box;
  }

  .status-pill.ready-badge {
    padding-inline: 1.22rem;
  }

  .mini-pill-button {
    cursor: pointer;
    transition:
      border-color 120ms ease,
      transform 120ms ease,
      background 120ms ease;
  }

  .mini-pill-button:hover {
    transform: translateY(-1px);
    border-color: var(--nb-btn-hover-border, color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 94%, var(--nb-accent, #d27a54) 8%));
    background: var(--nb-btn-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%));
    color: var(--nb-btn-hover-color, rgba(28, 28, 30, 0.96));
  }

  .summary-pill.warning,
  .status-pill.tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, rgba(251, 191, 36, 0.28)) 62%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(72, 53, 16, 0.46)) 92%, transparent);
    color: var(--warn);
  }

  .status-pill.tone-good,
  .status-pill.tone-durable {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 16%, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.92));
    color: var(--teal);
  }

  .status-pill.tone-danger {
    border-color: color-mix(in srgb, var(--nb-danger, #c86a6a) 26%, transparent);
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
    color: var(--danger);
  }

  .status-pill.tone-muted,
  .status-pill.tone-replica,
  .status-pill.tone-off,
  .mini-pill {
    border-color: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
    color: var(--text-soft);
  }

  .panel-btn,
  :global(.panel-btn) {
    min-height: 34px;
    border-radius: 12px;
    border: 1px solid var(--nb-btn-border, color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 80%, transparent));
    background: var(--nb-btn-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7)));
    color: var(--nb-btn-color, rgba(70, 70, 73, 0.94));
    padding: 0 0.82rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.48rem;
    font-size: 0.79rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      transform 120ms ease,
      background 120ms ease;
  }

  .panel-btn:hover,
  :global(.panel-btn:hover) {
    transform: translateY(-1px);
    border-color: var(--nb-btn-hover-border, color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 94%, var(--nb-accent, #d27a54) 8%));
    background: var(--nb-btn-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%));
    color: var(--nb-btn-hover-color, rgba(28, 28, 30, 0.96));
  }

  .panel-btn:disabled,
  :global(.panel-btn:disabled) {
    opacity: 0.55;
    cursor: default;
    transform: none;
  }

  .panel-btn.primary,
  :global(.panel-btn.primary) {
    background: var(--nb-btn-active-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92)));
    border-color: var(--nb-btn-active-border, color-mix(in srgb, var(--nb-accent, #d27a54) 14%, var(--nb-border, rgba(60, 60, 67, 0.12))));
    color: var(--nb-btn-active-color, rgba(28, 28, 30, 0.96));
    box-shadow: var(--nb-btn-active-shadow, 0 1px 2px rgba(82, 53, 33, 0.05));
  }

  .panel-btn.subtle,
  :global(.panel-btn.subtle) {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.88));
  }

  .panel-btn.compact,
  :global(.panel-btn.compact) {
    min-height: 30px;
    padding: 0 0.66rem;
  }

  .panel-btn.icon-btn,
  :global(.panel-btn.icon-btn) {
    width: 30px;
    min-width: 30px;
    padding: 0;
  }

  .panel-btn.danger,
  :global(.panel-btn.danger) {
    border-color: var(--nb-btn-danger-border, color-mix(in srgb, var(--nb-danger, #c86a6a) 22%, transparent));
    color: var(--nb-btn-danger-color, rgba(166, 63, 63, 0.94));
  }

  .panel-btn.armed-icon-danger,
  :global(.panel-btn.armed-icon-danger) {
    color: var(--nb-btn-color, rgba(70, 70, 73, 0.94));
  }

  .panel-btn.armed-icon-danger.armed,
  :global(.panel-btn.armed-icon-danger.armed) {
    border-color: var(--nb-btn-danger-border, color-mix(in srgb, var(--nb-danger, #c86a6a) 22%, transparent));
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
    color: var(--nb-btn-danger-color, rgba(166, 63, 63, 0.94));
  }

  .panel-error,
  .panel-success,
  .protection-banner {
    margin: 0;
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    border-radius: 12px;
    padding: 0.72rem 0.84rem;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .panel-error {
    color: var(--danger);
    border: 1px solid color-mix(in srgb, var(--nb-danger, #c86a6a) 24%, transparent);
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
  }

  .panel-success {
    color: var(--teal);
    border: 1px solid color-mix(in srgb, var(--nb-accent, #d27a54) 18%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92));
  }

  .protection-banner {
    color: var(--teal);
    border: 1px solid color-mix(in srgb, var(--nb-accent, #d27a54) 16%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.9));
  }

  .protection-banner.warning {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 24%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(253, 230, 138, 0.12)) 82%, rgba(255, 250, 245, 0.96));
  }

  .toggle-list,
  .usage-list,
  .danger-block {
    display: grid;
    gap: 0.68rem;
  }

  .setting-list {
    display: grid;
    gap: 0.42rem;
  }

  .setting-row {
    min-height: 36px;
    padding: 0.48rem 0.06rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
    color: var(--text-main);
    font-size: 0.79rem;
    font-weight: 600;
  }

  .setting-row input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--nb-accent-strong, #8f6a3b);
  }

  .toggle-stack {
    display: grid;
    gap: 0.55rem;
  }

  .card-control-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    align-items: center;
  }

  .card-control-row {
    justify-content: space-between;
    align-items: end;
  }

  .compact-field {
    min-width: 112px;
    max-width: 148px;
  }

  .inline-toggle {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.55rem;
    align-items: start;
  }

  .inline-toggle input {
    margin-top: 0.22rem;
    width: 17px;
    height: 17px;
    accent-color: var(--nb-accent-strong, #8f6a3b);
  }

  .inline-toggle > div {
    display: grid;
    gap: 0.12rem;
  }

  .compact-toggle-line {
    padding: 0.68rem 0.74rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
  }

  .toggle-title {
    color: var(--text-main);
    font-size: 0.82rem;
    font-weight: 600;
  }

  .toggle-copy,
  .fact-row,
  .usage-meta,
  .subheading {
    color: var(--text-soft);
    font-size: 0.77rem;
    line-height: 1.35;
  }

  .fact-row {
    gap: 0.5rem 1rem;
  }

  .fact-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .inline-reserve-slot {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
  }

  .inline-reserve-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 30px;
    padding: 0.28rem 0.82rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.88));
    color: var(--text-main);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .inline-reserve-editor {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--text-soft);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .inline-reserve-select {
    min-width: 86px;
    height: 30px;
    padding-block: 0.15rem;
    padding-inline: 0.55rem 1.7rem;
    border-radius: 999px;
  }

  .subheading {
    margin: 0;
    color: var(--text-main);
    font-weight: 600;
  }

  .field-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .storage-card-actions {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
  }

  .storage-card-actions-left {
    flex: 1 1 auto;
    min-width: 0;
    flex-wrap: wrap;
  }

  .storage-card-actions-right {
    min-width: 0;
    align-items: center;
  }

  .storage-card-actions-right {
    gap: 0.5rem;
    justify-content: flex-end;
    margin-left: 0;
  }

  .storage-card-actions-left,
  .storage-card-actions-right {
    width: 100%;
  }

  .storage-card-actions .button-row > :global(*),
  .storage-card-actions .button-row > * {
    min-width: 0;
  }

  .compact-visible-fields {
    margin-top: -0.05rem;
  }

  .managed-share-invite-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.65rem;
    align-items: end;
  }

  .managed-share-invite-field {
    min-width: 0;
  }

  .managed-share-invite-copy {
    margin: -0.15rem 0 0;
    color: var(--text-soft);
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .flow-note-card {
    display: grid;
    gap: 0.35rem;
    padding: 0.76rem 0.82rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
  }

  .onboarding-note-card {
    gap: 0.65rem;
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 16%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--card-bg-strong) 94%, rgba(255, 250, 246, 0.96)), color-mix(in srgb, var(--card-bg) 98%, rgba(249, 244, 240, 0.88))),
      radial-gradient(circle at top left, color-mix(in srgb, var(--nb-accent, #d27a54) 10%, transparent), transparent 58%);
  }

  .section-head.compact {
    gap: 0.8rem;
  }

  .volume-share-link-card {
    margin-bottom: 0.8rem;
  }

  .managed-share-members {
    display: grid;
    gap: 0.42rem;
  }

  .managed-share-members-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .provider-credentials {
    display: grid;
    gap: 0.62rem;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  }

  .mega-onboarding-card {
    gap: 0.9rem;
    padding: 0.82rem 0.88rem;
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 12%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(249, 244, 240, 0.88));
  }

  .mega-onboarding-head {
    display: grid;
    gap: 0.28rem;
  }

  .mega-onboarding-head > div {
    display: grid;
    gap: 0.22rem;
  }

  .compact-mode-copy {
    margin: 0;
  }

  .mega-onboarding-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.62rem;
    justify-content: flex-end;
    align-items: center;
  }

  .segmented-toggle {
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.22rem;
    padding: 0.22rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
  }

  .segmented-toggle-btn {
    min-height: 34px;
    padding: 0 0.88rem;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: var(--text-soft);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease,
      transform 120ms ease,
      box-shadow 120ms ease;
  }

  .segmented-toggle-btn:hover {
    color: var(--text-main);
    transform: translateY(-1px);
  }

  .segmented-toggle-btn.active {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.94));
    color: var(--text-main);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-accent, #d27a54) 14%, var(--nb-border, rgba(60, 60, 67, 0.12)));
  }

  .provider-flow-status {
    display: grid;
    gap: 0.25rem;
    padding: 0.62rem 0.78rem;
    border-radius: 0.8rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(249, 244, 240, 0.8));
  }

  .provider-story-card,
  .managed-share-story-card {
    display: grid;
    gap: 0.65rem;
    padding: 0.82rem 0.9rem;
    border-radius: 0.9rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
  }

  .managed-share-story-card.compact {
    padding: 0.74rem 0.82rem;
  }

  .provider-story-copy,
  .managed-share-story-copy,
  .provider-step-detail,
  .provider-path-copy {
    margin: 0;
    font-size: 0.79rem;
    line-height: 1.45;
    color: var(--text-soft);
  }

  .managed-share-fact-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.42rem;
  }

  .provider-fact-list {
    display: grid;
    gap: 0.24rem;
  }

  .provider-step-list {
    display: grid;
    gap: 0.55rem;
  }

  .provider-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.65rem;
    align-items: start;
  }

  .provider-step-marker {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 999px;
    margin-top: 0.28rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, var(--nb-accent, #d27a54) 10%);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(248, 243, 239, 0.92));
  }

  .provider-step-title {
    margin: 0;
    font-size: 0.81rem;
    font-weight: 700;
    color: var(--text);
  }

  .provider-path-card {
    display: grid;
    gap: 0.28rem;
    padding: 0.62rem 0.72rem;
    border-radius: 0.78rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.84));
  }

  .provider-path-copy {
    font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
    word-break: break-word;
  }

  .managed-share-path-card {
    margin-top: -0.1rem;
  }

  .inline-panel-error {
    margin: 0;
  }

  .provider-flow-status[data-phase='cancelled'] {
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 26%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(253, 230, 138, 0.12)) 78%, rgba(255, 250, 245, 0.96));
  }

  .provider-flow-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-main);
  }

  @media (max-width: 640px) {
    .provider-dialog {
      width: calc(100vw - 1rem);
      padding: 0.82rem;
    }

    .section-actions,
    .inline-dialog-actions {
      width: 100%;
    }
  }

  .compact-share-grid {
    display: grid;
    gap: 0.72rem;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .field-block {
    display: grid;
    gap: 0.3rem;
  }

  .field-block > span {
    color: var(--text-main);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .toggle-only-label {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    min-height: 34px;
    color: var(--text-main);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .toggle-only-label input {
    width: 16px;
    height: 16px;
    accent-color: var(--nb-accent-strong, #8f6a3b);
  }

  .inline-progress {
    position: relative;
    overflow: hidden;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 240, 234, 0.9));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
  }

  .inline-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 34%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--nb-accent, #d27a54) 54%, rgba(255, 249, 246, 0.98));
    animation: provider-progress-slide 1.1s ease-in-out infinite;
  }

  .panel-input {
    min-height: 34px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(252, 244, 238, 0.9));
    color: var(--text-main);
    padding: 0 0.68rem;
    font-size: 0.78rem;
  }

  .panel-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 18%, rgba(60, 60, 67, 0.14));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-panel-bg, #ffffff) 72%, rgba(240, 232, 226, 0.8));
  }

  .panel-input:disabled {
    opacity: 0.55;
  }

  .suggestion-card {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
  }

  .add-card {
    align-content: center;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
    border-style: dashed;
  }

  .add-card-button {
    min-height: 38px;
    border-radius: 16px;
    border: 1px dashed color-mix(in srgb, var(--nb-accent, #d27a54) 22%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
    color: var(--text-main);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0 0.82rem;
    cursor: pointer;
    transition:
      transform 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .add-card-button.wide {
    width: fit-content;
  }

  .add-card-button:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(248, 243, 239, 0.92));
  }

  .scan-card {
    grid-template-columns: 1fr auto;
    align-items: start;
  }

  .scan-group {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
  }

  .usage-row {
    display: grid;
    gap: 0.35rem 0.9rem;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding: 0.75rem 0.85rem;
    border-radius: 14px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.88));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
  }

  .merge-box {
    display: grid;
    gap: 0.7rem;
    padding: 0.78rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.88));
  }

  .path-copy,
  .scan-path {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .compact-note {
    font-size: 0.76rem;
    margin-top: -0.12rem;
  }

  @keyframes provider-progress-slide {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(320%);
    }
  }

  @media (max-width: 760px) {
    .storage-panel {
      padding: 0.85rem;
      border-radius: 18px;
    }

    .storage-card-actions {
      grid-template-columns: 1fr;
      align-items: stretch;
    }

    .storage-card-actions-right {
      margin-left: 0;
      justify-content: flex-start;
    }

    .storage-card-actions-left,
    .storage-card-actions-right,
    .storage-card-actions .button-row {
      width: 100%;
    }

    .storage-card-actions .button-row > :global(*),
    .storage-card-actions .button-row > * {
      flex: 1 1 100%;
    }

    .inline-reserve-slot {
      margin-left: 0;
    }

    .inline-reserve-editor {
      width: 100%;
      justify-content: space-between;
    }

    .provider-tabs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }

    .provider-tab {
      min-width: 0;
    }

    .section-head,
    .card-head,
    .scan-card,
    .usage-row {
      grid-template-columns: 1fr;
    }

    .toolbar-row,
    .section-metrics,
    .card-status,
    .button-row,
    .usage-meta {
      width: 100%;
    }

    .button-row > :global(*),
    .toolbar-row > *,
    .provider-tab {
      flex: 1 1 100%;
    }
  }
</style>
