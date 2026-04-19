import { resolveVolumeDestinations } from '../config/roots.js';
import type { MegaOwnerMirrorShareRef, MegaOwnerMirrorSource } from '../integrations/runtime.js';
import { normalizeStoragePath } from '../storage/pathRecord.js';
import { parseCanonicalBlockRelativePath, parseCanonicalEventRelativePath } from '../storage/integrity.js';
import { MultiRootStorageBackend } from '../storage/multiRoot.js';

async function resolveAttachedVolumeIds(
  storage: MultiRootStorageBackend,
  share: MegaOwnerMirrorShareRef
): Promise<Set<string>> {
  const fromAttachments = (share.attachments ?? [])
    .map((attachment) => attachment.volumeId.trim().toLowerCase())
    .filter((volumeId) => volumeId.length > 0);
  if (fromAttachments.length > 0) {
    return new Set(fromAttachments);
  }
  if (!share.sourceId) {
    return new Set();
  }
  const config = storage.getRootsConfig();
  // Keep the desktop/server owner mirror aligned with the canonical merged destination model from
  // docs/specs/storage-integration-stack-v1.md: explicit volume destinations add to defaultVolume
  // destinations, they do not replace them. Owner shares published via defaultVolume must still
  // emit channels/* and blocks/* for attached volumes.
  return new Set(
    config.volumes
      .filter((volume) =>
        resolveVolumeDestinations(config, volume.volumeId).some((destination) => destination.sourceId === share.sourceId)
      )
      .map((volume) => volume.volumeId.trim().toLowerCase())
      .filter((volumeId) => volumeId.length > 0)
  );
}

export function createStorageBackedMegaOwnerMirrorSource(
  storage: MultiRootStorageBackend
): MegaOwnerMirrorSource {
  return {
    async listMirrorFiles(share): Promise<readonly string[]> {
      const attachedVolumeIds = await resolveAttachedVolumeIds(storage, share);
      const mirrorPaths = new Set<string>();

      const blockFiles = await storage.listFiles('blocks');
      for (const blockFile of blockFiles) {
        const relativePath = normalizeStoragePath(`blocks/${blockFile}`);
        if (parseCanonicalBlockRelativePath(relativePath)) {
          mirrorPaths.add(relativePath);
        }
      }

      const channelDirectories = attachedVolumeIds.size > 0
        ? Array.from(attachedVolumeIds)
        : await storage.listFiles('channels');
      for (const volumeId of channelDirectories) {
        const normalizedVolumeId = volumeId.trim().toLowerCase();
        if (!normalizedVolumeId) {
          continue;
        }
        const eventFiles = await storage.listFiles(`channels/${normalizedVolumeId}`);
        for (const eventFile of eventFiles) {
          const relativePath = normalizeStoragePath(`channels/${normalizedVolumeId}/${eventFile}`);
          if (parseCanonicalEventRelativePath(relativePath)) {
            mirrorPaths.add(relativePath);
          }
        }
      }

      return Array.from(mirrorPaths).sort((left, right) => left.localeCompare(right));
    },

    async readMirrorFile(_share, relativePath): Promise<Uint8Array> {
      return storage.readFile(normalizeStoragePath(relativePath));
    },
  };
}
