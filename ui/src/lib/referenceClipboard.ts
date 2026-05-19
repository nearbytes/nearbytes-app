import type { RecipientReferenceBundle, SourceReferenceBundle } from './api.js';
import {
  parseRecipientReferenceJson,
  parseSourceReferenceJson,
} from 'nearbytes-files';

export type NearbytesClipboardPayload =
  | { kind: 'source'; bundle: SourceReferenceBundle }
  | { kind: 'recipient'; bundle: RecipientReferenceBundle };

export const SOURCE_BUNDLE_MIME = 'application/x-nearbytes-source-refs+json';
export const RECIPIENT_BUNDLE_MIME = 'application/x-nearbytes-recipient-refs+json';

function detectNearbytesClipboardPayload(text: string): (NearbytesClipboardPayload & { mimeType: string }) | null {
  try {
    const sourceBundle = parseSourceReferenceJson(text);
    if (sourceBundle) {
      return {
        kind: 'source',
        bundle: sourceBundle,
        mimeType: SOURCE_BUNDLE_MIME,
      };
    }
  } catch {
    // Treat malformed source payloads as a non-match so callers can continue probing.
  }

  try {
    const recipientBundle = parseRecipientReferenceJson(text);
    if (recipientBundle) {
      return {
        kind: 'recipient',
        bundle: recipientBundle,
        mimeType: RECIPIENT_BUNDLE_MIME,
      };
    }
  } catch {
    // Treat malformed recipient payloads as a non-match.
  }

  return null;
}

export function parseNearbytesClipboardPayload(text: string): NearbytesClipboardPayload | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  const detected = detectNearbytesClipboardPayload(trimmed);
  if (!detected) {
    return null;
  }

  return {
    kind: detected.kind,
    bundle: detected.bundle,
  };
}

export async function writeNearbytesClipboardPayload(serialized: string): Promise<void> {
  const detected = detectNearbytesClipboardPayload(serialized.trim());

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    const textBlob = new Blob([serialized], { type: 'text/plain' });
    const clipboardData: Record<string, Blob> = {
      'text/plain': textBlob,
    };
    if (detected) {
      clipboardData[detected.mimeType] = new Blob([serialized], { type: detected.mimeType });
    }
    const item = new ClipboardItem(clipboardData);
    await navigator.clipboard.write([item]);
    return;
  }

  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(serialized);
}
