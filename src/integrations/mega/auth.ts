import { Buffer } from 'buffer';
import { MegaApiClient, decodeMegaBase64Url, encodeMegaBase64Url } from '../megaProtocol.js';
import type { MegaAccountSecret, MegaApiError, MegaPrivateKey, MegaSession } from './core.js';
import {
  decodeMegaPrivateKey,
  decryptAesEcb,
  decryptMegaPrivateKey,
  decryptSessionIdFromCsid,
  deriveV2PasswordKey,
  prepareV1PasswordKey,
  stringHash,
  validateTemporarySessionId,
} from './crypto.js';
import { withMegaApiRetry } from './errors.js';

export function deserializeSession(secret: MegaAccountSecret, fallbackEmail = ''): MegaSession {
  const masterKey = decodeMegaBase64Url(secret.masterKey);
  const encryptedPrivateKey = typeof secret.encryptedPrivateKey === 'string' && secret.encryptedPrivateKey.trim() !== ''
    ? secret.encryptedPrivateKey.trim()
    : undefined;
  return {
    email: typeof secret.email === 'string' && secret.email.trim() !== '' ? secret.email : fallbackEmail,
    password: secret.password,
    mfaCode: secret.mfaCode,
    sid: secret.sid,
    masterKey,
    encryptedPrivateKey,
    privateKey: encryptedPrivateKey
      ? decodeMegaPrivateKey(decryptMegaPrivateKey(decodeMegaBase64Url(encryptedPrivateKey), masterKey))
      : undefined,
    userHandle: secret.userHandle,
    accountVersion: secret.accountVersion,
    accountSalt: secret.accountSalt,
  };
}

export function encodePersistedMegaShareKeys(shareKeys: ReadonlyMap<string, Buffer> | undefined): Record<string, string> | undefined {
  if (!shareKeys || shareKeys.size === 0) {
    return undefined;
  }
  const encoded: Record<string, string> = {};
  for (const [handleRaw, shareKey] of shareKeys.entries()) {
    const handle = handleRaw.trim();
    if (!handle || shareKey.length === 0) {
      continue;
    }
    encoded[handle] = encodeMegaBase64Url(Buffer.from(shareKey));
  }
  return Object.keys(encoded).length > 0 ? encoded : undefined;
}

export function decodePersistedMegaShareKeys(value: unknown): ReadonlyMap<string, Buffer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map();
  }
  const decoded = new Map<string, Buffer>();
  for (const [handleRaw, shareKeyRaw] of Object.entries(value)) {
    const handle = handleRaw.trim();
    const encodedShareKey = typeof shareKeyRaw === 'string' ? shareKeyRaw.trim() : '';
    if (!handle || !encodedShareKey) {
      continue;
    }
    try {
      const shareKey = decodeMegaBase64Url(encodedShareKey);
      if (shareKey.length === 16) {
        decoded.set(handle, shareKey);
      }
    } catch {
      // Ignore malformed persisted share-key entries.
    }
  }
  return decoded;
}

export function isStoredMegaAccountSecret(secret: unknown): secret is MegaAccountSecret {
  if (!secret || typeof secret !== 'object') {
    return false;
  }
  const candidate = secret as Partial<MegaAccountSecret>;
  return (
    typeof candidate.sid === 'string' &&
    candidate.sid.trim() !== '' &&
    typeof candidate.masterKey === 'string' &&
    candidate.masterKey.trim() !== '' &&
    typeof candidate.userHandle === 'string' &&
    candidate.userHandle.trim() !== '' &&
    typeof candidate.accountVersion === 'number' &&
    Number.isFinite(candidate.accountVersion)
  );
}

export function extractMegaReusableCredentials(
  secret: unknown,
  fallbackEmail = ''
): { email: string; password: string; mfaCode?: string } | null {
  if (!secret || typeof secret !== 'object') {
    return null;
  }
  const candidate = secret as Partial<MegaAccountSecret>;
  const email = (typeof candidate.email === 'string' && candidate.email.trim() !== '' ? candidate.email : fallbackEmail).trim();
  const password = typeof candidate.password === 'string' ? candidate.password : '';
  const mfaCode = typeof candidate.mfaCode === 'string' && candidate.mfaCode.trim() !== '' ? candidate.mfaCode.trim() : undefined;
  if (!email || !password) {
    return null;
  }
  return { email, password, mfaCode };
}

export type MegaPasswordSessionLogger = Pick<{ log(...args: unknown[]): void }, 'log'> | undefined;

export async function megaApiCommandStandalone<T = Record<string, unknown>>(
  apiClient: MegaApiClient,
  command: Record<string, unknown>,
  session?: MegaSession,
  signal?: AbortSignal
): Promise<T> {
  return withMegaApiRetry(async () => {
    const response = await apiClient.requestSingle<T | number>(command, {
      sessionId: session?.sid,
      signal,
    });
    if (typeof response === 'number') {
      if (response === 0) {
        return response as T;
      }
      const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
      error.code = response;
      throw error;
    }
    return response;
  }, signal);
}

export async function createMegaPasswordSession(
  apiClient: MegaApiClient,
  logger: MegaPasswordSessionLogger,
  email: string,
  password: string,
  mfaCode?: string
): Promise<MegaSession> {
  const trimmedEmail = email.trim();
  const prelogin = await megaApiCommandStandalone<{ v?: number; s?: string }>(apiClient, { a: 'us0', user: trimmedEmail });
  const version = Number(prelogin.v ?? 1) || 1;

  let passwordKey: Buffer;
  let uh: string;
  let accountSalt: string | undefined;

  if (version > 1) {
    const salt = String(prelogin.s ?? '').trim();
    if (!salt) {
      throw new Error('MEGA did not return an authentication salt for this account.');
    }
    const derived = await deriveV2PasswordKey(password, salt);
    passwordKey = derived.masterKey;
    uh = encodeMegaBase64Url(derived.authKey);
    accountSalt = salt;
  } else {
    passwordKey = prepareV1PasswordKey(password);
    uh = stringHash(trimmedEmail.toLowerCase(), passwordKey);
  }

  const response = await megaApiCommandStandalone<Record<string, unknown>>(apiClient, {
    a: 'us',
    user: trimmedEmail,
    uh,
    ...(mfaCode ? { mfa: mfaCode } : {}),
  });

  logger?.log('MEGA login response received.', {
    email: trimmedEmail,
    hasTsid: typeof response.tsid === 'string' && response.tsid.trim().length > 0,
    hasCsid: typeof response.csid === 'string' && response.csid.trim().length > 0,
    hasPrivk: typeof response.privk === 'string' && response.privk.trim().length > 0,
    hasSek: typeof response.sek === 'string' && response.sek.trim().length > 0,
  });

  const encryptedMasterKey = decodeMegaBase64Url(assertString(response.k, 'MEGA login response is missing the encrypted master key.'));
  const masterKey = decryptAesEcb(encryptedMasterKey, passwordKey);
  const userHandle = assertString(response.u, 'MEGA login response is missing the user handle.');

  const encryptedPrivateKey = typeof response.privk === 'string' && response.privk.trim() ? response.privk.trim() : undefined;
  const privateKey: MegaPrivateKey | undefined = encryptedPrivateKey
    ? decodeMegaPrivateKey(decryptMegaPrivateKey(decodeMegaBase64Url(encryptedPrivateKey), masterKey))
    : undefined;

  let sid = typeof response.tsid === 'string' ? response.tsid.trim() : '';
  if (sid) {
    logger?.log('Using temporary MEGA session identifier from login response.', {
      email: trimmedEmail,
    });
    validateTemporarySessionId(sid, masterKey);
  } else {
    if (!privateKey) {
      throw new Error('MEGA login response is missing the private key.');
    }
    const sidCiphertext = decodeMegaBase64Url(assertString(response.csid, 'MEGA login response is missing the session id.'));
    sid = decryptSessionIdFromCsid(sidCiphertext, privateKey, userHandle);
    logger?.log('Using RSA-backed MEGA session identifier from login response.', {
      email: trimmedEmail,
    });
  }

  return {
    email: trimmedEmail,
    password,
    mfaCode,
    sid,
    masterKey,
    encryptedPrivateKey,
    privateKey,
    userHandle,
    accountVersion: version,
    accountSalt,
  };
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value.trim();
}
