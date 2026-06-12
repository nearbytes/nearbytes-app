/**
 * NearbytesService — main-process shell around the shared `nearbytes-engine`.
 *
 * It owns NO domain logic: profiles, hubs, friends, files, chat, sync — all of
 * it lives in `NearbytesEngine`, the exact same core the CLI runs on. This
 * class only bridges the engine's change stream onto Electron IPC pushes and
 * adds the one genuinely UI-shell concern (open-in-OS via `shell.openPath`).
 */
import { NearbytesEngine, type EngineEvent } from 'nearbytes-engine';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { shell } from 'electron';
import type { PushEvent } from '../shared/ipc.js';

export type Emit = (e: PushEvent) => void;

export class NearbytesService {
  private constructor(private readonly engine: NearbytesEngine, private readonly emit: Emit) {}

  static async boot(emit: Emit): Promise<NearbytesService> {
    emit({ channel: 'status', payload: { text: 'Starting NearBytes…', kind: 'syncing', connectedPeers: 0, serving: false } });
    const engine = await NearbytesEngine.boot();
    const svc = new NearbytesService(engine, emit);
    engine.on((e: EngineEvent) => svc.forward(e));
    emit({ channel: 'status', payload: svc.statusPayload() });
    return svc;
  }

  async destroy(): Promise<void> { await this.engine.destroy(); }

  private statusPayload() {
    const s = this.engine.status();
    return { text: s.text, kind: s.serving ? 'online' : 'offline', connectedPeers: s.connectedPeers, serving: s.serving };
  }
  private forward(e: EngineEvent): void {
    if (e.kind === 'status') this.emit({ channel: 'status', payload: { text: e.status.text, kind: e.status.serving ? 'online' : 'offline', connectedPeers: e.status.connectedPeers, serving: e.status.serving } });
    else if (e.kind === 'volume') this.emit({ channel: 'volume', payload: e.view });
    else if (e.kind === 'chat') this.emit({ channel: 'chat', payload: e.items });
  }

  // ── delegated 1:1 to the shared engine ──────────────────────────────────
  status() { return this.engine.status(); }
  whoami() { return this.engine.whoami(); }
  peers() { return this.engine.peers(); }

  profileList() { return this.engine.profileList(); }
  activeProfile() { return this.engine.activeProfile(); }
  profilePublicKey(name?: string) { return this.engine.profilePublicKey(name); }
  profileAdd(name: string, secret: string) { return this.engine.profileAdd(name, secret); }
  profileUse(name: string) { return this.engine.profileUse(name); }
  profileRemove(name: string) { return this.engine.profileRemove(name); }
  profileUpdate(name: string, patch: { name?: string; secret?: string }) {
    return this.engine.profileUpdate(name, patch);
  }
  profileReorder(names: readonly string[]) { return this.engine.profileReorder(names); }
  profilePublish(displayName: string, bio?: string, asProfile?: string) { return this.engine.profilePublish(displayName, bio, asProfile); }

  hubList() { return this.engine.hubList(); }
  hubActive() { return this.engine.hubActive(); }
  hubAdd(label: string, secret: string) { return this.engine.hubAdd(label, secret); }
  hubForget(label: string) { return this.engine.hubForget(label); }
  hubUse(label: string) { return this.engine.hubUse(label); }
  hubUpdate(label: string, patch: { label?: string; secret?: string }) {
    return this.engine.hubUpdate(label, patch);
  }
  hubReorder(labels: readonly string[]) { return this.engine.hubReorder(labels); }

  friendList() { return this.engine.friendList(); }
  friendAdd(key: string) { return this.engine.friendAdd(key); }
  friendRemove(prefix: string) { return this.engine.friendRemove(prefix); }
  friendReorder(keys: readonly string[]) { return this.engine.friendReorder(keys); }

  timelineCursor() { return this.engine.timelineCursor(); }
  timelineGoto(eventHash: string) { return this.engine.timelineGoto(eventHash); }
  timelineLive() { return this.engine.timelineLive(); }

  fileView() { return this.engine.fileView(); }
  fileAdd(localPath: string, name?: string) { return this.engine.fileAdd(localPath, name); }
  fileAddBytes(name: string, data: Uint8Array) { return this.engine.fileAddBytes(name, Buffer.from(data)); }
  fileGet(name: string, out: string) { return this.engine.fileGet(name, out); }
  fileRemove(name: string) { return this.engine.fileRemove(name); }
  fileMkdir(path: string) { return this.engine.fileMkdir(path); }
  fileRename(from: string, to: string) { return this.engine.fileRename(from, to); }
  fileTimeline() { return this.engine.fileTimeline(); }
  async fileOpenExternally(name: string): Promise<void> {
    const buf = await this.engine.fileBytes(name);
    const out = join(tmpdir(), `nearbytes-${Date.now()}-${name.split('/').pop()}`);
    await writeFile(out, buf);
    await shell.openPath(out);
  }

  chatRead() { return this.engine.chatRead(); }
  chatSay(body: string) { return this.engine.chatSay(body); }
}
