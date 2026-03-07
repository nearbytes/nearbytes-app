const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nearbytesDesktop', {
  getRuntimeConfig: () => ipcRenderer.invoke('nearbytes-desktop:get-runtime-config'),
  fetchRemoteFile: (url) => ipcRenderer.invoke('nearbytes-desktop:fetch-remote-file', url),
  getClipboardImageStatus: () => ipcRenderer.invoke('nearbytes-desktop:get-clipboard-image-status'),
  readClipboardImage: () => ipcRenderer.invoke('nearbytes-desktop:read-clipboard-image'),
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
