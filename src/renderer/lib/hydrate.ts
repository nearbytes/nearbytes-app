/** Wire the adapter into the app-state tree: initial load + live push events. */
import type { AppState, NearbytesAdapter } from 'nearbytes-components';
import type { StatusKind } from 'nearbytes-widgets';

export async function hydrate(app: AppState, adapter: NearbytesAdapter): Promise<void> {
  // Engine auto-restores the last-used hub from ui-state.json on boot.
  // We still call hub.active() so the renderer reflects what the engine opened.
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
  app.friends = friends;
  app.status = { text: status.text, kind: status.serving ? 'online' : 'offline' };
  if (whoami) {
    app.identity = { publicKey: whoami.activeProfileKey || null, peerId: whoami.peerId || null };
  }

  // If the engine restored a hub, reflect it. Otherwise fall back to the first
  // registered hub (first-ever boot before ui-state.json exists).
  const hubToUse = activeHub ?? (hubs.length > 0 ? hubs[0]?.label ?? null : null);
  if (hubToUse !== null) {
    try {
      if (activeHub === null) await adapter.hub.use(hubToUse); // engine didn't auto-open
      app.activeHub = hubToUse;
    } catch {
      /* best-effort — sidebar lets the user pick manually */
    }
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
