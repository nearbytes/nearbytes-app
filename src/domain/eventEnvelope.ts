import type { CryptoOperations } from 'nearbytes-crypto';
import type { DecryptedEvent, EventPayload, Hash, SignedEvent } from 'nearbytes-crypto';
import { EVENT_ENVELOPE_VERSION, createEncryptedData } from 'nearbytes-crypto';
import type { KeyPair, PrivateKey, PublicKey } from 'nearbytes-crypto';
import { bytesToHex } from 'nearbytes-crypto';
import { deserializeInnerEventPayload, serializeEventEnvelope, serializeInnerEventPayload } from 'nearbytes-log';

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
  const payload = await decryptSignedEventPayload(crypto, privateKey, event);
  return { ...event, payload };
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
