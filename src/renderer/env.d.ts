/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { InvokeRequest, PushEvent } from '../shared/ipc.js';

declare global {
  interface Window {
    nb: {
      invoke(req: InvokeRequest): Promise<unknown>;
      on(fn: (e: PushEvent) => void): () => void;
    };
  }
}
export {};
