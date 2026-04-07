export type NearbytesAuth = { type: 'token'; token: string } | { type: 'secret'; secret: string };

export interface NearbytesVolumeWatchHandlers {
  onMessage?: (event: MessageEvent) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export interface NearbytesSourceWatchHandlers {
  onMessage?: (event: MessageEvent) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export interface NearbytesWatchConnection {
  close(): void;
}

export interface NearbytesInvalidationFamily {
  watchSources(handlers: NearbytesSourceWatchHandlers): NearbytesWatchConnection;
  watchVolume(auth: NearbytesAuth, handlers: NearbytesVolumeWatchHandlers): NearbytesWatchConnection;
}

export interface NearbytesLanFamily {
  listPeers(options?: { signal?: AbortSignal }): Promise<unknown>;
  syncPeer(peerId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface NearbytesIntegrationsFamily {
  listProviderAccounts(options?: { signal?: AbortSignal; fast?: boolean }): Promise<unknown>;
  connectProviderAccount(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  disconnectProviderAccount(accountId: string): Promise<void>;
  configureProviderSetup(provider: string, input: unknown): Promise<unknown>;
  installProviderHelper(provider: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  reconcileProviderManagedShares(provider: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  listManagedShares(options?: { signal?: AbortSignal; fast?: boolean }): Promise<unknown>;
  listIncomingManagedShares(options?: { signal?: AbortSignal; fast?: boolean }): Promise<unknown>;
  listIncomingProviderContactInvites(options?: { signal?: AbortSignal; fast?: boolean }): Promise<unknown>;
  createManagedShare(input: unknown): Promise<unknown>;
  inviteManagedShare(shareId: string, emails: string[], accessLevel?: string): Promise<unknown>;
  attachManagedShare(shareId: string, volumeId: string): Promise<unknown>;
  removeManagedShare(shareId: string): Promise<void>;
  acceptManagedShare(input: unknown): Promise<unknown>;
  acceptIncomingProviderContactInvite(input: unknown): Promise<void>;
  getManagedShareState(shareId: string): Promise<unknown>;
}

export interface NearbytesCapabilityFamily {
  hostKind: 'desktop' | 'phone' | 'web';
  runtimeOwner: 'embedded' | 'desktop-proxy' | 'remote-runtime';
  supportsDirectoryPicker: boolean;
  supportsRuntimeLogs: boolean;
}

export interface NearbytesLegacyDesktopFamily {
  openVolume(secret: string): Promise<unknown>;
  listFiles(auth: NearbytesAuth): Promise<unknown>;
  getTimeline(auth: NearbytesAuth): Promise<unknown>;
  getEventDetail(auth: NearbytesAuth, eventHash: string): Promise<unknown>;
  getEventStorageLocations(auth: NearbytesAuth, eventHash: string): Promise<unknown>;
  uploadFile(auth: NearbytesAuth, file: File): Promise<unknown>;
  deleteFile(auth: NearbytesAuth, filename: string): Promise<void>;
  renameFile(auth: NearbytesAuth, from: string, to: string): Promise<unknown>;
  renameFolder(auth: NearbytesAuth, from: string, to: string, merge: boolean): Promise<unknown>;
  exportSourceReferences(auth: NearbytesAuth, filenames: string[]): Promise<unknown>;
  importSourceReferences(auth: NearbytesAuth, bundle: unknown, sourceSecret: string): Promise<unknown>;
  exportRecipientReferences(auth: NearbytesAuth, filenames: string[], recipientVolumeId: string): Promise<unknown>;
  importRecipientReferences(auth: NearbytesAuth, bundle: unknown): Promise<unknown>;
  listChat(auth: NearbytesAuth): Promise<unknown>;
  publishIdentity(auth: NearbytesAuth, identitySecret: string, profile: unknown): Promise<unknown>;
  sendChatMessage(auth: NearbytesAuth, identitySecret: string, input: { body?: string; attachment?: unknown }): Promise<unknown>;
}

export interface NearbytesObjectFamily {
  requestJson<T>(endpoint: string, options?: RequestInit): Promise<T>;
  requestBlob(endpoint: string, options?: RequestInit): Promise<Blob>;
  openStream(endpoint: string, options?: RequestInit): Promise<Response>;
}

export interface NearbytesShellFamily {
  chooseDirectory(initialPath?: string): Promise<string | null>;
}

export interface NearbytesHostContract {
  capabilities: NearbytesCapabilityFamily;
  objects: NearbytesObjectFamily;
  invalidation: NearbytesInvalidationFamily;
  integrations: NearbytesIntegrationsFamily;
  lan: NearbytesLanFamily;
  shell: NearbytesShellFamily;
  legacyDesktop: NearbytesLegacyDesktopFamily;
}