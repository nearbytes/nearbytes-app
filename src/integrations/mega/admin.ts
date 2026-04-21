import { Buffer } from 'buffer';
import {
  MEGA_KEY_MANAGER_ATTR_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG,
  MEGA_KEY_MANAGER_CREATION_TIME_TAG,
  MEGA_KEY_MANAGER_GENERATION_TAG,
  MEGA_KEY_MANAGER_IDENTITY_TAG,
  MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_RSA_TAG,
  MEGA_KEY_MANAGER_VERSION_TAG,
  MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_CU25519,
  MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_ED25519,
  MEGA_PRIVATE_ATTRIBUTE_KEYRING,
  MEGA_RECOVERY_KEY_MANAGER_TAGS,
  type MegaSession,
} from './core.js';
import { createMegaPasswordSession, megaApiCommandStandalone } from './auth.js';
import { encodeMegaKeyManagerPrivateRsaFromLogin } from './crypto.js';
import { waitForMegaRetry } from './errors.js';
import { MegaApiClient, decodeMegaBase64Url, encodeMegaBase64Url, type MegaFetchNodesSnapshot } from './protocol.js';
import type { MegaOwnerRemoteRoot } from './adapterTypes.js';
import {
  buildMegaKeyManagerUint32,
  buildMegaRecoveryKeyManagerContainer,
  fetchMegaKeyManagerState,
  fetchMegaPrivateAttributeRecords,
  fetchMegaPrivateAttributeValue,
  findMegaKeyManagerRecord,
  readMegaKeyManagerUint32,
} from './keyManager.js';
import {
  buildMegaUsersByHandle,
  megaOutgoingShareRecordNodeHandles,
  normalizeMegaRemoteDisplayPath,
  resolveMegaShareInviteTarget,
  resolveOutgoingSharePeerEmail,
} from './shareHelpers.js';
import {
  buildMegaRevokeShareCommand,
  createMegaMutationRequestId,
  deleteMegaNode,
  fetchMegaNodesSnapshot,
  fetchOwnerRootByPath,
} from './treeHelpers.js';
import { resolveMegaCloudDriveHandle } from './nodeCrypto.js';

async function clearMegaRubbishBin(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal
): Promise<void> {
  await megaApiCommandStandalone(apiClient, { a: 'dr', i: createMegaMutationRequestId() }, session, signal);
}

async function rebuildMegaSecurityAttribute(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal
): Promise<{ generation: number }> {
  const currentState = await fetchMegaKeyManagerState(apiClient, session, signal);
  const currentRecords = currentState.records;
  const identityFromSession = decodeMegaBase64Url(session.userHandle);
  if (identityFromSession.length !== 8) {
    throw new Error('MEGA user handle is invalid; cannot rebuild ^!keys.');
  }

  const existingVersion = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_VERSION_TAG)?.payload[0] ?? 1;
  const currentGeneration = readMegaKeyManagerUint32(
    findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_GENERATION_TAG)?.payload
  );
  const nowSeconds = Math.max(1, Math.floor(Date.now() / 1000));
  const nextGeneration = currentGeneration === undefined
    ? nowSeconds
    : currentGeneration >= 0xffff_ffff
      ? currentGeneration
      : (currentGeneration + 1) >>> 0;

  const existingCreationTime = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_CREATION_TIME_TAG)?.payload;
  const creationTime = existingCreationTime?.length === 4
    ? Buffer.from(existingCreationTime)
    : buildMegaKeyManagerUint32(nowSeconds);
  const existingIdentity = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_IDENTITY_TAG)?.payload;
  const identity = existingIdentity?.length === 8 && Buffer.from(existingIdentity).equals(identityFromSession)
    ? Buffer.from(existingIdentity)
    : Buffer.from(identityFromSession);
  const attr = Buffer.from(findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_ATTR_TAG)?.payload ?? Buffer.alloc(0));

  const existingPrivateEd25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG)?.payload;
  const existingPrivateCu25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG)?.payload;
  const existingPrivateRsa = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_PRIVATE_RSA_TAG)?.payload;
  const keyring = (!existingPrivateEd25519 || !existingPrivateCu25519)
    ? await fetchMegaPrivateAttributeRecords(apiClient, session, MEGA_PRIVATE_ATTRIBUTE_KEYRING, signal)
    : null;

  const privateEd25519 = Buffer.from(existingPrivateEd25519 ?? keyring?.get('prEd255') ?? Buffer.alloc(0));
  const privateCu25519 = Buffer.from(existingPrivateCu25519 ?? keyring?.get('prCu255') ?? Buffer.alloc(0));
  const privateRsa = Buffer.from(
    existingPrivateRsa ?? encodeMegaKeyManagerPrivateRsaFromLogin(session.encryptedPrivateKey, session.masterKey)
  );

  if (privateEd25519.length !== 32 || privateCu25519.length !== 32) {
    throw new Error('MEGA keyring is missing the Ed25519 or Cu25519 private key required to rebuild ^!keys.');
  }
  if (privateRsa.length < 512) {
    throw new Error('MEGA RSA private key payload is too short for a valid ^!keys rebuild.');
  }

  const existingAuthRingEd25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG)?.payload;
  const existingAuthRingCu25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG)?.payload;
  const authRingEd25519 = Buffer.from(
    existingAuthRingEd25519
      ?? (await fetchMegaPrivateAttributeValue(apiClient, session, MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_ED25519, '', signal))
      ?? Buffer.alloc(0)
  );
  const authRingCu25519 = Buffer.from(
    existingAuthRingCu25519
      ?? (await fetchMegaPrivateAttributeValue(apiClient, session, MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_CU25519, '', signal))
      ?? Buffer.alloc(0)
  );

  const otherRecords = currentRecords
    .filter((record) => !MEGA_RECOVERY_KEY_MANAGER_TAGS.has(record.tag))
    .map((record) => ({
      tag: record.tag,
      payload: Buffer.from(record.payload),
    }));

  const rebuiltContainer = buildMegaRecoveryKeyManagerContainer(
    {
      version: existingVersion > 0 ? existingVersion : 1,
      creationTime,
      identity,
      generation: nextGeneration > 0 ? nextGeneration : nowSeconds,
      attr,
      privateEd25519,
      privateCu25519,
      privateRsa,
      authRingEd25519,
      authRingCu25519,
      otherRecords,
    },
    session.masterKey
  );

  await megaApiCommandStandalone(
    apiClient,
    { a: 'up2', '^!keys': encodeMegaBase64Url(rebuiltContainer) },
    session,
    signal
  );

  const verifiedState = await fetchMegaKeyManagerState(apiClient, session, signal);
  const verifiedGeneration = readMegaKeyManagerUint32(
    findMegaKeyManagerRecord(verifiedState.records, MEGA_KEY_MANAGER_GENERATION_TAG)?.payload
  );
  if (!verifiedGeneration) {
    throw new Error('MEGA ^!keys rebuild could not be verified.');
  }
  return { generation: verifiedGeneration };
}

function resolveRubbishBinHandle(snapshot: MegaFetchNodesSnapshot): string | undefined {
  for (const node of snapshot.nodes) {
    if (Number(node.t ?? 0) === 4 && typeof node.h === 'string' && node.h.trim()) {
      return node.h.trim();
    }
  }
  return undefined;
}

function collectDirectChildHandles(snapshot: MegaFetchNodesSnapshot, parentHandle: string): string[] {
  const directChildren: string[] = [];
  for (const node of snapshot.nodes) {
    const handle = typeof node.h === 'string' ? node.h.trim() : '';
    if (!handle) {
      continue;
    }
    const parent = typeof node.p === 'string' ? node.p.trim() : '';
    if (parent === parentHandle) {
      directChildren.push(handle);
    }
  }
  return directChildren;
}

async function wipeMegaSubtreeHandles(
  apiClient: MegaApiClient,
  session: MegaSession,
  handles: readonly string[],
  signal?: AbortSignal
): Promise<void> {
  for (const handle of handles) {
    await deleteMegaNode(apiClient, session, handle, signal);
    await waitForMegaRetry(25, signal);
  }
}

export async function revokeMegaOutgoingSharesForPeers(options: {
  email: string;
  password: string;
  peerEmails: readonly string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ revokedCount: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to revoke MEGA shares: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(apiClient, undefined, options.email.trim(), options.password);
  const peerSet = new Set(
    options.peerEmails.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0)
  );
  if (peerSet.size === 0) {
    return { revokedCount: 0 };
  }

  const doneKeys = new Set<string>();
  let revokedCount = 0;
  const signal = options.signal;

  for (let round = 0; round < 10; round += 1) {
    const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
    const usersByHandle = buildMegaUsersByHandle(snapshot);
    const pendingContactsByHandle = new Map<string, string>();
    for (const pending of snapshot.outgoingPendingContacts) {
      const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
      const mail = typeof pending.e === 'string' ? pending.e.trim() : '';
      if (handle && mail) {
        pendingContactsByHandle.set(handle, mail);
      }
    }

    let revokedThisRound = 0;
    for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
      const peerRaw = resolveOutgoingSharePeerEmail(record, usersByHandle, pendingContactsByHandle)?.trim();
      if (!peerRaw || !peerSet.has(peerRaw.toLowerCase())) {
        continue;
      }
      const handles = megaOutgoingShareRecordNodeHandles(record);
      const nodeHandle = handles[0];
      if (!nodeHandle) {
        continue;
      }
      const dedupeKey = `${nodeHandle}:${peerRaw.toLowerCase()}`;
      if (doneKeys.has(dedupeKey)) {
        continue;
      }

      const invitee = resolveMegaShareInviteTarget(snapshot, peerRaw);
      const command = buildMegaRevokeShareCommand(nodeHandle, invitee);
      await megaApiCommandStandalone(apiClient, command, session, signal);
      doneKeys.add(dedupeKey);
      revokedThisRound += 1;
      revokedCount += 1;
      await waitForMegaRetry(250, signal);
    }

    if (revokedThisRound === 0) {
      break;
    }
  }

  return { revokedCount };
}

export async function wipeMegaCloudDriveContentsForE2e(options: {
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ deletedNodeCount: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to wipe MEGA: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(apiClient, undefined, options.email, options.password);

  let deleted = 0;
  const signal = options.signal;

  for (let round = 0; round < 12; round += 1) {
    const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
    const cloudHandle = resolveMegaCloudDriveHandle(snapshot);
    if (!cloudHandle) {
      throw new Error('MEGA snapshot did not include a Cloud Drive root.');
    }
    const underDrive = collectDirectChildHandles(snapshot, cloudHandle);
    if (underDrive.length > 0) {
      await wipeMegaSubtreeHandles(apiClient, session, underDrive, signal);
      deleted += underDrive.length;
      continue;
    }

    const rubbish = resolveRubbishBinHandle(snapshot);
    if (!rubbish) {
      break;
    }
    const inRubbish = collectDirectChildHandles(snapshot, rubbish);
    if (inRubbish.length === 0) {
      break;
    }
    await clearMegaRubbishBin(apiClient, session, signal);
    await waitForMegaRetry(250, signal);
    deleted += inRubbish.length;
  }

  return { deletedNodeCount: deleted };
}

export async function clearMegaRemotePathForE2e(options: {
  email: string;
  password: string;
  remotePath: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ deletedNodeCount: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to clear a MEGA path: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const normalizedPath = normalizeMegaRemoteDisplayPath(options.remotePath);
  if (normalizedPath === '/') {
    return wipeMegaCloudDriveContentsForE2e(options);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(apiClient, undefined, options.email.trim(), options.password);
  const signal = options.signal;

  let root: MegaOwnerRemoteRoot;
  try {
    root = await fetchOwnerRootByPath(apiClient, session, normalizedPath, signal);
  } catch (error) {
    if (error instanceof Error && /is missing\b/u.test(error.message)) {
      return { deletedNodeCount: 0 };
    }
    throw error;
  }

  await wipeMegaSubtreeHandles(apiClient, session, [root.root.handle], signal);
  await waitForMegaRetry(250, signal);

  const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
  const rubbish = resolveRubbishBinHandle(snapshot);
  if (rubbish && collectDirectChildHandles(snapshot, rubbish).length > 0) {
    await clearMegaRubbishBin(apiClient, session, signal);
  }

  return { deletedNodeCount: 1 };
}

export async function rebuildMegaSecurityAttributeForE2e(options: {
  email: string;
  password: string;
  mfaCode?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ generation: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to rebuild MEGA ^!keys: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(
    apiClient,
    undefined,
    options.email.trim(),
    options.password,
    options.mfaCode
  );
  return rebuildMegaSecurityAttribute(apiClient, session, options.signal);
}

export async function resetMegaSecurityAttributeForE2e(options: {
  email: string;
  password: string;
  mfaCode?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  await rebuildMegaSecurityAttributeForE2e(options);
}