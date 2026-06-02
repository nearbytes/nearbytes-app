import { ipcMain } from 'electron';
import { IPC, type InvokeRequest } from '../shared/ipc.js';
import type { NearbytesService } from './service.js';

type Handler = (svc: NearbytesService, args: ReadonlyArray<unknown>) => unknown;

const ROUTES: Record<string, Handler> = {
  'service.status': (s) => s.status(),
  'profile.list': (s) => s.profileList(),
  'profile.active': (s) => s.activeProfile(),
  'profile.add': (s, a) => s.profileAdd(a[0] as string, a[1] as string),
  'profile.use': (s, a) => s.profileUse(a[0] as string),
  'profile.remove': (s, a) => s.profileRemove(a[0] as string),
  'profile.publish': () => undefined,
  'profile.publicKey': () => '',
  'hub.list': (s) => s.hubList(),
  'hub.active': (s) => s.hubActive(),
  'hub.add': (s, a) => s.hubAdd(a[0] as string, a[1] as string),
  'hub.use': (s, a) => s.hubUse(a[0] as string),
  'hub.forget': (s, a) => s.hubForget(a[0] as string),
  'friend.list': (s) => s.friendList(),
  'friend.add': (s, a) => s.friendAdd(a[0] as string),
  'friend.remove': (s, a) => s.friendRemove(a[0] as string),
  'chat.read': (s) => s.chatRead(),
  'chat.say': (s, a) => s.chatSay(a[0] as string),
  'file.list': (s) => s.fileView(),
  'file.add': (s, a) => s.fileAdd(a[0] as string, a[1] as string | undefined),
  'file.get': (s, a) => s.fileGet(a[0] as string, a[1] as string),
  'file.remove': (s, a) => s.fileRemove(a[0] as string),
  'file.openExternally': (s, a) => s.fileOpenExternally(a[0] as string)
};

export function registerIpc(svc: NearbytesService): void {
  ipcMain.handle(IPC.invoke, async (_e, req: InvokeRequest) => {
    const route = ROUTES[`${req.api}.${req.method}`];
    if (route === undefined) throw new Error(`Unknown route ${req.api}.${req.method}`);
    return route(svc, req.args);
  });
}
