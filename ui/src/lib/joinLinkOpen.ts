import { joinLinkSpaceToSecretString } from '../../../src/domain/joinLinkCodec.js';

import {
  buildManagedShareMatchKeysFromSummary,
  previewJoinLink,
} from './joinLinkPreview.js';
import type {
  ConnectProviderAccountResponse,
  JoinLinkOpenResponse,
  JoinLinkParseResponse,
  ManagedShareSummary,
  ProviderAccount,
} from './api.js';

interface OpenJoinLinkDeps {
  listProviderAccounts(options?: { fast?: boolean }): Promise<{
    accounts: ProviderAccount[];
    preferredProviders: string[];
  }>;
  listManagedShares(options?: { fast?: boolean }): Promise<{
    shares: ManagedShareSummary[];
  }>;
  connectProviderAccount(input: {
    provider: string;
    mode?: 'login' | 'signup' | 'confirm-signup';
    label?: string;
    email?: string;
    preferred?: boolean;
    credentials?: {
      name?: string;
      email?: string;
      password?: string;
      mfaCode?: string;
      confirmationLink?: string;
    };
  }): Promise<ConnectProviderAccountResponse>;
  acceptManagedShare(input: {
    provider: string;
    accountId: string;
    label: string;
    volumeId?: string;
    localPath?: string;
    remoteDescriptor?: Record<string, unknown>;
  }): Promise<{ summary: ManagedShareSummary }>;
  attachManagedShare(shareId: string, volumeId: string): Promise<{ summary: ManagedShareSummary }>;
  previewJoinLink(input: {
    serialized?: string;
    link?: unknown;
    preferredProviders?: string[];
  }): Promise<JoinLinkParseResponse>;
}

export async function openJoinLinkWithRuntime(
  input: {
    serialized?: string;
    link?: unknown;
    volumeId?: string;
    allowCredentialBootstrap?: boolean;
    preferredProviders?: string[];
  },
  deps: OpenJoinLinkDeps
): Promise<JoinLinkOpenResponse> {
  const [parseResult, accountsResult, sharesResult] = await Promise.all([
    deps.previewJoinLink({
      serialized: input.serialized,
      link: input.link,
      preferredProviders: input.preferredProviders,
    }),
    deps.listProviderAccounts({ fast: true }),
    deps.listManagedShares({ fast: true }),
  ]);

  const workingAccounts = [...accountsResult.accounts];
  const workingShares = [...sharesResult.shares];
  const actions: JoinLinkOpenResponse['actions'] = [];

  for (const planned of parseResult.plan.attachments) {
    const selected = planned.selectedEndpoint;
    if (!selected) {
      actions.push({
        attachmentId: planned.attachment.id,
        status: 'unsupported',
        detail: 'No supported transport is available for this attachment yet.',
      });
      continue;
    }

    const endpoint = selected.endpoint;
    if (endpoint.transport !== 'provider-share') {
      actions.push({
        attachmentId: planned.attachment.id,
        endpointTransport: endpoint.transport,
        provider: endpoint.provider,
        status: 'planned',
        detail: selected.reason,
      });
      continue;
    }

    const provider = normalizeProvider(endpoint.provider ?? '');
    const suggestedLocalPath = resolveJoinLinkSuggestedLocalPath(endpoint.descriptor);
    let account = workingAccounts.find((entry) => normalizeProvider(entry.provider) === provider && entry.state === 'connected');
    let usedCredentialBootstrap = false;

    if (!account && input.allowCredentialBootstrap && endpoint.bootstrap?.account) {
      try {
        const connected = await deps.connectProviderAccount({
          provider,
          mode: endpoint.bootstrap.account.mode,
          label: endpoint.bootstrap.account.label,
          email: endpoint.bootstrap.account.email,
          preferred: endpoint.bootstrap.account.preferred,
          credentials: endpoint.bootstrap.account.credentials,
        });
        usedCredentialBootstrap = true;
        if (connected.status === 'connected' && connected.account) {
          workingAccounts.push(connected.account);
          account = connected.account;
        } else {
          actions.push({
            attachmentId: planned.attachment.id,
            endpointTransport: endpoint.transport,
            provider,
            status: 'pending-auth',
            accountId: connected.account?.id ?? connected.authSession?.accountId,
            suggestedLocalPath,
            usedCredentialBootstrap,
            detail:
              connected.authSession?.detail ||
              `Finish ${provider || 'provider'} sign-in to continue attaching this route.`,
          });
          continue;
        }
      } catch (error) {
        if (isMissingPhoneRuntimeError(error)) {
          actions.push({
            attachmentId: planned.attachment.id,
            endpointTransport: endpoint.transport,
            provider,
            status: 'needs-account',
            suggestedLocalPath,
            usedCredentialBootstrap: true,
            detail: 'This phone runtime cannot complete provider sign-in yet. Finish this route on a runtime-backed device.',
          });
          continue;
        }
        actions.push({
          attachmentId: planned.attachment.id,
          endpointTransport: endpoint.transport,
          provider,
          status: 'needs-account',
          suggestedLocalPath,
          usedCredentialBootstrap: true,
          detail: error instanceof Error ? error.message : selected.reason,
        });
        continue;
      }
    }

    if (!account) {
      actions.push({
        attachmentId: planned.attachment.id,
        endpointTransport: endpoint.transport,
        provider,
        status: 'needs-account',
        suggestedLocalPath,
        detail: selected.reason,
      });
      continue;
    }

    const matchKey = selected.matchKey ?? undefined;
    let summary = workingShares.find((entry) => buildManagedShareMatchKeysFromSummary(entry).includes(matchKey ?? ''));

    if (!summary && input.volumeId) {
      try {
        const created = await deps.acceptManagedShare({
          provider,
          accountId: account.id,
          label: planned.attachment.label,
          volumeId: input.volumeId,
          localPath: suggestedLocalPath,
          remoteDescriptor: endpoint.descriptor,
        });
        summary = created.summary;
        workingShares.push(created.summary);
      } catch (error) {
        if (isMissingPhoneRuntimeError(error)) {
          actions.push({
            attachmentId: planned.attachment.id,
            endpointTransport: endpoint.transport,
            provider,
            accountId: account.id,
            status: 'planned',
            suggestedLocalPath,
            detail: 'This phone runtime can plan this provider route, but it cannot attach it on-device yet.',
          });
          continue;
        }
        throw error;
      }
    } else if (summary && input.volumeId) {
      try {
        await deps.attachManagedShare(summary.share.id, input.volumeId);
      } catch (error) {
        if (isMissingPhoneRuntimeError(error)) {
          actions.push({
            attachmentId: planned.attachment.id,
            endpointTransport: endpoint.transport,
            provider,
            accountId: account.id,
            shareId: summary.share.id,
            status: 'planned',
            suggestedLocalPath,
            detail: 'This phone runtime can see the existing managed share, but it cannot attach it on-device yet.',
          });
          continue;
        }
        throw error;
      }
    }

    actions.push({
      attachmentId: planned.attachment.id,
      endpointTransport: endpoint.transport,
      provider,
      accountId: account.id,
      status: summary && input.volumeId ? 'attached' : 'planned',
      shareId: summary?.share.id,
      suggestedLocalPath,
      usedCredentialBootstrap,
      detail: summary
        ? input.volumeId
          ? usedCredentialBootstrap
            ? 'Connected the provider from this link and attached the managed share to this hub.'
            : 'Attached the managed share to this hub.'
          : 'Matched an existing managed share.'
        : 'A connected provider is available for this route.',
    });
  }

  return {
    plan: parseResult.plan,
    space: parseResult.space,
    secret: joinLinkSpaceToSecretString(parseResult.space),
    volumeId: input.volumeId?.trim().toLowerCase() ?? (parseResult.space.mode === 'volume-id' ? parseResult.space.value : null),
    actions,
  };
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

function isMissingPhoneRuntimeError(error: unknown): boolean {
  return error instanceof Error && /phone runtime is missing|phone runtime capability is not implemented|runtime unavailable/iu.test(error.message);
}

function resolveJoinLinkSuggestedLocalPath(descriptor: Record<string, unknown>): string | undefined {
  if (typeof descriptor.localPathHint === 'string' && descriptor.localPathHint.trim() !== '') {
    return descriptor.localPathHint.trim();
  }
  if (typeof descriptor.localPath === 'string' && descriptor.localPath.trim() !== '') {
    return descriptor.localPath.trim();
  }
  return undefined;
}

export const defaultJoinLinkOpenDeps: OpenJoinLinkDeps = {
  listProviderAccounts: async () => ({ accounts: [], preferredProviders: [] }),
  listManagedShares: async () => ({ shares: [] }),
  connectProviderAccount: async () => ({ status: 'failed' }),
  acceptManagedShare: async () => {
    throw new Error('acceptManagedShare dependency is missing');
  },
  attachManagedShare: async () => {
    throw new Error('attachManagedShare dependency is missing');
  },
  previewJoinLink,
};