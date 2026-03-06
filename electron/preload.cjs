const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nearbytesDesktop', {
  getRuntimeConfig: () => ipcRenderer.invoke('nearbytes-desktop:get-runtime-config'),
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
