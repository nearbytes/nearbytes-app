<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { setDevContext } from './system/dev.js';
  import DevBadge from './system/components/DevBadge.svelte';
  import StudioNav from './components/StudioNav.svelte';
  import StudioControls from './components/StudioControls.svelte';
  import StudioOverviewPage from './components/StudioOverviewPage.svelte';
  import StudioMoodboardPage from './components/StudioMoodboardPage.svelte';
  import StudioPalettePage from './components/StudioPalettePage.svelte';
  import StudioRuntime from './components/StudioRuntime.svelte';
  import TransitionGraphPage from './components/TransitionGraphPage.svelte';
  import { createStudioDesignRuntime } from './system/mockRuntime.js';
  import { setDesignRuntimeContext } from './system/runtime.js';
  import { STUDIO_DATA } from './studio-data.js';
  import {
    applyStudioStateTokens,
    createStudioStateController,
  } from './system/studioState.js';

  let { page = 'overview' } = $props();

  setDevContext(false);

  let studioRoot = $state();
  const controller = createStudioStateController({
    moodboardId: STUDIO_DATA.defaults.moodboardId,
    accentStrength: STUDIO_DATA.defaults.accentStrength,
    radiusMode: STUDIO_DATA.defaults.radiusMode,
    density: STUDIO_DATA.defaults.density,
    viewport: STUDIO_DATA.defaults.viewport,
    hubId: STUDIO_DATA.defaults.hubId,
    workspace: STUDIO_DATA.defaults.workspace,
    storageMode: STUDIO_DATA.defaults.storageMode,
    uiMachine: STUDIO_DATA.defaults.uiMachine ?? undefined,
  });
  setDesignRuntimeContext(
    createStudioDesignRuntime({
      data: STUDIO_DATA,
      getState: () => controller.snapshot(),
    })
  );
  let state = $state(controller.snapshot());
  let uiState = $state(controller.snapshot());
  const pageTitles = {
    overview: 'Nearbytes UI Studio',
    moodboard: 'Nearbytes UI Studio · Moodboard',
    palette: 'Nearbytes UI Studio · Palette',
    styles: 'Nearbytes UI Studio · Toolkit',
    graph: 'Nearbytes UI Studio · Graph',
    desktop: 'Nearbytes UI Studio · Desktop',
    phone: 'Nearbytes UI Studio · Phone',
  };
  const title = $derived(pageTitles[page] ?? pageTitles.overview);

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

  async function commitState(patch, focusDescriptor = null) {
    controller.patch(patch);
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
    const nextPatch = {};
    const focusDescriptor = captureFocusDescriptor(event.target);
    if (target.dataset.moodboard) nextPatch.moodboardId = target.dataset.moodboard;
    if (target.dataset.radius) nextPatch.radiusMode = target.dataset.radius;
    if (target.dataset.control) nextPatch[target.dataset.control] = target.dataset.value;
    if (target.dataset.toggle) nextPatch[target.dataset.toggle] = !state[target.dataset.toggle];
    if (target.dataset.view) nextPatch.viewMode = target.dataset.view;
    if (target.dataset.styleComboToggle) nextPatch[target.dataset.styleComboToggle] = !state[target.dataset.styleComboToggle];
    if (target.dataset.styleOption) {
      nextPatch.stylesSortValue = target.dataset.styleOption;
      nextPatch.stylesSortOpen = false;
    }
    await commitState(nextPatch, focusDescriptor);
  }

  async function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const nextPatch = {};
    const focusDescriptor = captureFocusDescriptor(target);
    if (target.dataset.range) {
      nextPatch[target.dataset.range] = Number(target.value);
      await commitState(nextPatch, focusDescriptor);
      return;
    }
    if (target.dataset.styleInput) {
      nextPatch[target.dataset.styleInput] = target.value;
      await commitState(nextPatch, focusDescriptor);
    }
  }

  onMount(() => {
    const unsubscribe = controller.subscribe((value) => {
      state = value;
      uiState = value;
      applyStudioStateTokens(document.documentElement.style, value);
      controller.save();
    });
    controller.load();

    if (!studioRoot) {
      return () => {
        unsubscribe();
      };
    }

    studioRoot.addEventListener('click', handleClick);
    studioRoot.addEventListener('input', handleInput);

    return () => {
      unsubscribe();
      studioRoot.removeEventListener('click', handleClick);
      studioRoot.removeEventListener('input', handleInput);
    };
  });

  onDestroy(() => {
    controller.save();
  });
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="studio" bind:this={studioRoot}>
  <StudioNav {page} />
  {#if page === 'overview'}
    <div class="studio-main overview">
      <StudioOverviewPage
        data={STUDIO_DATA}
        {state}
        {uiState}
        onPatchState={patchStudioState}
      />
    </div>
  {:else if page === 'moodboard'}
    <div class="studio-main">
      <StudioMoodboardPage
        data={STUDIO_DATA}
        {state}
        {uiState}
        onPatchState={patchStudioState}
      />
    </div>
  {:else if page === 'palette'}
    <div class="studio-main">
      <StudioPalettePage data={STUDIO_DATA} {state} />
    </div>
  {:else if page === 'graph'}
    <TransitionGraphPage
      data={STUDIO_DATA}
      uiStore={controller.uiStore}
      studioState={state}
      onStudioStateChange={patchStudioState}
    />
  {:else if page === 'desktop' || page === 'phone' || page === 'styles'}
    <div class="studio-grid">
      <div class="studio-main">
        <StudioRuntime
          {page}
          data={STUDIO_DATA}
          studioState={state}
          {uiState}
          onPatchState={patchStudioState}
        />
      </div>
      <StudioControls data={STUDIO_DATA} {state} {uiState} />
    </div>
  {/if}
</div>

<DevBadge />
