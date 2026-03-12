const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nearbytesDesktop', {
  getRuntimeConfig: () => ipcRenderer.invoke('nearbytes-desktop:get-runtime-config'),
  fetchRemoteFile: (url) => ipcRenderer.invoke('nearbytes-desktop:fetch-remote-file', url),
  getClipboardImageStatus: () => ipcRenderer.invoke('nearbytes-desktop:get-clipboard-image-status'),
  readClipboardImage: () => ipcRenderer.invoke('nearbytes-desktop:read-clipboard-image'),
  loadUiState: () => ipcRenderer.invoke('nearbytes-desktop:load-ui-state'),
  getUpdaterState: () => ipcRenderer.invoke('nearbytes-desktop:get-updater-state'),
  installDownloadedUpdate: () => ipcRenderer.invoke('nearbytes-desktop:install-downloaded-update'),
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
  saveUiState: (state) => ipcRenderer.invoke('nearbytes-desktop:save-ui-state', state),
  chooseDirectory: (initialPath) => ipcRenderer.invoke('nearbytes-desktop:choose-directory', initialPath),
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
