<script lang="ts">
  import { ClipboardPaste, Plus, UserRound, X } from 'lucide-svelte';

  let {
    onClose = undefined,
    onCreateHub = undefined,
    onCreateIdentity = undefined,
    onPasteLink = undefined,
  } = $props<{
    onClose?: (() => void) | undefined;
    onCreateHub?: (() => void) | undefined;
    onCreateIdentity?: (() => void) | undefined;
    onPasteLink?: (() => void | Promise<void>) | undefined;
  }>();

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    onClose?.();
  }
</script>

<div
  class="mount-dialog-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Create"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="create-chooser-modal panel-surface" role="document" tabindex="-1">
    <div class="create-chooser-head">
      <div>
        <p class="mount-dialog-eyebrow">Create</p>
        <p class="mount-dialog-title">What do you want to make?</p>
      </div>
      <button type="button" class="dialog-close-btn" aria-label="Close create chooser" onclick={() => onClose?.()}>
        <X size={18} strokeWidth={2} />
      </button>
    </div>
    <div class="create-chooser-grid">
      <button type="button" class="create-chooser-card" onclick={() => onCreateHub?.()}>
        <Plus size={18} strokeWidth={2.2} />
        <span class="create-chooser-card-title">Hub</span>
      </button>
      <button type="button" class="create-chooser-card" onclick={() => onCreateIdentity?.()}>
        <UserRound size={18} strokeWidth={2} />
        <span class="create-chooser-card-title">Identity</span>
      </button>
      <button type="button" class="create-chooser-card" onclick={() => void onPasteLink?.()}>
        <ClipboardPaste size={18} strokeWidth={2} />
        <span class="create-chooser-card-title">Paste link</span>
      </button>
    </div>
  </div>
</div>

<style>
  .panel-surface {
    animation: panel-fade-in 240ms ease;
  }

  @keyframes panel-fade-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .mount-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 235;
    display: grid;
    place-items: center;
    padding: 1rem;
    background:
      radial-gradient(circle at top, color-mix(in srgb, var(--nb-accent, #d27a54) 12%, transparent), transparent 55%),
      rgba(19, 18, 18, 0.26);
    backdrop-filter: blur(8px);
  }

  .create-chooser-modal {
    width: min(560px, calc(100vw - 2rem));
    max-height: min(88vh, 900px);
    overflow: auto;
    display: grid;
    gap: 1rem;
    padding: 1rem;
    border-radius: 22px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(210, 122, 84, 0.1));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(255, 248, 243, 0.94)), color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(247, 239, 233, 0.92))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, #d27a54) 10%, transparent), transparent 60%);
    box-shadow:
      0 30px 90px rgba(39, 24, 15, 0.22),
      0 10px 24px rgba(39, 24, 15, 0.12);
  }

  .create-chooser-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.9rem;
  }

  .mount-dialog-eyebrow,
  .mount-dialog-title {
    margin: 0;
  }

  .mount-dialog-eyebrow {
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 72%, rgba(110, 110, 115, 0.82));
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .mount-dialog-title {
    margin-top: 0.18rem;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-size: 1.18rem;
    line-height: 1.2;
    font-weight: 700;
  }

  .dialog-close-btn {
    width: 34px;
    height: 34px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .create-chooser-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.8rem;
  }

  .create-chooser-card {
    appearance: none;
    min-height: 118px;
    padding: 1rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(250, 245, 241, 0.92));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    display: grid;
    gap: 0.7rem;
    align-content: start;
    justify-items: start;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease;
  }

  .create-chooser-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 28%, var(--nb-border, rgba(60, 60, 67, 0.12)) 72%);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(255, 248, 243, 0.96));
  }

  .create-chooser-card-title {
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.2;
  }

  @media (max-width: 720px) {
    .create-chooser-grid {
      grid-template-columns: 1fr;
    }
  }
</style>