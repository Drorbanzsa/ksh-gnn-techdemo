// ====== Three.js + add-ons (import map alapján) ======
import * as THREE           from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries }  from 'three/addons/utils/BufferGeometryUtils.js';

// Helyi segédfájlok
import { CLUSTER_COLORS, ICON_FILES, CLUSTER_LABELS } from './colors.js';

// =====================
// Beállítások
// =====================
const SPRITE_PX   = 36;   // px-alapú fallback 2D ikonhoz, ha nincs bbox (elvben most mindig van)
const FIT_OFFSET  = 1.01; // kamera-fit padding

// Kezdeti ikon-méret skála (UI-ból állítható 40–100%)
let ICON_SCALE_K  = 0.62; // 62% (ha nagyobb kell: 0.70–0.80)

let STYLE_MODE = 'icon';  // 'icon' | 'strong' | 'outline'

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
// „Vetítés” (egyszerű affinnal lon/lat → XY)
// =====================
const OX = 19.5, OY = 47.0, SX = 6.5, SY = 9.5;
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

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (!detailLock) { NATION = computeNationView(content, camera, FIT_OFFSET); goNationView(true); }
});

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dir = new THREE.DirectionalLight(0xffffff, 0.7);
dir.position.set(2, -2, 3);
scene.add(dir);

// =====================
// UI
// =====================
ensureUI();

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
  // Legend / oldalsáv
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
  // Zoomolható döntésfa lightbox
  ensureZoomLightbox();

  // Stílus + csúszka + szűrő UI
  buildLegend();

  // Stílus CSS
  if(!document.getElementById('legend-style')){
    const st = document.createElement('style'); st.id='legend-style'; st.textContent = `
      #legend{position:fixed;left:12px;top:12px;z-index:1000;background:rgba(255,255,255,.96);
        padding:.55rem .65rem;border-radius:.5rem;box-shadow:0 2px 10px rgba(0,0,0,.15);
        font:13px/1.35 system-ui,Segoe UI,Inter,Arial; max-width:min(44vw,340px);}
      #legend .row{display:flex;align-items:center;gap:.45rem;margin:.25rem 0;}
      #legend .sw{width:12px;height:12px;border:1px solid rgba(0,0,0,.25);}
      #legend .hdr{font-weight:600;margin:.35rem 0 .25rem}
      #legend button{margin-left:.35rem;font-size:12px}
      #legend .ui-row{ margin:.35rem 0 .35rem; }
      #legend .radios{ display:flex; gap:.7rem; flex-wrap:wrap; margin:.3rem 0 .2rem; }
      #legend .radios label{ display:flex; align-items:center; gap:.35rem; }
      #legend input[type="range"]{ width:140px; }

      #sidepanel{position:fixed;right:14px;top:14px;z-index:1000;width:360px;max-width:38vw;
        background:rgba(255,255,255,.98);border-radius:.75rem;box-shadow:0 12px 30px rgba(0,0,0,.2);
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
      #sidepanel .feat-list{margin:.25rem 0 0 .9rem;padding:0}
      #sidepanel .feat-list li{margin:.15rem 0}
      #sidepanel .sp-tree img{width:100%;display:block;margin:.65rem 0 .25rem;border-radius:.4rem;border:1px solid rgba(0,0,0,.1);cursor:zoom-in}
      #sidepanel .sp-actions{display:flex;justify-content:flex-end;margin-top:.6rem}
      #sidepanel .sp-actions .sp-back{border:1px solid rgba(0,0,0,.2);background:#fff;border-radius:.5rem;
        padding:.35rem .6rem;cursor:pointer}

      /* Lightbox */
      #zl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2000;display:none}
      #zl-box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        background:#fff;border-radius:.5rem;box-shadow:0 18px 55px rgba(0,0,0,.5);max-width:92vw;max-height:86vh;overflow:hidden}
      #zl-toolbar{display:flex;gap:.4rem;align-items:center;justify-content:flex-end;
        padding:.35rem .5rem;border-bottom:1px solid #eee;background:#fafafa}
      #zl-toolbar button{border:1px solid rgba(0,0,0,.2);background:#fff;border-radius:.35rem;padding:.25rem .5rem;cursor:pointer}
      #zl-canvas{position:relative;background:#fff;touch-action:none;cursor:grab}
      #zl-canvas.drag{cursor:grabbing}
      #zl-img{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none;pointer-events:none}
    `; document.head.appendChild(st);
  }
}

// =====================
// INPUT / állapot
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

let activeKey = null, detailLock = null, fly = null, NATION = null;

const ACTIVE = new Set(Object.keys(CLUSTER_LABELS).map(Number));

// TÁROLÓK
let GEO = null, META = new Map(), ALIAS = {};
const iconByKey = {};
const iconNodes = [];

// CSOPORTOK
const content    = new THREE.Group(); scene.add(content);
const fillsGroup = new THREE.Group(); fillsGroup.renderOrder = -2; content.add(fillsGroup);
const bordersGrp = new THREE.Group(); bordersGrp.renderOrder = -1; content.add(bordersGrp);
const iconsGroup = new THREE.Group(); content.add(iconsGroup);

// Stencil maszk a járásokhoz (lokális a node-hoz)
let ST_REF = 0;                       // 1..255 ciklizálás
const MASK_Z = 0.0005;                // maszkoló sík Z-eltolása picit a térkép fölé
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
    sg.translate(0,0,MASK_Z);  // kis Z-emelés
    geoms.push(sg);
  }
  return geoms.length>1 ? mergeGeometries(geoms, true) : (geoms[0] ?? new THREE.PlaneGeometry(0,0));
}

let ORDER = 0;   // stabil renderOrder: maszk -> 2D

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

  for (const f of GEO.features){
    const cid  = f.properties.cluster;
    const name = f.properties.NAME || `id_${Math.random().toString(36).slice(2)}`;

    // szülő node a járás középpontján
    const node = new THREE.Object3D();
    const [lon,lat] = lonLatOfFeature(f);
    const [X,Y,Z]   = toXY(lon, lat, 0);
    node.position.set(X,Y,Z);

    // egyedi stencil referencia ehhez a járáshoz
    const stRef = (ST_REF % 255) + 1; ST_REF++;

    // maszkoló geometria (LOKÁLIS!) és anyag
    const maskGeom = makeMaskGeometry(f, X, Y);
    const maskMat  = new THREE.MeshBasicMaterial({ color:0x000000 });
    maskMat.colorWrite   = false;      // láthatatlan, de opák passzban rajzol
    maskMat.transparent  = false;
    maskMat.opacity      = 1.0;
    maskMat.depthWrite   = false;
    maskMat.depthTest    = false;                 // biztosan írjon a stencilbe
    maskMat.stencilWrite = true;
    maskMat.stencilRef   = stRef;
    maskMat.stencilFunc  = THREE.AlwaysStencilFunc;
    maskMat.stencilZPass = THREE.ReplaceStencilOp;

    const maskMesh = new THREE.Mesh(maskGeom, maskMat);
    node.add(maskMesh);

    // stabil rajzolási sorrend: maszk -> 2D (sprite)
    const baseOrder = 1000 + ORDER * 2;
    ORDER++;
    maskMesh.renderOrder = baseOrder;

    // bbox a járásról (lokális) -> 2D illesztés
    maskGeom.computeBoundingBox();
    const mb = maskGeom.boundingBox;
    const maskW = (mb.max.x - mb.min.x);
    const maskH = (mb.max.y - mb.min.y);

    // ---------- 2D: „flat” ikon (textúrázott sík), maszkkal kivágva ----------
    const tex = flatTextures[cid];
    const asp = (tex?.image?.width && tex?.image?.height) ? (tex.image.width/tex.image.height) : 1;

    const pmaterial = new THREE.MeshBasicMaterial({ map: tex, transparent:true, depthWrite:false });
    pmaterial.depthTest    = false;            // renderOrder döntsön
    pmaterial.stencilWrite = true;
    pmaterial.stencilRef   = stRef;
    pmaterial.stencilFunc  = THREE.EqualStencilFunc;
    pmaterial.stencilZPass = THREE.KeepStencilOp;

    // illesztés a járás bbox-ába (alap kitöltés), majd később ikon-csúszkával skálázzuk
    const pad = 0.88; // <- ezt hagyjuk fixen, a csúszkás skála kezeli a tényleges méretet
    let pw = maskW*pad, ph = maskH*pad;
    if (pw/ph > asp) { ph = maskH*pad; pw = ph*asp; } else { pw = maskW*pad; ph = pw/asp; }

    const pgeom = new THREE.PlaneGeometry(pw, ph);
    const pmesh = new THREE.Mesh(pgeom, pmaterial);
    pmesh.position.z  = 0.0008;                 // maszk fölé hajszálnyival
    pmesh.renderOrder = baseOrder + 1;          // maszk után
    pmesh.scale.set(ICON_SCALE_K, ICON_SCALE_K, 1);  // kezdeti ikon méret

    node.add(pmesh);

    // ---------- meta ----------
    node.userData = {
      key: name,
      cluster: cid,
      label: `${name} · ${CLUSTER_LABELS[cid] ?? ('C'+cid)}`,
      s: 1, t: 1,
      sprite: pmesh,
      asp,
      stRef,
      maskW, maskH
    };

    iconsGroup.add(node);
    iconByKey[name] = node;
    iconNodes.push(node);
  }

  // UI frissítés
  applyFilter();
  applyStyleMode();   // stílus (fill/outline) érvényesítése
  applyIconScale();   // csúszka szerinti ikon méret

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
      const mat  = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.28, depthWrite:false });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { key:name, cluster:cid, baseOpacity:0.28, baseColor: color.clone() };
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
  const lines = new THREE.LineSegments(geom, mat);
  lines.userData = { baseColor: new THREE.Color(0x777777) };
  group.add(lines);
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
// LEGENDA + SZŰRŐ + STÍLUS + IKON MÉRET
// =====================
function buildLegend(){
  const box = document.getElementById('legend'); if (!box) return;
  box.innerHTML = '';

  // Stílus blokk
  const sh = document.createElement('div');
  sh.className = 'hdr';
  sh.textContent = 'Stílus:';
  box.appendChild(sh);

  const radios = document.createElement('div');
  radios.className = 'radios';
  radios.innerHTML = `
    <label><input type="radio" name="style-mode" value="icon" ${STYLE_MODE==='icon'?'checked':''}> Ikon + halvány szín</label>
    <label><input type="radio" name="style-mode" value="strong" ${STYLE_MODE==='strong'?'checked':''}> Erős klaszter-színek</label>
    <label><input type="radio" name="style-mode" value="outline" ${STYLE_MODE==='outline'?'checked':''}> Csak kontúr</label>
  `;
  box.appendChild(radios);

  radios.addEventListener('change', (e)=>{
    if (e.target.name==='style-mode'){
      STYLE_MODE = e.target.value;
      applyStyleMode();
    }
  });

  // Ikon méret
  const sizeRow = document.createElement('div');
  sizeRow.className = 'ui-row';
  sizeRow.innerHTML = `
    <div style="font-weight:600;">Ikon méret</div>
    <div style="display:flex; align-items:center; gap:.5rem;">
      <input id="icon-k" type="range" min="40" max="100" step="2" value="${Math.round(ICON_SCALE_K*100)}" />
      <span id="icon-k-val">${Math.round(ICON_SCALE_K*100)}%</span>
    </div>`;
  box.appendChild(sizeRow);

  const iconRange = sizeRow.querySelector('#icon-k');
  const iconVal   = sizeRow.querySelector('#icon-k-val');
  iconRange.addEventListener('input', (e)=>{
    ICON_SCALE_K = (+e.target.value) / 100;
    iconVal.textContent = Math.round(ICON_SCALE_K*100) + '%';
    applyIconScale();
  });

  // Klaszter szűrő blokk
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

function applyIconScale(){
  for (const n of iconNodes){
    const spr = n.userData?.sprite;
    if (spr) spr.scale.set(ICON_SCALE_K, ICON_SCALE_K, 1);
  }
}

function applyStyleMode(){
  // Fillek
  for (const m of fillsGroup.children){
    const baseCol = m.userData.baseColor ?? new THREE.Color(0x888888);
    m.material.color.copy(baseCol);
    if      (STYLE_MODE === 'icon')   { m.material.opacity = 0.22; }
    else if (STYLE_MODE === 'strong') { m.material.opacity = 0.78; }
    else if (STYLE_MODE === 'outline'){ m.material.opacity = 0.02; } // majdnem átlátszó, hogy a maszk maradjon
    m.userData.baseOpacity = m.material.opacity;
    m.material.needsUpdate = true;
  }
  // Kontúr
  const line = bordersGrp.children[0];
  if (line?.material){
    if (STYLE_MODE==='strong'){ line.material.opacity = 0.85; line.material.color.set(0x555555); }
    else                      { line.material.opacity = 0.70; line.material.color.set(0x777777); }
    line.material.needsUpdate = true;
  }
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

  // kiemelés
  fillsGroup.children.forEach(m=>{
    m.material.opacity = (m.userData.key === name) ? Math.max(0.45, m.userData.baseOpacity) : m.userData.baseOpacity;
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
    barf.style.background = CLUSTER_COLORS[cid] || '#8a2be2';
    barf.style.height = '6px';
    barf.style.display = 'block';
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
      // katt → nagyítható lightbox
      img.onclick = ()=> ensureZoomLightbox().open(img.src, `${name} – Klaszter ${cid} döntésfa`);
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
  // vissza ország nézetbe
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
// DÖNTÉSFÁS LIGHTBOX (zoom + pan)
// =====================
let ZL = null;
function ensureZoomLightbox(){
  if (ZL) return ZL;

  const overlay = document.createElement('div'); overlay.id='zl-overlay';
  const box = document.createElement('div'); box.id='zl-box';
  const toolbar = document.createElement('div'); toolbar.id='zl-toolbar';
  const btnPlus  = document.createElement('button'); btnPlus.textContent = '+';
  const btnMinus = document.createElement('button'); btnMinus.textContent = '–';
  const btnReset = document.createElement('button'); btnReset.textContent = 'Reset';
  const btnClose = document.createElement('button'); btnClose.textContent = '✕';

  toolbar.append(btnPlus, btnMinus, btnReset, btnClose);
  const canvas = document.createElement('div'); canvas.id='zl-canvas';
  const img = document.createElement('img'); img.id='zl-img'; img.draggable=false;
  canvas.appendChild(img);

  box.append(toolbar, canvas);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  let scale=1, ox=0, oy=0, dragging=false, px=0, py=0;

  function layout(){
    box.style.maxWidth = '92vw';
    box.style.maxHeight = '86vh';
    // középre pozicionálás CSS-ben megoldott
    update();
  }
  function update(){
    img.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
  }
  function setImage(src){
    img.src = src;
    scale = 1; ox = oy = 0; update();
  }
  function open(src){
    setImage(src);
    overlay.style.display='block';
  }
  function close(){ overlay.style.display='none'; }

  btnPlus.onclick  = ()=>{ scale = Math.min(5, scale*1.2); update(); };
  btnMinus.onclick = ()=>{ scale = Math.max(0.2, scale/1.2); update(); };
  btnReset.onclick = ()=>{ scale = 1; ox=oy=0; update(); };
  btnClose.onclick = close;
  overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close(); });

  canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - ox;
    const my = e.clientY - rect.top  - oy;
    const delta = Math.sign(e.deltaY) * -0.1;
    const ns = THREE.MathUtils.clamp(scale*(1+delta), 0.2, 5);
    // zoom a kurzor körül
    ox -= (mx/ns - mx/scale);
    oy -= (my/ns - my/scale);
    scale = ns; update();
  }, {passive:false});

  canvas.addEventListener('pointerdown', (e)=>{ dragging=true; canvas.classList.add('drag'); px=e.clientX; py=e.clientY; });
  window.addEventListener('pointermove', (e)=>{ if(!dragging) return; ox += (e.clientX-px); oy += (e.clientY-py); px=e.clientX; py=e.clientY; update(); });
  window.addEventListener('pointerup',   ()=>{ dragging=false; canvas.classList.remove('drag'); });

  window.addEventListener('resize', layout);
  layout();

  ZL = { open, close };
  return ZL;
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

  // XY „hover grow” (kisebbre vett ráemelés)
  for (const n of iconNodes){
    const key = n.userData.key;
    const shouldGrow = detailLock ? (key===detailLock) : (key===activeKey);
    n.userData.t = shouldGrow ? 1.12 : 1.0;
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
      n.userData.sprite.scale.set(h*asp*ICON_SCALE_K, h*ICON_SCALE_K, 1);
    }
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
      m.material.opacity = isActive ? Math.max(0.45, m.userData.baseOpacity) : m.userData.baseOpacity;
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
        m.material.opacity = locked ? Math.max(0.45, m.userData.baseOpacity) : m.userData.baseOpacity;
      });
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
