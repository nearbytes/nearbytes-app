<script lang="ts">
  import type { TimelineEvent } from '../../../../../ui/src/lib/api.js';

  let {
    timelineMarker = '',
    isTimelinePlaying = false,
    isTimelineLoading = false,
    timelineEvents = [],
    timelinePosition = 0,
    timelineEventsElement = $bindable<HTMLElement | null>(null),
    timelineKindLabel,
    timelineHeadline,
    timelineTitle,
    formatShortDate,
    isTimelineIdentityEvent,
    isTimelineChatEvent,
    onTogglePlayback,
    onJumpToLatest,
    onSetTimelinePosition,
    onJumpToEvent,
    onOpenDetails,
    onScroll,
  }: {
    timelineMarker?: string;
    isTimelinePlaying?: boolean;
    isTimelineLoading?: boolean;
    timelineEvents?: TimelineEvent[];
    timelinePosition?: number;
    timelineEventsElement?: HTMLElement | null;
    timelineKindLabel: (event: TimelineEvent) => string;
    timelineHeadline: (event: TimelineEvent) => string;
    timelineTitle: (event: TimelineEvent) => string;
    formatShortDate: (value: number) => string;
    isTimelineIdentityEvent: (event: TimelineEvent) => boolean;
    isTimelineChatEvent: (event: TimelineEvent) => boolean;
    onTogglePlayback?: () => void;
    onJumpToLatest?: () => void;
    onSetTimelinePosition?: (value: number) => void;
    onJumpToEvent?: (index: number) => void;
    onOpenDetails?: (event: TimelineEvent) => void;
    onScroll?: (event: Event) => void;
  } = $props();
</script>

<section class="time-machine panel-surface" aria-label="Hub timeline">
  <div class="time-machine-head">
    <div>
      <p class="time-machine-eyebrow">Timeline</p>
      <p class="time-machine-marker">{timelineMarker}</p>
    </div>
    <div class="time-machine-actions">
      <button type="button" class="tm-btn" onclick={() => onTogglePlayback?.()} disabled={timelineEvents.length === 0 || isTimelineLoading}>
        {isTimelinePlaying ? 'Pause' : 'Play'}
      </button>
      <button type="button" class="tm-btn live" onclick={() => onJumpToLatest?.()} disabled={timelinePosition === timelineEvents.length}>
        Latest
      </button>
    </div>
  </div>
  <div class="time-machine-track">
    <input
      class="tm-slider"
      type="range"
      min="0"
      max={timelineEvents.length}
      value={timelinePosition}
      disabled={timelineEvents.length === 0}
      aria-label="Timeline position"
      oninput={(event) => onSetTimelinePosition?.(Number((event.currentTarget as HTMLInputElement).value))}
    />
    <div class="tm-scale">
      <span>Start</span>
      <span>{timelinePosition}/{timelineEvents.length}</span>
      <span>Latest</span>
    </div>
  </div>
  {#if timelineEvents.length > 0}
    <div class="tm-events" bind:this={timelineEventsElement} onscroll={onScroll}>
      {#each timelineEvents as event, index (event.eventHash)}
        <div class="tm-event-row">
          <button
            type="button"
            class="tm-event"
            class:applied={index < timelinePosition}
            class:current={index === timelinePosition - 1}
            class:create={event.type === 'CREATE_FILE'}
            class:delete={event.type === 'DELETE_FILE'}
            class:rename={event.type === 'RENAME_FILE'}
            class:identity={isTimelineIdentityEvent(event)}
            class:chat={isTimelineChatEvent(event)}
            onclick={() => onJumpToEvent?.(index)}
            title={timelineTitle(event)}
          >
            <span class="tm-event-kind">{timelineKindLabel(event)}</span>
            <span class="tm-event-name">{timelineHeadline(event)}</span>
            <span class="tm-event-time">{formatShortDate(event.timestamp)}</span>
          </button>
          <button
            type="button"
            class="tm-event-details"
            onclick={(clickEvent) => {
              clickEvent.stopPropagation();
              onOpenDetails?.(event);
            }}
            aria-label={`View details for ${event.filename || 'event'}`}
          >
            Details
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="tm-empty">Timeline is empty. Add files to create history.</p>
  {/if}
</section>

<style>
  .time-machine {
    flex: 0 0 auto;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    border-radius: var(--nb-radius-lg, 16px);
    background: var(--nb-time-machine-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7)));
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    overflow: hidden;
  }

  .time-machine-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .time-machine-eyebrow {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(125, 211, 252, 0.78));
  }

  .time-machine-marker {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.92));
    font-weight: 520;
  }

  .time-machine-actions {
    display: flex;
    gap: 0.5rem;
  }

  .tm-btn {
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.22));
    border-radius: var(--nb-radius-pill, 999px);
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, #dbeafe);
    min-height: 34px;
    padding: 0 0.8rem;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .tm-btn.live {
    border-color: color-mix(in srgb, var(--nb-accent, #ff3b30) 24%, transparent);
    background: var(--nb-btn-active-bg, color-mix(in srgb, var(--nb-accent, #ff3b30) 10%, var(--nb-panel-bg, white)));
    color: var(--nb-btn-active-color, rgba(28, 28, 30, 0.98));
  }

  .tm-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .time-machine-track {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .tm-slider {
    width: 100%;
    accent-color: var(--nb-accent, #38bdf8);
  }

  .tm-scale {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.8));
  }

  .tm-events {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(132px, 162px);
    gap: 0.42rem;
    align-items: start;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.15rem 1rem 0.32rem 0;
    scrollbar-width: none;
    box-sizing: border-box;
  }

  .tm-events::-webkit-scrollbar {
    display: none;
  }

  .tm-event-row {
    display: grid;
    gap: 0.32rem;
    min-width: 0;
  }

  .tm-event {
    --tm-event-bg: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    --tm-event-border: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 94%, transparent);
    --tm-event-kind-color: var(--nb-text-soft, rgba(58, 58, 60, 0.72));
    border: 1px solid var(--tm-event-border);
    border-radius: var(--nb-radius-md, 14px);
    background: color-mix(in srgb, var(--tm-event-bg) 56%, rgba(255, 255, 255, 0.98));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    display: grid;
    gap: 0.15rem;
    padding: 0.42rem 0.5rem;
    text-align: left;
    cursor: pointer;
    min-width: 0;
    overflow: hidden;
    opacity: 0.54;
    border-style: dashed;
    transform: translateY(1px) scale(0.985);
    filter: saturate(0.7);
  }

  .tm-event.applied {
    opacity: 1;
    border-style: solid;
    background: var(--tm-event-bg);
    transform: none;
    filter: none;
    box-shadow: inset 3px 0 0 rgba(97, 114, 67, 0.38);
  }

  .tm-event.current {
    opacity: 1;
    border-style: solid;
    border-color: color-mix(in srgb, var(--nb-text-main, rgba(28, 28, 30, 1)) 12%, transparent);
    background: var(--tm-event-bg);
    transform: translateY(-1px);
    filter: none;
    box-shadow: inset 3px 0 0 rgba(28, 28, 30, 0.42), 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .tm-event.create {
    --tm-event-bg: rgba(206, 233, 250, 0.78);
    --tm-event-border: rgba(130, 172, 204, 0.28);
    --tm-event-kind-color: #35506b;
  }

  .tm-event.delete {
    --tm-event-bg: rgba(242, 222, 189, 0.84);
    --tm-event-border: rgba(168, 137, 96, 0.28);
    --tm-event-kind-color: #87613a;
  }

  .tm-event.rename {
    --tm-event-bg: rgba(231, 217, 248, 0.82);
    --tm-event-border: rgba(153, 130, 184, 0.26);
    --tm-event-kind-color: #6c4d88;
  }

  .tm-event.identity {
    --tm-event-bg: rgba(224, 235, 200, 0.82);
    --tm-event-border: rgba(143, 165, 110, 0.28);
    --tm-event-kind-color: #617243;
  }

  .tm-event.chat {
    --tm-event-bg: rgba(244, 224, 208, 0.84);
    --tm-event-border: rgba(204, 152, 120, 0.28);
    --tm-event-kind-color: #8b6148;
  }

  .tm-event-kind {
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--tm-event-kind-color);
    font-weight: 560;
  }

  .tm-event-name {
    font-size: 0.77rem;
    font-weight: 520;
    display: -webkit-box;
    overflow: hidden;
    text-overflow: ellipsis;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.25;
    min-height: calc(1.25em * 2);
  }

  .tm-event-time {
    font-size: 0.68rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.85));
    font-weight: 450;
  }

  .tm-event-details {
    border: 1px solid var(--nb-btn-border, rgba(148, 163, 184, 0.2));
    border-radius: var(--nb-radius-sm, 8px);
    background: var(--nb-btn-bg, rgba(12, 22, 41, 0.6));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.85));
    font-size: 0.64rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
  }

  .tm-empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--nb-text-soft, rgba(186, 230, 253, 0.7));
  }

  @media (max-width: 900px) {
    .time-machine-head {
      flex-direction: column;
    }

    .time-machine-actions {
      width: 100%;
      justify-content: space-between;
    }

    .tm-events {
      grid-auto-flow: row;
      grid-auto-columns: auto;
      grid-template-columns: minmax(0, 1fr);
      overflow-x: hidden;
      overflow-y: auto;
      padding-right: 0;
    }
  }
</style>