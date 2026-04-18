import { Capacitor } from '@capacitor/core';
import {
  listChat,
  listFiles,
  openVolume,
  publishIdentity,
  sendChatMessage,
  uploadFiles,
} from '../api.js';

import {
  clearNativeAutomationCommand,
  getNativeAutomationCommand,
  hasNativeLanPlugin,
  setNativeAutomationResult,
} from './nativeLanPlugin.js';
import {
  embeddedPhoneDebugListMegaOwnerMirrorFiles,
  embeddedPhoneDebugReadMegaOwnerMirrorFile,
  embeddedPhoneListManagedShares,
  embeddedPhoneListProviderAccounts,
  embeddedPhoneClearLanLatencyTraces,
  embeddedPhoneGetManagedShareState,
  embeddedPhoneGetManagedShareUploadProbes,
  embeddedPhoneGetLanLatencyTraces,
  embeddedPhoneGetLanVolumeInventory,
  embeddedPhoneListLanVolumeIds,
  embeddedPhoneListChat,
  embeddedPhoneListFiles,
  embeddedPhoneOpenVolume,
  embeddedPhonePublishIdentity,
  embeddedPhoneSendChatMessage,
  embeddedPhoneTriggerManagedShareSync,
  embeddedPhoneUploadFile,
} from './embeddedPhoneServices.js';
import type { IdentityProfile } from '../api.js';

// Keep automation pointed at the embedded phone runtime. These commands must inspect the same in-process
// backend/runtime that the phone app uses, not the separate dev API server.

type OpenVolumeCommand = {
  id: string;
  action: 'open-volume';
  secret: string;
};

type UiOpenVolumeCommand = {
  id: string;
  action: 'ui-open-volume';
  secret: string;
};

type PublishIdentityCommand = {
  id: string;
  action: 'publish-identity';
  secret: string;
  identitySecret: string;
  profile: IdentityProfile;
};

type SendChatMessageCommand = {
  id: string;
  action: 'send-chat-message';
  secret: string;
  identitySecret: string;
  body?: string;
};

type UploadFileCommand = {
  id: string;
  action: 'upload-file';
  secret: string;
  filename: string;
  mimeType?: string;
  contentBase64: string;
};

type ListFilesCommand = {
  id: string;
  action: 'list-files';
  secret: string;
};

type ListChatCommand = {
  id: string;
  action: 'list-chat';
  secret: string;
};

type WaitChatEventCommand = {
  id: string;
  action: 'wait-chat-event';
  secret: string;
  eventHash: string;
  timeoutMs?: number;
};

type GetLatencyTracesCommand = {
  id: string;
  action: 'get-latency-traces';
};

type ClearLatencyTracesCommand = {
  id: string;
  action: 'clear-latency-traces';
};

type ListLanVolumeIdsCommand = {
  id: string;
  action: 'list-lan-volume-ids';
};

type GetLanVolumeInventoryCommand = {
  id: string;
  action: 'get-lan-volume-inventory';
  volumeId: string;
};

type ListProviderAccountsCommand = {
  id: string;
  action: 'list-provider-accounts';
  fast?: boolean;
};

type ListManagedSharesCommand = {
  id: string;
  action: 'list-managed-shares';
  fast?: boolean;
};

type GetManagedShareStateCommand = {
  id: string;
  action: 'get-managed-share-state';
  shareId: string;
};

type TriggerManagedShareSyncCommand = {
  id: string;
  action: 'trigger-managed-share-sync';
  shareId: string;
};

type GetManagedShareUploadProbesCommand = {
  id: string;
  action: 'get-managed-share-upload-probes';
  shareId: string;
  path?: string;
  limit?: number;
};

type DebugListMegaOwnerMirrorFilesCommand = {
  id: string;
  action: 'debug-list-mega-owner-mirror-files';
  shareId: string;
  limit?: number;
};

type DebugReadMegaOwnerMirrorFileCommand = {
  id: string;
  action: 'debug-read-mega-owner-mirror-file';
  shareId: string;
  path: string;
};

type PhoneAutomationCommand =
  | OpenVolumeCommand
  | UiOpenVolumeCommand
  | PublishIdentityCommand
  | SendChatMessageCommand
  | UploadFileCommand
  | ListFilesCommand
  | ListChatCommand
  | WaitChatEventCommand
  | GetLatencyTracesCommand
  | ClearLatencyTracesCommand
  | ListLanVolumeIdsCommand
  | GetLanVolumeInventoryCommand
  | ListProviderAccountsCommand
  | ListManagedSharesCommand
  | GetManagedShareStateCommand
  | TriggerManagedShareSyncCommand
  | GetManagedShareUploadProbesCommand
  | DebugListMegaOwnerMirrorFilesCommand
  | DebugReadMegaOwnerMirrorFileCommand;

type PhoneAutomationResult = {
  id: string;
  action: PhoneAutomationCommand['action'];
  status: 'success' | 'error';
  startedAt: number;
  finishedAt: number;
  result?: unknown;
  message?: string;
  stack?: string;
};

let pendingExecution: Promise<boolean> | null = null;

export function hasPhoneAutomationBridge(): boolean {
  return import.meta.env.DEV && Capacitor.isNativePlatform() && hasNativeLanPlugin();
}

export async function processPendingPhoneAutomationCommand(): Promise<boolean> {
  if (!hasPhoneAutomationBridge()) {
    return false;
  }
  if (pendingExecution) {
    return pendingExecution;
  }

  pendingExecution = runPendingPhoneAutomationCommand().finally(() => {
    pendingExecution = null;
  });

  return pendingExecution;
}

async function runPendingPhoneAutomationCommand(): Promise<boolean> {
  const command = await readPendingPhoneAutomationCommand();
  if (!command) {
    return false;
  }

  const startedAt = Date.now();
  try {
    const result = await executePhoneAutomationCommand(command);
    await writePhoneAutomationResult({
      id: command.id,
      action: command.action,
      status: 'success',
      startedAt,
      finishedAt: Date.now(),
      result,
    });
  } catch (error) {
    await writePhoneAutomationResult({
      id: command.id,
      action: command.action,
      status: 'error',
      startedAt,
      finishedAt: Date.now(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    await clearNativeAutomationCommand();
  }

  return true;
}

async function readPendingPhoneAutomationCommand(): Promise<PhoneAutomationCommand | null> {
  const stored = await getNativeAutomationCommand();
  if (!stored) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }

  return normalizePhoneAutomationCommand(parsed);
}

function normalizePhoneAutomationCommand(value: unknown): PhoneAutomationCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = readRequiredString(candidate.id);
  const action = readRequiredString(candidate.action) as PhoneAutomationCommand['action'];

  if (!id) {
    return null;
  }

  if (action === 'open-volume') {
    const secret = readRequiredString(candidate.secret);
    return secret ? { id, action, secret } : null;
  }

  if (action === 'ui-open-volume') {
    const secret = readRequiredString(candidate.secret);
    return secret ? { id, action, secret } : null;
  }

  if (action === 'publish-identity') {
    const secret = readRequiredString(candidate.secret);
    const identitySecret = readRequiredString(candidate.identitySecret);
    const profile = normalizeIdentityProfile(candidate.profile);
    return secret && identitySecret && profile ? { id, action, secret, identitySecret, profile } : null;
  }

  if (action === 'send-chat-message') {
    const secret = readRequiredString(candidate.secret);
    const identitySecret = readRequiredString(candidate.identitySecret);
    const body = readOptionalString(candidate.body);
    return secret && identitySecret && body ? { id, action, secret, identitySecret, body } : null;
  }

  if (action === 'upload-file') {
    const secret = readRequiredString(candidate.secret);
    const filename = readRequiredString(candidate.filename);
    const contentBase64 = readRequiredString(candidate.contentBase64);
    const mimeType = readOptionalString(candidate.mimeType) ?? undefined;
    return secret && filename && contentBase64
      ? { id, action, secret, filename, mimeType, contentBase64 }
      : null;
  }

  if (action === 'list-files') {
    const secret = readRequiredString(candidate.secret);
    return secret ? { id, action, secret } : null;
  }

  if (action === 'list-chat') {
    const secret = readRequiredString(candidate.secret);
    return secret ? { id, action, secret } : null;
  }

  if (action === 'wait-chat-event') {
    const secret = readRequiredString(candidate.secret);
    const eventHash = readRequiredString(candidate.eventHash);
    const timeoutValue = typeof candidate.timeoutMs === 'number' ? candidate.timeoutMs : Number(candidate.timeoutMs);
    return secret && eventHash
      ? { id, action, secret, eventHash, timeoutMs: Number.isFinite(timeoutValue) ? timeoutValue : undefined }
      : null;
  }

  if (action === 'get-latency-traces') {
    return { id, action };
  }

  if (action === 'clear-latency-traces') {
    return { id, action };
  }

  if (action === 'list-lan-volume-ids') {
    return { id, action };
  }

  if (action === 'get-lan-volume-inventory') {
    const volumeId = readRequiredString(candidate.volumeId);
    return volumeId ? { id, action, volumeId } : null;
  }

  if (action === 'list-provider-accounts') {
    return {
      id,
      action,
      fast: candidate.fast === true,
    };
  }

  if (action === 'list-managed-shares') {
    return {
      id,
      action,
      fast: candidate.fast === true,
    };
  }

  if (action === 'get-managed-share-state') {
    const shareId = readRequiredString(candidate.shareId);
    return shareId ? { id, action, shareId } : null;
  }

  if (action === 'trigger-managed-share-sync') {
    const shareId = readRequiredString(candidate.shareId);
    return shareId ? { id, action, shareId } : null;
  }

  if (action === 'get-managed-share-upload-probes') {
    const shareId = readRequiredString(candidate.shareId);
    const path = readOptionalString(candidate.path) ?? undefined;
    const limitValue = typeof candidate.limit === 'number' ? candidate.limit : Number(candidate.limit);
    return shareId
      ? {
          id,
          action,
          shareId,
          path,
          limit: Number.isFinite(limitValue) ? limitValue : undefined,
        }
      : null;
  }

  if (action === 'debug-list-mega-owner-mirror-files') {
    const shareId = readRequiredString(candidate.shareId);
    const limitValue = typeof candidate.limit === 'number' ? candidate.limit : Number(candidate.limit);
    return shareId
      ? {
          id,
          action,
          shareId,
          limit: Number.isFinite(limitValue) ? limitValue : undefined,
        }
      : null;
  }

  if (action === 'debug-read-mega-owner-mirror-file') {
    const shareId = readRequiredString(candidate.shareId);
    const path = readRequiredString(candidate.path);
    return shareId && path ? { id, action, shareId, path } : null;
  }

  return null;
}

function normalizeIdentityProfile(value: unknown): IdentityProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const displayName = readRequiredString(candidate.displayName);
  if (!displayName) {
    return null;
  }
  const bio = readOptionalString(candidate.bio) ?? undefined;
  return {
    displayName,
    bio,
  };
}

function readRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function executePhoneAutomationCommand(command: PhoneAutomationCommand): Promise<unknown> {
  if (command.action === 'get-latency-traces') {
    return { traces: embeddedPhoneGetLanLatencyTraces() };
  }

  if (command.action === 'clear-latency-traces') {
    embeddedPhoneClearLanLatencyTraces();
    return { ok: true };
  }

  if (command.action === 'list-lan-volume-ids') {
    return { volumeIds: await embeddedPhoneListLanVolumeIds() };
  }

  if (command.action === 'get-lan-volume-inventory') {
    return embeddedPhoneGetLanVolumeInventory(command.volumeId);
  }

  if (command.action === 'list-provider-accounts') {
    return embeddedPhoneListProviderAccounts({ fast: command.fast });
  }

  if (command.action === 'list-managed-shares') {
    return embeddedPhoneListManagedShares({ fast: command.fast });
  }

  if (command.action === 'get-managed-share-state') {
    return embeddedPhoneGetManagedShareState(command.shareId);
  }

  if (command.action === 'trigger-managed-share-sync') {
    await embeddedPhoneTriggerManagedShareSync(command.shareId);
    return { ok: true, shareId: command.shareId };
  }

  if (command.action === 'get-managed-share-upload-probes') {
    return embeddedPhoneGetManagedShareUploadProbes(command.shareId, {
      relativePath: command.path,
      limit: command.limit,
    });
  }

  if (command.action === 'debug-list-mega-owner-mirror-files') {
    return embeddedPhoneDebugListMegaOwnerMirrorFiles(command.shareId, command.limit);
  }

  if (command.action === 'debug-read-mega-owner-mirror-file') {
    return embeddedPhoneDebugReadMegaOwnerMirrorFile(command.shareId, command.path);
  }

  if (command.action === 'open-volume') {
    return embeddedPhoneOpenVolume(command.secret);
  }

  if (command.action === 'ui-open-volume') {
    const opened = await openVolume(command.secret);
    const files = await listFiles({ type: 'secret', secret: command.secret });
    return {
      opened,
      files,
    };
  }

  if (command.action === 'publish-identity') {
    await openVolume(command.secret);
    return publishIdentity({ type: 'secret', secret: command.secret }, command.identitySecret, command.profile);
  }

  if (command.action === 'send-chat-message') {
    await openVolume(command.secret);
    return sendChatMessage({ type: 'secret', secret: command.secret }, command.identitySecret, {
      body: command.body,
    });
  }

  if (command.action === 'upload-file') {
    await openVolume(command.secret);
    const bytes = decodeBase64(command.contentBase64);
    const file = new File([bytes], command.filename, {
      type: command.mimeType ?? 'application/octet-stream',
    });
    return (await uploadFiles({ type: 'secret', secret: command.secret }, [file]))[0] ?? null;
  }

  if (command.action === 'list-files') {
    await openVolume(command.secret);
    return listFiles({ type: 'secret', secret: command.secret });
  }

  if (command.action === 'wait-chat-event') {
    await openVolume(command.secret);
    const deadline = Date.now() + Math.max(1_000, command.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      const chat = await embeddedPhoneListChat(command.secret);
      const message = chat.messages.find((entry) => entry.eventHash === command.eventHash);
      if (message) {
        return { eventHash: command.eventHash, message };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for chat event ${command.eventHash}`);
  }

  await openVolume(command.secret);
  return listChat({ type: 'secret', secret: command.secret });
}

async function writePhoneAutomationResult(result: PhoneAutomationResult): Promise<void> {
  await setNativeAutomationResult(JSON.stringify(result));
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
