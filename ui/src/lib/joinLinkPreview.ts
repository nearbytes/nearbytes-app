import {
  createPlannerContext,
  planJoinLink,
  type JoinLinkPlannerContext,
} from '../../../src/integrations/planner.js';
import {
  parseJoinLink as parseJoinLinkValue,
  type JoinLink,
} from '../../../src/domain/joinLinkCodec.js';
import {
  listManagedShares,
  listProviderAccounts,
  type JoinLinkParseResponse,
  type ManagedShareSummary,
} from './api.js';

export async function previewJoinLink(input: {
  serialized?: string;
  link?: unknown;
  preferredProviders?: string[];
}): Promise<JoinLinkParseResponse> {
  const link = parseJoinLinkInput(input.serialized, input.link);
  const context = await loadJoinLinkPlannerContext(input.preferredProviders);
  return {
    plan: planJoinLink(link, context),
    space: link.space,
  };
}

export function parseJoinLinkInput(serialized?: string, link?: unknown): JoinLink {
  if (link !== undefined) {
    return parseJoinLinkValue(link);
  }

  const trimmed = serialized?.trim() ?? '';
  if (trimmed === '') {
    throw new Error('Paste a Nearbytes join link first.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('This Nearbytes join link is not valid JSON.');
  }

  return parseJoinLinkValue(parsed);
}

async function loadJoinLinkPlannerContext(preferredProviders?: readonly string[]): Promise<JoinLinkPlannerContext> {
  const [accountsResult, managedSharesResult] = await Promise.allSettled([
    listProviderAccounts({ fast: true }),
    listManagedShares({ fast: true }),
  ]);

  const connectedProviders =
    accountsResult.status === 'fulfilled'
      ? accountsResult.value.accounts
          .filter((account) => account.state === 'connected')
          .map((account) => account.provider)
      : [];
  const supportedProviders =
    accountsResult.status === 'fulfilled'
      ? accountsResult.value.providers.map((provider) => provider.provider)
      : [];
  const preferred =
    preferredProviders && preferredProviders.length > 0
      ? preferredProviders
      : accountsResult.status === 'fulfilled'
        ? accountsResult.value.preferredProviders
        : [];
  const attachedShareKeys =
    managedSharesResult.status === 'fulfilled'
      ? buildAttachedShareKeysFromSummaries(managedSharesResult.value.shares)
      : [];

  return createPlannerContext({
    attachedShareKeys,
    connectedProviders,
    preferredProviders: preferred,
    supportedProviders,
  });
}

export function buildAttachedShareKeysFromSummaries(shares: readonly ManagedShareSummary[]): string[] {
  const keys = new Set<string>();
  for (const summary of shares) {
    if (summary.attachments.length === 0) {
      continue;
    }
    for (const key of buildManagedShareMatchKeysFromSummary(summary)) {
      keys.add(key);
    }
  }
  return Array.from(keys.values());
}

export function buildManagedShareMatchKeysFromSummary(summary: ManagedShareSummary): string[] {
  const share = summary.share;
  const provider = normalizeKey(share.provider);
  const descriptor = share.remoteDescriptor;
  const keys = new Set<string>();

  keys.add(`managed:${normalizeKey(share.id)}`);

  addManagedKey(keys, descriptor.managedShareId);
  addProviderShareKey(keys, provider, descriptor.shareHandle);
  addProviderRemoteKey(keys, provider, descriptor.shareHandle);
  addProviderRemoteKey(keys, provider, descriptor.rootHandle);
  addProviderShareKey(keys, provider, descriptor.rootHandle);
  addProviderShareKey(keys, provider, descriptor.shareId);
  addProviderRemoteKey(keys, provider, descriptor.remoteId);
  addProviderRemoteKey(keys, provider, descriptor.folderId);
  addProviderPathKey(keys, provider, descriptor.remotePath);
  addProviderPathKey(keys, provider, descriptor.remotePathHint);

  const repositoryKey = buildRepositoryMatchKey(provider, descriptor);
  if (repositoryKey) {
    keys.add(repositoryKey);
  }

  return Array.from(keys.values());
}

function addManagedKey(keys: Set<string>, value: unknown): void {
  const normalized = normalizeKey(value);
  if (normalized !== '') {
    keys.add(`managed:${normalized}`);
  }
}

function addProviderShareKey(keys: Set<string>, provider: string, value: unknown): void {
  const normalized = normalizeKey(value);
  if (provider !== '' && normalized !== '') {
    keys.add(`${provider}:share:${normalized}`);
  }
}

function addProviderRemoteKey(keys: Set<string>, provider: string, value: unknown): void {
  const normalized = normalizeKey(value);
  if (provider !== '' && normalized !== '') {
    keys.add(`${provider}:remote:${normalized}`);
  }
}

function addProviderPathKey(keys: Set<string>, provider: string, value: unknown): void {
  const normalized = normalizeKey(value);
  if (provider !== '' && normalized !== '') {
    keys.add(`${provider}:path:${normalized}`);
  }
}

function buildRepositoryMatchKey(provider: string, descriptor: Record<string, unknown>): string | undefined {
  const repoFullName = normalizeKey(descriptor.repoFullName);
  const repoOwner = normalizeKey(descriptor.repoOwner);
  const repoName = normalizeKey(descriptor.repoName);
  const branch = normalizeKey(descriptor.branch);
  const basePath = normalizeKey(descriptor.basePath);
  const repository = repoFullName || (repoOwner !== '' && repoName !== '' ? `${repoOwner}/${repoName}` : '');
  if (repository === '') {
    return undefined;
  }
  return `${provider || 'provider'}:repo:${repository}:${branch}:${basePath}`;
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}