#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDesktopBaseUrl = process.env.NEARBYTES_DESKTOP_BASE_URL?.trim() || 'http://127.0.0.1:3000';
const defaultTimeoutMs = parsePositiveInt(process.env.NEARBYTES_LAN_LATENCY_TIMEOUT_MS, 20_000);

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await clearDesktopTraces(options.desktopBaseUrl);
  runPhoneAutomation(options, 'clear-latency-traces');
  runPhoneAutomation(options, 'open-volume', { secret: options.secret });
  await requestJson(options.desktopBaseUrl, 'POST', '/chat/identities', {
    identitySecret: options.desktopIdentitySecret,
    profile: {
      displayName: 'Latency Desktop',
    },
  }, {
    'x-nearbytes-secret': options.secret,
  });
  runPhoneAutomation(options, 'publish-identity', {
    secret: options.secret,
    identitySecret: options.phoneIdentitySecret,
    displayName: 'Latency Phone',
  });

  const desktopMessageBody = `lan-latency desktop ${Date.now()}`;
  const desktopStartAt = Date.now();
  const desktopSent = await requestJson(options.desktopBaseUrl, 'POST', '/chat/messages', {
    identitySecret: options.desktopIdentitySecret,
    body: desktopMessageBody,
  }, {
    'x-nearbytes-secret': options.secret,
  });
  const desktopEventHash = desktopSent?.sent?.eventHash;
  if (!desktopEventHash) {
    throw new Error('Desktop send did not return sent.eventHash');
  }
  runPhoneAutomation(options, 'wait-chat-event', {
    secret: options.secret,
    eventHash: desktopEventHash,
    timeoutMs: options.timeoutMs,
  });
  const desktopToPhoneLatencyMs = Date.now() - desktopStartAt;

  const phoneMessageBody = `lan-latency phone ${Date.now()}`;
  const phoneStartAt = Date.now();
  const phoneSentResult = runPhoneAutomation(options, 'send-chat-message', {
    secret: options.secret,
    identitySecret: options.phoneIdentitySecret,
    body: phoneMessageBody,
  });
  const phoneEventHash = phoneSentResult?.result?.sent?.eventHash;
  if (!phoneEventHash) {
    throw new Error('Phone send did not return sent.eventHash');
  }
  await waitForDesktopChatEvent(options.desktopBaseUrl, options.secret, phoneEventHash, options.timeoutMs);
  const phoneToDesktopLatencyMs = Date.now() - phoneStartAt;

  const desktopTraces = await listDesktopTraces(options.desktopBaseUrl);
  const phoneTraces = runPhoneAutomation(options, 'get-latency-traces')?.result?.traces ?? [];

  printMeasurement('desktop_to_phone', desktopEventHash, desktopToPhoneLatencyMs, desktopTraces, phoneTraces);
  printMeasurement('phone_to_desktop', phoneEventHash, phoneToDesktopLatencyMs, desktopTraces, phoneTraces);
}

function parseArgs(args) {
  const runId = Date.now().toString(36);
  const options = {
    secret: process.env.NEARBYTES_LAN_SECRET?.trim() || `lan-latency:${runId}`,
    desktopIdentitySecret: process.env.NEARBYTES_LAN_DESKTOP_IDENTITY_SECRET?.trim() || `lan-latency-desktop:${runId}`,
    phoneIdentitySecret: process.env.NEARBYTES_LAN_PHONE_IDENTITY_SECRET?.trim() || `lan-latency-phone:${runId}`,
    desktopBaseUrl: defaultDesktopBaseUrl,
    timeoutMs: defaultTimeoutMs,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1] ?? '';
    if (arg === '--secret') {
      options.secret = next;
      index += 1;
      continue;
    }
    if (arg === '--desktop-identity-secret') {
      options.desktopIdentitySecret = next;
      index += 1;
      continue;
    }
    if (arg === '--phone-identity-secret') {
      options.phoneIdentitySecret = next;
      index += 1;
      continue;
    }
    if (arg === '--desktop-base-url') {
      options.desktopBaseUrl = next || options.desktopBaseUrl;
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInt(next, options.timeoutMs);
      index += 1;
      continue;
    }
  }
  return options;
}

async function clearDesktopTraces(baseUrl) {
  await requestJson(baseUrl, 'POST', '/lan/latency-traces/clear');
}

async function listDesktopTraces(baseUrl) {
  const response = await requestJson(baseUrl, 'GET', '/lan/latency-traces');
  return Array.isArray(response?.traces) ? response.traces : [];
}

async function waitForDesktopChatEvent(baseUrl, secret, eventHash, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await requestJson(baseUrl, 'GET', '/chat', undefined, {
      'x-nearbytes-secret': secret,
    });
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    if (messages.some((entry) => entry?.eventHash === eventHash)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for desktop chat event ${eventHash}`);
}

async function requestJson(baseUrl, method, pathName, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${baseUrl}${pathName} failed with ${response.status}: ${text}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

function runPhoneAutomation(options, action, extra = {}) {
  const automationScript = path.join(repoRoot, 'scripts', 'iphone-phone-automation.mjs');
  const args = [automationScript, '--action', action];
  if (extra.secret ?? options.secret) {
    args.push('--secret', String(extra.secret ?? options.secret));
  }
  if (extra.identitySecret) {
    args.push('--identity-secret', String(extra.identitySecret));
  }
  if (extra.displayName) {
    args.push('--display-name', String(extra.displayName));
  }
  if (extra.body) {
    args.push('--body', String(extra.body));
  }
  if (extra.eventHash) {
    args.push('--event-hash', String(extra.eventHash));
  }
  if (extra.timeoutMs) {
    args.push('--timeout-ms', String(extra.timeoutMs));
  }
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Phone automation failed for ${action}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Phone automation returned invalid JSON for ${action}`);
  }
}

function printMeasurement(label, eventHash, latencyMs, desktopTraces, phoneTraces) {
  const points = collectTracePoints(eventHash, desktopTraces, phoneTraces);
  process.stdout.write(`${label}_latency_ms=${latencyMs}\n`);
  process.stdout.write(`${label}_event_hash=${eventHash}\n`);
  for (const line of formatTracePoints(points)) {
    process.stdout.write(`${label}_${line}\n`);
  }
}

function collectTracePoints(eventHash, desktopTraces, phoneTraces) {
  const points = [];
  const desktop = desktopTraces.find((entry) => entry?.eventHash === eventHash);
  const phone = phoneTraces.find((entry) => entry?.eventHash === eventHash);
  if (desktop?.points) {
    for (const point of desktop.points) {
      points.push(point);
    }
  }
  if (phone?.points) {
    for (const point of phone.points) {
      points.push(point);
    }
  }
  return points.sort((left, right) => left.at - right.at);
}

function formatTracePoints(points) {
  if (points.length === 0) {
    return ['trace=missing'];
  }
  const startedAt = points[0].at;
  return points.map((point) => {
    const offsetMs = point.at - startedAt;
    const detail = point.detail ? `:${sanitize(point.detail)}` : '';
    return `trace=+${offsetMs}ms:${sanitize(point.stage)}${detail}`;
  });
}

function sanitize(value) {
  return String(value).replace(/\s+/g, '_');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});