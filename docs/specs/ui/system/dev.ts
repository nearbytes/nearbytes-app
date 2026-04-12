import { getContext, setContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';

const DEV_CONTEXT_KEY = 'dev';

export function setDevContext(value: boolean): Writable<boolean> {
  const store = writable(value);
  setContext(DEV_CONTEXT_KEY, store);
  return store;
}

export function getDevContext(): Writable<boolean> {
  return getContext<Writable<boolean>>(DEV_CONTEXT_KEY) ?? writable(false);
}

export function devSurface(
  node: HTMLElement,
  params: { enabled: boolean; name: string }
): { update: (next: { enabled: boolean; name: string }) => void } {
  function apply(next: { enabled: boolean; name: string }): void {
    node.dataset.devSurface = next.name;
    if (next.enabled) {
      node.dataset.devEnabled = 'true';
    } else {
      delete node.dataset.devEnabled;
    }
  }

  apply(params);

  return {
    update(next) {
      apply(next);
    },
  };
}
