import type { CryptoOperations } from '../crypto/index.js';
import type { DecryptedEvent, EventPayload, Hash, SignedEvent } from '../types/events.js';
import { EVENT_ENVELOPE_VERSION, createEncryptedData } from '../types/events.js';
import type { KeyPair, PrivateKey, PublicKey } from '../types/keys.js';
import { bytesToHex } from '../utils/encoding.js';
import {
  deserializeInnerEventPayload,
  serializeEventEnvelope,
  serializeInnerEventPayload,
  withDecryptedPayload,
} from '../storage/serialization.js';

export async function createSignedEvent(
  crypto: CryptoOperations,
  keyPair: KeyPair,
  payload: EventPayload,
  blockRefs: readonly Hash[]
): Promise<DecryptedEvent> {
  const eventKey = await crypto.deriveSymKey(keyPair.privateKey);
  const ciphertext = await crypto.encryptSym(serializeInnerEventPayload(payload), eventKey);
  const envelope = {
    version: EVENT_ENVELOPE_VERSION,
    publicKey: bytesToHex(keyPair.publicKey),
    blockRefs: dedupeHashes(blockRefs),
    ciphertext,
  } as const;
  const signature = await crypto.signPR(serializeEventEnvelope(envelope), keyPair.privateKey);
  return {
    envelope,
    payload,
    signature,
  };
}

export async function decryptSignedEventPayload(
  crypto: CryptoOperations,
  privateKey: PrivateKey,
  event: SignedEvent
): Promise<EventPayload> {
  const eventKey = await crypto.deriveSymKey(privateKey);
  const plaintext = await crypto.decryptSym(createEncryptedData(event.envelope.ciphertext), eventKey);
  return deserializeInnerEventPayload(plaintext);
}

export async function hydrateSignedEvent(
  crypto: CryptoOperations,
  privateKey: PrivateKey,
  event: SignedEvent
): Promise<DecryptedEvent> {
  return withDecryptedPayload(event, await decryptSignedEventPayload(crypto, privateKey, event));
}

export function eventEnvelopePublicKeyMatches(event: SignedEvent, publicKey: PublicKey): boolean {
  return event.envelope.publicKey === bytesToHex(publicKey);
}

function dedupeHashes(blockRefs: readonly Hash[]): Hash[] {
  const seen = new Set<string>();
  const deduped: Hash[] = [];
  for (const hash of blockRefs) {
    if (seen.has(hash)) {
      continue;
    }
    seen.add(hash);
    deduped.push(hash);
  }
  return deduped;
}
