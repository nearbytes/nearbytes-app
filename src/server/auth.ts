import type { Request } from 'express';
import type { Secret } from '../types/keys.js';
import { createSecret } from '../types/keys.js';
import { ApiError } from './errors.js';
import { base64ToBytes, base64UrlToBytes, hexToBytes } from '../utils/encoding.js';
import type { SecretSessionStore } from './secretSessions.js';

const AES_GCM_IV_LENGTH = 12;
const AES_GCM_TAG_LENGTH = 16;
const AES_GCM_KEY_LENGTH = 32;

/**
 * Configuration for stateless auth extraction.
 */
export interface AuthConfig {
  readonly tokenKey?: Uint8Array;
  readonly sessionStore?: SecretSessionStore;
}

/**
 * Extracts and validates the Nearbytes secret from an HTTP request.
 * Auth precedence: Bearer token wins, otherwise x-nearbytes-secret header.
 * Bearer tokens first resolve against the in-memory session store, then fall back
 * to stateless token decoding for backward compatibility.
 */
export async function getSecretFromRequest(
  req: Request,
  config: AuthConfig
): Promise<Secret> {
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.trim().length > 0) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!match) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid Authorization header');
    }
    const bearerToken = match[1];
    const sessionSecret = config.sessionStore?.getSecret(bearerToken);
    if (sessionSecret) {
      return validateSecret(sessionSecret);
    }
    if (config.tokenKey) {
      const secret = await decodeSecretToken(bearerToken, config.tokenKey);
      return validateSecret(secret);
    }
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token');
  }

  const headerSecret = req.get('x-nearbytes-secret');
  if (!headerSecret || headerSecret.trim().length === 0) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing authentication');
  }

  return validateSecret(headerSecret);
}

/**
 * Validates a raw secret string using the domain rules.
 */
export function validateSecret(secret: string): Secret {
  return createSecret(secret);
}

/**
 * Encodes a secret into a stateless bearer token (AES-256-GCM).
 */
export async function encodeSecretToken(secret: string, tokenKey: Uint8Array): Promise<string> {
  assertTokenKeyLength(tokenKey);
  const crypto = globalThis.crypto?.subtle;
  if (!crypto) {
    throw new Error('Web Crypto API not available');
  }

  const iv = new Uint8Array(AES_GCM_IV_LENGTH);
  globalThis.crypto.getRandomValues(iv);
  // Ensure tokenKey is backed by ArrayBuffer for Web Crypto API
  const keyData = new Uint8Array([...tokenKey]);
  const key = await crypto.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = new TextEncoder().encode(secret);
  const encrypted = new Uint8Array(
    await crypto.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );

  const tokenBytes = new Uint8Array(iv.length + encrypted.length);
  tokenBytes.set(iv, 0);
  tokenBytes.set(encrypted, iv.length);
  return toBase64Url(tokenBytes);
}

/**
 * Decodes a bearer token into a secret (AES-256-GCM).
 */
export async function decodeSecretToken(token: string, tokenKey: Uint8Array): Promise<string> {
  assertTokenKeyLength(tokenKey);
  const crypto = globalThis.crypto?.subtle;
  if (!crypto) {
    throw new Error('Web Crypto API not available');
  }

  const tokenBytes = base64UrlToBytes(token);
  if (tokenBytes.length <= AES_GCM_IV_LENGTH + AES_GCM_TAG_LENGTH) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token');
  }

  const iv = tokenBytes.slice(0, AES_GCM_IV_LENGTH);
  const ciphertext = tokenBytes.slice(AES_GCM_IV_LENGTH);
  // Ensure tokenKey is backed by ArrayBuffer for Web Crypto API
  const keyData = new Uint8Array([...tokenKey]);
  const key = await crypto.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  try {
    const decrypted = new Uint8Array(
      await crypto.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token');
  }
}

/**
 * Parses the token key from env configuration (hex or base64/base64url).
 */
export function parseTokenKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('NEARBYTES_SERVER_TOKEN_KEY is empty');
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return hexToBytes(trimmed);
  }

  const candidates = [base64UrlToBytes, base64ToBytes];
  for (const decoder of candidates) {
    try {
      const decoded = decoder(trimmed);
      if (decoded.length === AES_GCM_KEY_LENGTH) {
        return decoded;
      }
    } catch {
      // Try the next decoder.
    }
  }

  throw new Error('NEARBYTES_SERVER_TOKEN_KEY must decode to 32 bytes');
}

function assertTokenKeyLength(tokenKey: Uint8Array): void {
  if (tokenKey.length !== AES_GCM_KEY_LENGTH) {
    throw new Error('Token key must be 32 bytes');
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
