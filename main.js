import * as THREE from 'three';
import {OrbitControls} from 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';
import {SVGLoader}   from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/SVGLoader.js';
import {CLUSTER_COLORS, ICON_FILES} from './colors.js';

// --- Alap 3D setup ---
const scene   = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera  = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 2000);
camera.position.set(0, -4, 3);

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Fények
scene.add(new THREE.AmbientLight(0xffffff, 1));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(2, -2, 3);
scene.add(dir);

// --- Tooltip setup ---
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerX = 0, pointerY = 0, lastHit = null;

window.addEventListener('pointermove', e=>{
  pointerX = e.clientX; pointerY = e.clientY;
  mouse.x =  (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
});

// --- Ikon geometriák betöltése (SVG → extrude) ---
const iconGeoms = {};
const loader = new SVGLoader();
for (const [cid, path] of Object.entries(ICON_FILES)) {
  const svgData = await loader.loadAsync(path);
  const firstPath = svgData.paths[0];
  const shape = SVGLoader.createShapes(firstPath)[0];
  iconGeoms[cid] = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
}

// --- GeoJSON betöltése ---
const geo = await (await fetch('./clusters_k5.geojson')).json();

// Hungary-pozíció skálázás (kb. lon/lat középpont köré)
const SX = 90, SY = 130;
const OX = 19.5, OY = 47.0; // középhez igazítás

// Segéd: [lon, lat] -ot ad vissza (ha nincs cx/cy, Turf centroid)
function lonLatOfFeature(f) {
  const p = f.properties || {};
  if (p.cx != null && p.cy != null) return [p.cx, p.cy];
  try {
    const c = turf.centerOfMass(f).geometry.coordinates; // [lon, lat]
    return [c[0], c[1]];
  } catch {
    return [19.5, 47.0]; // Biztonságos default
  }
}

// --- Ikonok felhelyezése ---
const iconMeshes = [];

for (const f of geo.features) {
  const cid = f.properties.cluster;
  const geom = iconGeoms[cid];
  if (!geom) continue;

  const mat = new THREE.MeshStandardMaterial({ color: CLUSTER_COLORS[cid] || 0x888888 });
  const mesh = new THREE.Mesh(geom, mat);

  const [lon, lat] = lonLatOfFeature(f);
  const X = (lon - OX) * SX;
  const Y = (lat - OY) * SY;

  mesh.position.set(X, Y, 0);
  mesh.scale.setScalar(0.02);
  mesh.userData.label = `${f.properties.NAME ?? '—'} • C${cid}`;
  iconMeshes.push(mesh);
  scene.add(mesh);
}

// --- Animációs hurok ---
function animate(){
  controls.update();

  // Raycast csak ikonokra
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
