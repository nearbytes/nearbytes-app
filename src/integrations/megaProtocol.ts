import { createDecipheriv, createCipheriv, subtle } from 'crypto';

export const MEGA_API_URL = 'https://g.api.mega.co.nz/cs';
export const MEGA_SC_URL = 'https://g.api.mega.co.nz/sc';
export const MEGA_MASTER_KEY_BYTES = 16;
export const MEGA_SESSION_KEY_BYTES = 16;
export const MEGA_SID_BYTES = 43;

/**
 * Maximum number of hashcash-challenged retries before giving up.
 * MEGA returns `-3` (EAGAIN) along with an `X-Hashcash` challenge header
 * when it wants proof-of-work before serving the request.
 */
const MAX_HASHCASH_RETRIES = 4;

export interface MegaApiClientOptions {
  readonly apiUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly initialRequestId?: number;
}

export interface MegaRequestOptions {
  readonly sessionId?: string | Buffer;
  readonly requestId?: number;
  readonly signal?: AbortSignal;
}

export interface MegaFetchNodesCommandOptions {
  readonly useCache?: boolean;
  readonly partialRoot?: string;
}

export interface MegaNodeRecord {
  readonly h?: string;
  readonly p?: string;
  readonly t?: number;
  readonly s?: number;
  readonly a?: string;
  readonly k?: string;
  readonly [key: string]: unknown;
}

export interface MegaUserRecord {
  readonly u?: string;
  readonly m?: string;
  readonly c?: number;
  readonly [key: string]: unknown;
}

export interface MegaFetchNodesSnapshot {
  readonly nodes: readonly MegaNodeRecord[];
  readonly versions: readonly MegaNodeRecord[];
  readonly outgoingShares: readonly Record<string, unknown>[];
  readonly pendingShares: readonly Record<string, unknown>[];
  readonly users: readonly MegaUserRecord[];
  readonly incomingPendingContacts: readonly Record<string, unknown>[];
  readonly outgoingPendingContacts: readonly Record<string, unknown>[];
  readonly publicLinks: readonly Record<string, unknown>[];
  readonly scsn?: string;
  readonly sequenceTag?: string;
}

export interface MegaActionPacketBatch {
  readonly packets: readonly Record<string, unknown>[];
  readonly scsn?: string;
  readonly sequenceTag?: string;
  readonly waitUrl?: string;
}

export type MegaAccountSessionDump =
  | {
      readonly version: 0;
      readonly sid: Buffer;
      readonly masterKey: Buffer;
    }
  | {
      readonly version: 1;
      readonly sid: Buffer;
      readonly encryptedMasterKey: Buffer;
    };

export class MegaApiClient {
  private requestId: number;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MegaApiClientOptions = {}) {
    this.apiUrl = options.apiUrl ?? MEGA_API_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.requestId = Number.isFinite(options.initialRequestId) ? Math.trunc(options.initialRequestId!) : 0;
  }

  async request<T = unknown>(
    commands: readonly Record<string, unknown>[],
    options: MegaRequestOptions = {}
  ): Promise<readonly T[]> {
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new Error('MEGA API requests must include at least one command.');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Global fetch is not available for MEGA API requests.');
    }

    const requestId = Number.isFinite(options.requestId) ? Math.trunc(options.requestId!) : this.nextRequestId();
    const url = buildMegaCsUrl({
      apiUrl: this.apiUrl,
      requestId,
      sessionId: options.sessionId,
    });
    const body = JSON.stringify(commands);

    let hashcashToken: string | undefined;
    for (let attempt = 0; attempt <= MAX_HASHCASH_RETRIES; attempt++) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (hashcashToken) {
        headers['X-Hashcash'] = hashcashToken;
      }

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: options.signal,
      });

      // MEGA sends X-Hashcash on ANY response (even 200 OK) as a challenge.
      // When present, we must solve the proof-of-work and retry — the body is irrelevant.
      const challenge = response.headers.get('X-Hashcash');
      if (challenge && attempt < MAX_HASHCASH_RETRIES) {
        hashcashToken = await solveMegaHashcashChallenge(challenge);
        continue;
      }

      if (response.statusText === 'Server Too Busy') {
        throw Object.assign(new Error('MEGA API error -3.'), { code: -3 });
      }

      if (!response.ok) {
        throw new Error(`MEGA API request failed with HTTP ${response.status}.`);
      }

      const payload = await parseMegaJsonResponse(response, 'MEGA API');

      // MEGA can return -3 inside the JSON body without a hashcash header — genuine rate limit.
      const payloadNum = typeof payload === 'number' ? payload : Array.isArray(payload) && payload.length === 1 && typeof payload[0] === 'number' ? payload[0] : undefined;
      if (payloadNum === -3) {
        throw Object.assign(new Error('MEGA API error -3.'), { code: -3 });
      }

      if (Array.isArray(payload)) {
        return payload as readonly T[];
      }
      return [payload as T];
    }

    throw Object.assign(new Error('MEGA API error -3.'), { code: -3 });
  }

  async requestSingle<T = unknown>(
    command: Record<string, unknown>,
    options: MegaRequestOptions = {}
  ): Promise<T> {
    const responses = await this.request<T>([command], options);
    if (responses.length !== 1) {
      throw new Error(`Expected exactly one MEGA API response item, received ${responses.length}.`);
    }
    return responses[0] as T;
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }
}

export function buildMegaCsUrl(options: {
  apiUrl?: string;
  requestId: number;
  sessionId?: string | Buffer;
}): string {
  const url = new URL(options.apiUrl ?? MEGA_API_URL);
  url.searchParams.set('id', String(Math.trunc(options.requestId)));
  if (options.sessionId) {
    url.searchParams.set('sid', normalizeSessionId(options.sessionId));
  }
  return url.toString();
}

export function buildMegaScChannelUrl(options: {
  apiUrl?: string;
  scsn: string;
  sessionId?: string | Buffer;
}): string {
  const scsn = options.scsn.trim();
  if (!scsn) {
    throw new Error('MEGA SC channel URL needs a non-empty scsn cursor.');
  }
  const url = new URL(options.apiUrl ?? MEGA_SC_URL);
  url.searchParams.set('sn', scsn);
  if (options.sessionId) {
    url.searchParams.set('sid', normalizeSessionId(options.sessionId));
  }
  return url.toString();
}

export function buildMegaFetchNodesCommand(options: MegaFetchNodesCommandOptions = {}): Record<string, unknown> {
  const command: Record<string, unknown> = {
    a: 'f',
    c: 1,
    r: 1,
  };

  if (options.useCache !== false) {
    command.ca = 1;
  }

  const partialRoot = options.partialRoot?.trim();
  if (partialRoot) {
    command.n = partialRoot;
    command.part = 1;
  }

  return command;
}

export function parseMegaFetchNodesSnapshot(response: unknown): MegaFetchNodesSnapshot {
  const object = asRecord(response, 'MEGA fetch-nodes response');
  return {
    nodes: asRecordArray(object.f),
    versions: asRecordArray(object.f2),
    outgoingShares: asRecordArray(object.s),
    pendingShares: asRecordArray(object.ps),
    users: asRecordArray(object.u) as readonly MegaUserRecord[],
    incomingPendingContacts: asRecordArray(object.ipc),
    outgoingPendingContacts: asRecordArray(object.opc),
    publicLinks: asRecordArray(object.ph),
    scsn: typeof object.sn === 'string' ? object.sn : undefined,
    sequenceTag: typeof object.st === 'string' ? object.st : undefined,
  };
}

export function parseMegaActionPacketBatch(response: unknown): MegaActionPacketBatch {
  const object = asRecord(response, 'MEGA action-packet response');
  return {
    packets: asRecordArray(object.a),
    scsn: typeof object.sn === 'string' ? object.sn.trim() || undefined : undefined,
    sequenceTag: typeof object.st === 'string' ? object.st.trim() || undefined : undefined,
    waitUrl: typeof object.w === 'string' ? object.w.trim() || undefined : undefined,
  };
}

export function decodeMegaAccountSessionDump(blob: Buffer | Uint8Array | string): MegaAccountSessionDump {
  const raw = typeof blob === 'string' ? decodeMegaBase64Url(blob) : Buffer.from(blob);

  if (raw.length === MEGA_MASTER_KEY_BYTES + MEGA_SID_BYTES) {
    return {
      version: 0,
      masterKey: raw.subarray(0, MEGA_MASTER_KEY_BYTES),
      sid: raw.subarray(MEGA_MASTER_KEY_BYTES),
    };
  }

  if (raw.length === 1 + MEGA_MASTER_KEY_BYTES + MEGA_SID_BYTES && raw[0] === 1) {
    return {
      version: 1,
      encryptedMasterKey: raw.subarray(1, 1 + MEGA_MASTER_KEY_BYTES),
      sid: raw.subarray(1 + MEGA_MASTER_KEY_BYTES),
    };
  }

  throw new Error('Unsupported MEGA account session dump format.');
}

export function encodeMegaAccountSessionDump(session: MegaAccountSessionDump): Buffer {
  validateBufferLength(session.sid, MEGA_SID_BYTES, 'MEGA sid');

  if (session.version === 0) {
    validateBufferLength(session.masterKey, MEGA_MASTER_KEY_BYTES, 'MEGA master key');
    return Buffer.concat([Buffer.from(session.masterKey), Buffer.from(session.sid)]);
  }

  validateBufferLength(session.encryptedMasterKey, MEGA_MASTER_KEY_BYTES, 'MEGA encrypted master key');
  return Buffer.concat([Buffer.from([1]), Buffer.from(session.encryptedMasterKey), Buffer.from(session.sid)]);
}

export function encodeMegaAccountSessionDumpString(session: MegaAccountSessionDump): string {
  return encodeMegaBase64Url(encodeMegaAccountSessionDump(session));
}

export function encryptMegaMasterKeyWithSessionKey(masterKey: Buffer, sessionKey: Buffer): Buffer {
  validateBufferLength(masterKey, MEGA_MASTER_KEY_BYTES, 'MEGA master key');
  validateBufferLength(sessionKey, MEGA_SESSION_KEY_BYTES, 'MEGA session key');
  return aes128EcbEncrypt(masterKey, sessionKey);
}

export function decryptMegaMasterKeyWithSessionKey(encryptedMasterKey: Buffer, sessionKey: Buffer): Buffer {
  validateBufferLength(encryptedMasterKey, MEGA_MASTER_KEY_BYTES, 'MEGA encrypted master key');
  validateBufferLength(sessionKey, MEGA_SESSION_KEY_BYTES, 'MEGA session key');
  return aes128EcbDecrypt(encryptedMasterKey, sessionKey);
}

export function encodeMegaBase64Url(value: Buffer | Uint8Array): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

export function decodeMegaBase64Url(value: string): Buffer {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) {
    return Buffer.alloc(0);
  }
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64');
}

function normalizeSessionId(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? encodeMegaBase64Url(value) : value.trim();
}

function aes128EcbEncrypt(value: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(value), cipher.final()]);
}

function aes128EcbDecrypt(value: Buffer, key: Buffer): Buffer {
  const cipher = createDecipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(value), cipher.final()]);
}

function validateBufferLength(value: Buffer, expectedLength: number, label: string): void {
  if (value.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry));
}

export async function parseMegaJsonResponse(response: Response, label: string): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const preview = summarizeMegaPayloadPreview(raw);
    throw new Error(
      `${label} returned invalid JSON.${preview ? ` Response started with: ${preview}` : ''} Open the runtime logs and retry.`
    );
  }
}

function summarizeMegaPayloadPreview(raw: string): string {
  const normalized = raw.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }
  const preview = normalized.slice(0, 48);
  return JSON.stringify(preview);
}

/**
 * Solve a MEGA X-Hashcash proof-of-work challenge.
 *
 * The challenge format is `1:<easiness>:<unused>:<token_base64>`.
 * We must find a 4-byte nonce such that SHA-256 of (nonce ++ token×262144)
 * has a leading 32-bit value ≤ threshold derived from easiness.
 *
 * @see https://github.com/nicehash/nicehash-megajs — reference implementation
 */
export async function solveMegaHashcashChallenge(challenge: string): Promise<string> {
  const parts = challenge.split(':');
  const version = Number(parts[0]);
  if (version !== 1) {
    throw new Error(`Unsupported MEGA hashcash challenge version: ${version}`);
  }
  const easiness = Number(parts[1]);
  const tokenStr = parts[3];
  const base = ((easiness & 63) << 1) + 1;
  const shifts = (easiness >> 6) * 7 + 3;
  const threshold = base << shifts;
  const token = decodeMegaBase64Url(tokenStr);

  const COPIES = 262144;
  const buffer = Buffer.alloc(4 + COPIES * 48);
  for (let i = 0; i < COPIES; i++) {
    token.copy(buffer, 4 + i * 48);
  }

  // Brute-force the 4-byte nonce.
  for (;;) {
    const digest = Buffer.from(await subtle.digest('SHA-256', buffer));
    if (digest.readUInt32BE(0) <= threshold) {
      return `1:${tokenStr}:${encodeMegaBase64Url(buffer.subarray(0, 4))}`;
    }
    // Increment nonce (little-endian).
    let j = 0;
    while (j < 4) {
      buffer[j]++;
      if (buffer[j] !== 0) break;
      j++;
    }
  }
}
