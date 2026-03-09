<script lang="ts">
  import { FileText, HardDrive, Image as ImageIcon } from 'lucide-svelte';

  const FILE_SECRET_PREFIX = 'nb-file-secret:v1:';

  let {
    label,
    secondary = '',
    title = '',
    filePayload = '',
    fileMimeType = '',
    fileName = '',
    compact = false,
  } = $props<{
    label: string;
    secondary?: string;
    title?: string;
    filePayload?: string;
    fileMimeType?: string;
    fileName?: string;
    compact?: boolean;
  }>();

  function trim(value: string): string {
    return value.trim();
  }

  function base64UrlToBase64(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const remainder = normalized.length % 4;
    if (remainder === 0) return normalized;
    return `${normalized}${'='.repeat(4 - remainder)}`;
  }

  const hasFileSecret = $derived(trim(filePayload) !== '');
  const hasImagePreview = $derived(
    hasFileSecret && trim(fileMimeType).startsWith('image/')
  );
  const previewDataUrl = $derived.by(() => {
    const payload = trim(filePayload);
    if (!payload.startsWith(FILE_SECRET_PREFIX)) return null;
    const encoded = payload.slice(FILE_SECRET_PREFIX.length);
    if (encoded === '') return null;
    const mimeType = trim(fileMimeType) || 'application/octet-stream';
    return `data:${mimeType};base64,${base64UrlToBase64(encoded)}`;
  });
</script>

<div class="volume-identity" class:compact>
  {#if hasFileSecret || compact}
    <span class="volume-identity-preview" class:image={hasImagePreview}>
      {#if hasImagePreview && previewDataUrl}
        <img
          class="volume-identity-preview-image"
          src={previewDataUrl}
          alt={fileName || label || 'Space preview'}
        />
      {:else}
        <span class="volume-identity-preview-icon" aria-hidden="true">
          {#if hasFileSecret && trim(fileMimeType).startsWith('image/')}
            <ImageIcon size={compact ? 13 : 15} strokeWidth={2.1} />
          {:else if hasFileSecret}
            <FileText size={compact ? 13 : 15} strokeWidth={2.1} />
          {:else}
            <HardDrive size={compact ? 13 : 15} strokeWidth={2.1} />
          {/if}
        </span>
      {/if}
    </span>
  {/if}

  <div class="volume-identity-copy">
    <p class="volume-identity-label" title={title || label}>{label}</p>
    {#if secondary.trim() !== ''}
      <p class="volume-identity-secondary" title={secondary}>{secondary}</p>
    {/if}
  </div>
</div>

<style>
  .volume-identity {
    min-width: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.52rem;
  }

  .volume-identity.compact {
    gap: 0.46rem;
  }

  .volume-identity-preview {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(96, 165, 250, 0.22);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .volume-identity-preview.image {
    background: rgba(7, 14, 28, 0.94);
    border-color: rgba(125, 211, 252, 0.28);
  }

  .volume-identity-preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .volume-identity-preview-icon {
    color: rgba(191, 219, 254, 0.9);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .volume-identity-copy {
    min-width: 0;
    display: grid;
    gap: 0.12rem;
  }

  .volume-identity-label,
  .volume-identity-secondary {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .volume-identity-label {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--volume-identity-label-color, rgba(240, 249, 255, 0.96));
    letter-spacing: 0.01em;
  }

  .volume-identity-secondary {
    font-size: 0.72rem;
    color: var(--volume-identity-secondary-color, rgba(186, 230, 253, 0.68));
  }

  .volume-identity.compact .volume-identity-label {
    font-size: 0.88rem;
  }

  .volume-identity.compact .volume-identity-secondary {
    font-size: 0.7rem;
  }
</style>
