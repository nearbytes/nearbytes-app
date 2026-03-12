import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeSecretToken,
  encodeSecretToken,
  getSecretFromRequest,
  parseTokenKey,
} from '../auth.js';
import { InMemorySecretSessionStore } from '../secretSessions.js';

const SECRET_A = 'volume-secret-a';
const SECRET_B = 'volume-secret-b';

describe('auth helpers', () => {
  it('encodes and decodes secret tokens', async () => {
    const tokenKey = randomBytes(32);
    const token = await encodeSecretToken(SECRET_A, tokenKey);
    const decoded = await decodeSecretToken(token, tokenKey);
    expect(decoded).toBe(SECRET_A);
  });

  it('prioritizes bearer tokens over header secrets', async () => {
    const sessionStore = new InMemorySecretSessionStore();
    const token = sessionStore.createSession(SECRET_A);
    const req = createRequest({
      authorization: `Bearer ${token}`,
      'x-nearbytes-secret': SECRET_B,
    });

    const secret = await getSecretFromRequest(req, { sessionStore });
    expect(secret).toBe(SECRET_A);
  });

  it('falls back to stateless token decoding when session token is missing', async () => {
    const tokenKey = randomBytes(32);
    const token = await encodeSecretToken(SECRET_A, tokenKey);
    const req = createRequest({
      authorization: `Bearer ${token}`,
    });

    const secret = await getSecretFromRequest(req, { tokenKey, sessionStore: new InMemorySecretSessionStore() });
    expect(secret).toBe(SECRET_A);
  });

  it('rejects missing authentication', async () => {
    const req = createRequest({});
    await expect(getSecretFromRequest(req, {})).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('parses token keys from hex', () => {
    const tokenKey = randomBytes(32);
    const hex = Buffer.from(tokenKey).toString('hex');
    const parsed = parseTokenKey(hex);
    expect(Buffer.from(parsed).toString('hex')).toBe(hex);
  });
});

function createRequest(headers: Record<string, string>): Request {
  return {
    get: (name: string) => {
      const key = name.toLowerCase();
      return headers[key] ?? headers[name];
    },
  } as Request;
}
