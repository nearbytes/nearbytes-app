import { base64UrlToBytes } from '../utils/encoding.js';
import { canonicalJsonString } from './fileReferenceCodec.js';
import type {
  JoinLink,
  JoinLinkAttachment,
  JoinLinkSpace,
  JsonValue,
  TransportEndpoint,
  TransportRecipe,
} from '../integrations/types.js';

type JsonObject = { [key: string]: JsonValue };
const FILE_SECRET_PREFIX = 'nb-file-secret:v1:';

export function serializeTransportEndpoint(endpoint: TransportEndpoint): string {
  return canonicalJsonString(endpoint as unknown as JsonValue);
}

export function serializeTransportRecipe(recipe: TransportRecipe): string {
  return canonicalJsonString(recipe as unknown as JsonValue);
}

export function serializeJoinLink(link: JoinLink): string {
  return canonicalJsonString(link as unknown as JsonValue);
}

export function parseTransportEndpoint(value: unknown): TransportEndpoint {
  const object = asObject(value, 'Transport endpoint must be an object');
  if (object.p !== 'nb.transport.endpoint.v1') {
    throw new Error('Unsupported transport endpoint protocol');
  }

  const transport = parseNonEmptyString(object.transport, 'Transport endpoint kind is invalid');
  const provider = parseOptionalNonEmptyString(object.provider, 'Transport endpoint provider is invalid');
  const priority = parsePriority(object.priority);
  const capabilities = parseStringList(object.capabilities, 'Transport endpoint capabilities are invalid');
  const descriptor = parseDescriptorObject(object.descriptor, 'Transport endpoint descriptor is invalid');
  const label = parseOptionalNonEmptyString(object.label, 'Transport endpoint label is invalid');
  const badges = parseOptionalStringList(object.badges, 'Transport endpoint badges are invalid');

  return {
    p: 'nb.transport.endpoint.v1',
    transport,
    provider,
    priority,
    capabilities,
    descriptor,
    label,
    badges,
  };
}

export function parseTransportRecipe(value: unknown): TransportRecipe {
  const object = asObject(value, 'Transport recipe must be an object');
  if (object.p !== 'nb.transport.recipe.v1') {
    throw new Error('Unsupported transport recipe protocol');
  }

  const id = parseNonEmptyString(object.id, 'Transport recipe id is invalid');
  const label = parseNonEmptyString(object.label, 'Transport recipe label is invalid');
  const purpose = parseOptionalNonEmptyString(object.purpose, 'Transport recipe purpose is invalid') ?? 'mirror';
  const endpointsValue = object.endpoints;
  if (!Array.isArray(endpointsValue) || endpointsValue.length === 0) {
    throw new Error('Transport recipe must contain at least one endpoint');
  }

  const endpoints = endpointsValue.map((endpoint, index) => {
    try {
      return parseTransportEndpoint(endpoint);
    } catch (error) {
      throw new Error(
        `Transport recipe endpoint ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return {
    p: 'nb.transport.recipe.v1',
    id,
    label,
    purpose,
    endpoints,
  };
}

export function parseJoinLink(value: unknown): JoinLink {
  const object = asObject(value, 'Join link must be an object');
  if (object.p !== 'nb.join.v1') {
    throw new Error('Unsupported join link protocol');
  }

  const space = parseJoinLinkSpace(object.space);
  const attachmentsValue = object.attachments;
  if (!Array.isArray(attachmentsValue)) {
    throw new Error('Join link attachments must be an array');
  }

  const seenIds = new Set<string>();
  const attachments = attachmentsValue.map((attachment, index) => {
    const parsed = parseJoinLinkAttachment(attachment, index);
    if (seenIds.has(parsed.id)) {
      throw new Error(`Duplicate join attachment id: ${parsed.id}`);
    }
    seenIds.add(parsed.id);
    return parsed;
  });

  return {
    p: 'nb.join.v1',
    space,
    attachments,
  };
}

export function parseJoinLinkJson(text: string): JoinLink | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const candidate = parsed as { p?: unknown };
  if (candidate.p !== 'nb.join.v1') {
    return null;
  }
  return parseJoinLink(parsed);
}

export function joinLinkSpaceToOpenSecret(space: JoinLinkSpace):
  | { mode: 'seed'; secret: string }
  | { mode: 'secret-file'; name: string; mime?: string; payload: Uint8Array } {
  if (space.mode === 'seed') {
    return {
      mode: 'seed',
      secret: space.password ? `${space.value}:${space.password}` : space.value,
    };
  }
  return {
    mode: 'secret-file',
    name: space.name,
    mime: space.mime,
    payload: base64UrlToBytes(space.payload),
  };
}

export function joinLinkSpaceToSecretString(space: JoinLinkSpace): string {
  if (space.mode === 'seed') {
    return space.password ? `${space.value}:${space.password}` : space.value;
  }
  return `${FILE_SECRET_PREFIX}${space.payload}`;
}

function parseJoinLinkAttachment(value: unknown, index: number): JoinLinkAttachment {
  const object = asObject(value, `Join attachment ${index} must be an object`);
  return {
    id: parseNonEmptyString(object.id, `Join attachment ${index} id is invalid`),
    label: parseNonEmptyString(object.label, `Join attachment ${index} label is invalid`),
    recipe: parseTransportRecipe(object.recipe),
  };
}

function parseJoinLinkSpace(value: unknown): JoinLinkSpace {
  const object = asObject(value, 'Join link space is invalid');
  const mode = parseNonEmptyString(object.mode, 'Join link space mode is invalid');
  if (mode === 'seed') {
    return {
      mode: 'seed',
      value: parseNonEmptyString(object.value, 'Join link seed value is invalid'),
      password: parseOptionalNonEmptyString(object.password, 'Join link seed password is invalid'),
    };
  }
  if (mode === 'secret-file') {
    const payload = parseNonEmptyString(object.payload, 'Join link secret file payload is invalid');
    base64UrlToBytes(payload);
    return {
      mode: 'secret-file',
      name: parseNonEmptyString(object.name, 'Join link secret file name is invalid'),
      mime: parseOptionalNonEmptyString(object.mime, 'Join link secret file mime is invalid'),
      payload,
    };
  }
  throw new Error(`Unsupported join link space mode: ${mode}`);
}

function parsePriority(value: unknown): number {
  if (value === undefined) {
    return 100;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Transport endpoint priority must be an integer');
  }
  return value;
}

function parseDescriptorObject(value: unknown, label: string): Record<string, JsonValue> {
  const object = asObject(value, label);
  return object;
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(label);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = parseNonEmptyString(item, label);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseOptionalStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseStringList(value, label);
}

function parseOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseNonEmptyString(value, label);
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(label);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(label);
  }
  return trimmed;
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label);
  }
  return value as JsonObject;
}
