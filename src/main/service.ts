/**
 * NearbytesService — main-process owner of the NearBytes runtime.
 *
 * Boots EXACTLY like nearbytes-cli does: read config → build the filesystem
 * skeleton (crypto + log + sync) → create the file service. Configurability
 * (profiles, hubs/volumes, friends) is persisted with the skeleton's own
 * `writeConfig` and applied to the live sync engine via `reloadSync`, so the
 * app's sync behaviour is identical to the CLI's.
 *
 * This is the explicit adapter boundary's server side. The renderer never sees
 * any of these Node objects — only the typed snapshots pushed via `emit`.
 */
import {
  readConfig,
  writeConfig,
  emptyConfig,
  defaultDataDir,
  createFilesystemSkeletonFromConfig,
  type NearbytesConfig,
  type NearbytesSkeleton,
  type ProfileConfig,
  type VolumeConfig,
} from 'nearbytes-skeleton';
import { createFileService, type FileService } from 'nearbytes-files';
import type { PushEvent } from '../shared/ipc.js';

export type Emit = (e: PushEvent) => void;

export class NearbytesService {
  private config: NearbytesConfig;
  private skeleton!: NearbytesSkeleton;
  private fileService!: FileService;
  private activeHub: string | null = null;
  private constructor(config: NearbytesConfig, private readonly emit: Emit) {
    this.config = config;
  }

  static async boot(emit: Emit): Promise<NearbytesService> {
    const config = await readConfig().catch(() => emptyConfig(defaultDataDir()));
    const svc = new NearbytesService(config, emit);
    svc.emitStatus('Starting NearBytes…', 'syncing');
    svc.skeleton = await createFilesystemSkeletonFromConfig(config);
    svc.fileService = createFileService({ log: svc.skeleton.log, crypto: svc.skeleton.crypto });
    svc.skeleton.sync.onEvent(() => svc.emitStatus(svc.statusText(), 'online'));
    svc.emitStatus(svc.statusText(), config.profiles.length === 0 ? 'offline' : 'online');
    return svc;
  }

  async destroy(): Promise<void> { await this.skeleton.destroy(); }

  // ── status ────────────────────────────────────────────────────────────
  private statusText(): string {
    const snap = this.skeleton.sync.snapshot();
    if (this.config.profiles.length === 0) return 'No profile — add one to enable sync';
    const hub = this.activeHub ? ` · hub ${this.activeHub}` : '';
    return `Profile ${this.config.activeProfile} · ${snap.connectedPeers} peer(s)${hub}`;
  }
  private emitStatus(text: string, kind: string): void {
    this.emit({ channel: 'status', payload: { text, kind, connectedPeers: this.skeleton?.sync.snapshot().connectedPeers ?? 0, serving: this.config.profiles.length > 0 } });
  }
  status() {
    const snap = this.skeleton.sync.snapshot();
    return { text: this.statusText(), connectedPeers: snap.connectedPeers, serving: this.config.profiles.length > 0 };
  }

  // ── persistence + live sync reconfiguration (CLI-identical) ────────────
  private async persistAndReload(): Promise<void> {
    await writeConfig(this.config);
    await this.skeleton.reloadSync(this.config.friends, {
      profiles: this.config.profiles,
      activeProfile: this.config.activeProfile,
    });
    this.emitStatus(this.statusText(), this.config.profiles.length === 0 ? 'offline' : 'online');
  }

  // ── profiles ───────────────────────────────────────────────────────────
  profileList(): ProfileConfig[] { return [...this.config.profiles]; }
  activeProfile(): string | null { return this.config.activeProfile; }
  async profileAdd(name: string, secret: string): Promise<void> {
    if (this.config.profiles.some((p) => p.name === name)) throw new Error(`Profile ${name} exists`);
    const profiles = [...this.config.profiles, { name, secret }];
    const activeProfile = this.config.activeProfile ?? name;
    this.config = { ...this.config, profiles, activeProfile };
    await this.persistAndReload();
  }
  async profileUse(name: string): Promise<void> {
    if (!this.config.profiles.some((p) => p.name === name)) throw new Error(`Unknown profile ${name}`);
    this.config = { ...this.config, activeProfile: name };
    await this.persistAndReload();
  }
  async profileRemove(name: string): Promise<void> {
    const profiles = this.config.profiles.filter((p) => p.name !== name);
    const activeProfile = this.config.activeProfile === name ? (profiles[0]?.name ?? null) : this.config.activeProfile;
    this.config = { ...this.config, profiles, activeProfile };
    await this.persistAndReload();
  }

  // ── hubs / volumes ───────────────────────────────────────────────────────
  hubList(): VolumeConfig[] { return [...this.config.volumes]; }
  hubActive(): string | null { return this.activeHub; }
  async hubAdd(label: string, secret: string): Promise<void> {
    if (this.config.volumes.some((v) => v.label === label)) throw new Error(`Hub ${label} exists`);
    this.config = { ...this.config, volumes: [...this.config.volumes, { label, secret }] };
    await writeConfig(this.config);
  }
  async hubForget(label: string): Promise<void> {
    this.config = { ...this.config, volumes: this.config.volumes.filter((v) => v.label !== label) };
    if (this.activeHub === label) this.activeHub = null;
    await writeConfig(this.config);
  }
  async hubUse(label: string): Promise<void> {
    if (!this.config.volumes.some((v) => v.label === label)) throw new Error(`Unknown hub ${label}`);
    this.activeHub = label;
    this.emitStatus(this.statusText(), 'online');
    // Placeholder: materialize + push the active volume view (see CODING.md §1).
    this.emit({ channel: 'volume', payload: { files: [], directories: [] } });
  }

  // ── friends ──────────────────────────────────────────────────────────────
  friendList(): string[] { return [...this.config.friends]; }
  async friendAdd(publicKeyHex: string): Promise<void> {
    const key = publicKeyHex.trim().toLowerCase();
    if (this.config.friends.includes(key)) return;
    this.config = { ...this.config, friends: [...this.config.friends, key] };
    await this.persistAndReload();
  }
  async friendRemove(prefix: string): Promise<void> {
    const p = prefix.trim().toLowerCase();
    this.config = { ...this.config, friends: this.config.friends.filter((f) => f !== p && !f.startsWith(p)) };
    await this.persistAndReload();
  }

  // ── chat + files (scaffolded placeholders) ───────────────────────────────
  chatRead(): unknown[] { return []; }
  async chatSay(_body: string): Promise<void> { /* TODO: publishChatMessage via active hub log */ }
  fileView(): { files: unknown[]; directories: unknown[] } { return { files: [], directories: [] }; }
  async fileAdd(_path: string, _name?: string): Promise<void> { /* TODO: encrypt + store via fileService */ }
  async fileGet(_name: string, _out: string): Promise<void> { /* TODO */ }
  async fileRemove(_name: string): Promise<void> { /* TODO */ }
  async fileOpenExternally(_name: string): Promise<void> { /* TODO: shell.openPath of materialized file */ }
}
