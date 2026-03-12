export function dedupeOrderedFilenames(filenames: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const filename of filenames) {
    if (filename.length === 0 || seen.has(filename)) {
      continue;
    }
    seen.add(filename);
    ordered.push(filename);
  }

  return ordered;
}

export function resolveImportedFilename(
  requestedName: string,
  takenNames: ReadonlySet<string>
): string {
  if (!takenNames.has(requestedName)) {
    return requestedName;
  }

  const { directory, stem, extension } = splitFilename(requestedName);
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const base = `${stem}${suffix}${extension}`;
    const candidate = directory ? `${directory}/${base}` : base;
    if (!takenNames.has(candidate)) {
      return candidate;
    }
  }
}

function splitFilename(filename: string): {
  directory: string;
  stem: string;
  extension: string;
} {
  const segments = filename.split('/');
  const baseName = segments.pop() ?? filename;
  const directory = segments.join('/');

  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return {
      directory,
      stem: baseName,
      extension: '',
    };
  }

  return {
    directory,
    stem: baseName.slice(0, dotIndex),
    extension: baseName.slice(dotIndex),
  };
}
