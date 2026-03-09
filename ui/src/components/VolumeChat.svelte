<script lang="ts">
  import {
    listChat,
    publishIdentity,
    sendChatMessage,
    type Auth,
    type ChatAttachment,
    type IdentityProfile,
    type VolumeChatState,
  } from '../lib/api.js';
  import {
    buildIdentitySecret,
    type ConfiguredIdentity,
  } from '../lib/chatIdentities.js';
  import { NEARBYTES_DRAG_TYPE } from '../lib/nearbytesDrag.js';
  import {
    createChatAttachmentFromSourceBundle,
    exportSourceReferenceBundleFromDrag,
    parseSourceReferenceBundleText,
  } from '../lib/nearbytesReferenceTransfer.js';
  import {
    MessageSquareText,
    Paperclip,
    Send,
    X,
  } from 'lucide-svelte';

  let {
    auth = null,
    volumeId = null,
    readonlyMode = false,
    historyState = null,
    activeIdentity = null,
    identityNeedsPublish = false,
    onOpenIdentityManager = undefined,
    onEnsureIdentityPublished = undefined,
    onPreviewAttachment = undefined,
    onChatMutated = undefined,
    externalRefreshVersion = 0,
  } = $props<{
    auth: Auth | null;
    volumeId: string | null;
    readonlyMode?: boolean;
    historyState?: VolumeChatState | null;
    activeIdentity?: ConfiguredIdentity | null;
    identityNeedsPublish?: boolean;
    onOpenIdentityManager?: (() => void) | undefined;
    onEnsureIdentityPublished?: ((identity: ConfiguredIdentity) => Promise<boolean>) | undefined;
    onPreviewAttachment?: ((attachment: ChatAttachment) => void) | undefined;
    onChatMutated?: (() => Promise<void> | void) | undefined;
    externalRefreshVersion?: number;
  }>();

  let chatState = $state<VolumeChatState>({ identities: [], messages: [] });
  let draftBody = $state('');
  let pendingAttachment = $state<ChatAttachment | null>(null);
  let loading = $state(false);
  let sending = $state(false);
  let errorMessage = $state('');
  let dragActive = $state(false);
  let selectedProfilePublicKey = $state('');
  let requestedVolumeId = '';
  let appliedExternalRefreshVersion = -1;

  $effect(() => {
    const nextVolumeId = volumeId ?? '';
    if (!auth || nextVolumeId === '') {
      chatState = { identities: [], messages: [] };
      requestedVolumeId = '';
      loading = false;
      errorMessage = '';
      selectedProfilePublicKey = '';
      return;
    }
    if (requestedVolumeId === nextVolumeId) {
      return;
    }
    requestedVolumeId = nextVolumeId;
    selectedProfilePublicKey = '';
    void refreshChat(true);
  });

  const effectiveChatState = $derived.by(() => historyState ?? chatState);

  const identityByPublicKey = $derived.by(() => {
    const map = new Map<string, VolumeChatState['identities'][number]>();
    for (const identity of effectiveChatState.identities) {
      map.set(identity.authorPublicKey, identity);
    }
    return map;
  });

  const selectedProfile = $derived.by(() => {
    if (!selectedProfilePublicKey) {
      return null;
    }
    const published = identityByPublicKey.get(selectedProfilePublicKey);
    if (published) {
      return {
        displayName: published.record.profile.displayName,
        bio: published.record.profile.bio ?? '',
        publicKey: published.authorPublicKey,
        publishedAt: published.publishedAt,
        localOnly: false,
      };
    }
    if (activeIdentity?.publicKey === selectedProfilePublicKey) {
      return {
        displayName: activeIdentity.displayName || shortPublicKey(selectedProfilePublicKey),
        bio: activeIdentity.bio,
        publicKey: selectedProfilePublicKey,
        publishedAt: undefined,
        localOnly: true,
      };
    }
    return {
      displayName: shortPublicKey(selectedProfilePublicKey),
      bio: '',
      publicKey: selectedProfilePublicKey,
      publishedAt: undefined,
      localOnly: true,
    };
  });

  $effect(() => {
    if (!auth || !volumeId || historyState) {
      appliedExternalRefreshVersion = externalRefreshVersion;
      return;
    }
    if (appliedExternalRefreshVersion === externalRefreshVersion) {
      return;
    }
    const nextVersion = externalRefreshVersion;
    appliedExternalRefreshVersion = nextVersion;
    if (nextVersion === 0) {
      return;
    }
    void refreshChat();
  });

  async function refreshChat(initial = false) {
    if (!auth || !volumeId) {
      return;
    }
    if (initial) {
      loading = true;
    }
    try {
      errorMessage = '';
      chatState = await listChat(auth);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load chat';
    } finally {
      loading = false;
    }
  }

  async function handleSendMessage() {
    if (!auth || readonlyMode || sending) {
      return;
    }
    if (!activeIdentity) {
      errorMessage = 'Join this space with one identity before sending.';
      onOpenIdentityManager?.();
      return;
    }
    if (buildIdentitySecret(activeIdentity).trim() === '') {
      errorMessage = 'The joined identity is incomplete. Open identities and join again.';
      onOpenIdentityManager?.();
      return;
    }
    const body = draftBody.trim();
    if (body === '' && !pendingAttachment) {
      return;
    }

    sending = true;
    try {
      errorMessage = '';
      if (identityNeedsPublish) {
        const publishSucceeded = onEnsureIdentityPublished
          ? await onEnsureIdentityPublished(activeIdentity)
          : await publishIdentityFromChat(activeIdentity);
        if (!publishSucceeded) {
          errorMessage = 'The current profile could not be published to this space.';
          return;
        }
      }
      await sendChatMessage(auth, buildIdentitySecret(activeIdentity), {
        body: body === '' ? undefined : body,
        attachment: pendingAttachment ?? undefined,
      });
      draftBody = '';
      pendingAttachment = null;
      await refreshChat();
      await onChatMutated?.();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to send message';
    } finally {
      sending = false;
    }
  }

  async function publishIdentityFromChat(identity: ConfiguredIdentity): Promise<boolean> {
    if (!auth) {
      return false;
    }
    const displayName = identity.displayName.trim();
    if (displayName === '') {
      return false;
    }
    const publishedProfile = identityByPublicKey.get(identity.publicKey)?.record.profile;
    const profile: IdentityProfile = {
      displayName,
      bio: identity.bio.trim() || undefined,
    };
    if (
      publishedProfile &&
      publishedProfile.displayName === profile.displayName &&
      (publishedProfile.bio ?? '') === (profile.bio ?? '')
    ) {
      return true;
    }
    await publishIdentity(auth, buildIdentitySecret(identity), profile);
    return true;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
    if (readonlyMode) {
      return;
    }
    if (!event.dataTransfer || !event.dataTransfer.types.includes(NEARBYTES_DRAG_TYPE)) {
      return;
    }
    try {
      event.stopPropagation();
      if (!auth) {
        return;
      }
      errorMessage = '';
      const bundle = await exportSourceReferenceBundleFromDrag(
        auth,
        event.dataTransfer.getData(NEARBYTES_DRAG_TYPE)
      );
      const { attachment, truncated } = createChatAttachmentFromSourceBundle(bundle);
      pendingAttachment = attachment;
      if (truncated) {
        errorMessage =
          'Attached the first dragged file. Chat messages currently support one file reference at a time.';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to attach dragged file';
    }
  }

  function attachSourceReferenceFromClipboardText(payloadText: string): boolean {
    const bundle = parseSourceReferenceBundleText(payloadText);
    if (!bundle) {
      return false;
    }
    try {
      const { attachment, truncated } = createChatAttachmentFromSourceBundle(bundle);
      pendingAttachment = attachment;
      errorMessage = truncated
        ? `Attached ${attachment.name}. Chat messages currently support one file reference at a time.`
        : '';
      return true;
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : 'Clipboard does not contain any Nearbytes file references.';
      return true;
    }
  }

  function handleComposerPaste(event: ClipboardEvent) {
    if (readonlyMode) {
      return;
    }
    const payloadText = event.clipboardData?.getData('text/plain') ?? '';
    if (!attachSourceReferenceFromClipboardText(payloadText)) {
      return;
    }
    event.preventDefault();
  }

  async function openAttachment(attachment: ChatAttachment) {
    if (onPreviewAttachment) {
      onPreviewAttachment(attachment);
      return;
    }
  }

  function senderLabel(publicKey: string): string {
    const publishedIdentity = identityByPublicKey.get(publicKey);
    if (publishedIdentity) {
      return publishedIdentity.record.profile.displayName;
    }
    if (activeIdentity?.publicKey === publicKey) {
      return activeIdentity.displayName || shortPublicKey(publicKey);
    }
    return shortPublicKey(publicKey);
  }

  function shortPublicKey(value: string): string {
    return value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
  }

  function isOwnMessage(publicKey: string): boolean {
    return activeIdentity?.publicKey === publicKey;
  }

  function openProfile(publicKey: string) {
    selectedProfilePublicKey =
      selectedProfilePublicKey === publicKey ? '' : publicKey;
  }

  function closeProfile() {
    selectedProfilePublicKey = '';
  }

  function formatTimestamp(value: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  }
</script>

<div class="chat-shell panel-surface">
  <div class="chat-header">
    <div class="chat-title-wrap">
      <div class="chat-title-mark">
        <MessageSquareText size={16} strokeWidth={2} />
      </div>
      <div>
        <h3>Chat</h3>
        <p class="chat-subtitle">
          {#if readonlyMode}
            Timeline view
          {:else if activeIdentity?.displayName}
            Joined as {activeIdentity.displayName}
          {:else}
            Choose one identity to speak
          {/if}
        </p>
      </div>
    </div>
    <div class="chat-header-actions">
      {#if identityNeedsPublish && activeIdentity}
        <span
          class="chat-status-pill"
          title="Your local profile changed, but the updated public identity record has not been published to this space yet."
        >
          Profile unpublished
        </span>
      {/if}
      {#if !readonlyMode}
        <button type="button" class="chat-secondary-btn" onclick={() => onOpenIdentityManager?.()}>
          {activeIdentity ? 'Change' : 'Join'}
        </button>
      {/if}
    </div>
  </div>

  {#if selectedProfile}
    <section class="chat-profile-popover panel-surface" aria-label="Profile details">
      <div class="chat-profile-head">
        <div class="chat-profile-avatar">{selectedProfile.displayName.charAt(0).toUpperCase() || '?'}</div>
        <div class="chat-profile-copy">
          <p class="chat-eyebrow">Profile</p>
          <h4>{selectedProfile.displayName}</h4>
        </div>
        <button type="button" class="chat-icon-btn compact" onclick={closeProfile} aria-label="Close profile">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <p class="chat-profile-bio">
        {selectedProfile.bio || 'No bio published for this identity yet.'}
      </p>
      <dl class="chat-profile-meta">
        <div>
          <dt>Identity</dt>
          <dd>{shortPublicKey(selectedProfile.publicKey)}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{selectedProfile.localOnly ? 'Local draft' : 'Published to this space'}</dd>
        </div>
        {#if selectedProfile.publishedAt}
          <div>
            <dt>Published</dt>
            <dd>{formatTimestamp(selectedProfile.publishedAt)}</dd>
          </div>
        {/if}
      </dl>
    </section>
  {/if}

  {#if errorMessage}
    <p class="chat-banner error">{errorMessage}</p>
  {/if}

  <div class="chat-layout">
    <section class="chat-feed">
      {#if loading && !historyState}
        <p class="chat-empty">Loading chat…</p>
      {:else if effectiveChatState.messages.length === 0}
        <p class="chat-empty">
          {#if readonlyMode}
            No messages at this point in history.
          {:else}
            No messages yet. Join this space and start the conversation.
          {/if}
        </p>
      {:else}
      {#each effectiveChatState.messages as entry (entry.eventHash)}
        <article class="chat-message-card" class:own={isOwnMessage(entry.authorPublicKey)}>
          <div class="chat-message-bubble">
            <header class="chat-message-head">
              <button
                type="button"
                class="chat-author-btn"
                onclick={() => openProfile(entry.authorPublicKey)}
                title="View profile"
              >
                {senderLabel(entry.authorPublicKey)}
              </button>
              <span>{formatTimestamp(entry.publishedAt)}</span>
            </header>
              {#if entry.message.body}
                <p class="chat-message-body">{entry.message.body}</p>
              {/if}
              {#if entry.message.attachment}
                <button
                  type="button"
                  class="chat-attachment"
                  ondblclick={() => void openAttachment(entry.message.attachment!)}
                  title="Double-click to preview attachment"
                >
                  <Paperclip size={13} strokeWidth={2} />
                  <span>{entry.message.attachment.name}</span>
                </button>
              {/if}
            </div>
          </article>
        {/each}
      {/if}
    </section>

    <section
      class="chat-composer"
      class:drag-active={dragActive}
      role="group"
      aria-label="Chat composer"
      onpaste={handleComposerPaste}
      ondragenter={(event) => {
        if (event.dataTransfer?.types.includes(NEARBYTES_DRAG_TYPE)) {
          event.preventDefault();
          dragActive = true;
        }
      }}
      ondragover={(event) => {
        if (event.dataTransfer?.types.includes(NEARBYTES_DRAG_TYPE)) {
          event.preventDefault();
          dragActive = true;
        }
      }}
      ondragleave={(event) => {
        if (event.currentTarget === event.target) {
          dragActive = false;
        }
      }}
      ondrop={(event) => void handleDrop(event)}
    >
      <div class="chat-composer-head">
        <p class="chat-composer-meta">
          {readonlyMode
            ? 'History mode'
            : activeIdentity?.displayName
              ? `Writing as ${activeIdentity.displayName}`
              : 'Join this space to send messages'}
        </p>
      </div>
      <textarea
        class="chat-textarea"
        placeholder={activeIdentity ? 'Message' : 'Join this space with one identity to send'}
        bind:value={draftBody}
        disabled={!auth || readonlyMode || !activeIdentity}
      ></textarea>
      {#if pendingAttachment}
        <div class="chat-pending-attachment">
          <Paperclip size={13} strokeWidth={2} />
          <span>{pendingAttachment.name}</span>
          <button type="button" class="chat-icon-btn compact" onclick={() => (pendingAttachment = null)} aria-label="Remove attachment">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      {/if}
      <div class="chat-composer-actions">
        <p class="chat-drop-hint">Drag or paste a Nearbytes file reference.</p>
        <button
          type="button"
          class="chat-primary-btn"
          onclick={() => void handleSendMessage()}
          disabled={
            !auth ||
            !activeIdentity ||
            readonlyMode ||
            sending ||
            (!draftBody.trim() && !pendingAttachment)
          }
        >
          <Send size={13} strokeWidth={2} />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  </div>
</div>

<style>
  .chat-shell {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    overflow: hidden;
    position: relative;
    border: 1px solid rgba(56, 189, 248, 0.16);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(9, 20, 39, 0.96), rgba(8, 18, 35, 0.9));
  }

  .chat-header,
  .chat-composer-head,
  .chat-message-head,
  .chat-composer-actions,
  .chat-profile-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .chat-title-wrap,
  .chat-header-actions,
  .chat-pending-attachment,
  .chat-attachment {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
  }

  .chat-header {
    padding: 0.95rem 1rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.18);
    background:
      radial-gradient(120% 120% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 46%),
      rgba(8, 18, 35, 0.72);
  }

  .chat-title-mark {
    width: 32px;
    height: 32px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 20% 20%, rgba(125, 211, 252, 0.3), rgba(8, 47, 73, 0.94));
    color: rgba(224, 242, 254, 0.96);
    flex: 0 0 auto;
  }

  .chat-subtitle {
    margin-top: 0.16rem;
    font-size: 0.76rem;
    color: rgba(186, 230, 253, 0.64);
  }

  .chat-shell h3,
  .chat-shell p {
    margin: 0;
  }

  .chat-shell h3 {
    font-size: 0.96rem;
    line-height: 1.2;
  }

  .chat-header-actions,
  .chat-composer-actions {
    flex-wrap: wrap;
  }

  .chat-primary-btn,
  .chat-secondary-btn,
  .chat-icon-btn,
  .chat-attachment {
    appearance: none;
    border: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(8, 20, 38, 0.82);
    color: rgba(224, 242, 254, 0.94);
    border-radius: 11px;
    min-height: 32px;
    padding: 0.42rem 0.72rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
  }

  .chat-primary-btn:hover:not(:disabled),
  .chat-secondary-btn:hover:not(:disabled),
  .chat-icon-btn:hover:not(:disabled),
  .chat-attachment:hover {
    border-color: rgba(96, 165, 250, 0.34);
    background: rgba(12, 28, 48, 0.96);
    transform: translateY(-1px);
  }

  .chat-icon-btn {
    min-width: 34px;
    padding: 0;
    justify-content: center;
  }

  .chat-icon-btn.compact {
    min-height: 28px;
    min-width: 28px;
  }

  .chat-primary-btn {
    background: linear-gradient(180deg, rgba(15, 61, 81, 0.96), rgba(10, 39, 57, 0.94));
    border-color: rgba(34, 211, 238, 0.32);
  }

  .chat-status-pill,
  .chat-banner {
    border-radius: 999px;
    padding: 0.28rem 0.62rem;
    font-size: 0.72rem;
  }

  .chat-status-pill {
    background: rgba(125, 211, 252, 0.12);
    color: rgba(186, 230, 253, 0.9);
  }

  .chat-banner {
    align-self: flex-start;
    margin: 0.72rem 1rem 0;
  }

  .chat-banner.error {
    background: rgba(127, 29, 29, 0.22);
    color: rgba(252, 165, 165, 0.96);
  }

  .chat-layout {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 0;
  }

  .chat-feed {
    min-height: 0;
    overflow: auto;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.48rem;
  }

  .chat-empty {
    color: rgba(191, 219, 254, 0.66);
    padding: 0.6rem 0.1rem;
    font-size: 0.82rem;
  }

  .chat-message-card {
    display: flex;
    max-width: min(78%, 620px);
  }

  .chat-message-card.own {
    align-self: flex-end;
  }

  .chat-message-bubble {
    min-width: 0;
    padding: 0.58rem 0.72rem;
    border-radius: 14px;
    background: rgba(9, 24, 42, 0.86);
    border: 1px solid rgba(56, 189, 248, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.34rem;
  }

  .chat-message-card.own .chat-message-bubble {
    background: linear-gradient(180deg, rgba(13, 43, 67, 0.94), rgba(9, 30, 50, 0.96));
    border-color: rgba(34, 211, 238, 0.16);
  }

  .chat-message-head {
    color: rgba(186, 230, 253, 0.76);
    font-size: 0.7rem;
    gap: 0.65rem;
  }

  .chat-author-btn {
    appearance: none;
    border: 0;
    background: transparent;
    color: rgba(224, 242, 254, 0.96);
    padding: 0;
    font: inherit;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }

  .chat-author-btn:hover {
    color: rgba(186, 230, 253, 0.96);
  }

  .chat-message-body {
    color: rgba(239, 246, 255, 0.94);
    line-height: 1.42;
    white-space: pre-wrap;
    font-size: 0.84rem;
  }

  .chat-composer {
    border-top: 1px solid rgba(102, 126, 234, 0.16);
    background:
      radial-gradient(120% 120% at 0% 100%, rgba(34, 211, 238, 0.06), transparent 44%),
      rgba(8, 18, 35, 0.74);
    padding: 0.82rem 1rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.56rem;
    overflow: visible;
  }

  .chat-composer.drag-active {
    border-color: rgba(34, 211, 238, 0.3);
    box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.12);
  }

  .chat-textarea,
  .chat-composer textarea {
    width: 100%;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.14);
    background: rgba(4, 15, 28, 0.88);
    color: rgba(239, 246, 255, 0.94);
    font: inherit;
    padding: 0.75rem 0.82rem;
  }

  .chat-textarea {
    min-height: 78px;
    resize: vertical;
  }

  .chat-drop-hint {
    color: rgba(147, 197, 253, 0.66);
    font-size: 0.74rem;
  }

  .chat-pending-attachment {
    padding: 0.44rem 0.65rem;
    border-radius: 12px;
    background: rgba(8, 20, 38, 0.86);
    border: 1px solid rgba(56, 189, 248, 0.14);
    justify-content: space-between;
    font-size: 0.82rem;
  }

  .chat-composer-meta {
    color: rgba(191, 219, 254, 0.7);
    font-size: 0.74rem;
  }

  .chat-composer-actions {
    align-items: center;
  }

  .chat-composer-actions .chat-drop-hint {
    margin-right: auto;
  }

  .chat-profile-popover {
    position: absolute;
    top: 3.6rem;
    right: 0.82rem;
    width: min(320px, calc(100% - 1.64rem));
    z-index: 3;
    padding: 0.82rem;
    border-radius: 18px;
    border: 1px solid rgba(56, 189, 248, 0.16);
    background:
      radial-gradient(120% 120% at 0% 0%, rgba(34, 211, 238, 0.1), transparent 44%),
      linear-gradient(180deg, rgba(8, 19, 36, 0.98), rgba(6, 15, 29, 0.96));
    box-shadow: 0 18px 42px rgba(2, 6, 23, 0.42);
  }

  .chat-profile-avatar {
    width: 34px;
    height: 34px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.94), rgba(10, 44, 66, 0.96));
    color: rgba(236, 254, 255, 0.98);
    font-weight: 700;
    flex: 0 0 auto;
  }

  .chat-profile-copy {
    min-width: 0;
    flex: 1 1 auto;
  }

  .chat-profile-bio {
    margin-top: 0.72rem;
    color: rgba(226, 232, 240, 0.88);
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .chat-profile-meta {
    margin: 0.82rem 0 0;
    display: grid;
    gap: 0.55rem;
  }

  .chat-profile-meta div {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 0.55rem;
    align-items: baseline;
  }

  .chat-profile-meta dt {
    color: rgba(125, 211, 252, 0.66);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .chat-profile-meta dd {
    margin: 0;
    color: rgba(224, 242, 254, 0.92);
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }
</style>
