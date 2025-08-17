import * as THREE from 'three';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { SVGLoader }      from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLUSTER_COLORS, ICON_FILES, CLUSTER_LABELS } from './colors.js';

// =====================
// Beállítások
// =====================
const ICON_SCALE_XY = 0.006;              // 3D ikon X/Y skála normalizáló
const ICON_SCALE_Z  = 0.003;              // 3D ikon Z skála normalizáló
const SPRITE_PX     = 36;                 // ha nincs bbox, px-alapú fallback a 2D sprite-hoz
const ISO_SWITCH_PX = 120;                // ha a járás rövidebb oldala >= ennyi px → 3D
const FIT_OFFSET    = 1.01;               // kamera-fit padding

// =====================
// Elérési utak
// =====================
const fromHere = (p) => new URL(p, import.meta.url).href;
const ICON_FILES_ISO = { 0:'c0-iso.svg', 1:'c1-iso.svg', 2:'c2-iso.svg', 3:'c3-iso.svg', 4:'c4-iso.svg' };

const GEO_PATH   = fromHere('clusters_k5.geojson');
const SIL_PATH   = fromHere('silhouette_local.csv');
const ALIAS_PATH = fromHere('alias_map.json');

const ICONS_ABS     = Object.fromEntries(Object.entries(ICON_FILES)    .map(([k,p]) => [k, fromHere(p)]));
const ICONS_ISO_ABS = Object.fromEntries(Object.entries(ICON_FILES_ISO).map(([k,p]) => [k, fromHere(p)]));

// =====================
// "Vetítés" a lon/lat → sík térképre
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
// (marad a korábbi ensureUI implementáció)

// ...

// =====================
// ISO (3D) – háttérszűrés + extrude
// =====================
function sanitizeSvg(text){
  return text.replace(/url\(\s*#.*?\)/gi, '#999').replace(/<defs[\s\S]*?<\/defs>/gi, '');
}
function parseHex(c){
  if (!c || typeof c!=='string') return null;
  const m3 = c.match(/^#([0-9a-f]{3})$/i);
  const m6 = c.match(/^#([0-9a-f]{6})$/i);
  if (m3){ const n=m3[1]; return {r:parseInt(n[0]+n[0],16), g:parseInt(n[1]+n[1],16), b:parseInt(n[2]+n[2],16)}; }
  if (m6){ const n=m6[1]; return {r:parseInt(n.slice(0,2),16), g:parseInt(n.slice(2,4),16), b:parseInt(n.slice(4,6),16)}; }
  const rgb = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return { r:+rgb[1], g:+rgb[2], b:+rgb[3] };
  return null;
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

      const items = [];
      for (const p of paths){
        const fill = p?.userData?.style?.fill || p?.userData?.style?.stroke || '#999';
        const shs = SVGLoader.createShapes(p);
        for (const s of shs) items.push({shape:s, fill});
      }

      // *** NINCS SZŰRÉS *** minden path megmarad
      const parts = items;

      const geoms = parts.map(it => new THREE.ExtrudeGeometry(it.shape, { depth:0.30, bevelEnabled:false }));
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

// =====================
// Mesh anyag 3D-hez
// =====================
// ahol a mesh3D készül, ott így:
// const mmat = new THREE.MeshStandardMaterial({ color: CLUSTER_COLORS[cid] || 0x888888, flatShading:true });

// =====================
// A többi rész változatlan marad
// =====================
