export interface ConfiguredIdentity {
  id: string;
  address: string;
  password: string;
  secretFilePayload: string;
  secretFileName: string;
  secretFileMimeType: string;
  displayName: string;
  bio: string;
  avatarDataUrl: string;
  avatarFileName: string;
  avatarMimeType: string;
  publicKey?: string;
  createdAt: number;
}

const CHAT_IDENTITIES_KEY = 'nearbytes-chat-identities-v1';
const ACTIVE_CHAT_IDENTITY_KEY = 'nearbytes-chat-active-identity-v1';
const VOLUME_CHAT_IDENTITY_KEY = 'nearbytes-chat-volume-identity-v1';

export function createConfiguredIdentity(overrides: Partial<ConfiguredIdentity> = {}): ConfiguredIdentity {
  return {
    id: overrides.id ?? `identity-${Math.random().toString(16).slice(2, 10)}`,
    address: typeof overrides.address === 'string' ? overrides.address.trim() : '',
    password: typeof overrides.password === 'string' ? overrides.password.trim() : '',
    secretFilePayload:
      typeof overrides.secretFilePayload === 'string' ? overrides.secretFilePayload.trim() : '',
    secretFileName: typeof overrides.secretFileName === 'string' ? overrides.secretFileName.trim() : '',
    secretFileMimeType:
      typeof overrides.secretFileMimeType === 'string' ? overrides.secretFileMimeType.trim() : '',
    displayName: typeof overrides.displayName === 'string' ? overrides.displayName.trim() : '',
    bio: typeof overrides.bio === 'string' ? overrides.bio.trim() : '',
    avatarDataUrl: typeof overrides.avatarDataUrl === 'string' ? overrides.avatarDataUrl.trim() : '',
    avatarFileName: typeof overrides.avatarFileName === 'string' ? overrides.avatarFileName.trim() : '',
    avatarMimeType: typeof overrides.avatarMimeType === 'string' ? overrides.avatarMimeType.trim() : '',
    publicKey: typeof overrides.publicKey === 'string' ? overrides.publicKey.trim().toLowerCase() : undefined,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

export function normalizeConfiguredIdentities(value: unknown): ConfiguredIdentity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Partial<ConfiguredIdentity>)
    .filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.address === 'string' &&
        typeof item.password === 'string' &&
        (item.secretFilePayload === undefined || typeof item.secretFilePayload === 'string') &&
        (item.secretFileName === undefined || typeof item.secretFileName === 'string') &&
        (item.secretFileMimeType === undefined || typeof item.secretFileMimeType === 'string') &&
        typeof item.displayName === 'string' &&
        typeof item.bio === 'string' &&
        (item.avatarDataUrl === undefined || typeof item.avatarDataUrl === 'string') &&
        (item.avatarFileName === undefined || typeof item.avatarFileName === 'string') &&
        (item.avatarMimeType === undefined || typeof item.avatarMimeType === 'string') &&
        (item.publicKey === undefined || typeof item.publicKey === 'string')
    )
    .map((item) =>
      createConfiguredIdentity({
        id: item.id,
        address: item.address,
        password: item.password,
        secretFilePayload: item.secretFilePayload,
        secretFileName: item.secretFileName,
        secretFileMimeType: item.secretFileMimeType,
        displayName: item.displayName,
        bio: item.bio,
        avatarDataUrl: item.avatarDataUrl,
        avatarFileName: item.avatarFileName,
        avatarMimeType: item.avatarMimeType,
        publicKey: item.publicKey,
        createdAt: item.createdAt,
      })
    );
}

export function loadConfiguredIdentities(): ConfiguredIdentity[] {
  try {
    const raw = localStorage.getItem(CHAT_IDENTITIES_KEY);
    if (!raw) {
      return [];
    }
    return normalizeConfiguredIdentities(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function persistConfiguredIdentities(identities: ConfiguredIdentity[]): void {
  try {
    localStorage.setItem(CHAT_IDENTITIES_KEY, JSON.stringify(identities));
  } catch {
    // ignore
  }
}

export function loadActiveIdentityId(): string {
  try {
    return localStorage.getItem(ACTIVE_CHAT_IDENTITY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function persistActiveIdentityId(identityId: string): void {
  try {
    localStorage.setItem(ACTIVE_CHAT_IDENTITY_KEY, identityId);
  } catch {
    // ignore
  }
}

export function loadVolumeIdentityAssignments(): Record<string, string> {
  try {
    const raw = localStorage.getItem(VOLUME_CHAT_IDENTITY_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string'
      )
    );
  } catch {
    return {};
  }
}

export function persistVolumeIdentityAssignments(assignments: Record<string, string>): void {
  try {
    localStorage.setItem(VOLUME_CHAT_IDENTITY_KEY, JSON.stringify(assignments));
  } catch {
    // ignore
  }
}

export function buildIdentitySecret(identity: ConfiguredIdentity): string {
  const secretFilePayload = identity.secretFilePayload.trim();
  if (secretFilePayload !== '') {
    return secretFilePayload;
  }
  const address = identity.address.trim();
  const password = identity.password.trim();
  return password ? `${address}:${password}` : address;
}

export function hasConfiguredIdentitySecret(identity: ConfiguredIdentity): boolean {
  return buildIdentitySecret(identity).trim() !== '';
}
