import { readFileSync, writeFileSync } from 'fs';

const files = [
  'ui/src/App.svelte',
  'ui/src/components/StoragePanel.svelte',
  'ui/src/components/SharedSecretEditor.svelte'
];

const replacements = [
  ['\u00e2\u20ac\u00a6', '\u2026'],   // … ellipsis
  ['\u00e2\u20ac\u0153', '\u201c'],   // " left double quote
  ['\u00e2\u20ac\u009d', '\u201d'],   // " right double quote
  ['\u00e2\u20ac\u201c', '\u2014'],   // — em dash (variant)
  ['\u00e2\u20ac\u201d', '\u2014'],   // — em dash (variant 2)
  ['\u00e2\u20ac\u0093', '\u2013'],   // – en dash
  ['\u00e2\u20ac\u0094', '\u2014'],   // — em dash
  ['\u00e2\u20ac\u00a2', '\u2022'],   // • bullet (safety)
  ['\u00c2\u00b7', '\u00b7'],         // · middle dot
  ['\u00e2\u2020\u2019', '\u2192'],   // → right arrow
  ['\u00e2\u2020\u201c', '\u2193'],   // ↓ down arrow
];

for (const f of files) {
  let text = readFileSync(f, 'utf8');
  let changed = 0;
  for (const [bad, good] of replacements) {
    const count = text.split(bad).length - 1;
    if (count > 0) {
      text = text.replaceAll(bad, good);
      changed += count;
    }
  }
  if (changed > 0) {
    writeFileSync(f, text, 'utf8');
    console.log(`${f}: fixed ${changed} mojibake sequences`);
  } else {
    console.log(`${f}: no mojibake found`);
  }
}
console.log('Done');
