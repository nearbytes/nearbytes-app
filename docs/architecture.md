# NearBytes Architecture

## System Overview

NearBytes follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────┐
│         CLI Layer                   │
│  (Commands, Output, Validation)    │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│       Domain Layer                   │
│  (Channel, Event, Operations)       │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│      Storage Layer                   │
│  (Backend, Channel, Serialization)  │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│      Crypto Layer                    │
│  (Hash, Symmetric, Asymmetric)      │
└─────────────────────────────────────┘
```

## Layer Descriptions

### Crypto Layer

Provides cryptographic primitives:

- **Hash**: SHA-256 computation
- **Symmetric**: AES-256-GCM encryption/decryption
- **Asymmetric**: ECDSA P-256 key derivation, signing, verification

All operations use Web Crypto API (no external libraries).

### Storage Layer

Abstracts storage operations:

- **Backend**: Interface for file operations
- **Filesystem**: Node.js filesystem implementation
- **Channel**: Channel-specific operations (events, data blocks)
- **Serialization**: Event serialization/deserialization

### Domain Layer

High-level protocol operations:

- **Channel**: Channel domain model
- **Event**: Event domain model
- **Operations**: `setupChannel`, `storeData`, `retrieveData`

### CLI Layer

Command-line interface:

- **Commands**: `setup`, `store`, `retrieve`, `list`
- **Output**: Formatters (JSON, table, plain)
- **Validation**: Input validation utilities

## Data Flow

### Store Data Flow

```
1. User provides data + secret
2. Derive key pair from secret
3. Generate symmetric key
4. Encrypt data → encrypted data
5. Hash encrypted data → data hash
6. Store encrypted data block
7. Encrypt symmetric key with derived key
8. Create event payload (hash + encrypted key)
9. Sign event payload
10. Store signed event
```

### Retrieve Data Flow

```
1. User provides event hash + secret
2. Derive key pair from secret
3. Retrieve signed event
4. Verify event signature
5. Decrypt symmetric key
6. Retrieve encrypted data block
7. Decrypt data
8. Return plaintext
```

## File Structure

```
<storage-root>/
├── channels/
│   └── [channel-public-key-hex]/
│       ├── [event-hash].bin       # Signed event files
│       └── snapshot.latest.json   # Optional on-demand snapshot
└── blocks/
    └── [data-hash].bin            # Encrypted data blocks
```

## Design Decisions

1. **Branded Types**: Prevent type confusion at compile-time
2. **Interface-based**: All layers use interfaces for testability
3. **Error Handling**: Custom error types with proper chaining
4. **Immutability**: Use `readonly` and immutable data structures
5. **Web Crypto Only**: No external crypto libraries for security
