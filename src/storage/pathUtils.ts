export function normalizeStoragePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '').trim();
}
