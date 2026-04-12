export type Auth = { type: 'token'; token: string } | { type: 'secret'; secret: string };

export interface FileMetadata {
  filename: string;
  blobHash: string;
  contentType?: 'b' | 'm';
  size: number;
  mimeType?: string;
  createdAt: number;
}

export interface ContentDescriptor {
  t: 'b' | 'm';
  h: string;
  z: number;
}

export interface SourceFileReference {
  p: 'nb.src.ref.v1';
  s: string;
  c: ContentDescriptor;
  x: string;
}

export interface SourceReferenceBundleItem {
  name: string;
  mime?: string;
  createdAt?: number;
  ref: SourceFileReference;
}

export interface SourceReferenceBundle {
  p: 'nb.src.refs.v1';
  s: string;
  items: SourceReferenceBundleItem[];
}

export interface ChatAttachment {
  kind: 'nb.src.ref.v1';
  name: string;
  mime?: string;
  createdAt?: number;
  ref: SourceFileReference;
}

export interface IdentityProfile {
  displayName: string;
  bio?: string;
}

export interface IdentityRecord {
  p: 'nb.identity.record.v1';
  k: string;
  ts: number;
  profile: IdentityProfile;
  sig: string;
}

export interface ChatMessage {
  p: 'nb.chat.message.v1';
  k: string;
  ts: number;
  body?: string;
  attachment?: ChatAttachment;
  sig: string;
}

export interface PublishedIdentity {
  eventHash: string;
  authorPublicKey: string;
  publishedAt: number;
  record: IdentityRecord;
}

export interface PublishedChatMessage {
  eventHash: string;
  authorPublicKey: string;
  publishedAt: number;
  message: ChatMessage;
}

export interface VolumeChatState {
  identities: PublishedIdentity[];
  messages: PublishedChatMessage[];
  isOffline?: boolean;
}

export interface SerializedEventPayload {
  type: string;
  fileName: string;
  toFileName?: string;
  hash: string;
  encryptedKey: string;
  contentType?: 'b' | 'm';
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  renamedAt?: number;
  authorPublicKey?: string;
  protocol?: string;
  record?: string;
  message?: string;
  publishedAt?: number;
}

export interface SerializedEvent {
  envelope: {
    version: string;
    publicKey: string;
    blockRefs: string[];
    ciphertext: string;
  };
  signature: string;
}

export interface EventDetailResponse {
  eventHash: string;
  event: SerializedEvent;
  decryptedPayload?: SerializedEventPayload;
}

export interface TimelineEvent {
  eventHash: string;
  type: 'CREATE_FILE' | 'DELETE_FILE' | 'RENAME_FILE' | 'DECLARE_IDENTITY' | 'CHAT_MESSAGE' | 'APP_RECORD';
  filename: string;
  timestamp: number;
  protocol?: string;
  blobHash?: string;
  contentType?: 'b' | 'm';
  toFilename?: string;
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  renamedAt?: number;
  publishedAt?: number;
  authorPublicKey?: string;
  displayName?: string;
  body?: string;
  attachmentName?: string;
  summary?: string;
  record?: IdentityRecord;
  message?: ChatMessage;
}

export type JoinLinkSpace =
  | {
      mode: 'seed';
      value: string;
      password?: string;
    }
  | {
      mode: 'secret-file';
      name: string;
      mime?: string;
      payload: string;
    }
  | {
      mode: 'volume-id';
      value: string;
    };

export interface TransportEndpoint {
  p: 'nb.transport.endpoint.v1';
  transport: string;
  provider?: string;
  priority: number;
  capabilities: string[];
  descriptor: Record<string, unknown>;
  label?: string;
  badges?: string[];
}

export interface TransportRecipe {
  p: 'nb.transport.recipe.v1';
  id: string;
  label: string;
  purpose: string;
  endpoints: TransportEndpoint[];
}

export interface JoinLinkAttachment {
  id: string;
  label: string;
  recipe: TransportRecipe;
}

export interface JoinLink {
  p: 'nb.join.v1';
  space: JoinLinkSpace;
  attachments: JoinLinkAttachment[];
}

export interface JoinLinkPlanAttachmentSelection {
  endpoint: TransportEndpoint;
  badges: string[];
  reason: string;
}

export interface JoinLinkPlanAttachment {
  attachment: JoinLinkAttachment;
  selectedEndpoint: JoinLinkPlanAttachmentSelection | null;
}

export interface JoinLinkPlan {
  attachments: JoinLinkPlanAttachment[];
}

export interface JoinLinkAction {
  provider?: string;
  endpointTransport?: string;
  status: 'attached' | 'planned' | 'needs-account' | 'pending-auth' | 'unsupported';
  detail: string;
  suggestedLocalPath?: string;
}

export interface JoinLinkParseResponse {
  joinLink: JoinLink;
  space: JoinLinkSpace;
  plan: JoinLinkPlan;
}

export interface JoinLinkOpenResponse extends JoinLinkParseResponse {
  secret: string | null;
  actions: JoinLinkAction[];
}
