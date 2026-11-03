// Standalone, ephemeral local mesh viewer. No application services or persistence.
const mounts = new WeakMap();

export function parseSTL(buffer) {
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const positions = [];
  if (count > 0 && 84 + count * 50 <= buffer.byteLength) {
    for (let i = 0; i < count; i++) for (let j = 0; j < 9; j++) positions.push(view.getFloat32(84 + i * 50 + 12 + j * 4, true));
  } else {
    const text = new TextDecoder().decode(buffer);
    const re = /\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    for (const m of text.matchAll(re)) positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (!positions.length || positions.length % 9 || !positions.every(Number.isFinite)) throw Error('STL 中没有有效三角面');
  return { parts: [{ name: 'STL', positions }] };
}

export function parseOBJ(text) {
  const vertices = [], parts = []; let part = { name: 'OBJ', positions: [] };
  const flush = () => { if (part.positions.length) parts.push(part); };
  for (const raw of text.split(/\r?\n/)) {
    const [type, ...args] = raw.trim().split(/\s+/);
    if (type === 'v') vertices.push(args.slice(0, 3).map(Number));
    if (type === 'o' || type === 'g') { flush(); part = { name: args.join(' ') || 'OBJ', positions: [] }; }
    if (type === 'f') {
      const face = args.filter(a => !a.startsWith('#')).map(a => { const n = Number(a.split('/')[0]); return vertices[n < 0 ? vertices.length + n : n - 1]; });
      if (face.length < 3 || face.some(v => !v || v.length !== 3 || !v.every(Number.isFinite))) throw Error('OBJ 面索引无效');
      for (let i = 1; i < face.length - 1; i++) part.positions.push(...face[0], ...face[i], ...face[i + 1]);
    }
  }
  flush(); if (!parts.length) throw Error('OBJ 中没有可显示的面'); return { parts };
}

async function modelCache(key, operation, value) {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dsh-local-model-viewer',1);r.onupgradeneeded=()=>r.result.createObjectStore('models');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('models',operation==='get'?'readonly':'readwrite'),store=tx.objectStore('models');const r=operation==='get'?store.get(key):operation==='delete'?store.delete(key):store.put(value,key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('缓存操作取消'));});}finally{db.close();}
}
export function mountLocalViewer(host, { THREE: T, OrbitControls, loadFile, listFiles, readLocalFile, cacheKey='left' } = {}) {
  if (!host || !T || !OrbitControls) throw Error('Viewer requires host, THREE and OrbitControls');
  mounts.get(host)?.();
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  const shell = document.createElement('section');
  shell.style.cssText='height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden';
  shell.innerHTML = `<style>
  :host{display:block;height:100%;min-height:0}*{box-sizing:border-box}.viewer{height:100%;min-height:280px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#171a20);color:var(--dsw-alias-label-primary,#e6eaf0);font:12px/1.4 system-ui,sans-serif;border:1px solid var(--dsw-alias-border-l1,#39414d);border-radius:10px;overflow:hidden}.bar{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1,#39414d);background:var(--dsw-alias-bg-layer-1,#222730)}button,.open{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l1,#45505f);background:var(--dsw-alias-bg-layer-2,#2b323d);padding:5px 8px;border-radius:5px;cursor:pointer;white-space:nowrap}button:hover,.open:hover{background:var(--dsw-alias-interactive-bg-hover,#39485e)}button[aria-pressed=true]{border-color:#69aaf2;background:var(--dsw-alias-interactive-bg-active,#314b69)}button:focus-visible,.open:focus-within{outline:2px solid #69aaf2;outline-offset:2px}.open{position:relative;overflow:hidden}.open input{position:absolute;width:1px;height:1px;opacity:0}.name{flex:1;min-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#aab5c4)}.stage{position:relative;flex:1;min-height:140px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#202630)}canvas{display:block;width:100%;height:100%;touch-action:none}.empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;pointer-events:none;color:var(--dsw-alias-label-secondary,#aab5c4);padding:20px}.empty strong{font-size:16px;margin-bottom:6px}.footer{padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l1,#39414d);color:var(--dsw-alias-label-secondary,#aab5c4)}.result{max-height:90px;overflow:auto;padding:0 10px;color:var(--dsw-alias-label-primary,#e6eaf0)}.result div{padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#39414d)}
  </style><div class="viewer"><div class="bar"><label class="open">打开本地模型<input aria-label="打开本地模型" type="file" accept=".step,.stp,.json,.stl,.obj"></label><span class="name">未打开文件</span><button data-view="fit">适应</button><button data-view="front">前</button><button data-view="top">顶</button><button data-view="side">侧</button><button data-view="iso">等轴</button></div><div class="bar" aria-label="测量工具"><button data-mode="orbit" aria-pressed="true">旋转</button><button data-mode="part" aria-pressed="false">部件尺寸</button><button data-mode="distance" aria-pressed="false">两点距离</button><button data-mode="angle" aria-pressed="false">三点角度</button><button data-pose>当前姿态尺寸</button><button data-mode="align" aria-pressed="false">摆正模型（选平面）</button><button data-isolate>单独查看部件</button><button data-assembly>返回整机</button><button data-resetpose>恢复原始姿态</button><button data-clear>清除测量</button><button data-remove>清除模型</button></div><div class="stage"><div class="empty"><strong>本地 3D 预览</strong><span>STEP / STP · JSON · STL · OBJ<br>本机自动记住上次状态 · 不接入资料库</span></div></div><div class="result" aria-live="polite"></div><div class="footer" role="status">拖动旋转 · 滚轮缩放 · 右键平移</div></div>`;
  const polish=document.createElement('style');polish.textContent=`.viewer{flex:1;min-height:0;border:0;border-radius:0;background:#202630}.bar{flex:0 0 auto;padding:10px 12px;gap:6px}.stage{flex:1 1 0;min-height:180px;background:#eef1f5}.stage canvas{position:absolute;inset:0;width:100%;height:100%}.result{flex:0 0 auto;max-height:140px;background:var(--dsw-alias-bg-layer-1,#222730);padding:0 14px}.result:empty{display:none}.result div{padding:12px 0;font-size:13px;line-height:1.7}.footer{flex:0 0 auto;font-size:11px}.empty{color:#586779}.bar button,.open{padding:7px 10px;border-radius:7px}.name{min-width:100px}.open{font-weight:600}button[aria-pressed=true]{background:#275d87;color:#fff;border-color:#5d9ccb}`;shell.append(polish);
  const fileBar=document.createElement('div');fileBar.className='file-controls';fileBar.innerHTML='<input type="search" placeholder="搜索本地 STEP 文件" aria-label="搜索模型"><select aria-label="本地模型列表"><option value="">正在读取扫描列表…</option></select><button data-refresh title="重新读取本地 STEP 列表">刷新</button>';const topBar=shell.querySelector('.bar');topBar.insertBefore(fileBar,topBar.querySelector('[data-view]'));const search=fileBar.querySelector('input'),select=fileBar.querySelector('select');let files=[];
  const populate=()=>{const needle=search.value.toLowerCase();select.replaceChildren(new Option(`选择本地模型（${files.length}）`,''));for(const f of files.filter(f=>f.FullName.toLowerCase().includes(needle))){const option=new Option(f.FullName,f.FullName);option.title=f.FullName;select.add(option);}};
  async function refreshLibrary(){try{const data=await listFiles?.();if(disposed)return;files=data?.files||[];populate();if(!data?.ready){const option=select.options[0];option.text=data?.hint||'尚未生成本地模型索引';option.title=data?.index||'';}}catch{if(!disposed)select.options[0].text='列表读取失败，请刷新';}}
  search.addEventListener('input',populate);select.addEventListener('change',async()=>{const path=select.value;if(!path)return;const token=++generation;try{status.textContent='正在读取本地文件…';const file=await readLocalFile(path);if(!disposed&&token===generation)await open({target:{files:[file],value:''}});}catch(e){if(!disposed&&token===generation)status.textContent=e.message;}});
  // Stable layout regions make additional tools/inspector cards independent of the viewport.
  const viewer=shell.querySelector('.viewer'), toolBar=shell.querySelector('[aria-label="测量工具"]'), stageEl=shell.querySelector('.stage');
  const viewDock=document.createElement('div');viewDock.className='view-dock';for(const b of [...shell.querySelectorAll('[data-view]')])viewDock.append(b);stageEl.append(viewDock);
  const workarea=document.createElement('div');workarea.className='workarea';
  const rail=document.createElement('nav');rail.className='tool-rail';rail.setAttribute('aria-label','模型工具');
  const inspector=document.createElement('aside');inspector.className='inspector';inspector.setAttribute('aria-label','模型属性');
  inspector.innerHTML='<div class="inspector-heading"><span>INSPECTOR</span><h3>模型检查</h3></div><p class="inspector-context">选择模型或点击部件，查看尺寸与操作。</p><section class="dimension-card" hidden><h4></h4><dl></dl><p class="dimension-note"></p></section><div class="inspector-actions"></div><h4 class="results-heading">测量记录</h4>';
  const actions=inspector.querySelector('.inspector-actions');
  for(const button of [...toolBar.children]){if(button.matches('[data-isolate],[data-assembly],[data-resetpose],[data-clear],[data-remove]'))actions.append(button);else rail.append(button);}
  for(const [i,button] of [...rail.children].entries()){const text=button.textContent;button.title=text;button.innerHTML='<span class="tool-symbol" aria-hidden="true">'+['↻','◇','↔','∠','▣','⊥'][i]+'</span><span></span>';button.lastElementChild.textContent=text.replace('（选平面）','');}
  inspector.append(shell.querySelector('.result'));workarea.append(rail,shell.querySelector('.stage'),inspector);toolBar.replaceWith(workarea);
  const design=document.createElement('style');design.textContent=`
  .viewer{container-type:inline-size;background:#f3f5f9;color:#22334a;font:12px/1.5 system-ui,sans-serif}
  .bar{background:#fff;border-color:#e0e6ef;padding:9px 12px;gap:8px;flex-wrap:wrap}.bar input,.bar select{border:1px solid #dce3ee;border-radius:7px;background:#f8faff;color:#25364e;padding:8px;font:inherit;outline:none}.bar input:focus,.bar select:focus{border-color:#467deb}
  .file-controls{display:flex;align-items:center;gap:8px;flex:1;min-width:260px}.file-controls input{flex:1;min-width:110px}.file-controls select{flex:2;min-width:150px;max-width:420px;text-overflow:ellipsis}
  .view-dock{position:absolute;top:12px;right:12px;z-index:3;display:flex;gap:4px;padding:4px;background:#ffffffd9;backdrop-filter:blur(8px);border:1px solid #dbe3ef;border-radius:10px;box-shadow:0 4px 14px #24354b12}.view-dock button{border-color:transparent;background:transparent;color:#516582;font-size:11px;padding:6px 9px;border-radius:7px}.view-dock button:hover{background:#eaf2ff;color:#2258a8}
  .stage[data-mode=part] canvas{cursor:pointer}.stage[data-mode=distance] canvas,.stage[data-mode=angle] canvas{cursor:crosshair}.stage[data-mode=align] canvas{cursor:cell}
  button,.open{background:#fff;border:1px solid #dce3ee;color:#415471;border-radius:7px;padding:7px 10px;transition:background .12s,border-color .12s}.bar .open{background:#edf4ff;border-color:#cadaf9;color:#2658a7}.name{color:#586b83}button:hover,.open:hover{background:#edf4ff;border-color:#bdd0ef}button:disabled{opacity:.42;cursor:not-allowed}button[aria-pressed=true]{background:#eaf2ff;border-color:#bed2f5;color:#205fc5}
  .workarea{display:grid;grid-template-columns:72px minmax(120px,1fr) 238px;flex:1;min-height:0;overflow:hidden}.tool-rail{padding:10px 6px;background:#fff;border-right:1px solid #e0e6ef;display:flex;flex-direction:column;gap:7px;overflow:auto}.tool-rail button{border-color:transparent;white-space:normal;padding:8px 2px;display:flex;flex-direction:column;align-items:center;font-size:10px;gap:4px;line-height:1.4}.tool-symbol{font-size:21px;line-height:24px}.tool-rail button[aria-pressed=true]{border-color:#c8daf8}.stage{min-width:0;min-height:180px}.inspector{padding:18px 15px;background:#fff;border-left:1px solid #e0e6ef;overflow:auto;min-height:0}.inspector-heading>span{font-size:9px;letter-spacing:1.8px;color:#8799b1}.inspector h3{margin:5px 0 12px;font-size:17px;color:#1a2e4b}.inspector h4{font-size:12px;margin:16px 0 8px;color:#354c6a}.inspector-context,.dimension-note{font-size:11px;line-height:1.7;color:#8392a8;overflow-wrap:anywhere}.dimension-card dl{margin:0}.dimension-card dl>div{display:flex;align-items:baseline;gap:8px;border-bottom:1px solid #edf0f5;padding:13px 0}.dimension-card dt{color:#8392a8;flex:1}.dimension-card dd{margin:0;font-size:19px;font-variant-numeric:tabular-nums;font-weight:600;color:#15365c}.dimension-card small{font-size:10px;color:#93a0b2;font-weight:400;margin-left:5px}.inspector-actions{display:grid;gap:7px;margin:18px 0}.inspector-actions button{text-align:left;font-size:11px;padding:9px 10px}.inspector-actions [data-remove]{color:#ae5260}.result{background:transparent;color:#52647c;padding:0;max-height:none;font-size:11px}.result div{font-size:11px;padding:10px 0;border-color:#e8edf5;overflow-wrap:anywhere}.result:empty:after{content:'尚无测量记录';color:#9aa8ba;display:block;padding:8px 0}.result:empty{display:block}.footer{background:#f9fbfd;border-color:#e0e6ef;color:#70819a;padding:7px 12px;min-height:30px}.empty{color:#8190a5}.empty strong{color:#425c7b}
  @container(max-width:650px){.workarea{grid-template-columns:58px minmax(100px,1fr) 180px}.inspector{padding:12px 10px}.dimension-card dd{font-size:16px}.bar{padding:7px}.tool-rail{padding:7px 3px}}
  @container(max-width:430px){.workarea{grid-template-columns:50px minmax(0,1fr);grid-template-rows:minmax(200px,1fr) auto}.inspector{grid-column:1/-1;max-height:230px;border-top:1px solid #e0e6ef}.tool-rail{grid-row:1}.inspector-actions{grid-template-columns:1fr 1fr}}
  `;shell.append(design);
  root.append(shell);
  const $ = s => shell.querySelector(s), stage = $('.stage'), status = $('.footer'), results = $('.result');
  let savedData=null,savedName='',persistTimer;let disposed = false, generation = 0, frame = 0, mode = 'orbit', points = [], selected = null, highlight = null, down = null;
  const scene = new T.Scene(), group = new T.Group(), marks = new T.Group(); scene.add(group, marks);
  const camera = new T.PerspectiveCamera(42, 1, .01, 1e7); camera.up.set(0, 0, 1);
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false }); } catch (error) { shell.remove(); throw error; }
  renderer.setClearColor(0xeef1f5,1); renderer.outputColorSpace=T.SRGBColorSpace; renderer.toneMapping=T.ACESFilmicToneMapping; renderer.toneMappingExposure=1;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2)); stage.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
  scene.add(new T.HemisphereLight(0xffffff, 0x667788, 2.5));
  const light = new T.DirectionalLight(0xffffff, 2.6); light.position.set(2, -3, 5); scene.add(light);
  const ray = new T.Raycaster(), box = new T.Box3(), center = new T.Vector3(); let radius = 1;
  let isolated=null;
  function visibleMeshes(){const list=[];group.traverseVisible(o=>{if(o.isMesh)list.push(o);});return list;}
  function updateBounds(){group.updateMatrixWorld(true);box.makeEmpty();const p=new T.Vector3();for(const mesh of visibleMeshes()){const a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++)box.expandByPoint(p.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld));}if(box.isEmpty())return;box.getCenter(center);radius=Math.max(box.getSize(new T.Vector3()).length()/2,.001);}
  function showDimensions(title,size,note){const card=$('.dimension-card');card.hidden=false;card.querySelector('h4').textContent=title;card.querySelector('dl').replaceChildren();for(const [axis,value] of [['X',size.x],['Y',size.y],['Z',size.z]]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd'),unit=document.createElement('small');dt.textContent=axis+' 方向';dd.textContent=format(value);unit.textContent=savedData?.unit||'模型单位';dd.append(unit);row.append(dt,dd);card.querySelector('dl').append(row);}card.querySelector('.dimension-note').textContent=note;}
  function syncInspector(){const loaded=!!group.children.length;for(const b of shell.querySelectorAll('[data-pose],[data-resetpose],[data-mode],[data-view]'))b.disabled=!loaded; $('[data-isolate]').disabled=!selected||!!isolated;$('[data-assembly]').disabled=!isolated;$('[data-remove]').disabled=!loaded;$('.inspector-context').textContent=selected?selected.name:isolated?'独立部件 · 可点选平面摆放':savedName||'选择模型或点击部件，查看尺寸与操作。';}
  function poseDimensions(){if(!group.children.length)return;updateBounds();showDimensions(isolated?'部件当前姿态尺寸':'整机当前姿态尺寸',box.getSize(new T.Vector3()),'基于显示网格的世界轴向外形近似尺寸，不随观察视角改变。');syncInspector();}
  function clearPoseMeasurements(){clearMarks();}
  function render() { if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) renderer.render(scene, camera); }); }
  function release(object) { const geometries = new Set(), materials = new Set(); object.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); }); geometries.forEach(g => g.dispose()); materials.forEach(m => { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }); }
  function emptyGroup(g) { release(g); g.clear(); }
  let originalSelectionMaterial=null;
  function unselect(){if(selected&&originalSelectionMaterial){const temporary=selected.material;selected.material=originalSelectionMaterial;for(const material of Array.isArray(temporary)?temporary:[temporary])material.dispose();}originalSelectionMaterial=null;selected=null;if(highlight){scene.remove(highlight);release(highlight);highlight=null;}}
  function selectMesh(mesh){unselect();selected=mesh;originalSelectionMaterial=mesh.material;const blue=material=>{const copy=material.clone();copy.color?.set(0x3285ef);copy.emissive?.set(0x123b79);if('emissiveIntensity' in copy)copy.emissiveIntensity=.25;return copy;};mesh.material=Array.isArray(mesh.material)?mesh.material.map(blue):blue(mesh.material);showDimensions('选中部件 · 当前轴向尺寸',new T.Box3().setFromObject(mesh).getSize(new T.Vector3()),'蓝色表示当前选中部件。单独查看后可继续摆正与测量。');syncInspector();}
  function clearMarks(){points=[];emptyGroup(marks);results.replaceChildren();render();}
  function clear() { clearMarks();unselect();$('.dimension-card').hidden=true;syncInspector();render(); }
  function result(text) { const row = document.createElement('div'); row.textContent = text; if(mode==='part')results.replaceChildren(row);else{results.append(row);while(results.children.length>3)results.firstElementChild.remove();} results.scrollTop = results.scrollHeight; }
  function meshStates(){const a=[];group.traverse(o=>{if(o.isMesh)a.push({visible:o.visible,q:o.quaternion.toArray(),isolated:o===isolated});});return a;}
  function stateSnapshot(){return {pose:group.quaternion.toArray(),meshStates:meshStates(),camera:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray(),mode,results:Array.from(results.children,r=>r.textContent),marks:marks.toJSON(),points:points.map(p=>p.toArray())};}
  function persist(){if(!savedData)return;clearTimeout(persistTimer);persistTimer=setTimeout(()=>{modelCache(cacheKey+':state','put',stateSnapshot()).catch(()=>{if(!disposed)status.textContent='本机缓存失败：请检查磁盘空间；此次模型仍可查看';});},300);}
  function saveModel(){return modelCache(cacheKey+':data','put',{data:savedData,name:savedName}).catch(()=>{if(!disposed)status.textContent='模型本机缓存写入失败；当前仍可查看，但下次可能无法自动恢复';});}
  controls.addEventListener('change',persist);
  const format = n => Number(n.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 5 });
  function fit(view = 'fit') {
    if (!group.children.length) return;
    const dirs = { front: [0, -1, 0], top: [0, 0, 1], side: [1, 0, 0], iso: [1, -1.5, 1] };
    let direction = dirs[view] ? new T.Vector3(...dirs[view]) : camera.position.clone().sub(controls.target);
    if (!direction.lengthSq()) direction.set(1, -1.5, 1);
    direction.normalize();
    camera.up.set(0,0,1);if(view==='top')camera.up.set(0,1,0);
    const right=new T.Vector3().crossVectors(camera.up,direction).normalize(),up=new T.Vector3().crossVectors(direction,right).normalize();
    const half=T.MathUtils.degToRad(camera.fov/2);let distance=0;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new T.Vector3(x,y,z).sub(center);distance=Math.max(distance,p.dot(direction)+Math.max(Math.abs(p.dot(right))/(Math.tan(half)*camera.aspect),Math.abs(p.dot(up))/Math.tan(half))*1.12);}
    distance=Math.max(distance,radius*.1);
    controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance);
    camera.up.set(0, 0, 1); if (view === 'top') camera.up.set(0, 1, 0);
    camera.near = Math.max(distance / 10000, 1e-6); camera.far = distance + radius * 100; camera.updateProjectionMatrix(); controls.update(); render();
  }
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h || disposed) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); render(); }
  const observer = new ResizeObserver(resize); observer.observe(stage); controls.addEventListener('change', render);
  function meshData(data) {
    if (data?.isObject3D) return data;
    if (!Array.isArray(data?.parts)) throw Error('JSON 必须包含 parts 数组');
    const next = new T.Group();
    try { data.parts.forEach((p, i) => {
      const pos = p.positions, idx = p.indices;
      if (!(Array.isArray(pos) || ArrayBuffer.isView(pos)) || pos.length < 9 || pos.length % 3 || !Array.from(pos).every(Number.isFinite)) throw Error(`部件 ${i + 1} 的 positions 无效`);
      if (idx != null && (!(Array.isArray(idx) || ArrayBuffer.isView(idx)) || !idx.length || idx.length % 3 || !Array.from(idx).every(n => Number.isInteger(n) && n >= 0 && n < pos.length / 3))) throw Error(`部件 ${i + 1} 的 indices 无效`);
      if (idx == null && pos.length % 9) throw Error(`部件 ${i + 1} 的三角面无效`);
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); if (idx != null) g.setIndex(Array.from(idx)); g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x8294a6, roughness: .48, metalness: .18, side: T.DoubleSide })); m.name = p.name || `部件 ${i + 1}`; next.add(m);
    }); if (!next.children.length) throw Error('模型不含网格'); return next; } catch (error) { release(next); throw error; }
  }
  async function open(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const token = ++generation; status.textContent = `正在读取 ${file.name}…`;
    let next;
    try {
      const ext = file.name.split('.').pop().toLowerCase(); let data;
      if (ext === 'step' || ext === 'stp') { if (typeof loadFile !== 'function') throw Error('STEP 解析器未连接'); data = await loadFile(file); }
      else if (ext === 'json') data = JSON.parse(await file.text());
      else if (ext === 'stl') data = parseSTL(await file.arrayBuffer());
      else if (ext === 'obj') data = parseOBJ(await file.text());
      else throw Error('不支持此文件格式');
      if (disposed || token !== generation) { if (data?.isObject3D) release(data); return; }
      next = meshData(data); box.setFromObject(next); if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) throw Error('模型包围盒无效');
      isolated=null;group.quaternion.identity();clear(); emptyGroup(group); group.add(next); next = null;savedData=data;savedName=file.name;
      box.getCenter(center); radius = Math.max(box.getSize(new T.Vector3()).length() / 2, .001);
      $('.name').textContent = file.name; $('.name').title = file.name; $('.empty').hidden = true; $('.empty').style.display = 'none'; resize(); fit('iso');
      let count = 0; group.traverse(o => { if (o.isMesh) count++; }); status.textContent = `${count} 个网格 · 尺寸 / 距离使用模型原始单位 · 拖动旋转`;poseDimensions();saveModel();persist();
    } catch (error) { if (next) release(next); if (!disposed && token === generation) status.textContent = `打开失败：${error.message}`; }
  }
  function marker(point) { const m = new T.Mesh(new T.SphereGeometry(radius * .009, 12, 8), new T.MeshBasicMaterial({ color: 0xffb347, depthTest: false })); m.position.copy(point); m.renderOrder = 10; marks.add(m); }
  function line(vertices) { const g = new T.BufferGeometry().setFromPoints(vertices), m = new T.Line(g, new T.LineBasicMaterial({ color: 0xffb347, depthTest: false })); m.renderOrder = 10; marks.add(m); }
  function pick(event) {
    if (mode === 'orbit' || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = ray.intersectObjects(visibleMeshes(), false)[0]; if (!hit) { status.textContent = '请点击模型表面'; return; }
    if(mode==='align'){const normal=hit.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();const q=new T.Quaternion().setFromUnitVectors(normal,new T.Vector3(0,0,1));const target=isolated||group;const parentQ=target.parent.getWorldQuaternion(new T.Quaternion());const localQ=parentQ.clone().invert().multiply(q).multiply(parentQ);target.quaternion.premultiply(localQ);clearPoseMeasurements();updateBounds();fit('iso');poseDimensions();status.textContent='所选面已对齐 XY 平面；点击另一平面可重新摆正，恢复原始姿态可撤销';persist();return;}
    if (mode === 'part') {
      selectMesh(hit.object);
    } else {
      const point = hit.point.clone(); points.push(point); marker(point);
      if (points.length > 1) line([points[points.length - 2], point]);
      const required = mode === 'distance' ? 2 : 3;
      if (points.length === required) {
        if (required === 2) result(`两点距离：${format(points[0].distanceTo(points[1]))}（模型单位）`);
        else { const a = points[0].clone().sub(points[1]), b = points[2].clone().sub(points[1]); result(a.lengthSq() && b.lengthSq() ? `三点角度：${format(T.MathUtils.radToDeg(a.angleTo(b)))}°（第二点为顶点）` : '角度无效：请勿重复选取同一点'); }
        points = [];
      }
      status.textContent = `${mode === 'distance' ? '两点距离' : '三点角度'}：已选 ${points.length}/${required} 点 · 点击模型表面继续`;
    }
    render();
  }
  const pointerDown = event => { down = { x: event.clientX, y: event.clientY }; };
  const click = event => {
    const button = event.target.closest('button'); if (!button) return;
    if(button.hasAttribute('data-pose'))poseDimensions();
    if(button.hasAttribute('data-isolate')){if(!selected){status.textContent='请先使用“部件尺寸”点选一个部件';return;}isolated=selected;group.quaternion.identity();group.traverse(o=>{if(o.isMesh)o.visible=o===isolated;});clearPoseMeasurements();updateBounds();fit('iso');poseDimensions();status.textContent='已单独显示选中部件，可使用“摆正模型”点选平面摆放';}
    if(button.hasAttribute('data-assembly')){isolated=null;group.traverse(o=>{if(o.isMesh){o.visible=true;o.quaternion.identity();}});clearPoseMeasurements();updateBounds();fit('iso');poseDimensions();}
    if(button.hasAttribute('data-resetpose')){group.quaternion.identity();group.traverse(o=>{if(o.isMesh)o.quaternion.identity();});clearPoseMeasurements();updateBounds();fit('iso');poseDimensions();}
    if(button.hasAttribute('data-refresh'))refreshLibrary();
    if(button.hasAttribute('data-remove')){generation++;savedData=null;savedName='';clearTimeout(persistTimer);clear();emptyGroup(group);$('.name').textContent='未打开文件';$('.empty').style.display='grid';select.value='';Promise.all([modelCache(cacheKey+':data','delete'),modelCache(cacheKey+':state','delete')]).then(()=>{if(!disposed)status.textContent='模型已清除，原文件未删除';}).catch(()=>{if(!disposed)status.textContent='缓存清除失败，请重试';});render();}
    if (button.dataset.view) fit(button.dataset.view);
    if (button.dataset.mode) { mode = button.dataset.mode;stageEl.dataset.mode=mode;if(mode!=='part')unselect(); points = []; shell.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); status.textContent = ({ align:'点击需要放平的模型表面：将该面法线对齐 Z 轴。请选平面而非圆管曲面。', orbit: '拖动旋转 · 滚轮缩放 · 右键平移', part: '点击部件查看世界轴向包围盒尺寸', distance: '依次点击两个表面点', angle: '依次点击三个表面点，第二点为角顶点' })[mode]; }
    if (button.hasAttribute('data-clear')) { clearMarks(); status.textContent = '已清除测量标记'; }
    syncInspector();render();
  };
  shell.addEventListener('click', click); $('input[type=file]').addEventListener('change', open); renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pick);
  camera.position.set(3, -4, 3); controls.update(); stageEl.dataset.mode=mode; resize();refreshLibrary();syncInspector();
  shell.addEventListener('click',persist);renderer.domElement.addEventListener('pointerup',persist);
  const restoreGeneration=generation;
  async function restore(){try{
    let saved=await modelCache(cacheKey+':data','get'),legacy=null;
    if(!saved){legacy=await modelCache(cacheKey,'get');saved=legacy;}
    if(!saved||disposed||generation!==restoreGeneration)return;
    const next=meshData(saved.data);box.setFromObject(next);group.add(next);
    box.getCenter(center);radius=Math.max(box.getSize(new T.Vector3()).length()/2,.001);
    savedData=saved.data;savedName=saved.name;$('.name').textContent=saved.name;$('.name').title=saved.name;$('.empty').style.display='none';
    resize();fit('iso');
    const state=legacy||await modelCache(cacheKey+':state','get').catch(()=>null);
    if(disposed||generation!==restoreGeneration)return;
    if(state){
      if(state.pose)group.quaternion.fromArray(state.pose);
      let i=0;group.traverse(o=>{if(o.isMesh){const s=state.meshStates?.[i++];if(s){o.visible=s.visible;o.quaternion.fromArray(s.q);if(s.isolated)isolated=o;}}});
      updateBounds();fit('iso');
      if(state.camera){camera.position.fromArray(state.camera);controls.target.fromArray(state.target);camera.up.fromArray(state.up);controls.update();}
      mode=state.mode||'orbit';stageEl.dataset.mode=mode;shell.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
      for(const text of state.results||[])result(text);
      if(state.marks){const restored=new T.ObjectLoader().parse(state.marks);for(const child of [...restored.children])marks.add(child);}
      points=(state.points||[]).map(p=>new T.Vector3(...p));
    }
    if(legacy)saveModel();
    poseDimensions();status.textContent=state?'已恢复上次模型、视角与测量状态':'已恢复上次模型';render();
  }catch(e){if(!disposed)status.textContent='上次状态恢复失败：'+e.message;}}
  restore();
  function dispose() { if (disposed) return;clearTimeout(persistTimer);if(savedData)modelCache(cacheKey+':state','put',stateSnapshot()).catch(()=>{});controls.removeEventListener('change',persist); disposed = true; generation++; cancelAnimationFrame(frame); observer.disconnect(); controls.removeEventListener('change', render); controls.dispose(); shell.removeEventListener('click', click);shell.removeEventListener('click',persist);renderer.domElement.removeEventListener('pointerup',persist); $('input[type=file]').removeEventListener('change', open); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pick); unselect();release(group); release(marks); if (highlight) release(highlight); renderer.dispose(); renderer.forceContextLoss(); shell.remove(); if (mounts.get(host) === dispose) mounts.delete(host); }
  mounts.set(host, dispose); return dispose;
}
