import assert from 'node:assert/strict';
import { apply } from '../index.js';

let route;
apply({
  effect: run => run(),
  connection: { fetch: { register: registration => { route = registration; return () => {}; } } },
});

const call = (path, extra = '') => route.fetch(new Request('http://localhost/api/product-model-compare?path=' + path + extra));

const list = await (await call('local-list')).json();
assert.equal(typeof list.ready, 'boolean');
assert.ok(Array.isArray(list.files));
if (list.ready) assert.ok(list.files.every(row => typeof row.FullName === 'string'));

for (const name of ['local-viewer.js', 'three.module.js', 'OrbitControls.js']) {
  const response = await call(name);
  assert.equal(response.status, 200, name + ' must be bundled');
  assert.ok((await response.text()).length > 100);
}

assert.equal((await call('local-viewer.js', '')).headers.get('cache-control'), 'no-store');

if (list.ready && list.files.length) {
  const blocked = await call('local-file', '&file=' + encodeURIComponent(list.files[0].FullName.replace(/[^\\/]+$/, 'not-this-file.step')));
  assert.equal(blocked.status, 403);
} else {
  assert.equal((await call('local-file', '&file=' + encodeURIComponent('C:\\Windows\\win.ini'))).status, 409);
}

assert.equal((await call('parse-step')).status, 404, 'parse-step requires POST');
console.log(JSON.stringify({ passed: true, indexed: list.ready ? list.files.length : 0, checks: ['index listing', 'bundled assets', 'index allowlist', 'method restriction'] }));
