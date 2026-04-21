import { Buffer } from 'buffer';

export interface MegaFsWatcher {
  close(): Promise<void> | void;
  on(event: string, listener: (...args: unknown[]) => void): MegaFsWatcher;
}

export interface MegaFsStatsLike {
  isDirectory(): boolean;
}

export interface MegaFsModuleLike {
  mkdir(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void>;
  readFile(targetPath: string): Promise<Uint8Array>;
  writeFile(targetPath: string, data: Uint8Array): Promise<void>;
  access(targetPath: string): Promise<void>;
  rm(
    targetPath: string,
    options?: {
      readonly recursive?: boolean;
      readonly force?: boolean;
    }
  ): Promise<void>;
  stat(targetPath: string): Promise<MegaFsStatsLike>;
  readdir(targetPath: string): Promise<string[]>;
}

export interface MegaApiError extends Error {
  code: number;
}

export interface MegaPrivateKey {
  readonly modulus: bigint;
  readonly privateExponent: bigint;
  readonly modulusLength: number;
}

export interface MegaAccountSecret {
  readonly email: string;
  readonly password?: string;
  readonly mfaCode?: string;
  readonly sid: string;
  readonly masterKey: string;
  readonly encryptedPrivateKey?: string;
  readonly userHandle: string;
  readonly accountVersion: number;
  readonly accountSalt?: string;
  readonly shareKeys?: Record<string, string>;
}

export interface MegaSession {
  readonly email: string;
  readonly password?: string;
  readonly mfaCode?: string;
  readonly sid: string;
  readonly masterKey: Buffer;
  readonly encryptedPrivateKey?: string;
  readonly privateKey?: MegaPrivateKey;
  readonly userHandle: string;
  readonly accountVersion: number;
  readonly accountSalt?: string;
}

export interface MegaKeyManagerRecord {
  readonly tag: number;
  readonly payload: Buffer;
}

export interface MegaKeyManagerRecoveryPayload {
  readonly version: number;
  readonly creationTime: Buffer;
  readonly identity: Buffer;
  readonly generation: number;
  readonly attr: Buffer;
  readonly privateEd25519: Buffer;
  readonly privateCu25519: Buffer;
  readonly privateRsa: Buffer;
  readonly authRingEd25519: Buffer;
  readonly authRingCu25519: Buffer;
  readonly otherRecords: readonly MegaKeyManagerRecord[];
}

export const MEGA_RECONNECT_REQUIRED_MESSAGE =
  'Nearbytes could not refresh the saved MEGA sign-in. It will keep retrying automatically. If MEGA asked you to unlock the account or change the password first, finish that on mega.io. Update the saved sign-in in Nearbytes only if the stored credentials no longer work.';

export const MEGA_RETRYABLE_API_ERROR_CODES = new Set([-3, -4]);
export const MEGA_LOCK_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
export const MEGA_RATE_LIMIT_RETRY_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 18_000] as const;
export const MEGA_TRANSIENT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

export const MEGA_KEY_MANAGER_VERSION_TAG = 1;
export const MEGA_KEY_MANAGER_CREATION_TIME_TAG = 2;
export const MEGA_KEY_MANAGER_IDENTITY_TAG = 3;
export const MEGA_KEY_MANAGER_GENERATION_TAG = 4;
export const MEGA_KEY_MANAGER_ATTR_TAG = 5;
export const MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG = 16;
export const MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG = 17;
export const MEGA_KEY_MANAGER_PRIVATE_RSA_TAG = 18;
export const MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG = 32;
export const MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG = 33;
export const MEGA_KEY_MANAGER_SHARE_KEYS_TAG = 48;
export const MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG = 64;
export const MEGA_KEY_MANAGER_PENDING_INSHARES_TAG = 65;
export const MEGA_KEY_MANAGER_BACKUPS_TAG = 80;
export const MEGA_KEY_MANAGER_WARNINGS_TAG = 96;

export const MEGA_PRIVATE_ATTRIBUTE_KEYRING = '*keyring';
export const MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_ED25519 = '*!authring';
export const MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_CU25519 = '*!authCu255';
export const MEGA_PRIVATE_ATTRIBUTE_ENCRYPTION_PARAMETERS: Record<
  number,
  { readonly nonceSize: number; readonly authTagSize: number; readonly algorithm: 'aes-128-ccm' | 'aes-128-gcm' }
> = {
  0x00: { nonceSize: 12, authTagSize: 16, algorithm: 'aes-128-ccm' },
  0x01: { nonceSize: 10, authTagSize: 16, algorithm: 'aes-128-ccm' },
  0x02: { nonceSize: 10, authTagSize: 8, algorithm: 'aes-128-ccm' },
  0x03: { nonceSize: 12, authTagSize: 16, algorithm: 'aes-128-ccm' },
  0x04: { nonceSize: 10, authTagSize: 8, algorithm: 'aes-128-ccm' },
  0x10: { nonceSize: 12, authTagSize: 16, algorithm: 'aes-128-gcm' },
  0x11: { nonceSize: 10, authTagSize: 8, algorithm: 'aes-128-gcm' },
};

export const MEGA_RECOVERY_KEY_MANAGER_TAGS = new Set<number>([
  MEGA_KEY_MANAGER_VERSION_TAG,
  MEGA_KEY_MANAGER_CREATION_TIME_TAG,
  MEGA_KEY_MANAGER_IDENTITY_TAG,
  MEGA_KEY_MANAGER_GENERATION_TAG,
  MEGA_KEY_MANAGER_ATTR_TAG,
  MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_RSA_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG,
  MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
  MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
  MEGA_KEY_MANAGER_PENDING_INSHARES_TAG,
  MEGA_KEY_MANAGER_BACKUPS_TAG,
  MEGA_KEY_MANAGER_WARNINGS_TAG,
]);

export const MEGA_AUTH_METHOD_SEEN = 0;
export const MEGA_AUTH_RING_RECORD_SIZE = 29;
export const MEGA_SHARE_KEY_RECORD_SIZE = 23;
export const MEGA_SHARE_KEY_FLAG_TRUSTED = 1 << 0;
export const MEGA_SHARE_KEY_FLAG_IN_USE = 1 << 1;
export const MEGA_PAIRWISE_KEY_LABEL = Buffer.from('strongvelope pairwise key\x01', 'latin1');
