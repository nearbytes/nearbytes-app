import type { SignedEvent, SerializedEvent, EventPayload } from '../types/events.js';
import { createHash, createEncryptedData, createSignature, EventType } from '../types/events.js';
import { bytesToBase64, base64ToBytes } from '../utils/encoding.js';

/**
 * Serializes a signed event to JSON-serializable format
 * @param event - Signed event to serialize
 * @returns Serialized event
 */
export function serializeEvent(event: SignedEvent): SerializedEvent {
  const payload: {
    type: string;
    fileName: string;
    toFileName?: string;
    hash: string;
    encryptedKey: string;
    contentType?: 'b' | 'm';
    size?: number;
    mimeType?: string;
    createdAt?: number;
    deletedAt?: number;
    renamedAt?: number;
    authorPublicKey?: string;
    protocol?: string;
    record?: string;
    message?: string;
    publishedAt?: number;
  } = {
    type: event.payload.type,
    fileName: event.payload.fileName,
    hash: event.payload.hash,
    encryptedKey: bytesToBase64(event.payload.encryptedKey),
  };

  if (event.payload.size !== undefined) {
    payload.size = event.payload.size;
  }
  if (event.payload.contentType !== undefined) {
    payload.contentType = event.payload.contentType;
  }
  if (event.payload.mimeType !== undefined) {
    payload.mimeType = event.payload.mimeType;
  }
  if (event.payload.createdAt !== undefined) {
    payload.createdAt = event.payload.createdAt;
  }
  if (event.payload.deletedAt !== undefined) {
    payload.deletedAt = event.payload.deletedAt;
  }
  if (event.payload.toFileName !== undefined) {
    payload.toFileName = event.payload.toFileName;
  }
  if (event.payload.renamedAt !== undefined) {
    payload.renamedAt = event.payload.renamedAt;
  }
  if (event.payload.authorPublicKey !== undefined) {
    payload.authorPublicKey = event.payload.authorPublicKey;
  }
  if (event.payload.protocol !== undefined) {
    payload.protocol = event.payload.protocol;
  }
  if (event.payload.record !== undefined) {
    payload.record = event.payload.record;
  }
  if (event.payload.message !== undefined) {
    payload.message = event.payload.message;
  }
  if (event.payload.publishedAt !== undefined) {
    payload.publishedAt = event.payload.publishedAt;
  }

  return {
    payload,
    signature: bytesToBase64(event.signature),
  };
}

/**
 * Deserializes a signed event from JSON format
 * @param data - Serialized event data
 * @returns Signed event
 */
export function deserializeEvent(data: SerializedEvent): SignedEvent {
  // Validate event type
  if (
    data.payload.type !== EventType.CREATE_FILE &&
    data.payload.type !== EventType.DELETE_FILE &&
    data.payload.type !== EventType.RENAME_FILE &&
    data.payload.type !== EventType.DECLARE_IDENTITY &&
    data.payload.type !== EventType.CHAT_MESSAGE &&
    data.payload.type !== EventType.APP_RECORD
  ) {
    throw new Error(`Invalid event type: ${data.payload.type}`);
  }
  if (data.payload.size !== undefined) {
    assertFiniteUint(data.payload.size, 'size');
  }
  if (
    data.payload.contentType !== undefined &&
    data.payload.contentType !== 'b' &&
    data.payload.contentType !== 'm'
  ) {
    throw new Error('Invalid contentType: must be "b" or "m"');
  }
  if (data.payload.createdAt !== undefined) {
    assertFiniteUint(data.payload.createdAt, 'createdAt');
  }
  if (data.payload.deletedAt !== undefined) {
    assertFiniteUint(data.payload.deletedAt, 'deletedAt');
  }
  if (data.payload.renamedAt !== undefined) {
    assertFiniteUint(data.payload.renamedAt, 'renamedAt');
  }
  if (data.payload.publishedAt !== undefined) {
    assertFiniteUint(data.payload.publishedAt, 'publishedAt');
  }
  if (data.payload.mimeType !== undefined && typeof data.payload.mimeType !== 'string') {
    throw new Error('Invalid mimeType: must be a string');
  }
  if (data.payload.toFileName !== undefined && typeof data.payload.toFileName !== 'string') {
    throw new Error('Invalid toFileName: must be a string');
  }
  if (data.payload.authorPublicKey !== undefined && typeof data.payload.authorPublicKey !== 'string') {
    throw new Error('Invalid authorPublicKey: must be a string');
  }
  if (data.payload.protocol !== undefined && typeof data.payload.protocol !== 'string') {
    throw new Error('Invalid protocol: must be a string');
  }
  if (data.payload.record !== undefined && typeof data.payload.record !== 'string') {
    throw new Error('Invalid record: must be a string');
  }
  if (data.payload.message !== undefined && typeof data.payload.message !== 'string') {
    throw new Error('Invalid message: must be a string');
  }

  return {
    payload: {
      type: data.payload.type as EventType,
      fileName: data.payload.fileName,
      toFileName: data.payload.toFileName,
      hash: createHash(data.payload.hash),
      encryptedKey: createEncryptedData(base64ToBytes(data.payload.encryptedKey)),
      contentType: data.payload.contentType,
      size: data.payload.size,
      mimeType: data.payload.mimeType,
      createdAt: data.payload.createdAt,
      deletedAt: data.payload.deletedAt,
      renamedAt: data.payload.renamedAt,
      authorPublicKey: data.payload.authorPublicKey,
      protocol: data.payload.protocol,
      record: data.payload.record,
      message: data.payload.message,
      publishedAt: data.payload.publishedAt,
    },
    signature: createSignature(base64ToBytes(data.signature)),
  };
}

/**
 * Serializes an event payload to bytes for hashing/signing
 * 
 * Format (big-endian):
 * - eventType: 1 byte (0 = CREATE_FILE, 1 = DELETE_FILE, 2 = RENAME_FILE)
 * - fileNameLength: 4 bytes (uint32)
 * - fileName: N bytes (UTF-8)
 * - hash: 64 bytes (hex string)
 * - encryptedKeyLength: 4 bytes (uint32)
 * - encryptedKey: N bytes
 * 
 * @param payload - Event payload
 * @returns Serialized bytes
 */
export function serializeEventPayload(payload: EventPayload): Uint8Array {
  const hasMetadata =
    payload.contentType !== undefined ||
    payload.size !== undefined ||
    payload.mimeType !== undefined ||
    payload.createdAt !== undefined ||
    payload.deletedAt !== undefined ||
    payload.toFileName !== undefined ||
    payload.renamedAt !== undefined ||
    payload.authorPublicKey !== undefined ||
    payload.protocol !== undefined ||
    payload.record !== undefined ||
    payload.message !== undefined ||
    payload.publishedAt !== undefined;

  const eventTypeByte =
    payload.type === EventType.CREATE_FILE
      ? 0
      : payload.type === EventType.DELETE_FILE
        ? 1
        : payload.type === EventType.RENAME_FILE
          ? 2
          : payload.type === EventType.DECLARE_IDENTITY
            ? 3
            : payload.type === EventType.CHAT_MESSAGE
              ? 4
              : 5;
  const fileNameBytes = new TextEncoder().encode(payload.fileName);
  const fileNameLength = new Uint8Array(4);
  const fileNameLengthView = new DataView(fileNameLength.buffer);
  fileNameLengthView.setUint32(0, fileNameBytes.length, false); // big-endian

  const hashBytes = new TextEncoder().encode(payload.hash);
  const keyLength = new Uint8Array(4);
  const keyLengthView = new DataView(keyLength.buffer);
  keyLengthView.setUint32(0, payload.encryptedKey.length, false); // big-endian

  const metadataBytes = hasMetadata ? serializeMetadata(payload) : new Uint8Array(0);
  const totalLength =
    1 + 4 + fileNameBytes.length + hashBytes.length + 4 + payload.encryptedKey.length + metadataBytes.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;

  // Event type
  result[offset++] = eventTypeByte;

  // File name length + file name
  result.set(fileNameLength, offset);
  offset += 4;
  result.set(fileNameBytes, offset);
  offset += fileNameBytes.length;

  // Hash
  result.set(hashBytes, offset);
  offset += hashBytes.length;

  // Encrypted key length + encrypted key
  result.set(keyLength, offset);
  offset += 4;
  result.set(payload.encryptedKey, offset);
  offset += payload.encryptedKey.length;

  // Optional metadata
  if (metadataBytes.length > 0) {
    result.set(metadataBytes, offset);
  }

  return result;
}

/**
 * Deserializes an event payload from bytes
 * @param data - Serialized bytes
 * @returns Event payload
 */
export function deserializeEventPayload(data: Uint8Array): EventPayload {
  if (data.length < 1 + 4 + 64 + 4) {
    throw new Error('Invalid event payload: too short');
  }

  let offset = 0;

  // Event type
  const eventTypeByte = data[offset++];
  const type =
    eventTypeByte === 0
      ? EventType.CREATE_FILE
      : eventTypeByte === 1
        ? EventType.DELETE_FILE
        : eventTypeByte === 2
          ? EventType.RENAME_FILE
          : eventTypeByte === 3
            ? EventType.DECLARE_IDENTITY
            : eventTypeByte === 4
              ? EventType.CHAT_MESSAGE
              : eventTypeByte === 5
                ? EventType.APP_RECORD
          : null;
  if (!type) {
    throw new Error(`Invalid event payload: unknown event type ${eventTypeByte}`);
  }

  // File name length + file name
  const fileNameLengthView = new DataView(data.buffer, data.byteOffset + offset, 4);
  const fileNameLength = fileNameLengthView.getUint32(0, false); // big-endian
  offset += 4;

  if (data.length < offset + fileNameLength) {
    throw new Error('Invalid event payload: file name length mismatch');
  }

  const fileNameBytes = data.slice(offset, offset + fileNameLength);
  const fileName = new TextDecoder().decode(fileNameBytes);
  offset += fileNameLength;

  // Hash
  if (data.length < offset + 64) {
    throw new Error('Invalid event payload: hash missing');
  }
  const hashBytes = data.slice(offset, offset + 64);
  const hash = new TextDecoder().decode(hashBytes);
  offset += 64;

  // Encrypted key length + encrypted key
  const keyLengthView = new DataView(data.buffer, data.byteOffset + offset, 4);
  const keyLength = keyLengthView.getUint32(0, false); // big-endian
  offset += 4;

  if (data.length < offset + keyLength) {
    throw new Error('Invalid event payload: encrypted key length mismatch');
  }

  const encryptedKey = data.slice(offset, offset + keyLength);
  offset += keyLength;

  const metadata = offset < data.length ? deserializeMetadata(data, offset, type) : {};
  if (metadata.bytesConsumed && offset + metadata.bytesConsumed !== data.length) {
    throw new Error('Invalid event payload: extra bytes after metadata');
  }

  return {
    type,
    fileName,
    hash: createHash(hash),
    encryptedKey: createEncryptedData(encryptedKey),
    contentType: metadata.contentType,
    size: metadata.size,
    mimeType: metadata.mimeType,
    createdAt: metadata.createdAt,
    deletedAt: metadata.deletedAt,
    toFileName: metadata.toFileName,
    renamedAt: metadata.renamedAt,
    authorPublicKey: metadata.authorPublicKey,
    protocol: metadata.protocol,
    record: metadata.record,
    message: metadata.message,
    publishedAt: metadata.publishedAt,
  };
}

function assertFiniteUint(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}: must be a non-negative integer`);
  }
}

function serializeMetadata(payload: EventPayload): Uint8Array {
  if (payload.type === EventType.CREATE_FILE) {
    const metadataVersion = payload.contentType !== undefined ? 2 : 1;
    if (payload.size === undefined) {
      throw new Error('Missing size for CREATE_FILE metadata');
    }
    if (payload.createdAt === undefined) {
      throw new Error('Missing createdAt for CREATE_FILE metadata');
    }
    assertFiniteUint(payload.size, 'size');
    assertFiniteUint(payload.createdAt, 'createdAt');
    const contentType = payload.contentType ?? 'b';
    if (contentType !== 'b' && contentType !== 'm') {
      throw new Error('Invalid contentType for CREATE_FILE metadata');
    }

    const mimeTypeBytes = payload.mimeType ? new TextEncoder().encode(payload.mimeType) : new Uint8Array(0);
    const mimeTypeLength = new Uint8Array(4);
    const mimeTypeLengthView = new DataView(mimeTypeLength.buffer);
    mimeTypeLengthView.setUint32(0, mimeTypeBytes.length, false); // big-endian

    if (metadataVersion === 1) {
      const metadata = new Uint8Array(1 + 8 + 8 + 4 + mimeTypeBytes.length);
      const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);

      metadata[0] = metadataVersion;
      writeUint64(view, 1, payload.size);
      writeUint64(view, 1 + 8, payload.createdAt);
      metadata.set(mimeTypeLength, 1 + 8 + 8);
      metadata.set(mimeTypeBytes, 1 + 8 + 8 + 4);

      return metadata;
    }

    const metadata = new Uint8Array(1 + 1 + 8 + 8 + 4 + mimeTypeBytes.length);
    const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);

    metadata[0] = metadataVersion;
    metadata[1] = contentType === 'm' ? 1 : 0;
    writeUint64(view, 2, payload.size);
    writeUint64(view, 2 + 8, payload.createdAt);
    metadata.set(mimeTypeLength, 2 + 8 + 8);
    metadata.set(mimeTypeBytes, 2 + 8 + 8 + 4);

    return metadata;
  }

  if (payload.type === EventType.DELETE_FILE) {
    const metadataVersion = 1;
    if (payload.deletedAt === undefined) {
      throw new Error('Missing deletedAt for DELETE_FILE metadata');
    }
    assertFiniteUint(payload.deletedAt, 'deletedAt');

    const metadata = new Uint8Array(1 + 8);
    const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
    metadata[0] = metadataVersion;
    writeUint64(view, 1, payload.deletedAt);
    return metadata;
  }

  if (payload.type === EventType.RENAME_FILE) {
    const metadataVersion = 1;
    if (!payload.toFileName || payload.toFileName.trim().length === 0) {
      throw new Error('Missing toFileName for RENAME_FILE metadata');
    }
    if (payload.renamedAt === undefined) {
      throw new Error('Missing renamedAt for RENAME_FILE metadata');
    }
    assertFiniteUint(payload.renamedAt, 'renamedAt');

    const toFileNameBytes = new TextEncoder().encode(payload.toFileName);
    const toFileNameLength = new Uint8Array(4);
    new DataView(toFileNameLength.buffer).setUint32(0, toFileNameBytes.length, false);

    const metadata = new Uint8Array(1 + 8 + 4 + toFileNameBytes.length);
    const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
    metadata[0] = metadataVersion;
    writeUint64(view, 1, payload.renamedAt);
    metadata.set(toFileNameLength, 1 + 8);
    metadata.set(toFileNameBytes, 1 + 8 + 4);
    return metadata;
  }

  if (payload.type === EventType.DECLARE_IDENTITY || payload.type === EventType.CHAT_MESSAGE) {
    const metadataVersion = 1;
    if (!payload.authorPublicKey || payload.authorPublicKey.trim().length === 0) {
      throw new Error(`Missing authorPublicKey for ${payload.type} metadata`);
    }
    if (payload.publishedAt === undefined) {
      throw new Error(`Missing publishedAt for ${payload.type} metadata`);
    }
    const nestedPayload =
      payload.type === EventType.DECLARE_IDENTITY
        ? payload.record
        : payload.message;
    if (!nestedPayload || nestedPayload.trim().length === 0) {
      throw new Error(`Missing nested payload for ${payload.type} metadata`);
    }
    assertFiniteUint(payload.publishedAt, 'publishedAt');

    const authorBytes = new TextEncoder().encode(payload.authorPublicKey);
    const nestedBytes = new TextEncoder().encode(nestedPayload);
    const authorLength = new Uint8Array(4);
    const nestedLength = new Uint8Array(4);
    new DataView(authorLength.buffer).setUint32(0, authorBytes.length, false);
    new DataView(nestedLength.buffer).setUint32(0, nestedBytes.length, false);

    const metadata = new Uint8Array(1 + 8 + 4 + authorBytes.length + 4 + nestedBytes.length);
    const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
    metadata[0] = metadataVersion;
    writeUint64(view, 1, payload.publishedAt);
    metadata.set(authorLength, 1 + 8);
    metadata.set(authorBytes, 1 + 8 + 4);
    const nestedOffset = 1 + 8 + 4 + authorBytes.length;
    metadata.set(nestedLength, nestedOffset);
    metadata.set(nestedBytes, nestedOffset + 4);
    return metadata;
  }

  if (payload.type === EventType.APP_RECORD) {
    const metadataVersion = 1;
    if (!payload.authorPublicKey || payload.authorPublicKey.trim().length === 0) {
      throw new Error('Missing authorPublicKey for APP_RECORD metadata');
    }
    if (!payload.protocol || payload.protocol.trim().length === 0) {
      throw new Error('Missing protocol for APP_RECORD metadata');
    }
    if (!payload.record || payload.record.trim().length === 0) {
      throw new Error('Missing record for APP_RECORD metadata');
    }
    if (payload.publishedAt === undefined) {
      throw new Error('Missing publishedAt for APP_RECORD metadata');
    }
    assertFiniteUint(payload.publishedAt, 'publishedAt');

    const authorBytes = new TextEncoder().encode(payload.authorPublicKey);
    const protocolBytes = new TextEncoder().encode(payload.protocol);
    const recordBytes = new TextEncoder().encode(payload.record);
    const authorLength = new Uint8Array(4);
    const protocolLength = new Uint8Array(4);
    const recordLength = new Uint8Array(4);
    new DataView(authorLength.buffer).setUint32(0, authorBytes.length, false);
    new DataView(protocolLength.buffer).setUint32(0, protocolBytes.length, false);
    new DataView(recordLength.buffer).setUint32(0, recordBytes.length, false);

    const metadata = new Uint8Array(
      1 + 8 + 4 + authorBytes.length + 4 + protocolBytes.length + 4 + recordBytes.length
    );
    const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
    metadata[0] = metadataVersion;
    writeUint64(view, 1, payload.publishedAt);
    metadata.set(authorLength, 1 + 8);
    metadata.set(authorBytes, 1 + 8 + 4);
    const protocolOffset = 1 + 8 + 4 + authorBytes.length;
    metadata.set(protocolLength, protocolOffset);
    metadata.set(protocolBytes, protocolOffset + 4);
    const recordOffset = protocolOffset + 4 + protocolBytes.length;
    metadata.set(recordLength, recordOffset);
    metadata.set(recordBytes, recordOffset + 4);
    return metadata;
  }

  return new Uint8Array(0);
}

function deserializeMetadata(
  data: Uint8Array,
  offset: number,
  type: EventType
): {
  contentType?: 'b' | 'm';
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  toFileName?: string;
  renamedAt?: number;
  authorPublicKey?: string;
  protocol?: string;
  record?: string;
  message?: string;
  publishedAt?: number;
  bytesConsumed?: number;
} {
  if (data.length < offset + 1) {
    throw new Error('Invalid event payload: metadata version missing');
  }

  const metadataVersion = data[offset];
  if (metadataVersion !== 1 && metadataVersion !== 2) {
    throw new Error(`Unsupported metadata version: ${metadataVersion}`);
  }

  if (type === EventType.CREATE_FILE) {
    if (metadataVersion === 1) {
      if (data.length < offset + 1 + 8 + 8 + 4) {
        throw new Error('Invalid event payload: CREATE_FILE metadata too short');
      }

      const view = new DataView(data.buffer, data.byteOffset + offset + 1, data.length - offset - 1);
      const size = readUint64(view, 0, 'size');
      const createdAt = readUint64(view, 8, 'createdAt');

      const mimeTypeLengthView = new DataView(
        data.buffer,
        data.byteOffset + offset + 1 + 8 + 8,
        4
      );
      const mimeTypeLength = mimeTypeLengthView.getUint32(0, false); // big-endian
      const mimeTypeOffset = offset + 1 + 8 + 8 + 4;

      if (data.length < mimeTypeOffset + mimeTypeLength) {
        throw new Error('Invalid event payload: mime type length mismatch');
      }

      const mimeTypeBytes = data.slice(mimeTypeOffset, mimeTypeOffset + mimeTypeLength);
      const mimeType = mimeTypeLength > 0 ? new TextDecoder().decode(mimeTypeBytes) : undefined;

      return {
        contentType: 'b',
        size,
        mimeType,
        createdAt,
        bytesConsumed: 1 + 8 + 8 + 4 + mimeTypeLength,
      };
    }

    if (data.length < offset + 1 + 1 + 8 + 8 + 4) {
      throw new Error('Invalid event payload: CREATE_FILE metadata too short');
    }

    const contentTypeByte = data[offset + 1];
    const contentType = contentTypeByte === 1 ? 'm' : contentTypeByte === 0 ? 'b' : null;
    if (!contentType) {
      throw new Error(`Invalid event payload: unknown contentType ${contentTypeByte}`);
    }

    const view = new DataView(data.buffer, data.byteOffset + offset + 2, data.length - offset - 2);
    const size = readUint64(view, 0, 'size');
    const createdAt = readUint64(view, 8, 'createdAt');

    const mimeTypeLengthView = new DataView(
      data.buffer,
      data.byteOffset + offset + 2 + 8 + 8,
      4
    );
    const mimeTypeLength = mimeTypeLengthView.getUint32(0, false); // big-endian
    const mimeTypeOffset = offset + 2 + 8 + 8 + 4;

    if (data.length < mimeTypeOffset + mimeTypeLength) {
      throw new Error('Invalid event payload: mime type length mismatch');
    }

    const mimeTypeBytes = data.slice(mimeTypeOffset, mimeTypeOffset + mimeTypeLength);
    const mimeType = mimeTypeLength > 0 ? new TextDecoder().decode(mimeTypeBytes) : undefined;

    return {
      contentType,
      size,
      mimeType,
      createdAt,
      bytesConsumed: 1 + 1 + 8 + 8 + 4 + mimeTypeLength,
    };
  }

  if (type === EventType.DELETE_FILE) {
    if (data.length < offset + 1 + 8) {
      throw new Error('Invalid event payload: DELETE_FILE metadata too short');
    }
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 8);
    const deletedAt = readUint64(view, 0, 'deletedAt');
    return {
      deletedAt,
      bytesConsumed: 1 + 8,
    };
  }

  if (type === EventType.RENAME_FILE) {
    if (data.length < offset + 1 + 8 + 4) {
      throw new Error('Invalid event payload: RENAME_FILE metadata too short');
    }
    const renamedAt = readUint64(
      new DataView(data.buffer, data.byteOffset + offset + 1, 8),
      0,
      'renamedAt'
    );
    const toFileNameLength = new DataView(data.buffer, data.byteOffset + offset + 1 + 8, 4).getUint32(0, false);
    const toFileNameOffset = offset + 1 + 8 + 4;
    if (data.length < toFileNameOffset + toFileNameLength) {
      throw new Error('Invalid event payload: toFileName length mismatch');
    }
    const toFileNameBytes = data.slice(toFileNameOffset, toFileNameOffset + toFileNameLength);
    return {
      toFileName: new TextDecoder().decode(toFileNameBytes),
      renamedAt,
      bytesConsumed: 1 + 8 + 4 + toFileNameLength,
    };
  }

  if (type === EventType.DECLARE_IDENTITY || type === EventType.CHAT_MESSAGE) {
    if (data.length < offset + 1 + 8 + 4) {
      throw new Error(`Invalid event payload: ${type} metadata too short`);
    }
    const publishedAt = readUint64(
      new DataView(data.buffer, data.byteOffset + offset + 1, 8),
      0,
      'publishedAt'
    );
    const authorLength = new DataView(data.buffer, data.byteOffset + offset + 1 + 8, 4).getUint32(0, false);
    const authorOffset = offset + 1 + 8 + 4;
    if (data.length < authorOffset + authorLength + 4) {
      throw new Error(`Invalid event payload: ${type} authorPublicKey length mismatch`);
    }
    const authorBytes = data.slice(authorOffset, authorOffset + authorLength);
    const nestedLengthOffset = authorOffset + authorLength;
    const nestedLength = new DataView(data.buffer, data.byteOffset + nestedLengthOffset, 4).getUint32(0, false);
    const nestedOffset = nestedLengthOffset + 4;
    if (data.length < nestedOffset + nestedLength) {
      throw new Error(`Invalid event payload: ${type} nested payload length mismatch`);
    }
    const nestedPayload = new TextDecoder().decode(data.slice(nestedOffset, nestedOffset + nestedLength));
    return {
      authorPublicKey: new TextDecoder().decode(authorBytes),
      record: type === EventType.DECLARE_IDENTITY ? nestedPayload : undefined,
      message: type === EventType.CHAT_MESSAGE ? nestedPayload : undefined,
      publishedAt,
      bytesConsumed: 1 + 8 + 4 + authorLength + 4 + nestedLength,
    };
  }

  if (type === EventType.APP_RECORD) {
    if (data.length < offset + 1 + 8 + 4) {
      throw new Error('Invalid event payload: APP_RECORD metadata too short');
    }
    const publishedAt = readUint64(
      new DataView(data.buffer, data.byteOffset + offset + 1, 8),
      0,
      'publishedAt'
    );
    const authorLength = new DataView(data.buffer, data.byteOffset + offset + 1 + 8, 4).getUint32(0, false);
    const authorOffset = offset + 1 + 8 + 4;
    if (data.length < authorOffset + authorLength + 4) {
      throw new Error('Invalid event payload: APP_RECORD authorPublicKey length mismatch');
    }
    const authorBytes = data.slice(authorOffset, authorOffset + authorLength);
    const protocolLengthOffset = authorOffset + authorLength;
    const protocolLength = new DataView(data.buffer, data.byteOffset + protocolLengthOffset, 4).getUint32(0, false);
    const protocolOffset = protocolLengthOffset + 4;
    if (data.length < protocolOffset + protocolLength + 4) {
      throw new Error('Invalid event payload: APP_RECORD protocol length mismatch');
    }
    const protocolBytes = data.slice(protocolOffset, protocolOffset + protocolLength);
    const recordLengthOffset = protocolOffset + protocolLength;
    const recordLength = new DataView(data.buffer, data.byteOffset + recordLengthOffset, 4).getUint32(0, false);
    const recordOffset = recordLengthOffset + 4;
    if (data.length < recordOffset + recordLength) {
      throw new Error('Invalid event payload: APP_RECORD record length mismatch');
    }
    return {
      authorPublicKey: new TextDecoder().decode(authorBytes),
      protocol: new TextDecoder().decode(protocolBytes),
      record: new TextDecoder().decode(data.slice(recordOffset, recordOffset + recordLength)),
      publishedAt,
      bytesConsumed: 1 + 8 + 4 + authorLength + 4 + protocolLength + 4 + recordLength,
    };
  }

  return {};
}

function writeUint64(view: DataView, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Value must be a non-negative safe integer');
  }
  view.setBigUint64(offset, BigInt(value), false);
}

function readUint64(view: DataView, offset: number, fieldName: string): number {
  const value = Number(view.getBigUint64(offset, false));
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${fieldName}: exceeds safe integer range`);
  }
  return value;
}
