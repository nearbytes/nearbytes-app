export interface GithubReleaseAsset {
  readonly name: string;
  readonly browserDownloadUrl: string;
  readonly size: number;
  readonly contentType: string;
}

export interface GithubLatestRelease {
  readonly tagName: string;
  readonly version: string;
  readonly htmlUrl: string;
  readonly assets: GithubReleaseAsset[];
}

export type ReleasePlatform = NodeJS.Platform;
export type ReleaseArch = NodeJS.Architecture;

export function normalizeVersion(input: string): string {
  const trimmed = input.trim().replace(/^v/i, '');
  return trimmed;
}

function toVersionParts(input: string): number[] {
  return normalizeVersion(input)
    .split('.')
    .map((part) => {
      const match = part.match(/^(\d+)/);
      return match ? Number.parseInt(match[1], 10) : 0;
    });
}

export function compareVersions(left: string, right: string): number {
  const leftParts = toVersionParts(left);
  const rightParts = toVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

function chooseBySuffix(assets: GithubReleaseAsset[], suffixes: string[]): GithubReleaseAsset | null {
  for (const suffix of suffixes) {
    const asset = assets.find((candidate) => candidate.name.endsWith(suffix));
    if (asset) {
      return asset;
    }
  }
  return null;
}

export function selectReleaseAsset(
  release: GithubLatestRelease,
  platform: ReleasePlatform,
  arch: ReleaseArch
): GithubReleaseAsset | null {
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return chooseBySuffix(release.assets, ['-arm64-mac.zip', '-mac.zip', '.zip']);
    }
    if (arch === 'x64') {
      return chooseBySuffix(release.assets, ['-x64-mac.zip', '-mac.zip', '.zip']);
    }
    return chooseBySuffix(release.assets, ['-mac.zip', '.zip']);
  }

  if (platform === 'win32') {
    return chooseBySuffix(release.assets, ['.exe']);
  }

  if (platform === 'linux') {
    return chooseBySuffix(release.assets, ['.AppImage', '.deb']);
  }

  return null;
}

function parseAsset(input: unknown): GithubReleaseAsset | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const candidate = input as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const browserDownloadUrl =
    typeof candidate.browser_download_url === 'string' ? candidate.browser_download_url.trim() : '';
  if (name.length === 0 || browserDownloadUrl.length === 0) {
    return null;
  }
  return {
    name,
    browserDownloadUrl,
    size: typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? candidate.size : 0,
    contentType: typeof candidate.content_type === 'string' ? candidate.content_type : 'application/octet-stream',
  };
}

export function parseGithubLatestRelease(input: unknown): GithubLatestRelease {
  if (!input || typeof input !== 'object') {
    throw new Error('GitHub latest release payload must be an object.');
  }
  const payload = input as Record<string, unknown>;
  const tagName = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : '';
  const htmlUrl = typeof payload.html_url === 'string' ? payload.html_url.trim() : '';
  if (tagName.length === 0 || htmlUrl.length === 0) {
    throw new Error('GitHub latest release payload is missing tag_name or html_url.');
  }
  const assets = Array.isArray(payload.assets) ? payload.assets.map(parseAsset).filter(Boolean) as GithubReleaseAsset[] : [];
  return {
    tagName,
    version: normalizeVersion(tagName),
    htmlUrl,
    assets,
  };
}
