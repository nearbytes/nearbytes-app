<script lang="ts">
  import { onDestroy } from 'svelte';
  import UiChip from '../components/UiChip.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  type FlowNode = {
    id: string;
    label: string;
    provider: string;
    x: number;
    y: number;
    status: 'healthy' | 'syncing' | 'attention';
  };

  type FlowParticle = {
    id: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    color: string;
    durationMs: number;
  };

  let { ui, data }: $$Props = $props();
  let particles = $state<FlowParticle[]>([]);
  let activeNodeId = $state<string | null>(null);
  let particleId = 0;
  let activityCursor = $state(0);
  let interval: ReturnType<typeof setInterval> | null = null;
  const timeouts = new Set<ReturnType<typeof setTimeout>>();

  const selectedEvent = $derived(
    data.events.find((event) => event.id === ui.selectedEventId) ?? data.events[0] ?? null
  );

  const flowNodes = $derived.by<FlowNode[]>(() => {
    const anchors = [
      { x: 19, y: 26 },
      { x: 79, y: 28 },
      { x: 72, y: 76 },
      { x: 25, y: 74 },
    ];

    return data.providerShares.map((share, index) => ({
      id: share.id,
      label: share.title,
      provider: share.provider,
      x: anchors[index % anchors.length].x,
      y: anchors[index % anchors.length].y,
      status: share.status,
    }));
  });

  const totalEvents = $derived(data.events.length);
  const totalFiles = $derived(data.files.length);
  const totalProviders = $derived(data.providerShares.length);
  const recentActivities = $derived(data.events.slice(0, 4));

  function particleColor(status: FlowNode['status']): string {
    if (status === 'attention') return '#ff8a65';
    if (status === 'syncing') return '#f7c66b';
    return '#58d4ff';
  }

  function providerGlyph(provider: string): string {
    if (provider === 'MEGA') return 'M';
    if (provider === 'LAN') return 'L';
    if (provider === 'GitHub') return 'G';
    return provider.charAt(0);
  }

  function spawnParticle(): void {
    if (flowNodes.length === 0) {
      return;
    }

    const node = flowNodes[activityCursor % flowNodes.length];
    activeNodeId = node.id;
    activityCursor += 1;

    const particle: FlowParticle = {
      id: particleId++,
      fromX: 50,
      fromY: 50,
      toX: node.x,
      toY: node.y,
      color: particleColor(node.status),
      durationMs: 1200,
    };

    particles = [...particles, particle];
    const timeout = setTimeout(() => {
      particles = particles.filter((entry) => entry.id !== particle.id);
      if (activeNodeId === node.id) {
        activeNodeId = null;
      }
      timeouts.delete(timeout);
    }, particle.durationMs + 120);
    timeouts.add(timeout);
  }

  $effect(() => {
    if (interval) {
      clearInterval(interval);
    }

    if (flowNodes.length > 0) {
      spawnParticle();
      interval = setInterval(spawnParticle, 1250);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
  });

  onDestroy(() => {
    for (const timeout of timeouts) {
      clearTimeout(timeout);
    }
    timeouts.clear();
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  });
</script>

<div class="event-flow-panel">
  <div class="ef-header">
    <div>
      <h2>Event Flow</h2>
    </div>
    <div class="ef-stats">
      <UiChip label={`${totalEvents} events`} tone="accent" />
      <UiChip label={`${totalFiles} files`} tone="neutral" />
      <UiChip label={`${totalProviders} lanes`} tone="success" />
    </div>
  </div>

  <div class="ef-layout">
    <section class="ef-stage-shell">
      <div class="ef-stage">
        <svg class="ef-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {#each flowNodes as node}
            <line x1="50" y1="50" x2={node.x} y2={node.y}></line>
          {/each}
        </svg>

        {#each particles as particle (particle.id)}
          <span
            class="ef-particle"
            style={`--x:${particle.fromX}%; --y:${particle.fromY}%; --dx:${particle.toX - particle.fromX}%; --dy:${particle.toY - particle.fromY}%; --particle:${particle.color}; --duration:${particle.durationMs}ms;`}
          ></span>
        {/each}

        <div class="ef-hub">
          <span class="ef-hub-ring"></span>
          <strong>Atlas Relay</strong>
          <span>Current shared hub</span>
        </div>

        {#each flowNodes as node}
          <article class:active={activeNodeId === node.id} class={`ef-node status-${node.status}`} style={`left:${node.x}%; top:${node.y}%;`}>
            <span class="ef-node-glyph">{providerGlyph(node.provider)}</span>
            <strong>{node.provider}</strong>
            <span>{node.label}</span>
          </article>
        {/each}
      </div>
    </section>

    <aside class="ef-rail">
      {#if selectedEvent}
        <section class="ef-rail-card">
          <p class="ef-rail-label">Selected event</p>
          <strong>{selectedEvent.title}</strong>
          <p>{selectedEvent.summary}</p>
          <div class="ef-rail-list">
            {#each selectedEvent.outcome as item}
              <span>{item}</span>
            {/each}
          </div>
        </section>
      {/if}

      <section class="ef-rail-card">
        <p class="ef-rail-label">Recent activity</p>
        <div class="ef-activity-list">
          {#each recentActivities as event, index (event.id)}
            <div class:active={index === ((activityCursor - 1 + recentActivities.length) % recentActivities.length)} class="ef-activity-entry">
              <strong>{event.title}</strong>
              <span>{event.transport}</span>
              <small>{event.at}</small>
            </div>
          {/each}
        </div>
      </section>
    </aside>
  </div>
</div>

<style>
  .event-flow-panel {
    display: grid;
    gap: 1rem;
    height: 100%;
    padding: 1.15rem;
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--nb-accent) 14%, transparent), transparent 34%),
      linear-gradient(180deg, color-mix(in srgb, var(--nb-shell-top) 92%, black 6%), color-mix(in srgb, var(--nb-shell-bottom) 96%, black 4%));
    color: var(--nb-text);
  }

  .ef-header,
  .ef-layout {
    display: grid;
    gap: 1rem;
  }

  .ef-header {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .ef-header h2 {
    margin: 0;
  }

  .ef-layout {
    grid-template-columns: minmax(0, 1.45fr) minmax(17rem, 0.8fr);
    min-height: 0;
    overflow: hidden;
  }

  .ef-stage-shell,
  .ef-rail-card {
    border-radius: 24px;
    border: 1px solid color-mix(in srgb, var(--nb-border) 82%, transparent);
    background: color-mix(in srgb, var(--nb-surface-strong) 82%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .ef-stage-shell {
    min-height: 28rem;
    padding: 0.8rem;
  }

  .ef-stage {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 26.5rem;
    border-radius: 22px;
    overflow: hidden;
    background:
      radial-gradient(circle at center, color-mix(in srgb, var(--nb-accent) 10%, transparent), transparent 32%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0));
  }

  .ef-links {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .ef-links line {
    stroke: color-mix(in srgb, var(--nb-accent) 20%, var(--nb-border));
    stroke-width: 0.8;
    stroke-dasharray: 2 2;
  }

  .ef-hub,
  .ef-node {
    position: absolute;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    text-align: center;
  }

  .ef-hub {
    left: 50%;
    top: 50%;
    width: 10rem;
    height: 10rem;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--nb-accent) 26%, transparent), color-mix(in srgb, var(--nb-surface-strong) 84%, transparent));
    border: 1px solid color-mix(in srgb, var(--nb-accent) 28%, var(--nb-border));
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05), 0 24px 48px rgba(0, 0, 0, 0.18);
  }

  .ef-hub-ring {
    position: absolute;
    inset: 10%;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--nb-accent) 18%, transparent);
    animation: ef-hub-pulse 2.8s ease-in-out infinite;
  }

  .ef-hub strong,
  .ef-node strong,
  .ef-node span,
  .ef-hub span {
    position: relative;
    z-index: 1;
  }

  .ef-hub strong {
    font-size: 1rem;
  }

  .ef-hub span,
  .ef-node span {
    color: var(--nb-text-soft);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  .ef-node {
    width: 8.8rem;
    min-height: 6.9rem;
    padding: 0.8rem 0.7rem;
    border-radius: 22px;
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-surface-strong) 92%, transparent);
    gap: 0.18rem;
    transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  }

  .ef-node.active {
    transform: translate(-50%, -50%) scale(1.04);
    border-color: color-mix(in srgb, var(--nb-accent) 34%, var(--nb-border));
    box-shadow: 0 18px 34px color-mix(in srgb, var(--nb-accent) 14%, transparent);
  }

  .ef-node.status-attention {
    border-color: color-mix(in srgb, var(--nb-warning) 34%, var(--nb-border));
  }

  .ef-node.status-syncing {
    border-color: color-mix(in srgb, var(--nb-warning) 22%, var(--nb-border));
  }

  .ef-node-glyph {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--nb-text);
    background: color-mix(in srgb, var(--nb-accent) 16%, transparent);
  }

  .ef-particle {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--particle);
    box-shadow: 0 0 18px var(--particle);
    animation: ef-travel var(--duration) linear forwards;
  }

  .ef-rail {
    display: grid;
    gap: 0.85rem;
    align-content: start;
    overflow: auto;
  }

  .ef-rail-card {
    padding: 1rem;
    display: grid;
    gap: 0.55rem;
  }

  .ef-rail-card strong,
  .ef-rail-card p {
    margin: 0;
  }

  .ef-rail-card p,
  .ef-activity-entry span,
  .ef-activity-entry small,
  .ef-rail-list span {
    color: var(--nb-text-soft);
  }

  .ef-rail-card p,
  .ef-activity-entry span,
  .ef-rail-list span {
    font-size: 0.8rem;
    line-height: 1.42;
  }

  .ef-rail-list,
  .ef-activity-list {
    display: grid;
    gap: 0.5rem;
  }

  .ef-rail-list span,
  .ef-activity-entry {
    padding: 0.72rem 0.78rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border) 76%, transparent);
    background: color-mix(in srgb, var(--nb-surface) 96%, transparent);
  }

  .ef-activity-entry {
    display: grid;
    gap: 0.2rem;
    transition: border-color 180ms ease, transform 180ms ease, background 180ms ease;
  }

  .ef-activity-entry.active {
    border-color: color-mix(in srgb, var(--nb-accent) 34%, var(--nb-border));
    transform: translateX(2px);
    background: color-mix(in srgb, var(--nb-accent-soft) 28%, transparent);
  }

  .ef-activity-entry small {
    font-size: 0.68rem;
  }

  @keyframes ef-travel {
    0% {
      transform: translate(-50%, -50%) scale(0.7);
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    100% {
      transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1);
      opacity: 0;
    }
  }

  @keyframes ef-hub-pulse {
    0%, 100% { transform: scale(0.96); opacity: 0.4; }
    50% { transform: scale(1.06); opacity: 0.85; }
  }

  @media (max-width: 960px) {
    .ef-header,
    .ef-layout {
      grid-template-columns: 1fr;
    }

    .ef-stats {
      justify-content: flex-start;
    }
  }
</style>
