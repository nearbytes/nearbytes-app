import { describe, it, expect } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { createSecret } from '../../types/keys.js';

describe('CryptoOperations', () => {
  const crypto = createCryptoOperations();

  describe('computeHash', () => {
    it('should compute SHA-256 hash', async () => {
      const data = new TextEncoder().encode('test data');
      const hash = await crypto.computeHash(data);
      
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce same hash for same input', async () => {
      const data = new TextEncoder().encode('test data');
      const hash1 = await crypto.computeHash(data);
      const hash2 = await crypto.computeHash(data);
      
      expect(hash1).toBe(hash2);
    });
  });

  describe('generateSymmetricKey', () => {
    it('should generate a 32-byte key', async () => {
      const key = await crypto.generateSymmetricKey();
      expect(key.length).toBe(32);
    });

    it('should generate different keys each time', async () => {
      const key1 = await crypto.generateSymmetricKey();
      const key2 = await crypto.generateSymmetricKey();
      
      expect(key1).not.toEqual(key2);
    });
  });

  describe('encryptSym and decryptSym', () => {
    it('should encrypt and decrypt data', async () => {
      const data = new TextEncoder().encode('test data');
      const key = await crypto.generateSymmetricKey();
      
      const encrypted = await crypto.encryptSym(data, key);
      const decrypted = await crypto.decryptSym(encrypted, key);
      
      expect(decrypted).toEqual(data);
    });

    it('should produce different ciphertext for same plaintext', async () => {
      const data = new TextEncoder().encode('test data');
      const key = await crypto.generateSymmetricKey();
      
      const encrypted1 = await crypto.encryptSym(data, key);
      const encrypted2 = await crypto.encryptSym(data, key);
      
      // Should be different due to random IV
      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should throw on wrong key', async () => {
      const data = new TextEncoder().encode('test data');
      const key1 = await crypto.generateSymmetricKey();
      const key2 = await crypto.generateSymmetricKey();
      
      const encrypted = await crypto.encryptSym(data, key1);
      
      await expect(crypto.decryptSym(encrypted, key2)).rejects.toThrow();
    });
  });

  describe('deriveKeys', () => {
    it('should derive keys from secret', async () => {
      const secret = createSecret('test:secret');
      const keyPair = await crypto.deriveKeys(secret);
      
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
    });

    it('should produce same keys for same secret', async () => {
      const secret = createSecret('test:secret');
      const keyPair1 = await crypto.deriveKeys(secret);
      const keyPair2 = await crypto.deriveKeys(secret);
      
      expect(keyPair1.privateKey).toEqual(keyPair2.privateKey);
      expect(keyPair1.publicKey).toEqual(keyPair2.publicKey);
    });

    it('should derive keys from file-backed secret bytes', async () => {
      const fileBytes = Uint8Array.from([0, 255, 1, 2, 3, 16, 32, 64, 128, 254]);
      const encoded = Buffer.from(fileBytes).toString('base64url');
      const secret = createSecret(`nb-file-secret:v1:${encoded}`);
      const keyPair1 = await crypto.deriveKeys(secret);
      const keyPair2 = await crypto.deriveKeys(secret);

      expect(keyPair1.privateKey).toEqual(keyPair2.privateKey);
      expect(keyPair1.publicKey).toEqual(keyPair2.publicKey);
    });
  });

  describe('signPR and verifyPU', () => {
    it('should sign and verify data', async () => {
      const secret = createSecret('test:secret');
      const keyPair = await crypto.deriveKeys(secret);
      const data = new TextEncoder().encode('test data');
      
      const signature = await crypto.signPR(data, keyPair.privateKey);
      const isValid = await crypto.verifyPU(data, signature, keyPair.publicKey);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const secret = createSecret('test:secret');
      const keyPair = await crypto.deriveKeys(secret);
      const data = new TextEncoder().encode('test data');
      const wrongData = new TextEncoder().encode('wrong data');
      
      const signature = await crypto.signPR(data, keyPair.privateKey);
      const isValid = await crypto.verifyPU(wrongData, signature, keyPair.publicKey);
      
      expect(isValid).toBe(false);
    });
  });
});
