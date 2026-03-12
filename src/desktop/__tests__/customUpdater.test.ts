import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  normalizeVersion,
  parseGithubLatestRelease,
  selectReleaseAsset,
  type GithubLatestRelease,
} from '../customUpdater.js';

function releaseWithAssets(names: string[]): GithubLatestRelease {
  return {
    tagName: 'v0.5.5',
    version: '0.5.5',
    htmlUrl: 'https://example.com/release',
    assets: names.map((name) => ({
      name,
      browserDownloadUrl: `https://example.com/${name}`,
      size: 1,
      contentType: 'application/octet-stream',
    })),
  };
}

describe('custom updater helpers', () => {
  it('normalizes version tags', () => {
    expect(normalizeVersion(' v0.5.5 ')).toBe('0.5.5');
  });

  it('compares semver-like versions numerically', () => {
    expect(compareVersions('0.5.5', '0.5.4')).toBeGreaterThan(0);
    expect(compareVersions('0.5.5', '0.5.5')).toBe(0);
    expect(compareVersions('0.5.5', '0.6.0')).toBeLessThan(0);
  });

  it('selects the arm64 mac zip when available', () => {
    const release = releaseWithAssets([
      'Nearbytes-0.5.5-arm64.dmg',
      'Nearbytes-0.5.5-arm64-mac.zip',
      'Nearbytes-Setup-0.5.5.exe',
    ]);
    expect(selectReleaseAsset(release, 'darwin', 'arm64')?.name).toBe('Nearbytes-0.5.5-arm64-mac.zip');
  });

  it('selects the windows installer on win32', () => {
    const release = releaseWithAssets(['Nearbytes-Setup-0.5.5.exe', 'latest.yml']);
    expect(selectReleaseAsset(release, 'win32', 'x64')?.name).toBe('Nearbytes-Setup-0.5.5.exe');
  });

  it('parses the latest release payload', () => {
    const parsed = parseGithubLatestRelease({
      tag_name: 'v0.5.5',
      html_url: 'https://example.com/release',
      assets: [
        {
          name: 'Nearbytes-0.5.5-arm64-mac.zip',
          browser_download_url: 'https://example.com/asset.zip',
          size: 42,
          content_type: 'application/zip',
        },
      ],
    });

    expect(parsed.version).toBe('0.5.5');
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]?.name).toBe('Nearbytes-0.5.5-arm64-mac.zip');
  });
});
