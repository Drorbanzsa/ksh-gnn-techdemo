import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { SVGLoader }      from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLUSTER_COLORS, ICON_FILES, CLUSTER_LABELS } from './colors.js';

const fromHere = (p) => new URL(p, import.meta.url).href;

const ICON_FILES_ISO = { 0:'c0-iso.svg', 1:'c1-iso.svg', 2:'c2-iso.svg', 3:'c3-iso.svg', 4:'c4-iso.svg' };

const GEO_PATH   = fromHere('clusters_k5.geojson');
const SIL_PATH   = fromHere('silhouette_local.csv');
const ALIAS_PATH = fromHere('alias_map.json');

const ICONS_ABS     = Object.fromEntries(Object.entries(ICON_FILES)    .map(([k,p]) => [k, fromHere(p)]));
const ICONS_ISO_ABS = Object.fromEntries(Object.entries(ICON_FILES_ISO).map(([k,p]) => [k, fromHere(p)]));

// --- térkép-koordináta →
const OX = 19.5, OY = 47.0;
const SX = 6.5,  SY = 9.5;
const toXY = (lon, lat, z=0) => [ (lon-OX)*SX, (lat-OY)*SY, z ];
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

// --- ikon méretezés
const ICON_SCALE_XY = 0.006;
const ICON_SCALE_Z  = 0.003;
const SPRITE_PX = 36;           // 2D ikon kívánt képernyő-magasság px-ben
const ISO_SWITCH_DISTANCE = 9;  // ez alatt vált 3D-re

// ========== SCENE ==========
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 5000);
camera.position.set(0, -6, 4);

const renderer = new THREE.WebGLRenderer({ antialias:true, stencil:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = true;

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  // képernyő-újrafittelés (ha nincs megnyitott paneles fókusz)
  if (!detailLock) { NATION = computeNationView(content, camera, 1.06); goNationView(true); }
});

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dir = new THREE.DirectionalLight(0xffffff, 0.7);
dir.position.set(2, -2, 3);
scene.add(dir);

// ========== UI ==========
ensureUI();
function ensureUI(){
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
  if(!document.getElementById('legend')){
    const d = document.createElement('div'); d.id='legend'; document.body.appendChild(d);
  }
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
  if(!document.getElementById('legend-style')){
    const st = document.createElement('style'); st.id='legend-style'; st.textContent = `
      #legend{position:fixed;left:12px;top:12px;z-index:1000;background:rgba(255,255,255,.92);
        padding:.55rem .6rem;border-radius:.5rem;box-shadow:0 2px 10px rgba(0,0,0,.15);
        font:13px/1.35 system-ui,Segoe UI,Inter,Arial;}
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
    `; document.head.appendChild(st);
  }
}

// ========== INPUT ==========
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerX=0, pointerY=0;
window.addEventListener('pointermove', e=>{
  pointerX=e.clientX; pointerY=e.clientY;
  mouse.x  = (e.clientX/innerWidth)*2-1;
  mouse.y  =-(e.clientY/innerHeight)*2+1;
});

// ========== ÁLLAPOT ==========
let activeKey = null, detailLock = null, fly = null, NATION = null;

// ========== TÁROLÓK ==========
let GEO = null, META = new Map(), ALIAS = {};
const iconByKey = {};   // name -> parent node
const iconNodes = [];   // parent nodek listája

// ========== CSOPORTOK ==========
const content    = new THREE.Group(); scene.add(content);
const fillsGroup = new THREE.Group(); fillsGroup.renderOrder = -2; content.add(fillsGroup);
const bordersGrp = new THREE.Group(); bordersGrp.renderOrder = -1; content.add(bordersGrp);
const iconsGroup = new THREE.Group(); content.add(iconsGroup);

// --- Stencil maszk a járásokhoz
let ST_REF = 1;             // 1..255
const MASK_Z = 0.0005;      // a térkép fölé picit

function makeMaskGeometry(feature){
  const ringsets = [];
  const g = feature.geometry;
  if (!g) return new THREE.PlaneGeometry(0,0);
  if (g.type==='Polygon')           ringsets.push(g.coordinates);
  else if (g.type==='MultiPolygon') ringsets.push(...g.coordinates);

  const geoms = [];
  const toV2 = ([x,y]) => new THREE.Vector2(...toXY(x,y).slice(0,2));

  for (const rings of ringsets){
    if (!rings?.length) continue;
    const outer = rings[0].map(toV2);
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();

    const shape = new THREE.Shape(outer);
    for (let i=1; i<rings.length; i++){
      const hole = rings[i].map(toV2);
      if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
      shape.holes.push(new THREE.Path(hole));
    }
    const sg = new THREE.ShapeGeometry(shape);
    sg.translate(0,0,MASK_Z);
    geoms.push(sg);
  }
  return geoms.length>1 ? mergeGeometries(geoms, true) : (geoms[0] ?? new THREE.PlaneGeometry(0,0));
}

// ========== INIT ==========
async function init(){
  const [geo, meta, alias, flatTextures, isoGeoms] = await Promise.all([
    (await fetch(GEO_PATH)).json(),
    loadMeta(SIL_PATH).catch(()=>new Map()),
    loadAlias(ALIAS_PATH).catch(()=> ({})),
    loadIconTextures(ICONS_ABS),          // 2D
    loadIsoGeomsFiltered(ICONS_ISO_ABS),  // 3D (háttér kirekesztve)
  ]);

  GEO = geo; META = meta; ALIAS = alias;

  drawFills(GEO, fillsGroup);
  drawBorders(GEO, bordersGrp);

  for (const f of GEO.features){
    const cid  = f.properties.cluster;
    const name = f.properties.NAME || `id_${Math.random().toString(36).slice(2)}`;

    const node = new THREE.Object3D();
    const [lon,lat] = lonLatOfFeature(f);
    const [X,Y,Z]   = toXY(lon, lat, 0);
    node.position.set(X,Y,Z);
    node.userData = { key:name, cluster:cid, label:`${name} · ${CLUSTER_LABELS[cid] ?? ('C'+cid)}`, s:1, t:1, mode:'flat', sprite:null, mesh:null, asp:1 };

    // --- stencil maszk ehhez a járáshoz
    const stRef = (ST_REF++ % 255) || 1;   // egyedi ref 1..255
    const maskGeom = makeMaskGeometry(f);

    const maskMat = new THREE.MeshBasicMaterial({ color:0x000000 });
    maskMat.colorWrite   = false;      // csak stencilbe ír
    maskMat.transparent  = true;
    maskMat.opacity      = 0.0;
    maskMat.depthWrite   = false;
    maskMat.stencilWrite = true;
    maskMat.stencilRef   = stRef;
    maskMat.stencilFunc  = THREE.AlwaysStencilFunc;
    maskMat.stencilZPass = THREE.ReplaceStencilOp;

    const maskMesh = new THREE.Mesh(maskGeom, maskMat);
    maskMesh.renderOrder = 0;          // a sprite elé rajzolódjon
    node.add(maskMesh);

    node.userData.stRef = stRef;

    // 2D sprite (távolról)
    const tex = flatTextures[cid];
    const asp = (tex?.image?.width && tex?.image?.height) ? (tex.image.width/tex.image.height) : 1;
    node.userData.asp = asp;
    const smat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false });
    const smat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false });
    // sprite csak ott látszódjon, ahol a maszk rajzolt:
    smat.stencilWrite = true;
    smat.stencilRef   = stRef;
    smat.stencilFunc  = THREE.EqualStencilFunc;
    smat.stencilZPass = THREE.KeepStencilOp;
    const sprite = new THREE.Sprite(smat);
    sprite.renderOrder = 1;
    node.add(sprite);
    node.userData.sprite = sprite;

    // 3D mesh (közelről)
    const geom3D = isoGeoms[cid];
    const mmat   = new THREE.MeshStandardMaterial({ color: CLUSTER_COLORS[cid] || 0x888888 });
    const mesh3D = new THREE.Mesh(geom3D, mmat);
    mesh3D.scale.set(ICON_SCALE_XY, ICON_SCALE_XY, ICON_SCALE_Z);
    mesh3D.visible = false;
    node.add(mesh3D);
    node.userData.mesh = mesh3D;

    iconsGroup.add(node);
    iconByKey[name] = node;
    iconNodes.push(node);
  }

  buildLegend(); applyFilter();

  // teljes képernyős fit
  NATION = computeNationView(content, camera, 1.06);
  goNationView(true);

  requestAnimationFrame(animate);
}
init().catch(console.error);

// ========== POLIGONOK ==========
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
      const mat  = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.28, depthWrite:false });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { key:name, cluster:cid, baseOpacity:0.28, baseColor: color.clone() };
      group.add(mesh);
    }
  }
}

// ========== HATÁROK ==========
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
  group.add(new THREE.LineSegments(geom, mat));
}

// ========== FLAT (2D) – SVG mint textúra ==========
async function loadIconTextures(map){
  const loader = new THREE.TextureLoader();
  const out = {};
  for (const [cid, path] of Object.entries(map)){
    try{
      const tex = await loader.loadAsync(path);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
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

// ========== ISO (3D) – háttérszűrés + extrude ==========
function sanitizeSvg(text){
  // gradient/filter url(#...) → egyszerű szín
  return text
    .replace(/url\(\s*#.*?\)/gi, '#999')
    .replace(/<defs[\s\S]*?<\/defs>/gi, '');
}
function parseHex(c){ // #rgb | #rrggbb
  if (!c || typeof c!=='string') return null;
  const m3 = c.match(/^#([0-9a-f]{3})$/i);
  const m6 = c.match(/^#([0-9a-f]{6})$/i);
  if (m3){ const n=m3[1]; const r=parseInt(n[0]+n[0],16), g=parseInt(n[1]+n[1],16), b=parseInt(n[2]+n[2],16); return {r,g,b}; }
  if (m6){ const n=m6[1]; const r=parseInt(n.slice(0,2),16), g=parseInt(n.slice(2,4),16), b=parseInt(n.slice(4,6),16); return {r,g,b}; }
  const rgb = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return { r:+rgb[1], g:+rgb[2], b:+rgb[3] };
  return null;
}
function isVeryLight(fill){
  const col = parseHex(fill);
  if (!col) return false;
  return col.r>230 && col.g>230 && col.b>230;
}
function boundsOfShape(shape){
  const pts = shape.getPoints(8);
  let minX=+Infinity,minY=+Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const p of pts){ if (p.x<minX) minX=p.x; if (p.y<minY) minY=p.y; if (p.x>maxX) maxX=p.x; if (p.y>maxY) maxY=p.y; }
  return {minX,minY,maxX,maxY, w:maxX-minX, h:maxY-minY};
}
async function loadIsoGeomsFiltered(map){
  const loader = new SVGLoader();
  const out = {};
  for (const [cid, path] of Object.entries(map)){
    try{
      const raw = await fetch(path).then(r=>r.text());
      const cleaned = sanitizeSvg(raw);
      const { paths } = loader.parse(cleaned);

      // path->shapes + meta (fill)
      const items = [];
      for (const p of paths){
        const fill = p?.userData?.style?.fill || p?.userData?.style?.stroke || '#999';
        const shs = SVGLoader.createShapes(p);
        for (const s of shs) items.push({shape:s, fill});
      }

      // össz-bounding
      let U=null;
      for (const it of items){
        const b = boundsOfShape(it.shape);
        if (!U) U={minX:b.minX,minY:b.minY,maxX:b.maxX,maxY:b.maxY};
        else { U.minX=Math.min(U.minX,b.minX); U.minY=Math.min(U.minY,b.minY); U.maxX=Math.max(U.maxX,b.maxX); U.maxY=Math.max(U.maxY,b.maxY); }
      }
      const Uw = (U?.maxX??1)-(U?.minX??0), Uh = (U?.maxY??1)-(U?.minY??0);

      // háttér szűrés: nagyon világos KITÖLTÉS vagy túl nagy (>=80% mindkét irányban)
      const filtered = items.filter(it=>{
        const b = boundsOfShape(it.shape);
        const huge = Uw>0 && Uh>0 && (b.w>=0.8*Uw && b.h>=0.8*Uh);
        return !huge && !isVeryLight(it.fill);
      });

      const parts = filtered.length ? filtered : items; // ha túl agresszív volt a szűrés, ne maradjon üres
      const geoms = parts.map(it => new THREE.ExtrudeGeometry(it.shape, { depth:0.18, bevelEnabled:false }));
      let geom = mergeGeometries(geoms, true);
      geom.center();
      out[cid] = geom;
    }catch(e){
      console.warn('ISO SVG parse hiba, fallback:', map[cid], e);
      out[cid] = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
    }
  }
  return out;
}

// ========== LEGENDA + SZŰRŐ ==========
const ACTIVE = new Set(Object.keys(CLUSTER_LABELS).map(Number));
function buildLegend(){
  const box = document.getElementById('legend'); if (!box) return;
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
  iconsGroup.children.forEach(n => n.visible = ACTIVE.has(n.userData.cluster));
  fillsGroup.children.forEach(m => m.visible = ACTIVE.has(m.userData.cluster));
  if (activeKey !== null){
    const n = iconByKey[activeKey];
    if (!n || !n.visible){ activeKey=null; tooltip.style.display='none'; }
  }
}

// ========== KAMERA / FIT ==========
function computeNationView(obj, camera, offset=1.06){
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
  if (!NATION) NATION = computeNationView(content, camera, 1.06);
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

// ========== VÁLTÁS 2D↔3D ==========
function showIso(name){
  const n = iconByKey[name]; if (!n) return;
  if (n.userData.mode === 'iso') return;
  if (n.userData.sprite) n.userData.sprite.visible = false;
  if (n.userData.mesh)   n.userData.mesh.visible   = true;
  n.userData.mode = 'iso';
}
function showFlat(name){
  const n = iconByKey[name]; if (!n) return;
  if (n.userData.mode === 'flat') return;
  if (n.userData.mesh)   n.userData.mesh.visible   = false;
  if (n.userData.sprite) n.userData.sprite.visible = true;
  n.userData.mode = 'flat';
}

// ========== INTERAKCIÓ ==========
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
  if (detailLock && detailLock !== name) showFlat(detailLock);
  detailLock = name;
  showIso(name);
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
      img.src = fromHere(`dtree_cluster${cid}_FULL.png`);
      img.alt = `Klaszter ${cid} döntésfa`;
      img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; };
    } else { img.removeAttribute('src'); img.style.display = 'none'; }
  }
  panel.classList.add('open');
}
function closePanel(){
  if (!panel.classList.contains('open')) return;
  if (detailLock) showFlat(detailLock);
  panel.classList.remove('open');
  detailLock = null;
  goNationView(false);
}
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closePanel(); });

// ========== ALIAS + CSV ==========
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

// ========== LOOP ==========
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

  // zoom-küszöb: sprite ↔ 3D
  if (detailLock){
    const d = camera.position.distanceTo(controls.target);
    if (d < ISO_SWITCH_DISTANCE) showIso(detailLock);
    else                         showFlat(detailLock);
  }

  // képernyő-független 2D ikonméret
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const worldPerPixel = (dist)=> 2*Math.tan(vFOV/2)*dist / innerHeight;
  for (const n of iconNodes){
    if (n.userData.sprite?.visible){
      const d = camera.position.distanceTo(n.position);
      const h = worldPerPixel(d) * SPRITE_PX;     // világmagasság
      const asp = n.userData.asp || 1;
      n.userData.sprite.scale.set(h*asp, h, 1);
    }
    // „növekedés” (hover/lock)
    const key = n.userData.key;
    const shouldGrow = detailLock ? (key===detailLock) : (key===activeKey);
    n.userData.t = shouldGrow ? 1.35 : 1.0;
    n.userData.s = THREE.MathUtils.lerp(n.userData.s, n.userData.t, 0.12);
    const s = n.userData.s; n.scale.set(s, s, s);
  }

  // hover
  const hoverEnabled = !detailLock;
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
    const n = iconByKey[activeKey];
    tooltip.style.display='block';
    tooltip.style.left = (pointerX+12)+'px';
    tooltip.style.top  = (pointerY+12)+'px';
    tooltip.textContent = n ? n.userData.label : (fill.userData.key ?? '—');
  }else{
    if (!detailLock){
      activeKey = null;
      renderer.domElement.style.cursor = 'default';
      fillsGroup.children.forEach(m=> m.material.opacity = m.userData.baseOpacity);
      tooltip.style.display='none';
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}


