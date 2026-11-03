import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bundleRoot = fileURLToPath(new URL('./', import.meta.url));
const MAX_BYTES = 300 * 1024 * 1024;
const indexFile = () => process.env.PRODUCT_MODEL_INDEX || join(homedir(), '.product-model-compare', 'step-index.json');
const pythonBin = () => process.env.PRODUCT_VIEWER_PYTHON || 'python';
const resources = {
  'local-viewer.js': ['local-viewer.js', 'text/javascript'],
  'three.module.js': ['vendor/three.module.js', 'text/javascript'],
  'OrbitControls.js': ['vendor/OrbitControls.js', 'text/javascript'],
};

async function readIndex() {
  let raw;
  try { raw = await readFile(indexFile(), 'utf8'); } catch { return null; }
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.files) ? parsed.files : [];
  return rows.filter(row => row && typeof row.FullName === 'string');
}

function parseStep(request, filename) {
  const folder = mkdtemp(join(tmpdir(), 'dsh-model-preview-'));
  return folder.then(async dir => {
    try {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_BYTES) return Response.json({ error: '模型不能超过 300MB' }, { status: 413 });
      const input = join(dir, 'input.step'), output = join(dir, 'mesh.json');
      await writeFile(input, bytes);
      await new Promise((resolve, reject) => {
        const child = spawn(pythonBin(), [join(bundleRoot, 'parse-step.py'), input, output, filename], { stdio: 'ignore', windowsHide: true });
        const timer = setTimeout(() => { child.kill(); reject(Error('STEP 解析超时（180 秒）')); }, 180000);
        const abort = () => { child.kill(); reject(Error('已取消解析')); };
        request.signal.addEventListener('abort', abort, { once: true });
        child.once('error', cause => {
          clearTimeout(timer); request.signal.removeEventListener('abort', abort);
          reject(cause.code === 'ENOENT' ? Error('找不到 Python，请设置环境变量 PRODUCT_VIEWER_PYTHON') : cause);
        });
        child.once('exit', code => {
          clearTimeout(timer); request.signal.removeEventListener('abort', abort);
          code === 0 ? resolve() : reject(Error('STEP 解析失败：请确认已安装 OCP（pip install cadquery-ocp）'));
        });
      });
      return new Response(await readFile(output), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 422 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

export const inject = ['connection'];

export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/product-model-compare',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const url = new URL(request.url);
      const target = url.searchParams.get('path') || '';

      if (target === 'local-list' && request.method === 'GET') {
        const files = await readIndex();
        const payload = files
          ? { ready: true, files, index: indexFile() }
          : { ready: false, files: [], index: indexFile(), hint: '尚未生成本地模型索引：请运行 node scripts/scan-models.mjs' };
        return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (target === 'local-file' && request.method === 'GET') {
        const files = await readIndex();
        const wanted = url.searchParams.get('file');
        if (!files) return new Response('尚未生成本地模型索引', { status: 409 });
        if (!wanted || !files.some(row => row.FullName === wanted)) return new Response('文件不在已索引的模型列表中', { status: 403 });
        try {
          return new Response(await readFile(wanted), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
        } catch {
          return new Response('文件无法读取，可能已移动或删除', { status: 404 });
        }
      }

      if (target === 'parse-step' && request.method === 'POST') {
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > MAX_BYTES) return Response.json({ error: '模型不能超过 300MB' }, { status: 413 });
        return parseStep(request, decodeURIComponent(request.headers.get('x-filename') || 'model.step'));
      }

      const resource = resources[target];
      if (resource && request.method === 'GET') {
        const [file, type] = resource;
        let data = await readFile(bundleRoot + file);
        if (target === 'OrbitControls.js') data = Buffer.from(data.toString().replace("from 'three'", "from './three.module.js'"));
        return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
      }

      return Response.json({ error: 'Unknown resource' }, { status: 404 });
    },
  }));
}
