import { z } from 'zod';
import { ApiError } from './errors.js';

export const openBodySchema = z.object({
  secret: z.string().min(1, 'Secret is required'),
});

export const uploadFieldsSchema = z.object({
  filename: z.string().optional(),
  mimeType: z.string().optional(),
});

export const fileNameParamSchema = z.object({
  name: z.string().min(1, 'Filename is required'),
});

export const fileHashParamSchema = z.object({
  hash: z.string().min(1, 'Blob hash is required'),
});

export const renameFolderBodySchema = z.object({
  from: z.string().min(1, 'Source folder is required'),
  to: z.string().min(1, 'Destination folder is required'),
  merge: z.boolean().optional().default(false),
});

export const renameFileBodySchema = z.object({
  from: z.string().min(1, 'Source file is required'),
  to: z.string().min(1, 'Destination file is required'),
});

export const exportReferencesBodySchema = z.object({
  filenames: z.array(z.string().min(1, 'Filename is required')).min(1, 'At least one filename is required'),
});

export const exportRecipientReferencesBodySchema = exportReferencesBodySchema.extend({
  recipientVolumeId: z.string().min(1, 'Recipient volume id is required'),
});

export const importSourceReferencesBodySchema = z.object({
  sourceSecret: z.string().min(1, 'Source secret is required'),
  bundle: z.unknown(),
});

export const importRecipientReferencesBodySchema = z.object({
  bundle: z.unknown(),
});

export const publishIdentityBodySchema = z.object({
  identitySecret: z.string().min(1, 'Identity secret is required'),
  profile: z.object({
    displayName: z.string().trim().min(1, 'Display name is required'),
    bio: z.string().optional(),
  }),
});

export const sendChatMessageBodySchema = z.object({
  identitySecret: z.string().min(1, 'Identity secret is required'),
  body: z.string().optional(),
  attachment: z.unknown().optional(),
});

export const consolidateRootParamSchema = z.object({
  sourceId: z.string().trim().min(1, 'Source root id is required'),
});

export const consolidateRootBodySchema = z.object({
  sourceId: z.string().trim().min(1, 'Source root id is required'),
  targetId: z.string().trim().min(1, 'Destination root id is required'),
});

export const openRootInFileManagerBodySchema = z.object({
  rootId: z.string().trim().min(1, 'Root id is required'),
});

export const reconcileDiscoveredSourcesBodySchema = z.object({
  knownVolumeIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-f0-9]{64,200}$/i, 'Known volume ids must be lowercase or uppercase hex')
    )
    .optional()
    .default([]),
});

const providerLabelSchema = z.string().trim().min(1);

export const providerAccountIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Provider account id is required'),
});

export const providerIdParamSchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required'),
});

export const managedShareIdParamSchema = z.object({
  shareId: z.string().trim().min(1, 'Managed share id is required'),
});

export const connectProviderAccountBodySchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required'),
  mode: z.enum(['login', 'signup', 'confirm-signup']).optional(),
  label: providerLabelSchema.optional(),
  email: z.string().trim().email('Provider email must be valid').optional(),
  preferred: z.boolean().optional().default(false),
  authSessionId: z.string().trim().min(1).optional(),
  credentials: z
    .object({
      name: z.string().trim().min(1, 'Provider name is required').optional(),
      email: z.string().trim().email('Provider email must be valid').optional(),
      password: z.string().min(1, 'Provider password is required').optional(),
      mfaCode: z.string().trim().min(1).optional(),
      confirmationLink: z.string().trim().url('Confirmation link must be a valid URL').optional(),
    })
    .optional(),
});

export const configureProviderBodySchema = z.object({
  clientId: z.string().trim().min(1).optional(),
  clientSecret: z.string().trim().min(1).optional(),
});

export const createManagedShareBodySchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required'),
  accountId: z.string().trim().min(1, 'Provider account id is required'),
  label: providerLabelSchema,
  localPath: z.string().trim().min(1).optional(),
  role: z.enum(['owner', 'recipient', 'link']).optional(),
  volumeId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64,200}$/i, 'Volume id must be lowercase or uppercase hex')
    .optional(),
  remoteDescriptor: z.record(z.string(), z.unknown()).optional(),
  capabilities: z.array(z.string().trim().min(1)).optional(),
});

export const inviteManagedShareBodySchema = z.object({
  emails: z.array(z.string().trim().email('Invite emails must be valid')).min(1, 'At least one email is required'),
});

export const attachManagedShareBodySchema = z.object({
  volumeId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64,200}$/i, 'Volume id must be lowercase or uppercase hex'),
});

export const acceptManagedShareBodySchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required'),
  accountId: z.string().trim().min(1, 'Provider account id is required'),
  label: providerLabelSchema,
  volumeId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64,200}$/i, 'Volume id must be lowercase or uppercase hex')
    .optional(),
  localPath: z.string().trim().min(1).optional(),
  remoteDescriptor: z.record(z.string(), z.unknown()).optional(),
  capabilities: z.array(z.string().trim().min(1)).optional(),
});

export const acceptProviderContactInviteBodySchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required'),
  accountId: z.string().trim().min(1, 'Provider account id is required'),
  inviteId: z.string().trim().min(1, 'Invite id is required'),
});

export const parseJoinLinkBodySchema = z.object({
  serialized: z.string().trim().min(1).optional(),
  link: z.unknown().optional(),
  preferredProviders: z.array(z.string().trim().min(1)).optional(),
});

export const openJoinLinkBodySchema = parseJoinLinkBodySchema.extend({
  allowCredentialBootstrap: z.boolean().optional().default(false),
  volumeId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64,200}$/i, 'Volume id must be lowercase or uppercase hex')
    .optional(),
});

/**
 * Parses and validates input using a Zod schema.
 */
export function parseWithSchema<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_REQUEST', formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid request';
  }
  return issue.message;
}
