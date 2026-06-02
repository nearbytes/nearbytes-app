# IMPLEMENTATION.md — nearbytes-app

State-of-the-art **Files + Chat + Profiles** desktop client with **full feature
parity** to `nearbytes-cli` (`nbf`). This document is the implementation brief:
build against it until every CLI capability is reachable from the UI with
identical semantics, and packaging is fully automatic.

> Scope of this brief: turn the current scaffold (UI shell + typed
> `NearbytesAdapter` boundary + placeholder service) into a working product.
> Do not invent NearBytes domain models — consume the protocol packages.

---

## 0. Non-negotiable constraints (carried from the scaffold)

- **Renderer-first.** All logic that can run in the renderer runs there. Node /
  Electron / crypto / sockets / fs live only in `src/main`, reached exclusively
  through `NearbytesAdapter` (`src/preload` → `window.nb` → `src/main/ipc.ts`).
- **Tailwind-first**, **shadcn-svelte-first**, **Svelte 5 runes**, small files,
  top-down composition, accessible components, no hidden side effects. See
  `SWE/CODING.md`.
- **No invented domain types.** Import them:
  `FileMetadata`, `DirectoryMetadata`, `VolumeFileSystemState`, `FileService`,
  `ReactiveVolume`, `TimelineEvent` from `nearbytes-files`;
  `ChatMessage`, `ChatTimelineItem`, `IdentityProfile`, `IdentityRecord`,
  `publishChatMessage`, `readChatTimeline`, `projectChatTimeline` from
  `nearbytes-chat`; `NearbytesConfig`, `VolumeConfig`, `ProfileConfig`,
  `createFilesystemSkeletonFromConfig`, `readConfig`, `writeConfig`,
  `createFilesystemWatcher` from `nearbytes-skeleton`;
  `createSecret`, `bytesToHex`, `deriveKeys` from `nearbytes-crypto`.

---

## 1. Packaging & bootstrap requirement (DO THIS FIRST)

**Goal:** the app repo consumes its dependencies from GitHub *exactly like
`nearbytes-cli`* — no `portal:`, `link:`, `file:`, or workspace references to
sibling folders. A single `yarn install` fetches everything (protocol packages
**and** the two UI libs) from `github:nearbytes/*`, builds them, and
`yarn dev` "just works".

### 1.1 Dependency declarations

`package.json` `dependencies` use commit-pinned GitHub refs, identical in form
to `nearbytes-cli/package.json`:

```jsonc
"dependencies": {
  "nearbytes-widgets":    "github:nearbytes/nearbytes-widgets#<sha>",
  "nearbytes-components": "github:nearbytes/nearbytes-components#<sha>",
  "nearbytes-chat":       "github:nearbytes/nearbytes-chat#<sha>",
  "nearbytes-crypto":     "github:nearbytes/nearbytes-crypto#<sha>",
  "nearbytes-files":      "github:nearbytes/nearbytes-files#<sha>",
  "nearbytes-log":        "github:nearbytes/nearbytes-log#<sha>",
  "nearbytes-skeleton":   "github:nearbytes/nearbytes-skeleton#<sha>",
  "nearbytes-sync":       "github:nearbytes/nearbytes-sync#<sha>"
}
```

Keep `.yarnrc.yml` with `nodeLinker: node-modules` and:

```yaml
approvedGitRepositories:
  - "https://github.com/nearbytes/*"
  - "ssh://git@github.com/nearbytes/*"
```

`nearbytes-widgets` and `nearbytes-components` must be **published to GitHub**
under the `nearbytes` org (mirrors how `nearbytes-files` etc. already are).
`nearbytes-components` depends on `nearbytes-widgets` via the same `github:`
ref; `nearbytes-widgets` has only npm deps.

### 1.2 Auto-build of the UI libs on install (no manual `yarn build`)

A `git:` dependency is built by Yarn's lifecycle when it exposes a **`prepare`**
script. Both UI libs MUST `svelte-package` themselves on install:

```jsonc
// nearbytes-widgets/package.json and nearbytes-components/package.json
"scripts": { "prepare": "svelte-package", "build": "svelte-package" }
```

Result: `yarn install` in the app clones each git dep, runs its `prepare`,
producing `dist/` that the `"svelte"` / `"types"` export fields point at — no
post-clone manual build, no sibling-folder linking. (`svelte-package`,
`svelte`, `@sveltejs/package`, `tailwindcss` stay in each lib's
`devDependencies` so `prepare` has its toolchain after a git clone.)

### 1.3 One-command dev

`yarn dev` runs `electron-vite dev`. The renderer resolves
`nearbytes-components` / `nearbytes-widgets` via their `"svelte"` export
(`dist/index.js`, built by `prepare`). The main process resolves the protocol
packages via their `"main"` export. No predev build step is needed because
`prepare` already ran during `install`.

```sh
yarn install   # fetch + build ALL packages from GitHub
yarn dev       # launch Electron with HMR
```

`electron-vite` config keeps the protocol packages **external** in the
main/preload builds (they are Node ESM and must `require` real fs/crypto/net at
runtime); the UI libs are bundled into the renderer.

### 1.4 Acceptance test for §1

- Fresh clone of `nearbytes-app`, empty `node_modules`.
- `yarn install && yarn dev` opens the window with **zero** manual build steps
  and **no** reference to any sibling folder path anywhere in the repo.

---

## 2. Runtime architecture (target)

```
┌──────────────────────────────── main process ─────────────────────────────┐
│ NearbytesService                                                           │
│   boot: readConfig → createFilesystemSkeletonFromConfig → createFileService│
│   owns: skeleton{crypto,log,sync}, fileService, volumes:Map<key,Reactive>, │
│         watchers:Map, volumeRegistry:Map<label,secret>, activeVolume,      │
│         timelineCursorHash, config (mutable working copy)                  │
│   mirrors nearbytes-cli/src/cli/context.ts 1:1 for sync correctness        │
└───────────────▲───────────────────────────────────────────┬──────────────┘
                │ ipcMain.handle('nb:invoke')                │ webContents.send('nb:event')
┌───────────────┴─────────── preload (contextBridge) ────────▼──────────────┐
│ window.nb = { invoke(req), on(fn) }                                        │
└───────────────▲───────────────────────────────────────────┬──────────────┘
┌───────────────┴──────────────────── renderer ─────────────▼──────────────┐
│ createIpcAdapter(): NearbytesAdapter   →  provideAdapter()                 │
│ createAppState() ($state tree)         →  provideAppState()                │
│ hydrate(app, adapter): initial load + subscribe push events               │
│ App.svelte → nearbytes-components (FinderShell | ChatPane | SettingsPanel) │
└────────────────────────────────────────────────────────────────────────────┘
```

The main-process service is a faithful port of `context.ts`: same reactive
volume cache, same `createFilesystemWatcher` invalidation, same
`attachSyncInboundRefresh` behaviour, same writer-only downgrade when an
`nbsync` daemon holds the lock. **Sync must behave identically to the CLI** —
reuse the exact functions, do not re-implement replay/materialization.

---

## 3. Feature-parity matrix (CLI → app)

| CLI surface | App surface | Adapter method | Implementation source |
|---|---|---|---|
| `profile add` | Settings ▸ Profiles ▸ Add | `profile.add` | mutate `config.profiles`, `writeConfig`, `skeleton.reloadSync` |
| `profile use` | Profile selector / Profiles list | `profile.use` | set `config.activeProfile`, `reloadSync` |
| `profile list` | Profiles list + selector | `profile.list` | `config.profiles` |
| `profile show` | Profiles ▸ row ▸ "Public key" | `profile.publicKey` | `deriveKeys(createSecret(secret))` → `bytesToHex(pub)` |
| `profile publish` | Profiles ▸ Publish identity | `profile.publish` | `createIdentityRecord` + append to identity channel |
| `profile remove` | Profiles ▸ row ▸ Remove | `profile.remove` | re-elect active, `writeConfig`, `reloadSync` |
| `volume add` | Settings ▸ Hubs ▸ Add | `hub.add` | append `config.volumes`; persist to `volume-session.json` (0600) |
| `volume use` | Sources ▸ Hub click | `hub.use` | `openAndWatch(secret)`; push `VolumeView`; scope chat |
| `volume list` | Sources ▸ Hubs | `hub.list` | registry/`config.volumes` |
| `volume forget` | Hubs ▸ row ▸ Forget | `hub.forget` | drop from registry, close watcher |
| `ls` / `file list` | File browser | `file.list` | `fileService.getReplayContext(secret).fs` → `FileMetadata[]` |
| `put` / `file add` | Browser ▸ drop / + | `file.add` | `fileService.addFile` (encrypt+store blobs), then `flushAndStop` semantics |
| `get` / `file get` | Inspector ▸ Save as… | `file.get` | `fileService` retrieve + decrypt → write to path |
| `rm` / `file remove` | Browser ▸ context menu | `file.remove` | emit `DELETE`, flush |
| `mkdir` / `mv` | Browser ▸ New folder / rename | `file.mkdir`,`file.rename` | emit `MKDIR` / `RENAME` |
| (open in OS) | Inspector ▸ Open | `file.openExternally` | `file.get` to temp + `shell.openPath` |
| `timeline` | Inspector ▸ Version history | `file.timeline` | `fileService` timeline events for path |
| `timeline goto/live` | History ▸ scrubber | `volume.cursor` | set `timelineCursorHash`; read-only view + write-guard |
| `say` | Chat composer | `chat.say` | `publishChatMessage(activeHubSecret, body, activeProfileKeyPair)` |
| `chat [n]` | Chat pane | `chat.read` | `readChatTimeline(hubSecret, log)` → `ChatTimelineItem[]` |
| `friend add` | Settings ▸ Friends ▸ Add | `friend.add` | append `config.friends`, `writeConfig`, `reloadSync` |
| `friend list` | Sources ▸ Friends + Settings | `friend.list` | `config.friends` |
| `friend remove` | Friends ▸ row ▸ Remove | `friend.remove` | drop (key or prefix), `reloadSync` |
| `whoami` | Status ▸ tooltip / About | `service.whoami` | `skeleton.sync` peerId / instance key / active profile |
| `peers` / `monitor` | Status bar ▸ peers popover | `service.peers` | `skeleton.sync.peers()` snapshot |
| WebDAV server | Settings ▸ Sharing | `service.webdav*` | optional: start CLI WebDAV server in main, show URL/creds |
| dev inspect | (dev only) | n/a | optional parity, not user-facing |

Every row is required for parity. Implement in the order of §6.

---

## 4. Adapter contract — method-level spec

Implement `NearbytesService` so each `NearbytesAdapter` method is a thin,
typed wrapper over the protocol packages. **Identical inputs/outputs to the
matching CLI command.** Errors propagate as rejected IPC promises and surface
as toasts in the UI (never swallow).

### 4.1 Profiles (sync identity — `ProfileConfig`)
- `add(name, secret)`: reject on dup name; first profile becomes active;
  `writeConfig` (mode 0600) then `reloadSync(friends, {profiles, activeProfile})`.
- `use(name)`: reject if unknown; set active; `reloadSync`.
- `remove(name)`: re-elect `profiles[0] ?? null`; persist; `reloadSync`.
- `publish(displayName, bio?, asProfile?)`: sign `nb.identity.record.v1` with the
  selected profile keypair; append; flush.
- `publicKey(name?)`: derive from secret; return 130-hex.
- All mutations re-emit a `status` push so the renderer updates the selector.

### 4.2 Hubs / volumes (channel — `VolumeConfig`; hub == volume)
- Registry persisted to `<dataDir>/.nearbytes/volume-session.json`, mode 0600
  (reuse the CLI's `volumeSessionStore`).
- `use(label)`: `openAndWatch(secret)` (reactive volume + fs watcher), set
  `activeVolume`, push `VolumeView` and the hub-scoped chat timeline.
- `forget(label)`: close watcher, drop registry entry.

### 4.3 Files (`FileMetadata` / `DirectoryMetadata`)
- `list()`: from `fileService.getReplayContext(secret).fs`; map to
  `VolumeView { files: FileMetadata[], directories: DirectoryMetadata[] }`.
- `add/get/remove/mkdir/rename`: reuse `nearbytes-files` operations; respect the
  timeline write-guard (`assertTimelineWritesAllowed`) — refuse mutations while
  a historical cursor is set, exactly like the CLI.
- `openExternally(name)`: `get` to an OS temp path, `shell.openPath`.
- Push an updated `VolumeView` after every successful mutation and on watcher
  refresh (peer sync / nbsync), mirroring `attachSyncInboundRefresh`.

### 4.4 Chat (`ChatTimelineItem` / `ChatMessage`)
- `read(limit?)`: `readChatTimeline` on the active hub log; newest `limit`.
- `say(body)`: requires active profile **and** active hub; `publishChatMessage`
  signed by the active profile keypair into the hub log; then re-read and push.
- Live: subscribe to inbound sync events for the hub channel and push `chat`.

### 4.5 Friends (followed profile public keys — global)
- `add(hex)`: lowercase, dedupe, validate 130-hex; persist; `reloadSync`.
- `remove(keyOrPrefix)`: support full key or prefix (CLI parity); `reloadSync`.

### 4.6 Status / peers
- `status()`: `{ text, connectedPeers, serving }` from `skeleton.sync.snapshot()`
  + active profile/hub; `text` is the central startup string.
- Continuous: on every `skeleton.sync.onEvent`, recompute and push `status`.

---

## 5. State-of-the-art UX (minimize cognitive load)

- **Three-pane Finder layout**, dark, rectangular, sub-pixel hairlines. Left
  sources (Hubs + Friends), center files, right chat, minimal vertical separator
  between files and chat. Panes resizable + persisted (size in `localStorage`).
- **One mental model:** selecting a Hub in the left panel simultaneously scopes
  the file browser **and** the chat pane — same channel, no separate "connect"
  step. Friends presence dots reflect live sync peer state.
- **Configurability is first-class, not a modal maze.** Profiles, Hubs, Friends
  each get an inline add-row (label + secret/key + Add) with validation hints
  echoing the CLI's secret formats (`name:password`, 130-hex). Adding a hub
  mounts it immediately; adding a friend starts syncing immediately.
- **Profile selector** top-right: avatar + name + dropdown with check-marked
  active, "Add profile…", and "Copy public key" (for friend exchange).
- **Central textual status** always visible in the bottom bar with a colored
  `StatusIndicator` (syncing → online/offline), peers popover on click.
- **File inspector** (right of browser): live preview primitive, metadata,
  version/history scrubber bound to the timeline cursor, and an Open action.
- **Optimistic + reconciled:** UI mutates the `$state` sub-record immediately,
  the adapter confirms, and the sync push reconciles. Never block the UI on I/O.
- **Drag-and-drop** files into the browser → `file.add`. **Context menus**
  (shadcn `ContextMenu`) for Get / Open / Rename / Remove.
- **Keyboard-first:** ⌘1/⌘2 Files/Configure, ⌘F filter, ⌘↩ send chat, arrow-key
  list navigation, full focus-visible rings.
- **Empty states** everywhere with the next action inline (no dead ends).
- **Accessibility:** real roles (`listbox`/`option`), labelled controls, AA
  contrast on the dark palette, reduced-motion respected.

---

## 6. Build order (incremental, each step shippable)

1. **§1 packaging**: publish UI libs to GitHub with `prepare`; switch app deps to
   `github:`; verify `yarn install && yarn dev` from a clean clone.
2. **Service boot** = port `context.ts` (skeleton, fileService, reactive volume
   cache, watcher, sync inbound refresh, writer-only downgrade).
3. **Profiles + Friends + Hubs** config mutations + `reloadSync` (sync parity).
4. **File list** (read path) + live `VolumeView` push on `hub.use` and watcher.
5. **Chat read + say** scoped to active hub; live push.
6. **File mutations** (add/get/remove/mkdir/rename) with timeline write-guard.
7. **Timeline / version history** cursor (goto/live) + read-only view guard.
8. **Status/peers/whoami** popover; **profile publish**; optional **WebDAV**.
9. **UX polish** per §5; **e2e parity tests** per §7.

---

## 7. Verification (definition of done)

- **Parity harness:** for each §3 row, a scripted scenario that performs the
  action via the adapter and via `nbf` against the same `dataDir` and asserts
  identical resulting log/state (reuse `nearbytes-files` probe scripts as the
  oracle).
- **Sync correctness:** two app instances (or app ↔ `nbf`) sharing a hub secret
  + mutual friend keys converge on files and chat without manual refresh.
- **Daemon coexistence:** app runs read/write against a `dataDir` with a live
  `nbsync` daemon (writer-only downgrade), matching the CLI.
- **Packaging:** clean-clone `yarn install && yarn dev` with no sibling-folder
  refs and no manual build (the §1.4 acceptance test).
- **Type/lint:** `yarn check` clean across all three repos.
- **Tray lifecycle:** closing the window keeps the process resident
  (macOS menu bar / Windows tray / Linux status area); explicit Quit exits.
- **No leaked paths/secrets** to the renderer; config files remain mode 0600.

---

## 8. Explicitly out of scope for this pass

No new protocol features, no schema changes to any `nb.*` record, no bespoke
crypto, no UI state persisted outside `localStorage` (sizes/filters) and the
existing on-disk config/registry the CLI already owns.
