<script lang="ts">
  import { openVolume, listFiles, uploadFiles, deleteFile, downloadFile, type Auth, type FileMetadata } from './lib/api.js';
  import { getCachedFiles, setCachedFiles, getCacheTimestamp } from './lib/cache.js';

  const ADDRESS_SECRETS_KEY = 'nearbytes-address-secrets';
  type PreviewKind = 'none' | 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unsupported';

  function getStoredSecret(addr: string): string {
    try {
      const raw = localStorage.getItem(ADDRESS_SECRETS_KEY);
      if (!raw) return '';
      const obj = JSON.parse(raw) as Record<string, string>;
      return obj[addr] ?? '';
    } catch {
      return '';
    }
  }

  function setStoredSecret(addr: string, secret: string): void {
    try {
      const raw = localStorage.getItem(ADDRESS_SECRETS_KEY);
      const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      obj[addr] = secret;
      localStorage.setItem(ADDRESS_SECRETS_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  function clearStoredSecret(addr: string): void {
    try {
      const raw = localStorage.getItem(ADDRESS_SECRETS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, string>;
      delete obj[addr];
      localStorage.setItem(ADDRESS_SECRETS_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  // State: address = main input; effectiveSecret = sent to API
  let address = $state('');
  let addressPassword = $state('');
  let effectiveSecret = $state('');
  let unlockedAddress = $state('');
  let showSecretModal = $state(false);
  let secretModalMode = $state<'remembered' | 'unlock_with_secret'>('remembered');
  let secretInput = $state('');
  let modalError = $state('');
  let fileList = $state<FileMetadata[]>([]);
  let volumeId = $state<string | null>(null);
  let auth = $state<Auth | null>(null);
  let isDragging = $state(false);
  let errorMessage = $state('');
  let isLoading = $state(false);
  let isOffline = $state(false);
  let lastRefresh = $state<number | null>(null);
  let copiedVolumeId = $state(false);
  let wasNewVolume = $state(false); // opened with address, fileCount === 0; after first upload show "Set secret"
  let showSetSecretModal = $state(false);
  let setSecretInput = $state('');
  let searchQuery = $state('');
  let sortBy = $state<'newest' | 'oldest' | 'name' | 'size'>('newest');
  let selectedBlobHash = $state<string | null>(null);
  let previewKind = $state<PreviewKind>('none');
  let previewUrl = $state('');
  let previewText = $state('');
  let previewLoading = $state(false);
  let previewError = $state('');
  let currentPreviewObjectUrl: string | null = null;
  // When address has files but no stored secret: hold data until they set a secret to view
  let pendingUnlockData = $state<{ auth: Auth; volumeId: string; files: FileMetadata[] } | null>(null);
  let showSetSecretToViewModal = $state(false);
  let setSecretToViewInput = $state('');

  const visibleFiles = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? fileList.filter((file) => file.filename.toLowerCase().includes(query))
      : fileList;
    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
      return sorted;
    }
    if (sortBy === 'size') {
      sorted.sort((a, b) => b.size - a.size);
      return sorted;
    }
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      return sorted;
    }
    sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  });

  const selectedFile = $derived.by(
    () => visibleFiles.find((file) => file.blobHash === selectedBlobHash) ?? null
  );

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const a = address.trim();
    const p = addressPassword.trim();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (a === '') {
      effectiveSecret = '';
      unlockedAddress = '';
      showSecretModal = false;
      showSetSecretModal = false;
      pendingUnlockData = null;
      showSetSecretToViewModal = false;
      fileList = [];
      volumeId = null;
      auth = null;
      lastRefresh = null;
      isOffline = false;
      isLoading = false;
      wasNewVolume = false;
      searchQuery = '';
      selectedBlobHash = null;
      previewKind = 'none';
      previewText = '';
      previewError = '';
      previewLoading = false;
      revokePreviewUrl();
      return;
    }
    debounceTimer = setTimeout(() => {
      tryOpenAddress(a, p);
      debounceTimer = null;
    }, 500);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  async function tryOpenAddress(a: string, p: string) {
    if (!a) return;
    const stored = getStoredSecret(a);
    if (stored) {
      if (p && p === stored) {
        try {
          await loadVolume(a);
          effectiveSecret = a;
          unlockedAddress = a;
          showSecretModal = false;
          modalError = '';
        } catch (err) {
          modalError = err instanceof Error ? err.message : 'Failed to open';
          showSecretModal = true;
          secretModalMode = 'remembered';
          secretInput = p;
        }
        return;
      }
      showSecretModal = true;
      secretModalMode = 'remembered';
      modalError = '';
      secretInput = p;
      return;
    }
    const openSecret = p ? `${a}:${p}` : a;
    isLoading = true;
    errorMessage = '';
    modalError = '';
    isOffline = false;
    pendingUnlockData = null;
    showSetSecretToViewModal = false;
    try {
      const response = await openVolume(openSecret);
      const authResult = response.token
        ? { type: 'token' as const, token: response.token }
        : { type: 'secret' as const, secret: openSecret };
      if (response.token) {
        sessionStorage.setItem('nearbytes-token', response.token);
      } else {
        sessionStorage.removeItem('nearbytes-token');
      }
      auth = authResult;
      volumeId = response.volumeId;
      lastRefresh = Date.now();
      errorMessage = response.storageHint ?? '';
      effectiveSecret = openSecret;
      unlockedAddress = a;
      if (response.fileCount > 0) {
        wasNewVolume = false;
        if (p) {
          setStoredSecret(a, p);
          fileList = response.files;
          await setCachedFiles(response.volumeId, response.files);
        } else {
          // Address has files but no stored secret: require setting a secret before showing files
          fileList = [];
          pendingUnlockData = { auth: authResult, volumeId: response.volumeId, files: response.files };
          showSetSecretToViewModal = true;
          setSecretToViewInput = '';
        }
      } else {
        wasNewVolume = true;
        fileList = [];
        await setCachedFiles(response.volumeId, response.files);
      }
    } catch (error) {
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
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    const a = address.trim();
    if (a !== '' && a !== unlockedAddress && effectiveSecret !== '') {
      effectiveSecret = '';
      unlockedAddress = '';
      auth = null;
      volumeId = null;
      fileList = [];
      lastRefresh = null;
      wasNewVolume = false;
      showSecretModal = false;
      showSetSecretModal = false;
      pendingUnlockData = null;
      showSetSecretToViewModal = false;
      modalError = '';
      secretInput = '';
      selectedBlobHash = null;
      previewKind = 'none';
      previewText = '';
      previewError = '';
      previewLoading = false;
      revokePreviewUrl();
    }
  });

  // Load volume with effective secret (called after Unlock)
  async function loadVolume(secret: string) {
    if (!secret) return;
    isLoading = true;
    errorMessage = '';
    modalError = '';
    isOffline = false;
    try {
      const response = await openVolume(secret);
      if (response.token) {
        auth = { type: 'token', token: response.token };
        sessionStorage.setItem('nearbytes-token', response.token);
      } else {
        auth = { type: 'secret', secret };
        sessionStorage.removeItem('nearbytes-token');
      }
      volumeId = response.volumeId;
      fileList = response.files;
      lastRefresh = Date.now();
      errorMessage = response.storageHint ?? '';
      await setCachedFiles(volumeId, response.files);
    } catch (error) {
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
      throw error;
    } finally {
      isLoading = false;
    }
  }

  function handleUnlock() {
    const a = address.trim();
    if (!a) return;
    const secret = secretInput.trim();
    modalError = '';
    if (secretModalMode === 'remembered') {
      const stored = getStoredSecret(a);
      if (stored !== secret) {
        modalError = 'Wrong secret';
        return;
      }
      (async () => {
        try {
          await loadVolume(a);
          effectiveSecret = a;
          unlockedAddress = a;
          showSecretModal = false;
          secretInput = '';
        } catch (err) {
          modalError = err instanceof Error ? err.message : 'Failed to open';
        }
      })();
      return;
    }
    const composite = `${a}:${secret}`;
    (async () => {
      try {
        await loadVolume(composite);
        effectiveSecret = composite;
        unlockedAddress = a;
        showSecretModal = false;
        secretInput = '';
      } catch (err) {
        modalError = err instanceof Error ? err.message : 'Failed to unlock';
      }
    })();
  }

  function handleCancelModal() {
    showSecretModal = false;
    modalError = '';
    secretInput = '';
  }

  function openUnlockWithSecretModal() {
    const a = address.trim();
    const p = addressPassword.trim();
    if (a && p) {
      const composite = `${a}:${p}`;
      (async () => {
        try {
          await loadVolume(composite);
          setStoredSecret(a, p);
          effectiveSecret = composite;
          unlockedAddress = a;
          showSecretModal = false;
          modalError = '';
        } catch (err) {
          modalError = err instanceof Error ? err.message : 'Failed to unlock';
          showSecretModal = true;
          secretModalMode = 'unlock_with_secret';
          secretInput = p;
        }
      })();
      return;
    }
    secretModalMode = 'unlock_with_secret';
    secretInput = p;
    modalError = '';
    showSecretModal = true;
  }

  function handleSetSecretConfirm() {
    const a = address.trim();
    const secret = setSecretInput.trim();
    if (!a || !secret) return;
    setStoredSecret(a, secret);
    showSetSecretModal = false;
    setSecretInput = '';
  }

  function handleSetSecretSkip() {
    showSetSecretModal = false;
    setSecretInput = '';
  }

  async function handleSetSecretToViewConfirm() {
    const a = address.trim();
    const secret = setSecretToViewInput.trim();
    if (!a || !secret || !pendingUnlockData) return;
    setStoredSecret(a, secret);
    fileList = pendingUnlockData.files;
    await setCachedFiles(pendingUnlockData.volumeId, pendingUnlockData.files);
    pendingUnlockData = null;
    showSetSecretToViewModal = false;
    setSecretToViewInput = '';
  }

  function handleSetSecretToViewKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showSetSecretToViewModal = false;
      setSecretToViewInput = '';
      pendingUnlockData = null;
      fileList = [];
      auth = null;
      volumeId = null;
      effectiveSecret = '';
      unlockedAddress = '';
    }
  }

  $effect(() => {
    if (showSetSecretToViewModal) {
      const t = setTimeout(() => document.getElementById('set-secret-to-view-input')?.focus(), 50);
      return () => clearTimeout(t);
    }
  });

  function handleModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleCancelModal();
    }
  }

  // Focus secret input when unlock modal opens
  $effect(() => {
    if (showSecretModal) {
      const t = setTimeout(() => document.getElementById('unlock-secret-input')?.focus(), 50);
      return () => clearTimeout(t);
    }
  });

  // Focus secret input when set-secret modal opens
  $effect(() => {
    if (showSetSecretModal) {
      const t = setTimeout(() => document.getElementById('set-secret-input')?.focus(), 50);
      return () => clearTimeout(t);
    }
  });

  $effect(() => {
    if (visibleFiles.length === 0) {
      selectedBlobHash = null;
      return;
    }
    const selectedStillVisible = selectedBlobHash
      ? visibleFiles.some((file) => file.blobHash === selectedBlobHash)
      : false;
    if (!selectedStillVisible) {
      selectedBlobHash = visibleFiles[0].blobHash;
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
    const file = selectedFile;

    previewError = '';
    previewText = '';
    previewLoading = false;
    revokePreviewUrl();

    if (!file || !auth) {
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
        const blob = await downloadFile(auth, file.blobHash);
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

  function selectFile(file: FileMetadata) {
    selectedBlobHash = file.blobHash;
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
      openFileInViewer(file);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      selectFile(file);
    }
  }

  // Refresh file list
  async function refreshFiles() {
    if (!auth || !volumeId) return;

    try {
      const response = await listFiles(auth);
      fileList = response.files;
      lastRefresh = Date.now();
      isOffline = false;
      errorMessage = '';

      // Update cache
      await setCachedFiles(volumeId, response.files);
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
    }
  }

  // Drag and drop handlers
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;

    if (!auth || !effectiveSecret) {
      errorMessage = 'Please unlock with address and secret first';
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    try {
      errorMessage = '';
      await uploadFiles(auth, files);
      await refreshFiles();
      if (wasNewVolume) {
        wasNewVolume = false;
        showSetSecretModal = true;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('Error uploading files:', error);
    }
  }

  // Delete file
  async function handleDelete(filename: string) {
    if (!auth) return;

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
  if (e.key === 'Delete' && e.target instanceof HTMLElement) {
    const fileItem = e.target.closest('[data-filename]');
    if (fileItem) {
      const filename = fileItem.getAttribute('data-filename');
      if (filename && auth) {
        handleDelete(filename);
      }
    }
  }
}} />

<div class="app">
  <!-- Header with branding and secret input -->
  <header class="header">
    <div class="header-content">
      <div class="brand">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 class="brand-title">Nearbytes</h1>
      </div>
      <div class="secret-input-wrapper">
        <input
          type="text"
          placeholder="Enter address..."
          bind:value={address}
          class="secret-input"
          aria-label="Volume address"
        />
        <input
          type="password"
          placeholder="Password (optional)"
          bind:value={addressPassword}
          class="secret-input password-input"
          aria-label="Optional volume password"
          autocomplete="current-password"
        />
        {#if isLoading}
          <span class="loading-spinner"></span>
        {/if}
      </div>
    </div>
  </header>

  <!-- Status bar -->
  {#if volumeId || errorMessage || isOffline}
    <div class="status-bar">
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
      {#if volumeId && !isLoading}
        <button class="refresh-btn" onclick={refreshFiles} title="Refresh file list">
          ↻ Refresh
        </button>
      {/if}
    </div>
  {/if}

  <!-- Main file area -->
  <main
    class="file-area"
    class:dragging={isDragging}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if address.trim() === ''}
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
    {:else if showSecretModal}
      <!-- Unlock modal is shown; empty state until unlocked -->
      <div class="empty-state">
        <div class="empty-content">
          <p class="empty-hint">Enter secret in the popup to unlock</p>
        </div>
      </div>
    {:else if showSetSecretToViewModal}
      <!-- Set secret to view modal is shown -->
      <div class="empty-state">
        <div class="empty-content">
          <p class="empty-hint">Set a secret in the popup to view files</p>
        </div>
      </div>
    {:else if fileList.length === 0 && !isLoading}
      <!-- Empty volume: drop zone + Unlock with secret -->
      <div class="empty-state">
        <div class="empty-content">
          <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
            <path d="M8 20V44L32 56L56 44V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
            <path d="M32 32V56" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
          </svg>
          <p class="empty-hint">No files yet</p>
          <p class="empty-subhint">Drop files here to add them</p>
          <button type="button" class="unlock-with-secret-link" onclick={openUnlockWithSecretModal}>
            Unlock with secret
          </button>
        </div>
      </div>
    {:else}
      <div class="file-manager">
        <section class="file-list-pane">
          <div class="manager-toolbar">
            <input
              type="text"
              class="manager-search"
              placeholder="Search files"
              bind:value={searchQuery}
              aria-label="Search files"
            />
            <select class="manager-sort" bind:value={sortBy} aria-label="Sort files">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </div>
          <div class="file-list-head">
            <span>Name</span>
            <span>Size</span>
            <span>Date</span>
          </div>
          {#if visibleFiles.length === 0}
            <div class="list-empty">No files match your search.</div>
          {:else}
            <div class="file-list-scroll">
              {#each visibleFiles as file (file.blobHash)}
                <div
                  class="file-row"
                  class:selected={selectedBlobHash === file.blobHash}
                  data-filename={file.filename}
                  tabindex="0"
                  role="button"
                  onclick={() => selectFile(file)}
                  ondblclick={() => openFileInViewer(file)}
                  onkeydown={(e) => handleFileRowKeydown(e, file)}
                >
                  <span class="file-row-name" title={file.filename}>{file.filename}</span>
                  <span class="file-row-size">{formatSize(file.size)}</span>
                  <span class="file-row-date">{formatShortDate(file.createdAt)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>
        <section class="preview-pane">
          {#if selectedFile}
            <div class="preview-header">
              <div>
                <h3 class="preview-title" title={selectedFile.filename}>{selectedFile.filename}</h3>
                <p class="preview-meta">
                  {selectedFile.mimeType || 'Unknown type'} • {formatSize(selectedFile.size)} • {formatDate(selectedFile.createdAt)}
                </p>
              </div>
              <div class="preview-actions">
                <button type="button" class="manager-btn" onclick={() => openFileInViewer(selectedFile)}>
                  Open
                </button>
                <button type="button" class="manager-btn" onclick={() => handleDownload(selectedFile)}>
                  Download
                </button>
                <button type="button" class="manager-btn danger" onclick={() => handleDelete(selectedFile.filename)}>
                  Delete
                </button>
              </div>
            </div>
            <div class="preview-body">
              {#if previewLoading}
                <p class="preview-message">Loading preview…</p>
              {:else if previewError}
                <p class="preview-message error">{previewError}</p>
              {:else if previewKind === 'image' && previewUrl}
                <img class="preview-image" src={previewUrl} alt={"Preview of " + selectedFile.filename} />
              {:else if previewKind === 'video' && previewUrl}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video class="preview-media" controls src={previewUrl}></video>
              {:else if previewKind === 'audio' && previewUrl}
                <audio class="preview-audio" controls src={previewUrl}></audio>
              {:else if previewKind === 'pdf' && previewUrl}
                <iframe class="preview-pdf" src={previewUrl} title={"PDF preview: " + selectedFile.filename}></iframe>
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
      </div>
    {/if}
  </main>

  <!-- Unlock volume modal -->
  {#if showSecretModal}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-modal-title"
      tabindex="-1"
      onkeydown={handleModalKeydown}
    >
      <div class="modal-content">
        <h2 id="unlock-modal-title" class="modal-title">
          {secretModalMode === 'remembered' ? 'Enter secret' : 'Unlock with secret'}
        </h2>
        <p class="modal-hint">
          {#if secretModalMode === 'remembered'}
            Enter the secret you set for this address. You need it to open this volume.
          {:else}
            Enter the secret to open an address:secret volume.
          {/if}
        </p>
        <label for="unlock-secret-input" class="visually-hidden">Secret</label>
        <input
          id="unlock-secret-input"
          type="password"
          class="modal-input"
          placeholder="Secret"
          bind:value={secretInput}
          aria-label="Secret to unlock volume"
          onkeydown={(e) => e.key === 'Enter' && handleUnlock()}
        />
        {#if modalError}
          <p class="modal-error" role="alert">{modalError}</p>
        {/if}
        <div class="modal-actions">
          <button type="button" class="modal-btn secondary" onclick={handleCancelModal}>
            Cancel
          </button>
          <button type="button" class="modal-btn primary" onclick={handleUnlock}>
            Unlock
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Set secret after first upload (new volume) -->
  {#if showSetSecretModal}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-secret-modal-title"
      tabindex="-1"
      onkeydown={(e) => e.key === 'Escape' && handleSetSecretSkip()}
    >
      <div class="modal-content">
        <h2 id="set-secret-modal-title" class="modal-title">Set a secret to protect this volume</h2>
        <p class="modal-hint">You will need this secret next time you open this address. It is stored only on this device.</p>
        <label for="set-secret-input" class="visually-hidden">Secret</label>
        <input
          id="set-secret-input"
          type="password"
          class="modal-input"
          placeholder="Secret"
          bind:value={setSecretInput}
          aria-label="Secret to protect volume"
          onkeydown={(e) => e.key === 'Enter' && handleSetSecretConfirm()}
        />
        <div class="modal-actions">
          <button type="button" class="modal-btn secondary" onclick={handleSetSecretSkip}>
            Skip
          </button>
          <button type="button" class="modal-btn primary" onclick={handleSetSecretConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Set secret to view files (address has files but no stored secret) -->
  {#if showSetSecretToViewModal}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-secret-to-view-modal-title"
      tabindex="-1"
      onkeydown={handleSetSecretToViewKeydown}
    >
      <div class="modal-content">
        <h2 id="set-secret-to-view-modal-title" class="modal-title">Set a secret to view files</h2>
        <p class="modal-hint">This address has files. Set a secret to unlock and view them. You will need this secret next time you open this address.</p>
        <label for="set-secret-to-view-input" class="visually-hidden">Secret</label>
        <input
          id="set-secret-to-view-input"
          type="password"
          class="modal-input"
          placeholder="Secret"
          bind:value={setSecretToViewInput}
          aria-label="Secret to view files"
          onkeydown={(e) => e.key === 'Enter' && handleSetSecretToViewConfirm()}
        />
        <div class="modal-actions">
          <button type="button" class="modal-btn primary" onclick={handleSetSecretToViewConfirm}>
            Set secret and view files
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(html, body, #app) {
    height: 100%;
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }

  .app {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
    overflow: hidden;
  }

  /* Header */
  .header {
    background: rgba(26, 26, 46, 0.8);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(102, 126, 234, 0.2);
    padding: 1.5rem 2rem;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-content {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 2rem;
    width: 100%;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .brand-icon {
    width: 32px;
    height: 32px;
    color: #667eea;
  }

  .brand-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .secret-input-wrapper {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
  }

  .secret-input {
    width: 100%;
    padding: 0.875rem 1.25rem;
    font-size: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(102, 126, 234, 0.3);
    border-radius: 12px;
    color: #e0e0e0;
    outline: none;
    transition: all 0.2s ease;
  }

  .secret-input:focus {
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
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

  /* Status bar */
  .status-bar {
    background: rgba(10, 10, 15, 0.6);
    border-bottom: 1px solid rgba(102, 126, 234, 0.1);
    padding: 0.75rem 2rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    font-size: 0.875rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
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
    background: rgba(102, 126, 234, 0.1);
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 6px;
    padding: 0.25rem 0.75rem;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
    color: #667eea;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .volume-id-btn:hover {
    background: rgba(102, 126, 234, 0.2);
    border-color: #667eea;
  }

  .copied-indicator {
    margin-left: 0.5rem;
    color: #4ade80;
    font-size: 0.75rem;
  }

  .offline-indicator {
    color: #fbbf24;
  }

  .error-indicator {
    color: #f87171;
  }

  .refresh-btn {
    background: rgba(102, 126, 234, 0.2);
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 6px;
    padding: 0.375rem 0.875rem;
    color: #667eea;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
    margin-left: auto;
  }

  .refresh-btn:hover {
    background: rgba(102, 126, 234, 0.3);
    border-color: #667eea;
  }

  /* File area */
  .file-area {
    flex: 1;
    min-height: 0;
    padding: 2rem;
    overflow: hidden;
    transition: background-color 0.3s ease;
  }

  .file-area.dragging {
    background: rgba(102, 126, 234, 0.1);
    border: 2px dashed #667eea;
    border-radius: 12px;
    margin: 1rem;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
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

  .unlock-with-secret-link {
    margin-top: 1rem;
    background: none;
    border: none;
    color: #667eea;
    font-size: 0.9375rem;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .unlock-with-secret-link:hover {
    color: #5a6fd6;
  }

  /* File manager */
  .file-manager {
    height: 100%;
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 1rem;
  }

  .file-list-pane {
    min-height: 0;
    background: rgba(26, 26, 46, 0.55);
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .manager-toolbar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.18);
  }

  .manager-search,
  .manager-sort {
    border: 1px solid rgba(102, 126, 234, 0.35);
    background: rgba(10, 10, 15, 0.35);
    color: #e0e0e0;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    outline: none;
  }

  .manager-search:focus,
  .manager-sort:focus {
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.12);
  }

  .file-list-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    color: rgba(224, 224, 224, 0.56);
    border-bottom: 1px solid rgba(102, 126, 234, 0.12);
  }

  .file-list-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-width: none;
  }

  .file-list-scroll::-webkit-scrollbar {
    display: none;
  }

  .file-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0.75rem;
    cursor: default;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.15s ease;
  }

  .file-row:hover {
    background: rgba(102, 126, 234, 0.08);
  }

  .file-row.selected {
    background: rgba(102, 126, 234, 0.16);
  }

  .file-row:focus {
    outline: 2px solid rgba(102, 126, 234, 0.5);
    outline-offset: -2px;
  }

  .file-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e8e8e8;
  }

  .file-row-size,
  .file-row-date {
    font-size: 0.75rem;
    color: rgba(224, 224, 224, 0.58);
  }

  .list-empty {
    padding: 1rem;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.875rem;
  }

  .preview-pane {
    min-height: 0;
    background: rgba(26, 26, 46, 0.55);
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
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

  .manager-btn {
    border: 1px solid rgba(102, 126, 234, 0.35);
    background: rgba(10, 10, 15, 0.35);
    color: #d9e2ff;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .manager-btn:hover {
    background: rgba(102, 126, 234, 0.18);
  }

  .manager-btn.danger {
    border-color: rgba(248, 113, 113, 0.45);
    color: #fecaca;
  }

  .manager-btn.danger:hover {
    background: rgba(248, 113, 113, 0.16);
  }

  .preview-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    scrollbar-width: none;
  }

  .preview-body::-webkit-scrollbar {
    display: none;
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
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.9375rem;
  }

  /* Unlock modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }

  .modal-content {
    background: #1a1a2e;
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 12px;
    padding: 1.5rem;
    min-width: 320px;
    max-width: 420px;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  }

  .modal-title {
    margin: 0 0 0.75rem;
    font-size: 1.25rem;
    font-weight: 600;
    color: #e0e0e0;
  }

  .modal-hint {
    font-size: 0.875rem;
    color: rgba(224, 224, 224, 0.6);
    margin: 0 0 1rem;
    line-height: 1.4;
  }

  .modal-input {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(102, 126, 234, 0.3);
    border-radius: 8px;
    color: #e0e0e0;
    outline: none;
    margin-bottom: 1rem;
    box-sizing: border-box;
  }

  .modal-input:focus {
    border-color: #667eea;
  }

  .modal-input::placeholder {
    color: rgba(224, 224, 224, 0.4);
  }

  .modal-error {
    color: #f87171;
    font-size: 0.875rem;
    margin: -0.5rem 0 1rem;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .modal-btn {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    font-size: 0.9375rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .modal-btn.primary {
    background: #667eea;
    border: 1px solid #667eea;
    color: #fff;
  }

  .modal-btn.primary:hover {
    background: #5a6fd6;
    border-color: #5a6fd6;
  }

  .modal-btn.secondary {
    background: transparent;
    border: 1px solid rgba(224, 224, 224, 0.3);
    color: rgba(224, 224, 224, 0.9);
  }

  .modal-btn.secondary:hover {
    border-color: rgba(224, 224, 224, 0.5);
    background: rgba(255, 255, 255, 0.05);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 900px) {
    .header {
      padding: 1rem;
    }

    .header-content {
      gap: 1rem;
      flex-direction: column;
      align-items: stretch;
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

    .file-manager {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .file-list-pane {
      max-height: 38vh;
    }

    .preview-header {
      flex-direction: column;
      align-items: stretch;
    }

    .preview-actions {
      justify-content: flex-start;
    }
  }

  @media (max-width: 640px) {
    .secret-input-wrapper {
      grid-template-columns: 1fr;
    }

    .loading-spinner {
      justify-self: start;
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
