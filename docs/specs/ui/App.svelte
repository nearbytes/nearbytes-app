<script>
  import { onMount, tick } from 'svelte';
  import StudioNav from './components/StudioNav.svelte';
  import StudioControls from './components/StudioControls.svelte';
  import { STUDIO_DATA } from './studio-data.js';
  import { createStudioModel } from './studio.js';

  export let page = 'overview';

  const bridge = globalThis.NearbytesUiBridgeShared || {};
  const model = createStudioModel({ data: STUDIO_DATA, bridge, page });

  let studioRoot;
  let state = model.loadState();
  let uiState = model.normalizeUiState(state);
  let bodyHtml = model.renderPageBody(state);
  let title = model.pageTitle();

  function refresh() {
    uiState = model.normalizeUiState(state);
    model.applyTokens(document.documentElement.style, state);
    bodyHtml = model.renderPageBody(state);
    title = model.pageTitle();
    model.saveState(state);
  }

  function captureFocusDescriptor(target) {
    if (target instanceof HTMLInputElement && target.dataset.styleInput) {
      return { key: target.dataset.styleInput, start: target.selectionStart, end: target.selectionEnd };
    }
    return null;
  }

  function restoreFocus(descriptor) {
    if (!descriptor) return;
    const nextFocus = document.querySelector(`[data-style-input="${descriptor.key}"]`);
    if (nextFocus instanceof HTMLInputElement) {
      nextFocus.focus();
      if (typeof descriptor.start === 'number' && typeof descriptor.end === 'number') {
        nextFocus.setSelectionRange(descriptor.start, descriptor.end);
      }
    }
  }

  async function commitState(nextState, focusDescriptor = null) {
    state = nextState;
    refresh();
    await tick();
    restoreFocus(focusDescriptor);
  }

  async function handleClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-moodboard],[data-radius],[data-control],[data-toggle],[data-view],[data-style-combo-toggle],[data-style-option]') : null;
    if (!(target instanceof HTMLElement)) return;
    event.preventDefault();
    const nextState = { ...state };
    const focusDescriptor = captureFocusDescriptor(event.target);
    if (target.dataset.moodboard) nextState.moodboardId = target.dataset.moodboard;
    if (target.dataset.radius) nextState.radiusMode = target.dataset.radius;
    if (target.dataset.control) nextState[target.dataset.control] = target.dataset.value;
    if (target.dataset.toggle) nextState[target.dataset.toggle] = !nextState[target.dataset.toggle];
    if (target.dataset.view) nextState.viewMode = target.dataset.view;
    if (target.dataset.styleComboToggle) nextState[target.dataset.styleComboToggle] = !nextState[target.dataset.styleComboToggle];
    if (target.dataset.styleOption) {
      nextState.stylesSortValue = target.dataset.styleOption;
      nextState.stylesSortOpen = false;
    }
    await commitState(nextState, focusDescriptor);
  }

  async function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const nextState = { ...state };
    const focusDescriptor = captureFocusDescriptor(target);
    if (target.dataset.range) {
      nextState[target.dataset.range] = Number(target.value);
      await commitState(nextState, focusDescriptor);
      return;
    }
    if (target.dataset.styleInput) {
      nextState[target.dataset.styleInput] = target.value;
      await commitState(nextState, focusDescriptor);
    }
  }

  onMount(() => {
    refresh();

    if (!studioRoot) {
      return undefined;
    }

    studioRoot.addEventListener('click', handleClick);
    studioRoot.addEventListener('input', handleInput);

    return () => {
      studioRoot.removeEventListener('click', handleClick);
      studioRoot.removeEventListener('input', handleInput);
    };
  });
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="studio" bind:this={studioRoot}>
  <StudioNav {page} />
  {#if page === 'overview'}
    <div class="studio-main overview">{@html bodyHtml}</div>
  {:else}
    <div class="studio-grid">
      <div class="studio-main">{@html bodyHtml}</div>
      <StudioControls data={STUDIO_DATA} {state} {uiState} />
    </div>
  {/if}
</div>