import { randomBytes } from 'crypto';

const DEFAULT_TOKEN_BYTES = 32;

export function generateDesktopApiToken(byteLength = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(byteLength).toString('base64url');
}

