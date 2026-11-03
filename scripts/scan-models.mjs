#!/usr/bin/env node
/**
 * Build the local STEP model index used by the plugin's model picker.
 *
 * Usage:
 *   node scripts/scan-models.mjs                 # every fixed drive (Windows) or $HOME
 *   node scripts/scan-models.mjs --root "D:\\CAD" --root "E:\\Models"
 *   node scripts/scan-models.mjs --out "./my-index.json"
 *
 * The index is written to ~/.product-model-compare/step-index.json by default,
 * the same path the Host plugin reads (override with PRODUCT_MODEL_INDEX).
 */
import { opendir, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '$Recycle.Bin', 'System Volume Information', 'WinSxS', 'Windows', '__pycache__']);
const EXTENSIONS = new Set(['.step', '.stp']);

function parseArgs(argv) {
  const roots = [];
  let out = process.env.PRODUCT_MODEL_INDEX || join(homedir(), '.product-model-compare', 'step-index.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') roots.push(resolve(argv[++i]));
    else if (argv[i] === '--out') out = resolve(argv[++i]);
  }
  return { roots, out };
}

async function defaultRoots() {
  if (process.platform !== 'win32') return [homedir()];
  const roots = [];
  for (let code = 65; code <= 90; code++) {
    const drive = String.fromCharCode(code) + ':\\';
    try { const handle = await opendir(drive); await handle.close(); roots.push(drive); } catch { /* absent drive */ }
  }
  return roots.length ? roots : [homedir()];
}

async function walk(root, files) {
  let handle;
  try { handle = await opendir(root); } catch { return; }
  for await (const entry of handle) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      await walk(full, files);
    } else if (entry.isFile() && EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) {
      files.push({ FullName: full, Name: entry.name });
    }
  }
}

const { roots: asked, out } = parseArgs(process.argv.slice(2));
const roots = asked.length ? asked : await defaultRoots();
const files = [];
for (const root of roots) {
  process.stdout.write(`scanning ${root} … `);
  const before = files.length;
  await walk(root, files);
  console.log(`${files.length - before} STEP files`);
}

files.sort((a, b) => a.FullName.localeCompare(b.FullName));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), roots, files }, null, 2), 'utf8');
console.log(`\n${files.length} STEP files → ${out}`);
