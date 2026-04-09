<script>
  let { page = 'overview' } = $props();

  const links = [
    ['overview', 'Studio', './index.html'],
    ['moodboard', 'Moodboard', './moodboard.html'],
    ['palette', 'Palette', './palette.html'],
    ['styles', 'Toolkit', './styles.html'],
    ['desktop', 'Desktop UI', './desktop.html'],
    ['phone', 'Phone UI', './phone.html'],
  ];
</script>

<section class="studio-nav">
  <div class="studio-top minimal">
    <div>
      <p class="eyebrow">Nearbytes executable UI studio</p>
      <p class="nav-copy">Imported surface map plus editable shells.</p>
    </div>
    <div class="studio-nav-links">
      {#each links as [id, label, href]}
        <a class="nav-link" class:active={page === id} href={href}>{label}</a>
      {/each}
    </div>
  </div>
</section>