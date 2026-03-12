# API Reference

## Crypto Operations

### `CryptoOperations`

Core cryptographic operations interface.

#### Methods

- `computeHash(data: Uint8Array): Promise<Hash>`
- `generateSymmetricKey(): Promise<SymmetricKey>`
- `encryptSym(data: Uint8Array, key: SymmetricKey): Promise<EncryptedData>`
- `decryptSym(encrypted: EncryptedData, key: SymmetricKey): Promise<Uint8Array>`
- `deriveKeys(secret: Secret): Promise<KeyPair>`
- `signPR(data: Uint8Array, privateKey: PrivateKey): Promise<Signature>`
- `verifyPU(data: Uint8Array, signature: Signature, publicKey: PublicKey): Promise<boolean>`
- `deriveSymKey(privateKey: PrivateKey): Promise<SymmetricKey>`

## Domain Operations

### `setupChannel`

Initializes a new channel from a secret.

```typescript
setupChannel(
  secret: Secret,
  crypto: CryptoOperations,
  storage: StorageBackend,
  pathMapper?: ChannelPathMapper
): Promise<{ publicKey: PublicKey; channelPath: string }>
```

### `storeData`

Stores data in a channel.

```typescript
storeData(
  data: Uint8Array,
  secret: Secret,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage
): Promise<{ eventHash: Hash; dataHash: Hash }>
```

### `retrieveData`

Retrieves data from a channel.

```typescript
retrieveData(
  eventHash: Hash,
  secret: Secret,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage
): Promise<Uint8Array>
```

## Storage

### `StorageBackend`

Abstract storage interface.

#### Methods

- `writeFile(path: string, data: Uint8Array): Promise<void>`
- `readFile(path: string): Promise<Uint8Array>`
- `listFiles(directory: string): Promise<string[]>`
- `createDirectory(path: string): Promise<void>`
- `exists(path: string): Promise<boolean>`

### `ChannelStorage`

Channel-specific storage operations.

#### Methods

- `storeEvent(publicKey: PublicKey, event: SignedEvent): Promise<Hash>`
- `retrieveEvent(publicKey: PublicKey, eventHash: Hash): Promise<SignedEvent>`
- `listEvents(publicKey: PublicKey): Promise<Hash[]>`
- `storeEncryptedData(dataHash: Hash, encryptedData: EncryptedData): Promise<void>`
- `retrieveEncryptedData(dataHash: Hash): Promise<EncryptedData>`

## Types

### Branded Types

- `SymmetricKey`: 32-byte array
- `PrivateKey`: Private key bytes
- `PublicKey`: Public key bytes
- `Secret`: Non-empty secret string
- `Hash`: 64-character hex string
- `EncryptedData`: Encrypted bytes
- `Signature`: Signature bytes

### Interfaces

- `KeyPair`: `{ publicKey: PublicKey; privateKey: PrivateKey }`
- `EventPayload`: `{ hash: Hash; encryptedKey: EncryptedData }`
- `SignedEvent`: `{ payload: EventPayload; signature: Signature }`
