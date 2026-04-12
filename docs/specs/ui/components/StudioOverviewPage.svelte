<script lang="ts">
  import { STUDIO_NAV_LINKS, buildStudioUrl } from '../system/routes.js';
  import StudioRuntime from './StudioRuntime.svelte';

  let {
    data,
    state,
    uiState,
    onPatchState = undefined,
  } = $props<{
    data: typeof import('../studio-data.js').STUDIO_DATA;
    state: Record<string, unknown>;
    uiState: Record<string, unknown>;
    onPatchState?: ((patch: Record<string, unknown>) => Promise<void> | void) | undefined;
  }>();

  const activeMoodboard = $derived.by(() =>
    data.moodboards.find((item) => item.id === state.moodboardId) ?? data.moodboards[0]
  );

  const activeHub = $derived.by(() =>
    data.hubs.find((hub) => hub.id === state.hubId) ?? data.hubs[0]
  );

  const workflowCards = [
    ['Direction', 'Moodboard', 'moodboard', 'Choose the art direction that sets typography, chrome, motion, and atmosphere.'],
    ['Foundations', 'Palette', 'palette', 'Review color, type, radius, motion, and spacing as one tokenized system.'],
    ['Runtime', 'Desktop UI', 'desktop', 'Inspect the mocked product skeleton rendered by the real shared surfaces.'],
    ['Behavior', 'Graph', 'graph', 'Drive the same mocked UI store that powers the shell preview.'],
  ] as const;
</script>

<section class="overview-shell">
  <div class="overview-hero panel-surface">
    <div class="hero-copy">
      <p class="eyebrow">Nearbytes design system</p>
      <h1>One art direction, one runtime, one shipped UI.</h1>
      <p class="hero-note">
        The studio is the repo-local design runtime for Nearbytes: moodboards, tokens, graph, and real shared surfaces,
        all rendered without backend effects.
      </p>
    </div>

    <div class="hero-actions">
      <a class="hero-link primary" href={buildStudioUrl('desktop')}>Open runtime</a>
    </div>
  </div>

  <div class="overview-grid">
    <section class="panel-surface overview-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Method</p>
          <strong>Professional workflow</strong>
        </div>
        <span class="panel-badge">{STUDIO_NAV_LINKS.length} views</span>
      </div>

      <div class="workflow-grid">
        {#each workflowCards as [kicker, target, studioPage, note]}
          <a class="workflow-card" href={buildStudioUrl(studioPage)}>
            <span class="workflow-kicker">{kicker}</span>
            <strong>{target}</strong>
            <span>{note}</span>
          </a>
        {/each}
      </div>
    </section>

    <section class="panel-surface overview-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Current direction</p>
          <strong>{activeMoodboard.name}</strong>
        </div>
        <span class="panel-badge">{activeMoodboard.chrome.styleLabel}</span>
      </div>

      <div class="moodboard-strip">
        <div class="moodboard-swatches">
          <span style={`background:${activeMoodboard.palette.bg}`}></span>
          <span style={`background:${activeMoodboard.palette.paper}`}></span>
          <span style={`background:${activeMoodboard.palette.panel}`}></span>
          <span style={`background:${activeMoodboard.palette.accent}`}></span>
          <span style={`background:${activeMoodboard.palette.accentStrong}`}></span>
        </div>
        <p>{activeMoodboard.summary}</p>
      </div>

      <div class="token-columns">
        <div>
          <span class="spec-label">Typography</span>
          <strong>{activeMoodboard.typography.displayLabel}</strong>
          <span>{activeMoodboard.typography.bodyLabel}</span>
        </div>
        <div>
          <span class="spec-label">Motion</span>
          <strong>{activeMoodboard.motion.medium}</strong>
          <span>{activeMoodboard.motion.fast} fast</span>
        </div>
        <div>
          <span class="spec-label">Spacing</span>
          <strong>{activeMoodboard.space.panelPadding}</strong>
          <span>{activeMoodboard.space.panelGap} gap</span>
        </div>
      </div>
    </section>
  </div>

  <section class="panel-surface overview-panel">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Live specimen</p>
        <strong>{activeHub.name}</strong>
      </div>
      <div class="hero-actions compact">
        <button type="button" class="hero-link subtle" onclick={() => void onPatchState?.({ dialogSurface: 'create' })}>Create dialog</button>
        <button type="button" class="hero-link subtle" onclick={() => void onPatchState?.({ workspace: 'split', secondary: 'flow', dialogSurface: 'none' })}>Split + flow</button>
      </div>
    </div>

    <StudioRuntime page="desktop" {data} studioState={state} {uiState} {onPatchState} />
  </section>
</section>

<style>
  .overview-shell,
  .overview-grid {
    display: grid;
    gap: 1rem;
  }

  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-surface {
    padding: 1.15rem;
    border-radius: var(--nb-radius-xl);
    border: 1px solid var(--nb-border);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-shell-top) 94%, white 6%), color-mix(in srgb, var(--nb-panel-bg) 96%, white 4%));
    box-shadow: var(--nb-shadow-md);
  }

  .overview-hero {
    display: flex;
    justify-content: space-between;
    gap: 1.25rem;
    align-items: flex-end;
    padding: 1.35rem;
    background:
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent-soft) 80%, white 20%), transparent 42%),
      linear-gradient(135deg, color-mix(in srgb, var(--nb-shell-top) 94%, white 6%), color-mix(in srgb, var(--nb-panel-bg) 94%, var(--nb-accent-soft) 6%));
  }

  .hero-copy h1,
  .hero-copy p {
    margin: 0;
  }

  .hero-copy h1 {
    font-family: var(--nb-font-display);
    font-size: clamp(2rem, 2.8vw, 3rem);
    line-height: 0.98;
    max-width: 12ch;
  }

  .hero-note {
    max-width: 42rem;
    margin-top: 0.55rem;
    color: var(--nb-text-soft);
    line-height: 1.55;
  }

  .hero-actions,
  .workflow-grid,
  .token-columns {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .hero-actions {
    align-self: flex-start;
    justify-content: flex-end;
  }

  .hero-actions.compact {
    gap: 0.45rem;
  }

  .hero-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    padding: 0 1rem;
    border-radius: var(--nb-radius-pill);
    border: 1px solid color-mix(in srgb, var(--nb-accent) 18%, var(--nb-border) 82%);
    background: color-mix(in srgb, var(--nb-card-bg) 92%, white 8%);
    color: var(--nb-text-main);
    text-decoration: none;
    font-weight: 700;
  }

  .hero-link.primary {
    background: var(--nb-accent);
    border-color: var(--nb-accent);
    color: white;
  }

  .hero-link.subtle {
    min-height: 32px;
    padding: 0 0.85rem;
    background: transparent;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    align-items: flex-start;
    margin-bottom: 0.95rem;
  }

  .eyebrow,
  .spec-label,
  .workflow-kicker {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .panel-badge {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 0.7rem;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-accent-soft);
    color: var(--nb-accent-strong);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .workflow-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workflow-card {
    display: grid;
    gap: 0.45rem;
    padding: 1rem;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-card-bg) 94%, white 6%);
    color: inherit;
    text-decoration: none;
    box-shadow: var(--nb-shadow-sm);
  }

  .workflow-card strong {
    font-size: 1rem;
  }

  .workflow-card span:last-child,
  .moodboard-strip p,
  .token-columns span:last-child {
    color: var(--nb-text-soft);
    line-height: 1.5;
  }

  .moodboard-strip {
    display: grid;
    gap: 0.7rem;
  }

  .moodboard-strip p {
    margin: 0;
  }

  .moodboard-swatches {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .moodboard-swatches span {
    height: 52px;
    border-radius: var(--nb-radius-md);
    border: 1px solid rgba(255, 255, 255, 0.38);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }

  .token-columns {
    margin-top: 0.85rem;
  }

  .token-columns > div {
    flex: 1 1 150px;
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-card-bg) 92%, white 8%);
  }

  @media (max-width: 900px) {
    .overview-grid {
      grid-template-columns: 1fr;
    }

    .overview-hero {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
