#!/usr/bin/env node

const [, , baseUrlArg, secret, name, body] = process.argv;

if (!baseUrlArg || !secret || !name || body === undefined) {
  console.error('Usage: node scripts/lan-e2e-upload.mjs <baseUrl> <secret> <name> <body>');
  process.exit(1);
}

const baseUrl = baseUrlArg.replace(/\/+$/, '');
const boundary = `----nearbytes-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
const parts = [
  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${body}`,
  `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${name}`,
  `--${boundary}--\r\n`,
];
const payload = Buffer.from(parts.join('\r\n'), 'utf8');

const response = await fetch(`${baseUrl}/upload`, {
  method: 'POST',
  headers: {
    'x-nearbytes-secret': secret,
    'content-type': `multipart/form-data; boundary=${boundary}`,
  },
  body: payload,
});

const text = await response.text();
process.stdout.write(text);
if (!response.ok) {
  process.stderr.write(`\nUpload failed with ${response.status}\n`);
  process.exit(1);
}
