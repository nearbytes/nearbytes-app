# Nearbytes UI Architecture

## Overview

The Nearbytes UI is a Svelte 5 application that provides a reactive, branded interface for the Phase 2 API. It features offline support, PWA capabilities, and optimistic UI updates.

## Technology Stack

- **Framework**: Svelte 5 (runes-based reactivity)
- **Build Tool**: Vite
- **PWA**: vite-plugin-pwa with Workbox
- **Caching**: IndexedDB via `idb` library
- **Styling**: Scoped CSS in Svelte components

## Project Structure

```
ui/
├── src/
│   ├── lib/
│   │   ├── api.ts          # API client with auth handling
│   │   └── cache.ts        # IndexedDB caching operations
│   ├── App.svelte          # Main application component
│   └── main.ts             # Application entry point
├── vite.config.js          # Vite config with PWA plugin
└── package.json
```

## API Client (`src/lib/api.ts`)

The API client provides typed functions for all backend operations:

### Authentication Strategy

The UI implements a two-tier auth system:

1. **Bearer Token** (preferred): If `POST /open` returns a `token`, it's stored in `sessionStorage` and used for all subsequent requests via `Authorization: Bearer <token>` header.

2. **Secret Header** (fallback): If no token is returned, the secret is stored in memory and sent via `x-nearbytes-secret` header.

**Security Note**: Secrets are never stored in `localStorage` - only tokens (which are encrypted) may be stored in `sessionStorage`.

### API Functions

- `openVolume(secret)`: Opens a volume and returns `{ volumeId, files[], token? }`
- `listFiles(auth)`: Lists files for authenticated volume
- `uploadFiles(auth, files)`: Uploads files via multipart/form-data
- `deleteFile(auth, filename)`: Deletes a file by name
- `downloadFile(auth, blobHash)`: Downloads file as Blob
- `getRootsConfig()`: Reads local multi-root configuration/runtime status
- `updateRootsConfig(config)`: Persists local multi-root configuration

### Error Handling

All API functions parse backend error responses:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid secret or token"
  }
}
```

Errors are thrown as JavaScript `Error` objects with the message from the backend.

## Caching (`src/lib/cache.ts`)

IndexedDB is used to cache file listings per volumeId for offline access.

### Cache Structure

```typescript
{
  volumeId: string,
  files: FileMetadata[],
  cachedAt: number  // timestamp
}
```

### Cache Operations

- `getCachedFiles(volumeId)`: Returns cached files or `null`
- `setCachedFiles(volumeId, files)`: Stores files in cache
- `clearCache()`: Clears all cached volumes
- `getCacheTimestamp(volumeId)`: Returns cache timestamp

### Cache Strategy

1. **On volume open**: Check cache first, show immediately if available
2. **Network refresh**: Update cache with fresh data
3. **Offline fallback**: If network fails, show cached data with "offline" indicator
4. **Cache age**: Cached data older than 24 hours is considered stale but still shown offline

## Application Flow (`App.svelte`)

### State Management

The UI uses Svelte 5 runes for reactive state:

- `currentSecret`: User-entered secret
- `fileList`: Array of `FileMetadata` objects
- `volumeId`: Current volume identifier
- `auth`: Current auth (token or secret)
- `isOffline`: Whether using cached data
- `lastRefresh`: Timestamp of last network refresh

### Reactive File Loading

When `currentSecret` changes:

1. Call `openVolume(secret)`
2. Store returned `token` in `sessionStorage` if present
3. Set `auth` state (token or secret)
4. Set `volumeId` and `fileList`
5. Cache files in IndexedDB
6. Update `lastRefresh` timestamp

### Optimistic UI

The UI shows cached data immediately:

1. User enters secret
2. Check IndexedDB for cached files
3. Show cached files instantly (if available)
4. Fetch fresh data from network
5. Update UI with network data
6. Update cache

If network fails, cached data is shown with an "offline" indicator.

### File Operations

- **Upload**: Drag & drop → `uploadFiles()` → refresh list
- **Delete**: Click delete → `deleteFile()` → refresh list
- **Download**: Click file → `downloadFile()` → create blob URL → trigger download

## PWA Configuration

### Service Worker

The PWA plugin generates a service worker that:

- Caches app shell (HTML, CSS, JS)
- Implements NetworkFirst strategy for API calls
- Provides offline fallback

### Manifest

The PWA manifest includes:

- App name: "Nearbytes"
- Theme color: `#667eea`
- Background color: `#0a0a0f`
- Display mode: `standalone`

## Vite Proxy Configuration

The dev server proxies API routes to the backend:

```javascript
proxy: {
  '/open': { target: 'http://localhost:3000' },
  '/files': { target: 'http://localhost:3000' },
  '/upload': { target: 'http://localhost:3000' },
  '/file': { target: 'http://localhost:3000' },
  '/health': { target: 'http://localhost:3000' },
  '/timeline': { target: 'http://localhost:3000' },
  '/snapshot': { target: 'http://localhost:3000' },
  '/config': { target: 'http://localhost:3000' },
  '/__debug': { target: 'http://localhost:3000' }
}
```

This allows the UI to run on port 5173 while the backend runs on port 3000.

## Styling & Branding

### Theme

- **Background**: Dark gradient (`#0a0a0f` to `#1a1a2e`)
- **Accent Color**: `#667eea` (purple-blue)
- **Cards**: Semi-transparent with subtle borders
- **Typography**: System font stack with clear hierarchy

### Animations

- Fade-in on file materialization
- Scale on hover
- Smooth transitions for state changes

### Brand Mark

The header includes a simple SVG icon and "Nearbytes" title with gradient text.

## Development Workflow

1. Start backend: `npm run server` (from root)
2. Start UI: `cd ui && npm run dev`
3. Open http://localhost:5173
4. Enter secret to test

## Future Enhancements

- File preview (images, text)
- Upload progress indicators
- Batch operations
- Search/filter files
- File metadata editing
- Richer root-management UX for multi-root policies
