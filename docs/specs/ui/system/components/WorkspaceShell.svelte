<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { NearbytesLogoOptions } from '../branding.js';
  import type { WorkspaceChromeActions, WorkspaceChromeState } from '../workspaceChrome.js';
  import AppHeader from './AppHeader.svelte';
  import WorkspaceModeBar from './WorkspaceModeBar.svelte';
  import WorkspaceSearchStrip from './WorkspaceSearchStrip.svelte';
  import WorkspaceStage from './WorkspaceStage.svelte';

  type MountOption = {
    id: string;
    label: string;
  };

  let {
    isDevThemeStudio = false,
    themeLogoOptions,
    paletteLabel = '',
    activeMountId = '',
    mounts = [],
    draggingMounts = false,
    isHeaderHovering = false,
    setHeaderHovering,
    isSecretDropTarget = false,
    canHandleSecretDropPayload,
    setSecretDropTarget,
    onSecretFileDrop,
    onSelectMount,
    onOpenThemeStudio,
    onOpenCreateChooser,
    showPhoneOverflowMenu = false,
    phoneOverflowMenuButtonElement = $bindable<HTMLButtonElement | null>(null),
    phoneOverflowMenuElement = $bindable<HTMLElement | null>(null),
    showIdentityManager = false,
    showResetAction = false,
    showResetDialog = false,
    showSourcesPanel = false,
    onTogglePhoneOverflowMenu,
    onOpenIdentityManager,
    onOpenResetDialog,
    onToggleSourcesPanel,
    workspaceState,
    workspaceActions,
    mountRailChildren,
    mountRailActions,
    mode = 'workspace',
    isDragging = false,
    isVolumeWorkspaceActive = false,
    onDragOver,
    onDragLeave,
    onDrop,
    showEventFlowPanel = false,
    onCloseFlow,
    globalPanel,
    volumePanel,
    emptyState,
    showWorkspaceChrome = true,
    workspaceLead,
    workspaceMain,
    flowPanel,
  }: {
    isDevThemeStudio?: boolean;
    themeLogoOptions?: NearbytesLogoOptions;
    paletteLabel?: string;
    activeMountId?: string;
    mounts?: MountOption[];
    draggingMounts?: boolean;
    isHeaderHovering?: boolean;
    setHeaderHovering?: (value: boolean) => void;
    isSecretDropTarget?: boolean;
    canHandleSecretDropPayload?: (dataTransfer: DataTransfer | null) => boolean;
    setSecretDropTarget?: (value: boolean) => void;
    onSecretFileDrop?: (event: DragEvent) => void;
    onSelectMount?: (mountId: string) => void;
    onOpenThemeStudio?: () => void;
    onOpenCreateChooser?: () => void;
    showPhoneOverflowMenu?: boolean;
    phoneOverflowMenuButtonElement?: HTMLButtonElement | null;
    phoneOverflowMenuElement?: HTMLElement | null;
    showIdentityManager?: boolean;
    showResetAction?: boolean;
    showResetDialog?: boolean;
    showSourcesPanel?: boolean;
    onTogglePhoneOverflowMenu?: () => void;
    onOpenIdentityManager?: () => void;
    onOpenResetDialog?: () => void;
    onToggleSourcesPanel?: () => void;
    workspaceState: WorkspaceChromeState;
    workspaceActions: WorkspaceChromeActions;
    mountRailChildren?: Snippet;
    mountRailActions?: Snippet;
    mode?: 'global-panel' | 'volume-panel' | 'empty' | 'workspace';
    isDragging?: boolean;
    isVolumeWorkspaceActive?: boolean;
    onDragOver?: (event: DragEvent) => void;
    onDragLeave?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
    showEventFlowPanel?: boolean;
    onCloseFlow?: () => void;
    globalPanel?: Snippet;
    volumePanel?: Snippet;
    emptyState?: Snippet;
    showWorkspaceChrome?: boolean;
    workspaceLead?: Snippet;
    workspaceMain?: Snippet;
    flowPanel?: Snippet;
  } = $props();
</script>

<AppHeader
  {isDevThemeStudio}
  {themeLogoOptions}
  {paletteLabel}
  {activeMountId}
  {mounts}
  draggingMounts={draggingMounts}
  isHeaderHovering={isHeaderHovering}
  {setHeaderHovering}
  isSecretDropTarget={isSecretDropTarget}
  {canHandleSecretDropPayload}
  {setSecretDropTarget}
  {onSecretFileDrop}
  {onSelectMount}
  {onOpenThemeStudio}
  {onOpenCreateChooser}
  showPhoneOverflowMenu={showPhoneOverflowMenu}
  bind:phoneOverflowMenuButtonElement
  bind:phoneOverflowMenuElement
  showIdentityManager={showIdentityManager}
  showResetAction={showResetAction}
  showResetDialog={showResetDialog}
  showSourcesPanel={showSourcesPanel}
  {onTogglePhoneOverflowMenu}
  {onOpenIdentityManager}
  {onOpenResetDialog}
  {onToggleSourcesPanel}
  workspaceState={workspaceState}
  workspaceActions={workspaceActions}
>
  {#snippet mountRailChildren()}
    {@render mountRailChildren?.()}
  {/snippet}
  {#snippet mountRailActions()}
    {@render mountRailActions?.()}
  {/snippet}
</AppHeader>

<WorkspaceStage
  {mode}
  {isDragging}
  {isVolumeWorkspaceActive}
  {onDragOver}
  {onDragLeave}
  {onDrop}
  {showEventFlowPanel}
  {onCloseFlow}
>
  {#snippet globalPanel()}
    {@render globalPanel?.()}
  {/snippet}
  {#snippet volumePanel()}
    {@render volumePanel?.()}
  {/snippet}
  {#snippet emptyState()}
    {@render emptyState?.()}
  {/snippet}
  {#snippet workspaceContent()}
    {@render workspaceLead?.()}
    {#if showWorkspaceChrome}
      <WorkspaceModeBar state={workspaceState} actions={workspaceActions} />
      {#if workspaceState.showFilesWorkspace && workspaceState.showSearchWorkspace}
        <WorkspaceSearchStrip state={workspaceState} actions={workspaceActions} />
      {/if}
    {/if}
    {@render workspaceMain?.()}
  {/snippet}
  {#snippet flowPanel()}
    {@render flowPanel?.()}
  {/snippet}
</WorkspaceStage>
