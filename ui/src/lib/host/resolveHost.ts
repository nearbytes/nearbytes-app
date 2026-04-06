import { getCompatibilityHost, resetCompatibilityHostForTests } from './compatibilityHost.js';
import type { NearbytesHostContract } from './contract.js';

let activeHostPromise: Promise<NearbytesHostContract> | null = null;

export function resetActiveHostForTests(): void {
  activeHostPromise = null;
  resetCompatibilityHostForTests();
}

export async function getActiveHost(): Promise<NearbytesHostContract> {
  if (activeHostPromise) {
    return activeHostPromise;
  }

  activeHostPromise = getCompatibilityHost();

  try {
    return await activeHostPromise;
  } catch (error) {
    if (activeHostPromise) {
      activeHostPromise = null;
    }
    throw error;
  }
}