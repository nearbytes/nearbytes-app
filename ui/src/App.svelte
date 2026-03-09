<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    openVolume,
    listFiles,
    getTimeline,
    uploadFiles,
    deleteFile,
    downloadFile,
    exportSourceReferences,
    publishIdentity,
    renameFile,
    watchVolume,
    type Auth,
    type ChatAttachment,
    type FileMetadata,
    type SourceReferenceBundle,
    type TimelineEvent,
    type VolumeChatState,
  } from './lib/api.js';
  import { getCachedFiles, setCachedFiles } from './lib/cache.js';
  import {
    buildIdentitySecret,
    createConfiguredIdentity,
    loadActiveIdentityId,
    loadConfiguredIdentities,
    loadVolumeIdentityAssignments,
    persistActiveIdentityId,
    persistConfiguredIdentities,
    persistVolumeIdentityAssignments,
    type ConfiguredIdentity,
  } from './lib/chatIdentities.js';
  import {
    exportSourceReferenceBundleFromDrag,
    importMountedSourceReferenceBundle,
    parseSourceReferenceBundleText,
  } from './lib/nearbytesReferenceTransfer.js';
  import { writeNearbytesClipboardPayload } from './lib/referenceClipboard.js';
  import ArmedActionButton from './components/ArmedActionButton.svelte';
  import AudioPreview from './components/AudioPreview.svelte';
  import StoragePanel from './components/StoragePanel.svelte';
  import VolumeChat from './components/VolumeChat.svelte';
  import VolumeIdentity from './components/VolumeIdentity.svelte';
  import { NEARBYTES_DRAG_TYPE } from './lib/nearbytesDrag.js';
  import {
    Activity,
    ClipboardPaste,
    Download,
    File,
    FileArchive,
    FileAudio,
    FileCode2,
    FileText,
    FileVideo,
    GripVertical,
    HardDrive,
    History,
    Image as ImageIcon,
    LayoutGrid,
    MessageSquareText,
    Plus,
    RefreshCw,
    Rows3,
    Search,
    Settings2,
    Trash2,
    UserRound,
    X,
  } from 'lucide-svelte';

  const VOLUME_MOUNTS_KEY = 'nearbytes-volume-mounts-v1';
  const FILE_SECRET_PREFIX = 'nb-file-secret:v1:';

  type PreviewKind = 'none' | 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unsupported';
  type DesktopRemoteFile = {
    filename: string;
    mimeType: string;
    bytesBase64: string;
  };

  type PersistedUiState = {
    volumeMounts?: unknown;
  };

  type NearbytesDesktopBridge = {
    fetchRemoteFile?: (url: string) => Promise<DesktopRemoteFile>;
    getClipboardImageStatus?: () => Promise<{ hasImage: boolean }>;
    readClipboardImage?: () => Promise<DesktopRemoteFile | null>;
    loadUiState?: () => Promise<PersistedUiState>;
    saveUiState?: (state: PersistedUiState) => Promise<unknown>;
  };

  type SecretFileHashEntry = {
    payload: string;
    hash: string;
    pending: boolean;
  };

  type VolumeMount = {
    id: string;
    address: string;
    password: string;
    secretFilePayload: string;
    secretFileName: string;
    secretFileMimeType: string;
    volumeId?: string;
    collapsed: boolean;
    showFilesPane: boolean;
    showChatPane: boolean;
    workspaceSplit: number;
    createdAt: number;
  };

  type MountedVolumePresentation = {
    volumeId: string;
    label: string;
    filePayload: string;
    fileMimeType: string;
    fileName: string;
  };

  type FileManagerViewMode = 'icons' | 'details';

  type AppReferenceClipboard = {
    bundle: SourceReferenceBundle;
    itemCount: number;
  };

  function createMount(overrides: Partial<VolumeMount> = {}): VolumeMount {
    return {
      id: overrides.id ?? `mount-${Math.random().toString(16).slice(2, 10)}`,
      address: typeof overrides.address === 'string' ? overrides.address.trim() : '',
      password: typeof overrides.password === 'string' ? overrides.password.trim() : '',
      secretFilePayload:
        typeof overrides.secretFilePayload === 'string' ? overrides.secretFilePayload.trim() : '',
      secretFileName: typeof overrides.secretFileName === 'string' ? overrides.secretFileName.trim() : '',
      secretFileMimeType:
        typeof overrides.secretFileMimeType === 'string' ? overrides.secretFileMimeType.trim() : '',
      volumeId: typeof overrides.volumeId === 'string' ? overrides.volumeId.trim().toLowerCase() : undefined,
      collapsed: overrides.collapsed ?? false,
      showFilesPane: overrides.showFilesPane ?? true,
      showChatPane: overrides.showChatPane ?? false,
      workspaceSplit:
        typeof overrides.workspaceSplit === 'number' && Number.isFinite(overrides.workspaceSplit)
          ? Math.max(34, Math.min(66, overrides.workspaceSplit))
          : 56,
      createdAt: overrides.createdAt ?? Date.now(),
    };
  }

  function normalizeMounts(input: unknown): VolumeMount[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((value) => typeof value === 'object' && value !== null)
      .map((value) => value as Partial<VolumeMount>)
      .filter(
        (value) =>
          typeof value.id === 'string' &&
          typeof value.address === 'string' &&
          typeof value.password === 'string' &&
          (value.secretFilePayload === undefined || typeof value.secretFilePayload === 'string') &&
          (value.secretFileName === undefined || typeof value.secretFileName === 'string') &&
          (value.secretFileMimeType === undefined || typeof value.secretFileMimeType === 'string') &&
          (value.volumeId === undefined || typeof value.volumeId === 'string') &&
          typeof value.collapsed === 'boolean' &&
          (value.showFilesPane === undefined || typeof value.showFilesPane === 'boolean') &&
          (value.showChatPane === undefined || typeof value.showChatPane === 'boolean') &&
          (value.workspaceSplit === undefined || typeof value.workspaceSplit === 'number')
      )
      .map((value) =>
        createMount({
          id: value.id,
          address: value.address,
          password: value.password,
          secretFilePayload: value.secretFilePayload,
          secretFileName: value.secretFileName,
          secretFileMimeType: value.secretFileMimeType,
          volumeId: value.volumeId,
          collapsed: value.collapsed,
          showFilesPane: value.showFilesPane,
          showChatPane: value.showChatPane,
          workspaceSplit: value.workspaceSplit,
          createdAt: value.createdAt,
        })
      );
  }

  function loadVolumeMounts(): VolumeMount[] {
    try {
      const raw = localStorage.getItem(VOLUME_MOUNTS_KEY);
      if (!raw) return [createMount()];
      const mounts = normalizeMounts(JSON.parse(raw));
      return mounts;
    } catch {
      return [createMount()];
    }
  }

  function persistVolumeMounts(mounts: VolumeMount[]): void {
    try {
      localStorage.setItem(VOLUME_MOUNTS_KEY, JSON.stringify(snapshotVolumeMounts(mounts)));
    } catch {
      // ignore
    }
  }

  function snapshotVolumeMounts(input: VolumeMount[]): VolumeMount[] {
    return input.map((mount) => ({
      id: mount.id,
      address: mount.address,
      password: mount.password,
      secretFilePayload: mount.secretFilePayload,
      secretFileName: mount.secretFileName,
      secretFileMimeType: mount.secretFileMimeType,
      volumeId: mount.volumeId,
      collapsed: mount.collapsed,
      showFilesPane: mount.showFilesPane,
      showChatPane: mount.showChatPane,
      workspaceSplit: mount.workspaceSplit,
      createdAt: mount.createdAt,
    }));
  }

  function trimSecretPart(value: string): string {
    return value.trim();
  }

  function buildSecret(addr: string, password: string): string {
    const trimmedAddress = trimSecretPart(addr);
    const trimmedPassword = trimSecretPart(password);
    return trimmedPassword ? `${trimmedAddress}:${trimmedPassword}` : trimmedAddress;
  }

  function hasFileSecret(mount: VolumeMount): boolean {
    return trimSecretPart(mount.secretFilePayload) !== '';
  }

  function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  }

  function buildFileSecretPayload(bytes: Uint8Array): string {
    return `${FILE_SECRET_PREFIX}${bytesToBase64Url(bytes)}`;
  }

  function buildMountSecret(mount: VolumeMount): string {
    if (hasFileSecret(mount)) {
      return trimSecretPart(mount.secretFilePayload);
    }
    return buildSecret(mount.address, mount.password);
  }

  function mountDisplayLabel(mount: VolumeMount): string {
    if (trimSecretPart(mount.secretFileName) !== '') {
      return trimSecretPart(mount.secretFileName);
    }
    return trimSecretPart(mount.address);
  }

  function base64UrlToBase64(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const remainder = normalized.length % 4;
    if (remainder === 0) return normalized;
    return `${normalized}${'='.repeat(4 - remainder)}`;
  }

  function secretFilePayloadDataUrl(mount: VolumeMount): string | null {
    const payload = trimSecretPart(mount.secretFilePayload);
    if (!payload.startsWith(FILE_SECRET_PREFIX)) return null;
    const encoded = payload.slice(FILE_SECRET_PREFIX.length);
    if (encoded === '') return null;
    const mimeType = trimSecretPart(mount.secretFileMimeType) || 'application/octet-stream';
    return `data:${mimeType};base64,${base64UrlToBase64(encoded)}`;
  }

  function secretFileBytesFromPayload(payload: string): Uint8Array | null {
    const trimmed = trimSecretPart(payload);
    if (!trimmed.startsWith(FILE_SECRET_PREFIX)) return null;
    const encoded = trimmed.slice(FILE_SECRET_PREFIX.length);
    if (encoded === '') return null;
    return base64ToBytes(base64UrlToBase64(encoded));
  }

  function secretFileBytes(mount: VolumeMount): Uint8Array | null {
    return secretFileBytesFromPayload(mount.secretFilePayload);
  }

  function secretFileHashForMount(mount: VolumeMount): SecretFileHashEntry | null {
    const payload = trimSecretPart(mount.secretFilePayload);
    const entry = secretFileHashes[mount.id];
    if (!entry || entry.payload !== payload) {
      return null;
    }
    return entry;
  }

  async function computeSecretFileHash(mountId: string, payload: string): Promise<void> {
    const bytes = secretFileBytesFromPayload(payload);
    if (!bytes) return;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

    const currentMount = mounts.find((mount) => mount.id === mountId);
    if (!currentMount || trimSecretPart(currentMount.secretFilePayload) !== payload) {
      return;
    }

    secretFileHashes = {
      ...secretFileHashes,
      [mountId]: {
        payload,
        hash,
        pending: false,
      },
    };
  }

  function downloadSecretFile(mount: VolumeMount) {
    const bytes = secretFileBytes(mount);
    if (!bytes) return;
    const blob = new Blob([bytes], {
      type: trimSecretPart(mount.secretFileMimeType) || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = mount.secretFileName || mount.address || 'secret-file';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function hasImageSecretPreview(mount: VolumeMount): boolean {
    return hasFileSecret(mount) && trimSecretPart(mount.secretFileMimeType).startsWith('image/');
  }

  $effect(() => {
    for (const mount of mounts) {
      if (!hasFileSecret(mount)) continue;
      const payload = trimSecretPart(mount.secretFilePayload);
      const current = secretFileHashes[mount.id];
      if (current && current.payload === payload) continue;
      secretFileHashes = {
        ...secretFileHashes,
        [mount.id]: {
          payload,
          hash: '',
          pending: true,
        },
      };
      void computeSecretFileHash(mount.id, payload);
    }
  });

  function transferTypes(dataTransfer: DataTransfer | null | undefined): string[] {
    if (!dataTransfer) return [];
    return Array.from(dataTransfer.types ?? []);
  }

  function canHandleDropPayload(dataTransfer: DataTransfer | null | undefined): boolean {
    const types = transferTypes(dataTransfer);
    if (types.includes('Files') || types.includes('DownloadURL') || types.includes(NEARBYTES_DRAG_TYPE)) {
      return true;
    }
    return types.some((type) =>
      type === 'text/uri-list' ||
      type === 'text/html' ||
      type === 'text/plain' ||
      type === 'public.url' ||
      type === 'public.url-name' ||
      type === 'UniformResourceLocator'
    );
  }

  function canHandleSecretDropPayload(dataTransfer: DataTransfer | null | undefined): boolean {
    const types = transferTypes(dataTransfer);
    if (types.includes(NEARBYTES_DRAG_TYPE)) {
      return false;
    }
    if (types.includes('Files') || types.includes('DownloadURL')) {
      return true;
    }
    return types.some((type) =>
      type === 'text/uri-list' ||
      type === 'text/html' ||
      type === 'text/plain' ||
      type === 'public.url' ||
      type === 'public.url-name' ||
      type === 'UniformResourceLocator'
    );
  }

  function decodeUriComponentSafe(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function extensionFromMimeType(mimeType: string): string {
    const normalized = trimSecretPart(mimeType).toLowerCase();
    if (normalized === 'image/jpeg') return '.jpg';
    if (normalized === 'image/png') return '.png';
    if (normalized === 'image/webp') return '.webp';
    if (normalized === 'image/gif') return '.gif';
    if (normalized === 'image/svg+xml') return '.svg';
    if (normalized === 'image/bmp') return '.bmp';
    if (normalized === 'image/heic') return '.heic';
    if (normalized === 'application/pdf') return '.pdf';
    if (normalized === 'text/plain') return '.txt';
    return '';
  }

  function sanitizeDroppedFilename(value: string, fallback = 'dropped-file'): string {
    const trimmed = trimSecretPart(value);
    const normalized = trimmed.replace(/[\\]/g, '/');
    const lastSegment = normalized.split('/').filter(Boolean).at(-1) ?? normalized;
    const clean = decodeUriComponentSafe(lastSegment.split('?')[0]?.split('#')[0] ?? '').trim();
    const safe = clean.replace(/[:*?"<>|]/g, '_');
    return safe === '' ? fallback : safe;
  }

  function filenameFromUrl(url: string, fallback = 'dropped-file'): string {
    try {
      const parsed = new URL(url);
      return sanitizeDroppedFilename(parsed.pathname, fallback);
    } catch {
      return sanitizeDroppedFilename(url, fallback);
    }
  }

  function isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function looksLikeMediaUrl(value: string): boolean {
    try {
      const url = new URL(value);
      const pathname = url.pathname.toLowerCase();
      return /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif|mp4|mov|webm|mp3|wav|ogg|pdf)$/i.test(pathname);
    } catch {
      return false;
    }
  }

  function extractUrlFromHtml(html: string): string | null {
    const trimmed = html.trim();
    if (trimmed === '') return null;
    try {
      const doc = new DOMParser().parseFromString(trimmed, 'text/html');
      const baseHref = doc.querySelector('base[href]')?.getAttribute('href') ?? '';
      const media = doc.querySelector('img[src], source[src], video[src], audio[src]');
      if (media instanceof HTMLElement) {
        const src = media.getAttribute('src');
        if (src) {
          try {
            const resolved = new URL(src, baseHref || undefined).href;
            if (isHttpUrl(resolved)) {
              return resolved;
            }
          } catch {
            if (isHttpUrl(src)) {
              return src;
            }
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  type RemoteDropDescriptor = {
    url: string;
    filename?: string;
    mimeType?: string;
  };

  function parseDownloadUrl(raw: string): RemoteDropDescriptor | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const firstColon = trimmed.indexOf(':');
    const secondColon = firstColon >= 0 ? trimmed.indexOf(':', firstColon + 1) : -1;
    if (firstColon <= 0 || secondColon <= firstColon) {
      return null;
    }
    const mimeType = trimmed.slice(0, firstColon);
    const filename = trimmed.slice(firstColon + 1, secondColon);
    const url = trimmed.slice(secondColon + 1);
    if (!isHttpUrl(url)) {
      return null;
    }
    if (trimSecretPart(mimeType).toLowerCase() === 'text/html' && !looksLikeMediaUrl(url)) {
      return null;
    }
    return {
      url,
      filename: sanitizeDroppedFilename(filename),
      mimeType: trimSecretPart(mimeType),
    };
  }

  function extractRemoteDropDescriptor(dataTransfer: DataTransfer): RemoteDropDescriptor | null {
    const downloadUrl = parseDownloadUrl(dataTransfer.getData('DownloadURL'));
    if (downloadUrl) {
      return downloadUrl;
    }

    const htmlUrl = extractUrlFromHtml(dataTransfer.getData('text/html'));
    if (htmlUrl) {
      return { url: htmlUrl };
    }

    const uriList = dataTransfer
      .getData('text/uri-list')
      .split('\n')
      .map((entry) => entry.trim())
      .find(
        (entry) =>
          entry !== '' &&
          !entry.startsWith('#') &&
          isHttpUrl(entry) &&
          looksLikeMediaUrl(entry)
      );
    if (uriList) {
      return { url: uriList };
    }

    const publicUrl = trimSecretPart(dataTransfer.getData('public.url'));
    if (isHttpUrl(publicUrl) && looksLikeMediaUrl(publicUrl)) {
      return { url: publicUrl };
    }

    const uniformResourceLocator = trimSecretPart(dataTransfer.getData('UniformResourceLocator'));
    if (isHttpUrl(uniformResourceLocator) && looksLikeMediaUrl(uniformResourceLocator)) {
      return { url: uniformResourceLocator };
    }

    const plainText = trimSecretPart(dataTransfer.getData('text/plain'));
    if (isHttpUrl(plainText) && looksLikeMediaUrl(plainText)) {
      return { url: plainText };
    }

    return null;
  }

  function getDesktopBridge(): NearbytesDesktopBridge | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const globalWindow = window as Window & { nearbytesDesktop?: NearbytesDesktopBridge };
    return globalWindow.nearbytesDesktop ?? null;
  }

  function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function fileFromDesktopRemoteDrop(descriptor: RemoteDropDescriptor): Promise<File | null> {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.fetchRemoteFile !== 'function') {
      return null;
    }

    const fetched = await bridge.fetchRemoteFile(descriptor.url);
    const bytes = base64ToBytes(fetched.bytesBase64);
    const mimeType = trimSecretPart(fetched.mimeType) || descriptor.mimeType || 'application/octet-stream';
    let filename = trimSecretPart(fetched.filename) || trimSecretPart(descriptor.filename ?? '');
    if (filename === '') {
      filename = filenameFromUrl(descriptor.url);
    }
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([bytes], sanitizeDroppedFilename(filename), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  async function fileFromClipboardImage(): Promise<File | null> {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.readClipboardImage !== 'function') {
      return null;
    }

    const clipboardFile = await bridge.readClipboardImage();
    if (!clipboardFile) {
      return null;
    }

    const bytes = base64ToBytes(clipboardFile.bytesBase64);
    const mimeType = trimSecretPart(clipboardFile.mimeType) || 'image/png';
    let filename = trimSecretPart(clipboardFile.filename) || 'clipboard-image';
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([bytes], sanitizeDroppedFilename(filename, 'clipboard-image'), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  async function fileFromRemoteDrop(dataTransfer: DataTransfer): Promise<File | null> {
    const descriptor = extractRemoteDropDescriptor(dataTransfer);
    if (!descriptor) {
      return null;
    }

    const desktopFile = await fileFromDesktopRemoteDrop(descriptor);
    if (desktopFile) {
      return desktopFile;
    }

    const response = await fetch(descriptor.url);
    if (!response.ok) {
      throw new Error(`Remote download failed (${response.status})`);
    }

    const blob = await response.blob();
    const responseType = trimSecretPart(response.headers.get('content-type') ?? '');
    if (responseType.toLowerCase().startsWith('text/html')) {
      throw new Error('Dragged page URL instead of media. Drag the image itself, or use Copy Image then paste.');
    }
    const mimeType = responseType || trimSecretPart(blob.type) || descriptor.mimeType || 'application/octet-stream';
    let filename = trimSecretPart(descriptor.filename ?? '');
    if (filename === '') {
      filename = filenameFromUrl(descriptor.url);
    }
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([blob], sanitizeDroppedFilename(filename), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  function localFilesFromTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
    if (!dataTransfer) return [];
    const directFiles = Array.from(dataTransfer.files ?? []);
    const itemFiles = Array.from(dataTransfer.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((value): value is File => value instanceof File);
    return directFiles.length > 0 ? directFiles : itemFiles;
  }

  async function filesFromTransfer(dataTransfer: DataTransfer | null | undefined): Promise<File[]> {
    if (!dataTransfer) return [];
    const localFiles = localFilesFromTransfer(dataTransfer);
    if (localFiles.length > 0) {
      return localFiles;
    }
    const remoteFile = await fileFromRemoteDrop(dataTransfer);
    return remoteFile ? [remoteFile] : [];
  }

  function dropFailureMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      if (error.name === 'TypeError') {
        return 'This site blocked direct access. Save it first or copy and paste a local image.';
      }
      return error.message;
    }
    return fallback;
  }

  // State: address = main input; effectiveSecret = sent to API
  let address = $state('');
  let addressPassword = $state('');
  let effectiveSecret = $state('');
  let unlockedAddress = $state('');
  let fileList = $state<FileMetadata[]>([]);
  let volumeId = $state<string | null>(null);
  let auth = $state<Auth | null>(null);
  let isDragging = $state(false);
  let errorMessage = $state('');
  let isLoading = $state(false);
  let isVolumeTransitioning = $state(false);
  let isTimelineLoading = $state(false);
  let isTimelinePlaying = $state(false);
  let isOffline = $state(false);
  let lastRefresh = $state<number | null>(null);
  let copiedVolumeId = $state(false);
  let searchQuery = $state('');
  let sortBy = $state<'newest' | 'oldest' | 'name' | 'name-desc' | 'size' | 'size-asc'>('newest');
  let selectedFileName = $state<string | null>(null);
  let selectedFileNames = $state<string[]>([]);
  let selectionAnchorFileName = $state<string | null>(null);
  let renamingFileName = $state<string | null>(null);
  let renameDraft = $state('');
  let renamePending = $state(false);
  let timelineEvents = $state<TimelineEvent[]>([]);
  let timelinePosition = $state(0);
  let previewKind = $state<PreviewKind>('none');
  let previewUrl = $state('');
  let previewText = $state('');
  let previewLoading = $state(false);
  let previewError = $state('');
  let showPreviewPane = $state(false);
  let previewFileOverride = $state<FileMetadata | null>(null);
  let currentPreviewObjectUrl: string | null = null;
  const previewBlobCache = new Map<string, Blob>();
  const initialMounts = loadVolumeMounts();
  let mounts = $state<VolumeMount[]>(initialMounts);
  let activeMountId = $state(initialMounts[0]?.id ?? '');
  let pendingMountId = $state<string | null>(null);
  let secretPasteTargetMountId = $state<string | null>(null);
  let secretFileHashes = $state<Record<string, SecretFileHashEntry>>({});
  let clipboardImageAvailable = $state(false);
  let clipboardImageLoading = $state(false);
  let persistedUiStateReady = $state(false);
  let isHeaderHovering = $state(false);
  let isSecretDropTarget = $state(false);
  let timelinePlayTimer: ReturnType<typeof setInterval> | null = null;
  let showStatusPanel = $state(false);
  let showTimeMachinePanel = $state(false);
  let showSourcesPanel = $state(false);
  let showVolumeStoragePanel = $state(false);
  let autoSyncEnabled = $state(false);
  let autoSyncStatus = $state<'idle' | 'connecting' | 'active' | 'unsupported' | 'error'>('idle');
  let isRefreshing = $state(false);
  let configuredIdentities = $state<ConfiguredIdentity[]>([]);
  let activeChatIdentityId = $state('');
  let volumeChatIdentityAssignments = $state<Record<string, string>>({});
  let showIdentityManager = $state(false);
  let identityManagerLoading = $state(false);
  let identityManagerMessage = $state('');
  let identityManagerError = $state('');
  let identityHydrated = false;
  let chatRefreshVersion = $state(0);
  let fileManagerViewMode = $state<FileManagerViewMode>('icons');
  let fileManagerSplit = $state(38);
  let fileManagerElement = $state<HTMLElement | null>(null);
  let workspacePanelsElement = $state<HTMLElement | null>(null);
  let fileManagerActive = $state(false);
  let appReferenceClipboard = $state<AppReferenceClipboard | null>(null);
  let watchConnectionSerial = 0;
  let watchDisconnect: (() => void) | null = null;
  let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let volumeOpenSerial = 0;

  function preferredActiveMountId(nextMounts: VolumeMount[]): string {
    return nextMounts.find((mount) => !mount.collapsed)?.id ?? nextMounts[0]?.id ?? '';
  }

  onMount(() => {
    configuredIdentities = loadConfiguredIdentities();
    activeChatIdentityId = loadActiveIdentityId();
    volumeChatIdentityAssignments = loadVolumeIdentityAssignments();
    identityHydrated = true;

    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.loadUiState !== 'function') {
      persistedUiStateReady = true;
      return;
    }

    void (async () => {
      try {
        const nextState = await bridge.loadUiState();
        const hasPersistedMounts = Object.prototype.hasOwnProperty.call(nextState ?? {}, 'volumeMounts');
        const nextMounts = normalizeMounts(nextState?.volumeMounts);
        if (hasPersistedMounts) {
          mounts = nextMounts.length > 0 ? nextMounts : [createMount()];
          activeMountId = preferredActiveMountId(mounts);
        }
      } catch (error) {
        console.warn('Failed to hydrate desktop UI state:', error);
      } finally {
        persistedUiStateReady = true;
      }
    })();
  });

  $effect(() => {
    if (!identityHydrated) {
      return;
    }
    persistConfiguredIdentities(configuredIdentities);
  });

  $effect(() => {
    if (!identityHydrated) {
      return;
    }
    persistActiveIdentityId(activeChatIdentityId);
  });

  $effect(() => {
    if (!identityHydrated) {
      return;
    }
    persistVolumeIdentityAssignments(volumeChatIdentityAssignments);
  });

  $effect(() => {
    if (configuredIdentities.length === 0) {
      if (activeChatIdentityId !== '') {
        activeChatIdentityId = '';
      }
      return;
    }
    if (configuredIdentities.some((identity) => identity.id === activeChatIdentityId)) {
      return;
    }
    activeChatIdentityId = configuredIdentities[0].id;
  });

  $effect(() => {
    const validIds = new Set(configuredIdentities.map((identity) => identity.id));
    let changed = false;
    const nextAssignments: Record<string, string> = {};
    for (const [targetVolumeId, identityId] of Object.entries(volumeChatIdentityAssignments)) {
      if (validIds.has(identityId)) {
        nextAssignments[targetVolumeId] = identityId;
      } else {
        changed = true;
      }
    }
    if (changed) {
      volumeChatIdentityAssignments = nextAssignments;
    }
  });

  $effect(() => {
    const expandedMount = mounts.find((mount) => mount.id === activeMountId && !mount.collapsed);
    if (!expandedMount) {
      clipboardImageAvailable = false;
      clipboardImageLoading = false;
      return;
    }

    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.getClipboardImageStatus !== 'function') {
      clipboardImageAvailable = false;
      return;
    }

    let cancelled = false;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const status = await bridge.getClipboardImageStatus?.();
        if (!cancelled) {
          clipboardImageAvailable = Boolean(status?.hasImage);
        }
      } catch {
        if (!cancelled) {
          clipboardImageAvailable = false;
        }
      }
    };

    void refresh();
    const handleWindowFocus = () => {
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    pollingTimer = setInterval(() => {
      void refresh();
    }, 1500);

    return () => {
      cancelled = true;
      if (pollingTimer) {
        clearInterval(pollingTimer);
      }
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (currentMount) return;
    if (mounts.length === 0) {
      if (activeMountId !== '') activeMountId = '';
      if (address !== '') address = '';
      if (addressPassword !== '') addressPassword = '';
      return;
    }
    activeMountId = mounts[0].id;
  });

  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (!currentMount) return;
    if (address !== currentMount.address) {
      address = currentMount.address;
    }
    if (addressPassword !== currentMount.password) {
      addressPassword = currentMount.password;
    }
  });

  $effect(() => {
    const index = mounts.findIndex((mount) => mount.id === activeMountId);
    if (index < 0) return;
    const currentMount = mounts[index];
    if (currentMount.address === address && currentMount.password === addressPassword) {
      return;
    }
    const next = [...mounts];
    next[index] = {
      ...currentMount,
      address,
      password: addressPassword,
      volumeId: undefined,
    };
    mounts = next;
  });

  $effect(() => {
    if (!persistedUiStateReady) {
      return;
    }

    const payload: PersistedUiState = {
      volumeMounts: snapshotVolumeMounts(mounts),
    };
    const bridge = getDesktopBridge();
    const persistTimer = setTimeout(() => {
      if (bridge && typeof bridge.saveUiState === 'function') {
        void bridge.saveUiState(payload).catch((error) => {
          console.warn('Failed to persist desktop UI state:', error);
        });
        return;
      }
      persistVolumeMounts(mounts);
    }, 120);

    return () => {
      clearTimeout(persistTimer);
    };
  });

  const isHistoryMode = $derived.by(() => timelinePosition < timelineEvents.length);

  function timelineKindLabel(event: TimelineEvent): string {
    switch (event.type) {
      case 'CREATE_FILE':
        return 'Create';
      case 'DELETE_FILE':
        return 'Delete';
      case 'RENAME_FILE':
        return 'Rename';
      case 'DECLARE_IDENTITY':
        return 'Identity';
      case 'CHAT_MESSAGE':
        return 'Chat';
    }
  }

  function timelineHeadline(event: TimelineEvent): string {
    switch (event.type) {
      case 'CREATE_FILE':
      case 'DELETE_FILE':
        return fileBaseName(event.filename);
      case 'RENAME_FILE': {
        const fromName = fileBaseName(event.filename);
        const toName = fileBaseName(event.toFilename ?? '');
        return toName ? `${fromName} -> ${toName}` : fromName;
      }
      case 'DECLARE_IDENTITY':
        return event.displayName ? `Publish ${event.displayName}` : 'Publish identity';
      case 'CHAT_MESSAGE':
        return event.summary ?? 'Chat message';
    }
  }

  function timelineMarkerText(event: TimelineEvent, position: number, total: number): string {
    switch (event.type) {
      case 'CREATE_FILE':
        return `${position}/${total} • ${fileBaseName(event.filename)} created`;
      case 'DELETE_FILE':
        return `${position}/${total} • ${fileBaseName(event.filename)} deleted`;
      case 'RENAME_FILE':
        return `${position}/${total} • ${fileBaseName(event.filename)} renamed`;
      case 'DECLARE_IDENTITY':
        return `${position}/${total} • ${event.displayName ? `${event.displayName} published identity` : 'Identity published'}`;
      case 'CHAT_MESSAGE':
        return `${position}/${total} • ${event.summary ?? 'Chat message'}`;
    }
  }

  function timelineTitle(event: TimelineEvent): string {
    return `${timelineKindLabel(event)} ${timelineHeadline(event)} • ${formatDate(event.timestamp)}`;
  }

  const timelineMarker = $derived.by(() => {
    if (timelineEvents.length === 0) return 'No history yet';
    if (timelinePosition === timelineEvents.length) return 'Live view';
    if (timelinePosition === 0) return `Genesis • 0/${timelineEvents.length}`;
    const event = timelineEvents[timelinePosition - 1];
    return timelineMarkerText(event, timelinePosition, timelineEvents.length);
  });

  function reconstructChatStateFromTimeline(limit: number): VolumeChatState {
    const identitiesByPublicKey = new Map<string, VolumeChatState['identities'][number]>();
    const messages: VolumeChatState['messages'] = [];
    const clampedLimit = Math.max(0, Math.min(limit, timelineEvents.length));

    for (let index = 0; index < clampedLimit; index += 1) {
      const event = timelineEvents[index];
      if (
        event.type === 'DECLARE_IDENTITY' &&
        event.authorPublicKey &&
        event.record
      ) {
        identitiesByPublicKey.set(event.authorPublicKey, {
          eventHash: event.eventHash,
          authorPublicKey: event.authorPublicKey,
          publishedAt: event.publishedAt ?? event.timestamp,
          record: event.record,
        });
        continue;
      }

      if (
        event.type === 'CHAT_MESSAGE' &&
        event.authorPublicKey &&
        event.message
      ) {
        messages.push({
          eventHash: event.eventHash,
          authorPublicKey: event.authorPublicKey,
          publishedAt: event.publishedAt ?? event.timestamp,
          message: event.message,
        });
      }
    }

    return {
      identities: Array.from(identitiesByPublicKey.values()),
      messages,
    };
  }

  const historicalChatState = $derived.by((): VolumeChatState =>
    reconstructChatStateFromTimeline(timelinePosition)
  );

  const latestTimelineChatState = $derived.by((): VolumeChatState =>
    reconstructChatStateFromTimeline(timelineEvents.length)
  );

  const selectedChatIdentity = $derived.by(
    () => configuredIdentities.find((identity) => identity.id === activeChatIdentityId) ?? null
  );

  const currentVolumeChatIdentityId = $derived.by(() => {
    if (!volumeId) {
      return '';
    }
    return volumeChatIdentityAssignments[volumeId] ?? '';
  });

  const joinedChatIdentity = $derived.by(
    () =>
      configuredIdentities.find((identity) => identity.id === currentVolumeChatIdentityId) ?? null
  );

  const publishedIdentityByPublicKey = $derived.by(() => {
    const map = new Map<string, VolumeChatState['identities'][number]>();
    for (const identity of latestTimelineChatState.identities) {
      map.set(identity.authorPublicKey, identity);
    }
    return map;
  });

  const selectedPublishedIdentity = $derived.by(() => {
    if (!selectedChatIdentity?.publicKey) {
      return null;
    }
    return publishedIdentityByPublicKey.get(selectedChatIdentity.publicKey) ?? null;
  });

  const selectedChatIdentityNeedsPublish = $derived.by(() => {
    if (!selectedChatIdentity) {
      return false;
    }
    if (!selectedChatIdentity.publicKey || !selectedPublishedIdentity) {
      return true;
    }
    return (
      selectedPublishedIdentity.record.profile.displayName !==
        selectedChatIdentity.displayName.trim() ||
      (selectedPublishedIdentity.record.profile.bio ?? '') !== selectedChatIdentity.bio.trim()
    );
  });

  const joinedPublishedIdentity = $derived.by(() => {
    if (!joinedChatIdentity?.publicKey) {
      return null;
    }
    return publishedIdentityByPublicKey.get(joinedChatIdentity.publicKey) ?? null;
  });

  const joinedChatIdentityNeedsPublish = $derived.by(() => {
    if (!joinedChatIdentity) {
      return false;
    }
    if (!joinedChatIdentity.publicKey || !joinedPublishedIdentity) {
      return true;
    }
    return (
      joinedPublishedIdentity.record.profile.displayName !== joinedChatIdentity.displayName.trim() ||
      (joinedPublishedIdentity.record.profile.bio ?? '') !== joinedChatIdentity.bio.trim()
    );
  });

  const viewFiles = $derived.by(() => {
    if (timelinePosition >= timelineEvents.length) return fileList;

    const files = new Map<string, FileMetadata>();
    const limit = Math.max(0, Math.min(timelinePosition, timelineEvents.length));
    for (let i = 0; i < limit; i += 1) {
      const event = timelineEvents[i];
      if (event.type === 'CREATE_FILE') {
        if (
          event.blobHash === undefined ||
          event.size === undefined ||
          event.createdAt === undefined
        ) {
          continue;
        }
        files.set(event.filename, {
          filename: event.filename,
          blobHash: event.blobHash,
          size: event.size,
          mimeType: event.mimeType,
          createdAt: event.createdAt,
        });
        continue;
      }
      if (event.type === 'DELETE_FILE') {
        files.delete(event.filename);
        continue;
      }
      if (event.type === 'RENAME_FILE' && event.toFilename) {
        const existing = files.get(event.filename);
        if (!existing) {
          continue;
        }
        files.delete(event.filename);
        files.set(event.toFilename, {
          ...existing,
          filename: event.toFilename,
        });
      }
    }

    const materialized = Array.from(files.values());
    materialized.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.filename.localeCompare(b.filename);
    });
    return materialized;
  });

  const visibleFiles = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? viewFiles.filter((file) => file.filename.toLowerCase().includes(query))
      : viewFiles;
    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
      return sorted;
    }
    if (sortBy === 'name-desc') {
      sorted.sort((a, b) => b.filename.localeCompare(a.filename));
      return sorted;
    }
    if (sortBy === 'size') {
      sorted.sort((a, b) => b.size - a.size);
      return sorted;
    }
    if (sortBy === 'size-asc') {
      sorted.sort((a, b) => a.size - b.size);
      return sorted;
    }
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      return sorted;
    }
    sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  });

  const activeMount = $derived.by(() => mounts.find((mount) => mount.id === activeMountId) ?? null);
  const showFilesWorkspace = $derived.by(() => activeMount?.showFilesPane ?? true);
  const showChatWorkspace = $derived.by(() => activeMount?.showChatPane ?? false);
  const workspaceSplit = $derived.by(() => activeMount?.workspaceSplit ?? 56);
  const showSplitWorkspace = $derived.by(() => showFilesWorkspace && showChatWorkspace);
  const workspacePanelsTemplate = $derived.by(() =>
    showSplitWorkspace ? `minmax(0, 1fr) 14px minmax(320px, ${100 - workspaceSplit}%)` : '1fr'
  );
  const fileManagerTemplate = $derived.by(
    () => (showPreviewPane ? `minmax(300px, ${fileManagerSplit}%) 14px minmax(360px, 1fr)` : '1fr')
  );

  const selectedFiles = $derived.by(() =>
    visibleFiles.filter((file) => selectedFileNames.includes(file.filename))
  );

  const selectedFile = $derived.by(
    () => visibleFiles.find((file) => file.filename === selectedFileName) ?? null
  );
  const currentPreviewFile = $derived.by(() => previewFileOverride ?? selectedFile);
  const currentMountedVolumePresentation = $derived.by<MountedVolumePresentation | null>(() => {
    if (!activeMount || !volumeId) {
      return null;
    }
    return {
      volumeId,
      label: mountLabel(activeMount),
      filePayload: activeMount.secretFilePayload,
      fileMimeType: activeMount.secretFileMimeType,
      fileName: activeMount.secretFileName,
    };
  });

  function stopTimelinePlayback() {
    if (timelinePlayTimer) {
      clearInterval(timelinePlayTimer);
      timelinePlayTimer = null;
    }
    isTimelinePlaying = false;
  }

  function fileAccentTone(file: FileMetadata): string {
    const mime = (file.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return 'tone-image';
    if (mime.startsWith('video/')) return 'tone-video';
    if (mime.startsWith('audio/')) return 'tone-audio';
    if (mime.includes('pdf') || mime.startsWith('text/')) return 'tone-text';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return 'tone-archive';
    return 'tone-default';
  }

  function fileIconComponent(file: FileMetadata) {
    const mime = (file.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return ImageIcon;
    if (mime.startsWith('video/')) return FileVideo;
    if (mime.startsWith('audio/')) return FileAudio;
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime.includes('typescript')) {
      return FileCode2;
    }
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return FileArchive;
    if (mime.includes('pdf')) return FileText;
    return File;
  }

  function formatRelativeDay(value: number): string {
    const diffMs = Date.now() - value;
    const dayMs = 24 * 60 * 60 * 1000;
    if (diffMs < dayMs) return 'Today';
    if (diffMs < dayMs * 2) return 'Yesterday';
    const days = Math.floor(diffMs / dayMs);
    if (days < 7) return `${days}d ago`;
    return formatShortDate(value);
  }

  function isFileSelected(filename: string): boolean {
    return selectedFileNames.includes(filename);
  }

  function fileBaseName(filename: string): string {
    return filename.split('/').filter(Boolean).at(-1) ?? filename;
  }

  function fileParentPath(filename: string): string {
    return filename.split('/').filter(Boolean).slice(0, -1).join('/');
  }

  function renameDestination(file: FileMetadata, nextBaseName: string): string {
    const parent = fileParentPath(file.filename);
    return parent ? `${parent}/${nextBaseName}` : nextBaseName;
  }

  function startFileManagerResize(event: PointerEvent) {
    const container = fileManagerElement;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const minLeft = 300;
    const minRight = 360;

    const updateSplit = (clientX: number) => {
      const clamped = Math.min(rect.width - minRight, Math.max(minLeft, clientX - rect.left));
      fileManagerSplit = Math.max(28, Math.min(62, (clamped / rect.width) * 100));
    };

    updateSplit(event.clientX);

    const onMove = (moveEvent: PointerEvent) => updateSplit(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function startWorkspaceResize(event: PointerEvent) {
    const container = workspacePanelsElement;
    if (!container || !showSplitWorkspace) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const minLeft = 360;
    const minRight = 320;

    const updateSplit = (clientX: number) => {
      const clamped = Math.min(rect.width - minRight, Math.max(minLeft, clientX - rect.left));
      updateActiveMountWorkspace({
        workspaceSplit: Math.max(34, Math.min(66, (clamped / rect.width) * 100)),
      });
    };

    updateSplit(event.clientX);

    const onMove = (moveEvent: PointerEvent) => updateSplit(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function delayReject<T>(ms: number, message: string): Promise<T> {
    return new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([promise, delayReject<T>(ms, message)]);
  }

  function setTimelinePosition(next: number) {
    const max = timelineEvents.length;
    const clamped = Math.max(0, Math.min(next, max));
    timelinePosition = clamped;
  }

  function jumpToLatest() {
    stopTimelinePlayback();
    setTimelinePosition(timelineEvents.length);
  }

  function jumpToEvent(index: number) {
    stopTimelinePlayback();
    setTimelinePosition(index + 1);
  }

  function toggleTimelinePlayback() {
    if (timelineEvents.length === 0) return;
    if (isTimelinePlaying) {
      stopTimelinePlayback();
      return;
    }
    if (timelinePosition >= timelineEvents.length) {
      timelinePosition = 0;
    }
    isTimelinePlaying = true;
    timelinePlayTimer = setInterval(() => {
      if (timelinePosition >= timelineEvents.length) {
        stopTimelinePlayback();
        return;
      }
      timelinePosition += 1;
      if (timelinePosition >= timelineEvents.length) {
        stopTimelinePlayback();
      }
    }, 700);
  }

  async function refreshTimeline(keepPosition = true) {
    if (!auth) {
      timelineEvents = [];
      timelinePosition = 0;
      return;
    }

    const previousLength = timelineEvents.length;
    const previousPosition = timelinePosition;
    const wasAtLatest = previousPosition >= previousLength;
    isTimelineLoading = true;

    try {
      const response = await getTimeline(auth);
      timelineEvents = response.events;
      const latest = response.events.length;
      if (!keepPosition || wasAtLatest) {
        timelinePosition = latest;
      } else {
        timelinePosition = Math.min(previousPosition, latest);
      }
    } catch (error) {
      timelineEvents = [];
      timelinePosition = 0;
      errorMessage = error instanceof Error ? error.message : 'Failed to load timeline';
    } finally {
      isTimelineLoading = false;
    }
  }

  $effect(() => {
    return () => {
      stopTimelinePlayback();
    };
  });

  function stopVolumeWatch() {
    if (watchDisconnect) {
      watchDisconnect();
      watchDisconnect = null;
    }
    if (autoRefreshTimer) {
      clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    autoSyncEnabled = false;
    autoSyncStatus = 'idle';
  }

  function scheduleAutoRefresh() {
    if (autoRefreshTimer) {
      return;
    }
    autoRefreshTimer = setTimeout(() => {
      autoRefreshTimer = null;
      void refreshFiles();
    }, 260);
  }

  $effect(() => {
    const currentAuth = auth;
    const currentVolumeId = volumeId;
    watchConnectionSerial += 1;
    const serial = watchConnectionSerial;
    stopVolumeWatch();

    if (!currentAuth || !currentVolumeId) {
      return;
    }

    autoSyncStatus = 'connecting';
    const connection = watchVolume(currentAuth, {
      onReady: (event) => {
        if (serial !== watchConnectionSerial || event.volumeId !== currentVolumeId) {
          return;
        }
        autoSyncEnabled = event.autoUpdate;
        autoSyncStatus = event.autoUpdate ? 'active' : 'unsupported';
      },
      onUpdate: (event) => {
        if (serial !== watchConnectionSerial || event.volumeId !== currentVolumeId) {
          return;
        }
        scheduleAutoRefresh();
      },
      onError: () => {
        if (serial !== watchConnectionSerial) {
          return;
        }
        autoSyncEnabled = false;
        autoSyncStatus = 'error';
      },
      onClose: () => {
        if (serial !== watchConnectionSerial) {
          return;
        }
        if (autoSyncStatus === 'connecting' || autoSyncStatus === 'active') {
          autoSyncEnabled = false;
          autoSyncStatus = 'error';
        }
      },
    });
    watchDisconnect = () => {
      connection.close();
    };

    return () => {
      connection.close();
      if (watchDisconnect) {
        watchDisconnect = null;
      }
    };
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    const openSecret = currentMount ? buildMountSecret(currentMount) : '';
    const openLabel = currentMount ? mountLabel(currentMount) : '';
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!currentMount || openSecret === '') {
      stopTimelinePlayback();
      isVolumeTransitioning = false;
      effectiveSecret = '';
      unlockedAddress = '';
      fileList = [];
      volumeId = null;
      auth = null;
      lastRefresh = null;
      isOffline = false;
      isLoading = false;
      isTimelineLoading = false;
      timelineEvents = [];
      timelinePosition = 0;
      searchQuery = '';
      selectedFileName = null;
      previewKind = 'none';
      previewText = '';
      previewError = '';
      previewLoading = false;
      previewFileOverride = null;
      previewBlobCache.clear();
      revokePreviewUrl();
      pendingMountId = null;
      return;
    }
    if (
      auth &&
      effectiveSecret !== '' &&
      openSecret === effectiveSecret &&
      openLabel === unlockedAddress
    ) {
      isVolumeTransitioning = false;
      return;
    }
    isVolumeTransitioning = true;
    debounceTimer = setTimeout(() => {
      tryOpenSecret(openSecret, openLabel, currentMount.id);
      debounceTimer = null;
    }, 500);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  async function tryOpenSecret(openSecret: string, label: string, requestedMountId: string) {
    if (!openSecret) return;
    const serial = ++volumeOpenSerial;
    isLoading = true;
    errorMessage = '';
    isOffline = false;
    try {
      const response = await withTimeout(
        openVolume(openSecret),
        12000,
        'Opening this volume timed out. Check the storage roots and try again.'
      );
      const authResult = response.token
        ? { type: 'token' as const, token: response.token }
        : { type: 'secret' as const, secret: openSecret };
      if (serial !== volumeOpenSerial || activeMountId !== requestedMountId) {
        return;
      }
      if (response.token) {
        sessionStorage.setItem('nearbytes-token', response.token);
      } else {
        sessionStorage.removeItem('nearbytes-token');
      }
      auth = authResult;
      volumeId = response.volumeId;
      mounts = mounts.map((mount) =>
        mount.id === requestedMountId ? { ...mount, volumeId: response.volumeId } : mount
      );
      lastRefresh = Date.now();
      errorMessage = response.storageHint ?? '';
      effectiveSecret = openSecret;
      unlockedAddress = label;
      fileList = response.files;
      previewFileOverride = null;
      previewBlobCache.clear();
      isVolumeTransitioning = false;
      pendingMountId = null;
      void setCachedFiles(response.volumeId, response.files).catch((error) => {
        console.warn('Failed to cache volume file list:', error);
      });
      void refreshTimeline(false).catch((error) => {
        if (serial !== volumeOpenSerial || activeMountId !== requestedMountId) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load timeline';
        if (!errorMessage) {
          errorMessage = message;
        }
      });
    } catch (error) {
      if (serial !== volumeOpenSerial || activeMountId !== requestedMountId) {
        return;
      }
      if (volumeId) {
        const cached = await getCachedFiles(volumeId);
        if (cached) {
          fileList = cached;
          isOffline = true;
          errorMessage = 'Using cached data. Backend unavailable.';
        } else {
          errorMessage = error instanceof Error ? error.message : 'Failed to load volume';
          fileList = [];
        }
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to load volume';
        fileList = [];
      }
      timelineEvents = [];
      timelinePosition = 0;
    } finally {
      if (serial === volumeOpenSerial) {
        isLoading = false;
      }
      if (serial === volumeOpenSerial && activeMountId === requestedMountId) {
        isVolumeTransitioning = false;
      }
      if (serial === volumeOpenSerial && pendingMountId === requestedMountId) {
        pendingMountId = null;
      }
    }
  }

  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    const currentSecret = currentMount ? buildMountSecret(currentMount) : '';
    const currentLabel = currentMount ? mountLabel(currentMount) : '';
    if (currentSecret !== '' && (currentSecret !== effectiveSecret || currentLabel !== unlockedAddress) && effectiveSecret !== '') {
      stopTimelinePlayback();
      isVolumeTransitioning = true;
      effectiveSecret = '';
      unlockedAddress = '';
      auth = null;
      volumeId = null;
      lastRefresh = null;
      selectedFileName = null;
      previewKind = 'none';
      previewText = '';
      previewError = '';
      previewLoading = false;
      previewFileOverride = null;
      previewBlobCache.clear();
      revokePreviewUrl();
    }
  });

  function mountLabel(mount: VolumeMount): string {
    return mountDisplayLabel(mount);
  }

  function isMountEmpty(mount: VolumeMount): boolean {
    return trimSecretPart(mount.address) === '' && trimSecretPart(mount.password) === '' && !hasFileSecret(mount);
  }

  function addMount() {
    const nextMount = createMount();
    const collapsedExisting = mounts.map((mount) => ({ ...mount, collapsed: true }));
    mounts = [...collapsedExisting, nextMount];
    activeMountId = nextMount.id;
    pendingMountId = null;
    secretPasteTargetMountId = nextMount.id;
    void tick().then(() => {
      const input = document.querySelector<HTMLInputElement>(
        `.volume-chip.expanded[data-mount-id="${nextMount.id}"] .secret-input`
      );
      input?.focus();
    });
  }

  function selectMount(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target) return;
    if (isMountEmpty(target)) {
      removeMount(mountId);
      return;
    }
    pendingMountId = mountId;
    secretPasteTargetMountId = null;
    mounts = mounts.map((mount) => ({ ...mount, collapsed: true }));
    activeMountId = mountId;
  }

  function reopenMount(mountId: string) {
    pendingMountId = null;
    secretPasteTargetMountId = mountId;
    mounts = mounts.map((mount) =>
      mount.id === mountId ? { ...mount, collapsed: false } : { ...mount, collapsed: true }
    );
    activeMountId = mountId;
  }

  function collapseMount(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target) return;
    if (isMountEmpty(target)) {
      removeMount(mountId);
      return;
    }
    if (pendingMountId === mountId) {
      pendingMountId = null;
    }
    if (secretPasteTargetMountId === mountId) {
      secretPasteTargetMountId = null;
    }
    mounts = mounts.map((mount) =>
      mount.id === mountId ? { ...mount, collapsed: true } : mount
    );
  }

  function removeMount(mountId: string) {
    if (pendingMountId === mountId) {
      pendingMountId = null;
    }
    if (secretPasteTargetMountId === mountId) {
      secretPasteTargetMountId = null;
    }
    const next = mounts.filter((mount) => mount.id !== mountId);
    mounts = next;
    if (activeMountId !== mountId) return;
    const fallback = next[0];
    if (fallback) {
      activeMountId = fallback.id;
    } else {
      activeMountId = '';
      address = '';
      addressPassword = '';
    }
  }

  function handleChipClick(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target || !target.collapsed) {
      return;
    }
    selectMount(mountId);
  }

  function collapseExpandedMountFromOutside(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      if (activeMountId) {
        const activeMount = mounts.find((mount) => mount.id === activeMountId);
        if (activeMount && !activeMount.collapsed) {
          collapseMount(activeMountId);
        }
      }
      return;
    }

    if (!activeMountId) return;
    const activeMount = mounts.find((mount) => mount.id === activeMountId);
    if (!activeMount || activeMount.collapsed) return;
    if (target.closest('.volume-chip.expanded')) {
      return;
    }
    collapseMount(activeMountId);
  }

  function updateMountAddress(mountId: string, value: string) {
    const trimmedValue = trimSecretPart(value);
    const next = mounts.map((mount) =>
      mount.id === mountId
        ? {
            ...mount,
            address: trimmedValue,
            secretFilePayload: '',
            secretFileName: '',
            secretFileMimeType: '',
            volumeId: undefined,
          }
        : mount
    );
    mounts = next;
    if (mountId === activeMountId) {
      address = trimmedValue;
    }
  }

  function updateMountPassword(mountId: string, value: string) {
    const trimmedValue = trimSecretPart(value);
    const next = mounts.map((mount) =>
      mount.id === mountId
        ? {
            ...mount,
            password: trimmedValue,
            secretFilePayload: '',
            secretFileName: '',
            secretFileMimeType: '',
            volumeId: undefined,
          }
        : mount
    );
    mounts = next;
    if (mountId === activeMountId) {
      addressPassword = trimmedValue;
    }
  }

  async function applySecretFileToMount(file: File, mountId: string) {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const payload = buildFileSecretPayload(fileBytes);
    const label = trimSecretPart(file.name) || 'secret-file';

    mounts = mounts.map((mount) =>
      mount.id === mountId
        ? {
            ...mount,
            address: label,
            password: '',
            secretFilePayload: payload,
            secretFileName: label,
            secretFileMimeType: trimSecretPart(file.type),
            volumeId: undefined,
            collapsed: false,
          }
        : { ...mount, collapsed: true }
    );
    activeMountId = mountId;
    address = label;
    addressPassword = '';
    pendingMountId = mountId;
    secretPasteTargetMountId = null;
  }

  function mountIdFromDropTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const mountNode = target.closest<HTMLElement>('[data-mount-id]');
    return mountNode?.dataset.mountId ?? null;
  }

  function createCollapsedMount(): string {
    const nextMount = createMount();
    const collapsedExisting = mounts.map((mount) => ({ ...mount, collapsed: true }));
    mounts = [...collapsedExisting, nextMount];
    activeMountId = nextMount.id;
    return nextMount.id;
  }

  function prepareMountForSecretDrop(target: EventTarget | null, preferNewMount = false): string {
    const explicitTargetId = mountIdFromDropTarget(target);
    if (explicitTargetId && mounts.some((mount) => mount.id === explicitTargetId)) {
      return explicitTargetId;
    }

    if (preferNewMount) {
      return createCollapsedMount();
    }

    const expandedActiveMount = mounts.find(
      (mount) => mount.id === activeMountId && !mount.collapsed
    );
    if (expandedActiveMount) {
      return expandedActiveMount.id;
    }

    return createCollapsedMount();
  }

  async function handleSecretFileDrop(event: DragEvent) {
    if (event.dataTransfer?.types.includes(NEARBYTES_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    isSecretDropTarget = false;
    const file = (await filesFromTransfer(event.dataTransfer))[0];
    if (!file) return;

    try {
      errorMessage = '';
      const targetMountId = prepareMountForSecretDrop(event.target, true);
      await applySecretFileToMount(file, targetMountId);
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Failed to use secret file');
      pendingMountId = null;
    }
  }

  async function handlePasteImageButton(mountId: string) {
    clipboardImageLoading = true;
    try {
      errorMessage = '';
      const file = await fileFromClipboardImage();
      if (!file) {
        clipboardImageAvailable = false;
        errorMessage = 'Clipboard does not contain an image.';
        return;
      }
      secretPasteTargetMountId = mountId;
      await applySecretFileToMount(file, mountId);
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Failed to use clipboard image as secret');
    } finally {
      clipboardImageLoading = false;
    }
  }

  function toggleVolumeStoragePanel() {
    showVolumeStoragePanel = !showVolumeStoragePanel;
    if (showVolumeStoragePanel) {
      showSourcesPanel = false;
    }
  }

  function toggleSourcesPanel() {
    showSourcesPanel = !showSourcesPanel;
    if (showSourcesPanel) {
      showVolumeStoragePanel = false;
    }
  }

  $effect(() => {
    if (visibleFiles.length === 0) {
      selectedFileName = null;
      selectedFileNames = [];
      selectionAnchorFileName = null;
      renamingFileName = null;
      if (!previewFileOverride) {
        showPreviewPane = false;
      }
      return;
    }
    const visibleFileNames = new Set(visibleFiles.map((file) => file.filename));
    const nextSelected = selectedFileNames.filter((filename) => visibleFileNames.has(filename));
    if (nextSelected.length !== selectedFileNames.length) {
      selectedFileNames = nextSelected;
    }
    if (selectionAnchorFileName && !visibleFileNames.has(selectionAnchorFileName)) {
      selectionAnchorFileName = nextSelected[0] ?? null;
    }
    if (!selectedFileName || !visibleFileNames.has(selectedFileName)) {
      selectedFileName = nextSelected[0] ?? null;
    }
    if (renamingFileName && !visibleFileNames.has(renamingFileName)) {
      renamingFileName = null;
      renameDraft = '';
    }
    if (nextSelected.length === 0 && renamingFileName) {
      renamingFileName = null;
      renameDraft = '';
    }
    if ((nextSelected[0] ?? null) === null && selectedFileName === null && !previewFileOverride) {
      showPreviewPane = false;
    }
  });

  function revokePreviewUrl() {
    if (currentPreviewObjectUrl) {
      URL.revokeObjectURL(currentPreviewObjectUrl);
      currentPreviewObjectUrl = null;
    }
    previewUrl = '';
  }

  function detectPreviewKind(file: FileMetadata): PreviewKind {
    const mime = file.mimeType ?? '';
    const filename = file.filename.toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.includes('pdf')) return 'pdf';
    if (
      mime.startsWith('text/') ||
      mime.includes('json') ||
      mime.includes('xml') ||
      mime.includes('javascript')
    ) {
      return 'text';
    }
    if (mime === '' || mime === 'application/octet-stream') {
      if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(filename)) return 'image';
      if (/\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(filename)) return 'video';
      if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(filename)) return 'audio';
      if (/\.pdf$/i.test(filename)) return 'pdf';
      if (/\.(txt|md|json|xml|csv|log|yaml|yml|js|ts|css|html)$/i.test(filename)) return 'text';
    }
    return 'unsupported';
  }

  $effect(() => {
    let cancelled = false;
    const file = currentPreviewFile;

    previewError = '';
    previewText = '';
    previewLoading = false;
    revokePreviewUrl();

    if (!showPreviewPane || !file || !auth) {
      previewKind = 'none';
      return;
    }

    const kind = detectPreviewKind(file);
    previewKind = kind;
    if (kind === 'unsupported') {
      return;
    }

    previewLoading = true;
    (async () => {
      try {
        let blob = previewBlobCache.get(file.blobHash);
        if (!blob) {
          blob = await downloadFile(auth, file.blobHash);
          previewBlobCache.set(file.blobHash, blob);
        }
        if (cancelled) return;
        if (kind === 'text') {
          const raw = await blob.text();
          if (cancelled) return;
          const textLimit = 24000;
          previewText = raw.length > textLimit ? `${raw.slice(0, textLimit)}\n\n...truncated` : raw;
        } else {
          const objectUrl = URL.createObjectURL(blob);
          currentPreviewObjectUrl = objectUrl;
          previewUrl = objectUrl;
        }
      } catch (error) {
        if (!cancelled) {
          previewError = error instanceof Error ? error.message : 'Unable to load preview';
        }
      } finally {
        if (!cancelled) {
          previewLoading = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  function setSelection(nextSelection: string[], activeFileName: string | null, anchorFileName: string | null) {
    selectedFileNames = nextSelection;
    selectedFileName = activeFileName;
    selectionAnchorFileName = anchorFileName;
  }

  function clearSelection() {
    setSelection([], null, null);
    renamingFileName = null;
    renameDraft = '';
  }

  function selectFile(
    file: FileMetadata,
    options: {
      toggle?: boolean;
      range?: boolean;
      additiveRange?: boolean;
    } = {}
  ) {
    const targetFileName = file.filename;
    const visibleFileNames = new Set(visibleFiles.map((item) => item.filename));
    const targetIndex = visibleFiles.findIndex((item) => item.filename === targetFileName);
    const anchorFileName =
      selectionAnchorFileName && visibleFileNames.has(selectionAnchorFileName)
        ? selectionAnchorFileName
        : selectedFileName && visibleFileNames.has(selectedFileName)
          ? selectedFileName
          : targetFileName;

    if (options.range && targetIndex >= 0) {
      const anchorIndex = visibleFiles.findIndex((item) => item.filename === anchorFileName);
      const start = Math.min(anchorIndex >= 0 ? anchorIndex : targetIndex, targetIndex);
      const end = Math.max(anchorIndex >= 0 ? anchorIndex : targetIndex, targetIndex);
      const rangeSelection = visibleFiles.slice(start, end + 1).map((item) => item.filename);
      const nextSelection = options.additiveRange
        ? Array.from(new Set([...selectedFileNames, ...rangeSelection]))
        : rangeSelection;
      setSelection(nextSelection, targetFileName, anchorFileName);
      renamingFileName = null;
      renameDraft = '';
      return;
    }

    if (options.toggle) {
      const nextSelection = isFileSelected(targetFileName)
        ? selectedFileNames.filter((filename) => filename !== targetFileName)
        : [...selectedFileNames, targetFileName];
      setSelection(
        nextSelection,
        nextSelection.includes(targetFileName) ? targetFileName : (nextSelection.at(-1) ?? null),
        targetFileName
      );
      renamingFileName = null;
      renameDraft = '';
      return;
    }

    setSelection([targetFileName], targetFileName, targetFileName);
    renamingFileName = null;
    renameDraft = '';
  }

  function openPreviewPane(file?: FileMetadata) {
    previewFileOverride = null;
    if (file) {
      if (!isFileSelected(file.filename)) {
        setSelection([file.filename], file.filename, file.filename);
      } else {
        selectedFileName = file.filename;
      }
    }
    if (selectedFileName) {
      showPreviewPane = true;
    }
  }

  function closePreviewPane() {
    previewFileOverride = null;
    showPreviewPane = false;
  }

  function previewChatAttachment(attachment: ChatAttachment) {
    const existingFile =
      visibleFiles.find((file) => file.filename === attachment.name && file.blobHash === attachment.ref.c.h) ??
      visibleFiles.find((file) => file.blobHash === attachment.ref.c.h) ??
      null;
    if (existingFile) {
      openPreviewPane(existingFile);
      return;
    }

    if (activeMount && !activeMount.showFilesPane) {
      updateActiveMountWorkspace({
        showFilesPane: true,
        showChatPane: activeMount.showChatPane,
      });
    }

    previewFileOverride = {
      filename: attachment.name,
      blobHash: attachment.ref.c.h,
      size: attachment.ref.c.z,
      mimeType: attachment.mime ?? '',
      createdAt: attachment.createdAt ?? Date.now(),
    };
    showPreviewPane = true;
  }

  function updateActiveMountWorkspace(
    patch: Partial<Pick<VolumeMount, 'showFilesPane' | 'showChatPane' | 'workspaceSplit'>>
  ) {
    if (!activeMountId) {
      return;
    }
    mounts = mounts.map((mount) =>
      mount.id === activeMountId
        ? createMount({
            ...mount,
            ...patch,
          })
        : mount
    );
  }

  function toggleWorkspacePane(pane: 'files' | 'chat') {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (!currentMount) {
      return;
    }
    const nextShowFiles = pane === 'files' ? !currentMount.showFilesPane : currentMount.showFilesPane;
    const nextShowChat = pane === 'chat' ? !currentMount.showChatPane : currentMount.showChatPane;
    if (!nextShowFiles && !nextShowChat) {
      return;
    }

    updateActiveMountWorkspace({
      showFilesPane: nextShowFiles,
      showChatPane: nextShowChat,
    });

    if (!nextShowFiles) {
      showPreviewPane = false;
      renamingFileName = null;
      renameDraft = '';
      fileManagerActive = false;
    }
    if (!nextShowChat) {
      showIdentityManager = false;
    }
  }

  function addConfiguredChatIdentity() {
    const next = createConfiguredIdentity();
    configuredIdentities = [...configuredIdentities, next];
    activeChatIdentityId = next.id;
    showIdentityManager = true;
    identityManagerError = '';
    identityManagerMessage = '';
  }

  function updateConfiguredChatIdentity(identityId: string, patch: Partial<ConfiguredIdentity>) {
    let secretChanged = false;
    configuredIdentities = configuredIdentities.map((identity) => {
      if (identity.id !== identityId) {
        return identity;
      }

      const nextAddress =
        typeof patch.address === 'string' ? patch.address.trim() : identity.address;
      const nextPassword =
        typeof patch.password === 'string' ? patch.password.trim() : identity.password;
      secretChanged = nextAddress !== identity.address || nextPassword !== identity.password;

      return createConfiguredIdentity({
        ...identity,
        ...patch,
        publicKey: secretChanged ? undefined : patch.publicKey ?? identity.publicKey,
      });
    });

    if (secretChanged) {
      const nextAssignments = Object.fromEntries(
        Object.entries(volumeChatIdentityAssignments).filter(
          ([, assignedIdentityId]) => assignedIdentityId !== identityId
        )
      );
      if (Object.keys(nextAssignments).length !== Object.keys(volumeChatIdentityAssignments).length) {
        volumeChatIdentityAssignments = nextAssignments;
        identityManagerError = '';
        identityManagerMessage = 'Identity secret changed. Rejoin any volume chats explicitly.';
      }
    }
  }

  function removeConfiguredChatIdentity(identityId: string) {
    const nextIdentities = configuredIdentities.filter((identity) => identity.id !== identityId);
    configuredIdentities = nextIdentities;
    if (activeChatIdentityId === identityId) {
      activeChatIdentityId = nextIdentities[0]?.id ?? '';
    }
    identityManagerError = '';
    identityManagerMessage = '';
  }

  async function handleChatMutated() {
    await refreshTimeline();
    chatRefreshVersion += 1;
  }

  function openIdentityManagerForChat() {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (currentMount && !currentMount.showChatPane) {
      updateActiveMountWorkspace({
        showFilesPane: currentMount.showFilesPane,
        showChatPane: true,
      });
    }
    if (currentVolumeChatIdentityId) {
      activeChatIdentityId = currentVolumeChatIdentityId;
    }
    showIdentityManager = true;
  }

  async function publishSelectedChatIdentity(): Promise<ConfiguredIdentity | null> {
    if (!auth || !selectedChatIdentity) {
      identityManagerError = 'Choose an identity first.';
      identityManagerMessage = '';
      return null;
    }
    if (isHistoryMode) {
      identityManagerError = 'History mode is read-only. Jump to Latest before publishing.';
      identityManagerMessage = '';
      return null;
    }
    if (selectedChatIdentity.address.trim() === '') {
      identityManagerError = 'Identity secret is required.';
      identityManagerMessage = '';
      showIdentityManager = true;
      return null;
    }
    if (selectedChatIdentity.displayName.trim() === '') {
      identityManagerError = 'Display name is required before publishing.';
      identityManagerMessage = '';
      showIdentityManager = true;
      return null;
    }
    if (!selectedChatIdentityNeedsPublish && selectedChatIdentity.publicKey) {
      return selectedChatIdentity;
    }

    identityManagerLoading = true;
    identityManagerError = '';
    identityManagerMessage = '';
    try {
      const published = await publishIdentity(auth, buildIdentitySecret(selectedChatIdentity), {
        displayName: selectedChatIdentity.displayName.trim(),
        bio: selectedChatIdentity.bio.trim() || undefined,
      });
      updateConfiguredChatIdentity(selectedChatIdentity.id, {
        publicKey: published.published.authorPublicKey,
      });
      await handleChatMutated();
      identityManagerMessage = `Published ${selectedChatIdentity.displayName.trim()} to this volume.`;
      return {
        ...selectedChatIdentity,
        publicKey: published.published.authorPublicKey,
      };
    } catch (error) {
      identityManagerError = error instanceof Error ? error.message : 'Failed to publish identity';
      return null;
    } finally {
      identityManagerLoading = false;
    }
  }

  async function joinCurrentVolumeChat(): Promise<ConfiguredIdentity | null> {
    if (!auth || !volumeId) {
      identityManagerError = 'Open a volume before joining chat.';
      identityManagerMessage = '';
      return null;
    }
    if (!selectedChatIdentity) {
      identityManagerError = 'Choose an identity before joining this chat.';
      identityManagerMessage = '';
      showIdentityManager = true;
      return null;
    }
    if (isHistoryMode) {
      identityManagerError = 'History mode is read-only. Jump to Latest before joining chat.';
      identityManagerMessage = '';
      return null;
    }

    const publishedIdentity = await publishSelectedChatIdentity();
    if (!publishedIdentity) {
      return null;
    }

    volumeChatIdentityAssignments = {
      ...volumeChatIdentityAssignments,
      [volumeId]: publishedIdentity.id,
    };
    identityManagerError = '';
    identityManagerMessage = `Joined this volume as ${publishedIdentity.displayName.trim()}.`;
    return publishedIdentity;
  }

  function toggleColumnSort(column: 'name' | 'size' | 'date') {
    if (column === 'name') {
      sortBy = sortBy === 'name' ? 'name-desc' : 'name';
      return;
    }
    if (column === 'size') {
      sortBy = sortBy === 'size' ? 'size-asc' : 'size';
      return;
    }
    sortBy = sortBy === 'newest' ? 'oldest' : 'newest';
  }

  function columnSortState(column: 'name' | 'size' | 'date'): 'ascending' | 'descending' | 'none' {
    if (column === 'name') {
      if (sortBy === 'name') return 'ascending';
      if (sortBy === 'name-desc') return 'descending';
      return 'none';
    }
    if (column === 'size') {
      if (sortBy === 'size-asc') return 'ascending';
      if (sortBy === 'size') return 'descending';
      return 'none';
    }
    if (sortBy === 'oldest') return 'ascending';
    if (sortBy === 'newest') return 'descending';
    return 'none';
  }

  function handleManagerKeydown(event: KeyboardEvent) {
    const activeElement = document.activeElement;
    if (
      event.key === 'Escape' &&
      fileManagerElement &&
      activeElement instanceof Node &&
      fileManagerElement.contains(activeElement)
    ) {
      event.preventDefault();
      if (renamingFileName) {
        cancelRenaming();
        return;
      }
      if (showPreviewPane) {
        closePreviewPane();
      }
    }
  }

  function isFileManagerFocused(target: EventTarget | null): boolean {
    if (!fileManagerElement) {
      return false;
    }
    if (target instanceof Node && fileManagerElement.contains(target)) {
      return true;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof Node && fileManagerElement.contains(activeElement)) {
      return true;
    }
    return fileManagerActive;
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return (
      target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable="true"]') !== null
    );
  }

  function mountedSecretForVolumeId(targetVolumeId: string): string | null {
    const normalized = targetVolumeId.trim().toLowerCase();
    const mount = mounts.find(
      (candidate) =>
        candidate.volumeId?.trim().toLowerCase() === normalized && buildMountSecret(candidate).trim() !== ''
    );
    return mount ? buildMountSecret(mount) : null;
  }

  async function importNearbytesBundleIntoCurrentVolume(bundle: SourceReferenceBundle) {
    if (!auth || !effectiveSecret) {
      throw new Error('Open a destination volume before pasting.');
    }
    if (isHistoryMode) {
      throw new Error('History mode is read-only. Jump to Latest before pasting.');
    }

    errorMessage = '';
    await importMountedSourceReferenceBundle(auth, bundle, mountedSecretForVolumeId);
    await refreshFiles();
  }

  async function copySelectedFilesToClipboard() {
    if (!auth || !effectiveSecret) {
      return;
    }
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before copying.';
      return;
    }
    if (selectedFiles.length === 0) {
      return;
    }

    errorMessage = '';
    const exported = await exportSourceReferences(
      auth,
      selectedFiles.map((file) => file.filename)
    );
    appReferenceClipboard = {
      bundle: exported.bundle,
      itemCount: exported.bundle.items.length,
    };
    await writeNearbytesClipboardPayload(exported.serialized);
  }

  async function pasteCopiedFiles() {
    if (!appReferenceClipboard) {
      return;
    }
    await importNearbytesBundleIntoCurrentVolume(appReferenceClipboard.bundle);
  }

  async function openFileInViewer(file: FileMetadata) {
    if (!auth) return;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    try {
      errorMessage = '';
      const blob = await downloadFile(auth, file.blobHash);
      const viewUrl = URL.createObjectURL(blob);
      if (popup) {
        popup.location.href = viewUrl;
      } else {
        const a = document.createElement('a');
        a.href = viewUrl;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(viewUrl), 60000);
    } catch (error) {
      if (popup) {
        popup.close();
      }
      errorMessage = error instanceof Error ? error.message : 'Open failed';
    }
  }

  function handleFileRowKeydown(e: KeyboardEvent, file: FileMetadata) {
    if (e.key === 'Enter') {
      e.preventDefault();
      openPreviewPane(file);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      selectFile(file);
    }
  }

  function handleFilePointerSelect(event: MouseEvent, file: FileMetadata) {
    selectFile(file, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      additiveRange: event.shiftKey && (event.metaKey || event.ctrlKey),
    });
  }

  function startRenaming(file: FileMetadata) {
    if (!auth || isHistoryMode) {
      return;
    }
    setSelection([file.filename], file.filename, file.filename);
    renamingFileName = file.filename;
    renameDraft = fileBaseName(file.filename);
    renamePending = false;
  }

  function cancelRenaming() {
    renamingFileName = null;
    renameDraft = '';
    renamePending = false;
  }

  async function commitRename(file: FileMetadata) {
    if (renamePending || renamingFileName !== file.filename) {
      return;
    }
    if (!auth || isHistoryMode) {
      cancelRenaming();
      return;
    }
    const nextBaseName = renameDraft.trim();
    if (nextBaseName === '') {
      errorMessage = 'File name cannot be empty.';
      return;
    }
    if (nextBaseName.includes('/')) {
      errorMessage = 'Rename only changes the file name, not the path.';
      return;
    }
    const nextFilename = renameDestination(file, nextBaseName);
    if (nextFilename === file.filename) {
      cancelRenaming();
      return;
    }

    try {
      renamePending = true;
      errorMessage = '';
      await renameFile(auth, file.filename, nextFilename);
      cancelRenaming();
      await refreshFiles();
      const renamed = fileList.find((entry) => entry.filename === nextFilename) ?? null;
      if (renamed) {
        setSelection([renamed.filename], renamed.filename, renamed.filename);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Rename failed';
    } finally {
      renamePending = false;
    }
  }

  function displayFileName(file: FileMetadata): string {
    return file.filename.split('/').filter(Boolean).at(-1) ?? file.filename;
  }

  // Refresh file list
  async function refreshFiles() {
    if (!auth || !volumeId || isRefreshing) return;
    isRefreshing = true;

    try {
      const response = await listFiles(auth);
      fileList = response.files;
      lastRefresh = Date.now();
      isOffline = false;
      errorMessage = '';

      // Update cache
      await setCachedFiles(volumeId, response.files);
      await refreshTimeline(true);
      chatRefreshVersion += 1;
    } catch (error) {
      // Try cached data
      const cached = await getCachedFiles(volumeId);
      if (cached) {
        fileList = cached;
        isOffline = true;
        errorMessage = 'Using cached data. Backend unavailable.';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to refresh';
      }
    } finally {
      isRefreshing = false;
    }
  }

  // Drag and drop handlers
  function handleDragOver(e: DragEvent) {
    if (!canHandleDropPayload(e.dataTransfer)) return;
    e.preventDefault();
    isDragging = true;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before uploading.';
      return;
    }

    try {
      errorMessage = '';
      if (e.dataTransfer?.types.includes(NEARBYTES_DRAG_TYPE)) {
        if (!auth || !effectiveSecret) {
          throw new Error('Open a destination volume before pasting.');
        }
        const bundle = await exportSourceReferenceBundleFromDrag(
          auth,
          e.dataTransfer.getData(NEARBYTES_DRAG_TYPE)
        );
        await importNearbytesBundleIntoCurrentVolume(bundle);
        return;
      }

      const sourceBundle = parseSourceReferenceBundleText(e.dataTransfer?.getData('text/plain') ?? '');
      if (sourceBundle) {
        await importNearbytesBundleIntoCurrentVolume(sourceBundle);
        return;
      }

      if (!auth || !effectiveSecret) {
        errorMessage = 'Enter address and optional password first';
        return;
      }
      const files = await filesFromTransfer(e.dataTransfer);
      if (files.length === 0) return;
      await uploadFiles(auth, files);
      await refreshFiles();
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Upload failed');
      console.error('Error uploading files:', error);
    }
  }

  function shouldRoutePasteToSecret(target: EventTarget | null): boolean {
    if (secretPasteTargetMountId && mounts.some((mount) => mount.id === secretPasteTargetMountId)) {
      return true;
    }

    const expandedActiveMount = mounts.find(
      (mount) => mount.id === activeMountId && !mount.collapsed
    );
    if (!expandedActiveMount) {
      return false;
    }

    if (!(target instanceof Element)) {
      return true;
    }

    return target.closest('.header-shell') !== null;
  }

  function handleNearbytesFileDragStart(event: DragEvent, file: FileMetadata) {
    if (!event.dataTransfer) {
      return;
    }
    const payload = {
      filenames:
        selectedFileNames.includes(file.filename) && selectedFileNames.length > 1
          ? [...selectedFileNames]
          : [file.filename],
      primaryFilename: file.filename,
      mimeType: file.mimeType,
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(NEARBYTES_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', file.filename);
  }

  async function handlePaste(event: ClipboardEvent) {
    if (
      appReferenceClipboard &&
      isFileManagerFocused(event.target) &&
      !isEditableTarget(event.target)
    ) {
      event.preventDefault();
      try {
        await pasteCopiedFiles();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Paste import failed';
      }
      return;
    }

    const clipboardData = event.clipboardData;
    if (
      clipboardData &&
      isFileManagerFocused(event.target) &&
      !isEditableTarget(event.target)
    ) {
      const sourceBundle = parseSourceReferenceBundleText(clipboardData.getData('text/plain'));
      if (sourceBundle) {
        event.preventDefault();
        try {
          await importNearbytesBundleIntoCurrentVolume(sourceBundle);
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : 'Paste import failed';
        }
        return;
      }
    }
    if (!clipboardData || !canHandleDropPayload(clipboardData)) {
      return;
    }

    const localFiles = localFilesFromTransfer(clipboardData);
    const allowRemoteClipboardImport =
      transferTypes(clipboardData).includes('DownloadURL') ||
      /<img[\s>]/i.test(clipboardData.getData('text/html'));
    const files =
      localFiles.length > 0
        ? localFiles
        : allowRemoteClipboardImport
          ? await filesFromTransfer(clipboardData)
          : [];
    if (files.length === 0) {
      return;
    }

    if (shouldRoutePasteToSecret(event.target)) {
      event.preventDefault();
      try {
        errorMessage = '';
        const targetMountId =
          secretPasteTargetMountId && mounts.some((mount) => mount.id === secretPasteTargetMountId)
            ? secretPasteTargetMountId
            : prepareMountForSecretDrop(event.target);
        await applySecretFileToMount(files[0], targetMountId);
      } catch (error) {
        errorMessage = dropFailureMessage(error, 'Failed to use pasted file as secret');
        pendingMountId = null;
      }
      return;
    }

    if (!auth || !effectiveSecret) {
      return;
    }
    if (isHistoryMode) {
      event.preventDefault();
      errorMessage = 'History mode is read-only. Jump to Latest before uploading.';
      return;
    }

    event.preventDefault();
    try {
      errorMessage = '';
      await uploadFiles(auth, files);
      await refreshFiles();
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Paste upload failed');
      console.error('Error uploading pasted files:', error);
    }
  }

  // Delete file
  async function handleDelete(filename: string) {
    if (!auth) return;
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before deleting.';
      return;
    }

    try {
      errorMessage = '';
      await deleteFile(auth, filename);
      // Refresh file list
      await refreshFiles();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Delete failed';
      console.error('Error deleting file:', error);
    }
  }

  // Download file
  async function handleDownload(file: FileMetadata) {
    if (!auth) return;

    try {
      errorMessage = '';
      const blob = await downloadFile(auth, file.blobHash);
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('Error downloading file:', error);
    }
  }

  // Copy volumeId to clipboard
  async function copyVolumeId() {
    if (!volumeId) return;
    try {
      await navigator.clipboard.writeText(volumeId);
      copiedVolumeId = true;
      setTimeout(() => {
        copiedVolumeId = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy volumeId:', error);
    }
  }

  // Format file size
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Format date
  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function formatShortDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<svelte:window onkeydown={(e) => {
  if (e.key === 'Escape') {
    handleManagerKeydown(e);
    collapseMount(activeMountId);
  }
  if (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === 'c' &&
    isFileManagerFocused(e.target) &&
    selectedFiles.length > 0 &&
    !isEditableTarget(e.target)
  ) {
    e.preventDefault();
    void copySelectedFilesToClipboard().catch((error) => {
      errorMessage = error instanceof Error ? error.message : 'Copy failed';
    });
  }
  if (e.key === 'Delete' && e.target instanceof HTMLElement) {
    const fileItem = e.target.closest('[data-filename]');
    if (fileItem) {
      const filename = fileItem.getAttribute('data-filename');
      if (filename && auth) {
        handleDelete(filename);
      }
    }
  }
}} onpointerdown={(event) => {
  if (
    fileManagerElement &&
    (!(event.target instanceof Node) || !fileManagerElement.contains(event.target))
  ) {
    fileManagerActive = false;
  }
  collapseExpandedMountFromOutside(event.target);
}} onpaste={handlePaste} />

<div class="app">
  <header class="header">
    <div
      class="header-shell"
      class:secret-drop-target={isSecretDropTarget}
      role="group"
      aria-label="Volume controls"
      onmouseenter={() => {
        isHeaderHovering = true;
      }}
      onmouseleave={() => {
        isHeaderHovering = false;
      }}
      onfocusin={() => {
        isHeaderHovering = true;
      }}
      onfocusout={(event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
          return;
        }
        isHeaderHovering = false;
      }}
      ondragenter={(event) => {
        if (canHandleSecretDropPayload(event.dataTransfer)) {
          isSecretDropTarget = true;
        }
      }}
      ondragover={(event) => {
        if (!canHandleSecretDropPayload(event.dataTransfer)) return;
        event.preventDefault();
        isSecretDropTarget = true;
        event.dataTransfer.dropEffect = 'copy';
      }}
      ondragleave={(event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
          return;
        }
        isSecretDropTarget = false;
      }}
      ondrop={handleSecretFileDrop}
    >
      <div class="mounts-row">
        {#each mounts as mount (mount.id)}
          {@const expanded = mount.id === activeMountId && !mount.collapsed}
          {@const isPending = pendingMountId === mount.id}
          {#if expanded}
            <div class="volume-chip expanded" data-mount-id={mount.id}>
              <div class="header-dock">
                <div class="header-dock-main editing">
                  <div class="secret-input-wrapper in-dock">
                    <input
                      type="text"
                      value={mount.address}
                      class="secret-input"
                      aria-label="Volume address"
                      oninput={(event) =>
                        updateMountAddress(mount.id, (event.currentTarget as HTMLInputElement).value)}
                    />
                    <input
                      type="password"
                      value={mount.password}
                      class="secret-input password-input"
                      aria-label="Optional volume password"
                      autocomplete="current-password"
                      oninput={(event) =>
                        updateMountPassword(mount.id, (event.currentTarget as HTMLInputElement).value)}
                    />
                    {#if isLoading && mount.id === activeMountId}
                      <span class="loading-spinner"></span>
                    {/if}
                  </div>
                  <div class="secret-input-hint-row">
                    <p class="secret-input-hint">
                      Drop an image/file here, or press <kbd>Cmd/Ctrl</kbd> + <kbd>V</kbd>.
                    </p>
                    {#if clipboardImageAvailable || clipboardImageLoading}
                      <button
                        type="button"
                        class="workspace-toggle secret-clipboard-btn"
                        onclick={() => handlePasteImageButton(mount.id)}
                        disabled={clipboardImageLoading}
                      >
                        <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
                        <span>{clipboardImageLoading ? 'Reading…' : 'Paste Image'}</span>
                      </button>
                    {/if}
                  </div>
                </div>
                <button
                  type="button"
                  class="chip-collapse-btn"
                  onclick={() => collapseMount(mount.id)}
                  aria-label="Collapse"
                  title="Collapse"
                >
                  <X size={14} strokeWidth={2.1} />
                </button>
              </div>
              <div class="volume-chip-expanded expanded">
                {#if hasFileSecret(mount)}
                  {@const secretHash = secretFileHashForMount(mount)}
                  <div class="secret-file-card">
                    <div class="secret-file-card-preview" class:image={hasImageSecretPreview(mount)}>
                      {#if hasImageSecretPreview(mount) && secretFilePayloadDataUrl(mount)}
                        <img
                          class="secret-file-card-image"
                          src={secretFilePayloadDataUrl(mount) ?? ''}
                          alt={"Preview of " + (mount.secretFileName || 'secret file')}
                        />
                      {:else}
                        <span class="secret-file-card-icon" aria-hidden="true">
                          {#if trimSecretPart(mount.secretFileMimeType).startsWith('image/')}
                            <ImageIcon size={18} strokeWidth={2} />
                          {:else}
                            <FileText size={18} strokeWidth={2} />
                          {/if}
                        </span>
                      {/if}
                    </div>
                    <div class="secret-file-card-meta">
                      <p class="secret-file-card-name" title={mount.secretFileName || 'secret-file'}>
                        {mount.secretFileName || 'secret-file'}
                      </p>
                      <p class="secret-file-card-info">
                        {trimSecretPart(mount.secretFileMimeType) || 'application/octet-stream'}
                        {#if secretFileBytes(mount)}
                          {' • '}
                          {formatSize(secretFileBytes(mount)?.byteLength ?? 0)}
                        {/if}
                      </p>
                      <p class="secret-file-card-hash-label">SHA-256</p>
                      <p class="secret-file-card-hash" title={secretHash?.hash || 'Computing hash…'}>
                        {#if secretHash?.pending}
                          Computing…
                        {:else if secretHash?.hash}
                          {secretHash.hash}
                        {:else}
                          Unavailable
                        {/if}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="workspace-toggle secret-file-download"
                      onclick={() => downloadSecretFile(mount)}
                    >
                      <Download class="button-icon" size={15} strokeWidth={2} />
                      <span>Download</span>
                    </button>
                  </div>
                {/if}
                <div class="header-dock-actions">
                  <ArmedActionButton
                    class="panel-action-btn danger"
                    text="Remove"
                    icon={Trash2}
                    armed={true}
                    armDelayMs={0}
                    autoDisarmMs={3000}
                    resetKey={`${mount.id}:${mount.address}:${mount.password}:${expanded}`}
                    onPress={() => removeMount(mount.id)}
                    title="Remove volume"
                    ariaLabel="Remove volume"
                  />
                  <button
                    type="button"
                    class="workspace-toggle"
                    class:active={showVolumeStoragePanel}
                    onclick={(event) => {
                      event.stopPropagation();
                      toggleVolumeStoragePanel();
                    }}
                  >
                    <HardDrive class="button-icon" size={15} strokeWidth={2} />
                    <span>Keep</span>
                  </button>
                </div>
              </div>
            </div>
          {:else}
            <div
              class="volume-chip collapsed-shell parked"
              class:selected={mount.id === activeMountId && mount.collapsed}
              data-mount-id={mount.id}
            >
              <button
                type="button"
                class="volume-chip-select"
                aria-label={mountLabel(mount) || 'Volume entry'}
                onclick={() => handleChipClick(mount.id)}
              >
                <div class="header-dock">
                  <div class="header-dock-main">
                    <div class="header-dock-badge" class:loading={isPending}>
                      <div class="header-dock-badge-top">
                        <VolumeIdentity
                          compact={true}
                          label={mountLabel(mount)}
                          title={mountLabel(mount)}
                          filePayload={mount.secretFilePayload}
                          fileMimeType={mount.secretFileMimeType}
                          fileName={mount.secretFileName}
                        />
                      </div>
                      {#if isPending}
                        <span class="badge-meter" aria-hidden="true">
                          <span class="badge-meter-bar"></span>
                        </span>
                      {/if}
                    </div>
                  </div>
                </div>
              </button>
              <button
                type="button"
                class="volume-chip-config-btn"
                aria-label={`Edit ${mountLabel(mount) || 'volume'}`}
                title="Edit volume"
                onclick={(event) => {
                  event.stopPropagation();
                  reopenMount(mount.id);
                }}
              >
                <Settings2 size={14} strokeWidth={2} />
              </button>
            </div>
          {/if}
        {/each}
        <div
          class="mounts-actions"
          class:visible={
            isHeaderHovering ||
            isSecretDropTarget ||
            showStatusPanel ||
            showTimeMachinePanel ||
            showSourcesPanel ||
            showVolumeStoragePanel ||
            showIdentityManager
          }
        >
          <button
            type="button"
            class="header-tool-btn"
            class:active={showStatusPanel}
            aria-label="Status"
            title="Status"
            onclick={(event) => {
              event.stopPropagation();
              showStatusPanel = !showStatusPanel;
            }}
          >
            <Activity class="button-icon" size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            class="header-tool-btn"
            class:active={showTimeMachinePanel}
            aria-label="Timeline"
            title="Timeline"
            onclick={(event) => {
              event.stopPropagation();
              showTimeMachinePanel = !showTimeMachinePanel;
            }}
          >
            <History class="button-icon" size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            class="header-tool-btn"
            class:active={showSourcesPanel}
            aria-label="Storage"
            title="Storage"
            onclick={(event) => {
              event.stopPropagation();
              toggleSourcesPanel();
            }}
          >
            <HardDrive class="button-icon" size={14} strokeWidth={2} />
          </button>
          {#if showChatWorkspace}
            <button
              type="button"
              class="header-tool-btn"
              class:active={showIdentityManager}
              aria-label="Identities"
              title="Identities"
              onclick={(event) => {
                event.stopPropagation();
                showIdentityManager = !showIdentityManager;
              }}
            >
              <UserRound class="button-icon" size={14} strokeWidth={2} />
            </button>
          {/if}
          <button
            type="button"
            class="mount-add-btn"
            class:visible={isHeaderHovering || isSecretDropTarget}
            onclick={addMount}
            aria-label="Add volume"
            title="Add volume"
          >
            <Plus size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {#if showChatWorkspace && showIdentityManager}
        <div class="identity-row panel-surface">
          <div class="identity-row-head">
            <div class="identity-row-title">
              <UserRound class="button-icon" size={15} strokeWidth={2} />
              <span>Identities</span>
            </div>
            <div class="identity-row-actions">
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => void joinCurrentVolumeChat()}
                disabled={!auth || isHistoryMode || identityManagerLoading || !selectedChatIdentity}
                title={
                  !auth
                    ? 'Open a volume before joining'
                    : isHistoryMode
                      ? 'Jump to Latest before joining'
                      : ''
                }
              >
                <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                <span>
                  {identityManagerLoading
                    ? 'Joining…'
                    : selectedChatIdentity && selectedChatIdentity.id === currentVolumeChatIdentityId
                      ? 'Joined'
                      : 'Join this volume'}
                </span>
              </button>
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => void publishSelectedChatIdentity()}
                disabled={!auth || isHistoryMode || identityManagerLoading || !selectedChatIdentity}
                title={
                  !auth
                    ? 'Open a volume before publishing'
                    : isHistoryMode
                      ? 'Jump to Latest before publishing'
                      : ''
                }
              >
                <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                <span>
                  {identityManagerLoading
                    ? 'Publishing…'
                    : selectedChatIdentityNeedsPublish
                      ? 'Publish identity'
                      : 'Published'}
                </span>
              </button>
            </div>
          </div>

          <div class="identity-chip-row">
            {#if configuredIdentities.length === 0}
              <button type="button" class="identity-pill add" onclick={addConfiguredChatIdentity}>
                <Plus size={14} strokeWidth={2} />
                <span>Add identity</span>
              </button>
            {:else}
              {#each configuredIdentities as identity (identity.id)}
                <button
                  type="button"
                  class="identity-pill"
                  class:active={identity.id === activeChatIdentityId}
                  onclick={() => {
                    activeChatIdentityId = identity.id;
                    identityManagerError = '';
                    identityManagerMessage = '';
                  }}
                >
                  <span class="identity-pill-name">{identity.displayName || 'Unnamed identity'}</span>
                  <span class="identity-pill-state">
                    {#if identity.id === currentVolumeChatIdentityId && joinedChatIdentityNeedsPublish}
                      Joined · update pending
                    {:else if identity.id === currentVolumeChatIdentityId}
                      Joined
                    {:else if identity.id === activeChatIdentityId && selectedChatIdentityNeedsPublish}
                      Needs publish
                    {:else if identity.publicKey}
                      Published
                    {:else}
                      Local
                    {/if}
                  </span>
                </button>
              {/each}
              <button type="button" class="identity-pill add" onclick={addConfiguredChatIdentity}>
                <Plus size={14} strokeWidth={2} />
                <span>New</span>
              </button>
            {/if}
          </div>

          <p class="identity-row-note">
            This volume will chat as
            <strong>{joinedChatIdentity?.displayName || 'no identity yet'}</strong>.
            Joining is an explicit per-volume local choice.
          </p>
          <p class="identity-row-note">
            Publish writes a signed <code>DECLARE_IDENTITY</code> event into the current volume log.
          </p>

          {#if identityManagerError}
            <p class="identity-row-banner error">{identityManagerError}</p>
          {:else if identityManagerMessage}
            <p class="identity-row-banner success">{identityManagerMessage}</p>
          {/if}

          {#if selectedChatIdentity}
            <div class="identity-editor-panel">
              <label>
                <span>Identity secret</span>
                <input
                  type="text"
                  value={selectedChatIdentity.address}
                  oninput={(event) =>
                    updateConfiguredChatIdentity(selectedChatIdentity.id, {
                      address: (event.currentTarget as HTMLInputElement).value,
                    })}
                  placeholder="address or secret seed"
                />
              </label>
              <label>
                <span>Password (optional)</span>
                <input
                  type="password"
                  value={selectedChatIdentity.password}
                  oninput={(event) =>
                    updateConfiguredChatIdentity(selectedChatIdentity.id, {
                      password: (event.currentTarget as HTMLInputElement).value,
                    })}
                  placeholder="optional"
                />
              </label>
              <label>
                <span>Display name</span>
                <input
                  type="text"
                  value={selectedChatIdentity.displayName}
                  oninput={(event) =>
                    updateConfiguredChatIdentity(selectedChatIdentity.id, {
                      displayName: (event.currentTarget as HTMLInputElement).value,
                    })}
                  placeholder="Ada"
                />
              </label>
              <label class="identity-editor-panel-wide">
                <span>Bio</span>
                <textarea
                  rows="2"
                  oninput={(event) =>
                    updateConfiguredChatIdentity(selectedChatIdentity.id, {
                      bio: (event.currentTarget as HTMLTextAreaElement).value,
                    })}
                  placeholder="Who is speaking from this key?"
                >{selectedChatIdentity.bio}</textarea>
              </label>
              <div class="identity-editor-panel-actions">
                <button
                  type="button"
                  class="workspace-toggle remove"
                  onclick={() => removeConfiguredChatIdentity(selectedChatIdentity.id)}
                >
                  <Trash2 class="button-icon" size={15} strokeWidth={2} />
                  <span>Remove</span>
                </button>
                <button
                  type="button"
                  class="workspace-toggle"
                  onclick={() => void publishSelectedChatIdentity()}
                  disabled={!auth || isHistoryMode || identityManagerLoading}
                >
                  <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                  <span>
                    {identityManagerLoading
                      ? 'Publishing…'
                      : selectedChatIdentityNeedsPublish
                        ? 'Publish to volume'
                        : 'Published'}
                  </span>
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </header>

  <!-- Status bar -->
  {#if showStatusPanel && (volumeId || errorMessage || isOffline)}
    <div class="status-bar panel-surface">
      {#if volumeId}
        <div class="status-item">
          <span class="status-label">Volume:</span>
          <button class="volume-id-btn" onclick={copyVolumeId} title="Copy volume ID">
            {volumeId.slice(0, 16)}...
            {#if copiedVolumeId}
              <span class="copied-indicator">✓ Copied</span>
            {/if}
          </button>
        </div>
      {/if}
      {#if lastRefresh}
        <div class="status-item">
          <span class="status-label">Last refresh:</span>
          <span class="status-value">{formatDate(lastRefresh)}</span>
        </div>
      {/if}
      {#if volumeId}
        <div class="status-item">
          <span class="status-label">Sync:</span>
          <span class="status-value">
            {#if autoSyncStatus === 'connecting'}
              Connecting…
            {:else if autoSyncEnabled}
              Auto
            {:else if autoSyncStatus === 'unsupported'}
              Manual
            {:else if autoSyncStatus === 'error'}
              Manual (watch offline)
            {:else}
              Manual
            {/if}
          </span>
        </div>
      {/if}
      {#if isHistoryMode}
        <div class="status-item history-indicator">
          <span>History mode (read-only)</span>
        </div>
      {/if}
      {#if isOffline}
        <div class="status-item offline-indicator">
          <span>📴 Offline (cached)</span>
        </div>
      {/if}
      {#if errorMessage}
        <div class="status-item error-indicator">
          <span>{errorMessage}</span>
        </div>
      {/if}
      {#if volumeId && !isLoading && !autoSyncEnabled}
        <button class="refresh-btn" onclick={refreshFiles} title="Refresh file list">
          <RefreshCw class="button-icon" size={15} strokeWidth={2} />
          <span>Refresh</span>
        </button>
      {/if}
    </div>
  {/if}

  <!-- Main file area -->
  <main
    class="file-area"
    class:volume-workspace-active={!showSourcesPanel && !showVolumeStoragePanel && address.trim() !== ''}
    class:dragging={isDragging}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if showSourcesPanel}
      <div class="workspace-panel-view">
        <StoragePanel
          mode="global"
          {volumeId}
          currentVolumePresentation={currentMountedVolumePresentation}
        />
      </div>
    {:else if showVolumeStoragePanel}
      <div class="workspace-panel-view">
        <StoragePanel
          mode="volume"
          {volumeId}
          currentVolumePresentation={currentMountedVolumePresentation}
        />
      </div>
    {:else if address.trim() === ''}
      <!-- Initial state -->
      <div class="empty-state">
        <div class="empty-content">
          <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
            <path d="M8 20V44L32 56L56 44V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
            <path d="M32 32V56" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
          </svg>
          <p class="empty-hint">Enter an address to access your files</p>
          <p class="empty-subhint">Or drag and drop files here to create a new volume</p>
        </div>
      </div>
    {:else}
      <div class="volume-workspace">
      {#if isVolumeTransitioning}
        <div class="volume-transition-state panel-surface" aria-live="polite">
          <div class="volume-transition-spinner"></div>
          <div class="volume-transition-copy">
            <p class="volume-transition-title">Switching volume</p>
            <p class="volume-transition-subtitle">Replaying history off-screen…</p>
          </div>
        </div>
      {:else}
      {#if showTimeMachinePanel}
      <section class="time-machine panel-surface" aria-label="Volume timeline">
        <div class="time-machine-head">
          <div>
            <p class="time-machine-eyebrow">Timeline</p>
            <p class="time-machine-marker">{timelineMarker}</p>
          </div>
          <div class="time-machine-actions">
            <button
              type="button"
              class="tm-btn"
              onclick={toggleTimelinePlayback}
              disabled={timelineEvents.length === 0 || isTimelineLoading}
            >
              {isTimelinePlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              class="tm-btn live"
              onclick={jumpToLatest}
              disabled={timelinePosition === timelineEvents.length}
            >
              Latest
            </button>
          </div>
        </div>
        <div class="time-machine-track">
          <input
            class="tm-slider"
            type="range"
            min="0"
            max={timelineEvents.length}
            value={timelinePosition}
            disabled={timelineEvents.length === 0}
            aria-label="Timeline position"
            oninput={(e) => {
              stopTimelinePlayback();
              setTimelinePosition(Number((e.currentTarget as HTMLInputElement).value));
            }}
          />
          <div class="tm-scale">
            <span>Start</span>
            <span>{timelinePosition}/{timelineEvents.length}</span>
            <span>Latest</span>
          </div>
        </div>
        {#if timelineEvents.length > 0}
          <div class="tm-events">
            {#each timelineEvents as event, index (event.eventHash)}
              <button
                type="button"
                class="tm-event"
                class:applied={index < timelinePosition}
                class:current={index === timelinePosition - 1}
                class:create={event.type === 'CREATE_FILE'}
                class:delete={event.type === 'DELETE_FILE'}
                class:rename={event.type === 'RENAME_FILE'}
                class:identity={event.type === 'DECLARE_IDENTITY'}
                class:chat={event.type === 'CHAT_MESSAGE'}
                onclick={() => jumpToEvent(index)}
                title={timelineTitle(event)}
              >
                <span class="tm-event-kind">{timelineKindLabel(event)}</span>
                <span class="tm-event-name">{timelineHeadline(event)}</span>
                <span class="tm-event-time">{formatShortDate(event.timestamp)}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="tm-empty">Timeline is empty. Add files to create history.</p>
        {/if}
      </section>
      {/if}

      <div class="workspace-mode-bar panel-surface" role="group" aria-label="Volume workspace">
        <button
          type="button"
          class="workspace-mode-btn"
          class:active={showFilesWorkspace}
          aria-pressed={showFilesWorkspace}
          onclick={() => toggleWorkspacePane('files')}
        >
          <File size={15} strokeWidth={2} />
          <span>Files</span>
        </button>
        <button
          type="button"
          class="workspace-mode-btn"
          class:active={showChatWorkspace}
          aria-pressed={showChatWorkspace}
          onclick={() => toggleWorkspacePane('chat')}
        >
          <MessageSquareText size={15} strokeWidth={2} />
          <span>Chat</span>
        </button>
      </div>

      <div
        class="workspace-panels"
        bind:this={workspacePanelsElement}
        style:grid-template-columns={workspacePanelsTemplate}
      >
        {#if showFilesWorkspace}
          <div class="workspace-pane">
            {#if viewFiles.length === 0 && !isLoading}
              <div class="empty-state">
                <div class="empty-content">
                  <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                    <path d="M8 20V44L32 56L56 44V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                    <path d="M32 32V56" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                  </svg>
                  {#if isHistoryMode}
                    <p class="empty-hint">No files at this point in history</p>
                    <p class="empty-subhint">Move the timeline toward Latest to see newer files</p>
                  {:else}
                    <p class="empty-hint">No files yet</p>
                    <p class="empty-subhint">Drop files here to add them</p>
                  {/if}
                </div>
              </div>
            {:else}
              <div
                class="file-manager"
                role="presentation"
                bind:this={fileManagerElement}
                style:grid-template-columns={fileManagerTemplate}
                onpointerdown={() => {
                  fileManagerActive = true;
                }}
                onfocusin={() => {
                  fileManagerActive = true;
                }}
              >
                <section class="file-list-pane" class:with-preview={showPreviewPane}>
                  <div class="manager-toolbar">
                    <div class="manager-toolbar-top">
                      <input
                        type="text"
                        class="manager-search"
                        placeholder="Search files"
                        bind:value={searchQuery}
                        aria-label="Search files"
                      />
                      <div class="manager-view-switch" role="tablist" aria-label="File browser view">
                        <button
                          type="button"
                          class="view-toggle"
                          class:active={fileManagerViewMode === 'icons'}
                          onclick={() => (fileManagerViewMode = 'icons')}
                          aria-pressed={fileManagerViewMode === 'icons'}
                          title="Icon view"
                        >
                          <LayoutGrid size={15} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          class="view-toggle"
                          class:active={fileManagerViewMode === 'details'}
                          onclick={() => (fileManagerViewMode = 'details')}
                          aria-pressed={fileManagerViewMode === 'details'}
                          title="Details view"
                        >
                          <Rows3 size={15} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                    <div class="manager-toolbar-bottom">
                      <div class="manager-filters">
                        <select class="manager-sort" bind:value={sortBy} aria-label="Sort files">
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="name">Name</option>
                          <option value="name-desc">Name (Z-A)</option>
                          <option value="size">Size</option>
                          <option value="size-asc">Size (Smallest)</option>
                        </select>
                      </div>
                      {#if appReferenceClipboard}
                        <button
                          type="button"
                          class="manager-btn toolbar-btn"
                          onclick={() => void pasteCopiedFiles()}
                          disabled={!auth || isHistoryMode}
                          title={!auth ? 'Open a destination volume before pasting' : isHistoryMode ? 'Jump to Latest before pasting' : ''}
                        >
                          <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
                          Paste {appReferenceClipboard.itemCount} item{appReferenceClipboard.itemCount === 1 ? '' : 's'}
                        </button>
                      {/if}
                    </div>
                    <div class="manager-summary">
                      <span>{visibleFiles.length} file{visibleFiles.length === 1 ? '' : 's'}</span>
                      <span>
                        {selectedFileNames.length === 0
                          ? 'No selection'
                          : selectedFileNames.length === 1 && selectedFile
                            ? displayFileName(selectedFile)
                            : `${selectedFileNames.length} selected`}
                      </span>
                    </div>
                  </div>
                  {#if visibleFiles.length === 0}
                    <div class="list-empty">No files match your search.</div>
                  {:else}
                    <div class="file-list-scroll" class:icons={fileManagerViewMode === 'icons'}>
                      {#if fileManagerViewMode === 'details'}
                        <div class="file-list-head">
                          <span class="file-list-sort-wrap" data-sort={columnSortState('name')}>
                            <button type="button" class="file-list-sort" onclick={() => toggleColumnSort('name')}>
                              Name
                            </button>
                          </span>
                          <span class="file-list-sort-wrap" data-sort={columnSortState('size')}>
                            <button type="button" class="file-list-sort" onclick={() => toggleColumnSort('size')}>
                              Size
                            </button>
                          </span>
                          <span class="file-list-sort-wrap" data-sort={columnSortState('date')}>
                            <button type="button" class="file-list-sort" onclick={() => toggleColumnSort('date')}>
                              Updated
                            </button>
                          </span>
                        </div>
                      {/if}
                      {#each visibleFiles as file (file.filename)}
                        {@const FileIcon = fileIconComponent(file)}
                        <div
                          class:file-card={fileManagerViewMode === 'icons'}
                          class:file-row={fileManagerViewMode === 'details'}
                          class:selected={isFileSelected(file.filename)}
                          data-filename={file.filename}
                          draggable="true"
                          tabindex="0"
                          role="button"
                          onclick={(event) => handleFilePointerSelect(event, file)}
                          ondblclick={() => openPreviewPane(file)}
                          ondragstart={(event) => handleNearbytesFileDragStart(event, file)}
                          onkeydown={(e) => handleFileRowKeydown(e, file)}
                        >
                          {#if fileManagerViewMode === 'icons'}
                            <div class={`file-card-art ${fileAccentTone(file)}`}>
                              <FileIcon size={28} strokeWidth={1.8} />
                            </div>
                            <div class="file-card-copy">
                              {#if renamingFileName === file.filename}
                                <input
                                  type="text"
                                  class="file-rename-input"
                                  bind:value={renameDraft}
                                  onclick={(event) => event.stopPropagation()}
                                  ondblclick={(event) => event.stopPropagation()}
                                  onblur={() => commitRename(file)}
                                  onkeydown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === 'Enter') {
                                      void commitRename(file);
                                    } else if (event.key === 'Escape') {
                                      cancelRenaming();
                                    }
                                  }}
                                />
                              {:else}
                                <button
                                  type="button"
                                  class="file-name-trigger file-card-name"
                                  title={file.filename}
                                  ondblclick={(event) => {
                                    event.stopPropagation();
                                    startRenaming(file);
                                  }}
                                  onclick={(event) => handleFilePointerSelect(event, file)}
                                >
                                  {displayFileName(file)}
                                </button>
                              {/if}
                            </div>
                          {:else}
                            <div class="file-row-main">
                              <span class={`file-row-icon ${fileAccentTone(file)}`}>
                                <FileIcon size={15} strokeWidth={2} />
                              </span>
                              <div class="file-row-copy">
                                {#if renamingFileName === file.filename}
                                  <input
                                    type="text"
                                    class="file-rename-input"
                                    bind:value={renameDraft}
                                    onclick={(event) => event.stopPropagation()}
                                    ondblclick={(event) => event.stopPropagation()}
                                    onblur={() => commitRename(file)}
                                    onkeydown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === 'Enter') {
                                        void commitRename(file);
                                      } else if (event.key === 'Escape') {
                                        cancelRenaming();
                                      }
                                    }}
                                  />
                                {:else}
                                  <button
                                    type="button"
                                    class="file-name-trigger file-row-name"
                                    title={file.filename}
                                    ondblclick={(event) => {
                                      event.stopPropagation();
                                      startRenaming(file);
                                    }}
                                    onclick={(event) => handleFilePointerSelect(event, file)}
                                  >
                                    {displayFileName(file)}
                                  </button>
                                {/if}
                                <span class="file-row-path" title={file.filename}>{file.filename}</span>
                              </div>
                            </div>
                            <span class="file-row-size">{formatSize(file.size)}</span>
                            <span class="file-row-date">{formatRelativeDay(file.createdAt)}</span>
                          {/if}
                        </div>
                      {/each}
                      <button
                        type="button"
                        class="file-list-clear-hitbox"
                        aria-label="Clear file selection"
                        tabindex="-1"
                        onclick={clearSelection}
                      ></button>
                    </div>
                  {/if}
                </section>
                {#if showPreviewPane}
                  <button
                    type="button"
                    class="file-manager-divider"
                    aria-label="Resize file manager panes"
                    onpointerdown={startFileManagerResize}
                  >
                    <span class="file-manager-divider-grip">
                      <GripVertical size={16} strokeWidth={1.8} />
                    </span>
                  </button>
                  <section class="preview-pane">
                    {#if currentPreviewFile}
                      <div class="preview-header">
                        <div>
                          <h3 class="preview-title" title={currentPreviewFile.filename}>{currentPreviewFile.filename}</h3>
                          <p class="preview-meta">
                            {currentPreviewFile.mimeType || 'Unknown type'} • {formatSize(currentPreviewFile.size)} • {formatDate(currentPreviewFile.createdAt)}
                          </p>
                        </div>
                        <div class="preview-actions">
                          {#if !previewFileOverride && selectedFile}
                            <ArmedActionButton
                              class="manager-btn danger"
                              text="Delete"
                              armed={true}
                              armDelayMs={0}
                              autoDisarmMs={3000}
                              disabled={isHistoryMode}
                              resetKey={`${selectedFile.blobHash}:${isHistoryMode}`}
                              title={isHistoryMode ? 'Jump to Latest before deleting' : ''}
                              onPress={() => handleDelete(selectedFile.filename)}
                            />
                          {/if}
                          <button type="button" class="manager-btn" onclick={() => handleDownload(currentPreviewFile)}>
                            <Download class="button-icon" size={15} strokeWidth={2} />
                            Download
                          </button>
                          <button type="button" class="manager-btn preview-close-btn" onclick={closePreviewPane}>
                            <X class="button-icon" size={15} strokeWidth={2} />
                            Close
                          </button>
                        </div>
                      </div>
                      <div class="preview-body">
                        {#if previewLoading}
                          <p class="preview-message">Loading preview…</p>
                        {:else if previewError}
                          <p class="preview-message error">{previewError}</p>
                        {:else if previewKind === 'image' && previewUrl}
                          <img class="preview-image" src={previewUrl} alt={"Preview of " + currentPreviewFile.filename} />
                        {:else if previewKind === 'video' && previewUrl}
                          <!-- svelte-ignore a11y_media_has_caption -->
                          <video class="preview-media" controls src={previewUrl}></video>
                        {:else if previewKind === 'audio' && previewUrl}
                          <AudioPreview
                            src={previewUrl}
                            title={displayFileName(currentPreviewFile)}
                            mimeType={currentPreviewFile.mimeType}
                          />
                        {:else if previewKind === 'pdf' && previewUrl}
                          <iframe class="preview-pdf" src={previewUrl} title={"PDF preview: " + currentPreviewFile.filename}></iframe>
                        {:else if previewKind === 'text'}
                          <pre class="preview-text">{previewText}</pre>
                        {:else}
                          <p class="preview-message">Preview unavailable. Double-click the file to open it.</p>
                        {/if}
                      </div>
                    {:else}
                      <div class="preview-empty">
                        <p>Select a file to preview.</p>
                      </div>
                    {/if}
                  </section>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if showSplitWorkspace}
          <button
            type="button"
            class="workspace-divider"
            aria-label="Resize files and chat panes"
            onpointerdown={startWorkspaceResize}
          >
            <span class="workspace-divider-grip">
              <GripVertical size={16} strokeWidth={1.8} />
            </span>
          </button>
        {/if}

        {#if showChatWorkspace}
          <div class="workspace-pane">
            <VolumeChat
              {auth}
              {volumeId}
              readonlyMode={isHistoryMode}
              historyState={isHistoryMode ? historicalChatState : null}
              activeIdentity={joinedChatIdentity}
              identityNeedsPublish={joinedChatIdentityNeedsPublish}
              onOpenIdentityManager={openIdentityManagerForChat}
              onPreviewAttachment={previewChatAttachment}
              onChatMutated={handleChatMutated}
              externalRefreshVersion={chatRefreshVersion}
            />
          </div>
        {/if}
      </div>
      {/if}
      </div>
    {/if}
  </main>

</div>

<style>
  :global(html, body, #app) {
    height: 100%;
    min-height: 100%;
    overflow: hidden;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    background: #0a0a0f;
    color: #e0e0e0;
    font-family: 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    overscroll-behavior: none;
  }

  .app {
    width: 100%;
    min-height: 100dvh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(34, 211, 238, 0.09), transparent 48%),
      radial-gradient(110% 130% at 100% 0%, rgba(14, 165, 233, 0.08), transparent 42%),
      linear-gradient(180deg, #050b16 0%, #09111d 44%, #060912 100%);
    overflow: hidden;
  }

  .header {
    background: rgba(7, 14, 28, 0.84);
    backdrop-filter: blur(18px);
    border-bottom: 1px solid rgba(56, 189, 248, 0.14);
    padding: 0.75rem 2rem 0.9rem;
    position: sticky;
    top: 0;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: 0 20px 60px rgba(2, 6, 23, 0.36);
  }

  .header-shell {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    align-items: flex-start;
    position: relative;
    transition: transform 0.24s ease, filter 0.24s ease;
  }

  .header-shell.secret-drop-target {
    transform: translateY(-1px);
    filter: drop-shadow(0 14px 28px rgba(34, 211, 238, 0.12));
  }

  .mounts-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    width: 100%;
  }

  .identity-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.78rem 0.9rem;
    border: 1px solid rgba(56, 189, 248, 0.14);
    border-radius: 18px;
    background:
      radial-gradient(140% 120% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 42%),
      linear-gradient(180deg, rgba(9, 20, 39, 0.9), rgba(8, 18, 35, 0.84));
  }

  .identity-row-head,
  .identity-row-actions,
  .identity-editor-panel-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .identity-row-title {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: rgba(224, 242, 254, 0.92);
  }

  .identity-chip-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    overflow-x: auto;
    padding-bottom: 0.1rem;
    scrollbar-width: thin;
  }

  .identity-pill {
    appearance: none;
    border: 1px solid rgba(56, 189, 248, 0.16);
    background: rgba(8, 20, 38, 0.74);
    color: rgba(226, 232, 240, 0.92);
    border-radius: 15px;
    min-height: 42px;
    padding: 0.58rem 0.82rem;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.12rem;
    min-width: 132px;
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      background-color 0.18s ease,
      transform 0.18s ease,
      box-shadow 0.18s ease;
  }

  .identity-pill:hover {
    border-color: rgba(96, 165, 250, 0.32);
    background: rgba(12, 28, 48, 0.92);
    transform: translateY(-1px);
  }

  .identity-pill.active {
    border-color: rgba(34, 211, 238, 0.38);
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94));
    box-shadow: 0 10px 24px rgba(6, 182, 212, 0.12);
  }

  .identity-pill.add {
    min-width: auto;
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
  }

  .identity-pill-name {
    font-size: 0.84rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .identity-pill-state {
    font-size: 0.72rem;
    color: rgba(191, 219, 254, 0.66);
    white-space: nowrap;
  }

  .identity-row-note {
    margin: 0;
    font-size: 0.78rem;
    color: rgba(186, 230, 253, 0.68);
  }

  .identity-row-note code {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.74rem;
    color: rgba(224, 242, 254, 0.9);
  }

  .identity-row-banner {
    margin: 0;
    align-self: flex-start;
    border-radius: 999px;
    padding: 0.38rem 0.72rem;
    font-size: 0.8rem;
  }

  .identity-row-banner.error {
    background: rgba(127, 29, 29, 0.22);
    color: rgba(252, 165, 165, 0.96);
  }

  .identity-row-banner.success {
    background: rgba(20, 83, 45, 0.22);
    color: rgba(134, 239, 172, 0.96);
  }

  .identity-editor-panel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    align-items: start;
  }

  .identity-editor-panel label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: rgba(191, 219, 254, 0.78);
    font-size: 0.82rem;
  }

  .identity-editor-panel input,
  .identity-editor-panel textarea {
    width: 100%;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.14);
    background: rgba(4, 15, 28, 0.88);
    color: rgba(239, 246, 255, 0.94);
    font: inherit;
    padding: 0.75rem 0.85rem;
  }

  .identity-editor-panel-wide {
    grid-column: 1 / -1;
  }

  .identity-editor-panel-actions {
    grid-column: 1 / -1;
  }

  .workspace-toggle.remove {
    border-color: rgba(248, 113, 113, 0.22);
    background: rgba(67, 20, 20, 0.56);
    color: rgba(254, 226, 226, 0.95);
  }

  .workspace-toggle.remove:hover {
    border-color: rgba(252, 165, 165, 0.38);
    background: rgba(88, 24, 24, 0.72);
  }

  .mounts-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
    transition: opacity 0.18s ease, transform 0.22s ease;
  }

  .mounts-actions.visible {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  .volume-chip {
    appearance: none;
    border: 1px solid rgba(56, 189, 248, 0.22);
    border-radius: 14px;
    background:
      linear-gradient(180deg, rgba(12, 25, 45, 0.9), rgba(9, 18, 34, 0.88));
    width: fit-content;
    min-width: 132px;
    max-width: min(72vw, 420px);
    padding: 0.1rem;
    transition: min-width 0.28s ease, max-width 0.28s ease, border-radius 0.28s ease, background-color 0.28s ease, border-color 0.28s ease, box-shadow 0.28s ease, transform 0.28s ease;
    overflow: hidden;
    font: inherit;
    color: inherit;
    text-align: left;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 14px 32px rgba(2, 6, 23, 0.28);
  }

  .volume-chip.collapsed-shell {
    display: flex;
    align-items: stretch;
    gap: 0;
    transition:
      min-width 0.22s ease,
      max-width 0.22s ease,
      opacity 0.18s ease,
      transform 0.22s ease,
      margin 0.22s ease,
      border-color 0.18s ease;
  }

  .volume-chip.collapsed-shell.parked {
    min-width: 46px;
    max-width: 46px;
    transform: translateX(0) scale(1);
  }

  .volume-chip.collapsed-shell.parked .header-dock {
    padding: 0.32rem;
  }

  .volume-chip.collapsed-shell.parked .header-dock-badge {
    gap: 0;
  }

  .volume-chip.collapsed-shell.parked .header-dock-badge-top {
    gap: 0;
  }

  .volume-chip.collapsed-shell :global(.volume-identity-copy) {
    max-width: 220px;
    opacity: 1;
    transform: translateX(0);
    overflow: hidden;
    transition:
      max-width 0.22s ease,
      opacity 0.18s ease,
      transform 0.22s ease;
  }

  .volume-chip.collapsed-shell.parked :global(.volume-identity-copy) {
    max-width: 0;
    opacity: 0;
    transform: translateX(-5px);
  }

  .volume-chip.collapsed-shell.parked:focus-within {
    min-width: 132px;
    max-width: min(72vw, 420px);
  }

  .volume-chip.collapsed-shell.parked:hover {
    min-width: 132px;
    max-width: min(72vw, 420px);
  }

  .volume-chip.collapsed-shell.parked:focus-within .header-dock {
    padding: 0.26rem 0.36rem 0.26rem 0.62rem;
  }

  .volume-chip.collapsed-shell.parked:hover .header-dock {
    padding: 0.26rem 0.36rem 0.26rem 0.62rem;
  }

  .volume-chip.collapsed-shell.parked:focus-within .header-dock-badge-top {
    gap: 0.5rem;
  }

  .volume-chip.collapsed-shell.parked:hover .header-dock-badge-top {
    gap: 0.5rem;
  }

  .volume-chip.collapsed-shell.parked:focus-within :global(.volume-identity-copy) {
    max-width: 220px;
    opacity: 1;
    transform: translateX(0);
  }

  .volume-chip.collapsed-shell.parked:hover :global(.volume-identity-copy) {
    max-width: 220px;
    opacity: 1;
    transform: translateX(0);
  }

  .volume-chip.expanded {
    max-width: min(96vw, 1500px);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(10, 23, 43, 0.96), rgba(8, 18, 35, 0.94));
    border-color: rgba(56, 189, 248, 0.34);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 24px 56px rgba(2, 6, 23, 0.36);
    cursor: default;
  }

  .volume-chip.selected {
    --volume-identity-label-color: rgba(236, 254, 255, 0.98);
    --volume-identity-secondary-color: rgba(165, 243, 252, 0.82);
    border-color: rgba(45, 212, 191, 0.46);
    background:
      radial-gradient(120% 180% at 0% 0%, rgba(45, 212, 191, 0.16), transparent 52%),
      linear-gradient(180deg, rgba(11, 28, 43, 0.96), rgba(8, 18, 34, 0.94));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 0 0 1px rgba(34, 211, 238, 0.12),
      0 18px 38px rgba(2, 6, 23, 0.34),
      0 12px 32px rgba(13, 148, 136, 0.14);
  }

  .volume-chip.selected .header-dock {
    padding-left: 0.72rem;
  }

  .volume-chip.selected .header-dock-badge {
    position: relative;
    padding-left: 0.68rem;
  }

  .volume-chip.selected .header-dock-badge::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(165, 243, 252, 1) 0%, rgba(34, 211, 238, 0.96) 62%, rgba(34, 211, 238, 0) 100%);
    box-shadow:
      0 0 0 1px rgba(103, 232, 249, 0.26),
      0 0 14px rgba(34, 211, 238, 0.46);
  }

  .volume-chip.selected .badge-meter {
    background: rgba(34, 211, 238, 0.18);
  }

  .volume-chip.selected.parked .header-dock {
    padding-left: 0.32rem;
  }

  .volume-chip.selected.parked .header-dock-badge {
    padding-left: 0;
  }

  .volume-chip.selected.parked .header-dock-badge::before {
    width: 0;
    height: 0;
    opacity: 0;
    box-shadow: none;
  }

  .header-dock {
    border: 0;
    background: transparent;
    padding: 0.26rem 0.36rem 0.26rem 0.62rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 36px;
    transition: padding 0.24s ease;
  }

  .volume-chip-select {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0;
    min-width: 0;
    flex: 1 1 auto;
    cursor: pointer;
  }

  .volume-chip-select:hover .header-dock {
    background: linear-gradient(180deg, rgba(14, 29, 50, 0.36), rgba(9, 21, 39, 0.18));
  }

  .volume-chip-select:focus-visible {
    outline: none;
  }

  .volume-chip-select:focus-visible .header-dock {
    background: linear-gradient(180deg, rgba(14, 29, 50, 0.46), rgba(9, 21, 39, 0.26));
    box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.18);
  }

  .volume-chip-config-btn {
    appearance: none;
    border: 0;
    border-left: 1px solid transparent;
    background: linear-gradient(180deg, rgba(9, 18, 33, 0.36), rgba(7, 14, 26, 0.18));
    color: rgba(186, 230, 253, 0.72);
    width: 0;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition:
      width 0.2s ease,
      min-width 0.2s ease,
      opacity 0.16s ease,
      background-color 0.2s ease,
      color 0.2s ease,
      border-color 0.2s ease,
      transform 0.2s ease;
  }

  .volume-chip.collapsed-shell:hover .volume-chip-config-btn,
  .volume-chip.collapsed-shell:focus-within .volume-chip-config-btn {
    width: 31px;
    min-width: 31px;
    border-left-color: rgba(56, 189, 248, 0.14);
    opacity: 1;
    pointer-events: auto;
  }

  .volume-chip-config-btn:hover {
    background: linear-gradient(180deg, rgba(18, 35, 60, 0.9), rgba(11, 22, 40, 0.84));
    border-left-color: rgba(96, 165, 250, 0.3);
    color: rgba(240, 249, 255, 0.96);
    transform: translateX(1px);
  }

  .volume-chip-config-btn:focus-visible {
    outline: none;
    background: linear-gradient(180deg, rgba(18, 35, 60, 0.94), rgba(11, 22, 40, 0.9));
    border-left-color: rgba(125, 211, 252, 0.36);
    color: rgba(240, 249, 255, 0.98);
    box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.18);
  }

  .header-dock-main {
    min-width: 0;
    display: flex;
    align-items: center;
    flex: 1;
  }

  .header-dock-main.editing {
    align-items: stretch;
  }

  .header-dock-badge {
    min-width: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
    padding: 0.1rem 0;
  }

  .header-dock-badge-top {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .volume-chip-expanded {
    max-height: 0;
    opacity: 0;
    transform: translateY(-6px);
    pointer-events: none;
    transition: max-height 0.28s ease, opacity 0.24s ease, transform 0.24s ease, padding 0.24s ease;
    padding: 0 0.35rem;
  }

  .volume-chip-expanded.expanded {
    max-height: 260px;
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
    padding: 0.5rem 0.35rem 0.35rem;
  }

  .secret-file-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.8rem;
    align-items: center;
    padding: 0.78rem 0.82rem;
    margin: 0 0.35rem 0.6rem;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.16);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 56%),
      linear-gradient(180deg, rgba(8, 17, 31, 0.88), rgba(7, 14, 27, 0.82));
  }

  .secret-file-card-preview {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 19, 35, 0.92);
    border: 1px solid rgba(96, 165, 250, 0.18);
    color: rgba(191, 219, 254, 0.86);
    flex: 0 0 auto;
  }

  .secret-file-card-preview.image {
    background: rgba(7, 14, 28, 0.98);
  }

  .secret-file-card-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .secret-file-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .secret-file-card-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }

  .secret-file-card-name,
  .secret-file-card-info,
  .secret-file-card-hash-label,
  .secret-file-card-hash {
    margin: 0;
  }

  .secret-file-card-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: rgba(240, 249, 255, 0.97);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .secret-file-card-info {
    font-size: 0.74rem;
    color: rgba(191, 219, 254, 0.74);
  }

  .secret-file-card-hash-label {
    margin-top: 0.18rem;
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(94, 234, 212, 0.7);
  }

  .secret-file-card-hash {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.72rem;
    line-height: 1.35;
    color: rgba(226, 232, 240, 0.9);
    word-break: break-all;
  }

  .secret-file-download {
    min-width: 108px;
  }

  .header-dock-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    flex-wrap: wrap;
    width: 100%;
  }

  .workspace-toggle {
    border: 1px solid rgba(56, 189, 248, 0.24);
    background: rgba(12, 24, 43, 0.82);
    color: rgba(226, 232, 240, 0.92);
    border-radius: 11px;
    padding: 0 0.68rem;
    min-height: 28px;
    min-width: 116px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .workspace-toggle:hover {
    background: rgba(18, 34, 60, 0.94);
    border-color: rgba(96, 165, 250, 0.34);
    transform: translateY(-1px);
  }

  .workspace-toggle.active {
    border-color: rgba(34, 211, 238, 0.48);
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.96), rgba(10, 44, 66, 0.96));
    color: #ecfeff;
    box-shadow: 0 10px 24px rgba(6, 182, 212, 0.16);
  }

  .panel-surface {
    animation: panel-fade-in 240ms ease;
  }

  @keyframes panel-fade-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .secret-input-wrapper {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
    position: relative;
  }

  .secret-input-wrapper.in-dock {
    width: 100%;
  }

  .secret-input-hint-row {
    margin-top: 0.42rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .secret-input-hint {
    margin: 0;
    font-size: 0.72rem;
    color: rgba(191, 219, 254, 0.64);
    letter-spacing: 0.01em;
  }

  .secret-input-hint kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 1.25rem;
    padding: 0 0.34rem;
    border-radius: 0.42rem;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(10, 18, 33, 0.7);
    color: rgba(226, 232, 240, 0.86);
    font-size: 0.68rem;
    font-weight: 600;
    font-family: inherit;
    vertical-align: middle;
  }

  .secret-clipboard-btn {
    min-width: 126px;
  }

  .secret-input {
    width: 100%;
    min-height: 44px;
    padding: 0 0.95rem;
    font-size: 0.95rem;
    background: rgba(10, 18, 33, 0.82);
    border: 1px solid rgba(96, 165, 250, 0.24);
    border-radius: 12px;
    color: #e0e0e0;
    outline: none;
    transition: all 0.2s ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .secret-input:focus {
    border-color: rgba(56, 189, 248, 0.52);
    background: rgba(10, 18, 33, 0.96);
    box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
  }

  .secret-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .secret-input::placeholder {
    color: rgba(224, 224, 224, 0.4);
  }

  .loading-spinner {
    justify-self: center;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(102, 126, 234, 0.3);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .badge-meter {
    position: relative;
    display: block;
    width: 100%;
    height: 3px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(56, 189, 248, 0.16);
    box-shadow:
      inset 0 0 0 1px rgba(56, 189, 248, 0.08),
      0 0 18px rgba(34, 211, 238, 0.12);
  }

  .badge-meter-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -42%;
    width: 42%;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      rgba(34, 211, 238, 0),
      rgba(125, 211, 252, 0.98) 52%,
      rgba(34, 211, 238, 0)
    );
    animation: badge-meter-slide 1.08s ease-in-out infinite;
  }

  @keyframes badge-meter-slide {
    0% {
      left: -42%;
    }
    100% {
      left: 100%;
    }
  }

  .chip-collapse-btn {
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(11, 19, 34, 0.5);
    color: rgba(203, 213, 225, 0.72);
    border-radius: 999px;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  }

  .chip-collapse-btn:hover {
    background: rgba(15, 23, 42, 0.82);
    border-color: rgba(148, 163, 184, 0.34);
    color: rgba(226, 232, 240, 0.94);
    transform: translateY(-1px);
  }

  :global(.panel-action-btn) {
    border: 1px solid rgba(56, 189, 248, 0.24);
    background: rgba(12, 24, 43, 0.82);
    color: rgba(226, 232, 240, 0.92);
    border-radius: 11px;
    padding: 0 0.68rem;
    min-height: 28px;
    min-width: 116px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  :global(.panel-action-btn:hover:not(:disabled)) {
    background: rgba(18, 34, 60, 0.94);
    border-color: rgba(96, 165, 250, 0.34);
    transform: translateY(-1px);
  }

  :global(.panel-action-btn:disabled) {
    cursor: default;
  }

  :global(.panel-action-btn.danger) {
    border-color: rgba(248, 113, 113, 0.24);
    background: rgba(67, 20, 20, 0.62);
    color: rgba(254, 226, 226, 0.95);
  }

  :global(.panel-action-btn.danger:hover:not(:disabled)) {
    border-color: rgba(252, 165, 165, 0.4);
    background: rgba(88, 24, 24, 0.76);
  }

  :global(.panel-action-btn.danger.armed) {
    border-color: rgba(252, 165, 165, 0.84);
    background: linear-gradient(180deg, rgba(220, 38, 38, 0.86), rgba(153, 27, 27, 0.92));
    color: #fff5f5;
    box-shadow: 0 12px 24px rgba(127, 29, 29, 0.24);
  }

  .mount-add-btn,
  .header-tool-btn {
    border: 1px solid rgba(56, 189, 248, 0.14);
    background: rgba(10, 19, 34, 0.52);
    color: rgba(191, 219, 254, 0.78);
    border-radius: 12px;
    width: 36px;
    height: 36px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px) scale(0.94);
    transition:
      opacity 0.18s ease,
      transform 0.22s ease,
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .header-tool-btn {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .mount-add-btn {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px) scale(0.94);
  }

  .mount-add-btn.visible {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0) scale(1);
  }

  .mount-add-btn:hover,
  .header-tool-btn:hover {
    background: rgba(16, 32, 56, 0.88);
    border-color: rgba(96, 165, 250, 0.28);
    color: rgba(224, 242, 254, 0.96);
    transform: translateY(-1px);
  }

  .header-tool-btn.active {
    border-color: rgba(34, 211, 238, 0.42);
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94));
    color: rgba(236, 254, 255, 0.98);
    box-shadow: 0 10px 24px rgba(6, 182, 212, 0.16);
  }

  :global(.button-icon) {
    flex: 0 0 auto;
  }

  /* Status bar */
  .status-bar {
    background: linear-gradient(180deg, rgba(8, 17, 31, 0.92), rgba(7, 14, 26, 0.88));
    border-bottom: 1px solid rgba(56, 189, 248, 0.1);
    padding: 0.75rem 2rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    font-size: 0.875rem;
    max-width: none;
    margin: 0;
    width: 100%;
    border-top: 1px solid rgba(56, 189, 248, 0.1);
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: rgba(224, 224, 224, 0.7);
  }

  .status-label {
    font-weight: 500;
    color: rgba(224, 224, 224, 0.5);
  }

  .status-value {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
  }

  .volume-id-btn {
    background: rgba(12, 24, 43, 0.82);
    border: 1px solid rgba(56, 189, 248, 0.24);
    border-radius: 11px;
    padding: 0.32rem 0.82rem;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
    color: rgba(125, 211, 252, 0.96);
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .volume-id-btn:hover {
    background: rgba(16, 32, 56, 0.96);
    border-color: rgba(96, 165, 250, 0.34);
  }

  .copied-indicator {
    margin-left: 0.5rem;
    color: #4ade80;
    font-size: 0.75rem;
  }

  .offline-indicator {
    color: #fbbf24;
  }

  .history-indicator {
    color: #7dd3fc;
  }

  .error-indicator {
    color: #f87171;
  }

  .refresh-btn {
    background: rgba(12, 24, 43, 0.82);
    border: 1px solid rgba(56, 189, 248, 0.24);
    border-radius: 11px;
    min-height: 32px;
    padding: 0 0.8rem;
    color: rgba(226, 232, 240, 0.92);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    transition: all 0.2s;
    margin-left: auto;
  }

  .refresh-btn:hover {
    background: rgba(16, 32, 56, 0.96);
    border-color: rgba(96, 165, 250, 0.34);
  }

  .refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* File area */
  .file-area {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    padding: 2rem;
    overflow: hidden;
    transition: background-color 0.3s ease;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .file-area.volume-workspace-active {
    padding: 0;
  }

  .workspace-panel-view {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow: auto;
    scrollbar-width: thin;
  }

  .workspace-mode-bar {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    align-self: flex-start;
    margin: 0;
    padding: 0.22rem;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.14);
    background: rgba(7, 16, 30, 0.76);
    backdrop-filter: blur(18px);
    flex: 0 0 auto;
  }

  .workspace-mode-btn {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(191, 219, 254, 0.72);
    border-radius: 11px;
    min-height: 30px;
    padding: 0 0.72rem;
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    font: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      color 0.18s ease,
      border-color 0.18s ease,
      background-color 0.18s ease,
      transform 0.18s ease,
      box-shadow 0.18s ease;
  }

  .workspace-mode-btn:hover {
    color: rgba(224, 242, 254, 0.94);
    background: rgba(12, 26, 46, 0.9);
    border-color: rgba(96, 165, 250, 0.18);
    transform: translateY(-1px);
  }

  .workspace-mode-btn.active {
    color: rgba(236, 254, 255, 0.98);
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94));
    border-color: rgba(34, 211, 238, 0.34);
    box-shadow: 0 10px 24px rgba(6, 182, 212, 0.14);
  }

  .volume-workspace {
    max-width: none;
    margin: 0;
    width: 100%;
    padding: 0.85rem 1rem 1rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .workspace-panels {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: grid;
    gap: 0;
    align-items: stretch;
  }

  .workspace-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: hidden;
    width: 100%;
  }

  .volume-transition-state {
    min-height: 420px;
    border: 1px solid rgba(56, 189, 248, 0.18);
    border-radius: 22px;
    background:
      radial-gradient(120% 120% at 0% 0%, rgba(34, 211, 238, 0.12), transparent 52%),
      radial-gradient(120% 120% at 100% 0%, rgba(14, 165, 233, 0.1), transparent 48%),
      linear-gradient(160deg, rgba(8, 18, 34, 0.96), rgba(7, 14, 28, 0.94));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 24px 48px rgba(2, 6, 23, 0.28);
  }

  .volume-transition-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(125, 211, 252, 0.24);
    border-top-color: rgba(125, 211, 252, 0.96);
    border-radius: 999px;
    animation: spin 0.7s linear infinite;
    flex: 0 0 auto;
  }

  .volume-transition-copy {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .volume-transition-title,
  .volume-transition-subtitle {
    margin: 0;
  }

  .volume-transition-title {
    font-size: 1rem;
    font-weight: 600;
    color: rgba(240, 249, 255, 0.96);
  }

  .volume-transition-subtitle {
    font-size: 0.88rem;
    color: rgba(186, 230, 253, 0.72);
  }

  .time-machine {
    flex: 0 0 auto;
    border: 1px solid rgba(56, 189, 248, 0.18);
    border-radius: 16px;
    background:
      radial-gradient(140% 120% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 44%),
      linear-gradient(180deg, rgba(9, 20, 39, 0.96), rgba(8, 18, 35, 0.9));
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-height: auto;
    overflow: hidden;
  }

  .time-machine-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .time-machine-eyebrow {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(125, 211, 252, 0.78);
  }

  .time-machine-marker {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: rgba(226, 232, 240, 0.92);
  }

  .time-machine-actions {
    display: flex;
    gap: 0.5rem;
  }

  .tm-btn {
    border: 1px solid rgba(56, 189, 248, 0.22);
    border-radius: 11px;
    background: rgba(12, 24, 43, 0.82);
    color: #dbeafe;
    min-height: 34px;
    padding: 0 0.8rem;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }

  .tm-btn.live {
    border-color: rgba(34, 211, 238, 0.48);
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.96), rgba(10, 44, 66, 0.96));
  }

  .tm-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .time-machine-track {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .tm-slider {
    width: 100%;
    accent-color: #38bdf8;
  }

  .tm-scale {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: rgba(191, 219, 254, 0.8);
  }

  .tm-events {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(132px, 162px);
    gap: 0.42rem;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.15rem 0.35rem 0.2rem 0;
    scrollbar-width: none;
    box-sizing: border-box;
  }

  .tm-events::-webkit-scrollbar {
    display: none;
  }

  .tm-event {
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 9px;
    background: rgba(15, 23, 42, 0.35);
    color: #e2e8f0;
    display: grid;
    gap: 0.15rem;
    padding: 0.42rem 0.5rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    outline: none;
  }

  .tm-event:focus-visible {
    box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.7);
  }

  .tm-event.applied {
    border-color: rgba(56, 189, 248, 0.5);
    background: rgba(14, 116, 144, 0.22);
  }

  .tm-event.current {
    border-color: rgba(96, 165, 250, 0.85);
    background: rgba(30, 64, 175, 0.38);
    transform: translateY(-1px);
  }

  .tm-event.create .tm-event-kind {
    color: #86efac;
  }

  .tm-event.delete .tm-event-kind {
    color: #fca5a5;
  }

  .tm-event.rename .tm-event-kind {
    color: #c4b5fd;
  }

  .tm-event.identity .tm-event-kind {
    color: #fcd34d;
  }

  .tm-event.chat .tm-event-kind {
    color: #7dd3fc;
  }

  .tm-event-kind {
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .tm-event-name {
    font-size: 0.77rem;
    display: -webkit-box;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.25;
    min-height: calc(1.25em * 2);
  }

  .tm-event-time {
    font-size: 0.68rem;
    color: rgba(191, 219, 254, 0.85);
  }

  .tm-empty {
    margin: 0;
    font-size: 0.8125rem;
    color: rgba(186, 230, 253, 0.7);
  }

  .file-area.dragging {
    background:
      radial-gradient(120% 120% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 44%),
      rgba(8, 18, 35, 0.2);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .empty-content {
    text-align: center;
    max-width: 400px;
  }

  .empty-icon {
    width: 80px;
    height: 80px;
    margin: 0 auto 1.5rem;
    color: rgba(102, 126, 234, 0.3);
  }

  .empty-hint {
    font-size: 1.25rem;
    color: rgba(224, 224, 224, 0.8);
    margin: 0 0 0.5rem;
  }

  .empty-subhint {
    font-size: 0.9375rem;
    color: rgba(224, 224, 224, 0.5);
    margin: 0;
  }

  /* File manager */
  .file-manager {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: grid;
    gap: 0;
    align-items: stretch;
  }

  .file-list-pane,
  .preview-pane {
    min-height: 0;
    background:
      linear-gradient(180deg, rgba(9, 20, 39, 0.96), rgba(8, 18, 35, 0.9));
    border: 1px solid rgba(56, 189, 248, 0.16);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }

  .file-list-pane {
    border-top-right-radius: 18px;
    border-bottom-right-radius: 18px;
  }

  .file-list-pane.with-preview {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .manager-toolbar {
    display: grid;
    gap: 0.75rem;
    padding: 0.9rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.18);
    background:
      radial-gradient(120% 120% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 46%),
      rgba(8, 18, 35, 0.72);
  }

  .manager-toolbar-top,
  .manager-toolbar-bottom {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.6rem;
    align-items: center;
  }

  .manager-filters {
    display: flex;
    gap: 0.55rem;
    min-width: 0;
    flex-wrap: wrap;
  }

  .manager-search,
  .manager-sort,
  .manager-folder {
    border: 1px solid rgba(56, 189, 248, 0.22);
    background: rgba(10, 18, 33, 0.82);
    color: #e0e0e0;
    border-radius: 12px;
    min-height: 38px;
    padding: 0 0.8rem;
    font-size: 0.875rem;
    outline: none;
  }

  .manager-search:focus,
  .manager-sort:focus,
  .manager-folder:focus {
    border-color: rgba(56, 189, 248, 0.52);
    box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
  }

  .manager-folder {
    min-width: 0;
  }

  .toolbar-btn {
    justify-self: end;
  }

  .manager-view-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.22rem;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(10, 18, 33, 0.72);
  }

  .view-toggle {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: rgba(186, 230, 253, 0.72);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  }

  .view-toggle:hover {
    color: rgba(236, 254, 255, 0.96);
    background: rgba(14, 165, 233, 0.12);
  }

  .view-toggle.active {
    color: #ecfeff;
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.96), rgba(10, 44, 66, 0.96));
    box-shadow: 0 10px 24px rgba(6, 182, 212, 0.16);
  }

  .manager-summary {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-size: 0.74rem;
    color: rgba(186, 230, 253, 0.72);
    letter-spacing: 0.02em;
  }

  .file-list-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    padding: 0 0.9rem 0.55rem;
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    color: rgba(224, 224, 224, 0.56);
    border-bottom: 1px solid rgba(102, 126, 234, 0.12);
    position: sticky;
    top: 0;
    background: linear-gradient(180deg, rgba(8, 18, 35, 0.98), rgba(8, 18, 35, 0.82));
    z-index: 1;
  }

  .file-list-sort {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }

  .file-list-sort:hover {
    color: rgba(236, 254, 255, 0.92);
  }

  .file-list-sort-wrap[data-sort='ascending'] .file-list-sort::after {
    content: ' ↑';
  }

  .file-list-sort-wrap[data-sort='descending'] .file-list-sort::after {
    content: ' ↓';
  }

  .file-list-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
    padding: 0.2rem;
  }

  .file-list-scroll.icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    align-content: start;
    gap: 0.7rem;
    padding: 0.9rem;
  }

  .file-list-clear-hitbox {
    appearance: none;
    border: 0;
    background: transparent;
    display: block;
    width: 100%;
    min-height: 3rem;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .file-list-scroll.icons .file-list-clear-hitbox {
    grid-column: 1 / -1;
  }

  .file-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.65rem 0.75rem;
    cursor: grab;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .file-row:hover {
    background: rgba(102, 126, 234, 0.08);
  }

  .file-row:active {
    cursor: grabbing;
  }

  .file-row.selected {
    background: rgba(102, 126, 234, 0.16);
  }

  .file-row:focus {
    outline: 2px solid rgba(102, 126, 234, 0.5);
    outline-offset: -2px;
  }

  .file-row-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .file-row-icon {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(10, 18, 33, 0.84);
  }

  .file-row-copy {
    min-width: 0;
    display: grid;
    gap: 0.08rem;
  }

  .file-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e8e8e8;
    font-size: 0.83rem;
    font-weight: 600;
  }

  .file-row-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(186, 230, 253, 0.45);
    font-size: 0.72rem;
  }

  .file-rename-input {
    width: 100%;
    min-height: 32px;
    border: 1px solid rgba(56, 189, 248, 0.26);
    border-radius: 10px;
    background: rgba(10, 18, 33, 0.9);
    color: #f8fafc;
    padding: 0 0.68rem;
    font: inherit;
    outline: none;
  }

  .file-rename-input:focus {
    border-color: rgba(56, 189, 248, 0.52);
    box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
  }

  .file-name-trigger {
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    font: inherit;
    cursor: text;
  }

  .file-row-size,
  .file-row-date {
    font-size: 0.75rem;
    color: rgba(224, 224, 224, 0.58);
  }

  .file-card {
    min-height: 118px;
    border-radius: 18px;
    border: 1px solid rgba(56, 189, 248, 0.12);
    background:
      radial-gradient(120% 120% at 0% 0%, rgba(34, 211, 238, 0.1), transparent 48%),
      linear-gradient(180deg, rgba(11, 22, 40, 0.98), rgba(7, 14, 27, 0.94));
    padding: 0.9rem;
    display: grid;
    grid-template-rows: auto 1fr;
    justify-items: start;
    align-content: start;
    gap: 0.7rem;
    cursor: grab;
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 18px 38px rgba(2, 6, 23, 0.22);
  }

  .file-card:hover {
    transform: translateY(-2px);
    border-color: rgba(103, 232, 249, 0.28);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 22px 42px rgba(2, 6, 23, 0.28);
  }

  .file-card.selected {
    border-color: rgba(103, 232, 249, 0.44);
    box-shadow:
      inset 0 0 0 1px rgba(103, 232, 249, 0.12),
      0 26px 46px rgba(8, 47, 73, 0.28);
  }

  .file-card-art {
    width: 58px;
    height: 58px;
    border-radius: 18px;
    display: grid;
    place-items: center;
    position: relative;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .file-card-copy {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
    width: 100%;
  }

  .file-card-name {
    font-size: 0.88rem;
    font-weight: 650;
    color: rgba(248, 250, 252, 0.98);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tone-default {
    color: #dbeafe;
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.34), rgba(14, 116, 144, 0.18));
  }

  .tone-image {
    color: #ecfeff;
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.42), rgba(59, 130, 246, 0.22));
  }

  .tone-video {
    color: #fae8ff;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.34), rgba(37, 99, 235, 0.18));
  }

  .tone-audio {
    color: #ecfccb;
    background: linear-gradient(135deg, rgba(101, 163, 13, 0.38), rgba(20, 83, 45, 0.22));
  }

  .tone-text {
    color: #fef3c7;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.34), rgba(120, 53, 15, 0.16));
  }

  .tone-archive {
    color: #fde68a;
    background: linear-gradient(135deg, rgba(217, 119, 6, 0.34), rgba(120, 53, 15, 0.22));
  }

  .list-empty {
    padding: 1rem;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.875rem;
  }

  .preview-pane {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .preview-header {
    padding: 1rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.18);
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .preview-title {
    margin: 0;
    color: #f5f5f5;
    font-size: 1rem;
    font-weight: 600;
    max-width: 48ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-meta {
    margin: 0.25rem 0 0;
    color: rgba(224, 224, 224, 0.58);
    font-size: 0.8125rem;
  }

  .preview-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .preview-close-btn {
    margin-left: auto;
  }

  :global(.manager-btn) {
    border: 1px solid rgba(56, 189, 248, 0.22);
    background: rgba(12, 24, 43, 0.82);
    color: rgba(226, 232, 240, 0.92);
    border-radius: 11px;
    min-height: 34px;
    padding: 0 0.82rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }

  :global(.manager-btn:hover) {
    background: rgba(16, 32, 56, 0.96);
  }

  :global(.manager-btn.danger) {
    border-color: rgba(248, 113, 113, 0.45);
    color: #fecaca;
  }

  :global(.manager-btn.danger:hover) {
    background: rgba(248, 113, 113, 0.16);
  }

  .file-manager-divider,
  .workspace-divider {
    position: relative;
    min-height: 0;
    cursor: col-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .file-manager-divider::before,
  .workspace-divider::before {
    content: '';
    width: 1px;
    height: 100%;
    background: linear-gradient(180deg, rgba(34, 211, 238, 0), rgba(34, 211, 238, 0.1), rgba(34, 211, 238, 0));
    transition: background 0.18s ease;
  }

  .file-manager-divider-grip,
  .workspace-divider-grip {
    position: absolute;
    width: 6px;
    height: 52px;
    border-radius: 999px;
    border: 0;
    background: rgba(186, 230, 253, 0.06);
    color: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: none;
    transition: background-color 0.18s ease;
  }

  .file-manager-divider:hover::before,
  .file-manager-divider:focus-visible::before,
  .workspace-divider:hover::before,
  .workspace-divider:focus-visible::before {
    background: linear-gradient(180deg, rgba(34, 211, 238, 0), rgba(34, 211, 238, 0.18), rgba(34, 211, 238, 0));
  }

  .file-manager-divider:hover .file-manager-divider-grip,
  .file-manager-divider:focus-visible .file-manager-divider-grip,
  .workspace-divider:hover .workspace-divider-grip,
  .workspace-divider:focus-visible .workspace-divider-grip {
    background: rgba(186, 230, 253, 0.14);
  }

  .preview-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    scrollbar-width: thin;
  }

  .preview-image,
  .preview-media {
    width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    background: rgba(10, 10, 15, 0.5);
  }

  .preview-audio {
    width: 100%;
    margin-top: 0.5rem;
  }

  .preview-pdf {
    width: 100%;
    min-height: 420px;
    height: 100%;
    border: 0;
    border-radius: 8px;
    background: #fff;
  }

  .preview-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #d9d9d9;
  }

  .preview-message {
    margin: 0;
    color: rgba(224, 224, 224, 0.76);
  }

  .preview-message.error {
    color: #fca5a5;
  }

  .preview-empty {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.9375rem;
  }

  @media (max-width: 900px) {
    .header {
      padding: 0.7rem 1rem 0.9rem;
    }

    .header-dock {
      padding: 0.3rem 0.32rem 0.3rem 0.55rem;
    }

    .header-dock-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .secret-input-wrapper {
      grid-template-columns: 1fr 1fr auto;
    }

    .status-bar {
      padding: 0.75rem 1rem;
    }

    .file-area {
      padding: 1rem;
    }

    .file-area.volume-workspace-active {
      padding: 0;
    }

    .volume-workspace {
      margin: 0;
      width: 100%;
      padding: 0.75rem 0.8rem 0.85rem;
      gap: 0.75rem;
    }

    .workspace-panels {
      grid-template-columns: 1fr !important;
      grid-template-rows: auto auto;
      gap: 0.75rem;
    }

    .identity-editor-panel {
      grid-template-columns: 1fr;
    }

    .time-machine {
      padding: 0.75rem;
    }

    .tm-events {
      grid-auto-columns: minmax(132px, 160px);
    }

    .file-manager {
      grid-template-columns: 1fr !important;
      gap: 0.75rem;
    }

    .file-manager-divider,
    .workspace-divider {
      display: none;
    }

    .file-list-pane,
    .preview-pane {
      border-radius: 18px;
      min-height: 280px;
    }

    .preview-header {
      flex-direction: column;
      align-items: stretch;
    }

    .preview-actions {
      justify-content: flex-start;
    }

    .manager-toolbar-top,
    .manager-toolbar-bottom {
      grid-template-columns: 1fr;
    }

    .toolbar-btn {
      justify-self: stretch;
    }
  }

  @media (hover: none) {
    .mounts-actions {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }

    .mount-add-btn {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }

    .volume-chip.collapsed-shell.parked {
      max-width: min(72vw, 420px);
      opacity: 1;
      transform: none;
      pointer-events: auto;
      border-color: rgba(56, 189, 248, 0.22);
    }
  }

  @media (max-width: 640px) {
    .workspace-toggle {
      font-size: 0.72rem;
      min-width: auto;
      padding: 0 0.68rem;
    }

    :global(.panel-action-btn) {
      min-width: auto;
      width: 100%;
    }

    .mount-add-btn,
    .header-tool-btn {
      width: 30px;
      height: 30px;
    }

    .secret-input-wrapper {
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-areas:
        'address address address'
        'password password password'
        'spinner spinner spinner';
    }

    .secret-input-wrapper > input:first-child {
      grid-area: address;
    }

    .secret-input-wrapper > input:nth-child(2) {
      grid-area: password;
    }

    .loading-spinner {
      grid-area: spinner;
      justify-self: start;
    }

    .header-dock-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .identity-row-head,
    .identity-row-actions {
      align-items: stretch;
    }

    .time-machine-head {
      flex-direction: column;
    }

    .time-machine-actions {
      width: 100%;
      justify-content: space-between;
    }

    .manager-toolbar {
      grid-template-columns: 1fr;
    }

    .file-list-head {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .file-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .file-row-date {
      display: none;
    }
  }
</style>
