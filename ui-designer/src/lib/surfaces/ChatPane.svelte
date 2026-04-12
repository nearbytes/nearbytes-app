<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiCard from '../components/UiCard.svelte';
  import UiChip from '../components/UiChip.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { data, handlers } = $props<WorkspaceSurfaceProps>();
</script>

<UiCard
  eyebrow="Chat"
  title="Identity-aware conversation"
  detail="Messages, identity management, and attachment affordances stay in the shared UI layer."
>
  {#snippet actions()}
    <UiButton label="Identity" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'identity' })} />
    <UiButton label="Join" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'join' })} />
  {/snippet}

  {#snippet body()}
    <div class="chat-pane-body">
      {#if data.messages.length === 0}
        <p class="chat-empty">No messages in this fixture preset.</p>
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
  {/snippet}
</UiCard>

<style>
  .chat-pane-body {
    display: grid;
    gap: 0.7rem;
  }

  .chat-message {
    border-radius: 18px;
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

  .chat-message p,
  .chat-empty {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.88rem;
    line-height: 1.5;
  }
</style>
