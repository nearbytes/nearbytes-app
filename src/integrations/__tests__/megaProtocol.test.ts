import { randomBytes } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  MegaApiClient,
  buildMegaCsUrl,
  buildMegaFetchNodesCommand,
  buildMegaScChannelUrl,
  decodeMegaAccountSessionDump,
  decodeMegaBase64Url,
  decryptMegaMasterKeyWithSessionKey,
  encodeMegaAccountSessionDump,
  encodeMegaAccountSessionDumpString,
  encryptMegaMasterKeyWithSessionKey,
  encodeMegaBase64Url,
  parseMegaFetchNodesSnapshot,
} from '../megaProtocol.js';

describe('megaProtocol', () => {
  it('round-trips an unencrypted account session dump', () => {
    const masterKey = randomBytes(16);
    const sid = randomBytes(43);
    const encoded = encodeMegaAccountSessionDump({
      version: 0,
      masterKey,
      sid,
    });

    const decoded = decodeMegaAccountSessionDump(encoded);
    expect(decoded.version).toBe(0);
    if (decoded.version !== 0) {
      throw new Error('Unexpected MEGA session version.');
    }
    expect(Buffer.compare(decoded.masterKey, masterKey)).toBe(0);
    expect(Buffer.compare(decoded.sid, sid)).toBe(0);
  });

  it('encodes and decodes an encrypted account session dump string', () => {
    const masterKey = randomBytes(16);
    const sessionKey = randomBytes(16);
    const sid = randomBytes(43);
    const encryptedMasterKey = encryptMegaMasterKeyWithSessionKey(masterKey, sessionKey);
    const encoded = encodeMegaAccountSessionDumpString({
      version: 1,
      encryptedMasterKey,
      sid,
    });

    const decoded = decodeMegaAccountSessionDump(encoded);
    expect(decoded.version).toBe(1);
    if (decoded.version !== 1) {
      throw new Error('Unexpected MEGA session version.');
    }
    expect(Buffer.compare(decoded.sid, sid)).toBe(0);
    expect(Buffer.compare(decoded.encryptedMasterKey, encryptedMasterKey)).toBe(0);
    expect(Buffer.compare(decryptMegaMasterKeyWithSessionKey(decoded.encryptedMasterKey, sessionKey), masterKey)).toBe(0);
  });

  it('builds the default fetch-nodes command with cache enabled', () => {
    expect(buildMegaFetchNodesCommand()).toEqual({
      a: 'f',
      c: 1,
      r: 1,
      ca: 1,
    });
  });

  it('builds a partial fetch-nodes command', () => {
    expect(buildMegaFetchNodesCommand({ useCache: false, partialRoot: 'abcdef12' })).toEqual({
      a: 'f',
      c: 1,
      r: 1,
      n: 'abcdef12',
      part: 1,
    });
  });

  it('extracts the key fields from a fetch-nodes response', () => {
    const snapshot = parseMegaFetchNodesSnapshot({
      f: [{ h: 'root', t: 1 }],
      f2: [{ h: 'old', t: 0 }],
      s: [{ h: 'share' }],
      ps: [{ h: 'pending-share' }],
      u: [{ u: 'user', m: 'reader@example.test' }],
      ipc: [{ p: 'ipc' }],
      opc: [{ p: 'opc' }],
      ph: [{ h: 'public-link' }],
      sn: 'cursor123',
      st: 'seqtag456',
    });

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.versions).toHaveLength(1);
    expect(snapshot.outgoingShares).toHaveLength(1);
    expect(snapshot.pendingShares).toHaveLength(1);
    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.incomingPendingContacts).toHaveLength(1);
    expect(snapshot.outgoingPendingContacts).toHaveLength(1);
    expect(snapshot.publicLinks).toHaveLength(1);
    expect(snapshot.scsn).toBe('cursor123');
    expect(snapshot.sequenceTag).toBe('seqtag456');
  });

  it('builds authenticated CS and SC urls', () => {
    const sid = encodeMegaBase64Url(randomBytes(43));

    const csUrl = new URL(buildMegaCsUrl({
      requestId: 7,
      sessionId: sid,
    }));
    expect(csUrl.pathname).toBe('/cs');
    expect(csUrl.searchParams.get('id')).toBe('7');
    expect(csUrl.searchParams.get('sid')).toBe(sid);

    const scUrl = new URL(buildMegaScChannelUrl({
      scsn: 'abcdef12345',
      sessionId: sid,
    }));
    expect(scUrl.pathname).toBe('/sc');
    expect(scUrl.searchParams.get('sn')).toBe('abcdef12345');
    expect(scUrl.searchParams.get('sid')).toBe(sid);
  });

  it('sends authenticated requests through the low-level client', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify([{ ok: true, echo: JSON.parse(String(init?.body)) }]), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }) as typeof fetch;
    const client = new MegaApiClient({
      fetchImpl,
      initialRequestId: 12,
    });
    const sid = encodeMegaBase64Url(randomBytes(43));
    const response = await client.requestSingle<{ ok: boolean; echo: unknown }>(
      buildMegaFetchNodesCommand(),
      { sessionId: sid }
    );

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] ?? [];
    const parsedUrl = new URL(String(requestUrl));
    expect(parsedUrl.searchParams.get('id')).toBe('13');
    expect(parsedUrl.searchParams.get('sid')).toBe(sid);
    expect(JSON.parse(String(requestInit?.body))).toEqual([
      {
        a: 'f',
        c: 1,
        r: 1,
        ca: 1,
      },
    ]);
  });

  it('uses MEGA base64url encoding for opaque binary blobs', () => {
    const value = randomBytes(32);
    const encoded = encodeMegaBase64Url(value);
    expect(Buffer.compare(decodeMegaBase64Url(encoded), value)).toBe(0);
  });
});