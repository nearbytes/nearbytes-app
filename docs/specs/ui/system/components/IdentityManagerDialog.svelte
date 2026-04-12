<script lang="ts">
  import { MessageSquareText, Plus, Trash2, UserRound, X } from 'lucide-svelte';
  import { devSurface, getDevContext } from '../dev.js';
  import SharedSecretEditor from './SharedSecretEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';

  type ConfiguredIdentity = {
    id: string;
    address: string;
    password: string;
    displayName: string;
    bio: string;
    publicKey?: string;
    secretFileName: string;
    secretFileMimeType: string;
    avatarDataUrl?: string;
  };

  let identityAvatarFileInput = $state<HTMLInputElement | null>(null);

  let {
    configuredIdentities = [],
    activeChatIdentityId = '',
    currentVolumeChatIdentityId = '',
    joinedChatIdentityNeedsPublish = false,
    selectedChatIdentityNeedsPublish = false,
    selectedChatIdentity = null,
    selectedChatIdentityStatus = null,
    selectedSecretPreviewUrl = null,
    selectedSecretIsImage = false,
    selectedAvatarLabel = '',
    errorMessage = '',
    successMessage = '',
    identityManagerLoading = false,
    identityManagerAction = 'idle',
    activeHubAuth = false,
    isHistoryMode = false,
    onClose = undefined,
    onAddIdentity = undefined,
    onSelectIdentity = undefined,
    onSecretValueInput = undefined,
    onSecretPasswordInput = undefined,
    onSecretFileSelected = undefined,
    onClearSecretFile = undefined,
    onAvatarFileSelected = undefined,
    onClearAvatar = undefined,
    onDisplayNameInput = undefined,
    onBioInput = undefined,
    onRemoveIdentity = undefined,
    onPublish = undefined,
    onJoin = undefined,
  } = $props<{
    configuredIdentities?: ConfiguredIdentity[];
    activeChatIdentityId?: string;
    currentVolumeChatIdentityId?: string;
    joinedChatIdentityNeedsPublish?: boolean;
    selectedChatIdentityNeedsPublish?: boolean;
    selectedChatIdentity?: ConfiguredIdentity | null;
    selectedChatIdentityStatus?: { tone: string; title: string; detail: string } | null;
    selectedSecretPreviewUrl?: string | null;
    selectedSecretIsImage?: boolean;
    selectedAvatarLabel?: string;
    errorMessage?: string;
    successMessage?: string;
    identityManagerLoading?: boolean;
    identityManagerAction?: 'idle' | 'publish' | 'join';
    activeHubAuth?: boolean;
    isHistoryMode?: boolean;
    onClose?: (() => void) | undefined;
    onAddIdentity?: (() => void) | undefined;
    onSelectIdentity?: ((identityId: string) => void) | undefined;
    onSecretValueInput?: ((value: string) => void) | undefined;
    onSecretPasswordInput?: ((value: string) => void) | undefined;
    onSecretFileSelected?: ((file: globalThis.File) => void | Promise<void>) | undefined;
    onClearSecretFile?: (() => void) | undefined;
    onAvatarFileSelected?: ((file: globalThis.File) => void | Promise<void>) | undefined;
    onClearAvatar?: (() => void) | undefined;
    onDisplayNameInput?: ((value: string) => void) | undefined;
    onBioInput?: ((value: string) => void) | undefined;
    onRemoveIdentity?: (() => void) | undefined;
    onPublish?: (() => void | Promise<void>) | undefined;
    onJoin?: (() => void | Promise<void>) | undefined;
  }>();
  const dev = getDevContext();

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    onClose?.();
  }

  function handleAvatarChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    void onAvatarFileSelected?.(file);
  }

  function identityPillState(identity: ConfiguredIdentity): string {
    if (identity.id === currentVolumeChatIdentityId && joinedChatIdentityNeedsPublish) {
      return 'Joined · update pending';
    }
    if (identity.id === currentVolumeChatIdentityId) {
      return 'Joined';
    }
    if (identity.id === activeChatIdentityId && selectedChatIdentityNeedsPublish) {
      return 'Needs publish';
    }
    if (identity.publicKey) {
      return 'Published';
    }
    return 'Local';
  }
</script>

<div
  class="mount-dialog-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Manage identities"
  tabindex="-1"
  use:devSurface={{ enabled: $dev, name: 'IdentityManagerDialog' }}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="identity-manager-modal panel-surface" role="document" tabindex="-1">
    <div class="identity-row identity-manager-panel">
      <div class="identity-row-head">
        <div class="identity-row-title">
          <UserRound class="button-icon" size={15} strokeWidth={2} />
          <span>Identities</span>
        </div>
        <button type="button" class="dialog-close-btn identity-row-close" aria-label="Close identities" onclick={() => onClose?.()}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <div class="identity-manager-content">
        <div class="identity-chip-row">
          {#if configuredIdentities.length === 0}
            <button type="button" class="identity-pill add" onclick={() => onAddIdentity?.()}>
              <Plus size={14} strokeWidth={2} />
              <span>Add identity</span>
            </button>
          {:else}
            {#each configuredIdentities as identity (identity.id)}
              <button
                type="button"
                class="identity-pill"
                class:active={identity.id === activeChatIdentityId}
                onclick={() => onSelectIdentity?.(identity.id)}
              >
                <span class="identity-pill-name">{identity.displayName || 'Unnamed identity'}</span>
                <span class="identity-pill-state">{identityPillState(identity)}</span>
              </button>
            {/each}
            <button type="button" class="identity-pill add" onclick={() => onAddIdentity?.()}>
              <Plus size={14} strokeWidth={2} />
              <span>New</span>
            </button>
          {/if}
        </div>

        {#if selectedChatIdentityStatus}
          <div class={`identity-status-card ${selectedChatIdentityStatus.tone}`}>
            <p class="identity-status-title">{selectedChatIdentityStatus.title}</p>
            <p class="identity-status-detail">{selectedChatIdentityStatus.detail}</p>
          </div>
        {/if}

        {#if errorMessage}
          <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
        {:else if successMessage}
          <StatusNotice tone="success" compact={true} message={successMessage} />
        {/if}

        {#if selectedChatIdentity}
          <div class="identity-editor-panel">
            <div class="identity-editor-panel-wide">
              <SharedSecretEditor
                value={selectedChatIdentity.address}
                password={selectedChatIdentity.password}
                valueLabel="Identity secret"
                valueAriaLabel="Identity secret"
                valuePlaceholder="address or secret seed"
                passwordLabel="Password (optional)"
                passwordAriaLabel="Optional identity password"
                passwordPlaceholder="optional"
                hint="Use text, or attach a file to act as this identity secret."
                fileName={selectedChatIdentity.secretFileName}
                fileMimeType={selectedChatIdentity.secretFileMimeType}
                filePreviewUrl={selectedSecretPreviewUrl}
                fileIsImage={selectedSecretIsImage}
                onValueInput={onSecretValueInput}
                onPasswordInput={onSecretPasswordInput}
                onFileSelected={onSecretFileSelected}
                onClearFile={() => onClearSecretFile?.()}
              />
            </div>
            <label class="identity-editor-panel-wide">
              <span>Picture</span>
              <div class="identity-avatar-row">
                <div class="identity-avatar-preview">
                  {#if selectedChatIdentity.avatarDataUrl}
                    <img
                      class="identity-avatar-image"
                      src={selectedChatIdentity.avatarDataUrl}
                      alt={selectedChatIdentity.displayName || 'Identity avatar'}
                    />
                  {:else}
                    <span>{selectedAvatarLabel}</span>
                  {/if}
                </div>
                <div class="identity-avatar-actions">
                  <input
                    bind:this={identityAvatarFileInput}
                    hidden
                    type="file"
                    accept="image/*"
                    aria-label="Choose identity picture"
                    onchange={handleAvatarChange}
                  />
                  <button type="button" class="workspace-toggle" onclick={() => identityAvatarFileInput?.click()}>
                    <span>{selectedChatIdentity.avatarDataUrl ? 'Change picture' : 'Choose picture'}</span>
                  </button>
                  {#if selectedChatIdentity.avatarDataUrl}
                    <button type="button" class="workspace-toggle remove" onclick={() => onClearAvatar?.()}>
                      <span>Remove picture</span>
                    </button>
                  {/if}
                </div>
              </div>
            </label>
            <label>
              <span>Display name</span>
              <input
                type="text"
                value={selectedChatIdentity.displayName}
                oninput={(event) => onDisplayNameInput?.((event.currentTarget as HTMLInputElement).value)}
                placeholder="Ada"
              />
            </label>
            <label class="identity-editor-panel-wide">
              <span>Bio</span>
              <textarea
                rows="2"
                oninput={(event) => onBioInput?.((event.currentTarget as HTMLTextAreaElement).value)}
                placeholder="Who is speaking from this key?"
              >{selectedChatIdentity.bio}</textarea>
            </label>
            <div class="identity-editor-panel-actions">
              <button type="button" class="workspace-toggle remove" onclick={() => onRemoveIdentity?.()}>
                <Trash2 class="button-icon" size={15} strokeWidth={2} />
                <span>Remove</span>
              </button>
              <button type="button" class="workspace-toggle" onclick={() => onClose?.()}>
                <span>Done</span>
              </button>
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => void onPublish?.()}
                disabled={!activeHubAuth || isHistoryMode || identityManagerLoading}
              >
                <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                <span>
                  {identityManagerLoading && identityManagerAction === 'publish'
                    ? 'Publishing...'
                    : selectedChatIdentityNeedsPublish
                      ? 'Publish to hub'
                      : 'Published'}
                </span>
              </button>
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => void onJoin?.()}
                disabled={!activeHubAuth || isHistoryMode || identityManagerLoading}
              >
                <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                <span>
                  {identityManagerLoading && identityManagerAction === 'join'
                    ? 'Joining...'
                    : selectedChatIdentity.id === currentVolumeChatIdentityId
                      ? 'Joined to hub'
                      : selectedChatIdentityNeedsPublish
                        ? 'Publish and join'
                        : 'Join this hub'}
                </span>
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .panel-surface {
    animation: panel-fade-in 240ms ease;
  }

  @keyframes panel-fade-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .mount-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 235;
    display: grid;
    place-items: center;
    padding: 1rem;
    background:
      radial-gradient(circle at top, color-mix(in srgb, var(--nb-accent, #d27a54) 12%, transparent), transparent 55%),
      rgba(19, 18, 18, 0.26);
    backdrop-filter: blur(8px);
  }

  .identity-manager-modal {
    width: min(900px, calc(100vw - 2rem));
    max-height: min(88vh, 900px);
    overflow: auto;
    display: grid;
    gap: 0.9rem;
    padding: 0.96rem;
    border-radius: 22px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(210, 122, 84, 0.1));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(255, 248, 243, 0.94)), color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(247, 239, 233, 0.92))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, #d27a54) 10%, transparent), transparent 60%);
    box-shadow:
      0 30px 90px rgba(39, 24, 15, 0.22),
      0 10px 24px rgba(39, 24, 15, 0.12);
  }

  .identity-manager-panel,
  .identity-manager-content,
  .identity-editor-panel {
    display: grid;
    gap: 0.9rem;
  }

  .identity-row-head,
  .identity-row-title,
  .identity-avatar-row,
  .identity-avatar-actions,
  .identity-editor-panel-actions,
  .identity-chip-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .identity-row-head {
    justify-content: space-between;
  }

  .identity-row-title {
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-weight: 700;
  }

  .dialog-close-btn,
  .workspace-toggle,
  .identity-pill {
    appearance: none;
    font: inherit;
  }

  .dialog-close-btn {
    width: 34px;
    height: 34px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .identity-pill,
  .workspace-toggle {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(250, 245, 241, 0.92));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    border-radius: 999px;
    padding: 0.5rem 0.78rem;
    cursor: pointer;
  }

  .identity-pill.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 28%, var(--nb-border, rgba(60, 60, 67, 0.12)) 72%);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(255, 248, 243, 0.96));
  }

  .identity-pill.add,
  .workspace-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    justify-content: center;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .identity-pill-name,
  .identity-pill-state,
  .identity-status-title,
  .identity-status-detail {
    display: block;
  }

  .identity-pill-name {
    font-weight: 700;
  }

  .identity-pill-state {
    font-size: 0.72rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
  }

  .identity-status-card {
    padding: 0.78rem 0.86rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(245, 243, 240, 0.88));
  }

  .identity-status-card.warning {
    border-color: color-mix(in srgb, var(--nb-warning, #f59e0b) 30%, var(--nb-border, rgba(60, 60, 67, 0.12)) 70%);
  }

  .identity-status-card.success {
    border-color: color-mix(in srgb, var(--nb-success, #16a34a) 24%, var(--nb-border, rgba(60, 60, 67, 0.12)) 76%);
  }

  .identity-status-title,
  .identity-status-detail {
    margin: 0;
  }

  .identity-status-title {
    font-weight: 700;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
  }

  .identity-status-detail {
    margin-top: 0.18rem;
    font-size: 0.8rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
  }

  .identity-editor-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .identity-editor-panel label {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  .identity-editor-panel-wide {
    grid-column: 1 / -1;
  }

  .identity-editor-panel input,
  .identity-editor-panel textarea {
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(250, 245, 241, 0.92));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    padding: 0.68rem 0.78rem;
    font: inherit;
  }

  .identity-avatar-preview {
    width: 72px;
    height: 72px;
    border-radius: 20px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(245, 243, 240, 0.9));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, transparent);
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
    font-size: 0.76rem;
    font-weight: 600;
  }

  .identity-avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .identity-editor-panel-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }

  .workspace-toggle.remove {
    color: color-mix(in srgb, var(--nb-danger, #dc2626) 80%, var(--nb-text-main, rgba(28, 28, 30, 0.94)) 20%);
  }

  @media (max-width: 760px) {
    .identity-editor-panel {
      grid-template-columns: 1fr;
    }

    .identity-editor-panel-actions > .workspace-toggle {
      width: 100%;
    }
  }
</style>
