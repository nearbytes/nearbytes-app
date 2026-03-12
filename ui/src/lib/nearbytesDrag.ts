export const NEARBYTES_DRAG_TYPE = 'application/x-nearbytes-file';

export interface NearbytesDragPayload {
  filenames: string[];
  primaryFilename: string;
  mimeType?: string;
}

export function parseNearbytesDragPayload(raw: string): NearbytesDragPayload | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      filenames?: unknown;
      primaryFilename?: unknown;
      mimeType?: unknown;
      filename?: unknown;
    };
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const filenames = Array.isArray(parsed.filenames)
      ? parsed.filenames.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : typeof parsed.filename === 'string' && parsed.filename.trim() !== ''
        ? [parsed.filename]
        : [];
    const primaryFilename =
      typeof parsed.primaryFilename === 'string' && parsed.primaryFilename.trim() !== ''
        ? parsed.primaryFilename
        : filenames[0] ?? '';
    if (filenames.length === 0 || primaryFilename === '') {
      return null;
    }

    return {
      filenames,
      primaryFilename,
      mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : '',
    };
  } catch {
    return null;
  }
}
