import {
  exportSourceReferences,
  importSourceReferences,
  type Auth,
  type ReferenceImportResponse,
  type SourceReferenceBundle,
} from './api.js';
import { parseNearbytesDragPayload } from './nearbytesDrag.js';
import { parseNearbytesClipboardPayload } from './referenceClipboard.js';

export function parseSourceReferenceBundleText(text: string): SourceReferenceBundle | null {
  const parsed = parseNearbytesClipboardPayload(text);
  return parsed?.kind === 'source' ? parsed.bundle : null;
}

export async function exportSourceReferenceBundleFromDrag(
  auth: Auth,
  payloadText: string
): Promise<SourceReferenceBundle> {
  const payload = parseNearbytesDragPayload(payloadText);
  if (!payload) {
    throw new Error('Dragged Nearbytes payload is invalid.');
  }
  const exported = await exportSourceReferences(auth, payload.filenames);
  return exported.bundle;
}

export async function importMountedSourceReferenceBundle(
  auth: Auth,
  bundle: SourceReferenceBundle,
  resolveMountedSourceSecret: (volumeId: string) => string | null
): Promise<ReferenceImportResponse> {
  const sourceSecret = resolveMountedSourceSecret(bundle.s);
  if (!sourceSecret) {
    throw new Error('Source hub is not mounted or unlocked locally.');
  }
  return importSourceReferences(auth, bundle, sourceSecret);
}
