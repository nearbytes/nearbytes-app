<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title = '',
    eyebrow = '',
    detail = '',
    actions,
    body,
  } = $props<{
    title?: string;
    eyebrow?: string;
    detail?: string;
    actions?: Snippet;
    body?: Snippet;
  }>();
</script>

<section class="ui-card nb-panel-surface">
  {#if eyebrow || title || detail || actions}
    <header class="ui-card-header">
      <div class="ui-card-copy">
        {#if eyebrow}
          <p class="ui-card-eyebrow">{eyebrow}</p>
        {/if}
        {#if title}
          <h3 class="ui-card-title nb-type-heading">{title}</h3>
        {/if}
        {#if detail}
          <p class="ui-card-detail">{detail}</p>
        {/if}
      </div>
      {#if actions}
        <div class="ui-card-actions">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}
  {#if body}
    <div class="ui-card-body">
      {@render body()}
    </div>
  {/if}
</section>

<style>
  .ui-card {
    border-radius: var(--nb-radius-panel);
    padding: 1rem;
    display: grid;
    gap: 0.9rem;
    min-height: 0;
  }

  .ui-card-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .ui-card-copy,
  .ui-card-body {
    display: grid;
    gap: 0.35rem;
    min-height: 0;
  }

  .ui-card-eyebrow,
  .ui-card-title,
  .ui-card-detail {
    margin: 0;
  }

  .ui-card-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    color: var(--nb-accent-strong);
  }

  .ui-card-title {
    font-size: 1.02rem;
  }

  .ui-card-detail {
    color: var(--nb-text-soft);
    font-size: 0.86rem;
    line-height: 1.5;
  }

  .ui-card-actions {
    display: flex;
    gap: 0.55rem;
    align-items: start;
  }
</style>
