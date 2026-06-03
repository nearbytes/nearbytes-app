/** Wire the adapter into the app-state tree: initial load + live push events. */
import type { AppState, NearbytesAdapter } from 'nearbytes-components';
import type { StatusKind } from 'nearbytes-widgets';

export async function hydrate(app: AppState, adapter: NearbytesAdapter): Promise<void> {
  const [profiles, activeProfile, hubs, activeHub, friends, status, whoami] = await Promise.all([
    adapter.profile.list(),
    adapter.profile.active(),
    adapter.hub.list(),
    adapter.hub.active(),
    adapter.friend.list(),
    adapter.status(),
    adapter.whoami().catch(() => null)
  ]);
  app.profiles = profiles;
  app.activeProfile = activeProfile;
  app.hubs = hubs;
  app.activeHub = activeHub;
  app.friends = friends;
  app.status = { text: status.text, kind: status.serving ? 'online' : 'offline' };
  if (whoami) {
    app.identity = { publicKey: whoami.activeProfileKey || null, peerId: whoami.peerId || null };
  }

  adapter.onStatus((s) => {
    const kind = (s as { kind?: StatusKind }).kind ?? (s.serving ? 'online' : 'offline');
    app.status = { text: s.text, kind };
  });
  adapter.onActiveVolume((v) => {
    app.files.items = [...v.files];
    app.files.directories = [...v.directories];
  });
  adapter.onChat((items) => { app.chat.items = [...items]; });
}
