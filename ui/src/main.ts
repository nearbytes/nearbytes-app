import { Buffer } from 'buffer';
import { mount } from 'svelte';
import App from './App.svelte';
import './design/global.css';
import DesignStudio from './design/DesignStudio.svelte';
import { applyDesignMoodboardVariables, defaultDesignMoodboard } from './design/tokens.js';

const runtimeGlobals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
runtimeGlobals.Buffer ??= Buffer;

applyDesignMoodboardVariables(document.documentElement.style, defaultDesignMoodboard());

const currentUrl = new URL(window.location.href);
const isDesignMode = currentUrl.searchParams.has('design') || currentUrl.hash === '#design';
const RootComponent = isDesignMode ? DesignStudio : App;

const app = mount(RootComponent, {
  target: document.getElementById('app')!,
});

export default app;
