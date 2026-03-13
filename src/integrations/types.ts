export const KNOWN_TRANSPORT_KINDS = ['provider-share', 'http', 'peer-http'] as const;

export type KnownTransportKind = (typeof KNOWN_TRANSPORT_KINDS)[number];
export type TransportKind = KnownTransportKind | (string & {});
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface TransportEndpoint {
  readonly p: 'nb.transport.endpoint.v1';
  readonly transport: TransportKind;
  readonly provider?: string;
  readonly priority: number;
  readonly capabilities: string[];
  readonly descriptor: Record<string, JsonValue>;
  readonly label?: string;
  readonly badges?: string[];
}

export interface TransportRecipe {
  readonly p: 'nb.transport.recipe.v1';
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly endpoints: TransportEndpoint[];
}

export interface JoinLinkSpaceSeed {
  readonly mode: 'seed';
  readonly value: string;
  readonly password?: string;
}

export interface JoinLinkSpaceSecretFile {
  readonly mode: 'secret-file';
  readonly name: string;
  readonly mime?: string;
  readonly payload: string;
}

export type JoinLinkSpace = JoinLinkSpaceSeed | JoinLinkSpaceSecretFile;

export interface JoinLinkAttachment {
  readonly id: string;
  readonly label: string;
  readonly recipe: TransportRecipe;
}

export interface JoinLink {
  readonly p: 'nb.join.v1';
  readonly space: JoinLinkSpace;
  readonly attachments: JoinLinkAttachment[];
}

export interface ProviderAccount {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly email?: string;
  readonly state: 'connected' | 'attention' | 'unsupported';
  readonly detail?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ManagedShare {
  readonly id: string;
  readonly provider: string;
  readonly accountId: string;
  readonly label: string;
  readonly role: 'owner' | 'recipient' | 'link';
  readonly localPath: string;
  readonly sourceId?: string;
  readonly syncMode: 'mirror';
  readonly remoteDescriptor: Record<string, unknown>;
  readonly capabilities: string[];
  readonly invitationEmails: string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ManagedShareAttachment {
  readonly id: string;
  readonly shareId: string;
  readonly sourceId: string;
  readonly volumeId: string;
  readonly createdAt: number;
}

export interface TransportState {
  readonly status: 'idle' | 'ready' | 'syncing' | 'needs-auth' | 'unsupported' | 'attention';
  readonly detail: string;
  readonly badges: string[];
  readonly lastSyncAt?: number;
}

export interface ProviderSetupState {
  readonly status: 'ready' | 'needs-config' | 'needs-install' | 'installing' | 'unsupported';
  readonly detail: string;
  readonly docsUrl?: string;
  readonly canConfigure?: boolean;
  readonly canInstall?: boolean;
  readonly config?: {
    readonly clientId?: string;
    readonly hasClientSecret?: boolean;
    readonly helperPath?: string;
  };
}

export interface ProviderCatalogEntry {
  readonly provider: string;
  readonly label: string;
  readonly description: string;
  readonly badges: string[];
  readonly isConnected: boolean;
  readonly connectionState: 'available' | 'connected' | 'setup';
  readonly accountId?: string;
  readonly setup: ProviderSetupState;
}

export interface ManagedShareSummary {
  readonly share: ManagedShare;
  readonly attachments: ManagedShareAttachment[];
  readonly state: TransportState;
  readonly storage?: {
    readonly sourcePath?: string;
    readonly enabled?: boolean;
    readonly writable?: boolean;
    readonly keepFullCopy?: boolean;
    readonly reservePercent?: number;
    readonly availableBytes?: number;
    readonly usageTotalBytes?: number;
    readonly lastWriteFailureMessage?: string;
    readonly remoteAvailableBytes?: number;
    readonly remoteTotalBytes?: number;
    readonly remoteUsedBytes?: number;
  };
}

export interface ShareStorageMetrics {
  readonly remoteAvailableBytes?: number;
  readonly remoteTotalBytes?: number;
  readonly remoteUsedBytes?: number;
}

export interface ConnectProviderAccountInput {
  readonly provider: string;
  readonly label?: string;
  readonly email?: string;
  readonly preferred?: boolean;
  readonly authSessionId?: string;
  readonly accountId?: string;
  readonly credentials?: {
    readonly email?: string;
    readonly password?: string;
    readonly mfaCode?: string;
  };
}

export interface ConfigureProviderInput {
  readonly provider: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
}

export interface ProviderAuthSession {
  readonly id: string;
  readonly provider: string;
  readonly accountId: string;
  readonly status: 'pending' | 'ready' | 'failed';
  readonly detail: string;
  readonly authUrl?: string;
  readonly openedAt: number;
  readonly expiresAt: number;
}

export interface ConnectProviderAccountResult {
  readonly status: 'connected' | 'pending' | 'failed';
  readonly account?: ProviderAccount;
  readonly authSession?: ProviderAuthSession;
}

export interface CreateManagedShareInput {
  readonly provider: string;
  readonly accountId: string;
  readonly label: string;
  readonly localPath?: string;
  readonly role?: ManagedShare['role'];
  readonly volumeId?: string;
  readonly remoteDescriptor?: Record<string, unknown>;
  readonly capabilities?: string[];
}

export interface InviteManagedShareInput {
  readonly emails: string[];
}

export interface AttachManagedShareInput {
  readonly volumeId: string;
}

export interface AcceptManagedShareInput {
  readonly provider: string;
  readonly accountId: string;
  readonly label: string;
  readonly volumeId?: string;
  readonly localPath?: string;
  readonly remoteDescriptor?: Record<string, unknown>;
}

export interface JoinLinkPlannerContext {
  readonly attachedShareKeys: ReadonlySet<string>;
  readonly connectedProviders: ReadonlySet<string>;
  readonly preferredProviders: ReadonlySet<string>;
  readonly supportedProviders: ReadonlySet<string>;
  readonly supportedTransports: ReadonlySet<string>;
}

export interface PlannedTransportCandidate {
  readonly endpoint: TransportEndpoint;
  readonly score: readonly [number, number, number, number, number, number];
  readonly badges: string[];
  readonly supported: boolean;
  readonly reason: string;
  readonly matchKey?: string;
}

export interface PlannedAttachment {
  readonly attachment: JoinLinkAttachment;
  readonly selectedEndpoint: PlannedTransportCandidate | null;
  readonly candidates: PlannedTransportCandidate[];
}

export interface JoinLinkPlan {
  readonly link: JoinLink;
  readonly attachments: PlannedAttachment[];
}
