import { resolveVolumeDestinations } from '../config/roots.js';
import type { MegaOwnerMirrorShareRef, MegaOwnerMirrorSource } from '../integrations/runtime.js';
import { normalizeStoragePath } from 'nearbytes-storage';
import { parseCanonicalBlockRelativePath, parseCanonicalEventRelativePath } from 'nearbytes-log';
import { MultiRootStorageBackend } from '../storage/multiRoot.js';

function isExplicitlyClaimedByOtherProviderManagedSource(
  storage: MultiRootStorageBackend,
  volumeId: string,
  shareSourceId: string
): boolean {
  const config = storage.getRootsConfig();
  const volume = config.volumes.find((entry) => entry.volumeId.trim().toLowerCase() === volumeId);
  if (!volume || volume.destinations.length === 0) {
    return false;
  }

  const sourceById = new Map(config.sources.map((source) => [source.id, source]));
  const explicitProviderManagedSourceIds = volume.destinations
    .map((destination) => sourceById.get(destination.sourceId))
    .filter((source): source is NonNullable<typeof source> => Boolean(source?.integration?.kind === 'provider-managed'))
    .map((source) => source.id);

  if (explicitProviderManagedSourceIds.length === 0) {
    return false;
  }
  if (explicitProviderManagedSourceIds.includes(shareSourceId)) {
    return false;
  }
  return true;
}

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
  const shareSourceId = share.sourceId;
  const config = storage.getRootsConfig();
  // Keep the owner runtime source aligned with merged default-volume routing for ordinary local
  // volumes, but do not republish channels for a volume once that volume is explicitly claimed by
  // another provider-managed share. Otherwise an adopted recipient volume can be echoed back out
  // through the base owner publication path.
  return new Set(
    config.volumes
      .filter((volume) =>
        resolveVolumeDestinations(config, volume.volumeId).some((destination) => destination.sourceId === shareSourceId) &&
        !isExplicitlyClaimedByOtherProviderManagedSource(storage, volume.volumeId.trim().toLowerCase(), shareSourceId)
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

    onWrite(listener) {
      return storage.onWrite((event) => {
        listener(normalizeStoragePath(event.path));
      });
    },
  };
}
