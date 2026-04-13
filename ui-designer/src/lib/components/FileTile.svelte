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
    gap: 0.75rem;
    align-content: start;
    min-height: 15rem;
    border-radius: var(--nb-radius-panel);
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-strong);
    padding: 0.9rem;
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      border-color 180ms ease,
      background 180ms ease;
  }

  .file-tile:hover {
    border-color: color-mix(in srgb, var(--nb-accent) 30%, var(--nb-border));
  }

  .file-tile.active {
    border-color: color-mix(in srgb, var(--nb-accent) 52%, var(--nb-border));
    background: color-mix(in srgb, var(--nb-accent) 6%, var(--nb-surface-strong));
  }

  .file-tile-art {
    position: relative;
    min-height: 6.8rem;
    border-radius: var(--nb-radius-item);
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--nb-border);
    background: var(--nb-surface);
  }

  .file-tile-icon {
    position: relative;
    z-index: 1;
    width: 3.25rem;
    height: 3.25rem;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: color-mix(in srgb, var(--nb-accent) 8%, var(--nb-surface-strong));
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