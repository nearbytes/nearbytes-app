function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function getProcessLike(): { cwd?: () => string; platform?: string } | null {
  const candidate = globalThis as { process?: { cwd?: () => string; platform?: string } };
  return candidate.process ?? null;
}

function splitRoot(value: string): { root: string; rest: string } {
  const normalized = normalizeSlashes(value);
  const uncMatch = normalized.match(/^\/\/[^/]+\/[^/]+/u);
  if (uncMatch) {
    return {
      root: uncMatch[0],
      rest: normalized.slice(uncMatch[0].length).replace(/^\/+/, ''),
    };
  }

  const driveMatch = normalized.match(/^[A-Za-z]:/u);
  if (driveMatch) {
    return {
      root: `${driveMatch[0]}/`,
      rest: normalized.slice(driveMatch[0].length).replace(/^\/+/, ''),
    };
  }

  if (normalized.startsWith('/')) {
    return {
      root: '/',
      rest: normalized.replace(/^\/+/, ''),
    };
  }

  return {
    root: '',
    rest: normalized,
  };
}

function normalizeSegments(root: string, input: string): string {
  const segments = input.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop();
        continue;
      }
      if (!root) {
        normalized.push('..');
      }
      continue;
    }
    normalized.push(segment);
  }

  const joined = normalized.join('/');
  if (root) {
    return joined ? `${root}${joined}` : root;
  }
  return joined || '.';
}

function normalizePath(value: string): string {
  const { root, rest } = splitRoot(value);
  return normalizeSegments(root, rest);
}

function isAbsolute(value: string): boolean {
  const { root } = splitRoot(value);
  return root.length > 0;
}

function resolvePath(...parts: string[]): string {
  const filtered = parts.filter((part) => typeof part === 'string' && part.trim() !== '');
  const processLike = getProcessLike();
  let combined = normalizeSlashes(processLike?.cwd?.() ?? '/');

  for (const part of filtered) {
    const normalizedPart = normalizeSlashes(part);
    if (isAbsolute(normalizedPart)) {
      combined = normalizedPart;
      continue;
    }
    combined = combined.replace(/\/+$/u, '');
    combined = combined ? `${combined}/${normalizedPart}` : normalizedPart;
  }

  return normalizePath(combined);
}

function joinPath(...parts: string[]): string {
  const filtered = parts.filter((part) => typeof part === 'string' && part.length > 0);
  if (filtered.length === 0) {
    return '.';
  }
  if (filtered.some((part, index) => index > 0 && isAbsolute(part))) {
    return resolvePath(...filtered);
  }
  return normalizePath(filtered.map((part) => normalizeSlashes(part)).join('/'));
}

function dirnamePath(value: string): string {
  const normalized = normalizePath(value);
  const { root, rest } = splitRoot(normalized);
  const trimmedRest = rest.replace(/\/+$/u, '');
  if (!trimmedRest) {
    return root || '.';
  }
  const index = trimmedRest.lastIndexOf('/');
  if (index < 0) {
    return root || '.';
  }
  const nextRest = trimmedRest.slice(0, index);
  return nextRest ? `${root}${nextRest}` : root || '.';
}

function basenamePath(value: string): string {
  const normalized = normalizePath(value).replace(/\/+$/u, '');
  const { root, rest } = splitRoot(normalized);
  if (!rest) {
    return root.replace(/\/+$/u, '') || '/';
  }
  const index = rest.lastIndexOf('/');
  return index >= 0 ? rest.slice(index + 1) : rest;
}

function normalizePosix(value: string): string {
  const normalized = normalizeSlashes(value);
  const root = normalized.startsWith('/') ? '/' : '';
  const rest = normalized.replace(/^\/+/, '');
  return normalizeSegments(root, rest);
}

function basenamePosix(value: string): string {
  const normalized = normalizePosix(value).replace(/\/+$/u, '');
  if (!normalized || normalized === '/') {
    return '';
  }
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export const managedSharePath = {
  resolve: resolvePath,
  join: joinPath,
  dirname: dirnamePath,
  basename: basenamePath,
  posix: {
    normalize: normalizePosix,
    basename: basenamePosix,
  },
} as const;

export function managedShareCurrentWorkingDirectory(): string | undefined {
  return getProcessLike()?.cwd?.();
}

export function managedSharePlatform(): string {
  return getProcessLike()?.platform ?? 'browser';
}
