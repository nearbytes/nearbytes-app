import { describe, expect, it } from 'vitest';
import {
  decodePersistedMegaShareKeys,
  deserializeSession,
  encodePersistedMegaShareKeys,
  extractMegaReusableCredentials,
  isStoredMegaAccountSecret,
} from '../mega/auth.js';
import { encodeMegaBase64Url } from '../mega/protocol.js';

describe('mega/auth', () => {
  it('round-trips persisted share keys and ignores malformed entries', () => {
    const original = new Map<string, Buffer>([
      ['share-a', Buffer.from('00112233445566778899aabbccddeeff', 'hex')],
      ['share-b', Buffer.from('ffeeddccbbaa99887766554433221100', 'hex')],
    ]);

    const encoded = encodePersistedMegaShareKeys(original);
    const decoded = decodePersistedMegaShareKeys({
      ...encoded,
      broken: 'not-base64',
      empty: '',
    });

    expect(decoded.get('share-a')).toEqual(original.get('share-a'));
    expect(decoded.get('share-b')).toEqual(original.get('share-b'));
    expect(decoded.has('broken')).toBe(false);
    expect(decoded.has('empty')).toBe(false);
  });

  it('identifies stored secrets and reusable credentials', () => {
    const secret = {
      email: 'owner@example.test',
      password: 'secret',
      sid: 'session-id',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    };

    expect(isStoredMegaAccountSecret(secret)).toBe(true);
    expect(extractMegaReusableCredentials(secret)).toEqual({
      email: 'owner@example.test',
      password: 'secret',
      mfaCode: undefined,
    });
    expect(extractMegaReusableCredentials({ email: 'owner@example.test' }, 'fallback@example.test')).toBeNull();
  });

  it('deserializes persisted MEGA sessions without requiring a private key', () => {
    const secret = {
      email: 'owner@example.test',
      sid: 'session-id',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
      accountSalt: 'salt-value',
    };

    const session = deserializeSession(secret, 'fallback@example.test');
    expect(session.email).toBe('owner@example.test');
    expect(session.sid).toBe('session-id');
    expect(session.masterKey).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
    expect(session.privateKey).toBeUndefined();
    expect(session.accountSalt).toBe('salt-value');
  });
});
