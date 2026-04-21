import { createCipheriv } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeMegaPrivateAttributeRecordsForTesting,
  decryptAesEcb,
  encryptAesEcb,
} from '../mega/crypto.js';
import { encodeMegaBase64Url } from '../mega/protocol.js';

function encodeMegaPrivateAttributeRecord(name: string, payload: Buffer): Buffer {
  if (payload.length > 0xffff) {
    throw new Error(`Private attribute payload is too large in test fixture: ${name}`);
  }
  const key = Buffer.from(name, 'ascii');
  const header = Buffer.alloc(key.length + 3);
  key.copy(header, 0);
  header[key.length] = 0;
  header.writeUInt16BE(payload.length, key.length + 1);
  return Buffer.concat([header, payload]);
}

function encryptMegaPrivateAttributeWithMode(
  records: ReadonlyArray<readonly [string, Buffer]>,
  masterKey: Buffer,
  mode: 0x00 | 0x02 | 0x10
): string {
  const plaintext = Buffer.concat(records.map(([name, payload]) => encodeMegaPrivateAttributeRecord(name, payload)));
  const parameters = {
    0x00: { nonce: Buffer.from('102132435465768798a9babb', 'hex'), authTagLength: 16, algorithm: 'aes-128-ccm' },
    0x02: { nonce: Buffer.from('102132435465768798a9', 'hex'), authTagLength: 8, algorithm: 'aes-128-ccm' },
    0x10: { nonce: Buffer.from('102132435465768798a9babb', 'hex'), authTagLength: 16, algorithm: 'aes-128-gcm' },
  } as const;
  const { nonce, authTagLength, algorithm } = parameters[mode];
  const cipher =
    algorithm === 'aes-128-ccm'
      ? createCipheriv('aes-128-ccm', masterKey.subarray(0, 16), nonce, { authTagLength })
      : createCipheriv('aes-128-gcm', masterKey.subarray(0, 16), nonce);
  if (algorithm === 'aes-128-ccm') {
    cipher.setAAD(Buffer.alloc(0), { plaintextLength: plaintext.length });
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encodeMegaBase64Url(Buffer.concat([Buffer.from([mode]), nonce, ciphertext, cipher.getAuthTag()]));
}

describe('mega/crypto', () => {
  it('round-trips AES-ECB block encryption', () => {
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const plaintext = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');

    const ciphertext = encryptAesEcb(plaintext, key);
    expect(ciphertext.equals(plaintext)).toBe(false);
    expect(decryptAesEcb(ciphertext, key)).toEqual(plaintext);
  });

  it('parses MEGA private attributes across CCM and GCM payload modes', () => {
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const expectedKeyring = Buffer.from('legacy-keyring-data', 'utf8');
    const expectedAuthRing = Buffer.from('legacy-authring-data', 'utf8');

    for (const mode of [0x00, 0x02, 0x10] as const) {
      const encoded = encryptMegaPrivateAttributeWithMode(
        [
          ['*keyring', expectedKeyring],
          ['*!authring', expectedAuthRing],
        ],
        masterKey,
        mode
      );

      const records = decodeMegaPrivateAttributeRecordsForTesting(encoded, masterKey);
      expect(records.get('*keyring')).toEqual(expectedKeyring);
      expect(records.get('*!authring')).toEqual(expectedAuthRing);
    }
  });
});
