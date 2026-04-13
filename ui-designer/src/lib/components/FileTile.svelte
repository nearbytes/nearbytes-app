<script lang="ts">
  import { FileArchive, FileAudio, FileImage, FileText } from 'lucide-svelte';
  import UiChip from './UiChip.svelte';
  import type { ComponentType } from 'svelte';
  import type { FileFixture } from '../state/types.js';

  let {
    file,
    active = false,
    onSelect,
  } = $props<{
    file: FileFixture;
    active?: boolean;
    onSelect?: (() => void) | undefined;
  }>();

  const iconByKind: Record<FileFixture['kind'], ComponentType> = {
    image: FileImage,
    document: FileText,
    audio: FileAudio,
    archive: FileArchive,
  };

  const Icon = $derived(iconByKind[file.kind as FileFixture['kind']]);
  const tone = $derived(file.status === 'warning' ? 'warning' : file.status === 'syncing' ? 'accent' : 'success');
  const providersLabel = $derived(file.providers.join(' • '));
</script>

<button class:active class={`file-tile accent-${file.accent}`} type="button" onclick={onSelect}>
  <div class="file-tile-art">
    <span class="file-tile-halo"></span>
    <span class="file-tile-icon">
      <Icon size={30} strokeWidth={1.8} />
    </span>
  </div>

  <div class="file-tile-copy">
    <strong title={file.name}>{file.name}</strong>
    <p>{file.summary}</p>
  </div>

  <div class="file-tile-meta">
    <div class="file-tile-meta-top">
      <UiChip label={file.status} tone={tone} />
      <span>{file.updatedAt}</span>
    </div>
    <span>{file.mimeLabel} • {file.sizeLabel}</span>
    <span>{providersLabel}</span>
  </div>
</button>

<style>
  .file-tile {
    position: relative;
    display: grid;
    gap: 0.85rem;
    align-content: start;
    min-height: 15rem;
    border-radius: clamp(20px, 2vw, 28px);
    border: 1px solid color-mix(in srgb, var(--nb-border) 84%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-surface-strong) 88%, transparent), color-mix(in srgb, var(--nb-surface) 96%, transparent)),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent) 10%, transparent), transparent 56%);
    padding: 1rem;
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      transform 180ms ease,
      border-color 180ms ease,
      box-shadow 180ms ease,
      background 180ms ease;
  }

  .file-tile:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--nb-accent) 30%, var(--nb-border));
    box-shadow: 0 18px 32px rgba(0, 0, 0, 0.12);
  }

  .file-tile.active {
    border-color: color-mix(in srgb, var(--nb-accent) 52%, var(--nb-border));
    box-shadow: 0 20px 42px color-mix(in srgb, var(--nb-accent) 12%, transparent);
  }

  .file-tile-art {
    position: relative;
    min-height: 6.8rem;
    border-radius: 22px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--nb-border) 64%, transparent);
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.03));
  }

  .file-tile-halo {
    position: absolute;
    inset: auto;
    width: 8rem;
    height: 8rem;
    border-radius: 50%;
    filter: blur(18px);
    opacity: 0.85;
  }

  .accent-cyan .file-tile-halo { background: rgba(72, 208, 255, 0.32); }
  .accent-amber .file-tile-halo { background: rgba(255, 193, 92, 0.34); }
  .accent-violet .file-tile-halo { background: rgba(162, 124, 255, 0.34); }
  .accent-rose .file-tile-halo { background: rgba(255, 110, 155, 0.34); }

  .file-tile-icon {
    position: relative;
    z-index: 1;
    width: 4rem;
    height: 4rem;
    display: grid;
    place-items: center;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(12px);
  }

  .file-tile-copy,
  .file-tile-meta {
    display: grid;
    gap: 0.32rem;
  }

  .file-tile-copy strong,
  .file-tile-copy p,
  .file-tile-meta span {
    margin: 0;
  }

  .file-tile-copy strong {
    font-size: 0.94rem;
    line-height: 1.28;
  }

  .file-tile-copy p,
  .file-tile-meta span {
    color: var(--nb-text-soft);
    font-size: 0.77rem;
    line-height: 1.45;
  }

  .file-tile-meta-top {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    align-items: center;
  }
</style>