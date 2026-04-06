import type { JoinLinkOpenResponse, JoinLinkParseResponse } from './api.js';

type JoinLinkAttachment = JoinLinkParseResponse['plan']['attachments'][number];
type JoinLinkEndpoint = NonNullable<JoinLinkAttachment['selectedEndpoint']>;
type JoinLinkAction = JoinLinkOpenResponse['actions'][number];

export function joinDialogEndpointLabel(candidate: JoinLinkEndpoint): string {
  const endpoint = candidate.endpoint;
  const provider = endpoint.provider?.trim().toLowerCase() || '';
  const providerLabel =
    provider === 'mega'
      ? 'MEGA'
      : provider === 'gdrive'
        ? 'Google Drive'
        : provider === 'github'
          ? 'GitHub'
          : endpoint.provider?.trim() || '';

  if (candidate.badges.includes('Connected') && providerLabel !== '') {
    return `${providerLabel} ready here`;
  }
  if (candidate.badges.includes('Suggested folder') && providerLabel !== '') {
    return `${providerLabel} suggested`;
  }
  if (providerLabel !== '') {
    return `Via ${providerLabel}`;
  }
  if (endpoint.transport === 'provider-share') {
    return 'Provider route';
  }
  return `Via ${endpoint.transport}`;
}

export function joinDialogSpaceSummary(space: JoinLinkParseResponse['space']): string {
  if (space.mode === 'volume-id') {
    return 'Needs separate secret';
  }
  if (space.mode === 'secret-file') {
    return 'Secret file included';
  }
  return space.password ? 'Secret and password included' : 'Secret included';
}

export function joinDialogActionTone(status: JoinLinkAction['status']): 'success' | 'warning' | 'neutral' {
  if (status === 'attached') {
    return 'success';
  }
  if (status === 'needs-account' || status === 'pending-auth' || status === 'unsupported') {
    return 'warning';
  }
  return 'neutral';
}

export function joinDialogActionStatusLabel(action: JoinLinkAction): string {
  if (action.status === 'attached') return 'Added';
  if (action.status === 'planned') return 'Recognized';
  if (action.status === 'needs-account') return 'Sign in needed';
  if (action.status === 'pending-auth') return 'Finish sign-in';
  return 'Unavailable';
}

export function joinDialogActionTitle(action: JoinLinkAction): string {
  const provider =
    action.provider === 'mega'
      ? 'MEGA'
      : action.provider === 'gdrive'
        ? 'Google Drive'
        : action.provider === 'github'
          ? 'GitHub'
          : action.provider || action.endpointTransport || 'Route';

  if (action.status === 'attached') {
    return `${provider} storage added to this hub`;
  }
  if (action.status === 'planned') {
    return `${provider} storage found`;
  }
  if (action.status === 'needs-account') {
    return `Connect ${provider}`;
  }
  if (action.status === 'pending-auth') {
    return `Finish ${provider} sign-in`;
  }
  return `${provider} storage unavailable`;
}

export function joinDialogAttachmentTitle(attachment: JoinLinkAttachment): string {
  const rawLabel = attachment.attachment.label.trim();
  const normalized = rawLabel.toLowerCase();
  const provider = attachment.selectedEndpoint?.endpoint.provider?.trim().toLowerCase() || '';
  const providerLabel =
    provider === 'mega'
      ? 'MEGA'
      : provider === 'gdrive'
        ? 'Google Drive'
        : provider === 'github'
          ? 'GitHub'
          : attachment.selectedEndpoint?.endpoint.provider?.trim() || '';

  if (normalized === '' || normalized === 'nearbytes' || normalized === 'shared storage' || normalized === 'share') {
    return providerLabel !== '' ? `${providerLabel} shared storage` : 'Shared storage';
  }

  return rawLabel;
}