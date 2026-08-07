#!/usr/bin/env node
/**
 * dev:servant — unattended peer runner.
 *
 * Keeps this repo running as a live sync peer with no human at the keyboard:
 * polls GitHub for new commits (this repo *and* every `nearbytes-*`
 * dependency), pulls, re-resolves dependencies, and restarts the child
 * process. Intended for "leave the laptop open and let it sync".
 *
 * Deliberate behaviours, each learned from a way this goes wrong unattended:
 *
 * - `yarn refresh` rewrites `yarn.lock`, which would leave a dirty tree and
 *   make the next `git pull --ff-only` fail forever. The lockfile is therefore
 *   discarded before pulling — a servant re-resolves on every cycle anyway, so
 *   local lock churn carries no information worth keeping.
 * - By default only *this* repo's branch head is polled: one `git ls-remote` per
 *   cycle rather than one per dependency. That is not merely cheaper, it is more
 *   correct. Releasing touches several repos in sequence, and a servant watching
 *   every dependency restarts on each intermediate push — repeatedly, on
 *   half-released combinations. Watching one ref makes an update atomic and
 *   deliberate: push everything, then nudge once.
 * - Nudging needs no code change. Bump `servant-nudge` in this repo and push;
 *   any commit on the watched branch is a trigger. Because an update always runs
 *   `yarn refresh`, one nudge picks up every dependency pushed since the last.
 * - Set NEARBYTES_SERVANT_WATCH=deps to also poll each floating dependency's
 *   HEAD. Useful on a developer machine, wasteful on an unattended one.
 * - Every network and git failure is logged and swallowed. A servant that exits
 *   on a flaky DHCP lease is worse than one that keeps serving stale code.
 *
 * Env:
 *   NEARBYTES_SERVANT_INTERVAL_MS  poll interval (default 5000)
 *   NEARBYTES_SERVANT_CHILD        yarn script to run (default dev:fast)
 *   NEARBYTES_SERVANT_WATCH        `self` (default) or `deps`
 */
import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTERVAL = Number(process.env['NEARBYTES_SERVANT_INTERVAL_MS'] ?? 5_000);
/**
 * Each cycle spawns one `git ls-remote` per watched repo, so a tight interval
 * is real network and battery cost on an unattended laptop. Consecutive
 * failures (offline, DHCP flap, GitHub throttling) back the interval off
 * geometrically instead of hammering, and reset the moment a check succeeds.
 */
const MAX_BACKOFF_MS = 5 * 60_000;
let consecutiveFailures = 0;
let timer = null;
const CHILD_SCRIPT = process.env['NEARBYTES_SERVANT_CHILD'] ?? 'dev:fast';
const GITHUB_ORG = 'nearbytes';
const WATCH_DEPS = (process.env['NEARBYTES_SERVANT_WATCH'] ?? 'self') === 'deps';

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[servant ${stamp()}] ${msg}`);

let child = null;
let stopping = false;
/** Pending crash-restart timer; cleared whenever we take over deliberately. */
let restartTimer = null;

async function git(args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
  return stdout.trim();
}

async function remoteHead(url, ref = 'refs/heads/main') {
  const { stdout } = await execFileAsync('git', ['ls-remote', url, ref], {
    cwd: root,
    encoding: 'utf8',
  });
  return stdout.split(/\s+/)[0] ?? null;
}

/**
 * Commit each *floating* `nearbytes-*` dependency currently resolves to.
 *
 * Only dependencies this repo declares as a bare `github:nearbytes/<repo>`
 * are considered. A dependency pinned to an explicit `#commit=` — including
 * one pinned transitively by another package — is frozen on purpose and will
 * never equal its remote HEAD, so comparing it would report a change on every
 * single cycle and restart the child forever. Ask only about the deps
 * `yarn refresh` can actually move.
 */
async function floatingDeps() {
  const [pkgRaw, lock] = await Promise.all([
    readFile(resolve(root, 'package.json'), 'utf8'),
    readFile(resolve(root, 'yarn.lock'), 'utf8').catch(() => ''),
  ]);
  const pkg = JSON.parse(pkgRaw);
  const floating = new Set();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (typeof spec === 'string' && /^github:nearbytes\/[a-z0-9-]+$/.test(spec)) floating.add(name);
    }
  }

  const out = new Map();
  // yarn.lock blocks are separated by blank lines; the block whose descriptor
  // line carries the bare `@github:` spec is the floating resolution.
  for (const block of lock.split(/\n\n+/)) {
    const head = block.split('\n', 1)[0] ?? '';
    for (const name of floating) {
      if (!head.includes(`${name}@github:nearbytes/${name}`)) continue;
      const m = /#commit=([0-9a-f]{40})/.exec(block);
      if (m) out.set(name, m[1]);
    }
  }
  return out;
}

async function upstreamChanges() {
  const reasons = [];
  let failed = false;

  try {
    const localHead = await git(['rev-parse', 'HEAD']);
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main');
    const originUrl = await git(['remote', 'get-url', 'origin']);
    const head = await remoteHead(originUrl, `refs/heads/${branch === 'HEAD' ? 'main' : branch}`);
    if (head && head !== localHead) reasons.push(`self ${localHead.slice(0, 7)}→${head.slice(0, 7)}`);
  } catch (err) {
    failed = true;
    if (consecutiveFailures === 0) log(`self check failed: ${err.message.split('\n')[0]}`);
  }

  const deps = WATCH_DEPS ? await floatingDeps() : new Map();
  await Promise.all(
    [...deps.entries()].map(async ([repo, locked]) => {
      try {
        const head = await remoteHead(`https://github.com/${GITHUB_ORG}/${repo}.git`);
        if (head && head !== locked) reasons.push(`${repo} ${locked.slice(0, 7)}→${head.slice(0, 7)}`);
      } catch {
        failed = true; /* transient; retried on the next cycle */
      }
    }),
  );

  consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
  return reasons;
}

function startChild() {
  if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null; }
  if (child !== null) return;
  log(`starting: yarn ${CHILD_SCRIPT}`);
  child = spawn('yarn', [CHILD_SCRIPT], { cwd: root, stdio: 'inherit', shell: true });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    // A crash is not a reason to give up: the whole point is unattended uptime.
    log(`child exited (code=${code} signal=${signal}) — restarting in 5s`);
    child = null;
    if (restartTimer !== null) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { restartTimer = null; if (!stopping && child === null) startChild(); }, 5_000);
  });
}

async function stopChild() {
  // Cancel any queued crash-restart so it cannot race an intentional restart.
  if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null; }
  if (child === null) return;
  const dying = child;
  child = null;
  await new Promise((done) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; done(); } };
    dying.once('exit', finish);
    dying.kill('SIGTERM');
    setTimeout(() => { try { dying.kill('SIGKILL'); } catch { /* gone */ } finish(); }, 10_000);
  });
}

async function update() {
  // Discard lockfile churn from our own refresh so --ff-only can succeed.
  try {
    await git(['checkout', '--', 'yarn.lock']);
  } catch { /* nothing to discard */ }

  try {
    await git(['pull', '--ff-only']);
    log(`pulled → ${(await git(['rev-parse', 'HEAD'])).slice(0, 7)}`);
  } catch (err) {
    log(`pull failed, keeping current checkout: ${err.message.split('\n')[0]}`);
  }

  try {
    await new Promise((done, fail) => {
      const p = spawn('yarn', ['refresh'], { cwd: root, stdio: 'inherit', shell: true });
      p.on('exit', (c) => (c === 0 ? done() : fail(new Error(`yarn refresh exited ${c}`))));
    });
  } catch (err) {
    log(`refresh failed, continuing with existing modules: ${err.message}`);
  }
}

async function tick() {
  const reasons = await upstreamChanges();
  if (reasons.length === 0) return;
  log(`upstream moved: ${reasons.join(', ')}`);
  await stopChild();
  await update();
  startChild();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (timer !== null) clearTimeout(timer);
    log('shutting down');
    void stopChild().then(() => process.exit(0));
  });
}

function schedule() {
  const delay = Math.min(INTERVAL * 2 ** Math.max(0, consecutiveFailures - 1), MAX_BACKOFF_MS);
  if (consecutiveFailures === 3) log(`upstream unreachable — backing off to ${Math.round(delay / 1000)}s`);
  timer = setTimeout(() => {
    void tick()
      .catch((e) => log(`cycle error: ${e.message}`))
      .finally(() => { if (!stopping) schedule(); });
  }, delay);
}

log(`watching ${WATCH_DEPS ? `${GITHUB_ORG}/* (self + deps)` : 'this repo'} every ${Math.round(INTERVAL / 1000)}s — Ctrl-C to stop`);
startChild();
schedule();
