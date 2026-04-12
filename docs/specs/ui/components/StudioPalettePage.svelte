<script lang="ts">
  let {
    data,
    state,
  } = $props<{
    data: typeof import('../studio-data.js').STUDIO_DATA;
    state: Record<string, unknown>;
  }>();

  const activeMoodboard = $derived.by(() =>
    data.moodboards.find((item) => item.id === state.moodboardId) ?? data.moodboards[0]
  );

  const swatches = $derived.by(() => [
    ['Background', activeMoodboard.palette.bg],
    ['Paper', activeMoodboard.palette.paper],
    ['Panel', activeMoodboard.palette.panel],
    ['Ink', activeMoodboard.palette.ink],
    ['Muted', activeMoodboard.palette.muted],
    ['Line', activeMoodboard.palette.line],
    ['Accent', activeMoodboard.palette.accent],
    ['Accent strong', activeMoodboard.palette.accentStrong],
    ['Accent soft', activeMoodboard.palette.accentSoft],
    ['Glow', activeMoodboard.palette.glow],
  ] as const);
</script>

<section class="palette-shell">
  <div class="palette-hero panel-surface">
    <div>
      <p class="eyebrow">Foundation tokens</p>
      <h1>{activeMoodboard.name}</h1>
      <p class="hero-note">Color, typography, motion, radius, and spacing are defined here and applied to both the studio and the app runtime.</p>
    </div>
    <div class="metric-row">
      <div><span>Accent strength</span><strong>{state.accentStrength}%</strong></div>
      <div><span>Radius mode</span><strong>{state.radiusMode}</strong></div>
      <div><span>Surface blur</span><strong>{activeMoodboard.chrome.blur}</strong></div>
    </div>
  </div>

  <div class="palette-grid">
    {#each swatches as [label, value]}
      <article class="swatch-card panel-surface">
        <div class="swatch-color" style={`background:${value}`}></div>
        <div class="swatch-meta">
          <strong>{label}</strong>
          <code>{value}</code>
        </div>
      </article>
    {/each}
  </div>

  <div class="foundation-grid">
    <section class="panel-surface foundation-card">
      <p class="eyebrow">Typography</p>
      <div class="type-block display">{activeMoodboard.typography.displayLabel}</div>
      <div class="type-block body">{activeMoodboard.typography.bodyLabel}</div>
      <div class="type-block mono">{activeMoodboard.typography.monoLabel}</div>
    </section>

    <section class="panel-surface foundation-card">
      <p class="eyebrow">Chrome</p>
      <div class="foundation-stack">
        <div><span>XL radius</span><strong>{activeMoodboard.chrome.radiusXl}</strong></div>
        <div><span>LG radius</span><strong>{activeMoodboard.chrome.radiusLg}</strong></div>
        <div><span>MD radius</span><strong>{activeMoodboard.chrome.radiusMd}</strong></div>
        <div><span>Shadow</span><strong>{activeMoodboard.chrome.styleLabel}</strong></div>
      </div>
    </section>

    <section class="panel-surface foundation-card">
      <p class="eyebrow">Motion</p>
      <div class="foundation-stack">
        <div><span>Fast</span><strong>{activeMoodboard.motion.fast}</strong></div>
        <div><span>Medium</span><strong>{activeMoodboard.motion.medium}</strong></div>
        <div><span>Slow</span><strong>{activeMoodboard.motion.slow}</strong></div>
      </div>
    </section>

    <section class="panel-surface foundation-card">
      <p class="eyebrow">Space</p>
      <div class="foundation-stack">
        <div><span>Page inset</span><strong>{activeMoodboard.space.pageInset}</strong></div>
        <div><span>Panel gap</span><strong>{activeMoodboard.space.panelGap}</strong></div>
        <div><span>Panel padding</span><strong>{activeMoodboard.space.panelPadding}</strong></div>
        <div><span>Cluster gap</span><strong>{activeMoodboard.space.clusterGap}</strong></div>
      </div>
    </section>
  </div>
</section>

<style>
  .palette-shell,
  .palette-grid,
  .foundation-grid,
  .metric-row,
  .foundation-stack {
    display: grid;
    gap: 1rem;
  }

  .panel-surface {
    padding: 1.15rem;
    border-radius: var(--nb-radius-xl);
    border: 1px solid var(--nb-border);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-shell-top) 94%, white 6%), color-mix(in srgb, var(--nb-panel-bg) 96%, white 4%));
    box-shadow: var(--nb-shadow-md);
  }

  .palette-hero {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-end;
  }

  .palette-hero h1,
  .hero-note {
    margin: 0;
  }

  .palette-hero h1 {
    font-family: var(--nb-font-display);
    font-size: clamp(2rem, 3vw, 3rem);
    line-height: 1;
  }

  .hero-note {
    margin-top: 0.45rem;
    max-width: 40rem;
    color: var(--nb-text-soft);
    line-height: 1.5;
  }

  .eyebrow {
    margin: 0 0 0.35rem;
    color: var(--nb-text-soft);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .metric-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    min-width: min(420px, 100%);
  }

  .metric-row div,
  .foundation-stack div {
    display: grid;
    gap: 0.2rem;
    padding: 0.9rem;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-card-bg) 94%, white 6%);
    box-shadow: var(--nb-shadow-sm);
  }

  .metric-row span,
  .foundation-stack span {
    color: var(--nb-text-soft);
    font-size: 0.8rem;
  }

  .palette-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .swatch-card {
    display: grid;
    gap: 0.85rem;
    padding: 0.9rem;
  }

  .swatch-color {
    min-height: 108px;
    border-radius: var(--nb-radius-lg);
    border: 1px solid rgba(255, 255, 255, 0.36);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }

  .swatch-meta {
    display: grid;
    gap: 0.25rem;
  }

  .swatch-meta code {
    color: var(--nb-text-soft);
    font-size: 0.8rem;
  }

  .foundation-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .foundation-card {
    display: grid;
    gap: 0.8rem;
  }

  .type-block {
    padding: 0.85rem 0.95rem;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-card-bg) 94%, white 6%);
    box-shadow: var(--nb-shadow-sm);
  }

  .type-block.display {
    font-family: var(--nb-font-display);
    font-size: 1.5rem;
  }

  .type-block.body {
    font-family: var(--nb-font-body);
    font-size: 1rem;
  }

  .type-block.mono {
    font-family: var(--nb-font-mono);
    font-size: 0.92rem;
  }

  @media (max-width: 980px) {
    .palette-hero {
      flex-direction: column;
      align-items: stretch;
    }

    .metric-row,
    .foundation-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
