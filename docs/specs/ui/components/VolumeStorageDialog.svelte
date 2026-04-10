<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import StoragePanel from './StoragePanel.svelte';

  type MountedVolumePresentation = {
    volumeId: string;
    label: string;
    filePayload: string;
    fileMimeType: string;
    fileName: string;
  };

  let {
    title = 'Hub storage',
    volumeId = null,
    currentVolumePresentation = null,
    knownVolumes = [],
    refreshToken = 0,
    onOpenVolumeRouting = undefined,
    onOpenStorageSetup = undefined,
    onClose = undefined,
  } = $props<{
    title?: string;
    volumeId?: string | null;
    currentVolumePresentation?: MountedVolumePresentation | null;
    knownVolumes?: Array<{ volumeId: string; label: string }>;
    refreshToken?: number;
    onOpenVolumeRouting?: ((value: string) => void) | undefined;
    onOpenStorageSetup?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
  }>();
</script>

<AppDialog
  ariaLabel="Hub storage"
  eyebrow="Hub storage"
  {title}
  subtitle="Choose which locations this hub can read from and write to."
  width="full"
  closeLabel="Close hub storage"
  onClose={onClose}
>
  {#snippet body()}
    <StoragePanel
      mode="volume"
      {volumeId}
      {currentVolumePresentation}
      {knownVolumes}
      {refreshToken}
      onOpenVolumeRouting={onOpenVolumeRouting}
      onOpenStorageSetup={onOpenStorageSetup}
    />
  {/snippet}
</AppDialog>