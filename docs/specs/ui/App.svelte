<script>
  import { onMount, tick } from 'svelte';
  import { setDevContext } from './system/dev.js';
  import DevBadge from './system/components/DevBadge.svelte';
  import StudioNav from './components/StudioNav.svelte';
  import StudioControls from './components/StudioControls.svelte';
  import StudioRuntime from './components/StudioRuntime.svelte';
  import TransitionGraphPage from './components/TransitionGraphPage.svelte';
  import { STUDIO_DATA } from './studio-data.js';
  import { createStudioModel } from './studio.js';

  let { page = 'overview' } = $props();

  const bridge = globalThis.NearbytesUiBridgeShared || {};
  const model = $derived.by(() => createStudioModel({ data: STUDIO_DATA, bridge, page }));

  setDevContext(true);

  let studioRoot = $state();
  let state = $state({});
  let uiState = $state({});
  let bodyHtml = $state('');
  let title = $state('Nearbytes UI Studio');

  function refresh(nextState = state) {
    const normalizedState = model.normalizeUiState(nextState);
    state = normalizedState;
    uiState = normalizedState;
    model.applyTokens(document.documentElement.style, normalizedState);
    bodyHtml = model.renderPageBody(normalizedState);
    title = model.pageTitle();
    model.saveState(normalizedState);
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
    refresh(nextState);
    await tick();
    restoreFocus(focusDescriptor);
  }

  async function patchStudioState(patch) {
    await commitState({ ...state, ...patch });
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
    refresh(model.loadState());

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
  {:else if page === 'graph'}
    <TransitionGraphPage
      data={STUDIO_DATA}
      {bridge}
      studioState={state}
      onStudioStateChange={patchStudioState}
    />
  {:else if page === 'desktop' || page === 'phone' || page === 'styles'}
    <div class="studio-grid">
      <div class="studio-main">
        <StudioRuntime
          {page}
          data={STUDIO_DATA}
          {state}
          {uiState}
          onPatchState={patchStudioState}
        />
      </div>
      <StudioControls data={STUDIO_DATA} {state} {uiState} />
    </div>
  {:else}
    <div class="studio-grid">
      <div class="studio-main">{@html bodyHtml}</div>
      <StudioControls data={STUDIO_DATA} {state} {uiState} />
    </div>
  {/if}
</div>

<DevBadge />
