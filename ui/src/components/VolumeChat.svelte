<script lang="ts">
  import { onMount } from 'svelte';
  import {
    downloadFile,
    exportSourceReferences,
    listChat,
    publishIdentity,
    sendChatMessage,
    type Auth,
    type ChatAttachment,
    type PublishedIdentity,
    type VolumeChatState,
  } from '../lib/api.js';
  import {
    buildIdentitySecret,
    createConfiguredIdentity,
    loadActiveIdentityId,
    loadConfiguredIdentities,
    persistActiveIdentityId,
    persistConfiguredIdentities,
    type ConfiguredIdentity,
  } from '../lib/chatIdentities.js';
  import { NEARBYTES_DRAG_TYPE, parseNearbytesDragPayload } from '../lib/nearbytesDrag.js';
  import {
    Check,
    ChevronDown,
    MessageSquareText,
    Paperclip,
    Plus,
    RefreshCw,
    Send,
    UserRound,
    X,
  } from 'lucide-svelte';

  let {
    auth = null,
    volumeId = null,
    readonlyMode = false,
    historyState = null,
  } = $props<{
    auth: Auth | null;
    volumeId: string | null;
    readonlyMode?: boolean;
    historyState?: VolumeChatState | null;
  }>();

  let chatState = $state<VolumeChatState>({ identities: [], messages: [] });
  let identities = $state<ConfiguredIdentity[]>([]);
  let activeIdentityId = $state('');
  let manageOpen = $state(false);
  let draftBody = $state('');
  let pendingAttachment = $state<ChatAttachment | null>(null);
  let loading = $state(false);
  let refreshing = $state(false);
  let sending = $state(false);
  let publishing = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let dragActive = $state(false);
  let hydrated = false;
  let requestedVolumeId = '';

  onMount(() => {
    identities = loadConfiguredIdentities();
    activeIdentityId = loadActiveIdentityId();
    hydrated = true;
  });

  $effect(() => {
    if (!hydrated) {
      return;
    }
    persistConfiguredIdentities(identities);
  });

  $effect(() => {
    if (!hydrated) {
      return;
    }
    persistActiveIdentityId(activeIdentityId);
  });

  $effect(() => {
    if (identities.length === 0) {
      if (activeIdentityId !== '') {
        activeIdentityId = '';
      }
      return;
    }
    if (identities.some((identity) => identity.id === activeIdentityId)) {
      return;
    }
    activeIdentityId = identities[0].id;
  });

  $effect(() => {
    const nextVolumeId = volumeId ?? '';
    if (!auth || nextVolumeId === '') {
      chatState = { identities: [], messages: [] };
      requestedVolumeId = '';
      loading = false;
      refreshing = false;
      successMessage = '';
      errorMessage = '';
      return;
    }
    if (requestedVolumeId === nextVolumeId) {
      return;
    }
    requestedVolumeId = nextVolumeId;
    void refreshChat(true);
  });

  const activeIdentity = $derived.by(
    () => identities.find((identity) => identity.id === activeIdentityId) ?? null
  );

  const effectiveChatState = $derived.by(() => historyState ?? chatState);

  const identityByPublicKey = $derived.by(() => {
    const map = new Map<string, PublishedIdentity>();
    for (const identity of effectiveChatState.identities) {
      map.set(identity.authorPublicKey, identity);
    }
    return map;
  });

  const activePublishedIdentity = $derived.by(() => {
    if (!activeIdentity?.publicKey) {
      return null;
    }
    return identityByPublicKey.get(activeIdentity.publicKey) ?? null;
  });

  const identityNeedsPublish = $derived.by(() => {
    if (!activeIdentity) {
      return false;
    }
    if (!activeIdentity.publicKey || !activePublishedIdentity) {
      return true;
    }
    return (
      activePublishedIdentity.record.profile.displayName !== activeIdentity.displayName.trim() ||
      (activePublishedIdentity.record.profile.bio ?? '') !== activeIdentity.bio.trim()
    );
  });

  function addIdentity() {
    const next = createConfiguredIdentity();
    identities = [...identities, next];
    activeIdentityId = next.id;
    manageOpen = true;
  }

  function removeIdentity(identityId: string) {
    identities = identities.filter((identity) => identity.id !== identityId);
    if (activeIdentityId === identityId) {
      activeIdentityId = identities.find((identity) => identity.id !== identityId)?.id ?? '';
    }
  }

  function updateIdentity(identityId: string, patch: Partial<ConfiguredIdentity>) {
    identities = identities.map((identity) =>
      identity.id === identityId
        ? createConfiguredIdentity({
            ...identity,
            ...patch,
            publicKey:
              patch.address !== undefined || patch.password !== undefined
                ? undefined
                : patch.publicKey ?? identity.publicKey,
          })
        : identity
    );
  }

  async function refreshChat(initial = false) {
    if (!auth || !volumeId) {
      return;
    }
    if (initial) {
      loading = true;
    } else {
      refreshing = true;
    }
    try {
      errorMessage = '';
      chatState = await listChat(auth);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load chat';
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function ensurePublishedIdentity(): Promise<ConfiguredIdentity | null> {
    if (!auth || !activeIdentity) {
      errorMessage = 'Choose an identity first.';
      return null;
    }
    if (activeIdentity.address.trim() === '') {
      errorMessage = 'Identity secret is required.';
      manageOpen = true;
      return null;
    }
    if (activeIdentity.displayName.trim() === '') {
      errorMessage = 'Display name is required before publishing.';
      manageOpen = true;
      return null;
    }
    if (!identityNeedsPublish && activeIdentity.publicKey) {
      return activeIdentity;
    }

    publishing = true;
    try {
      errorMessage = '';
      const published = await publishIdentity(auth, buildIdentitySecret(activeIdentity), {
        displayName: activeIdentity.displayName.trim(),
        bio: activeIdentity.bio.trim() || undefined,
      });
      updateIdentity(activeIdentity.id, { publicKey: published.published.authorPublicKey });
      await refreshChat();
      successMessage = `Published identity ${activeIdentity.displayName.trim()}.`;
      return {
        ...activeIdentity,
        publicKey: published.published.authorPublicKey,
      };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to publish identity';
      return null;
    } finally {
      publishing = false;
    }
  }

  async function handleSendMessage() {
    if (!auth || readonlyMode || sending) {
      return;
    }
    const body = draftBody.trim();
    if (body === '' && !pendingAttachment) {
      return;
    }
    const publishedIdentity = await ensurePublishedIdentity();
    if (!publishedIdentity) {
      return;
    }

    sending = true;
    try {
      errorMessage = '';
      await sendChatMessage(auth, buildIdentitySecret(publishedIdentity), {
        body: body === '' ? undefined : body,
        attachment: pendingAttachment ?? undefined,
      });
      draftBody = '';
      pendingAttachment = null;
      await refreshChat();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to send message';
    } finally {
      sending = false;
    }
  }

  async function attachDraggedFile(payloadText: string) {
    if (!auth) {
      return;
    }
    const payload = parseNearbytesDragPayload(payloadText);
    if (!payload) {
      return;
    }
    const exported = await exportSourceReferences(auth, [payload.filename]);
    const item = exported.bundle.items[0];
    if (!item) {
      throw new Error('Dragged file could not be exported as a reference.');
    }
    pendingAttachment = {
      kind: 'nb.src.ref.v1',
      name: item.name,
      mime: item.mime,
      createdAt: item.createdAt,
      ref: item.ref,
    };
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
    if (!event.dataTransfer || !event.dataTransfer.types.includes(NEARBYTES_DRAG_TYPE)) {
      return;
    }
    try {
      errorMessage = '';
      await attachDraggedFile(event.dataTransfer.getData(NEARBYTES_DRAG_TYPE));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to attach dragged file';
    }
  }

  async function openAttachment(attachment: ChatAttachment) {
    if (!auth) {
      return;
    }
    try {
      errorMessage = '';
      const blob = await downloadFile(auth, attachment.ref.c.h);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to open attachment';
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
        <MessageSquareText size={18} strokeWidth={2} />
      </div>
      <div>
        <p class="chat-eyebrow">Volume chat</p>
        <h3>Signed messages in this volume</h3>
      </div>
    </div>
    <div class="chat-header-actions">
      <button
        type="button"
        class="chat-icon-btn"
        onclick={() => void refreshChat()}
        disabled={!auth || refreshing || readonlyMode}
      >
        <RefreshCw size={15} strokeWidth={2} />
      </button>
      <button type="button" class="chat-select-btn" onclick={() => (manageOpen = !manageOpen)}>
        <UserRound size={15} strokeWidth={2} />
        <span>{activeIdentity?.displayName || 'Choose identity'}</span>
        <ChevronDown size={14} strokeWidth={2} />
      </button>
    </div>
  </div>

  {#if manageOpen}
    <section class="identity-panel">
      <div class="identity-panel-list">
        {#if identities.length === 0}
          <p class="identity-empty">No configured identities yet.</p>
        {:else}
          {#each identities as identity (identity.id)}
            <button
              type="button"
              class="identity-chip"
              class:active={identity.id === activeIdentityId}
              onclick={() => (activeIdentityId = identity.id)}
            >
              <div>
                <strong>{identity.displayName || 'Unnamed identity'}</strong>
                <span>{identity.address || 'Secret pending'}</span>
              </div>
              {#if identity.publicKey}
                <Check size={14} strokeWidth={2} />
              {/if}
            </button>
          {/each}
        {/if}
        <button type="button" class="identity-add-btn" onclick={addIdentity}>
          <Plus size={14} strokeWidth={2} />
          Add identity
        </button>
      </div>

      {#if activeIdentity}
        <div class="identity-editor">
          <label>
            <span>Identity secret</span>
            <input
              type="text"
              value={activeIdentity.address}
              oninput={(event) => updateIdentity(activeIdentity.id, { address: (event.currentTarget as HTMLInputElement).value })}
              placeholder="address or secret seed"
            />
          </label>
          <label>
            <span>Password (optional)</span>
            <input
              type="password"
              value={activeIdentity.password}
              oninput={(event) => updateIdentity(activeIdentity.id, { password: (event.currentTarget as HTMLInputElement).value })}
              placeholder="optional"
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              type="text"
              value={activeIdentity.displayName}
              oninput={(event) => updateIdentity(activeIdentity.id, { displayName: (event.currentTarget as HTMLInputElement).value })}
              placeholder="Ada"
            />
          </label>
          <label>
            <span>Bio</span>
            <textarea
              rows="3"
              oninput={(event) => updateIdentity(activeIdentity.id, { bio: (event.currentTarget as HTMLTextAreaElement).value })}
              placeholder="Who is speaking from this key?"
            >{activeIdentity.bio}</textarea>
          </label>
          <div class="identity-editor-actions">
            <button type="button" class="chat-secondary-btn" onclick={() => removeIdentity(activeIdentity.id)}>
              Remove
            </button>
            <button
              type="button"
              class="chat-primary-btn"
              onclick={() => void ensurePublishedIdentity()}
              disabled={!auth || publishing || readonlyMode}
            >
              {publishing ? 'Publishing…' : identityNeedsPublish ? 'Publish identity' : 'Published'}
            </button>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if errorMessage}
    <p class="chat-banner error">{errorMessage}</p>
  {:else if successMessage}
    <p class="chat-banner success">{successMessage}</p>
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
            No messages yet. Publish an identity and start the conversation.
          {/if}
        </p>
      {:else}
        {#each effectiveChatState.messages as entry (entry.eventHash)}
          <article class="chat-message-card">
            <header class="chat-message-head">
              <strong>{senderLabel(entry.authorPublicKey)}</strong>
              <span>{formatTimestamp(entry.publishedAt)}</span>
            </header>
            {#if entry.message.body}
              <p class="chat-message-body">{entry.message.body}</p>
            {/if}
            {#if entry.message.attachment}
              <button
                type="button"
                class="chat-attachment"
                onclick={() => void openAttachment(entry.message.attachment!)}
                title="Open attachment"
              >
                <Paperclip size={14} strokeWidth={2} />
                <span>{entry.message.attachment.name}</span>
              </button>
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    <section
      class="chat-composer"
      class:drag-active={dragActive}
      role="group"
      aria-label="Chat composer"
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
        <div>
          <p class="chat-eyebrow">Compose</p>
          <h4>{readonlyMode ? 'Read-only right now' : activeIdentity?.displayName || 'Pick an identity to send'}</h4>
        </div>
        {#if identityNeedsPublish && activeIdentity}
          <span class="chat-status-pill">Publish identity to send</span>
        {/if}
      </div>
      <textarea
        class="chat-textarea"
        placeholder="Write a short signed message"
        bind:value={draftBody}
        disabled={!auth || readonlyMode}
      ></textarea>
      {#if pendingAttachment}
        <div class="chat-pending-attachment">
          <Paperclip size={14} strokeWidth={2} />
          <span>{pendingAttachment.name}</span>
          <button type="button" class="chat-icon-btn" onclick={() => (pendingAttachment = null)}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      {/if}
      <p class="chat-drop-hint">Drag a Nearbytes file here to attach it as a signed source reference.</p>
      <div class="chat-composer-actions">
        <button
          type="button"
          class="chat-secondary-btn"
          onclick={() => void refreshChat()}
          disabled={!auth || refreshing || readonlyMode}
        >
          Refresh
        </button>
        <button
          type="button"
          class="chat-primary-btn"
          onclick={() => void handleSendMessage()}
          disabled={!auth || readonlyMode || sending || (!draftBody.trim() && !pendingAttachment)}
        >
          <Send size={14} strokeWidth={2} />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  </div>
</div>

<style>
  .chat-shell {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    overflow: hidden;
  }

  .chat-header,
  .chat-composer-head,
  .chat-message-head,
  .chat-composer-actions,
  .identity-editor-actions {
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
    gap: 0.6rem;
  }

  .chat-title-mark {
    width: 38px;
    height: 38px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 20% 20%, rgba(125, 211, 252, 0.3), rgba(8, 47, 73, 0.94));
    color: rgba(224, 242, 254, 0.96);
  }

  .chat-eyebrow {
    margin: 0 0 0.18rem;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(125, 211, 252, 0.68);
  }

  .chat-shell h3,
  .chat-shell h4,
  .chat-shell strong,
  .chat-shell p {
    margin: 0;
  }

  .chat-header-actions,
  .identity-editor-actions,
  .chat-composer-actions {
    flex-wrap: wrap;
  }

  .chat-select-btn,
  .chat-primary-btn,
  .chat-secondary-btn,
  .chat-icon-btn,
  .identity-add-btn,
  .identity-chip,
  .chat-attachment {
    appearance: none;
    border: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(8, 20, 38, 0.82);
    color: rgba(224, 242, 254, 0.94);
    border-radius: 14px;
    min-height: 38px;
    padding: 0.65rem 0.9rem;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
  }

  .chat-select-btn:hover,
  .chat-primary-btn:hover,
  .chat-secondary-btn:hover,
  .chat-icon-btn:hover,
  .identity-add-btn:hover,
  .identity-chip:hover,
  .chat-attachment:hover {
    border-color: rgba(96, 165, 250, 0.34);
    background: rgba(12, 28, 48, 0.96);
    transform: translateY(-1px);
  }

  .chat-primary-btn {
    background: linear-gradient(180deg, rgba(15, 61, 81, 0.96), rgba(10, 39, 57, 0.94));
    border-color: rgba(34, 211, 238, 0.32);
  }

  .chat-status-pill,
  .chat-banner {
    border-radius: 999px;
    padding: 0.4rem 0.75rem;
    font-size: 0.82rem;
  }

  .chat-status-pill {
    background: rgba(125, 211, 252, 0.12);
    color: rgba(186, 230, 253, 0.9);
  }

  .chat-banner {
    align-self: flex-start;
  }

  .chat-banner.error {
    background: rgba(127, 29, 29, 0.22);
    color: rgba(252, 165, 165, 0.96);
  }

  .chat-banner.success {
    background: rgba(20, 83, 45, 0.22);
    color: rgba(134, 239, 172, 0.96);
  }

  .chat-layout {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
    gap: 1rem;
  }

  .chat-feed,
  .chat-composer,
  .identity-panel {
    min-height: 0;
    border-radius: 20px;
    border: 1px solid rgba(56, 189, 248, 0.1);
    background: linear-gradient(180deg, rgba(5, 16, 29, 0.78), rgba(4, 11, 22, 0.86));
  }

  .chat-feed {
    overflow: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .chat-empty {
    color: rgba(191, 219, 254, 0.66);
    padding: 1rem 0.2rem;
  }

  .chat-message-card {
    padding: 0.9rem 1rem;
    border-radius: 18px;
    background: rgba(9, 24, 42, 0.86);
    border: 1px solid rgba(56, 189, 248, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .chat-message-head {
    color: rgba(186, 230, 253, 0.76);
    font-size: 0.82rem;
  }

  .chat-message-body {
    color: rgba(239, 246, 255, 0.94);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .chat-composer {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    overflow: auto;
  }

  .chat-composer.drag-active {
    border-color: rgba(34, 211, 238, 0.3);
    box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.12);
  }

  .chat-textarea,
  .identity-editor input,
  .identity-editor textarea {
    width: 100%;
    border-radius: 16px;
    border: 1px solid rgba(56, 189, 248, 0.14);
    background: rgba(4, 15, 28, 0.88);
    color: rgba(239, 246, 255, 0.94);
    font: inherit;
    padding: 0.85rem 0.95rem;
  }

  .chat-textarea {
    min-height: 140px;
    resize: vertical;
  }

  .chat-drop-hint {
    color: rgba(147, 197, 253, 0.66);
    font-size: 0.83rem;
  }

  .chat-pending-attachment {
    padding: 0.55rem 0.75rem;
    border-radius: 14px;
    background: rgba(8, 20, 38, 0.86);
    border: 1px solid rgba(56, 189, 248, 0.14);
    justify-content: space-between;
  }

  .identity-panel {
    display: grid;
    grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
    gap: 1rem;
    padding: 1rem;
    overflow: auto;
  }

  .identity-panel-list,
  .identity-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .identity-chip {
    justify-content: space-between;
    text-align: left;
  }

  .identity-chip.active {
    border-color: rgba(34, 211, 238, 0.34);
    background: linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94));
  }

  .identity-chip div {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .identity-chip span,
  .identity-empty {
    color: rgba(191, 219, 254, 0.66);
    font-size: 0.82rem;
  }

  .identity-editor label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: rgba(191, 219, 254, 0.78);
    font-size: 0.86rem;
  }

  @media (max-width: 980px) {
    .chat-layout,
    .identity-panel {
      grid-template-columns: 1fr;
    }
  }
</style>
