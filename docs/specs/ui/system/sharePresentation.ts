type ManagedShareSummaryLike = {
  share: {
    provider: string;
    remoteDescriptor: Record<string, unknown>;
    capabilities: string[];
  };
  storage?: {
    writable?: boolean;
  };
};

type IncomingManagedShareOfferLike = {
  provider: string;
  remoteDescriptor: Record<string, unknown>;
};

type CollaboratorLike = {
  label: string;
  email?: string;
  role?: string;
  status: 'active' | 'invited';
  source: 'provider' | 'nearbytes';
};

type IncomingSharePresentation = {
  actionLabel: string;
  metaDetail: string;
  statusBadge: {
    label: string;
    tone: 'good' | 'muted';
  };
};

function descriptorAccessLevel(descriptor: Record<string, unknown>): string | null {
  const accessLevel = typeof descriptor.accessLevel === 'string' ? descriptor.accessLevel.trim() : '';
  return accessLevel || null;
}

function isWritableAccessLevel(accessLevel: string | null): boolean {
  const normalized = accessLevel?.trim().toLowerCase() ?? '';
  return normalized === 'read/write' || normalized === 'full access';
}

export function getManagedShareRemoteAccessLevel(summary: Pick<ManagedShareSummaryLike, 'share'>): string | null {
  return descriptorAccessLevel(summary.share.remoteDescriptor);
}

export function formatAccessLevelLabel(accessLevel: string): string {
  const normalized = accessLevel.trim().toLowerCase();
  switch (normalized) {
    case 'read':
      return 'Read only';
    case 'read/write':
      return 'Read and write';
    case 'full access':
      return 'Full access';
    case 'owner':
      return 'Owner';
    default:
      return accessLevel;
  }
}

export function getManagedShareAccessLabel(summary: Pick<ManagedShareSummaryLike, 'share' | 'storage'>): string {
  const remoteAccessLevel = getManagedShareRemoteAccessLevel(summary);
  if (summary.share.provider === 'mega' && remoteAccessLevel) {
    return formatAccessLevelLabel(remoteAccessLevel);
  }
  if (summary.storage?.writable === false) {
    return 'Read only';
  }
  return summary.share.capabilities.includes('write') ? 'Read and write' : 'Read only';
}

export function getIncomingSharePresentation(
  offer: Pick<IncomingManagedShareOfferLike, 'provider' | 'remoteDescriptor'>,
  options: { hasVolumeTarget: boolean }
): IncomingSharePresentation {
  const accessLevel = descriptorAccessLevel(offer.remoteDescriptor);
  if (offer.provider === 'mega' && accessLevel) {
    const writable = isWritableAccessLevel(accessLevel);
    return {
      actionLabel: options.hasVolumeTarget ? 'Use in this hub' : writable ? 'Add incoming share' : 'Add mirror',
      metaDetail: options.hasVolumeTarget ? 'Ready to add' : writable ? 'Saved as a local copy' : 'Saved as a mirror',
      statusBadge: {
        label: formatAccessLevelLabel(accessLevel),
        tone: writable ? 'good' : 'muted',
      },
    };
  }
  return {
    actionLabel: options.hasVolumeTarget ? 'Use in this hub' : 'Add mirror',
    metaDetail: options.hasVolumeTarget ? 'Ready to add' : 'Saved as a storage location',
    statusBadge: {
      label: 'Incoming storage',
      tone: 'muted',
    },
  };
}

export function getCollaboratorDisplayLabel(collaborator: Pick<CollaboratorLike, 'label' | 'email'>): string {
  const normalizedEmail = collaborator.email?.trim() || '';
  if (normalizedEmail) {
    return normalizedEmail;
  }
  return collaborator.label.trim();
}

export function getCollaboratorDedupeKey(collaborator: Pick<CollaboratorLike, 'label' | 'email'>): string {
  return getCollaboratorDisplayLabel(collaborator).toLowerCase();
}

export function getCollaboratorRoleLabel(collaborator: Pick<CollaboratorLike, 'role' | 'status' | 'source'>): string | null {
  const role = collaborator.role?.trim();
  if (role) {
    return formatAccessLevelLabel(role);
  }
  if (collaborator.status === 'invited') {
    return 'Invited';
  }
  return collaborator.source === 'nearbytes' ? 'Nearbytes' : null;
}

export const __test__ = {
  descriptorAccessLevel,
  isWritableAccessLevel,
};
