<script lang="ts">
  import UiChip from '../components/UiChip.svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, handlers }: $$Props = $props();

  const selectedEvent = $derived(
    data.events.find((event) => event.id === ui.selectedEventId) ?? data.events[0] ?? null
  );

  const tone = $derived(
    selectedEvent?.tone === 'attention' ? 'warning' : selectedEvent?.tone === 'syncing' ? 'accent' : 'success'
  );
</script>

<UiDialog
  title={selectedEvent ? selectedEvent.title : 'Timeline details'}
  eyebrow="Timeline details"
  detail={selectedEvent ? selectedEvent.summary : 'Inspect the selected event envelope and resulting state changes.'}
  onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}
>
  {#snippet body()}
    {#if selectedEvent}
      <div class="tm-details-grid">
        <div class="tm-details-meta">
          <UiChip label={selectedEvent.eventType} tone="accent" />
          <UiChip label={selectedEvent.tone} tone={tone} />
          <UiChip label={selectedEvent.at} tone="neutral" />
        </div>

        <section class="tm-details-section">
          <p class="tm-details-section-title">Event context</p>
          <div class="tm-details-facts">
            <div>
              <span>Actor</span>
              <strong>{selectedEvent.actor}</strong>
            </div>
            <div>
              <span>Transport</span>
              <strong>{selectedEvent.transport}</strong>
            </div>
            <div>
              <span>Recorded at</span>
              <strong>{selectedEvent.happenedAt}</strong>
            </div>
          </div>
        </section>

        <section class="tm-details-section">
          <p class="tm-details-section-title">Outcome</p>
          <div class="tm-details-list">
            {#each selectedEvent.outcome as item}
              <p>{item}</p>
            {/each}
          </div>
        </section>

        <section class="tm-details-section">
          <p class="tm-details-section-title">Encoded event</p>
          <pre class="tm-details-pre">{selectedEvent.payloadPreview}</pre>
        </section>

        <section class="tm-details-section">
          <p class="tm-details-section-title">Relevant specs</p>
          <div class="tm-details-specs">
            {#each selectedEvent.specRefs as ref}
              <span>{ref}</span>
            {/each}
          </div>
        </section>
      </div>
    {/if}
  {/snippet}
</UiDialog>

<style>
  .tm-details-grid {
    display: grid;
    gap: 0.95rem;
  }

  .tm-details-meta,
  .tm-details-specs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .tm-details-section {
    display: grid;
    gap: 0.55rem;
    padding: 0.9rem 1rem;
    border-radius: 18px;
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-surface-strong) 92%, transparent);
  }

  .tm-details-section-title,
  .tm-details-list p,
  .tm-details-facts span,
  .tm-details-facts strong,
  .tm-details-specs span,
  .tm-details-pre {
    margin: 0;
  }

  .tm-details-section-title {
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--nb-accent-strong);
  }

  .tm-details-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .tm-details-facts div {
    display: grid;
    gap: 0.16rem;
  }

  .tm-details-facts span {
    font-size: 0.72rem;
    color: var(--nb-text-faint);
  }

  .tm-details-facts strong,
  .tm-details-list p,
  .tm-details-specs span {
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--nb-text-soft);
  }

  .tm-details-list {
    display: grid;
    gap: 0.35rem;
  }

  .tm-details-specs span {
    padding: 0.35rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-accent-soft) 42%, transparent);
  }

  .tm-details-pre {
    overflow-x: auto;
    padding: 0.85rem;
    border-radius: 14px;
    background: color-mix(in srgb, var(--nb-shell-top) 82%, black 8%);
    color: var(--nb-text);
    font: 0.74rem/1.5 var(--nb-font-mono, "IBM Plex Mono", monospace);
    white-space: pre-wrap;
    word-break: break-word;
  }

  @media (max-width: 720px) {
    .tm-details-facts {
      grid-template-columns: 1fr;
    }
  }
</style>