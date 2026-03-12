import type { RecipientReferenceBundle, SourceReferenceBundle } from './api.js';

export type NearbytesClipboardPayload =
  | { kind: 'source'; bundle: SourceReferenceBundle }
  | { kind: 'recipient'; bundle: RecipientReferenceBundle };

const SOURCE_BUNDLE_PROTOCOL = 'nb.src.refs.v1';
const RECIPIENT_BUNDLE_PROTOCOL = 'nb.refs.v1';
export const SOURCE_BUNDLE_MIME = 'application/x-nearbytes-source-refs+json';

export function parseNearbytesClipboardPayload(text: string): NearbytesClipboardPayload | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const protocol = (parsed as { p?: unknown }).p;
  if (protocol === SOURCE_BUNDLE_PROTOCOL) {
    return {
      kind: 'source',
      bundle: parsed as SourceReferenceBundle,
    };
  }
  if (protocol === RECIPIENT_BUNDLE_PROTOCOL) {
    return {
      kind: 'recipient',
      bundle: parsed as RecipientReferenceBundle,
    };
  }
  return null;
}

export async function writeNearbytesClipboardPayload(serialized: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    const textBlob = new Blob([serialized], { type: 'text/plain' });
    const item = new ClipboardItem({
      'text/plain': textBlob,
      [SOURCE_BUNDLE_MIME]: new Blob([serialized], { type: SOURCE_BUNDLE_MIME }),
    });
    await navigator.clipboard.write([item]);
    return;
  }

  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(serialized);
}
