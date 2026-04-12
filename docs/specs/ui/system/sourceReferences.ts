import type {
  ChatAttachment,
  ContentDescriptor,
  SourceFileReference,
  SourceReferenceBundle,
  SourceReferenceBundleItem,
} from './contracts.js';

function isContentDescriptor(value: unknown): value is ContentDescriptor {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ContentDescriptor>;
  return (
    (candidate.t === 'b' || candidate.t === 'm') &&
    typeof candidate.h === 'string' &&
    typeof candidate.z === 'number'
  );
}

function isSourceFileReference(value: unknown): value is SourceFileReference {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SourceFileReference>;
  return (
    candidate.p === 'nb.src.ref.v1' &&
    typeof candidate.s === 'string' &&
    isContentDescriptor(candidate.c) &&
    typeof candidate.x === 'string'
  );
}

function isSourceReferenceBundleItem(value: unknown): value is SourceReferenceBundleItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SourceReferenceBundleItem>;
  return (
    typeof candidate.name === 'string' &&
    (candidate.mime === undefined || typeof candidate.mime === 'string') &&
    (candidate.createdAt === undefined || typeof candidate.createdAt === 'number') &&
    isSourceFileReference(candidate.ref)
  );
}

export function parseSourceReferenceBundleText(text: string): SourceReferenceBundle | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<SourceReferenceBundle>;
    if (
      parsed.p !== 'nb.src.refs.v1' ||
      typeof parsed.s !== 'string' ||
      !Array.isArray(parsed.items) ||
      !parsed.items.every((item) => isSourceReferenceBundleItem(item))
    ) {
      return null;
    }
    return {
      p: 'nb.src.refs.v1',
      s: parsed.s,
      items: parsed.items,
    };
  } catch {
    return null;
  }
}

export function createChatAttachmentFromSourceBundle(
  bundle: SourceReferenceBundle
): { attachment: ChatAttachment; truncated: boolean } {
  const [firstItem] = bundle.items;
  if (!firstItem) {
    throw new Error('Nearbytes file reference is empty.');
  }
  return {
    attachment: {
      kind: 'nb.src.ref.v1',
      name: firstItem.name,
      mime: firstItem.mime,
      createdAt: firstItem.createdAt,
      ref: firstItem.ref,
    },
    truncated: bundle.items.length > 1,
  };
}
