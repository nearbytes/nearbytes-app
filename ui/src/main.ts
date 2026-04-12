import { Buffer } from 'buffer';
import { mount } from 'svelte';
import App from './App.svelte';
import SpecStudioApp from '../../docs/specs/ui/App.svelte';
import '../../docs/specs/ui/studio.css';
import '../../docs/specs/ui/system/global.css';
import { applyDesignMoodboardVariables, defaultDesignMoodboard } from '../../docs/specs/ui/system/tokens.js';

const runtimeGlobals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
runtimeGlobals.Buffer ??= Buffer;

applyDesignMoodboardVariables(document.documentElement.style, defaultDesignMoodboard());

const currentUrl = new URL(window.location.href);
const designParam = currentUrl.searchParams.get('design');
const isDesignMode = designParam !== null || currentUrl.hash === '#design';
const designPage = designParam && designParam !== 'true' ? designParam : 'overview';
const RootComponent = isDesignMode ? SpecStudioApp : App;

const app = mount(RootComponent, {
  target: document.getElementById('app')!,
  props: isDesignMode ? { page: designPage } : undefined,
});

export default app;
