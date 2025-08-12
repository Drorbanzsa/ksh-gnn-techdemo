import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { SVGLoader }      from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLUSTER_COLORS, ICON_FILES, CLUSTER_LABELS } from './colors.js';

// minden útvonal a main.js-hez képest (GH Pages-safe)
const fromHere = (p) => new URL(p, import.meta.url).href;

// --- ÚJ: ISO (közeli) ikonok fájlnevei – MIND a gyökérben ---
const ICON_FILES_ISO = {
  0: 'c0-iso.svg',
  1: 'c1-iso.svg',
  2: 'c2-iso.svg',
  3: 'c3-iso.svg',
  4: 'c4-iso.svg'
};

/* -------------------- BEÁLLÍTÁSOK -------------------- */
// minden a gyökérben:
const GEO_PATH   = fromHere('clusters_k5.geojson');
const SIL_PATH   = fromHere('silhouette_local.csv');
const ALIAS_PATH = fromHere('alias_map.json');

// távoli (ország-nézet) ikonok
const ICONS_ABS = Object.fromEntries(
  Object.entries(ICON_FILES).map(([k, p]) => [k, fromHere(p)])
);
// közeli (zoom) ikonok
const ICONS_ISO_ABS = Object.fromEntries(
  Object.entries(ICON_FILES_ISO).map(([k, p]) => [k, fromHere(p)])
);

const iconGeomsFlat = await loadIconGeoms(ICONS_ABS);
const iconGeomsIso  = await loadIconGeoms(ICONS_ISO_ABS);



const OX = 19.5, OY = 47.0;
const SX = 6.5,  SY = 9.5;
const ICON_SCALE_XY = 0.006;
const ICON_SCALE_Z  = 0.003;

const toXY = (lon, lat, z=0) => [ (lon-OX)*SX, (lat-OY)*SY, z ];
function lonLatOfFeature(f){
  const p = f.properties || {};
  if (p.cx!=null && p.cy!=null) return [p.cx, p.cy];
  const g = f.geometry;
  let ring = null;
  if (g?.type === 'Polygon') ring = g.coordinates[0];
  else if (g?.type === 'MultiPolygon') ring = g.coordinates[0]?.[0];
  if (ring && ring.length){
    let sx=0, sy=0; for(const [x,y] of ring){ sx+=x; sy+=y; }
    return [sx/ring.length, sy/ring.length];
  }
  return [OX, OY];
}

/* -------------------- SCENE -------------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 5000);
camera.position.set(0, -6, 4);

const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = true;
controls.autoRotate = false;

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(2, -2, 3);
scene.add(dir);

/* -------------------- UI: TOOLTIP + LEGENDA + PANEL -------------------- */
ensureUI();
function ensureUI(){
  // tooltip
  if(!document.getElementById('tooltip')){
    const t = document.createElement('div');
    t.id = 'tooltip';
    Object.assign(t.style,{
      position:'fixed',display:'none',pointerEvents:'none',
      background:'rgba(0,0,0,.8)',color:'#fff',padding:'.35rem .5rem',
      font:'13px/1.35 system-ui,Segoe UI,Inter,Arial',borderRadius:'.4rem',zIndex:1001
    });
    document.body.appendChild(t);
  }
  // legenda
  if(!document.getElementById('legend')){
    const d = document.createElement('div'); d.id='legend'; document.body.appendChild(d);
  }
  // oldalsó panel
  if(!document.getElementById('sidepanel')){
    const p = document.createElement('div');
    p.id='sidepanel';
    p.innerHTML = `
      <div class="sp-hdr">
        <div class="sp-title"></div>
        <div class="sp-pill"></div>
        <button class="sp-close" title="Bezár">✕</button>
      </div>
      <div class="sp-body">
        <div class="sp-metric">
          <div class="k">Lokális s</div>
          <div class="v"><span class="sval">–</span></div>
          <div class="bar"><div class="fill"></div></div>
        </div>
        <div class="sp-feats">
          <div class="k">Top tényezők</div>
          <ul class="feat-list"></ul>
        </div>
        <div class="sp-tree">
          <img id="sp-tree-img" alt="Klaszter döntésfa" />
        </div>
        <div class="sp-actions">
          <button class="sp-back">Vissza</button>
        </div>
      </div>`;
    document.body.appendChild(p);
    p.querySelector('.sp-close').onclick = closePanel;
    p.querySelector('.sp-back').onclick  = closePanel;
  }

  // stílusok
  if(!document.getElementById('legend-style')){
    const css = `
      #legend{position:fixed;left:12px;top:12px;z-index:1000;
        background:rgba(255,255,255,.92);padding:.55rem .6rem;border-radius:.5rem;
        box-shadow:0 2px 10px rgba(0,0,0,.15);font:13px/1.35 system-ui,Segoe UI,Inter,Arial;}
      #legend .row{display:flex;align-items:center;gap:.45rem;margin:.25rem 0;}
      #legend .sw{width:12px;height:12px;border:1px solid rgba(0,0,0,.25);}
      #legend .hdr{font-weight:600;margin-bottom:.2rem;}
      #legend button{margin-left:.35rem;font-size:12px}

      #sidepanel{position:fixed;right:14px;top:14px;z-index:1000;width:340px;max-width:36vw;
        background:rgba(255,255,255,.96);border-radius:.75rem;box-shadow:0 12px 30px rgba(0,0,0,.2);
        transform:translateX(18px);opacity:0;pointer-events:none;transition:all .25s ease;}
      #sidepanel.open{transform:translateX(0);opacity:1;pointer-events:auto;}
      #sidepanel .sp-hdr{display:grid;grid-template-columns:1fr auto auto;gap:.4rem;align-items:center;
        padding:.7rem .8rem .3rem .9rem;}
      #sidepanel .sp-title{font:600 16px/1.2 system-ui,Segoe UI,Inter,Arial;}
      #sidepanel .sp-pill{justify-self:start;font:12px/1.1 system-ui;padding:.1rem .45rem;border-radius:.5rem;
        color:#222;background:#eee;border:1px solid rgba(0,0,0,.15);}
      #sidepanel .sp-close{border:0;background:transparent;font:16px/1 monospace;cursor:pointer;opacity:.6}
      #sidepanel .sp-body{padding:.2rem .9rem .9rem .9rem}
      #sidepanel .sp-metric .k{font-weight:600;margin:.35rem 0 .15rem}
      #sidepanel .bar{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin-top:.3rem}
      #sidepanel .bar .fill{height:100%;width:0;background:linear-gradient(90deg,#ff6b6b,#ffd166,#06d6a0)}
      #sidepanel .feat-list{margin:.25rem 0 0 .9rem;padding:0}
      #sidepanel .feat-list li{margin:.15rem 0}
      #sidepanel .sp-tree img{width:100%;display:block;margin:.65rem 0 .25rem;border-radius:.4rem;border:1px solid rgba(0,0,0,.1)}
      #sidepanel .sp-actions{display:flex;justify-content:flex-end;margin-top:.6rem}
      #sidepanel .sp-actions .sp-back{border:1px solid rgba(0,0,0,.2);background:#fff;border-radius:.5rem;
        padding:.35rem .6rem;cursor:pointer}
    `;
    const st = document.createElement('style'); st.id='legend-style'; st.textContent = css;
    document.head.appendChild(st);
  }
}

/* -------------------- TOOLTIP / RAYCASTER -------------------- */
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerX=0, pointerY=0;
window.addEventListener('pointermove', e=>{
  pointerX=e.clientX; pointerY=e.clientY;
  mouse.x  = (e.clientX/innerWidth)*2-1;
  mouse.y  =-(e.clientY/innerHeight)*2+1;
});
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closePanel(); });

/* -------------------- ÁLLAPOTOK -------------------- */
let activeKey = null;        // hoverelt járás
let detailLock = null;       // panel nyitva → lockolt járás
let fly = null;              // kamera „fly to” állapot
let NATION = null;           // ország-nézet paraméterei

/* -------------------- ADATOK BETÖLTÉSE -------------------- */
const [geo, META, ALIAS] = await Promise.all([
  (await fetch(GEO_PATH)).json(),
  loadMeta(SIL_PATH),        // ha nincs CSV, nem omlik össze
  loadAlias(ALIAS_PATH)      // ha nincs JSON, {}-t ad vissza
]);

/* -------------------- CSOPORTOK -------------------- */
const content    = new THREE.Group(); scene.add(content);
const fillsGroup = new THREE.Group(); fillsGroup.renderOrder = -2; content.add(fillsGroup);
const bordersGrp = new THREE.Group(); bordersGrp.renderOrder = -1; content.add(bordersGrp);
const iconsGroup = new THREE.Group(); content.add(iconsGroup);

/* -------------------- POLIGON‑KITÖLTÉS -------------------- */
const fillsByKey = drawFills(geo, fillsGroup);
function drawFills(geojson, group){
  const map = {};
  const trimClose = (ring)=>{
    if (!ring?.length) return [];
    const last = ring[ring.length-1], first = ring[0];
    const same = last && first && last[0]===first[0] && last[1]===first[1];
    return same ? ring.slice(0,-1) : ring.slice();
  };

  for(const f of geojson.features){
    const cid  = f.properties.cluster;
    const name = f.properties.NAME || `id_${Math.random().toString(36).slice(2)}`;
    const color = new THREE.Color(CLUSTER_COLORS[cid] || '#888');

    const polys = [];
    if (f.geometry?.type === 'Polygon') polys.push(f.geometry.coordinates);
    else if (f.geometry?.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
    else continue;

    for (const rings of polys){
      if (!rings?.length) continue;

      const outer = trimClose(rings[0]).map(([x,y]) => new THREE.Vector2(...toXY(x,y).slice(0,2)));
      if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();

      const shape = new THREE.Shape(outer);
      for (let i=1; i<rings.length; i++){
        const hole = trimClose(rings[i]).map(([x,y]) => new THREE.Vector2(...toXY(x,y).slice(0,2)));
        if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
        shape.holes.push(new THREE.Path(hole));
      }

      const geom = new THREE.ShapeGeometry(shape);
      geom.translate(0,0,-0.03); // picit lejjebb

      const mat  = new THREE.MeshBasicMaterial({
        color, transparent:true, opacity:0.28, depthWrite:false
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { key:name, cluster:cid, baseOpacity:0.28, baseColor: color.clone() };
      group.add(mesh);

      if (!map[name]) map[name] = mesh;  // több poligon is tartozhat egy névhez
    }
  }
  return map;
}

/* -------------------- HATÁRVONALAK -------------------- */
drawBorders(geo, bordersGrp);
function drawBorders(geojson, group){
  const pos = [];
  const pushRing = (ring) => {
    for (let i=1; i<ring.length; i++){
      const [x1,y1,z1] = toXY(ring[i-1][0], ring[i-1][1], -0.02);
      const [x2,y2,z2] = toXY(ring[i  ][0], ring[i  ][1], -0.02);
      pos.push(x1,y1,z1, x2,y2,z2);
    }
  };
  for (const f of geojson.features){
    const g = f.geometry; if (!g) continue;
    if (g.type==='Polygon')           for (const r of g.coordinates) pushRing(r);
    else if (g.type==='MultiPolygon') for (const p of g.coordinates) for (const r of p) pushRing(r);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  const mat  = new THREE.LineBasicMaterial({ color:0x777777, transparent:true, opacity:0.7 });
  const lines = new THREE.LineSegments(geom, mat);
  group.add(lines);
}

/* -------------------- IKONOK (SVG → 3D) -------------------- */
const iconMeshes = [];
const iconByKey  = {}; // NAME -> ikon mesh

for (const f of geo.features){
  const cid  = f.properties.cluster;
  const name = f.properties.NAME || `id_${Math.random().toString(36).slice(2)}`;
  const geom = iconGeomsFlat[cid];  // ország-nézetben a "flat" készlet megy
  if (!geom) continue;
  const mat  = new THREE.MeshStandardMaterial({ color: CLUSTER_COLORS[cid] || 0x888888 });
  const mesh = new THREE.Mesh(geom, mat);

  const [lon,lat] = lonLatOfFeature(f);
  const [X,Y,Z]   = toXY(lon, lat, 0);
  mesh.position.set(X,Y,Z);

  mesh.userData = {
    key: name,
    cluster: cid,
    label: `${name} · ${CLUSTER_LABELS[cid] ?? ('C'+cid)}`,
    s: 1.0,  // aktuális skála
    t: 1.0   // cél skála
  };
  mesh.scale.set(ICON_SCALE_XY, ICON_SCALE_XY, ICON_SCALE_Z);

  iconsGroup.add(mesh);
  iconMeshes.push(mesh);
  iconByKey[name] = mesh;
}
console.info('Ikonok száma:', iconMeshes.length);

async function loadIconGeoms(map){
  const loader = new SVGLoader();
  const out = {};
  for (const [cid, path] of Object.entries(map)){
    try{
      const svgData = await loader.loadAsync(path);
      const shapes = [];
      for (const p of svgData.paths) shapes.push(...SVGLoader.createShapes(p));
      let geom;
      if (shapes.length){
        const parts = shapes.map(s => new THREE.ExtrudeGeometry(s, { depth:0.12, bevelEnabled:false }));
        geom = mergeGeometries(parts, true); geom.center();
      }else{
        console.warn('SVG nem adott ki shape-et, fallback henger:', path);
        geom = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
      }
      out[cid] = geom;
    }catch(e){
      console.warn('SVG load hiba, fallback henger:', map[cid], e);
      out[cid] = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
    }
  }
  return out;
}

/* -------------------- LEGENDA + SZŰRŐ -------------------- */
const ACTIVE = new Set(Object.keys(CLUSTER_LABELS).map(Number)); // kezdetben mind aktív
buildLegend();
applyFilter();

function buildLegend(){
  const box = document.getElementById('legend');
  if (!box) return;

  box.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className = 'hdr';
  hdr.innerHTML = `Klaszterek 
    <button id="lg-all" type="button">Mind</button>
    <button id="lg-none" type="button">Semmi</button>`;
  box.appendChild(hdr);

  for(const [k,label] of Object.entries(CLUSTER_LABELS)){
    const cid = Number(k);
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `
      <input type="checkbox" class="lg-chk" data-cid="${cid}" checked>
      <span class="sw" style="background:${CLUSTER_COLORS[cid]};"></span>
      <span>${label}</span>`;
    box.appendChild(row);
  }

  box.addEventListener('change', e=>{
    if(!e.target.classList.contains('lg-chk')) return;
    const cid = Number(e.target.dataset.cid);
    if (e.target.checked) ACTIVE.add(cid); else ACTIVE.delete(cid);
    applyFilter();
  });
  box.querySelector('#lg-all') .onclick = ()=>{ 
    [...box.querySelectorAll('.lg-chk')].forEach(i=>i.checked=true);
    ACTIVE.clear(); Object.keys(CLUSTER_LABELS).forEach(k=>ACTIVE.add(Number(k)));
    applyFilter();
  };
  box.querySelector('#lg-none').onclick = ()=>{
    [...box.querySelectorAll('.lg-chk')].forEach(i=>i.checked=false);
    ACTIVE.clear(); applyFilter();
  };
}

function applyFilter(){
  iconsGroup.children.forEach(m => m.visible = ACTIVE.has(m.userData.cluster));
  fillsGroup.children.forEach(m => m.visible = ACTIVE.has(m.userData.cluster));
  if (activeKey !== null){
    const im = iconByKey[activeKey];
    if (!im || !im.visible){ activeKey=null; tooltip.style.display='none'; }
  }
}

/* -------------------- KAMERA SEGÉDEK -------------------- */
function computeNationView(obj, camera, offset=1.25){
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, Math.max(0.0001, size.z));
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const camZ = Math.abs(maxDim / (2 * Math.tan(fov/2))) * offset;

  return { center, camZ };
}

function tweenCamera(toPos, toTarget, ms=900, ease=(t)=>t*(2-t), onDone=()=>{}){
  const fromPos    = camera.position.clone();
  const fromTarget = controls.target.clone();
  const t0 = performance.now();

  function step(now){
    const t = Math.min(1, (now - t0) / ms);
    const k = ease(t);

    camera.position.lerpVectors(fromPos, toPos, k);
    controls.target.lerpVectors(fromTarget, toTarget, k);
    controls.update();

    if (t < 1) requestAnimationFrame(step);
    else onDone();
  }
  requestAnimationFrame(step);
}

function lockTilt(lock) {
  const phi = Math.PI / 2; // 90°
  if (lock) {
    controls.enableRotate = false;
    controls.minPolarAngle = phi;
    controls.maxPolarAngle = phi;
  } else {
    controls.enableRotate = true;
    controls.minPolarAngle = Math.PI * 0.38;
    controls.maxPolarAngle = Math.PI * 0.62;
  }
}

// --- IKON VÁLTÁS: ország-nézet ⇄ közeli ISO nézet ---
function setIconGeometry(name, mode='flat'){
  const m = iconByKey[name];
  if (!m) return;
  const cid = m.userData.cluster;
  if (mode === 'iso' && iconGeomsIso[cid])      m.geometry = iconGeomsIso[cid];
  else if (iconGeomsFlat[cid])                  m.geometry = iconGeomsFlat[cid];
  m.geometry.computeBoundingBox?.();
  m.geometry.computeBoundingSphere?.();
}
const showIso  = (name)=> setIconGeometry(name,'iso');
const showFlat = (name)=> setIconGeometry(name,'flat');

// Ország-nézet (mindig szemből)
function goNationView(immediate=false){
  if (!NATION) NATION = computeNationView(content, camera);
  const toPos    = new THREE.Vector3(NATION.center.x, NATION.center.y, NATION.camZ);
  const toTarget = NATION.center.clone();

  lockTilt(true);
  if (immediate){
    camera.position.copy(toPos);
    controls.target.copy(toTarget);
    controls.update();
  }else{
    tweenCamera(toPos, toTarget, 700, (t)=>t*(2-t), ()=>controls.update());
  }
}

// „Fly to” egy bounding box‑ra – kis dőléssel
function flyToBox(box, offset=1.10, duration=900){
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const camZ = Math.abs(maxDim / (2*Math.tan(fov/2))) * offset;
  const toPos = new THREE.Vector3(center.x, center.y - camZ, camZ); // enyhe döntés
  fly = {
    t:0, dur:duration,
    from: camera.position.clone(),
    to:   toPos,
    fromT: controls.target.clone(),
    toT:   center.clone()
  };
}

/* -------------------- HOVER + CLICK → PANEL -------------------- */
renderer.domElement.addEventListener('click', onClick);
function onClick(){
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(fillsGroup.children, true);
  if (!hits.length) return;
  const fill = hits[0].object;
  openPanel(fill.userData.key, fill);
}

/* -------------------- PANEL LOGIKA -------------------- */
const panel = document.getElementById('sidepanel');
function openPanel(name, fillObj){
  // ha volt korábbi lock, előbb állítsuk vissza
  if (detailLock && detailLock !== name) showFlat(detailLock);
  detailLock = name;

  showIso(name);     // ⇦ itt kapcsolunk ISO‑ra
  
  // kamera rázoom + enyhe döntés
  const box = new THREE.Box3().setFromObject(fillObj);
  lockTilt(false);
  flyToBox(box, 1.05, 900);

  // --- panel tartalom ---
  const im  = iconByKey[name];
  const cid = im?.userData?.cluster ?? null;

  panel.querySelector('.sp-title').textContent = name;
  const pill = panel.querySelector('.sp-pill');
  pill.textContent = cid!=null ? (CLUSTER_LABELS[cid] ?? `C${cid}`) : '–';
  pill.style.background = cid!=null ? (CLUSTER_COLORS[cid] ?? '#eee') : '#eee';

  const meta = META.get(name);
  const sval = panel.querySelector('.sval');
  const barf = panel.querySelector('.bar .fill');
  if (meta?.s!=null && isFinite(meta.s)){
    const s = +meta.s;
    sval.textContent = s.toFixed(3);
    barf.style.width = ((s + 1) / 2 * 100).toFixed(1) + '%';
  } else {
    sval.textContent = '–';
    barf.style.width = '0%';
  }

  const UL = panel.querySelector('.feat-list');
  UL.innerHTML = '';
  (meta?.tops?.slice(0,3) ?? []).forEach(t=>{
    const li = document.createElement('li');
    li.textContent = prettifyFeature(t);
    UL.appendChild(li);
  });
  if (!UL.children.length){
    const li = document.createElement('li'); li.textContent = '–'; UL.appendChild(li);
  }

  // --- döntésfa PNG (V1) ---
  const img = panel.querySelector('#sp-tree-img');
  if (img){
    if (cid!=null){
      // FIGYELEM: fájlnév: dtree_cluster{cid}_FULL.png (nincs 's' a végén!)
      img.src = fromHere(`dtree_cluster${cid}_FULL.png`);
      img.alt = `Klaszter ${cid} döntésfa`;
      img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; };
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }

  panel.classList.add('open');
}

function closePanel(){
  if (!panel.classList.contains('open')) return;
  if (detailLock) showFlat(detailLock);   // ⇦ vissza FLAT‑re
  panel.classList.remove('open');
  detailLock = null;
  goNationView(false);
}

// Esc-re is zárjuk, ez már nálad bent volt:
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closePanel(); });

/* -------------------- ALIAS + CSV BETÖLTŐK -------------------- */
function prettifyFeature(s){
  if (!s) return '–';
  const k = s.trim();
  const alias = ALIAS?.[k];
  if (alias) return alias;
  return k.replace(/_/g,' ').replace(/\s+/g,' ').trim();
}

async function loadAlias(path){
  try {
    const res = await fetch(path);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function loadMeta(path){
  try{
    const txt = await (await fetch(path)).text();
    return parseCSVToMap(txt);
  }catch{
    return new Map();
  }
}
function parseCSVToMap(text){
  const firstLine = text.split(/\r?\n/).find(l=>l.trim().length>0) || '';
  const cand = [',',';','\t','|'];
  let d = ',', best = 0;
  for (const c of cand){ const n = firstLine.split(c).length; if (n>best){best=n; d=c;} }
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return new Map();

  const header = lines.shift().split(d).map(x=>x.trim().replace(/^"|"$/g,''));
  const idx = (regexes) => header.findIndex(h=> regexes.some(rx => rx.test(h.toLowerCase())));
  const nameIdx = idx([/name/,/járás/,/jaras/,/district/]); 
  const silIdx  = idx([/sil/,/s_local/,/silhouette/,/^\s*s\s*$/]);

  const topCols = header.map((h,i)=>({h,i}))
                        .filter(o=>/^top\d+/i.test(o.h)||/top.*feat/.test(o.h.toLowerCase()))
                        .map(o=>o.i);
  const topStrIdx = idx([/top.*features?/]);

  const map = new Map();
  for(const line of lines){
    const cells = line.split(d).map(c=>c.trim().replace(/^"|"$/g,''));
    const name = cells[(nameIdx>=0?nameIdx:0)] || '';
    if(!name) continue;

    let s = null;
    if (silIdx>=0){
      const v = cells[silIdx]?.replace(',','.');
      const num = parseFloat(v);
      if (isFinite(num)) s = num;
    }
    let tops = [];
    if (topStrIdx>=0 && cells[topStrIdx]){
      tops = cells[topStrIdx].split(/[;|,]/).map(x=>x.trim()).filter(Boolean).slice(0,3);
    } else if (topCols.length){
      tops = topCols.map(i=>cells[i]).filter(Boolean).slice(0,3);
    }
    map.set(name, {s, tops});
  }
  return map;
}

/* -------------------- LOOP -------------------- */
function easeInOutQuad(t){ return t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
let last = performance.now();

function animate(){
  const now = performance.now();
  const dt  = now - last; last = now;

  controls.update();

  // kamera "fly" interpoláció
  if (fly){
    fly.t += dt;
    const a = Math.min(1, fly.t / fly.dur);
    const k = easeInOutQuad(a);
    camera.position.lerpVectors(fly.from, fly.to, k);
    const target = new THREE.Vector3().lerpVectors(fly.fromT, fly.toT, k);
    controls.target.copy(target); controls.update();
    if (a>=1) fly = null;
  }
// csere zoom-küszöbre
if (detailLock){
  const d = camera.position.distanceTo(controls.target);
  if (d < 9) showIso(detailLock);
  else       showFlat(detailLock);
}

  // hover csak akkor, ha nincs panel lock
  const hoverEnabled = !detailLock;

  // 1) Raycast a járás-kitetöltésekre
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(fillsGroup.children, true);

  if (hoverEnabled && hits.length){
    const fill = hits[0].object;
    activeKey = fill.userData.key;
    renderer.domElement.style.cursor = 'pointer';

    fillsGroup.children.forEach(m=>{
      const isActive = m.userData.key === activeKey;
      m.material.opacity = isActive ? 0.45 : m.userData.baseOpacity;
    });

    const im = iconByKey[activeKey];
    tooltip.style.display='block';
    tooltip.style.left = (pointerX+12)+'px';
    tooltip.style.top  = (pointerY+12)+'px';
    tooltip.textContent = im ? im.userData.label : (fill.userData.key ?? '—');
  }else{
    if (!detailLock){
      activeKey = null;
      renderer.domElement.style.cursor = 'default';
      fillsGroup.children.forEach(m=> m.material.opacity = m.userData.baseOpacity);
      tooltip.style.display='none';
    }
  }

  // 2) ikon skálázás simítva
  iconMeshes.forEach(m=>{
    const key = m.userData.key;
    const shouldGrow = detailLock ? (key===detailLock) : (key===activeKey);
    m.userData.t = shouldGrow ? 1.35 : 1.0;
    m.userData.s = THREE.MathUtils.lerp(m.userData.s, m.userData.t, 0.12);
    const s = m.userData.s;
    m.scale.set(ICON_SCALE_XY*s, ICON_SCALE_XY*s, ICON_SCALE_Z*s);
  });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// csak MOST számoljuk ki az ország‑nézetet (már vannak objektumok a content‑ben)
NATION = computeNationView(content, camera);
goNationView(true);
