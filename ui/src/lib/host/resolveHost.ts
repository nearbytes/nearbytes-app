import { getCompatibilityHost, resetCompatibilityHostForTests } from './compatibilityHost.js';
import { getPhoneHost, resetPhoneHostForTests } from './phoneHost.js';
import type { NearbytesHostContract } from './contract.js';
import { getRuntimeConfig } from './runtimeTransport.js';

let activeHostPromise: Promise<NearbytesHostContract> | null = null;

export function resetActiveHostForTests(): void {
  activeHostPromise = null;
  resetCompatibilityHostForTests();
  resetPhoneHostForTests();
}

export async function getActiveHost(): Promise<NearbytesHostContract> {
  if (activeHostPromise) {
    return activeHostPromise;
  }

  activeHostPromise = (async () => {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig.runtimeHostKind === 'phone') {
      return getPhoneHost();
    }
    return getCompatibilityHost();
  })();

  try {
    return await activeHostPromise;
  } catch (error) {
    if (activeHostPromise) {
      activeHostPromise = null;
    }
    throw error;
  }
}