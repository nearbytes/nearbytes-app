import {
  KNOWN_TRANSPORT_KINDS,
  type JoinLink,
  type JoinLinkAttachment,
  type JoinLinkPlan,
  type JoinLinkPlannerContext,
  type PlannedAttachment,
  type PlannedTransportCandidate,
  type TransportEndpoint,
} from './types.js';

const DEFAULT_SUPPORTED_TRANSPORTS = new Set<string>(KNOWN_TRANSPORT_KINDS);

export function createPlannerContext(input: Partial<{
  attachedShareKeys: Iterable<string>;
  connectedProviders: Iterable<string>;
  preferredProviders: Iterable<string>;
  supportedProviders: Iterable<string>;
  supportedTransports: Iterable<string>;
}> = {}): JoinLinkPlannerContext {
  return {
    attachedShareKeys: normalizeSet(input.attachedShareKeys),
    connectedProviders: normalizeSet(input.connectedProviders),
    preferredProviders: normalizeSet(input.preferredProviders),
    supportedProviders: normalizeSet(input.supportedProviders),
    supportedTransports:
      input.supportedTransports === undefined
        ? DEFAULT_SUPPORTED_TRANSPORTS
        : normalizeSet(input.supportedTransports),
  };
}

export function planJoinLink(link: JoinLink, context: JoinLinkPlannerContext): JoinLinkPlan {
  return {
    link,
    attachments: link.attachments.map((attachment) => planJoinAttachment(attachment, context)),
  };
}

export function planJoinAttachment(
  attachment: JoinLinkAttachment,
  context: JoinLinkPlannerContext
): PlannedAttachment {
  const candidates = attachment.recipe.endpoints
    .map((endpoint, index) => createCandidate(endpoint, index, context))
    .sort(compareCandidates);

  return {
    attachment,
    selectedEndpoint: candidates.find((candidate) => candidate.supported) ?? null,
    candidates,
  };
}

export function endpointMatchKey(endpoint: TransportEndpoint): string | undefined {
  const provider = normalizeKey(endpoint.provider);
  const descriptor = endpoint.descriptor;

  if (typeof descriptor.managedShareId === 'string' && descriptor.managedShareId.trim() !== '') {
    return `managed:${normalizeKey(descriptor.managedShareId)}`;
  }
  if (typeof descriptor.shareId === 'string' && descriptor.shareId.trim() !== '') {
    return `${provider || 'provider'}:share:${normalizeKey(descriptor.shareId)}`;
  }
  if (typeof descriptor.remoteId === 'string' && descriptor.remoteId.trim() !== '') {
    return `${provider || 'provider'}:remote:${normalizeKey(descriptor.remoteId)}`;
  }
  if (typeof descriptor.folderId === 'string' && descriptor.folderId.trim() !== '') {
    return `${provider || 'provider'}:remote:${normalizeKey(descriptor.folderId)}`;
  }
  if (typeof descriptor.remotePath === 'string' && descriptor.remotePath.trim() !== '') {
    return `${provider || 'provider'}:path:${normalizeKey(descriptor.remotePath)}`;
  }
  if (typeof descriptor.remotePathHint === 'string' && descriptor.remotePathHint.trim() !== '') {
    return `${provider || 'provider'}:path:${normalizeKey(descriptor.remotePathHint)}`;
  }
  const repoMatchKey = repositoryMatchKey(provider, descriptor);
  if (repoMatchKey) {
    return repoMatchKey;
  }
  if (typeof descriptor.url === 'string' && descriptor.url.trim() !== '') {
    return `${endpoint.transport}:${normalizeKey(descriptor.url)}`;
  }
  const host = typeof descriptor.host === 'string' ? descriptor.host.trim() : '';
  const port = typeof descriptor.port === 'number' ? String(descriptor.port) : '';
  if (host !== '' && port !== '') {
    return `${endpoint.transport}:${normalizeKey(host)}:${normalizeKey(port)}`;
  }
  return undefined;
}

function createCandidate(
  endpoint: TransportEndpoint,
  sourceIndex: number,
  context: JoinLinkPlannerContext
): PlannedTransportCandidate {
  const matchKey = endpointMatchKey(endpoint);
  const provider = normalizeKey(endpoint.provider);
  const supportedTransport = context.supportedTransports.has(endpoint.transport);
  const supportedProvider =
    endpoint.transport !== 'provider-share' ||
    provider === '' ||
    context.supportedProviders.size === 0 ||
    context.supportedProviders.has(provider);
  const supported = supportedTransport && supportedProvider;
  const attached = Boolean(matchKey && context.attachedShareKeys.has(matchKey));
  const connected = provider !== '' && context.connectedProviders.has(provider);
  const preferred = provider !== '' && context.preferredProviders.has(provider);
  const availableWithoutNewAuth = attached || endpoint.transport === 'http' || endpoint.transport === 'peer-http';
  const bootstrapIncluded = Boolean(endpoint.bootstrap?.account?.credentials);
  const storageHintIncluded = Boolean(endpoint.bootstrap?.storage?.localPathHint || endpoint.bootstrap?.storage?.localPath);
  const badges = collectBadges(endpoint, {
    attached,
    connected,
    preferred,
    availableWithoutNewAuth,
    supported,
    bootstrapIncluded,
    storageHintIncluded,
  });

  return {
    endpoint,
    matchKey,
    supported,
    badges,
    reason: describeCandidate(endpoint, {
      attached,
      connected,
      supported,
      availableWithoutNewAuth,
      provider,
      bootstrapIncluded,
    }),
    score: [
      attached ? 1 : 0,
      availableWithoutNewAuth ? 1 : 0,
      connected ? 1 : 0,
      preferred ? 1 : 0,
      -endpoint.priority,
      -sourceIndex,
    ],
  };
}

function compareCandidates(left: PlannedTransportCandidate, right: PlannedTransportCandidate): number {
  if (left.supported !== right.supported) {
    return left.supported ? -1 : 1;
  }
  for (let index = 0; index < left.score.length; index += 1) {
    const delta = right.score[index]! - left.score[index]!;
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function collectBadges(
  endpoint: TransportEndpoint,
  flags: {
    attached: boolean;
    connected: boolean;
    preferred: boolean;
    availableWithoutNewAuth: boolean;
    supported: boolean;
    bootstrapIncluded: boolean;
    storageHintIncluded: boolean;
  }
): string[] {
  const badges = new Set<string>(endpoint.badges ?? []);
  if (flags.attached) {
    badges.add('Already available');
  } else if (flags.availableWithoutNewAuth) {
    badges.add('No new login');
  }
  if (flags.connected) {
    badges.add('Connected');
  }
  if (flags.preferred) {
    badges.add('Recommended');
  }
  if (flags.bootstrapIncluded) {
    badges.add('Sign-in included');
  }
  if (flags.storageHintIncluded) {
    badges.add('Suggested folder');
  }
  if (endpoint.transport === 'peer-http') {
    badges.add('LAN');
  }
  if (endpoint.capabilities.includes('read') && !endpoint.capabilities.includes('write')) {
    badges.add('Read-only');
  }
  if (!flags.supported) {
    badges.add('Experimental');
  }
  return Array.from(badges.values());
}

function describeCandidate(
  endpoint: TransportEndpoint,
  flags: {
    attached: boolean;
    connected: boolean;
    supported: boolean;
    availableWithoutNewAuth: boolean;
    provider: string;
    bootstrapIncluded: boolean;
  }
): string {
  if (!flags.supported) {
    return 'This route is not supported by this Nearbytes build yet.';
  }
  if (flags.attached) {
    return 'This route is already attached on this device.';
  }
  if (flags.availableWithoutNewAuth) {
    return endpoint.transport === 'peer-http'
      ? 'This route can be tried directly on the local network.'
      : 'This route can be used without connecting a new account.';
  }
  if (flags.connected) {
    return 'A connected provider account is already available for this route.';
  }
  if (endpoint.transport === 'provider-share') {
    if (flags.bootstrapIncluded) {
      return `This link includes sign-in details for ${formatProviderName(flags.provider || endpoint.provider || 'this provider')}.`;
    }
    return `Connect ${formatProviderName(flags.provider || endpoint.provider || 'this provider')} to use this route.`;
  }
  return 'This route is available.';
}

function repositoryMatchKey(provider: string, descriptor: Record<string, unknown>): string | undefined {
  const repoFullName = typeof descriptor.repoFullName === 'string' ? normalizeKey(descriptor.repoFullName) : '';
  const repoOwner = typeof descriptor.repoOwner === 'string' ? normalizeKey(descriptor.repoOwner) : '';
  const repoName = typeof descriptor.repoName === 'string' ? normalizeKey(descriptor.repoName) : '';
  const branch = typeof descriptor.branch === 'string' ? normalizeKey(descriptor.branch) : '';
  const basePath = typeof descriptor.basePath === 'string' ? normalizeKey(descriptor.basePath) : '';
  const repository = repoFullName || (repoOwner && repoName ? `${repoOwner}/${repoName}` : '');
  if (!repository) {
    return undefined;
  }
  return `${provider || 'provider'}:repo:${repository}:${branch}:${basePath}`;
}

function formatProviderName(value: string): string {
  const normalized = normalizeKey(value);
  if (normalized === 'gdrive') {
    return 'Google Drive';
  }
  if (normalized === 'mega') {
    return 'MEGA';
  }
  if (normalized === 'github') {
    return 'GitHub';
  }
  return value
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeSet(values: Iterable<string> | undefined): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const value of values ?? []) {
    const key = normalizeKey(value);
    if (key !== '') {
      normalized.add(key);
    }
  }
  return normalized;
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
