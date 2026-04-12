<script>
  import {
    STUDIO_NAV_LINKS,
    buildStudioUrl,
  } from '../system/routes.js';

  let { page = 'overview' } = $props();
</script>

<section class="studio-nav">
  <div class="studio-top minimal">
    <div>
      <p class="eyebrow">Nearbytes executable UI studio</p>
      <p class="nav-copy">Pure Svelte design runtime. No backend, no app shell, one mocked UI machine.</p>
    </div>
    <div class="studio-nav-links">
      {#each STUDIO_NAV_LINKS as [id, label]}
        <a class="nav-link" class:active={page === id} href={buildStudioUrl(id)}>{label}</a>
      {/each}
    </div>
  </div>
</section>
