#!/usr/bin/env node
/**
 * Publish this plugin to GitHub without a local git installation.
 *
 * It uses the GitHub REST API (Git Data API) so the whole tree lands in a
 * single commit: blobs -> tree -> commit -> ref.
 *
 * Token lookup order:
 *   1. $GITHUB_TOKEN
 *   2. .gh-token next to the repository root   (git-ignored)
 *   3. ~/.gh-token
 *
 * The token needs, for the NOMAD-bri account:
 *   - Administration: Read and write   (create the repository)
 *   - Contents: Read and write         (push commits)
 *
 * Usage:
 *   node scripts/publish-github.mjs --dry-run
 *   node scripts/publish-github.mjs
 *   node scripts/publish-github.mjs --repo my-other-name --private
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const OWNER = process.env.GITHUB_OWNER || 'NOMAD-bri';
const API = 'https://api.github.com';

const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const value = name => {
  const index = args.indexOf('--' + name);
  return index >= 0 ? args[index + 1] : undefined;
};

const dryRun = flag('dry-run');
const repoName = value('repo') || 'dsh-product-model-compare';
const visibility = flag('private') ? 'private' : 'public';

const INCLUDE = [
  '.gitignore',
  'LICENSE',
  'README.md',
  'THIRD-PARTY-NOTICES.md',
  'UI-ARCHITECTURE.md',
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'index.js',
  'client.js',
  'local-viewer.js',
  'parse-step.py',
  'locale',
  'scripts',
  'test',
  'vendor',
];
const SKIP_DIRS = new Set(['dist', 'legacy', 'node_modules']);

async function listFiles(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.gh-token')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  }
  for (const item of INCLUDE) {
    const full = join(root, item);
    let info;
    try { info = await stat(full); } catch { continue; }
    if (info.isDirectory()) await walk(full);
    else found.push(full);
  }
  return found.map(full => relative(root, full).split(sep).join('/')).sort();
}

async function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  for (const candidate of [join(repoRoot, '..', '.gh-token'), join(homedir(), '.gh-token')]) {
    try {
      const raw = (await readFile(candidate, 'utf8')).trim();
      if (raw) return raw;
    } catch { /* not here */ }
  }
  return null;
}

async function api(path, options = {}, auth) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer ' + auth,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw Error(`${options.method || 'GET'} ${path} → ${response.status}: ${body?.message || text}`);
  return body;
}

const files = await listFiles(repoRoot);
if (!files.length) throw Error('no files matched the publish list');

if (dryRun) {
  console.log(`owner: ${OWNER}\nrepo:  ${repoName} (${visibility})\nfiles: ${files.length}`);
  for (const file of files) console.log('  ' + file);
  process.exit(0);
}

const auth = await token();
if (!auth) {
  console.error('缺少 token：设置环境变量 GITHUB_TOKEN，或把 token 写入 ' + join(repoRoot, '..', '.gh-token'));
  process.exit(2);
}

const description = 'Local STEP/STL/OBJ 3D workbench plugin for DeepSeek Harness: single or dual model viewing, pose dimensions, face alignment, part isolation and temporary measurements. No library, no uploads.';

let repo = null;
try {
  repo = await api(`/repos/${OWNER}/${repoName}`, {}, auth);
  console.log(`repository exists: ${repo.html_url}`);
} catch (error) {
  if (!String(error.message).startsWith('GET /repos/')) throw error;
}

if (!repo) {
  repo = await api('/user/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: repoName, description, private: visibility === 'private', has_issues: true, has_wiki: false, auto_init: false }),
  }, auth);
  console.log(`repository created: ${repo.html_url}`);
}

const branch = repo.default_branch || 'main';
let parentSha = null;
try {
  const ref = await api(`/repos/${OWNER}/${repoName}/git/ref/heads/${branch}`, {}, auth);
  parentSha = ref.object.sha;
} catch { /* empty repository */ }

// An empty repository rejects blob creation with 409, so seed one commit first.
// It is then replaced by a single root commit that carries the whole tree.
if (!parentSha) {
  await api(`/repos/${OWNER}/${repoName}/contents/.publish-seed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'chore: prepare repository', content: Buffer.from('seed\n').toString('base64') }),
  }, auth);
  console.log('seeded empty repository');
}
parentSha = parentSha || (await api(`/repos/${OWNER}/${repoName}/git/ref/heads/${branch}`, {}, auth)).object.sha;

const singleCommit = flag('single-commit') || flag('reset-history');

const blobs = new Map();
for (const file of files) {
  const content = (await readFile(join(repoRoot, file))).toString('base64');
  const blob = await api(`/repos/${OWNER}/${repoName}/git/blobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, encoding: 'base64' }),
  }, auth);
  blobs.set(file, blob.sha);
}

const useParent = parentSha && !singleCommit;
const baseTree = useParent ? (await api(`/repos/${OWNER}/${repoName}/git/commits/${parentSha}`, {}, auth)).tree.sha : undefined;

const tree = await api(`/repos/${OWNER}/${repoName}/git/trees`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree: [...blobs].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })),
  }),
}, auth);

const commit = await api(`/repos/${OWNER}/${repoName}/git/commits`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'feat: local 3D workbench plugin for DSH (STEP/STL/OBJ viewing and measurement)',
    tree: tree.sha,
    ...(useParent ? { parents: [parentSha] } : {}),
  }),
}, auth);

if (parentSha) {
  await api(`/repos/${OWNER}/${repoName}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: true }),
  }, auth);
} else {
  await api(`/repos/${OWNER}/${repoName}/git/refs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  }, auth);
}

await api(`/repos/${OWNER}/${repoName}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ description, homepage: '', topics: ['dsh', 'dsh-plugin', 'threejs', 'step', 'cad', '3d-viewer', 'measurement'] }),
}, auth).catch(() => {});

console.log(`\npublished ${files.length} files`);
console.log(`${repo.html_url}  (branch ${branch}, commit ${commit.sha.slice(0, 7)})`);
