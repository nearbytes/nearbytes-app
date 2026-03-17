function readDebugValue(): string {
  const candidates = [
    readProcessDebug(),
    import.meta.env.VITE_DEBUG,
    readStorageDebug(globalThis.localStorage),
    readStorageDebug(globalThis.sessionStorage),
    readQueryDebug(),
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim() !== '')?.trim() ?? '';
}

export function isUiDebugEnabled(scope?: string): boolean {
  return matchesDebugValue(readDebugValue(), scope);
}

export function uiDebugLog(scope: string, ...args: unknown[]): void {
  if (isUiDebugEnabled(scope)) {
    console.log(...args);
  }
}

function readProcessDebug(): string | undefined {
  const processValue = (globalThis as { process?: { env?: { DEBUG?: string } } }).process?.env?.DEBUG;
  return typeof processValue === 'string' ? processValue : undefined;
}

function readStorageDebug(storage: Storage | undefined): string | undefined {
  if (!storage) {
    return undefined;
  }
  try {
    const value = storage.getItem('DEBUG');
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function readQueryDebug(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return new URL(window.location.href).searchParams.get('DEBUG') ?? undefined;
  } catch {
    return undefined;
  }
}

function matchesDebugValue(rawValue: string | undefined, scope?: string): boolean {
  const value = rawValue?.trim();
  if (!value) {
    return false;
  }
  const normalizedScope = scope?.trim();
  const tokens = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return tokens.some((token) => tokenMatchesScope(token, normalizedScope));
}

function tokenMatchesScope(token: string, scope?: string): boolean {
  const normalized = token.toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === '*') {
    return true;
  }
  if (!scope) {
    return false;
  }
  const target = scope.toLowerCase();
  return normalized === target || normalized === `nearbytes:${target}` || normalized === 'nearbytes';
}