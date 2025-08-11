import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';
import { SVGLoader }     from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/SVGLoader.js';
import { mergeGeometries } from 'https://unpkg.com/three@0.157.0/examples/jsm/utils/BufferGeometryUtils.js';
import { CLUSTER_COLORS, ICON_FILES } from './colors.js';

/* -------------------- MÉRETEK / TRANSZFORM -------------------- */
const OX = 19.5, OY = 47.0;      // Magyarország közepe (WGS84 approx)
const SX = 6.5,  SY = 9.5;       // lon/lat → vászon skála
const ICON_SCALE_XY = 0.006;     // ikon alapterület
const ICON_SCALE_Z  = 0.003;     // ikon vastagság

// lon/lat -> lokális XYZ
function toXY(lon, lat, z = 0){
  return [ (lon - OX) * SX, (lat - OY) * SY, z ];
}
function lonLatOfFeature(f){
  const p = f.properties || {};
  if (p.cx != null && p.cy != null) return [p.cx, p.cy];
  try {
    const c = turf.centerOfMass(f).geometry.coordinates; // [lon, lat]
    return [c[0], c[1]];
  } catch { return [OX, OY]; }
}

/* -------------------- ALAP 3D SZETT -------------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 5000);
camera.position.set(0, -6, 4);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = true;   // ha teljesen tiltani akarod: false
controls.autoRotate = false;    // kérésedre NEM forog

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(2, -2, 3);
scene.add(dir);

/* -------------------- TOOLTIP / RAYCAST -------------------- */
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerX = 0, pointerY = 0, lastHit = null;

window.addEventListener('pointermove', e=>{
  pointerX = e.clientX; pointerY = e.clientY;
  mouse.x =  (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
});

/* -------------------- IKON GEOMETRIÁK (SVG → 3D) -------------------- */
const iconGeoms = {};
const loader = new SVGLoader();

for (const [cid, path] of Object.entries(ICON_FILES)) {
  try {
    const svgData = await loader.loadAsync(path);
    const shapes = [];
    for (const p of svgData.paths) shapes.push(...SVGLoader.createShapes(p));
    let geom;
    if (shapes.length) {
      const parts = shapes.map(s => new THREE.ExtrudeGeometry(s, { depth:0.12, bevelEnabled:false }));
      geom = mergeGeometries(parts, true);
      geom.center();
    } else {
      console.warn('SVG nem adott ki shape-et, fallback henger:', path);
      geom = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
    }
    iconGeoms[cid] = geom;
  } catch (e) {
    console.warn('SVG load hiba, fallback henger:', path, e);
    iconGeoms[cid] = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
  }
}

/* -------------------- ADAT BETÖLTÉS -------------------- */
const geo = await (await fetch('./clusters_k5.geojson')).json();

/* -------------------- JÁRÁSHATÁROK (LINESEGMENTS) -------------------- */
const content = new THREE.Group();   // minden tartalom ide
scene.add(content);

drawBorders(geo, content);

function drawBorders(geojson, group){
  const pos = [];
  const pushRing = (ring) => {
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1, z1] = toXY(ring[i-1][0], ring[i-1][1], -0.02);
      const [x2, y2, z2] = toXY(ring[i  ][0], ring[i  ][1], -0.02);
      pos.push(x1, y1, z1, x2, y2, z2);
    }
  };
  for (const f of geojson.features){
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon'){
      for (const ring of g.coordinates) pushRing(ring);
    } else if (g.type === 'MultiPolygon'){
      for (const poly of g.coordinates) for (const ring of poly) pushRing(ring);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat  = new THREE.LineBasicMaterial({ color:0x555555, transparent:true, opacity:0.6 });
  const borders = new THREE.LineSegments(geom, mat);
  borders.renderOrder = -1; // ikonok mögé
  group.add(borders);
}

/* -------------------- IKONOK FELRAKÁSA -------------------- */
const iconMeshes = [];
const iconsGroup = new THREE.Group();
content.add(iconsGroup);

for (const f of geo.features) {
  const cid  = f.properties.cluster;
  const geom = iconGeoms[cid];
  if (!geom) continue;

  const mat  = new THREE.MeshStandardMaterial({ color: CLUSTER_COLORS[cid] || 0x888888 });
  const mesh = new THREE.Mesh(geom, mat);

  const [lon, lat] = lonLatOfFeature(f);
  const [X, Y, Z] = toXY(lon, lat, 0);
  mesh.position.set(X, Y, Z);
  mesh.scale.set(ICON_SCALE_XY, ICON_SCALE_XY, ICON_SCALE_Z);

  mesh.userData = {
    label: `${f.properties.NAME ?? '—'} · C${cid}`,
    cluster: cid
  };

  iconsGroup.add(mesh);
  iconMeshes.push(mesh);
}

console.info('Ikonok száma:', iconMeshes.length);

/* -------------------- KAMERA IGAZÍTÁS -------------------- */
fitGroup(content, camera, controls);

function fitGroup(obj, camera, controls, offset=1.25) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const camZ = Math.abs(maxDim / (2 * Math.tan(fov/2))) * offset;

  camera.position.set(center.x, center.y - camZ, camZ);
  camera.near = camZ / 100;
  camera.far  = camZ * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

/* -------------------- ANIMÁCIÓS Hurok -------------------- */
function animate(){
  controls.update();

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(iconMeshes, true);

  if (hits.length) {
    const m = hits[0].object;
    if (lastHit && lastHit !== m) lastHit.rotation.z = 0;
    m.rotation.z = 0.2;
    lastHit = m;

    tooltip.style.display = 'block';
    tooltip.style.left = (pointerX + 12) + 'px';
    tooltip.style.top  = (pointerY + 12) + 'px';
    tooltip.textContent = m.userData.label;
  } else {
    if (lastHit) lastHit.rotation.z = 0;
    lastHit = null;
    tooltip.style.display = 'none';
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
