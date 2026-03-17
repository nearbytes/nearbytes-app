export function isServerDebugEnabled(scope?: string): boolean {
  return matchesDebugValue(process.env.DEBUG, scope);
}

export function debugServerLog(scope: string, ...args: unknown[]): void {
  if (isServerDebugEnabled(scope)) {
    console.log(...args);
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