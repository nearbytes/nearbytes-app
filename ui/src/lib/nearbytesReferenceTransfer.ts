import {
  exportSourceReferences,
  importSourceReferences,
  type Auth,
  type ChatAttachment,
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

export function createChatAttachmentFromSourceBundle(
  bundle: SourceReferenceBundle
): { attachment: ChatAttachment; truncated: boolean } {
  const [firstItem] = bundle.items;
  if (!firstItem) {
    throw new Error('Nearbytes file reference is empty.');
  }
  return {
    attachment: {
      kind: 'nb.src.ref.v1',
      name: firstItem.name,
      mime: firstItem.mime,
      createdAt: firstItem.createdAt,
      ref: firstItem.ref,
    },
    truncated: bundle.items.length > 1,
  };
}

export async function importMountedSourceReferenceBundle(
  auth: Auth,
  bundle: SourceReferenceBundle,
  resolveMountedSourceSecret: (volumeId: string) => string | null
): Promise<ReferenceImportResponse> {
  const sourceSecret = resolveMountedSourceSecret(bundle.s);
  if (!sourceSecret) {
    throw new Error('Source space is not mounted or unlocked locally.');
  }
  return importSourceReferences(auth, bundle, sourceSecret);
}
