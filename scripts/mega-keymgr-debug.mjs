import { readFile } from 'fs/promises';
import { createDecipheriv, hkdfSync } from 'crypto';

const secretFile = process.argv[2];
if (!secretFile) {
  throw new Error('Usage: node scripts/mega-keymgr-debug.mjs <integration-secrets.json>');
}

function decodeMegaBase64Url(value) {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(`${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`, 'base64');
}

function encodeMegaBase64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function deriveMegaKeyManagerKey(masterKey) {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from([1]), 16));
}

function decryptMegaKeyManagerContainer(container, masterKey) {
  const iv = container.subarray(2, 14);
  const encrypted = container.subarray(14);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', deriveMegaKeyManagerKey(masterKey), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function parseLtlv(value) {
  const records = [];
  let offset = 0;
  while (offset < value.length) {
    const tagLength = value[offset++];
    const tag = value.subarray(offset, offset + tagLength);
    offset += tagLength;
    let payloadLength = value.readUInt16BE(offset);
    offset += 2;
    if (payloadLength === 0xffff) {
      payloadLength = value.readUInt32BE(offset);
      offset += 4;
    }
    const payload = value.subarray(offset, offset + payloadLength);
    offset += payloadLength;
    records.push({ tag, payload });
  }
  return records;
}

const secretJson = JSON.parse(await readFile(secretFile, 'utf8'));
const firstEntry = Object.values(secretJson.entries ?? {})[0];
if (typeof firstEntry !== 'string') {
  throw new Error('No provider account entry found in integration secrets.');
}
const secret = JSON.parse(Buffer.from(firstEntry, 'base64').toString('utf8'));
const masterKey = decodeMegaBase64Url(secret.masterKey);
const sid = secret.sid;
const sampleHandles = new Set(['YRcxHTbb', 'kccxiDBD', 'xY8TzZxb', '5RkEyLLD', '0RlCiBgQ']);

const request = async (command, id) => {
  const response = await fetch(`https://g.api.mega.co.nz/cs?id=${id}&sid=${encodeURIComponent(sid)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([command]),
  });
  return (await response.json())[0];
};

const keyManagerResponse = await request({ a: 'uga', u: secret.userHandle, ua: '^!keys', v: 1 }, 901);
if (typeof keyManagerResponse?.av !== 'string') {
  console.log('key-manager', 'missing');
  process.exit(0);
}

const plaintext = decryptMegaKeyManagerContainer(decodeMegaBase64Url(keyManagerResponse.av), masterKey);
let offset = 0;
while (offset + 4 <= plaintext.length) {
  const tag = plaintext[offset];
  const length = (plaintext[offset + 1] << 16) | (plaintext[offset + 2] << 8) | plaintext[offset + 3];
  offset += 4;
  const record = plaintext.subarray(offset, offset + length);
  offset += length;
  console.log('record', { tag, length });
  if (tag === 17) {
    console.log('privCu255 length', record.length);
  }
  if (tag === 32) {
    let ownerAuth = null;
    for (let index = 0; index + 29 <= record.length; index += 29) {
      const handle = encodeMegaBase64Url(record.subarray(index, index + 8));
      const auth = record.readInt8(index + 28);
      if (handle === 'QGNK-vtVAPo') {
        ownerAuth = auth;
      }
    }
    console.log('authring', { records: record.length / 29, ownerAuth });
  }
  if (tag === 48) {
    const handles = [];
    for (let index = 0; index + 23 <= record.length; index += 23) {
      handles.push(encodeMegaBase64Url(record.subarray(index, index + 6)));
    }
    console.log('shareKeys', {
      count: handles.length,
      matchingSamples: handles.filter((handle) => sampleHandles.has(handle)),
    });
  }
  if (tag === 65) {
    const records = parseLtlv(record);
    console.log('pendingInshares', {
      count: records.length,
      matchingSamples: records
        .map(({ tag: shareTag, payload }) => ({
          shareHandle: encodeMegaBase64Url(shareTag),
          ownerHandle: payload.length >= 8 ? encodeMegaBase64Url(payload.subarray(0, 8)) : null,
          encryptedLength: Math.max(0, payload.length - 8),
        }))
        .filter((entry) => sampleHandles.has(entry.shareHandle)),
    });
  }
}

const ownerCu255 = await request({ a: 'uga', u: 'QGNK-vtVAPo', ua: '+puCu255', v: 1 }, 902);
console.log('ownerCu255 length', typeof ownerCu255?.av === 'string' ? decodeMegaBase64Url(ownerCu255.av).length : 0);

const snapshot = await request({ a: 'f', c: 1, r: 1, ca: 1 }, 903);
console.log('snapshot keys', Object.keys(snapshot).sort());
for (const key of ['ok', 'ok0', 's', 'ps', 'cr', 'sr', 'pk']) {
  const value = snapshot[key];
  console.log('snapshot field', key, Array.isArray(value) ? value.length : typeof value === 'object' && value ? 'object' : typeof value);
}
const sampleNode = Array.isArray(snapshot.f)
  ? snapshot.f.find((node) => sampleHandles.has(typeof node?.h === 'string' ? node.h : ''))
  : null;
console.log('sample node', sampleNode ? {
  h: sampleNode.h,
  p: sampleNode.p,
  su: sampleNode.su,
  sk: typeof sampleNode.sk === 'string',
  keys: Object.keys(sampleNode).sort(),
} : null);
if (Array.isArray(snapshot.ok) && snapshot.ok.length > 0) {
  console.log(
    'snapshot ok matchingSamples',
    snapshot.ok.filter((entry) => sampleHandles.has(typeof entry?.h === 'string' ? entry.h : ''))
  );
  console.log('snapshot ok sample', snapshot.ok.slice(0, 5));
}
if (Array.isArray(snapshot.ok0) && snapshot.ok0.length > 0) {
  console.log(
    'snapshot ok0 matchingSamples',
    snapshot.ok0.filter((entry) => sampleHandles.has(typeof entry?.h === 'string' ? entry.h : ''))
  );
  console.log('snapshot ok0 sample', snapshot.ok0.slice(0, 5));
}
if (Array.isArray(snapshot.s) && snapshot.s.length > 0) {
  console.log(
    'snapshot s matchingSamples',
    snapshot.s.filter((entry) => {
      const handle = typeof entry?.h === 'string' ? entry.h : typeof entry?.t === 'string' ? entry.t : '';
      return sampleHandles.has(handle);
    })
  );
  console.log(
    'snapshot s ownerRows',
    snapshot.s.filter((entry) => typeof entry?.u === 'string' && entry.u === 'QGNK-vtVAPo').slice(0, 10)
  );
  console.log('snapshot s sample', snapshot.s.slice(0, 10));
}

if (Array.isArray(snapshot.f)) {
  const interestingHandles = new Set(['QNkChQJJ', 'YRcxHTbb', 'kccxiDBD', 'xY8TzZxb', '5RkEyLLD', '0RlCiBgQ']);
  for (const row of Array.isArray(snapshot.s) ? snapshot.s : []) {
    if (typeof row?.h === 'string') {
      interestingHandles.add(row.h);
    }
  }
  const interestingNodes = snapshot.f
    .filter((node) => interestingHandles.has(typeof node?.h === 'string' ? node.h : ''))
    .map((node) => ({
      h: node.h,
      p: node.p,
      u: node.u,
      su: node.su,
      t: node.t,
      r: node.r,
      k: typeof node.k === 'string' ? node.k : null,
      hasSk: typeof node.sk === 'string',
    }));
  console.log('interesting nodes', interestingNodes);
}

const pendingKeysResponse = await request({ a: 'pk' }, 904);
const pendingKeyEntries = [];
for (const [ownerHandle, shareMap] of Object.entries(pendingKeysResponse ?? {})) {
  if (ownerHandle === 'd' || !shareMap || typeof shareMap !== 'object' || Array.isArray(shareMap)) {
    continue;
  }
  for (const [shareHandle, encodedKey] of Object.entries(shareMap)) {
    pendingKeyEntries.push({
      ownerHandle,
      shareHandle,
      encodedLength: typeof encodedKey === 'string' ? encodedKey.length : -1,
    });
  }
}
console.log('pk pending key count', pendingKeyEntries.length);
console.log('pk matching samples', pendingKeyEntries.filter((entry) => sampleHandles.has(entry.shareHandle)));