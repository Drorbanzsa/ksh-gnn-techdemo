import * as THREE from 'three';
import { OrbitControls }  from 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';
import { SVGLoader }      from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/SVGLoader.js';
import { mergeGeometries } from 'https://unpkg.com/three@0.157.0/examples/jsm/utils/BufferGeometryUtils.js';
import { CLUSTER_COLORS, ICON_FILES, CLUSTER_LABELS } from './colors.js';

/* -------------------- BEÁLLÍTÁSOK -------------------- */
const GEO_PATH = './clusters_k5.geojson';  // ha data/ alatt van: 'data/clusters_k5.geojson'
const OX = 19.5, OY = 47.0;   // kb. ország-közép (WGS84)
const SX = 6.5,  SY = 9.5;    // lon/lat → vászon skála
const ICON_SCALE_XY = 0.006;  // ikon alapterület
const ICON_SCALE_Z  = 0.003;  // ikon vastagság

const toXY = (lon, lat, z=0) => [ (lon-OX)*SX, (lat-OY)*SY, z ];
function lonLatOfFeature(f){
  // elsődlegesen a GeoJSON-ból jövő centroidot használjuk
  const p = f.properties || {};
  if (p.cx!=null && p.cy!=null) return [p.cx, p.cy];

  // minimál fallback Turf nélkül: külső gyűrű átlagpontja
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

/* -------------------- UI: TOOLTIP + LEGENDA STÍLUS -------------------- */
ensureUI();
function ensureUI(){
  // tooltip fallback (ha véletlen hiányozna)
  if(!document.getElementById('tooltip')){
    const t = document.createElement('div');
    t.id = 'tooltip';
    t.style.position = 'fixed';
    t.style.display  = 'none';
    t.style.pointerEvents = 'none';
    t.style.background = 'rgba(0,0,0,.8)';
    t.style.color = '#fff';
    t.style.padding = '.35rem .5rem';
    t.style.font = '13px/1.35 system-ui,Segoe UI,Inter,Arial';
    t.style.borderRadius = '.4rem';
    t.style.zIndex = '1001';
    document.body.appendChild(t);
  }
  // legenda konténer
  if(!document.getElementById('legend')){
    const d = document.createElement('div');
    d.id = 'legend';
    document.body.appendChild(d);
  }
  // css a legendához
  if(!document.getElementById('legend-style')){
    const css = `
      #legend{position:fixed;left:12px;top:12px;z-index:1000;
        background:rgba(255,255,255,.92);padding:.55rem .6rem;border-radius:.5rem;
        box-shadow:0 2px 10px rgba(0,0,0,.15);font:13px/1.35 system-ui,Segoe UI,Inter,Arial;}
      #legend .row{display:flex;align-items:center;gap:.45rem;margin:.25rem 0;}
      #legend .sw{width:12px;height:12px;border:1px solid rgba(0,0,0,.25);}
      #legend .hdr{font-weight:600;margin-bottom:.2rem;}
      #legend button{margin-left:.35rem;font-size:12px}
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

/* -------------------- ADAT -------------------- */
const geo = await (await fetch(GEO_PATH)).json();

/* -------------------- CSOPORTOK -------------------- */
const content    = new THREE.Group(); scene.add(content);
const fillsGroup = new THREE.Group(); fillsGroup.renderOrder = -2; content.add(fillsGroup);
const bordersGrp = new THREE.Group(); bordersGrp.renderOrder = -1; content.add(bordersGrp);
const iconsGroup = new THREE.Group(); content.add(iconsGroup);

/* -------------------- POLIGON‑KITÖLTÉS -------------------- */
drawFills(geo, fillsGroup);
function drawFills(geojson, group){
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
      geom.translate(0,0,-0.03); // picit lejjebb, ne zizegjen az ikonokkal

      const mat  = new THREE.MeshBasicMaterial({
        color, transparent:true, opacity:0.28, depthWrite:false
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { key:name, cluster:cid, baseOpacity:0.28, baseColor: color.clone() };
      group.add(mesh);
    }
  }
  function trimClose(ring){
    if (!ring?.length) return [];
    const last = ring[ring.length-1], first = ring[0];
    const same = last && first && last[0]===first[0] && last[1]===first[1];
    return same ? ring.slice(0,-1) : ring.slice();
  }
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
    if (g.type==='Polygon')          for (const r of g.coordinates) pushRing(r);
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
const iconGeoms = await loadIconGeoms(ICON_FILES);

for (const f of geo.features){
  const cid  = f.properties.cluster;
  const name = f.properties.NAME || `id_${Math.random().toString(36).slice(2)}`;
  const geom = iconGeoms[cid];
  if (!geom) continue;

  const mat  = new THREE.MeshStandardMaterial({ color: CLUSTER_COLORS[cid] || 0x888888 });
  const mesh = new THREE.Mesh(geom, mat);

  const [lon,lat] = lonLatOfFeature(f);
  const [X,Y,Z]   = toXY(lon, lat, 0);
  mesh.position.set(X,Y,Z);

  // smooth skálázás állapot + felirat klaszternévvel
  mesh.userData = {
    key: name,
    cluster: cid,
    label: `${name} · ${CLUSTER_LABELS[cid] ?? ('C'+cid)}`,
    s: 1.0,   // aktuális skála faktor
    t: 1.0    // cél skála faktor
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

  // fejléc + mind/semmi
  box.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className = 'hdr';
  hdr.innerHTML = `Klaszterek 
    <button id="lg-all" type="button">Mind</button>
    <button id="lg-none" type="button">Semmi</button>`;
  box.appendChild(hdr);

  // sorok
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

  // események
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
  // ha rejtett elem fölött álltunk, rejtsük a tooltipet
  if (activeKey){
    const im = iconByKey[activeKey];
    if (!im || !im.visible){ activeKey=null; tooltip.style.display='none'; }
  }
}

/* -------------------- KAMERA IGAZÍTÁS -------------------- */
fitGroup(content, camera, controls);
function fitGroup(obj, camera, controls, offset=1.25){
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const camZ = Math.abs(maxDim / (2*Math.tan(fov/2))) * offset;
  camera.position.set(center.x, center.y - camZ, camZ);
  camera.near = camZ/100; camera.far = camZ*100; camera.updateProjectionMatrix();
  controls.target.copy(center); controls.update();
}

/* -------------------- HOVER: POLIGON → IKON -------------------- */
let activeKey = null;

function animate(){
  controls.update();

  // 1) raycast poligonokra
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(fillsGroup.children, true);

  if (hits.length){
    const fill = hits[0].object;
    activeKey = fill.userData.key;
    renderer.domElement.style.cursor = 'pointer';

    // poligon kiemelés
    fillsGroup.children.forEach(m=>{
      const isActive = m.userData.key === activeKey;
      m.material.opacity = isActive ? 0.45 : m.userData.baseOpacity;
    });

    // tooltip
    const im = iconByKey[activeKey];
    tooltip.style.display='block';
    tooltip.style.left = (pointerX+12)+'px';
    tooltip.style.top  = (pointerY+12)+'px';
    tooltip.textContent = im ? im.userData.label : (fill.userData.key ?? '—');
  }else{
    activeKey = null;
    renderer.domElement.style.cursor = 'default';
    fillsGroup.children.forEach(m=> m.material.opacity = m.userData.baseOpacity);
    tooltip.style.display='none';
  }

  // 2) ikon skálázás simítva
  iconMeshes.forEach(m=>{
    m.userData.t = (m.userData.key === activeKey) ? 1.35 : 1.0;
    m.userData.s = THREE.MathUtils.lerp(m.userData.s, m.userData.t, 0.12);
    const s = m.userData.s;
    m.scale.set(ICON_SCALE_XY*s, ICON_SCALE_XY*s, ICON_SCALE_Z*s);
  });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
