import type { Auth } from './api.js';

interface ResolveActiveHubAuthOptions {
  runtimeAuth?: Auth | null;
  currentAuth?: Auth | null;
  activeMountSecret?: string | null;
  mountedSecretForVolumeId?: string | null;
}

function buildSecretAuth(secret: string | null | undefined): Auth | null {
  const normalized = typeof secret === 'string' ? secret.trim() : '';
  if (normalized === '') {
    return null;
  }
  return {
    type: 'secret',
    secret: normalized,
  };
}

export function resolveActiveHubAuth(options: ResolveActiveHubAuthOptions): Auth | null {
  return (
    options.runtimeAuth ??
    options.currentAuth ??
    buildSecretAuth(options.activeMountSecret) ??
    buildSecretAuth(options.mountedSecretForVolumeId)
  );
}