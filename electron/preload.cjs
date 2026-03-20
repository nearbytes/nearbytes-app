const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nearbytesDesktop', {
  getRuntimeConfig: () => ipcRenderer.invoke('nearbytes-desktop:get-runtime-config'),
  connectDeepLinks: () => ipcRenderer.invoke('nearbytes-desktop:connect-deep-links'),
  fetchRemoteFile: (url) => ipcRenderer.invoke('nearbytes-desktop:fetch-remote-file', url),
  getClipboardImageStatus: () => ipcRenderer.invoke('nearbytes-desktop:get-clipboard-image-status'),
  readClipboardImage: () => ipcRenderer.invoke('nearbytes-desktop:read-clipboard-image'),
  loadUiState: () => ipcRenderer.invoke('nearbytes-desktop:load-ui-state'),
  getUpdaterState: () => ipcRenderer.invoke('nearbytes-desktop:get-updater-state'),
  installDownloadedUpdate: () => ipcRenderer.invoke('nearbytes-desktop:install-downloaded-update'),
  debugTriggerUpdateInstall: () => ipcRenderer.invoke('nearbytes-desktop:debug-trigger-update-install'),
  openUpdateReleasePage: () => ipcRenderer.invoke('nearbytes-desktop:open-update-release-page'),
  onUpdaterState: (listener) => {
    if (typeof listener !== 'function') {
      return () => {};
    }
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('nearbytes-desktop:update-state', wrapped);
    return () => {
      ipcRenderer.removeListener('nearbytes-desktop:update-state', wrapped);
    };
  },
  onDeepLink: (listener) => {
    if (typeof listener !== 'function') {
      return () => {};
    }
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('nearbytes-desktop:deep-link', wrapped);
    return () => {
      ipcRenderer.removeListener('nearbytes-desktop:deep-link', wrapped);
    };
  },
  saveUiState: (state) => ipcRenderer.invoke('nearbytes-desktop:save-ui-state', state),
  saveThemeRegistry: (registry) => ipcRenderer.invoke('nearbytes-desktop:save-theme-registry', registry),
  exportLogoPng: (dataUrl) => ipcRenderer.invoke('nearbytes-desktop:export-logo-png', dataUrl),
  chooseDirectory: (initialPath) => ipcRenderer.invoke('nearbytes-desktop:choose-directory', initialPath),
  readRuntimeLogs: () => ipcRenderer.invoke('nearbytes-desktop:read-runtime-logs'),
  getApiBaseUrl: async () => {
    const config = await ipcRenderer.invoke('nearbytes-desktop:get-runtime-config');
    return config.apiBaseUrl ?? '';
  },
  getDesktopToken: async () => {
    const config = await ipcRenderer.invoke('nearbytes-desktop:get-runtime-config');
    return config.desktopToken ?? '';
  },
  isDesktop: () => true,
});
