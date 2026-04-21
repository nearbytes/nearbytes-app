import { Buffer } from 'buffer';
import type { MegaFetchNodesSnapshot, MegaUserRecord } from './protocol.js';
import { getMegaNodeFs, randomBytes } from './runtime.js';
import {
  MEGA_MANIFEST_PREFIX,
  MEGA_SECRET_PREFIX,
  MEGA_SHARE_ACCESS_LEVEL_FULL,
  MEGA_SHARE_ACCESS_LEVEL_READ_ONLY,
  MEGA_SHARE_ACCESS_LEVEL_READ_WRITE,
  MEGA_SHARE_INVITE_NON_CONTACT_USER,
} from './adapterConstants.js';
import type { MegaShareInviteTarget } from './adapterTypes.js';
import { managedSharePath as path } from '../managedSharePath.js';
import type {
  IncomingProviderContactInvite,
  ManagedShare,
  ManagedShareCollaborator,
} from '../types.js';

export function secretKey(accountId: string): string {
  return `${MEGA_SECRET_PREFIX}${accountId}`;
}

export function mirrorManifestKey(shareId: string): string {
  return `${MEGA_MANIFEST_PREFIX}${shareId}`;
}

export function createOpaqueId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

export function isZeroBuffer(value: Buffer): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) {
      return false;
    }
  }
  return true;
}

export function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const result = Buffer.alloc(Math.min(left.length, right.length));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = left[index]! ^ right[index]!;
  }
  return result;
}

export function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

export function megaOutgoingShareRecordNodeHandles(record: Record<string, unknown>): string[] {
  const handles: string[] = [];
  for (const key of ['h', 't'] as const) {
    const raw = record[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) {
        handles.push(trimmed);
      }
    }
  }
  return [...new Set(handles)];
}

export function resolveMegaShareInviteTarget(snapshot: MegaFetchNodesSnapshot, email: string): MegaShareInviteTarget {
  const normalized = email.trim().toLowerCase();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    const mail = typeof user.m === 'string' ? user.m.trim().toLowerCase() : '';
    if (handle && mail === normalized) {
      return { u: handle };
    }
  }
  const trimmed = email.trim();
  return trimmed ? { u: MEGA_SHARE_INVITE_NON_CONTACT_USER, e: trimmed } : { u: MEGA_SHARE_INVITE_NON_CONTACT_USER };
}

export function resolveMegaPendingOutShareTarget(invitee: MegaShareInviteTarget): string {
  const user = invitee.u.trim();
  if (user && user !== MEGA_SHARE_INVITE_NON_CONTACT_USER) {
    return user;
  }
  return invitee.e?.trim() ?? '';
}

export function isMegaUserHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/u.test(value.trim());
}

export function isMegaNodeHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{8}$/u.test(value.trim());
}

export function isMegaRecordHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,11}$/u.test(value.trim());
}

export function isMegaKeyOwnerHandle(value: string): boolean {
  const normalized = value.trim();
  return isMegaRecordHandle(normalized) || isMegaUserHandle(normalized);
}

export function resolveOutgoingSharePeerEmail(
  record: Record<string, unknown>,
  usersByHandle: Map<string, MegaUserRecord>,
  pendingContactsByHandle: ReadonlyMap<string, string>
): string | undefined {
  const pendingHandle = typeof record.p === 'string' ? record.p.trim() : '';
  if (pendingHandle) {
    const fromPending = pendingContactsByHandle.get(pendingHandle)?.trim();
    if (fromPending) {
      return fromPending;
    }
  }
  const userRaw = typeof record.u === 'string' ? record.u.trim() : '';
  if (!userRaw) {
    return undefined;
  }
  if (userRaw.includes('@')) {
    return userRaw;
  }
  const fromUser = usersByHandle.get(userRaw)?.m;
  return typeof fromUser === 'string' && fromUser.trim() ? fromUser.trim() : undefined;
}

export function buildMegaUsersByHandle(snapshot: MegaFetchNodesSnapshot): Map<string, MegaUserRecord> {
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    if (handle) {
      usersByHandle.set(handle, user);
    }
  }
  return usersByHandle;
}

export function collectMegaOwnerShareInviteTargets(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle?: string
): MegaShareInviteTarget[] {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const pendingContactsByHandle = new Map<string, string>();
  for (const pending of snapshot.outgoingPendingContacts) {
    const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
    const email = typeof pending.e === 'string' ? pending.e.trim() : '';
    if (handle && email) {
      pendingContactsByHandle.set(handle, email);
    }
  }

  const targets = new Map<string, MegaShareInviteTarget>();
  const records = [...snapshot.outgoingShares, ...snapshot.pendingShares];
  for (const record of records) {
    const recordHandles = megaOutgoingShareRecordNodeHandles(record);
    if (
      !recordHandles.some(
        (handle) =>
          handle === rootNodeHandle || (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      continue;
    }

    const userHandle = typeof record.u === 'string' ? record.u.trim() : '';
    const email = resolveOutgoingSharePeerEmail(record, usersByHandle, pendingContactsByHandle)?.trim();
    if (isMegaUserHandle(userHandle)) {
      targets.set(`user:${userHandle}`, email ? { u: userHandle, e: email } : { u: userHandle });
      continue;
    }
    if (email) {
      targets.set(`email:${email.toLowerCase()}`, { u: MEGA_SHARE_INVITE_NON_CONTACT_USER, e: email });
    }
  }

  return [...targets.values()];
}

export function collectMegaOwnerCollaborators(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle?: string
): ManagedShareCollaborator[] {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const pendingContactsByHandle = new Map<string, string>();
  for (const pending of snapshot.outgoingPendingContacts) {
    const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
    const email = typeof pending.e === 'string' ? pending.e.trim() : '';
    if (handle && email) {
      pendingContactsByHandle.set(handle, email);
    }
  }

  const collaborators = new Map<string, ManagedShareCollaborator>();
  const records = [...snapshot.outgoingShares, ...snapshot.pendingShares];
  for (const record of records) {
    const recordHandles = megaOutgoingShareRecordNodeHandles(record);
    if (
      !recordHandles.some(
        (handle) =>
          handle === rootNodeHandle || (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      continue;
    }
    const pendingHandle = typeof record.p === 'string' ? record.p.trim() : '';
    const email = resolveOutgoingSharePeerEmail(record, usersByHandle, pendingContactsByHandle);
    if (!email) {
      continue;
    }

    const key = email.toLowerCase();
    const collaborator: ManagedShareCollaborator = {
      label: email,
      email,
      role: describeAccessLevel(Number(record.r ?? 0)),
      status: pendingHandle ? 'invited' : 'active',
      source: 'provider',
    };
    const existing = collaborators.get(key);
    if (!existing || existing.status === 'invited') {
      collaborators.set(key, collaborator);
    }
  }

  return [...collaborators.values()].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'active' ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
}

export function snapshotReflectsOutgoingInvitees(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle: string | undefined,
  expectedLowercaseEmails: readonly string[]
): boolean {
  if (expectedLowercaseEmails.length === 0) {
    return true;
  }
  const fromCollaborators = new Set(
    collectMegaOwnerCollaborators(snapshot, rootNodeHandle, rootShareHandle)
      .map((collaborator) => collaborator.email?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value))
  );
  const pendingByHandle = new Map<string, string>();
  for (const pending of snapshot.outgoingPendingContacts) {
    const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
    const mail = typeof pending.e === 'string' ? pending.e.trim().toLowerCase() : '';
    if (handle && mail) {
      pendingByHandle.set(handle, mail);
    }
  }
  const fromRawRows = new Set<string>();
  for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
    const recordHandles = megaOutgoingShareRecordNodeHandles(record);
    if (
      !recordHandles.some(
        (handle) =>
          handle === rootNodeHandle ||
          (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      continue;
    }
    const userRaw = typeof record.u === 'string' ? record.u.trim() : '';
    if (userRaw.includes('@')) {
      fromRawRows.add(userRaw.toLowerCase());
    }
    const pending = typeof record.p === 'string' ? record.p.trim() : '';
    const pendingEmail = pending ? pendingByHandle.get(pending) : undefined;
    if (pendingEmail) {
      fromRawRows.add(pendingEmail);
    }
  }
  return expectedLowercaseEmails.every((email) => fromCollaborators.has(email) || fromRawRows.has(email));
}

export function countMegaOwnerSharePeers(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle?: string
): number {
  return collectMegaOwnerShareInviteTargets(snapshot, rootNodeHandle, rootShareHandle).length;
}

export function snapshotHasOutgoingShareForRoot(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle: string | undefined
): boolean {
  for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
    const handles = megaOutgoingShareRecordNodeHandles(record);
    if (
      handles.some(
        (handle) =>
          handle === rootNodeHandle || (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      return true;
    }
  }
  return false;
}

export function getMegaShareRemotePath(share: ManagedShare, fallbackPath: string): string {
  return getStringDescriptor(share.remoteDescriptor, 'remotePath') ?? fallbackPath;
}

export async function ensureMegaOwnerLocalStructure(localPath: string): Promise<void> {
  const fs = await getMegaNodeFs();
  await Promise.all([
    fs.mkdir(path.join(localPath, 'blocks'), { recursive: true }),
    fs.mkdir(path.join(localPath, 'channels'), { recursive: true }),
  ]);
}

export function describeMegaOwnerSyncFailure(error: unknown, remotePath: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return `Nearbytes timed out while syncing the MEGA owner folder ${remotePath}. Open the runtime logs and retry.`;
  }
  if (/login|session|auth|credential|password/i.test(message)) {
    return `Nearbytes could not refresh the saved MEGA sign-in for the writable owner sync at ${remotePath}. It will retry automatically. ${message}`.trim();
  }
  return `Nearbytes could not sync the writable MEGA owner folder ${remotePath}. ${message}`.trim();
}

export function annotateMegaOwnerSyncPhaseError(phase: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const annotated = new Error(`${phase}: ${message}`);
  if (error instanceof Error) {
    annotated.name = error.name;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number' || typeof code === 'string') {
      (annotated as Error & { code?: number | string }).code = code;
    }
    (annotated as Error & { cause?: unknown }).cause = error;
  }
  return annotated;
}

export function normalizeMegaRemoteDisplayPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed) {
    return '/';
  }
  const normalized = path.posix.normalize(trimmed);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function mapIncomingMegaContactInvite(
  invite: Record<string, unknown>,
  accountId: string,
  provider: string
): IncomingProviderContactInvite | null {
  const id = typeof invite.p === 'string' ? invite.p.trim() : '';
  const label = typeof invite.m === 'string' ? invite.m.trim() : '';
  if (!id || !label) {
    return null;
  }
  return {
    id,
    provider,
    accountId,
    label,
    detail: `${label} wants to connect on MEGA.`,
  };
}

export function acceptedShareCapabilities(descriptor: Record<string, unknown>): string[] {
  return megaAccessLevelAllowsWrites(getStringDescriptor(descriptor, 'accessLevel'))
    ? ['mirror', 'read', 'write', 'accept']
    : ['mirror', 'read', 'accept'];
}

export function resolveMegaInviteAccessLevel(accessLevel: string | undefined): number {
  const normalized = accessLevel?.trim().toLowerCase() ?? '';
  switch (normalized) {
    case 'read/write':
      return MEGA_SHARE_ACCESS_LEVEL_READ_WRITE;
    case 'full access':
      return MEGA_SHARE_ACCESS_LEVEL_FULL;
    default:
      return MEGA_SHARE_ACCESS_LEVEL_READ_ONLY;
  }
}

export function megaAccessLevelAllowsWrites(accessLevel: string | undefined): boolean {
  const normalized = accessLevel?.trim().toLowerCase() ?? '';
  return normalized === 'read/write' || normalized === 'full access' || normalized === 'owner';
}

export function incomingShareMatches(candidate: Record<string, unknown>, target: Record<string, unknown>): boolean {
  const candidateHandle = getStringDescriptor(candidate, 'rootHandle') ?? getStringDescriptor(candidate, 'shareHandle');
  const targetHandle = getStringDescriptor(target, 'rootHandle') ?? getStringDescriptor(target, 'shareHandle');
  if (candidateHandle && targetHandle) {
    return candidateHandle === targetHandle;
  }
  return (
    getStringDescriptor(candidate, 'remotePath') === getStringDescriptor(target, 'remotePath') &&
    getStringDescriptor(candidate, 'ownerEmail') === getStringDescriptor(target, 'ownerEmail')
  );
}

export function buildOwnerShareHealCooldownKey(shareId: string, shareHandle: string | undefined): string {
  const normalizedHandle = typeof shareHandle === 'string' ? shareHandle.trim().toLowerCase() : '';
  return normalizedHandle ? `${shareId}:${normalizedHandle}` : shareId;
}

export function isLegacyMegaLocalMirror(share: ManagedShare): boolean {
  return share.remoteDescriptor?.legacyLocalMirror === true && getStringDescriptor(share.remoteDescriptor, 'remotePath') === '/nearbytes';
}

export function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value.trim();
}

export function getStringDescriptor(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function normalizeMegaIncomingShareName(name: string | undefined, handle: string): string {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return normalized || `MEGA share ${handle.slice(-6)}`;
}

export function normalizeMegaIncomingOwnerIdentity(ownerEmail: string | undefined, ownerHandle: string | undefined): string {
  const email = typeof ownerEmail === 'string' ? ownerEmail.trim() : '';
  if (email) {
    return email;
  }
  const handle = typeof ownerHandle === 'string' ? ownerHandle.trim() : '';
  return handle || 'unknown-owner';
}

export function normalizeMegaIncomingOwnerLabel(ownerEmail: string | undefined, ownerHandle: string | undefined): string {
  const identity = normalizeMegaIncomingOwnerIdentity(ownerEmail, ownerHandle);
  return identity === 'unknown-owner' ? 'Unknown MEGA owner' : identity;
}

export function describeAccessLevel(level: number): string {
  switch (level) {
    case 0:
      return 'read';
    case 1:
      return 'read/write';
    case 2:
      return 'full access';
    case 3:
      return 'owner';
    default:
      return String(level);
  }
}