import { Buffer } from 'buffer';
import { mount } from 'svelte';
import App from './App.svelte';

const runtimeGlobals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
runtimeGlobals.Buffer ??= Buffer;

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
