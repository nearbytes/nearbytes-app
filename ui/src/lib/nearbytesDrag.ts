export const NEARBYTES_DRAG_TYPE = 'application/x-nearbytes-file';

export interface NearbytesDragPayload {
  blobHash: string;
  filename: string;
  mimeType?: string;
}

export function parseNearbytesDragPayload(raw: string): NearbytesDragPayload | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<NearbytesDragPayload>;
    if (!parsed || typeof parsed.blobHash !== 'string' || typeof parsed.filename !== 'string') {
      return null;
    }
    return {
      blobHash: parsed.blobHash,
      filename: parsed.filename,
      mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : '',
    };
  } catch {
    return null;
  }
}
