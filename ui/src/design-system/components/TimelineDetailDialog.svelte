<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import type {
    RecipientFileReference,
    SerializedEventPayload,
    SourceFileReference,
  } from '../../lib/api.js';

  type EventReference = {
    kind: 'source' | 'recipient';
    name?: string;
    mime?: string;
    createdAt?: number;
    ref: SourceFileReference | RecipientFileReference;
  };

  type SpecDoc = {
    id: string;
    title: string;
    filename: string;
    summary: string;
  };

  type TimelinePayload = {
    envelope: {
      version: string;
      publicKey: string;
      blockRefs: string[];
      ciphertext: string;
    };
    signature: string;
  };

  type DecryptedPayload = SerializedEventPayload;

  let {
    title = 'Event details',
    subtitle = '',
    loading = false,
    errorMessage = '',
    payload = null,
    decryptedPayload = null,
    hash = '',
    encoded = '',
    appSignature = 'unknown',
    appSignatureSource = '',
    record = '',
    recordError = '',
    message = '',
    messageError = '',
    references = [],
    eventRefs = [],
    relevantSpecs = [],
    storageHits = [],
    storageError = '',
    revealBusyPath = '',
    expectedEventPath = '',
    expectedBlockPath = null,
    authAvailable = false,
    formatDate,
    getStorageLabel,
    getStoragePath,
    getStoragePresence,
    onClose = undefined,
    onRevealStorage = undefined,
    onOpenPayloadPreview = undefined,
    onOpenSpec = undefined,
    onPreviewReference = undefined,
    onOpenEventRef = undefined,
  } = $props<{
    title?: string;
    subtitle?: string;
    loading?: boolean;
    errorMessage?: string;
    payload?: TimelinePayload | null;
    decryptedPayload?: DecryptedPayload | null;
    hash?: string;
    encoded?: string;
    appSignature?: 'yes' | 'no' | 'unknown';
    appSignatureSource?: string;
    record?: string;
    recordError?: string;
    message?: string;
    messageError?: string;
    references?: EventReference[];
    eventRefs?: string[];
    relevantSpecs?: SpecDoc[];
    storageHits?: any[];
    storageError?: string;
    revealBusyPath?: string;
    expectedEventPath?: string;
    expectedBlockPath?: string | null;
    authAvailable?: boolean;
    formatDate: (value: number) => string;
    getStorageLabel: (location: any) => string;
    getStoragePath: (location: any) => string;
    getStoragePresence: (location: any) => string;
    onClose?: (() => void) | undefined;
    onRevealStorage?: ((location: any) => void | Promise<void>) | undefined;
    onOpenPayloadPreview?: ((payload: SerializedEventPayload) => void) | undefined;
    onOpenSpec?: ((spec: SpecDoc) => void) | undefined;
    onPreviewReference?: ((reference: EventReference) => void) | undefined;
    onOpenEventRef?: ((eventHash: string) => void | Promise<void>) | undefined;
  }>();

  const hasEncryptedPayload = $derived(decryptedPayload?.type === 'CREATE_FILE');
</script>

<AppDialog
  ariaLabel="Timeline event details"
  eyebrow="Timeline details"
  {title}
  subtitle={subtitle}
  width="xwide"
  closeLabel="Close details"
  surfaceClass="timeline-detail-surface"
  bodyClass="timeline-detail-body"
  onClose={onClose}
>
  {#snippet body()}
    {#if loading}
      <div class="tm-details-loading">
        <span class="loading-spinner"></span>
        <span>Loading event…</span>
      </div>
    {:else if errorMessage}
      <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
    {:else if payload}
      <div class="tm-details-meta">
        <span>{decryptedPayload?.type ?? 'Encrypted event'}</span>
        <span>{decryptedPayload?.fileName || '—'}</span>
      </div>

      {#if hash}
        <p class="tm-details-hash">{hash}</p>
        <p class="tm-details-hint">
          Event hash = SHA-256 of the serialized visible envelope bytes (signature not included).
        </p>
      {/if}

      <div class="tm-details-section tm-details-debug-section">
        <p class="tm-details-section-title">Protocol storage</p>
        <p class="tm-details-section-note">Expected nearbytes-root paths for this event.</p>
        <div class="tm-details-path-shell">
          <div class="tm-details-path-row">
            <span class="tm-details-label">event file</span>
            <span class="tm-details-value mono">{expectedEventPath}</span>
          </div>
          {#if expectedBlockPath}
            <div class="tm-details-path-row">
              <span class="tm-details-label">data block</span>
              <span class="tm-details-value mono">{expectedBlockPath}</span>
            </div>
          {/if}
        </div>

        {#if storageError}
          <StatusNotice tone="error" role="alert" compact={true} message={storageError} />
        {/if}

        {#if storageHits.length > 0}
          <div class="tm-details-hit-list">
            {#each storageHits as location}
              {@const targetPath = getStoragePath(location)}
              <div class="tm-details-hit-row">
                <div class="tm-details-hit-copy">
                  <p class="tm-details-hit-title">{getStorageLabel(location)}</p>
                  <p class="tm-details-hit-meta">{getStoragePresence(location)}</p>
                  <p class="tm-details-hit-path mono">{targetPath}</p>
                </div>
                <div class="tm-details-hit-actions">
                  <button
                    type="button"
                    class="tm-details-ref-btn"
                    onclick={() => void onRevealStorage?.(location)}
                    disabled={revealBusyPath === targetPath}
                  >
                    {revealBusyPath === targetPath ? 'Opening…' : 'Reveal in folder'}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="tm-details-section-note">No configured storage location currently reports this event path.</p>
        {/if}
      </div>

      <div class="tm-details-section">
        <p class="tm-details-section-title">Summary</p>
        <div class="tm-details-grid">
          <div class="tm-details-grid-row">
            <span class="tm-details-label">signedBy</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value">event envelope public key</span>
              <span class="tm-details-help">The outer signature authenticates the visible envelope and ciphertext.</span>
            </div>
          </div>
          <div class="tm-details-grid-row">
            <span class="tm-details-label">visibility</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value">
                {decryptedPayload ? 'visible envelope + decrypted inner payload' : 'visible envelope + opaque inner payload'}
              </span>
              <span class="tm-details-help">
                Semantic event content lives inside the encrypted payload. Storage only sees version, signer,
                referenced blocks, ciphertext, and signature.
              </span>
            </div>
          </div>
          {#if appSignature !== 'unknown'}
            <div class="tm-details-grid-row">
              <span class="tm-details-label">appSignature</span>
              <div class="tm-details-value-group">
                <span class="tm-details-value">{appSignature === 'yes' ? 'present' : 'not detected'}</span>
                <span class="tm-details-help">
                  {appSignature === 'yes' && appSignatureSource
                    ? `Detected ${appSignatureSource}.`
                    : 'Nested app records may include their own signature fields.'}
                </span>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="tm-details-section">
        <p class="tm-details-section-title">Signed envelope</p>
        <p class="tm-details-section-note">
          The signature covers the serialized visible envelope plus ciphertext. The decrypted payload below is a
          trusted local convenience view, not the stored outer structure.
        </p>
        <div class="tm-details-grid">
          <div class="tm-details-grid-row">
            <span class="tm-details-label">version</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value">{payload.envelope.version}</span>
              <span class="tm-details-help">Protocol version for the visible event envelope.</span>
            </div>
          </div>
          <div class="tm-details-grid-row">
            <span class="tm-details-label">publicKey</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value mono">{payload.envelope.publicKey}</span>
              <span class="tm-details-help">Full signer public key stored in cleartext.</span>
            </div>
          </div>
          <div class="tm-details-grid-row">
            <span class="tm-details-label">blockRefs</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value mono">{payload.envelope.blockRefs.length > 0 ? payload.envelope.blockRefs.join(', ') : '[]'}</span>
              <span class="tm-details-help">Visible ciphertext block references mentioned by this event.</span>
            </div>
          </div>
          <div class="tm-details-grid-row">
            <span class="tm-details-label">ciphertext</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value mono">{payload.envelope.ciphertext}</span>
              <span class="tm-details-help">Base64-encoded encrypted inner payload bytes.</span>
            </div>
          </div>
          <div class="tm-details-grid-row">
            <span class="tm-details-label">signature</span>
            <div class="tm-details-value-group">
              <span class="tm-details-value mono">{payload.signature}</span>
              <span class="tm-details-help">Base64 signature bytes stored alongside the envelope.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="tm-details-section">
        <p class="tm-details-section-title">Encoded event</p>
        <p class="tm-details-section-note">Raw JSON stored for this event (visible envelope + signature).</p>
        <pre class="tm-details-pre">{encoded}</pre>
      </div>

      {#if decryptedPayload}
        <div class="tm-details-section">
          <p class="tm-details-section-title">Decrypted inner payload</p>
          <p class="tm-details-section-note">
            This trusted local view appears only after decrypting the opaque event payload with the volume secret.
          </p>
          <div class="tm-details-grid">
            <div class="tm-details-grid-row">
              <span class="tm-details-label">type</span>
              <div class="tm-details-value-group">
                <span class="tm-details-value">{decryptedPayload.type}</span>
                <span class="tm-details-help">Semantic event kind carried inside the encrypted payload.</span>
              </div>
            </div>
            <div class="tm-details-grid-row">
              <span class="tm-details-label">fileName</span>
              <div class="tm-details-value-group">
                <span class="tm-details-value">{decryptedPayload.fileName}</span>
                <span class="tm-details-help">Logical file name inside the decrypted event payload.</span>
              </div>
            </div>
            {#if decryptedPayload.toFileName}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">toFileName</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{decryptedPayload.toFileName}</span>
                  <span class="tm-details-help">Destination name for rename events.</span>
                </div>
              </div>
            {/if}
            <div class="tm-details-grid-row">
              <span class="tm-details-label">hash</span>
              <div class="tm-details-value-group">
                <span class="tm-details-value mono">{decryptedPayload.hash}</span>
                <span class="tm-details-help">Application-level primary block hash from the decrypted payload.</span>
              </div>
            </div>
            <div class="tm-details-grid-row">
              <span class="tm-details-label">encryptedKey</span>
              <div class="tm-details-value-group">
                <span class="tm-details-value mono">{decryptedPayload.encryptedKey}</span>
                <span class="tm-details-help">Wrapped file key carried inside the encrypted payload.</span>
              </div>
            </div>
            {#if decryptedPayload.contentType}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">contentType</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{decryptedPayload.contentType}</span>
                  <span class="tm-details-help">Ciphertext kind: b = block, m = manifest.</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.size !== undefined}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">size</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{decryptedPayload.size}</span>
                  <span class="tm-details-help">Original plaintext size in bytes.</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.mimeType}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">mimeType</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{decryptedPayload.mimeType}</span>
                  <span class="tm-details-help">MIME type hint from the uploader.</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.createdAt !== undefined}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">createdAt</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{formatDate(decryptedPayload.createdAt)}</span>
                  <span class="tm-details-help">Client timestamp when the file was created.</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.deletedAt !== undefined}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">deletedAt</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{formatDate(decryptedPayload.deletedAt)}</span>
                  <span class="tm-details-help">Client timestamp when the delete was authored.</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.renamedAt !== undefined}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">renamedAt</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{formatDate(decryptedPayload.renamedAt)}</span>
                  <span class="tm-details-help">Client timestamp when the rename was authored.</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.authorPublicKey}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">authorPublicKey</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value mono">{decryptedPayload.authorPublicKey}</span>
                  <span class="tm-details-help">Author identity key for app/identity/chat payloads (not the volume key).</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.protocol}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">protocol</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{decryptedPayload.protocol}</span>
                  <span class="tm-details-help">Protocol id for APP_RECORD (should match the record p field).</span>
                </div>
              </div>
            {/if}
            {#if decryptedPayload.publishedAt !== undefined}
              <div class="tm-details-grid-row">
                <span class="tm-details-label">publishedAt</span>
                <div class="tm-details-value-group">
                  <span class="tm-details-value">{formatDate(decryptedPayload.publishedAt)}</span>
                  <span class="tm-details-help">Client timestamp when the app record/message was published.</span>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if hasEncryptedPayload}
        <div class="tm-details-section">
          <p class="tm-details-section-title">Encrypted file payload</p>
          <p class="tm-details-section-note">
            Ciphertext is stored as a block addressed by the hash above. Use the hub secret to decrypt; this panel can open a decrypted preview when available.
          </p>
          <div class="tm-details-action-row">
            <button
              type="button"
              class="tm-details-ref-btn"
              onclick={() => {
                if (decryptedPayload) {
                  onOpenPayloadPreview?.(decryptedPayload);
                }
              }}
              disabled={!authAvailable || !decryptedPayload}
            >
              Open decrypted preview
            </button>
          </div>
        </div>
      {/if}

      {#if record || recordError}
        <div class="tm-details-section">
          <p class="tm-details-section-title">App record</p>
          <p class="tm-details-section-note">Trusted local rendering of decrypted app-record JSON extracted from the opaque event payload.</p>
          {#if recordError}
            <StatusNotice tone="error" role="alert" compact={true} title="Record parse error" message={recordError} />
          {/if}
          {#if record}
            <pre class="tm-details-pre">{record}</pre>
          {/if}
        </div>
      {/if}

      {#if message || messageError}
        <div class="tm-details-section">
          <p class="tm-details-section-title">App message</p>
          <p class="tm-details-section-note">Trusted local rendering of decrypted chat/message JSON extracted from the opaque event payload.</p>
          {#if messageError}
            <StatusNotice tone="error" role="alert" compact={true} title="Message parse error" message={messageError} />
          {/if}
          {#if message}
            <pre class="tm-details-pre">{message}</pre>
          {/if}
        </div>
      {/if}

      {#if relevantSpecs.length > 0}
        <div class="tm-details-section">
          <p class="tm-details-section-title">Specs</p>
          <p class="tm-details-section-note">Bundled protocol specs relevant to this event.</p>
          <div class="tm-details-spec-list">
            {#each relevantSpecs as spec}
              <div class="tm-details-spec-card">
                <div class="tm-details-spec-copy">
                  <p class="tm-details-spec-title">{spec.title}</p>
                  <p class="tm-details-spec-meta">{spec.summary}</p>
                  <p class="tm-details-spec-file mono">{spec.filename}</p>
                </div>
                <div class="tm-details-spec-actions">
                  <button type="button" class="tm-details-ref-btn" onclick={() => onOpenSpec?.(spec)}>
                    View
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if references.length > 0}
        <div class="tm-details-section">
          <p class="tm-details-section-title">References</p>
          <div class="tm-details-ref-list">
            {#each references as reference}
              <div class="tm-details-ref-row">
                <div class="tm-details-ref-copy">
                  <p class="tm-details-ref-name">{reference.name ?? (reference.kind === 'source' ? 'Source reference' : 'Recipient reference')}</p>
                  {#if reference.kind === 'source'}
                    <p class="tm-details-ref-meta mono">{(reference.ref as SourceFileReference).s}</p>
                  {:else}
                    <p class="tm-details-ref-meta mono">{(reference.ref as RecipientFileReference).k.r}</p>
                  {/if}
                  <p class="tm-details-ref-hash mono">{reference.ref.c.h}</p>
                  <p class="tm-details-ref-meta">{reference.ref.c.t} • {reference.ref.c.z} bytes</p>
                </div>
                <div class="tm-details-ref-actions">
                  {#if reference.kind === 'source'}
                    <button type="button" class="tm-details-ref-btn" onclick={() => onPreviewReference?.(reference)}>
                      Preview
                    </button>
                  {:else}
                    <button type="button" class="tm-details-ref-btn" disabled>
                      Recipient
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if eventRefs.length > 0}
        <div class="tm-details-section">
          <p class="tm-details-section-title">Event references</p>
          <div class="tm-details-ref-list">
            {#each eventRefs as eventHash}
              <button type="button" class="tm-details-ref-btn link" onclick={() => void onOpenEventRef?.(eventHash)}>
                {eventHash}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <p class="tm-details-empty">No event payload available.</p>
    {/if}
  {/snippet}
</AppDialog>

<style>
  :global(.timeline-detail-surface) {
    background: var(--nb-dialog-bg, linear-gradient(180deg, rgba(9, 18, 34, 0.98), rgba(6, 12, 24, 0.96)));
    border-color: var(--nb-border, rgba(148, 163, 184, 0.2));
  }

  :global(.timeline-detail-body) {
    padding-top: 0;
  }

  .tm-details-loading {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.8));
  }

  .tm-details-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.7rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.9));
  }

  .tm-details-hash,
  .tm-details-hint,
  .tm-details-empty,
  .tm-details-section-title,
  .tm-details-section-note,
  .tm-details-hit-title,
  .tm-details-hit-meta,
  .tm-details-hit-path,
  .tm-details-spec-title,
  .tm-details-spec-meta,
  .tm-details-spec-file,
  .tm-details-ref-name,
  .tm-details-ref-meta,
  .tm-details-ref-hash,
  .tm-details-pre {
    margin: 0;
  }

  .tm-details-hash {
    font-family: var(--nb-font-mono);
    font-size: 0.7rem;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.85));
    word-break: break-all;
  }

  .tm-details-hint,
  .tm-details-empty,
  .tm-details-section-note,
  .tm-details-help,
  .tm-details-hit-meta,
  .tm-details-spec-meta,
  .tm-details-ref-meta {
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.8));
  }

  .tm-details-pre {
    background: var(--nb-panel-bg, rgba(8, 14, 28, 0.7));
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.18));
    border-radius: 14px;
    padding: 0.85rem 0.95rem;
    font-family: var(--nb-font-mono);
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.95));
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 56vh;
    overflow: auto;
  }

  .tm-details-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .tm-details-debug-section {
    padding: 0.75rem 0.8rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-accent, rgba(125, 211, 252, 0.75)) 22%, var(--nb-border, rgba(148, 163, 184, 0.2)));
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(8, 14, 28, 0.7)) 96%, rgba(14, 116, 144, 0.18));
  }

  .tm-details-path-shell,
  .tm-details-spec-card,
  .tm-details-ref-row,
  .tm-details-hit-row {
    border-radius: 12px;
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.18));
    background: rgba(9, 16, 30, 0.7);
  }

  .tm-details-path-shell {
    display: grid;
    gap: 0.36rem;
    padding: 0.6rem 0.66rem;
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(9, 16, 30, 0.7)) 94%, rgba(56, 189, 248, 0.08));
  }

  .tm-details-path-row,
  .tm-details-grid-row {
    display: grid;
    gap: 0.6rem;
    align-items: start;
  }

  .tm-details-path-row {
    grid-template-columns: minmax(96px, 120px) minmax(0, 1fr);
  }

  .tm-details-grid-row {
    grid-template-columns: minmax(0, 140px) minmax(0, 1fr);
  }

  .tm-details-hit-list,
  .tm-details-spec-list,
  .tm-details-ref-list,
  .tm-details-grid {
    display: grid;
    gap: 0.5rem;
  }

  .tm-details-hit-row,
  .tm-details-spec-card {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.8rem;
    padding: 0.7rem 0.85rem;
    align-items: start;
  }

  .tm-details-hit-copy,
  .tm-details-value-group,
  .tm-details-spec-copy,
  .tm-details-ref-copy {
    display: flex;
    flex-direction: column;
    gap: 0.24rem;
    min-width: 0;
  }

  .tm-details-section-title {
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(125, 211, 252, 0.7));
  }

  .tm-details-label {
    font-size: 0.7rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.85));
    text-transform: lowercase;
  }

  .tm-details-value,
  .tm-details-hit-title,
  .tm-details-spec-title,
  .tm-details-ref-name {
    color: var(--nb-text-main, rgba(226, 232, 240, 0.95));
  }

  .tm-details-value {
    font-size: 0.78rem;
    word-break: break-word;
  }

  .tm-details-value.mono,
  .mono {
    font-family: var(--nb-font-mono);
    font-size: 0.72rem;
  }

  .tm-details-action-row,
  .tm-details-hit-actions,
  .tm-details-spec-actions,
  .tm-details-ref-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  .tm-details-ref-btn {
    border: 1px solid var(--nb-btn-border, rgba(148, 163, 184, 0.2));
    border-radius: 8px;
    background: var(--nb-btn-bg, rgba(12, 22, 41, 0.6));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.85));
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
  }

  .tm-details-ref-btn:hover:not(:disabled) {
    border-color: var(--nb-btn-hover-border, rgba(56, 189, 248, 0.4));
    background: var(--nb-btn-hover-bg, rgba(14, 116, 144, 0.22));
    color: var(--nb-btn-hover-color, #e0f2fe);
  }

  .tm-details-ref-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tm-details-ref-btn.link {
    width: 100%;
    text-align: left;
  }
</style>