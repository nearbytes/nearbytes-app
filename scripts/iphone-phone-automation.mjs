#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const bundleId = 'org.nearbytes.mobile';
const automationDirName = 'nearbytes-dev-automation';
const commandFileName = 'command.json';
const resultFileName = 'result.json';

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const appContainer = runText('xcrun', ['simctl', 'get_app_container', 'booted', bundleId, 'data']);
  const automationDir = path.join(appContainer, 'Library', 'Application Support', automationDirName);
  const commandPath = path.join(automationDir, commandFileName);
  const resultPath = path.join(automationDir, resultFileName);
  const command = buildCommand(input);

  mkdirSync(automationDir, { recursive: true });
  deleteAutomationFile(resultPath);
  writeAutomationFile(commandPath, JSON.stringify(command));

  runAllowFailure('xcrun', ['simctl', 'launch', 'booted', bundleId]);

  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const result = readResult(resultPath, command.id);
    if (result) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.status === 'success' ? 0 : 1);
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for phone automation result for ${command.action}.`);
}

function parseArgs(args) {
  const parsed = {
    action: '',
    secret: '',
    shareId: '',
    path: '',
    limit: 20,
    identitySecret: '',
    eventHash: '',
    displayName: 'Phone Test5',
    bio: '',
    body: '',
    filename: '',
    mimeType: 'text/plain',
    contentBase64: '',
    filePath: '',
    timeoutMs: 30_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--action') {
      parsed.action = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--secret') {
      parsed.secret = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--share-id') {
      parsed.shareId = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--path') {
      parsed.path = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = Number.parseInt(next ?? '', 10) || parsed.limit;
      index += 1;
      continue;
    }
    if (arg === '--identity-secret') {
      parsed.identitySecret = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--event-hash') {
      parsed.eventHash = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--display-name') {
      parsed.displayName = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--bio') {
      parsed.bio = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--body') {
      parsed.body = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--filename') {
      parsed.filename = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--mime-type') {
      parsed.mimeType = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--content-base64') {
      parsed.contentBase64 = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--file-path') {
      parsed.filePath = next ?? '';
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number.parseInt(next ?? '', 10) || parsed.timeoutMs;
      index += 1;
      continue;
    }
  }

  if (!parsed.action) {
    throw new Error('--action is required');
  }
  if (
    !parsed.secret &&
    parsed.action !== 'get-latency-traces' &&
    parsed.action !== 'clear-latency-traces' &&
    parsed.action !== 'list-lan-volume-ids' &&
    parsed.action !== 'get-lan-volume-inventory' &&
    parsed.action !== 'list-provider-accounts' &&
    parsed.action !== 'get-provider-share-inventory-debug' &&
    parsed.action !== 'list-managed-shares' &&
    parsed.action !== 'get-managed-share-state' &&
    parsed.action !== 'trigger-managed-share-sync' &&
    parsed.action !== 'get-managed-share-upload-probes' &&
    parsed.action !== 'get-managed-share-receive-probes' &&
    parsed.action !== 'debug-list-mega-owner-mirror-files' &&
    parsed.action !== 'debug-read-mega-owner-mirror-file' &&
    parsed.action !== 'debug-list-stored-paths' &&
    parsed.action !== 'debug-read-setting'
  ) {
    throw new Error('--secret is required');
  }

  return parsed;
}

function buildCommand(input) {
  const id = randomUUID();
  if (input.action === 'open-volume') {
    return { id, action: input.action, secret: input.secret };
  }
  if (input.action === 'ui-open-volume') {
    return { id, action: input.action, secret: input.secret };
  }
  if (input.action === 'publish-identity') {
    if (!input.identitySecret) {
      throw new Error('--identity-secret is required for publish-identity');
    }
    return {
      id,
      action: input.action,
      secret: input.secret,
      identitySecret: input.identitySecret,
      profile: {
        displayName: input.displayName,
        bio: input.bio || undefined,
      },
    };
  }
  if (input.action === 'send-chat-message') {
    if (!input.identitySecret) {
      throw new Error('--identity-secret is required for send-chat-message');
    }
    if (!input.body) {
      throw new Error('--body is required for send-chat-message');
    }
    return {
      id,
      action: input.action,
      secret: input.secret,
      identitySecret: input.identitySecret,
      body: input.body,
    };
  }
  if (input.action === 'upload-file') {
    const filename = input.filename || path.basename(input.filePath || 'phone-upload.txt');
    const contentBase64 = input.contentBase64 || encodeBase64(readFileSync(input.filePath || process.stdin.fd));
    return {
      id,
      action: input.action,
      secret: input.secret,
      filename,
      mimeType: input.mimeType || 'application/octet-stream',
      contentBase64,
    };
  }
  if (input.action === 'list-files' || input.action === 'list-chat') {
    return {
      id,
      action: input.action,
      secret: input.secret,
    };
  }
  if (input.action === 'wait-chat-event') {
    if (!input.eventHash) {
      throw new Error('--event-hash is required for wait-chat-event');
    }
    return {
      id,
      action: input.action,
      secret: input.secret,
      eventHash: input.eventHash,
      timeoutMs: input.timeoutMs,
    };
  }
  if (input.action === 'get-latency-traces' || input.action === 'clear-latency-traces') {
    return {
      id,
      action: input.action,
    };
  }
  if (input.action === 'list-lan-volume-ids') {
    return {
      id,
      action: input.action,
    };
  }
  if (input.action === 'get-lan-volume-inventory') {
    if (!input.path) {
      throw new Error('--path is required for get-lan-volume-inventory');
    }
    return {
      id,
      action: input.action,
      volumeId: input.path,
    };
  }
  if (input.action === 'list-provider-accounts' || input.action === 'list-managed-shares') {
    return {
      id,
      action: input.action,
    };
  }
  if (input.action === 'get-provider-share-inventory-debug') {
    if (!input.path) {
      throw new Error('--path is required for get-provider-share-inventory-debug');
    }
    return {
      id,
      action: input.action,
      provider: input.path,
    };
  }
  if (input.action === 'get-managed-share-state' || input.action === 'trigger-managed-share-sync') {
    if (!input.shareId) {
      throw new Error('--share-id is required');
    }
    return {
      id,
      action: input.action,
      shareId: input.shareId,
    };
  }
  if (input.action === 'get-managed-share-upload-probes') {
    if (!input.shareId) {
      throw new Error('--share-id is required');
    }
    return {
      id,
      action: input.action,
      shareId: input.shareId,
      path: input.path || undefined,
      limit: input.limit,
    };
  }
  if (input.action === 'get-managed-share-receive-probes') {
    if (!input.shareId) {
      throw new Error('--share-id is required');
    }
    return {
      id,
      action: input.action,
      shareId: input.shareId,
      path: input.path || undefined,
      limit: input.limit,
    };
  }
  if (input.action === 'debug-list-mega-owner-mirror-files') {
    if (!input.shareId) {
      throw new Error('--share-id is required');
    }
    return {
      id,
      action: input.action,
      shareId: input.shareId,
      limit: input.limit,
    };
  }
  if (input.action === 'debug-read-mega-owner-mirror-file') {
    if (!input.shareId) {
      throw new Error('--share-id is required');
    }
    if (!input.path) {
      throw new Error('--path is required');
    }
    return {
      id,
      action: input.action,
      shareId: input.shareId,
      path: input.path,
    };
  }
  if (input.action === 'debug-list-stored-paths') {
    return {
      id,
      action: input.action,
      path: input.path || undefined,
      limit: input.limit,
    };
  }
  if (input.action === 'debug-read-setting') {
    if (!input.path) {
      throw new Error('--path is required');
    }
    return {
      id,
      action: input.action,
      path: input.path,
    };
  }
  throw new Error(`Unsupported action: ${input.action}`);
}

function readResult(resultPath, expectedId) {
  if (!existsSync(resultPath)) {
    return null;
  }
  let result;
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch {
    return null;
  }
  if (result?.id !== expectedId) {
    return null;
  }
  return result;
}

function writeAutomationFile(filePath, value) {
  writeFileSync(filePath, `${value}\n`, 'utf8');
}

function deleteAutomationFile(filePath) {
  rmSync(filePath, { force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Command failed: ${command} ${args.join(' ')}`);
  }
  return result;
}

function runAllowFailure(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
}

function runText(command, args) {
  return run(command, args).stdout.trim();
}

function encodeBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

await main();
