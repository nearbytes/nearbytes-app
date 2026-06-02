/**
 * Preload — the ONLY bridge between renderer and main. Exposes a minimal,
 * typed surface on `window.nb`; the renderer's adapter implementation
 * (src/renderer/lib/ipcAdapter.ts) builds NearbytesAdapter on top of it.
 * No Node globals leak to the renderer (contextIsolation on).
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type InvokeRequest, type PushEvent } from '../shared/ipc.js';

const api = {
  invoke(req: InvokeRequest): Promise<unknown> {
    return ipcRenderer.invoke(IPC.invoke, req);
  },
  on(fn: (e: PushEvent) => void): () => void {
    const listener = (_: unknown, e: PushEvent) => fn(e);
    ipcRenderer.on(IPC.event, listener);
    return () => ipcRenderer.removeListener(IPC.event, listener);
  }
};

contextBridge.exposeInMainWorld('nb', api);

export type NbBridge = typeof api;
