<script lang="ts">
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
</script>

<section class="moodboard-shell">
  <div class="moodboard-hero panel-surface">
    <div>
      <p class="eyebrow">Art direction</p>
      <h1>{activeMoodboard.name}</h1>
      <p class="hero-note">{activeMoodboard.summary}</p>
    </div>
    <div class="hero-metrics">
      <div><span>Chrome</span><strong>{activeMoodboard.chrome.styleLabel}</strong></div>
      <div><span>Display</span><strong>{activeMoodboard.typography.displayLabel}</strong></div>
      <div><span>Body</span><strong>{activeMoodboard.typography.bodyLabel}</strong></div>
    </div>
  </div>

  <div class="moodboard-grid">
    <section class="panel-surface">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Directions</p>
          <strong>Moodboards</strong>
        </div>
      </div>

      <div class="card-grid">
        {#each data.moodboards as item}
          <button
            type="button"
            class="mood-card"
            class:active={item.id === activeMoodboard.id}
            onclick={() => void onPatchState?.({ moodboardId: item.id })}
          >
            <div class="mood-card-head">
              <div>
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </div>
              <span class="mood-chip">{item.chrome.styleLabel}</span>
            </div>

            <div class="swatch-strip">
              <span style={`background:${item.palette.bg}`}></span>
              <span style={`background:${item.palette.paper}`}></span>
              <span style={`background:${item.palette.panel}`}></span>
              <span style={`background:${item.palette.accent}`}></span>
              <span style={`background:${item.palette.accentStrong}`}></span>
            </div>

            <div class="note-row">
              {#each item.notes as note}
                <span>{note}</span>
              {/each}
            </div>
          </button>
        {/each}
      </div>
    </section>

    <section class="panel-surface">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Foundations</p>
          <strong>Current moodboard contract</strong>
        </div>
      </div>

      <div class="spec-grid">
        <article class="spec-card">
          <span class="spec-label">Typography</span>
          <strong>{activeMoodboard.typography.displayLabel}</strong>
          <span>{activeMoodboard.typography.display}</span>
          <strong>{activeMoodboard.typography.bodyLabel}</strong>
          <span>{activeMoodboard.typography.body}</span>
        </article>

        <article class="spec-card">
          <span class="spec-label">Chrome</span>
          <strong>{activeMoodboard.chrome.shellLabel}</strong>
          <span>Radius {activeMoodboard.chrome.radiusXl} / {activeMoodboard.chrome.radiusLg} / {activeMoodboard.chrome.radiusMd}</span>
          <span>Blur {activeMoodboard.chrome.blur} · Overlay {activeMoodboard.chrome.overlayBlur}</span>
        </article>

        <article class="spec-card">
          <span class="spec-label">Motion</span>
          <strong>{activeMoodboard.motion.medium}</strong>
          <span>Fast {activeMoodboard.motion.fast}</span>
          <span>Slow {activeMoodboard.motion.slow}</span>
        </article>

        <article class="spec-card">
          <span class="spec-label">Spacing</span>
          <strong>{activeMoodboard.space.panelPadding}</strong>
          <span>Page inset {activeMoodboard.space.pageInset}</span>
          <span>Cluster gap {activeMoodboard.space.clusterGap}</span>
        </article>
      </div>
    </section>
  </div>

  <section class="panel-surface">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Applied runtime</p>
        <strong>Desktop shell under the active moodboard</strong>
      </div>
      <div class="action-row">
        <button type="button" class="mini-btn" onclick={() => void onPatchState?.({ dialogSurface: 'create' })}>Create</button>
        <button type="button" class="mini-btn" onclick={() => void onPatchState?.({ dialogSurface: 'share', secondary: 'locations' })}>Share</button>
        <button type="button" class="mini-btn" onclick={() => void onPatchState?.({ dialogSurface: 'none', workspace: 'split', secondary: 'flow' })}>Flow</button>
      </div>
    </div>

    <StudioRuntime page="desktop" {data} studioState={state} {uiState} {onPatchState} />
  </section>
</section>

<style>
  .moodboard-shell,
  .moodboard-grid,
  .card-grid,
  .spec-grid {
    display: grid;
    gap: 1rem;
  }

  .moodboard-grid {
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.95fr);
  }

  .panel-surface {
    padding: 1.15rem;
    border-radius: var(--nb-radius-xl);
    border: 1px solid var(--nb-border);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-shell-top) 94%, white 6%), color-mix(in srgb, var(--nb-panel-bg) 96%, white 4%));
    box-shadow: var(--nb-shadow-md);
  }

  .moodboard-hero {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    background:
      radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--nb-accent-soft) 80%, white 20%), transparent 38%),
      linear-gradient(135deg, color-mix(in srgb, var(--nb-shell-top) 94%, white 6%), color-mix(in srgb, var(--nb-panel-bg) 92%, var(--nb-accent-soft) 8%));
  }

  .moodboard-hero h1,
  .hero-note {
    margin: 0;
  }

  .moodboard-hero h1 {
    font-family: var(--nb-font-display);
    font-size: clamp(2rem, 3vw, 3.1rem);
    line-height: 1;
  }

  .hero-note {
    margin-top: 0.45rem;
    max-width: 40rem;
    color: var(--nb-text-soft);
    line-height: 1.55;
  }

  .hero-metrics,
  .action-row {
    display: flex;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .hero-metrics {
    align-self: flex-start;
    justify-content: flex-end;
  }

  .hero-metrics div,
  .spec-card,
  .mood-card {
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-card-bg) 94%, white 6%);
    box-shadow: var(--nb-shadow-sm);
  }

  .hero-metrics div {
    min-width: 132px;
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem;
  }

  .hero-metrics span,
  .spec-label,
  .eyebrow {
    color: var(--nb-text-soft);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    align-items: flex-start;
    margin-bottom: 0.95rem;
  }

  .card-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .mood-card {
    display: grid;
    gap: 0.8rem;
    padding: 1rem;
    text-align: left;
    cursor: pointer;
  }

  .mood-card.active {
    border-color: color-mix(in srgb, var(--nb-accent) 34%, var(--nb-border) 66%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--nb-accent) 20%, transparent), var(--nb-shadow-sm);
  }

  .mood-card-head {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .mood-card-head div {
    display: grid;
    gap: 0.25rem;
  }

  .mood-card-head span:last-child {
    color: var(--nb-text-soft);
    line-height: 1.45;
  }

  .mood-chip,
  .mini-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 30px;
    padding: 0 0.8rem;
    border-radius: var(--nb-radius-pill);
    border: 1px solid color-mix(in srgb, var(--nb-accent) 18%, var(--nb-border) 82%);
    background: var(--nb-accent-soft);
    color: var(--nb-accent-strong);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .mini-btn {
    background: transparent;
    color: var(--nb-text-main);
    cursor: pointer;
  }

  .swatch-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.42rem;
  }

  .swatch-strip span {
    height: 58px;
    border-radius: var(--nb-radius-md);
    border: 1px solid rgba(255, 255, 255, 0.38);
  }

  .note-row {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .note-row span,
  .spec-card span:last-child {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 0 0.7rem;
    border-radius: var(--nb-radius-pill);
    background: color-mix(in srgb, var(--nb-card-bg) 92%, white 8%);
    color: var(--nb-text-soft);
    border: 1px solid var(--nb-border);
  }

  .spec-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .spec-card {
    display: grid;
    gap: 0.35rem;
    padding: 1rem;
  }

  @media (max-width: 900px) {
    .moodboard-grid,
    .spec-grid {
      grid-template-columns: 1fr;
    }

    .moodboard-hero {
      flex-direction: column;
    }
  }
</style>
