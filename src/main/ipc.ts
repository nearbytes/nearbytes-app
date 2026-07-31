import { ipcMain } from 'electron';
import { IPC, type InvokeRequest } from '../shared/ipc.js';
import type { NearbytesService } from './service.js';

type Handler = (svc: NearbytesService, args: ReadonlyArray<unknown>) => unknown;

const ROUTES: Record<string, Handler> = {
  'service.status': (s) => s.status(),
  'service.whoami': (s) => s.whoami(),
  'service.peers': (s) => s.peers(),
  'debug.syncTraceStart': (s) => s.syncTraceStart(),
  'debug.syncTraceStop': (s) => s.syncTraceStop(),
  'profile.list': (s) => s.profileList(),
  'profile.active': (s) => s.activeProfile(),
  'profile.add': (s, a) => s.profileAdd(a[0] as string, a[1] as string),
  'profile.use': (s, a) => s.profileUse(a[0] as string),
  'profile.remove': (s, a) => s.profileRemove(a[0] as string),
  'profile.update': (s, a) => s.profileUpdate(a[0] as string, a[1] as { name?: string; secret?: string }),
  'profile.reorder': (s, a) => s.profileReorder(a[0] as string[]),
  'profile.publish': (s, a) => s.profilePublish(a[0] as string, a[1] as string | undefined, a[2] as string | undefined),
  'profile.publicKey': (s, a) => s.profilePublicKey(a[0] as string | undefined),
  'hub.list': (s) => s.hubList(),
  'hub.active': (s) => s.hubActive(),
  'hub.add': (s, a) => s.hubAdd(a[0] as string, a[1] as string),
  'hub.use': (s, a) => s.hubUse(a[0] as string),
  'hub.forget': (s, a) => s.hubForget(a[0] as string),
  'hub.update': (s, a) => s.hubUpdate(a[0] as string, a[1] as { label?: string; secret?: string }),
  'hub.reorder': (s, a) => s.hubReorder(a[0] as string[]),
  'friend.list': (s) => s.friendList(),
  'friend.add': (s, a) => s.friendAdd(a[0] as string),
  'friend.remove': (s, a) => s.friendRemove(a[0] as string),
  'friend.reorder': (s, a) => s.friendReorder(a[0] as string[]),
  'chat.read': (s) => s.chatRead(),
  'chat.say': (s, a) => s.chatSay(a[0] as string),
  'volume.cursor': (s) => s.timelineCursor(),
  'volume.goto': (s, a) => s.timelineGoto(a[0] as string),
  'volume.live': (s) => s.timelineLive(),
  'file.list': (s) => s.fileView(),
  'file.add': (s, a) => s.fileAdd(a[0] as string, a[1] as string | undefined),
  'file.addBytes': (s, a) => s.fileAddBytes(a[0] as string, a[1] as Uint8Array),
  'file.get': (s, a) => s.fileGet(a[0] as string, a[1] as string),
  'file.remove': (s, a) => s.fileRemove(a[0] as string),
  'file.mkdir': (s, a) => s.fileMkdir(a[0] as string),
  'file.rename': (s, a) => s.fileRename(a[0] as string, a[1] as string),
  'file.timeline': (s) => s.fileTimeline(),
  'file.openExternally': (s, a) => s.fileOpenExternally(a[0] as string)
};

export function registerIpc(svc: NearbytesService): void {
  ipcMain.handle(IPC.invoke, async (_e, req: InvokeRequest) => {
    const route = ROUTES[`${req.api}.${req.method}`];
    if (route === undefined) throw new Error(`Unknown route ${req.api}.${req.method}`);
    return route(svc, req.args);
  });
}
