/** IPC contract shared by main + preload + renderer. Single source of truth. */
export const IPC = {
  invoke: 'nb:invoke',
  event: 'nb:event'
} as const;

/** A namespaced adapter call: `${api}.${method}(...args)`. */
export interface InvokeRequest {
  readonly api: 'profile' | 'hub' | 'volume' | 'file' | 'chat' | 'friend' | 'service';
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

/** Push events from main → renderer (sync-driven snapshots). */
export type PushEvent =
  | { readonly channel: 'status'; readonly payload: unknown }
  | { readonly channel: 'volume'; readonly payload: unknown }
  | { readonly channel: 'chat'; readonly payload: unknown };
