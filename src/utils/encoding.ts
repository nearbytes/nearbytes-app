/**
 * Converts a Uint8Array to a hexadecimal string
 * @param bytes - Byte array to convert
 * @returns Hexadecimal string (lowercase)
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Converts a hexadecimal string to a Uint8Array
 * @param hex - Hexadecimal string
 * @returns Byte array
 * @throws Error if hex string is invalid
 */
export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.toLowerCase().trim();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`Invalid hex string: ${hex.substring(0, 20)}...`);
  }
  if (normalized.length % 2 !== 0) {
    throw new Error(`Hex string must have even length, got ${normalized.length}`);
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a base64 string
 * @param bytes - Byte array to convert
 * @returns Base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Converts a Uint8Array to a base64url string without padding.
 * @param bytes - Byte array to convert
 * @returns Base64url string
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

/**
 * Converts a base64 string to a Uint8Array
 * @param base64 - Base64 string
 * @returns Byte array
 * @throws Error if base64 string is invalid
 */
export function base64ToBytes(base64: string): Uint8Array {
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch (error) {
    throw new Error(`Invalid base64 string: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Converts a base64url string to a Uint8Array
 * @param base64url - Base64url string (uses - and _ instead of + and /)
 * @returns Byte array
 * @throws Error if base64url string is invalid
 */
export function base64UrlToBytes(base64url: string): Uint8Array {
  try {
    // Convert base64url to base64
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch (error) {
    throw new Error(`Invalid base64url string: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
