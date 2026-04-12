import { Buffer } from 'buffer';
import { mount } from 'svelte';
import App from './App.svelte';
import '../../docs/specs/ui/system/global.css';
import { applyDesignMoodboardVariables, defaultDesignMoodboard } from '../../docs/specs/ui/system/tokens.js';

const runtimeGlobals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
runtimeGlobals.Buffer ??= Buffer;

applyDesignMoodboardVariables(document.documentElement.style, defaultDesignMoodboard());

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
