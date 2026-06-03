/**
 * Renderer-side NearbytesAdapter — the only place the renderer talks to the
 * preload bridge. Everything above this file is pure UI over typed methods.
 */
import type {
  NearbytesAdapter, SyncStatus, VolumeView, Whoami
} from 'nearbytes-components';
import type { ProfileConfig, VolumeConfig } from 'nearbytes-skeleton';
import type { ChatTimelineItem } from 'nearbytes-chat';
import type { TimelineEvent } from 'nearbytes-files';
import type { PushEvent } from '../../shared/ipc.js';

function call<T>(api: string, method: string, ...args: unknown[]): Promise<T> {
  return window.nb.invoke({ api: api as never, method, args }) as Promise<T>;
}

function channel<T>(name: PushEvent['channel'], fn: (p: T) => void): () => void {
  return window.nb.on((e) => { if (e.channel === name) fn(e.payload as T); });
}

export function createIpcAdapter(): NearbytesAdapter {
  return {
    status: () => call<SyncStatus>('service', 'status'),
    onStatus: (fn) => channel<SyncStatus>('status', fn),
    onActiveVolume: (fn) => channel<VolumeView>('volume', fn),
    onChat: (fn) => channel<ReadonlyArray<ChatTimelineItem>>('chat', fn),

    profile: {
      list: () => call<ProfileConfig[]>('profile', 'list'),
      add: (n, s) => call('profile', 'add', n, s),
      use: (n) => call('profile', 'use', n),
      remove: (n) => call('profile', 'remove', n),
      update: (n, patch) => call('profile', 'update', n, patch),
      reorder: (names) => call('profile', 'reorder', names),
      publish: (d, b, as) => call('profile', 'publish', d, b, as),
      active: () => call('profile', 'active'),
      publicKey: (n) => call<string>('profile', 'publicKey', n)
    },
    hub: {
      list: () => call<VolumeConfig[]>('hub', 'list'),
      add: (l, s) => call('hub', 'add', l, s),
      use: (l) => call('hub', 'use', l),
      forget: (l) => call('hub', 'forget', l),
      update: (l, patch) => call('hub', 'update', l, patch),
      reorder: (labels) => call('hub', 'reorder', labels),
      active: () => call('hub', 'active')
    },
    file: {
      list: () => call<VolumeView>('file', 'list'),
      add: (p, n) => call('file', 'add', p, n),
      get: (n, o) => call('file', 'get', n, o),
      remove: (n) => call('file', 'remove', n),
      mkdir: (p) => call('file', 'mkdir', p),
      rename: (f, t) => call('file', 'rename', f, t),
      timeline: () => call<TimelineEvent[]>('file', 'timeline'),
      openExternally: (n) => call('file', 'openExternally', n)
    },
    chat: {
      read: (limit) => call<ChatTimelineItem[]>('chat', 'read', limit),
      say: (b) => call('chat', 'say', b)
    },
    friend: {
      list: () => call<string[]>('friend', 'list'),
      add: (k) => call('friend', 'add', k),
      remove: (k) => call('friend', 'remove', k),
      reorder: (keys) => call('friend', 'reorder', keys)
    },
    whoami: () => call<Whoami>('service', 'whoami'),
    peers: () => call<ReadonlyArray<unknown>>('service', 'peers')
  };
}
