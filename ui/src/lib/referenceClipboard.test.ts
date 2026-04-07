import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bytesToBase64Url } from '../../../src/utils/encoding.js';
import {
  parseNearbytesClipboardPayload,
  RECIPIENT_BUNDLE_MIME,
  SOURCE_BUNDLE_MIME,
  writeNearbytesClipboardPayload,
} from './referenceClipboard.js';

const sourceVolumeId = 'ab'.repeat(65);
const recipientVolumeId = 'cd'.repeat(65);
const sourceHash = 'ef'.repeat(32);
const recipientHash = '12'.repeat(32);
const ephemeralKey = bytesToBase64Url(new Uint8Array(65).fill(7));
const nonce = bytesToBase64Url(new Uint8Array(12).fill(8));
const wrappedFek = bytesToBase64Url(new Uint8Array([13, 14, 15]));

const sourceBundleJson = JSON.stringify({
  p: 'nb.src.refs.v1',
  s: sourceVolumeId,
  items: [
    {
      name: 'alpha.txt',
      ref: {
        p: 'nb.src.ref.v1',
        s: sourceVolumeId,
        c: {
          t: 'b',
          h: sourceHash,
          z: 12,
        },
        x: 'AQID',
      },
    },
  ],
});

const recipientBundleJson = JSON.stringify({
  p: 'nb.refs.v1',
  r: recipientVolumeId,
  items: [
    {
      name: 'beta.txt',
      ref: {
        p: 'nb.ref.v1',
        c: {
          t: 'b',
          h: recipientHash,
          z: 8,
        },
        k: {
          r: recipientVolumeId,
          e: ephemeralKey,
          n: nonce,
          w: wrappedFek,
        },
      },
    },
  ],
});

describe('referenceClipboard', () => {
  const originalClipboardItem = globalThis.ClipboardItem;
  const originalNavigator = globalThis.navigator;
  const writeMock = vi.fn();
  const writeTextMock = vi.fn();
  const capturedClipboardItems: Array<Record<string, Blob>> = [];

  beforeEach(() => {
    writeMock.mockReset();
    writeTextMock.mockReset();
    capturedClipboardItems.length = 0;

    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItem {
        readonly data: Record<string, Blob>;

        constructor(data: Record<string, Blob>) {
          this.data = data;
          capturedClipboardItems.push(data);
        }
      },
    });

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          write: writeMock,
          writeText: writeTextMock,
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: originalClipboardItem,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('parses source bundles through the shared canonical parser', () => {
    expect(parseNearbytesClipboardPayload(sourceBundleJson)).toEqual({
      kind: 'source',
      bundle: {
        p: 'nb.src.refs.v1',
        s: sourceVolumeId,
        items: [
          {
            name: 'alpha.txt',
            ref: {
              p: 'nb.src.ref.v1',
              s: sourceVolumeId,
              c: {
                t: 'b',
                h: sourceHash,
                z: 12,
              },
              x: 'AQID',
            },
          },
        ],
      },
    });
  });

  it('rejects malformed bundles instead of casting them through unchecked JSON', () => {
    expect(parseNearbytesClipboardPayload('{"p":"nb.src.refs.v1","s":"bad","items":[]}')).toBeNull();
  });

  it('writes source bundles with the source reference mime', async () => {
    await writeNearbytesClipboardPayload(sourceBundleJson);

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(capturedClipboardItems).toHaveLength(1);
    expect(Object.keys(capturedClipboardItems[0] ?? {})).toEqual(['text/plain', SOURCE_BUNDLE_MIME]);
  });

  it('writes recipient bundles with the recipient reference mime', async () => {
    await writeNearbytesClipboardPayload(recipientBundleJson);

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(capturedClipboardItems).toHaveLength(1);
    expect(Object.keys(capturedClipboardItems[0] ?? {})).toEqual(['text/plain', RECIPIENT_BUNDLE_MIME]);
  });
});