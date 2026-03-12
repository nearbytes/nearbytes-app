import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { execFileSync } from 'child_process';

const rl = readline.createInterface({ input, output });

try {
  const releaseInput = (await rl.question('Release version (e.g. 1.2.3 or v1.2.3): ')).trim();
  if (releaseInput.length === 0) {
    throw new Error('Version is required');
  }

  const tag = releaseInput.startsWith('v') ? releaseInput : `v${releaseInput}`;
  if (!/^v\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }

  ensureCleanWorktree();
  ensureTagDoesNotExist(tag);

  console.log(`Creating release tag ${tag}...`);
  execFileSync('git', ['tag', tag], { stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' });
  console.log(`Pushed ${tag}. CI will build and publish installers.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Release tagging failed: ${message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}

function ensureCleanWorktree() {
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (status.length > 0) {
    throw new Error('Worktree is not clean. Commit or stash changes before tagging a release.');
  }
}

function ensureTagDoesNotExist(tag) {
  const tags = execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim();
  if (tags.length > 0) {
    throw new Error(`Tag already exists: ${tag}`);
  }
}

