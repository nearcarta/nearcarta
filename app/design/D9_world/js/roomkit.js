// D9-side dressing for the shop rooms (D8's builders stay untouched): a ring of town trees and hedges behind the room,
// an ink outline on the room's cast, and a warm rim light so the robot and props read as solid shapes.
// Everything is added to the room scene on entry and removed on leave; nothing sits between the camera and the room.
import * as THREE from 'three';
import { outline } from './chars.js';
const M=c=>new THREE.MeshLambertMaterial({color:c});
const mats={ leaf:M(0x3f7a3a), leaf2:M(0x2f6531), trunk:M(0x6b4a2c), hedge:M(0x4a8a3e), pot:M(0xb0623a), bloom:[M(0xf2c14e),M(0xe4686a),M(0xf4f0e6)], rope:new THREE.LineBasicMaterial({color:0x4a3420}),
  flag:[0xe2a93b,0xc8553d,0x3f7fa8,0x6a9e4f].map(c=>new THREE.MeshLambertMaterial({color:c,side:THREE.DoubleSide})), bulb:new THREE.MeshBasicMaterial({color:0xffd27a,toneMapped:false}) };
const G={ cone:new THREE.ConeGeometry(1,1.6,7), cone2:new THREE.ConeGeometry(.8,1.2,7), trunk:new THREE.CylinderGeometry(.12,.16,.6,6), bush:new THREE.IcosahedronGeometry(1,0), pot:new THREE.CylinderGeometry(.16,.12,.22,8), bloom:new THREE.IcosahedronGeometry(.06,0), flag:(()=>{ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute([-.09,0,0,.09,0,0,0,-.2,0],3)); g.computeVertexNormals(); return g; })(), bulb:new THREE.SphereGeometry(.045,8,6) };
function tree(s){ const g=new THREE.Group(); const t=new THREE.Mesh(G.trunk,mats.trunk); t.position.y=.3; const a=new THREE.Mesh(G.cone,mats.leaf); a.position.y=1.2; const b=new THREE.Mesh(G.cone2,mats.leaf2); b.position.y=1.85;
  g.add(t,a,b); g.scale.setScalar(s); g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } }); return g; }
function bush(s){ const m=new THREE.Mesh(G.bush,mats.hedge); m.scale.set(s*1.3,s*.8,s); m.castShadow=m.receiveShadow=true; return m; }
function pot(){ const g=new THREE.Group(); const p=new THREE.Mesh(G.pot,mats.pot); p.position.y=.11; g.add(p); const l=new THREE.Mesh(G.bush,mats.hedge); l.scale.setScalar(.17); l.position.y=.3; g.add(l);
  for(let i=0;i<4;i++){ const f=new THREE.Mesh(G.bloom,mats.bloom[i%3]); const a=i*1.7; f.position.set(Math.cos(a)*.12,.36+(i%2)*.05,Math.sin(a)*.12); g.add(f); } g.traverse(o=>{ if(o.isMesh) o.castShadow=true; }); return g; }
let rnd=1; const r=()=>(rnd=(rnd*16807)%2147483647)/2147483647;
export function dressRoom(sh){ const sc=sh.scene, cam=sh.camera; if(!sc||sc.userData.kit) return; rnd=7+[...(sh.id||'x')].reduce((a,c)=>a+c.charCodeAt(0),0);
  const bb=new THREE.Box3(); for(const o of sc.children){ if(o.isLight||(o.isMesh&&o.geometry?.type==='CircleGeometry'&&o.geometry.parameters?.radius>=40)) continue; bb.expandByObject(o); }
  const ctr=bb.getCenter(new THREE.Vector3()), sz=bb.getSize(new THREE.Vector3()); if(!isFinite(sz.x)) return; const floor=bb.min.y, R=Math.max(2.6,Math.max(sz.x,sz.z)*.5);
  const look=cam.userData.look||ctr; const back=new THREE.Vector3().subVectors(look,cam.position).setY(0).normalize(); const yaw=Math.atan2(back.x,back.z);
  const kit=new THREE.Group(); kit.name='d9kit';
  // stand every prop on the room's own ground (ray down); a spot with no ground under it (water, off the island) gets nothing
  const solid=sc.children.filter(o=>!o.isLight&&!(o.isMesh&&o.geometry?.type==='CircleGeometry'&&o.geometry.parameters?.radius>=40)); const ray=new THREE.Raycaster(); ray.camera=cam; const DN=new THREE.Vector3(0,-1,0);
  const ground=p=>{ ray.set(new THREE.Vector3(p.x,bb.max.y+5,p.z),DN); let hs=[]; try{ hs=ray.intersectObjects(solid,true); }catch(e){} const h=hs.find(x=>x.face&&x.face.normal.y>-0.1&&x.object.visible); if(!h||h.point.y<floor+.02||h.point.y>floor+Math.max(.6,sz.y*.25)) return null; return h.point.y; };
  const put=(o,p)=>{ const y=ground(p); if(y==null) return false; o.position.set(p.x,y,p.z); kit.add(o); return true; };
  // trees and hedges on an arc behind the room (±70° around the far side), larger toward the back so the skyline is a treeline
  for(let i=0;i<17;i++){ const a=yaw+(-1.25+2.5*i/16)+(r()-.5)*.1, d=R*(1.04+r()*.3); const p=new THREE.Vector3(ctr.x+Math.sin(a)*d,floor,ctr.z+Math.cos(a)*d);
    const t=tree(.55+r()*.45+.25*Math.cos(a-yaw)); t.rotation.y=r()*6; put(t,p);
    if(i%2===0){ const b=bush(.28+r()*.2); if(put(b,p.clone().lerp(ctr,.12))) b.position.y+=.1; } }
  // two flower pots at the room's side edges, outside the main stage
  const side=new THREE.Vector3(back.z,0,-back.x);
  for(const s of [-1,1]){ const p=pot(); put(p,ctr.clone().addScaledVector(side,s*R*.95).addScaledVector(back,R*.15)); }
  // the room's own cast (D8's robot and keepers) gets the same ink outline as the town cast
  const sk=new Set(); sc.traverse(o=>{ if(o.isSkinnedMesh&&!o.userData.ink) sk.add(o.parent); }); for(const p of sk) outline(p,0x1e1208,.02);
  // warm rim light from behind-above + a soft sky fill, so characters get an edge instead of a flat wash
  const rim=new THREE.DirectionalLight(0xffc98a,1.1); rim.position.copy(ctr).addScaledVector(back,8).setY(floor+6); rim.target.position.copy(ctr); kit.add(rim,rim.target);
  const fill=new THREE.HemisphereLight(0xcfe3ff,0x5a4a2a,.35); kit.add(fill);
  sc.add(kit); sc.userData.kit=kit; }
export function undressRoom(sh){ const k=sh?.scene?.userData.kit; if(!k) return; sh.scene.remove(k); delete sh.scene.userData.kit; }
