<script lang="ts">
  import { Paperclip, Send, Shield } from 'lucide-svelte';
  import UiButton from '../components/UiButton.svelte';
  import UiChip from '../components/UiChip.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, capabilities, handlers }: $$Props = $props();
</script>

<section class="chat-pane nb-panel-surface">
  <header class="chat-pane-header">
    <div>
      <h3>Protocol room</h3>
    </div>
    <UiButton label="Identity" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'identity' })} />
  </header>

  <div class="chat-pane-body">
    {#if data.messages.length === 0}
      <p class="chat-empty">No messages yet.</p>
    {:else}
      {#each data.messages as message}
        <article class={`chat-message ${message.tone}`}>
          <header>
            <strong>{message.author}</strong>
            <UiChip label={message.at} tone="neutral" />
          </header>
          <p>{message.body}</p>
        </article>
      {/each}
    {/if}
  </div>

  <footer class="chat-composer">
    <button type="button" class="composer-icon" aria-label="Attach">
      <Paperclip size={16} />
    </button>
    <div class="composer-input">
      <span>Message Atlas Relay…</span>
    </div>
    <button type="button" class="composer-icon" aria-label="Send">
      <Send size={16} />
    </button>
  </footer>
</section>

<style>
  .chat-pane {
    min-height: 0;
    border-radius: var(--nb-radius-panel);
    padding: 0.9rem;
    display: grid;
    gap: 0.85rem;
    overflow: hidden;
  }

  .chat-pane-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: start;
  }

  .chat-pane-header h3 {
    margin: 0;
  }

  .chat-pane-header h3 {
    font-size: 1rem;
  }

  .chat-pane-body {
    display: grid;
    gap: 0.7rem;
    align-content: start;
    overflow: auto;
    min-height: 0;
  }

  .chat-message {
    border-radius: var(--nb-radius-item);
    border: 1px solid var(--nb-border);
    padding: 0.82rem 0.9rem;
    display: grid;
    gap: 0.45rem;
  }

  .chat-message.local {
    background: var(--nb-accent-soft);
  }

  .chat-message.system {
    background: color-mix(in srgb, var(--nb-surface-strong) 86%, var(--nb-warning) 8%);
  }

  .chat-message header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }

  .chat-composer {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.6rem;
    align-items: center;
  }

  .composer-icon {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--nb-radius-control);
    border: 1px solid var(--nb-border);
    background: transparent;
    color: var(--nb-text-soft);
  }

  .composer-input {
    min-height: 2.5rem;
    border-radius: var(--nb-radius-control);
    border: 1px solid var(--nb-border);
    display: flex;
    align-items: center;
    padding: 0 0.9rem;
    color: var(--nb-text-faint);
  }

  .chat-message p,
  .chat-empty {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.88rem;
    line-height: 1.5;
  }
</style>
