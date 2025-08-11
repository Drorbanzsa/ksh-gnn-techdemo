import {CLUSTER_COLORS,ICON_FILES} from './colors.js';
import {OrbitControls} from 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';
import {SVGLoader}   from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/SVGLoader.js';

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.1,1000);
camera.position.set(0,-4,3);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);document.body.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enablePan=false;controls.autoRotate=true;controls.autoRotateSpeed=0.4;

window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

const iconGeoms={};
const loader=new SVGLoader();
for(const [cid,path] of Object.entries(ICON_FILES)){
  const svgData=await loader.loadAsync(path);
  const shape=SVGLoader.createShapes(svgData.paths[0])[0];
  iconGeoms[cid]=new THREE.ExtrudeGeometry(shape,{depth:0.1,bevelEnabled:false});
}

const geo=await (await fetch('data/clusters_k5.geojson')).json();

const tooltip=document.getElementById('tooltip');
const raycaster=new THREE.Raycaster();
const mouse=new THREE.Vector2();
window.addEventListener('pointermove',e=>{
  mouse.x=(e.clientX/innerWidth)*2-1;
  mouse.y=-(e.clientY/innerHeight)*2+1;
});

for(const f of geo.features){
  const cid=f.properties.cluster;
  const geom=iconGeoms[cid];
  const mat=new THREE.MeshStandardMaterial({color:CLUSTER_COLORS[cid]});
  const mesh=new THREE.Mesh(geom,mat);
  const [x,y]=[f.properties.cx,f.properties.cy];
  mesh.position.set((x-19.5)*80,(y-47)*120,0);
  mesh.scale.setScalar(0.02);
  mesh.name=`${f.properties.NAME} • ${cid}`;
  scene.add(mesh);
}
scene.add(new THREE.AmbientLight(0xffffff,1));

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(scene.children);
  if(hits.length){
    const m=hits[0].object;m.rotation.z=0.2;
    tooltip.style.display='block';
    tooltip.style.left=(event.clientX+12)+'px';
    tooltip.style.top =(event.clientY+12)+'px';
    tooltip.textContent=m.name;
  }else{
    tooltip.style.display='none';
    scene.children.forEach(o=>o.rotation.z=0);
  }
  renderer.render(scene,camera);
}
animate();
