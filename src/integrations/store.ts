import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import type { ManagedShare, ProviderAccount } from './types.js';

export interface IntegrationStateSnapshot {
  readonly version: 1;
  readonly preferredProviders: string[];
  readonly accounts: ProviderAccount[];
  readonly managedShares: ManagedShare[];
}

const INTEGRATION_STATE_VERSION = 1 as const;

const providerAccountSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  label: z.string().trim().min(1),
  email: z.string().trim().optional(),
  state: z.enum(['connected', 'attention', 'unsupported']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const managedShareSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  role: z.enum(['owner', 'recipient', 'link']),
  localPath: z.string().trim().min(1),
  sourceId: z.string().trim().optional(),
  syncMode: z.literal('mirror'),
  remoteDescriptor: z.record(z.string(), z.unknown()),
  capabilities: z.array(z.string().trim().min(1)).default([]),
  invitationEmails: z.array(z.string().trim().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const integrationStateSchema = z.object({
  version: z.literal(INTEGRATION_STATE_VERSION),
  preferredProviders: z.array(z.string().trim().min(1)).default([]),
  accounts: z.array(providerAccountSchema).default([]),
  managedShares: z.array(managedShareSchema).default([]),
});

export function resolveIntegrationStatePath(customPath?: string): string {
  const envPath = process.env.NEARBYTES_INTEGRATIONS_STATE?.trim();
  if (envPath && envPath.length > 0) {
    return path.resolve(envPath);
  }
  if (customPath && customPath.trim().length > 0) {
    return path.resolve(customPath);
  }
  return path.join(os.homedir(), '.nearbytes', 'integrations.json');
}

export async function loadIntegrationState(customPath?: string): Promise<IntegrationStateSnapshot> {
  const resolvedPath = resolveIntegrationStatePath(customPath);
  try {
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const parsed = integrationStateSchema.parse(JSON.parse(raw));
    return {
      version: INTEGRATION_STATE_VERSION,
      preferredProviders: uniqueStrings(parsed.preferredProviders),
      accounts: parsed.accounts.map((account) => ({
        ...account,
        email: account.email || undefined,
      })),
      managedShares: parsed.managedShares.map((share) => ({
        ...share,
        sourceId: share.sourceId || undefined,
        capabilities: uniqueStrings(share.capabilities),
        invitationEmails: uniqueStrings(share.invitationEmails),
        remoteDescriptor: share.remoteDescriptor as Record<string, unknown>,
      })),
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return createDefaultIntegrationState();
    }
    throw error;
  }
}

export async function saveIntegrationState(
  snapshot: IntegrationStateSnapshot,
  customPath?: string
): Promise<void> {
  const resolvedPath = resolveIntegrationStatePath(customPath);
  const dir = path.dirname(resolvedPath);
  await fs.mkdir(dir, { recursive: true });

  const normalized = integrationStateSchema.parse(snapshot);
  const tempPath = `${resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, resolvedPath);
}

export function createDefaultIntegrationState(): IntegrationStateSnapshot {
  return {
    version: INTEGRATION_STATE_VERSION,
    preferredProviders: [],
    accounts: [],
    managedShares: [],
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}
