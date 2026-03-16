import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const cliArgs = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(repoRoot, cliArgs.input ?? 'build/icons/icon-master.png');
const iconDir = path.resolve(repoRoot, 'build/icons');
const iconsetDir = path.join(iconDir, 'icon.iconset');
const outputPngPath = path.join(iconDir, 'icon.png');
const outputIcnsPath = path.join(iconDir, 'icon.icns');
const outputIcoPath = path.join(iconDir, 'icon.ico');

const ICONSET_FILES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_64x64.png', 64],
  ['icon_64x64@2x.png', 128],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const ICO_ENTRIES = [16, 24, 32, 48, 64, 128, 256];

await mkdir(iconDir, { recursive: true });
await mkdir(iconsetDir, { recursive: true });

for (const [fileName, size] of ICONSET_FILES) {
  await resizePng(inputPath, path.join(iconsetDir, fileName), size);
}

await resizePng(inputPath, outputPngPath, 512);
await execFileAsync('iconutil', ['-c', 'icns', iconsetDir, '-o', outputIcnsPath]);
await writeIco(outputIcoPath, inputPath);

process.stdout.write(
  JSON.stringify(
    {
      png: outputPngPath,
      icns: outputIcnsPath,
      ico: outputIcoPath,
      iconset: iconsetDir,
    },
    null,
    2
  )
);

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--input') {
      result.input = args[index + 1];
      index += 1;
      continue;
    }
    if (!value.startsWith('-') && !result.input) {
      result.input = value;
    }
  }
  return result;
}

async function resizePng(sourcePath, targetPath, size) {
  await execFileAsync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), sourcePath, '--out', targetPath]);
}

async function writeIco(targetPath, sourcePath) {
  const entryBuffers = [];
  const tempPaths = [];
  for (const size of ICO_ENTRIES) {
    const tempPath = path.join(iconsetDir, `ico-${size}.png`);
    await resizePng(sourcePath, tempPath, size);
    tempPaths.push(tempPath);
    entryBuffers.push({ size, buffer: await readFile(tempPath) });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entryBuffers.length, 4);

  const directory = Buffer.alloc(entryBuffers.length * 16);
  let offset = header.length + directory.length;
  entryBuffers.forEach((entry, index) => {
    const dirOffset = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, dirOffset + 0);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, dirOffset + 1);
    directory.writeUInt8(0, dirOffset + 2);
    directory.writeUInt8(0, dirOffset + 3);
    directory.writeUInt16LE(1, dirOffset + 4);
    directory.writeUInt16LE(32, dirOffset + 6);
    directory.writeUInt32LE(entry.buffer.length, dirOffset + 8);
    directory.writeUInt32LE(offset, dirOffset + 12);
    offset += entry.buffer.length;
  });

  await writeFile(targetPath, Buffer.concat([header, directory, ...entryBuffers.map((entry) => entry.buffer)]));
  await Promise.all(tempPaths.map((tempPath) => rm(tempPath, { force: true })));
}