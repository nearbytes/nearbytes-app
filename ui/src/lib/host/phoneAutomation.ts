import { Capacitor } from '@capacitor/core';

import {
  clearNativeAutomationCommand,
  getNativeAutomationCommand,
  hasNativeLanPlugin,
  setNativeAutomationResult,
} from './nativeLanPlugin.js';
import {
  embeddedPhoneListChat,
  embeddedPhoneListFiles,
  embeddedPhoneOpenVolume,
  embeddedPhonePublishIdentity,
  embeddedPhoneSendChatMessage,
  embeddedPhoneUploadFile,
} from './embeddedPhoneServices.js';
import type { IdentityProfile } from '../api.js';

type OpenVolumeCommand = {
  id: string;
  action: 'open-volume';
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

type PhoneAutomationCommand =
  | OpenVolumeCommand
  | PublishIdentityCommand
  | SendChatMessageCommand
  | UploadFileCommand
  | ListFilesCommand
  | ListChatCommand;

type PhoneAutomationResult = {
  id: string;
  action: PhoneAutomationCommand['action'];
  status: 'success' | 'error';
  startedAt: number;
  finishedAt: number;
  result?: unknown;
  message?: string;
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
  if (command.action === 'open-volume') {
    return embeddedPhoneOpenVolume(command.secret);
  }

  if (command.action === 'publish-identity') {
    await embeddedPhoneOpenVolume(command.secret);
    return embeddedPhonePublishIdentity(command.secret, command.identitySecret, command.profile);
  }

  if (command.action === 'send-chat-message') {
    await embeddedPhoneOpenVolume(command.secret);
    return embeddedPhoneSendChatMessage(command.secret, command.identitySecret, {
      body: command.body,
    });
  }

  if (command.action === 'upload-file') {
    await embeddedPhoneOpenVolume(command.secret);
    const bytes = decodeBase64(command.contentBase64);
    const file = new File([bytes], command.filename, {
      type: command.mimeType ?? 'application/octet-stream',
    });
    return embeddedPhoneUploadFile(command.secret, file);
  }

  if (command.action === 'list-files') {
    await embeddedPhoneOpenVolume(command.secret);
    return embeddedPhoneListFiles(command.secret);
  }

  return embeddedPhoneListChat(command.secret);
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