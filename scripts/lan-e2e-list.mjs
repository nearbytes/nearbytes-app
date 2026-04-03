#!/usr/bin/env node

const [, , baseUrlArg, secret] = process.argv;

if (!baseUrlArg || !secret) {
  console.error('Usage: node scripts/lan-e2e-list.mjs <baseUrl> <secret>');
  process.exit(1);
}

const baseUrl = baseUrlArg.replace(/\/+$/, '');
const response = await fetch(`${baseUrl}/files`, {
  headers: {
    'x-nearbytes-secret': secret,
  },
});
const text = await response.text();
process.stdout.write(text);
if (!response.ok) {
  process.stderr.write(`\nList failed with ${response.status}\n`);
  process.exit(1);
}
