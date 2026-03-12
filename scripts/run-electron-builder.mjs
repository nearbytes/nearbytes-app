import { execFileSync, spawn } from 'child_process';

const cliArgs = process.argv.slice(2);
const env = { ...process.env };

if (!env.NEARBYTES_RELEASE_OWNER || !env.NEARBYTES_RELEASE_REPO) {
  const repoSlug = resolveRepositorySlug(env);
  if (repoSlug) {
    const [owner, repo] = repoSlug.split('/');
    env.NEARBYTES_RELEASE_OWNER = env.NEARBYTES_RELEASE_OWNER || owner;
    env.NEARBYTES_RELEASE_REPO = env.NEARBYTES_RELEASE_REPO || repo;
  }
}

if (!env.NEARBYTES_RELEASE_OWNER || !env.NEARBYTES_RELEASE_REPO) {
  console.error(
    'Unable to resolve release repository. Set NEARBYTES_RELEASE_OWNER and NEARBYTES_RELEASE_REPO.'
  );
  process.exit(1);
}

const child = spawn('electron-builder', cliArgs, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function resolveRepositorySlug(currentEnv) {
  const fromGithub = parseGithubRepository(currentEnv.GITHUB_REPOSITORY);
  if (fromGithub) {
    return fromGithub;
  }

  try {
    const remoteUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
    }).trim();
    return parseRemoteUrl(remoteUrl);
  } catch {
    return null;
  }
}

function parseGithubRepository(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[^/]+\/[^/]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function parseRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }

  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}
