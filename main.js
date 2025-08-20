// ====== THREE.js modulok (egységes gyökér, nincs duplikáció) ======
import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';

// Helyi segédfájl
import { CLUSTER_COLORS, ICON_FILES, CLUSTER_LABELS } from './colors.js';

/* --- Lightbox globális állapota: IDE HOZZUK FEL, hogy a TDZ hibát elkerüljük --- */
let ZL = null;

// =====================
// Beállítások
// =====================
const SPRITE_PX  = 36;
const FIT_OFFSET = 1.01;

// Klaszter-színezés stílusok / opacitások
const OP_WEAK   = 0.28;     // halvány kitöltés (alap)
const OP_STRONG = 0.75;     // erős kitöltés
let   FILL_OPACITY_BASE = OP_WEAK;

// 'icons' | 'solid' | 'outline'
let MAP_STYLE = 'icons';

// Kiemelés opacitása mindig erősebb a bázisnál
function getHighlightOpacity(){ return Math.min(1, FILL_OPACITY_BASE + 0.25); }

// =====================
// Elérési utak
// =====================
const fromHere = (p) => new URL(p, import.meta.url).href;

const GEO_PATH   = fromHere('clusters_k5.geojson');
const SIL_PATH   = fromHere('silhouette_local.csv');
const ALIAS_PATH = fromHere('alias_map.json');

const ICONS_ABS = Object.fromEntries(
  Object.entries(ICON_FILES).map(([k,p]) => [k, fromHere(p)])
);

// =====================
// „Vetítés” – lon/lat → XY (egyszerű affin)
// =====================
const OX = 19.5, OY = 47.0, SX = 6.5, SY = 9.5;
function toXY(lon, lat, z=0){ return [ (lon-OX)*SX, (lat-OY)*SY, z ]; }

function lonLatOfFeature(f){
  const p = f.properties || {};
  if (p.cx!=null && p.cy!=null) return [p.cx, p.cy];
  const g = f.geometry; let ring = null;
  if (g?.type === 'Polygon') ring = g.coordinates[0];
  else if (g?.type === 'MultiPolygon') ring = g.coordinates[0]?.[0];
  if (ring && ring.length){
    let sx=0, sy=0; for(const [x,y] of ring){ sx+=x; sy+=y; }
    return [sx/ring.length, sy/ring.length];
  }
  return [OX, OY];
}

// =====================
// SCENE
// =====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 5000);
camera.position.set(0, -6, 4);

const renderer = new THREE.WebGLRenderer({ antialias:true, stencil:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const MAX_ANISO = renderer.capabilities.getMaxAnisotropy?.() ?? 4;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = true;

// fények (ikonokhoz nem feltétlen kell, de a jelenet egységes)
scene.add(new THREE.AmbientLight(0xffffff, 1));
const dir = new THREE.DirectionalLight(0xffffff, 0.7);
dir.position.set(2, -2, 3);
scene.add(dir);

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (!detailLock) { NATION = computeNationView(content, camera, FIT_OFFSET); goNationView(true); }
});

// =====================
// UI + stílusok
// =====================
ensureUI();
ensureZoomLightboxUI();   // döntésfa nagyító overlay

function ensureUI(){
  // Tooltip
  if(!document.getElementById('tooltip')){
    const t = document.createElement('div');
    t.id = 'tooltip';
    Object.assign(t.style,{
      position:'fixed',display:'none',pointerEvents:'none',
      background:'rgba(0,0,0,.8)',color:'#fff',padding:'.35rem .5rem',
      font:'13px/1.35 system-ui,Segoe UI,Inter,Arial',borderRadius:.4+'rem',zIndex:1001
    });
    document.body.appendChild(t);
  }
  // Legend
  if(!document.getElementById('legend')){
    const d = document.createElement('div'); d.id='legend'; document.body.appendChild(d);
  }
  // Sidepanel
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
  // Stílus
  if(!document.getElementById('legend-style')){
    const st = document.createElement('style'); st.id='legend-style'; st.textContent = `
      #legend{position:fixed;left:12px;top:12px;z-index:1000;background:rgba(255,255,255,.92);
        padding:.55rem .6rem;border-radius:.5rem;box-shadow:0 2px 10px rgba(0,0,0,.15);
        font:13px/1.35 system-ui,Segoe UI,Inter,Arial;max-width:260px}
      #legend .row{display:flex;align-items:center;gap:.45rem;margin:.25rem 0;}
      #legend .sw{width:12px;height:12px;border:1px solid rgba(0,0,0,.25);}
      #legend .hdr{font-weight:600;margin:.35rem 0 .25rem}
      #legend button{margin-left:.35rem;font-size:12px}
      #legend .style-row{display:flex;flex-wrap:wrap;gap:.55rem;align-items:center;
        border-bottom:1px solid rgba(0,0,0,.1);padding-bottom:.35rem;margin-bottom:.35rem}
      #legend .style-row .hdr2{font-weight:600;margin-right:.2rem}
      #legend .style-row label{display:flex;align-items:center;gap:.25rem;cursor:pointer}

      #sidepanel{position:fixed;right:14px;top:14px;z-index:1000;width:360px;max-width:42vw;
        background:rgba(255,255,255,.96);border-radius:.75rem;box-shadow:0 12px 30px rgba(0,0,0,.2);
        transform:translateX(18px);opacity:0;pointer-events:none;transition:all .25s ease;}
      #sidepanel.open{transform:translateX(0);opacity:1;pointer-events:auto;}
      #sidepanel .sp-hdr{display:grid;grid-template-columns:1fr auto auto;gap:.4rem;align-items:center;
        padding:.7rem .8rem .3rem .9rem;}
      #sidepanel .sp-title{font:600 16px/1.2 system-ui,Segoe UI,Inter,Arial;}
      #sidepanel .sp-pill{justify-self:start;font:12px/1.1 system-ui;padding:.1rem .45rem;border-radius:.5rem;
        color:#222;background:#eee;border:1px solid rgba(0,0,0,.15);}
      #sidepanel .sp-body{padding:.2rem .9rem .9rem .9rem}
      #sidepanel .sp-metric .k{font-weight:600;margin:.35rem 0 .15rem}
      #sidepanel .bar{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin-top:.3rem}
      #sidepanel .bar .fill{height:100%;width:0;background:#70b;}
      #sidepanel .feat-list{margin:.25rem 0 0 .9rem;padding:0}
      #sidepanel .feat-list li{margin:.15rem 0}
      #sidepanel .sp-tree img{width:100%;display:block;margin:.65rem 0 .25rem;border-radius:.4rem;border:1px solid rgba(0,0,0,.1);cursor:zoom-in}
      #sidepanel .sp-actions{display:flex;justify-content:flex-end;margin-top:.6rem}
      #sidepanel .sp-actions .sp-back{border:1px solid rgba(0,0,0,.2);background:#fff;border-radius:.5rem;
        padding:.35rem .6rem;cursor:pointer}
    `; document.head.appendChild(st);
  }
}

// =====================
// INPUT
// =====================
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerX=0, pointerY=0;
window.addEventListener('pointermove', e=>{
  pointerX=e.clientX; pointerY=e.clientY;
  mouse.x  = (e.clientX/innerWidth)*2-1;
  mouse.y  =-(e.clientY/innerHeight)*2+1;
});

// =====================
// ÁLLAPOT
// =====================
let activeKey = null, detailLock = null, fly = null, NATION = null;

// Szűrő aktív halmaza (kezdetben mind)
const ACTIVE = new Set(Object.keys(CLUSTER_LABELS).map(Number));

// Tárolók
let GEO = null, META = new Map(), ALIAS = {};
const iconByKey = {};
const iconNodes = [];

// Csoportok
const content    = new THREE.Group(); scene.add(content);
const fillsGroup = new THREE.Group(); fillsGroup.renderOrder = -2; content.add(fillsGroup);
const bordersGrp = new THREE.Group(); bordersGrp.renderOrder = -1; content.add(bordersGrp);
const iconsGroup = new THREE.Group(); content.add(iconsGroup);

// Kontúr referenciája (stílusváltáshoz)
let BORDERS_LINE = null;

// --- Stencil maszk (lokális a node-hoz)
let ST_REF = 0;                       // 1..255 ciklizálás
const MASK_Z = 0.0005;                // maszk nagyon kicsit a sík fölé
let ORDER = 0;                        // stabil renderOrder: maszk -> 2D

function makeMaskGeometry(feature, cx, cy){
  const ringsets = [];
  const g = feature.geometry;
  if (!g) return new THREE.PlaneGeometry(0,0);
  if (g.type==='Polygon')           ringsets.push(g.coordinates);
  else if (g.type==='MultiPolygon') ringsets.push(...g.coordinates);

  const geoms = [];
  for (const rings of ringsets){
    if (!rings?.length) continue;

    const outer = rings[0].map(([x,y])=>{
      const [X,Y] = toXY(x,y);
      return new THREE.Vector2(X - cx, Y - cy);   // lokális!
    });
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();

    const shape = new THREE.Shape(outer);
    for (let i=1; i<rings.length; i++){
      const hole = rings[i].map(([x,y])=>{
        const [X,Y] = toXY(x,y);
        return new THREE.Vector2(X - cx, Y - cy); // lokális!
      });
      if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
      shape.holes.push(new THREE.Path(hole));
    }

    const sg = new THREE.ShapeGeometry(shape);
    sg.translate(0,0,MASK_Z);  // csak Z-ben
    geoms.push(sg);
  }
  if (!geoms.length) return new THREE.PlaneGeometry(0,0);
  if (geoms.length===1) return geoms[0];

  // minimál saját merge (nem kell BufferGeometryUtils)
  const mg = new THREE.BufferGeometry();
  const arr = []; let idxOff = 0;
  for (const g2 of geoms){
    const pos = g2.attributes.position.array;
    const idx = g2.index ? g2.index.array : null;
    if (idx){
      for (let i=0;i<idx.length;i++) arr.push(idx[i]+idxOff);
    }else{
      for (let i=0;i<pos.length/3;i++) arr.push(i+idxOff);
    }
    idxOff += pos.length/3;
  }
  const posAll = new Float32Array(idxOff*3);
  let off = 0;
  for (const g2 of geoms){
    posAll.set(g2.attributes.position.array, off);
    off += g2.attributes.position.array.length;
  }
  mg.setAttribute('position', new THREE.BufferAttribute(posAll,3));
  mg.setIndex(arr);
  return mg;
}

// =====================
// INIT
// =====================
async function init(){
  const [geo, meta, alias, flatTextures] = await Promise.all([
    (await fetch(GEO_PATH)).json(),
    loadMeta(SIL_PATH).catch(()=>new Map()),
    loadAlias(ALIAS_PATH).catch(()=> ({})),
    loadIconTextures(ICONS_ABS, MAX_ANISO),
  ]);

  GEO = geo; META = meta; ALIAS = alias;

  drawFills(GEO, fillsGroup);
  drawBorders(GEO, bordersGrp);

  // Ikonok (2D, stencil-maszkkal)
  for (const f of GEO.features){
    const cid  = f.properties.cluster;
    const name = f.properties.NAME || `id_${Math.random().toString(36).slice(2)}`;

    const node = new THREE.Object3D();
    const [lon,lat] = lonLatOfFeature(f);
    const [X,Y,Z]   = toXY(lon, lat, 0);
    node.position.set(X,Y,Z);

    const stRef = (ST_REF % 255) + 1; ST_REF++;

    // maszk (lokális)
    const maskGeom = makeMaskGeometry(f, X, Y);
    const maskMat  = new THREE.MeshBasicMaterial({ color:0x000000 });
    maskMat.colorWrite   = false;
    maskMat.transparent  = false;
    maskMat.opacity      = 1.0;
    maskMat.depthWrite   = false;
    maskMat.depthTest    = false;                 // biztosan írjon a stencilbe
    maskMat.stencilWrite = true;
    maskMat.stencilRef   = stRef;
    maskMat.stencilFunc  = THREE.AlwaysStencilFunc;
    maskMat.stencilZPass = THREE.ReplaceStencilOp;

    const maskMesh = new THREE.Mesh(maskGeom, maskMat);
    const baseOrder = 1000 + ORDER * 2; ORDER++;
    maskMesh.renderOrder = baseOrder;
    node.add(maskMesh);

    // bbox
    maskGeom.computeBoundingBox();
    const mb = maskGeom.boundingBox;
    const maskW = (mb.max.x - mb.min.x);
    const maskH = (mb.max.y - mb.min.y);

    // 2D ikon mint textúrázott sík (stencil maszkban kivágva)
    const tex = flatTextures[cid];
    const asp = (tex?.image?.width && tex?.image?.height) ? (tex.image.width/tex.image.height) : 1;

    const pmaterial = new THREE.MeshBasicMaterial({ map: tex, transparent:true, depthWrite:false });
    pmaterial.depthTest    = false;            // renderOrder döntsön
    pmaterial.stencilWrite = true;
    pmaterial.stencilRef   = stRef;
    pmaterial.stencilFunc  = THREE.EqualStencilFunc;
    pmaterial.stencilZPass = THREE.KeepStencilOp;

    const pad = 0.88;
    let pw = maskW*pad, ph = maskH*pad;
    if (pw/ph > asp) { ph = maskH*pad; pw = ph*asp; } else { pw = maskW*pad; ph = pw/asp; }

    const pgeom = new THREE.PlaneGeometry(pw, ph);
    const pmesh = new THREE.Mesh(pgeom, pmaterial);
    pmesh.position.z  = 0.0008;                 // maszk fölé hajszálnyival
    pmesh.renderOrder = baseOrder + 1;
    node.add(pmesh);

    // meta
    node.userData = {
      key: name,
      cluster: cid,
      label: `${name} · ${CLUSTER_LABELS[cid] ?? ('C'+cid)}`,
      s: 1, t: 1,
      sprite: pmesh,
      asp, maskW, maskH
    };

    iconsGroup.add(node);
    iconByKey[name] = node;
    iconNodes.push(node);
  }

  buildLegend();
  applyFilter();           // szűrő + kezdeti stílus
  setMapStyle('icons');    // induljunk ikon + halvány szín módban

  // teljes képernyős illesztés
  NATION = computeNationView(content, camera, FIT_OFFSET);
  goNationView(true);

  requestAnimationFrame(animate);
}
init().catch(console.error);

// =====================
// POLIGONOK
// =====================
function drawFills(geojson, group){
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
      geom.translate(0,0,-0.03);
      const mat  = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:FILL_OPACITY_BASE, depthWrite:false });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { key:name, cluster:cid, baseOpacity:FILL_OPACITY_BASE, baseColor: color.clone() };
      group.add(mesh);
    }
  }
}

// =====================
// HATÁROK
// =====================
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
  BORDERS_LINE = new THREE.LineSegments(geom, mat);    // <- referenciát eltároljuk
  group.add(BORDERS_LINE);
}

// =====================
// FLAT (2D) – SVG mint textúra
// =====================
async function loadIconTextures(map, maxAniso){
  const loader = new THREE.TextureLoader();
  const out = {};
  for (const [cid, path] of Object.entries(map)){
    try{
      const tex = await loader.loadAsync(path);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.max(1, maxAniso || 4);
      out[cid] = tex;
    }catch(e){
      console.warn('Flat SVG texture hiba:', path, e);
      const c = document.createElement('canvas'); c.width=c.height=32;
      const g = c.getContext('2d'); g.fillStyle='#ccc'; g.fillRect(0,0,32,32);
      out[cid] = new THREE.CanvasTexture(c);
    }
  }
  return out;
}

// =====================
// LEGENDA + SZŰRŐ + STÍLUSVÁLTÓ
// =====================
function buildLegend(){
  const box = document.getElementById('legend'); if (!box) return;
  box.innerHTML = '';

  // Stílus választó
  const styleRow = document.createElement('div');
  styleRow.className = 'style-row';
  styleRow.innerHTML = `
    <span class="hdr2">Stílus:</span>
    <label><input type="radio" name="mapstyle" value="icons"  checked> Ikon + halvány szín</label>
    <label><input type="radio" name="mapstyle" value="solid"> Erős klaszter‑színek</label>
    <label><input type="radio" name="mapstyle" value="outline"> Csak kontúr</label>
  `;
  box.appendChild(styleRow);

  // Klaszter szűrő
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

  // Események
  box.addEventListener('change', e=>{
    const t = e.target;
    if (t.classList?.contains('lg-chk')){
      const cid = Number(t.dataset.cid);
      if (t.checked) ACTIVE.add(cid); else ACTIVE.delete(cid);
      applyFilter();
    } else if (t.name === 'mapstyle'){
      setMapStyle(t.value);
    }
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

function setMapStyle(s){
  MAP_STYLE = s;

  if (s === 'icons'){                 // ikon + halvány szín
    FILL_OPACITY_BASE = OP_WEAK;
    iconsGroup.visible = true;
    if (BORDERS_LINE) BORDERS_LINE.material.opacity = 0.70;
    iconsGroup.children.forEach(n=>{
      const mat = n.userData?.sprite?.material;
      if (mat){ mat.opacity = 1.0; mat.transparent = true; }
    });

  } else if (s === 'solid'){          // erős klaszter-színek + ikonok 90%
    FILL_OPACITY_BASE = OP_STRONG;
    iconsGroup.visible = true;
    if (BORDERS_LINE) BORDERS_LINE.material.opacity = 0.60;
    iconsGroup.children.forEach(n=>{
      const mat = n.userData?.sprite?.material;
      if (mat){ mat.opacity = 0.90; mat.transparent = true; }
    });

  } else {                            // 'outline' – ikonok ki, csak kontúr
    FILL_OPACITY_BASE = 0.0;
    iconsGroup.visible = false;
    if (BORDERS_LINE) BORDERS_LINE.material.opacity = 0.90;
  }

  syncStyleToScene();
}

function syncStyleToScene(){
  // Bázis opacitás frissítése
  fillsGroup.children.forEach(m=>{
    m.userData.baseOpacity = FILL_OPACITY_BASE;
    m.material.opacity     = FILL_OPACITY_BASE;
  });

  // Ha van aktív (hover/lock), kapjon kiemelést
  const key = detailLock || activeKey;
  if (key){
    fillsGroup.children.forEach(m=>{
      const on = (m.userData.key === key);
      m.material.opacity = on ? getHighlightOpacity() : FILL_OPACITY_BASE;
    });
  }
}

function applyFilter(){
  // ikonok csak akkor látszanak, ha az adott klaszter aktív és a group is látható
  iconsGroup.children.forEach(n => n.visible = iconsGroup.visible && ACTIVE.has(n.userData.cluster));
  fillsGroup.children.forEach(m => m.visible = ACTIVE.has(m.userData.cluster));

  if (activeKey !== null){
    const n = iconByKey[activeKey];
    if (!n || !n.visible){ activeKey=null; tooltip.style.display='none'; }
  }
  syncStyleToScene();
}

// =====================
// KAMERA / FIT
// =====================
function computeNationView(obj, camera, offset=FIT_OFFSET){
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
    if (t < 1) requestAnimationFrame(step); else onDone();
  }
  requestAnimationFrame(step);
}
function lockTilt(lock) {
  const phi = Math.PI / 2;
  if (lock) { controls.enableRotate = false; controls.minPolarAngle = phi; controls.maxPolarAngle = phi; }
  else { controls.enableRotate = true; controls.minPolarAngle = Math.PI * 0.38; controls.maxPolarAngle = Math.PI * 0.62; }
}
function goNationView(immediate=false){
  if (!NATION) NATION = computeNationView(content, camera, FIT_OFFSET);
  const toPos    = new THREE.Vector3(NATION.center.x, NATION.center.y, NATION.camZ);
  const toTarget = NATION.center.clone();
  lockTilt(true);
  if (immediate){ camera.position.copy(toPos); controls.target.copy(toTarget); controls.update(); }
  else { tweenCamera(toPos, toTarget, 700, (t)=>t*(2-t), ()=>controls.update()); }
}
function flyToBox(box, offset=1.10, duration=900){
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const maxDim = Math.max(size.x, size.y, size.z);
  const camZ = Math.abs(maxDim / (2*Math.tan(fov/2))) * offset;
  const toPos = new THREE.Vector3(center.x, center.y - camZ, camZ);
  fly = { t:0, dur:duration, from: camera.position.clone(), to: toPos, fromT: controls.target.clone(), toT: center.clone() };
}

// =====================
// INTERAKCIÓ
// =====================
renderer.domElement.addEventListener('click', onClick);
function onClick(){
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(fillsGroup.children, true);
  if (!hits.length) return;
  const fill = hits[0].object;
  openPanel(fill.userData.key, fill);
}

const panel = document.getElementById('sidepanel');
function openPanel(name, fillObj){
  detailLock = name;
  activeKey = null;
  tooltip.style.display = 'none';
  renderer.domElement.style.cursor = 'default';

  fillsGroup.children.forEach(m=>{
    m.material.opacity = (m.userData.key === name) ? getHighlightOpacity() : m.userData.baseOpacity;
  });

  const box = new THREE.Box3().setFromObject(fillObj);
  lockTilt(false); flyToBox(box, 1.05, 900);

  const n  = iconByKey[name];
  const cid = n?.userData?.cluster ?? null;

  panel.querySelector('.sp-title').textContent = name;
  const pill = panel.querySelector('.sp-pill');
  pill.textContent = cid!=null ? (CLUSTER_LABELS[cid] ?? `C${cid}`) : '–';
  pill.style.background = cid!=null ? (CLUSTER_COLORS[cid] ?? '#eee') : '#eee';

  const meta = META.get(name);
  const sval = panel.querySelector('.sval');
  const barf = panel.querySelector('.bar .fill');
  if (meta?.s!=null && isFinite(meta.s)){
    const s = +meta.s; sval.textContent = s.toFixed(3);
    barf.style.width = ((s + 1) / 2 * 100).toFixed(1) + '%';
  } else { sval.textContent = '–'; barf.style.width = '0%'; }

  const UL = panel.querySelector('.feat-list'); UL.innerHTML = '';
  (meta?.tops?.slice(0,3) ?? []).forEach(t=>{
    const li = document.createElement('li'); li.textContent = prettifyFeature(t); UL.appendChild(li);
  });
  if (!UL.children.length){ const li = document.createElement('li'); li.textContent = '–'; UL.appendChild(li); }

  const img = panel.querySelector('#sp-tree-img');
  if (img){
    if (cid!=null){
      const src = fromHere(`dtree_cluster${cid}_FULL.png`);
      img.src = src;
      img.alt = `Klaszter ${cid} döntésfa`;
      img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; };
      // Lightbox megnyitás
      img.onclick = ()=> openZoomLightbox(src, `${name} – Klaszter ${cid} döntésfa`);
    } else { img.removeAttribute('src'); img.style.display = 'none'; img.onclick = null; }
  }
  panel.classList.add('open');
}
function closePanel(){
  if (!panel.classList.contains('open')) return;
  tooltip.style.display = 'none';
  activeKey = null;
  renderer.domElement.style.cursor = 'default';
  panel.classList.remove('open');
  detailLock = null;
  goNationView(false);
}
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closePanel(); });

// =====================
// ALIAS + CSV
// =====================
function prettifyFeature(s){
  if (!s) return '–';
  const k = s.trim(); const alias = ALIAS?.[k];
  if (alias) return alias;
  return k.replace(/_/g,' ').replace(/\s+/g,' ').trim();
}
async function loadAlias(path){ try { const r=await fetch(path); if(!r.ok) return {}; return await r.json(); } catch{ return {}; } }
async function loadMeta(path){ try{ const t=await (await fetch(path)).text(); return parseCSVToMap(t); } catch{ return new Map(); } }
function parseCSVToMap(text){
  const firstLine = text.split(/\r?\n/).find(l=>l.trim().length>0) || '';
  const cand = [',',';','\t','|']; let d = ',', best = 0;
  for (const c of cand){ const n = firstLine.split(c).length; if (n>best){best=n; d=c;} }
  const lines = text.trim().split(/\r?\n/).filter(Boolean); if (!lines.length) return new Map();
  const header = lines.shift().split(d).map(x=>x.trim().replace(/^"|"$/g,''));
  const idx = (rxs) => header.findIndex(h=> rxs.some(rx => rx.test(h.toLowerCase())));
  const nameIdx = idx([/name/,/járás/,/jaras/,/district/]); 
  const silIdx  = idx([/sil/,/s_local/,/silhouette/,/^\s*s\s*$/]);
  const topCols = header.map((h,i)=>({h,i})).filter(o=>/^top\d+/i.test(o.h)||/top.*feat/.test(o.h.toLowerCase())).map(o=>o.i);
  const topStrIdx = idx([/top.*features?/]);
  const map = new Map();
  for(const line of lines){
    const cells = line.split(d).map(c=>c.trim().replace(/^"|"$/g,''));
    const name = cells[(nameIdx>=0?nameIdx:0)] || ''; if(!name) continue;
    let s = null;
    if (silIdx>=0){ const v = cells[silIdx]?.replace(',','.'); const num = parseFloat(v); if (isFinite(num)) s = num; }
    let tops = [];
    if (topStrIdx>=0 && cells[topStrIdx]) tops = cells[topStrIdx].split(/[;|,]/).map(x=>x.trim()).filter(Boolean).slice(0,3);
    else if (topCols.length) tops = topCols.map(i=>cells[i]).filter(Boolean).slice(0,3);
    map.set(name, {s, tops});
  }
  return map;
}

// =====================
// LIGHTBOX – döntésfa nagyító (zoom + pan)
// =====================

function ensureZoomLightboxUI(){
  if (document.getElementById('zl-wrap')) return;

  const st = document.createElement('style');
  st.textContent = `
    #zl-wrap{position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:2000;display:none}
    #zl-ui{position:absolute;left:12px;top:10px;display:flex;gap:.4rem;align-items:center;
      background:rgba(0,0,0,.45);color:#fff;padding:.35rem .5rem;border-radius:.5rem;
      font:13px/1.3 system-ui,Segoe UI,Inter,Arial}
    #zl-ui .ttl{font-weight:600;margin-right:.35rem}
    #zl-ui button{cursor:pointer;border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;
      border-radius:.4rem;padding:.2rem .45rem}
    #zl-canvas{position:absolute;inset:0;overflow:hidden}
    #zl-img{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;image-rendering:auto;user-select:none}
    #zl-hint{position:absolute;left:50%;top:8px;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.45);
      font:12px/1.3 system-ui;padding:.25rem .5rem;border-radius:.5rem}
    #zl-close{position:absolute;right:10px;top:10px;background:rgba(0,0,0,.5);color:#fff;border:1px solid rgba(255,255,255,.6);
      padding:.2rem .5rem;border-radius:.4rem;cursor:pointer}
  `;
  document.head.appendChild(st);

  const wrap = document.createElement('div'); wrap.id='zl-wrap';
  wrap.innerHTML = `
    <div id="zl-ui">
      <span class="ttl">Döntésfa</span>
      <button id="zl-minus">−</button>
      <button id="zl-plus">+</button>
      <button id="zl-reset">Reset</button>
    </div>
    <div id="zl-hint">Görgess a nagyításhoz, húzd az ábrát az eltoláshoz.</div>
    <button id="zl-close" title="Bezár">✕</button>
    <div id="zl-canvas">
      <img id="zl-img" alt="">
    </div>`;
  document.body.appendChild(wrap);

  const img = wrap.querySelector('#zl-img');

  ZL = {
    wrap,
    img,
    scale:1,
    x:0, y:0,
    dragging:false,
    lastX:0, lastY:0,
    naturalW:0, naturalH:0
  };

  const layoutFit = ()=>{
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const iw = ZL.naturalW || img.naturalWidth || 1;
    const ih = ZL.naturalH || img.naturalHeight || 1;
    const s = Math.min(W/iw, H/ih);
    ZL.scale = s;
    ZL.x = (W - iw*s)/2;
    ZL.y = (H - ih*s)/2;
    applyTransform();
  };

  function applyTransform(){
    img.style.transform = `translate(${ZL.x}px, ${ZL.y}px) scale(${ZL.scale})`;
  }
  function zoomAt(px, py, k){
    const old = ZL.scale;
    const ns  = Math.min(20, Math.max(0.2, old * k));
    if (ns===old) return;
    // Top-left origin — tartsuk helyben a kurzor alatti pontot
    const ox = px - ZL.x;
    const oy = py - ZL.y;
    ZL.x = px - ox * (ns/old);
    ZL.y = py - oy * (ns/old);
    ZL.scale = ns;
    applyTransform();
  }
  function startDrag(e){ ZL.dragging=true; ZL.lastX=e.clientX; ZL.lastY=e.clientY; }
  function moveDrag(e){
    if (!ZL.dragging) return;
    ZL.x += (e.clientX - ZL.lastX);
    ZL.y += (e.clientY - ZL.lastY);
    ZL.lastX = e.clientX; ZL.lastY = e.clientY;
    applyTransform();
  }
  function endDrag(){ ZL.dragging=false; }

  // Események
  wrap.addEventListener('wheel', (e)=>{ e.preventDefault(); const k = e.deltaY<0 ? 1.12 : 0.89; zoomAt(e.clientX, e.clientY, k); }, {passive:false});
  img.addEventListener('pointerdown', startDrag);
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);

  wrap.querySelector('#zl-minus').onclick = ()=> zoomAt(innerWidth/2, innerHeight/2, 0.88);
  wrap.querySelector('#zl-plus').onclick  = ()=> zoomAt(innerWidth/2, innerHeight/2, 1.12);
  wrap.querySelector('#zl-reset').onclick = layoutFit;
  wrap.querySelector('#zl-close').onclick = closeZoomLightbox;

  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && wrap.style.display!=='none') closeZoomLightbox(); });

  img.addEventListener('load', ()=>{
    ZL.naturalW = img.naturalWidth;
    ZL.naturalH = img.naturalHeight;
    layoutFit();
  });

  window.addEventListener('resize', ()=>{
    if (wrap.style.display!=='none') layoutFit();
  });
}

function openZoomLightbox(src, title='Döntésfa'){
  if (!ZL) ensureZoomLightboxUI();
  document.querySelector('#zl-ui .ttl').textContent = title;
  ZL.wrap.style.display = 'block';
  ZL.img.src = src;
}
function closeZoomLightbox(){
  if (!ZL) return;
  ZL.wrap.style.display = 'none';
}

// =====================
// LOOP
// =====================
function easeInOutQuad(t){ return t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
let last = performance.now();

function animate(){
  const now = performance.now(), dt = now - last; last = now;
  controls.update();

  if (fly){
    fly.t += dt;
    const a = Math.min(1, fly.t / fly.dur);
    const k = easeInOutQuad(a);
    camera.position.lerpVectors(fly.from, fly.to, k);
    const target = new THREE.Vector3().lerpVectors(fly.fromT, fly.toT, k);
    controls.target.copy(target); controls.update();
    if (a>=1) fly = null;
  }

  // Hover / kiemelés
  const hoverEnabled = !detailLock;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(fillsGroup.children, true);

  if (hoverEnabled && hits.length){
    const fill = hits[0].object;
    activeKey = fill.userData.key;
    renderer.domElement.style.cursor = 'pointer';

    fillsGroup.children.forEach(m=>{
      const isActive = m.userData.key === activeKey;
      m.material.opacity = isActive ? getHighlightOpacity() : m.userData.baseOpacity;
    });

    const n = iconByKey[activeKey];
    tooltip.style.display='block';
    tooltip.style.left = (pointerX+12)+'px';
    tooltip.style.top  = (pointerY+12)+'px';
    tooltip.textContent = n ? n.userData.label : (fill.userData.key ?? '—');

  } else {
    tooltip.style.display='none';
    renderer.domElement.style.cursor = 'default';
    if (!detailLock){
      activeKey = null;
      fillsGroup.children.forEach(m=> m.material.opacity = m.userData.baseOpacity);
    } else {
      fillsGroup.children.forEach(m=>{
        const locked = (m.userData.key === detailLock);
        m.material.opacity = locked ? getHighlightOpacity() : m.userData.baseOpacity;
      });
    }
  }

  // ikon „grow/shrink” XY (hover/lock)
  for (const n of iconNodes){
    const key = n.userData.key;
    const shouldGrow = detailLock ? (key===detailLock) : (key===activeKey);
    n.userData.t = shouldGrow ? 1.35 : 1.0;
    n.userData.s = THREE.MathUtils.lerp(n.userData.s ?? 1, n.userData.t, 0.12);
    const s = n.userData.s;
    n.scale.set(s, s, s);
  }

  // 2D ikon px‑alapú fallback (ha nem volt bbox – elvileg most mindig van)
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const worldPerPixel = (dist)=> 2*Math.tan(vFOV/2)*dist / innerHeight;
  for (const n of iconNodes){
    if (n.userData.sprite?.visible && !(n.userData.maskW && n.userData.maskH)){
      const d = camera.position.distanceTo(n.position);
      const h = worldPerPixel(d) * SPRITE_PX;
      const asp = n.userData.asp || 1;
      n.userData.sprite.scale.set(h*asp, h, 1);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
