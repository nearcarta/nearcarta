// Nearcarta world: renderer, colour script (time of day), island, water, life, ward, post chain.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { P, CAPTURE, clock, rnd, hx, key, DIRS, hdist, edgePt, tiles, isTown, bTile, SHOPS, EXTRA, GATE, road, doorOf, pickRoad, SQ3 } from './core.js';

export const LP = P.has('lp') || P.get('mode')==='lp';
export const W = { scene:null, camera:null, renderer:null, composer:null, B:{}, pickables:[], lamps:[], houses:[], roadSets:[], U:null, gatePos:null, jetty:{}, boat:null, tod:1, frz:0, hit:0 };
const $ = s=>document.querySelector(s);

// ---------- loading ----------
const manager = new THREE.LoadingManager();
manager.setURLModifier(u => /hexagons_medieval\.png$/.test(u) ? 'assets/hex/tiles/base/hexagons_medieval.png' : u);
export const loader = new GLTFLoader(manager); loader.setMeshoptDecoder(MeshoptDecoder);
const gcache = new Map();
const raw = p => new Promise((res,rej)=>loader.load('assets/'+p+(/\.glb$/.test(p)?'':'.gltf'), res, undefined, rej));
// bundles (node names restored: the loader suffixes duplicates across scenes, which would break shared clips): every hex model the town uses lives in one glb (one scene per original file); the five KayKit folk share one glb and one set of clips
const bcache = {};
const bundle = f => bcache[f] || (bcache[f] = raw(f).then(g=>{ const m={}, J=g.parser.json; g.scenes.forEach(s=>{ m[s.name]=s; s.traverse(o=>{ const a=g.parser.associations.get(o); if(a&&a.nodes!==undefined&&J.nodes[a.nodes].name) o.name=THREE.PropertyBinding.sanitizeNodeName(J.nodes[a.nodes].name); }); }); return {g,m}; }).catch(()=>null));
const KAY = /^chars9\/(Knight|Rogue_Hooded|Barbarian|Mage|Rogue)\.glb$/;
export const load = p => { if(!gcache.has(p)){ let pr;
    if(p.startsWith('hex/')){ const n=THREE.PropertyBinding.sanitizeNodeName(p); pr=bundle('hex_bundle.glb').then(b=>b&&b.m[n]?{scene:b.m[n],animations:[]}:raw(p)); }
    else if(KAY.test(p)){ const n=p.match(KAY)[1]; pr=bundle('chars9/kay.glb').then(b=>b&&b.m[n]?{scene:b.m[n],animations:b.g.animations}:raw(p)); }
    else pr=raw(p);
    gcache.set(p,pr); }
  return gcache.get(p); };
export let onProgress = ()=>{}; export function setProgress(f){ onProgress=f; }

// ---------- the Nearcarta atlas: KayKit's palette atlas, recoloured swatch by swatch ----------
// 8x4 vertical-gradient swatches. Blues/navies become slate and terracotta; grass becomes olive-sage; water becomes sea-glass teal.
const SW = {
  8:['#93ad95','#4d6b58'],   // light blue → shallow sea-glass (water)
  9:['#84a088','#3d5a4a'],   // blue→navy (water) → sea-glass to deep teal
  12:['#93a46c','#52653b'],  // bright grass → olive-sage
  16:['#8f9d63','#55663a'],  // acid yellow-olive → dry meadow
  17:['#6f8a58','#32503a'],  // emerald → moss / leaves
  19:['#a8977c','#7b6a55'],  // sandy path → worn stone street
  24:['#a8644a','#5e3427'],  // blue→navy (team roofs) → terracotta tile
  27:['#6b8754','#2f4a36'],  // emerald → pine
};
function makeAtlas(img){ const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; const x=c.getContext('2d'); x.drawImage(img,0,0);
  const sw=img.width/8, sh=img.height/4;
  for(const [i,[a,b]] of Object.entries(SW)){ const col=i%8, row=(i/8)|0; const g=x.createLinearGradient(0,row*sh,0,row*sh+sh); g.addColorStop(0,a); g.addColorStop(1,b); x.fillStyle=g; x.fillRect(col*sw,row*sh,sw,sh); }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.flipY=false; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.LinearFilter;
  // window glow: only the dark glazing swatch emits; everything else stays black
  const e=document.createElement('canvas'); e.width=img.width; e.height=img.height; const ex=e.getContext('2d'); ex.fillStyle='#000'; ex.fillRect(0,0,e.width,e.height);
  const gg=ex.createLinearGradient(0,0,0,sh); gg.addColorStop(0,'#d8fff2'); gg.addColorStop(1,'#1f8f6e'); ex.fillStyle=gg; ex.fillRect(0,0,sw,sh);
  const et=new THREE.CanvasTexture(e); et.colorSpace=THREE.SRGBColorSpace; et.flipY=false; et.generateMipmaps=false; et.minFilter=et.magFilter=THREE.LinearFilter; W.winTex=et;
  return t; }

// ---------- colour script ----------
const C = h=>new THREE.Color(h);
const KEYS = [ // day, dusk, night. Graphite sky, violet horizon, green sun. Buildings stay, the grade does not.
  { top:C('#12161c'), mid:C('#1a2128'), hor:C('#243038'), fog:C('#101418'), sun:C('#e7fff6'), sunI:1.9, hemiS:C('#d5dbe4'), hemiG:C('#1a2422'), hemiI:1.05, sea:C('#1a2c30'), deep:C('#0e181c'), elev:.9, lift:C('#000000'), sat:.62, lamp:.15, fly:.1, expo:1.08, sh:.05 },
  { top:C('#10141a'), mid:C('#181c24'), hor:C('#2a2440'), fog:C('#0c0e11'), sun:C('#c4b5fd'), sunI:1.35, hemiS:C('#c5ccd6'), hemiG:C('#16191f'), hemiI:1.15, sea:C('#152226'), deep:C('#0c0e11'), elev:.72, lift:C('#050608'), sat:.58, lamp:1, fly:.6, expo:1.12, sh:.08 },
  { top:C('#0c0e11'), mid:C('#141820'), hor:C('#221c36'), fog:C('#0c0e11'), sun:C('#8b7cff'), sunI:1.2, hemiS:C('#c5ccd6'), hemiG:C('#121418'), hemiI:1.2, sea:C('#121c22'), deep:C('#090b0e'), elev:.8, lift:C('#050608'), sat:.55, lamp:1, fly:1, expo:1.16, sh:.1 },
];
const ICE = C('#cfe6f5');
const mixK=(t)=>{ const i=Math.min(1,Math.floor(t)), f=Math.min(1,t-i), a=KEYS[i], b=KEYS[Math.min(2,i+1)]; const o={}; for(const k in a) o[k]= a[k].isColor? a[k].clone().lerp(b[k],f) : a[k]+(b[k]-a[k])*f; return o; };

// ---------- shared uniforms ----------
const U = W.U = { time:{value:0}, hit:{value:0}, refuse:{value:0}, hitPos:{value:new THREE.Vector3()}, frz:{value:0}, glow:{value:.5}, wind:{value:1} };

let sky, sun, hemi, sea, seaMat, atlasMat, treeMat, grassMesh, flies, fireflyMat, lpool=[];
export async function init(canvas){
  const r = W.renderer = new THREE.WebGLRenderer({canvas, antialias:LP, powerPreference:'high-performance', preserveDrawingBuffer:CAPTURE});
  r.setPixelRatio(Math.min(devicePixelRatio, LP?1:CAPTURE?1:1.5)); r.setSize(innerWidth,innerHeight);
  r.shadowMap.enabled=!LP; r.shadowMap.type=THREE.PCFSoftShadowMap; r.toneMapping=THREE.ACESFilmicToneMapping; r.toneMappingExposure=1.16; r.outputColorSpace=THREE.SRGBColorSpace;
  const s = W.scene = new THREE.Scene(); s.fog=new THREE.Fog(0x0c0e11,42,150);
  W.camera = new THREE.PerspectiveCamera(30, innerWidth/innerHeight, .3, 400);
  hemi=new THREE.HemisphereLight(0xffffff,0x444444,1); s.add(hemi);
  sun=new THREE.DirectionalLight(0xffffff,2); sun.castShadow=!LP; const SM=+(P.get('shadow')||2048); sun.shadow.mapSize.set(SM,SM); W.sunShadowSize=SM;
  Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:110}); sun.shadow.bias=-.0005; sun.shadow.normalBias=.035; s.add(sun,sun.target);
  buildSky();
  const img = await new Promise(res=>{ const i=new Image(); i.onload=()=>res(i); i.src='assets/hex/tiles/base/hexagons_medieval.png'; });
  const atlas = makeAtlas(img);
  atlasMat = new THREE.MeshLambertMaterial({ map:atlas, vertexColors:true, emissiveMap:W.winTex, emissive:0xffffff, emissiveIntensity:0 }); W.winMats=[atlasMat];
  treeMat = new THREE.MeshLambertMaterial({ map:atlas, vertexColors:true }); W.treeFadeU={value:0};
  treeMat.onBeforeCompile = sh=>{ sh.uniforms.time=U.time; sh.uniforms.wind=U.wind; sh.vertexShader='uniform float time; uniform float wind;\n'+sh.vertexShader.replace('#include <begin_vertex>',
    `#include <begin_vertex>
     float h=max(position.y-.22,0.); float ph=position.x*.37+position.z*.29;
     transformed.x += (sin(time*1.4+ph)*.035 + sin(time*3.1+ph*2.)*.012)*h*wind;
     transformed.z += cos(time*1.1+ph)*.025*h*wind;`);
    // walk camera: trees right in front of the lens dissolve (dither) instead of filling the frame with dark leaves
    sh.uniforms.tfade=W.treeFadeU; sh.fragmentShader='uniform float tfade;\n'+sh.fragmentShader.replace('#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
     if(tfade>0.){ float cd=length(vViewPosition); float ign=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))); if(smoothstep(1.3,2.9,cd)*tfade+(1.-tfade)<ign) discard; }`); };
  await buildIsland();
  buildWater(); buildGrass(); buildLamps(); buildWard(); buildFerry(); buildArena(); buildZec(); buildMist(); buildSmoke(); buildBirds(); buildFireflies(); buildBell(); buildPlaque(); buildSigns(); buildLaundry();
  if(!LP) buildPost();
  addEventListener('resize', resize);
  return W;
}
function resize(){ const c=W.camera; c.aspect=innerWidth/innerHeight; c.updateProjectionMatrix(); W.renderer.setSize(innerWidth,innerHeight); if(W.composer){ W.composer.setSize(innerWidth,innerHeight); W.bloom.setSize(innerWidth/2,innerHeight/2); W.fin.uniforms.res.value.set(innerWidth,innerHeight); } }

function buildSky(){
  const m=new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false, uniforms:{ top:{value:C('#000')}, mid:{value:C('#000')}, hor:{value:C('#000')}, sunDir:{value:new THREE.Vector3()}, sunC:{value:C('#fff')} },
    vertexShader:`varying vec3 vD; void main(){ vD=normalize(position); vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }`,
    fragmentShader:`uniform vec3 top,mid,hor,sunDir,sunC; varying vec3 vD; void main(){ float y=vD.y; vec3 c=mix(hor,mid,smoothstep(-.02,.18,y)); c=mix(c,top,smoothstep(.15,.6,y));
      float s=max(dot(vD,sunDir),0.); c+=sunC*(pow(s,12.)*.35+pow(s,300.)*1.2); gl_FragColor=vec4(c,1.); }` });
  sky=new THREE.Mesh(new THREE.SphereGeometry(300,32,16),m); sky.renderOrder=-10; sky.frustumCulled=false; W.scene.add(sky);
}

// ---------- island ----------
const statics=[], treesG=[];
// bundled meshes are quantized (normalized ints); bake needs plain floats before moving them into world space
function toFloat(src){ const g=new THREE.BufferGeometry(); for(const n of ['position','normal','uv']){ const a=src.attributes[n]; if(!a) continue; const f=new Float32Array(a.count*a.itemSize); for(let i=0;i<a.count;i++) for(let j=0;j<a.itemSize;j++) f[i*a.itemSize+j]=a.getComponent(i,j); g.setAttribute(n,new THREE.BufferAttribute(f,a.itemSize)); }
  if(src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array),1)); return g; }
function bake(obj, tint, into){ obj.updateMatrixWorld(true); obj.traverse(m=>{ if(!m.isMesh) return; const g=toFloat(m.geometry); g.applyMatrix4(m.matrixWorld);
  for(const a of Object.keys(g.attributes)) if(!['position','normal','uv'].includes(a)) g.deleteAttribute(a);
  if(g.index===null){ const n=g.attributes.position.count, idx=new Uint32Array(n); for(let i=0;i<n;i++) idx[i]=i; g.setIndex(new THREE.BufferAttribute(idx,1)); }
  const n=g.attributes.position.count, col=new Float32Array(n*3); const c=new THREE.Color(tint); for(let i=0;i<n;i++){ col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b; }
  g.setAttribute('color',new THREE.BufferAttribute(col,3)); into.push(g); }); }
const jobs=[];
function place(name,q,r,{k=0,y=0,s=1,dx=0,dz=0,rot=null,tint=0xffffff,tree=false,keep=false}={}){ const p=load('hex/'+name).then(g=>{ const o=g.scene.clone(true); const c=hx(q,r); o.position.set(c.x+dx,y,c.z+dz); o.rotation.y=rot!==null?rot:k*Math.PI/3; o.scale.setScalar(s);
  if(keep){ o.traverse(m=>{ if(m.isMesh){ m.material=atlasMat.clone(); W.winMats.push(m.material); m.material.vertexColors=false; m.material.color.set(tint); m.castShadow=m.receiveShadow=true; } }); W.scene.add(o); return o; }
  bake(o,tint,tree?treesG:statics); return o; }); jobs.push(p); return p; }
const GR=0xe6e8d6; // grass multiplier (desaturates toward olive)
async function buildIsland(){
  for(const t of tiles.values()){ const {q,r,kind}=t, k=key(q,r); const edge=t.d===7;
    if(kind==='river'){ place('tiles/rivers/hex_river_A',q,r,{k:2,tint:GR}); }
    else if(road.has(k)){ const set=new Set(); DIRS.forEach(([dq,dr],i)=>{ const nk=key(q+dq,r+dr); if(road.has(nk)) set.add(i); if(bTile.has(nk)&&doorOf.get(k)===bTile.get(nk)) set.add(i); }); if(k===key(-7,1)) set.add(3); if(k===key(0,1)) set.add(2);
      const [v,rk]=pickRoad(set); W.roadSets.push({q,r,set:[...set]}); place('tiles/roads/hex_road_'+v,q,r,{k:rk,tint:GR}); }
    else place('tiles/base/hex_grass',q,r,{tint:GR});
    // diorama cliff: a second layer below the coast so the island reads as a cut-out
    if(edge) place('tiles/base/hex_grass_bottom',q,r,{y:-1,tint:0xd8cdb8});
  }
  // civic buildings: kept separate (hover, states, doors)
  for(const [id,s] of Object.entries(SHOPS)){ const face=Math.PI/3*s.doorDir-Math.PI/2;
    place(s.m,s.q,s.r,{rot:face,keep:true,s:id==='chronicle'||id==='hall'?1.18:1.28,tint:id==='bank'?0xe8e2d6:id==='toll'?0xb0a596:0xffffff}).then(o=>{ W.B[id]=o; o.userData.id=id; o.traverse(m=>{ if(m.isMesh){ m.userData.id=id; W.pickables.push(m); } }); }); }
  EXTRA.forEach(([m,q,r,k])=>place(m,q,r,{k,keep:/windmill/.test(m)}).then(o=>{ if(/windmill/.test(m)){ W.windmill=o; o.traverse(x=>{ if(x.isMesh&&/blade|wing|sail|fan/i.test(x.name)) x.userData.dynCast=true; }); } }));
  // toll bridge over the river, next to the toll tower (closed: a rope and a sign)
  place('buildings/neutral/building_bridge_A',4,4,{k:2,tint:GR});
  // wilds: mountains to the north-west, forest, hills; the far bank beyond the river
  const occupied=new Set([...road,...bTile.keys(),key(-6,1),key(-6,2),key(-6,0),key(4,4)]);
  const trees=['trees_A_large','trees_A_medium','trees_B_large','trees_B_medium','tree_single_A','tree_single_B','trees_A_small','trees_B_small'];
  const garden=[];
  for(const t of tiles.values()){ const k=key(t.q,t.r); if(occupied.has(k)) continue; const x=rnd(), rk=(rnd()*6)|0;
    if(t.kind==='wild'){ if(t.q<-2&&t.r<-1&&x<.6&&t.d>=6) place('decoration/nature/'+(x<.22?'mountain_A_grass_trees':x<.38?'mountain_C_grass_trees':x<.5?'mountain_B_grass':'hills_A_trees'),t.q,t.r,{k:rk,tint:GR,tree:true});
      else if(x<.86) place('decoration/nature/'+trees[(rnd()*trees.length)|0],t.q,t.r,{k:rk,tint:GR,tree:true});
      else if(x<.8) place('decoration/nature/'+['hill_single_A','hill_single_B','rock_single_A','hills_B','rock_single_C'][(rnd()*5)|0],t.q,t.r,{k:rk,tint:GR}); }
    else if(t.kind==='far'){ if(x<.55) place('decoration/nature/'+trees[(rnd()*trees.length)|0],t.q,t.r,{k:rk,tint:0xd8d6c6,tree:true}); else if(x<.7) place('decoration/nature/hills_C_trees',t.q,t.r,{k:rk,tint:0xd8d6c6,tree:true}); }
    else if(t.kind==='town'){ garden.push(t); fillTown(t,x,rk); }
  }
  // lived-in props, placed by hand near the buildings that would use them (no stalls, no price tags)
  const PR=[
    ['barrel',-4,1,.55,.45],['crate_A_small',-4,1,-.55,.5],['weaponrack',-3,2,-.45,-.35],['flag_red',-3,3,.1,0],['target',-3,3,-.6,.4],      // guardhouse yard
    ['bucket_water',-1,1,.55,-.35],['sack',-1,1,-.6,.3],                                                                                  // by the well
    ['resource_lumber',-2,-1,.5,.45],['wheelbarrow',-2,-1,-.45,-.4],['resource_stone',-3,0,.4,.5],                                       // smithy
    ['crate_long_A',3,-3,.45,.35],['crate_B_small',3,-3,-.3,.55],['pallet',3,-1,.5,.4],['barrel',3,-1,.2,.62],['sack',3,-1,-.2,.55],    // ferry dock cargo
    ['flag_yellow',1,2,.6,.4],['bucket_arrows',2,3,-.6,-.2],['target',2,2,.4,-.4],                                                     // arena
    ['ladder',0,-1,.6,-.4],['crate_open',0,-3,.55,.5],['barrel',0,-3,.25,.7],                                                         // tavern + tower
    ['tent',-7,2,0,0],['crate_open',-7,1,.5,.65],['flag_green',-6,2,.2,.2],                                                              // stranger's camp outside the ward
    ['flag_yellow',-1,4,.4,-.3],['resource_lumber',-5,3,.1,.1],['wheelbarrow',-3,4,.4,.4],
  ];
  PR.forEach(([n,q,r,dx,dz])=>place('decoration/props/'+n,q,r,{dx,dz,k:(rnd()*6)|0,tint:0xf0ece0}));
  // fences around two gardens
  [[-2,3,0],[-2,3,2],[1,-3,1],[1,-3,3],[2,0,4]].forEach(([q,r,k])=>place('buildings/neutral/fence_wood_straight',q,r,{k,tint:0xf0ece0}));
  // shore plants
  [[4,-5,0,0,'waterlily_A'],[4,1,0,.3,'waterlily_B'],[4,-6,.4,0,'waterplant_A'],[4,-1,-.4,.2,'waterplant_B'],[4,2,.3,-.3,'waterlily_A']].forEach(([q,r,dx,dz,n])=>place('decoration/nature/'+n,q,r,{dx,dz,tint:GR}));
  buildSkyline();
  // clouds
  // clouds: six puffs baked into one mesh; the ring turns as one (same drift as before)
  { const cg=[]; const cl=[]; for(let i=0;i<6;i++) cl.push(load('hex/decoration/nature/'+(i%2?'cloud_big':'cloud_small')).then(g=>{ const o=g.scene.clone(); const a=i/6*Math.PI*2+.4; o.position.set(Math.cos(a)*85,9+(i%3)*2.5,Math.sin(a)*85); o.scale.setScalar(4+(i%3)); o.updateMatrixWorld(true); o.traverse(m=>{ if(m.isMesh){ const g2=toFloat(m.geometry); delete g2.attributes.uv; g2.deleteAttribute('uv'); g2.applyMatrix4(m.matrixWorld); cg.push(g2); } }); }));
    await Promise.all(cl); if(cg.length){ const cm=new THREE.Mesh(mergeGeometries(cg,false),new THREE.MeshLambertMaterial({color:0xfff4e6,transparent:true,opacity:.82,fog:true,depthWrite:false})); cm.renderOrder=-1; cm.frustumCulled=false; W.scene.add(cm); clouds.push(cm); } }
  let done=0; const total=()=>jobs.length; jobs.forEach(j=>j.then(()=>onProgress(++done/total())));
  let n=0; while(n!==jobs.length){ n=jobs.length; await Promise.all(jobs.slice()); }
  // merged into chunks: the town core, then six sectors of the outer ring, so the far ring frustum-culls (and drops out of the shadow pass) when off screen
  const mk=(arr,mat,shadow)=>{ if(!arr.length) return; const B=[[],[],[],[],[],[],[]]; const v=new THREE.Vector3();
    for(const g of arr){ g.computeBoundingBox(); g.boundingBox.getCenter(v); const d=Math.hypot(v.x,v.z); B[d<9?0:1+Math.floor(((Math.atan2(v.z,v.x)+Math.PI)/(Math.PI*2))*6)%6].push(g); }
    const grp=new THREE.Group(); grp.name='chunks'; B.forEach((a,i)=>{ if(!a.length) return; const m=new THREE.Mesh(mergeGeometries(a,false),mat); m.castShadow=shadow; m.receiveShadow=true; m.name='chunk'+i; grp.add(m); }); W.scene.add(grp); return grp; };
  W.ground=mk(statics,atlasMat,true); W.trees=mk(treesG,treeMat,true);
  W.garden=garden;
}

// ---------- density: every town tile is a house, a yard or a little square; never an empty field ----------
const LAMPT=new Set(['-4,1','-3,1','-2,1','-1,1','0,1','1,0','1,-1','2,-2','2,-3','-1,0','-2,-1','-3,2','-2,3','0,2','-5,1','-1,3','3,-2']);
const DOORS=new Set(Object.values(SHOPS).map(s=>key(...s.door)));
const FENCED=new Set(['-2,3','1,-3','2,0']);
const HOUSES=['building_home_A_blue','building_home_B_blue','building_home_B_blue','building_tavern_blue','building_lumbermill_blue','building_home_A_blue','building_blacksmith_blue','building_mine_blue'];
const SMALLTREE=['tree_single_A','tree_single_B','trees_A_small','trees_B_small'];
const PROPS=['barrel','crate_A_small','crate_B_small','sack','bucket_water','bucket_empty','pallet','crate_open','resource_lumber','wheelbarrow','crate_long_B'];
let hi=0;
function fillTown(t,x,rk){ const {q,r}=t, k=key(q,r);
  const roadN=DIRS.map(([dq,dr],i)=>[i,key(q+dq,r+dr)]).filter(([,nk])=>road.has(nk));
  const nearGate=q<=-4&&r>=0&&r<=2, nearStart=(q===-1||q===-2)&&r===2;
  if(roadN.length && !DOORS.has(k) && !LAMPT.has(k) && !FENCED.has(k) && !nearGate && !nearStart && x<.62){
    // a lived-in house facing the street, a touch smaller than the civic buildings
    const i=roadN[(rnd()*roadN.length)|0][0]; const m=HOUSES[hi++%HOUSES.length];
    place('buildings/blue/'+m,q,r,{rot:Math.PI/3*i-Math.PI/2,s:.86+rnd()*.08});
    bTile.set(k,'extra'); W.houses.push({q,r,dir:i});
    // the yard in front: two props by the door
    for(let j=0;j<2;j++){ const a=Math.PI/3*i+(j?.75:-.75)*(.6+rnd()*.3); place('decoration/props/'+PROPS[(rnd()*PROPS.length)|0],q,r,{dx:Math.cos(a)*.7,dz:-Math.sin(a)*.7,k:(rnd()*6)|0,s:.9,tint:0xf0ece0}); }
    return; }
  // a little square: a tree or two, a bench-height crate group, flowers of grass
  const n=1+((rnd()*2)|0); for(let j=0;j<n;j++){ const a=rnd()*6.28, d=.25+rnd()*.45; place('decoration/nature/'+SMALLTREE[(rnd()*4)|0],q,r,{k:(rnd()*6)|0,s:.7+rnd()*.25,tint:GR,tree:true,dx:Math.cos(a)*d,dz:Math.sin(a)*d}); }
  if(!LAMPT.has(k)||rnd()<.5){ const a=rnd()*6.28; place('decoration/props/'+PROPS[(rnd()*PROPS.length)|0],q,r,{dx:Math.cos(a)*.55,dz:Math.sin(a)*.55,k:(rnd()*6)|0,tint:0xf0ece0}); }
  if(rnd()<.4) place('decoration/nature/rock_single_'+'ABCDE'[(rnd()*5)|0],q,r,{dx:(rnd()-.5)*.9,dz:(rnd()-.5)*.9,s:.6,tint:GR});
}
// ---------- skyline: far islands and ridges in the haze, so the view never ends in a void ----------
function buildSkyline(){ const R=['mountain_A_grass_trees','mountain_B_grass','mountain_C_grass_trees','hills_A_trees','hills_C_trees','mountain_A_grass','hills_B_trees','mountain_C_grass'];
  for(let i=0;i<34;i++){ const a=i/34*Math.PI*2+rnd()*.12; const d=34+rnd()*20+(i%3)*4; const s=3+rnd()*3.5;
    place('decoration/nature/'+R[i%R.length],0,0,{dx:Math.cos(a)*d,dz:Math.sin(a)*d,y:-.6-rnd()*.6,s,k:(rnd()*6)|0,tint:0xbfb6a0,tree:false}); }
  // the far bank continues: a low ridge right behind the river
  for(let i=0;i<9;i++) place('decoration/nature/'+(i%2?'hills_A_trees':'trees_A_large'),0,0,{dx:17+rnd()*4,dz:-14+i*3.5,y:-.3,s:1.6+rnd(),k:(rnd()*6)|0,tint:0xd0ccb8,tree:true});
}

// ---------- shop fronts: a hanging sign with its own glyph, a lantern over the door, a warm spill on the step ----------
const GLYPH={
  chronicle:x=>{ x.beginPath(); x.moveTo(-26,-30); x.lineTo(22,-30); x.quadraticCurveTo(30,-30,30,-22); x.lineTo(30,30); x.lineTo(-22,30); x.quadraticCurveTo(-30,30,-30,22); x.lineTo(-30,-26); x.stroke(); for(let i=0;i<4;i++){ x.beginPath(); x.moveTo(-18,-14+i*12); x.lineTo(18-(i==3?14:0),-14+i*12); x.stroke(); } },
  hall:x=>{ x.beginPath(); x.moveTo(-24,22); x.quadraticCurveTo(-22,-30,0,-30); x.quadraticCurveTo(22,-30,24,22); x.closePath(); x.stroke(); x.beginPath(); x.arc(0,30,6,0,7); x.fill(); x.beginPath(); x.moveTo(0,-30); x.lineTo(0,-40); x.stroke(); },
  bank:x=>{ for(let i=0;i<3;i++){ x.beginPath(); x.ellipse(0,20-i*16,24,8,0,0,7); x.fill(); x.stroke(); } x.save(); x.fillStyle='#eef2ff'; x.font='bold 22px serif'; x.textAlign='center'; x.restore(); },
  ferry:x=>{ x.beginPath(); x.moveTo(-32,6); x.lineTo(32,6); x.lineTo(22,22); x.lineTo(-22,22); x.closePath(); x.fill(); x.beginPath(); x.moveTo(0,6); x.lineTo(0,-34); x.lineTo(22,0); x.closePath(); x.stroke(); x.beginPath(); x.moveTo(-36,32); x.quadraticCurveTo(-18,24,0,32); x.quadraticCurveTo(18,40,36,32); x.stroke(); },
  guard:x=>{ x.beginPath(); x.moveTo(0,-34); x.lineTo(28,-24); x.quadraticCurveTo(28,18,0,36); x.quadraticCurveTo(-28,18,-28,-24); x.closePath(); x.stroke(); x.beginPath(); x.moveTo(0,-22); x.lineTo(0,24); x.moveTo(-16,-6); x.lineTo(16,-6); x.stroke(); },
  arena:x=>{ for(const r of [30,19,8]){ x.beginPath(); x.arc(0,0,r,0,7); x.stroke(); } x.beginPath(); x.moveTo(-34,-30); x.lineTo(0,0); x.stroke(); },
  house:x=>{ x.beginPath(); x.arc(-14,0,13,0,7); x.stroke(); x.beginPath(); x.moveTo(-1,0); x.lineTo(34,0); x.moveTo(22,0); x.lineTo(22,12); x.moveTo(30,0); x.lineTo(30,9); x.stroke(); },
  payouts:x=>{ for(let i=0;i<3;i++){ x.beginPath(); x.moveTo(-30,-24+i*20); x.lineTo(4,-24+i*20); x.stroke(); x.beginPath(); x.arc(22,-24+i*20,7,0,7); x.fill(); } x.beginPath(); x.moveTo(-34,34); x.lineTo(34,34); x.stroke(); },
  toll:x=>{ x.beginPath(); x.moveTo(-36,20); x.quadraticCurveTo(0,-26,36,20); x.stroke(); x.beginPath(); x.moveTo(-36,20); x.lineTo(36,20); x.stroke(); for(let i=-2;i<=2;i++){ x.beginPath(); x.moveTo(i*12,20); x.lineTo(i*12,20-(14-Math.abs(i)*5)); x.stroke(); } },
};
function signTex(id){ const c=document.createElement('canvas'); c.width=c.height=128; const x=c.getContext('2d');
  x.fillStyle='#5b3a22'; x.fillRect(0,0,128,128); x.fillStyle='#e9dcbf'; x.fillRect(7,7,114,114); x.strokeStyle='#b68a46'; x.lineWidth=4; x.strokeRect(12,12,104,104);
  x.translate(64,64); x.lineWidth=6; x.lineCap=x.lineJoin='round'; x.strokeStyle='#2a1d14'; x.fillStyle='#2a1d14'; (GLYPH[id]||GLYPH.hall)(x);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t; }
const signs=[];
function buildSigns(){ const wood=new THREE.MeshLambertMaterial({color:0x4a3020}), iron=new THREE.MeshLambertMaterial({color:0x2b2622});
  const lampM=new THREE.MeshBasicMaterial({color:0xffc477,fog:true}); const spillT=softT;
  // static ironwork and lantern boxes of all seven shops are one draw each; the door spills are one instanced draw and the halos one Points draw (was 4 draws per shop)
  const armG=[], lampG=[], n=Object.keys(SHOPS).length; let si=0;
  const pools=new THREE.InstancedMesh(new THREE.CircleGeometry(.55,20).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:spillT,color:0xffa050,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}),n);
  const hp=new Float32Array(n*3), hc=new Float32Array(n*3), hs=new Float32Array(n);
  for(const [id,s] of Object.entries(SHOPS)){ const c=hx(s.q,s.r), d=hx(...s.door); const dir=d.clone().sub(c).setY(0).normalize(); const side=new THREE.Vector3(-dir.z,0,dir.x);
    const sc=id==='chronicle'||id==='hall'?1.18:1.28; const front=c.clone().addScaledVector(dir,.62*sc);
    // bracket + swinging sign, off to one side of the door
    const g=new THREE.Group(); g.position.copy(front).addScaledVector(side,.34).setY(1.02); g.rotation.y=Math.atan2(dir.x,dir.z)+Math.PI/2;
    g.updateMatrixWorld(true); armG.push(new THREE.BoxGeometry(.04,.04,.36).applyMatrix4(g.matrixWorld));
    const pv=new THREE.Group(); pv.position.set(0,-.02,.0); g.add(pv);
    const tex=signTex(id); const face=new THREE.MeshLambertMaterial({map:tex,emissive:0x3a2614,emissiveMap:tex,emissiveIntensity:.0});
    // four wood sides in one group, two painted faces in the other: 2 draws per sign, not 6
    const bg=new THREE.BoxGeometry(.03,.3,.3); bg.clearGroups(); bg.addGroup(0,24,0); bg.addGroup(24,12,1); const board=new THREE.Mesh(bg,[wood,face]); board.rotation.y=Math.PI/2; board.position.y=-.19; board.castShadow=true; board.userData.dynCast=true; pv.add(board);
    g.traverse(m=>{ if(m.isMesh) m.userData.id=id; }); W.pickables.push(board);
    W.scene.add(g); signs.push({pv,face,ph:rnd()*6});
    // door lantern and a warm spill on the step
    const lp=front.clone().addScaledVector(side,-.3).setY(.78); lampG.push(new THREE.BoxGeometry(.07,.1,.07).translate(lp.x,lp.y,lp.z));
    hp.set([lp.x,lp.y,lp.z],si*3); const pp=front.clone().addScaledVector(dir,.3).setY(.03); pools.setMatrixAt(si,new THREE.Matrix4().makeTranslation(pp.x,pp.y,pp.z)); pools.setColorAt(si,C('#000'));
    signs[signs.length-1].i=si++; }
  const arms=new THREE.Mesh(mergeGeometries(armG,false),iron), lms=new THREE.Mesh(mergeGeometries(lampG,false),lampM); arms.name='signArms'; lms.name='signLamps';
  const hg=new THREE.BufferGeometry(); hg.setAttribute('position',new THREE.BufferAttribute(hp,3)); hg.setAttribute('color',new THREE.BufferAttribute(hc,3)); hg.setAttribute('size',new THREE.BufferAttribute(hs,1));
  const halos=new THREE.Points(hg,W.lampFx.halos.material); halos.frustumCulled=pools.frustumCulled=false; pools.name='signPools'; halos.name='signHalos';
  W.signFx={pools,halos,lampM}; W.scene.add(arms,lms,pools,halos);
}
function updSigns(T,dt){ const k=W.lampAmb||0, F=W.signFx; if(!F) return; const hc=F.halos.geometry.attributes.color, hs=F.halos.geometry.attributes.size, tc=new THREE.Color();
  for(const s of signs){ s.pv.rotation.x=Math.sin(T*1.3+s.ph)*.09*(1-W.frz)*U.wind.value; s.face.emissiveIntensity=k*.6;
    const f=(.85+.15*Math.sin(T*9+s.ph*3)*Math.sin(T*3.7+s.ph))*(1-W.frz*.6);
    tc.setHex(0xffb060).multiplyScalar(k*.5*f); hc.setXYZ(s.i,tc.r,tc.g,tc.b); hs.setX(s.i,.36+k*.2);
    const o=k*.32*f; tc.setRGB(o,o,o); F.pools.setColorAt(s.i,tc); }
  hc.needsUpdate=hs.needsUpdate=true; F.pools.instanceColor.needsUpdate=true; F.lampM.color.setHex(W.frz>.5?0xbfe6ff:0xffc477); }
const clouds=[];

// ---------- water: one stylized plane, shallow→deep by an island distance field, two foam bands ----------
function buildWater(){
  const S=48, N=512; const cv=document.createElement('canvas'); cv.width=cv.height=N; const x=cv.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,N,N);
  const toPx=v=>(v/S*.5+.5)*N; const hexPoly=(q,r,rad)=>{ const c=hx(q,r); x.beginPath(); for(let i=0;i<6;i++){ const a=Math.PI/6+i*Math.PI/3; x.lineTo(toPx(c.x+rad*Math.cos(a)),toPx(c.z+rad*Math.sin(a))); } x.closePath(); x.fill(); };
  const land=[...tiles.values()];
  [[28,.25],[14,.45],[6,.7],[2,1]].forEach(([b,a])=>{ x.filter=`blur(${b}px)`; x.globalAlpha=a; x.fillStyle='#fff'; land.forEach(t=>hexPoly(t.q,t.r,1.18)); }); x.filter='none'; x.globalAlpha=1;
  const df=new THREE.CanvasTexture(cv); df.flipY=false;
  seaMat=new THREE.ShaderMaterial({ fog:true, transparent:false, uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{ df:{value:df}, S:{value:S}, time:U.time, shallow:{value:C('#577160')}, deep:{value:C('#2d4136')}, foam:{value:C('#eef2ff')}, sunC:{value:C('#ffb070')}, frz:U.frz }]),
    vertexShader:`varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mvPosition=viewMatrix*w; gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`,
    fragmentShader:`uniform sampler2D df; uniform float S,time,frz; uniform vec3 shallow,deep,foam,sunC; varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
float n2(vec2 p){ return sin(p.x*1.7+time*.6)*sin(p.y*1.3-time*.45)+sin((p.x+p.y)*.9+time*.8)*.5; }
void main(){ vec2 uv=vW.xz/S*.5+.5; float d=texture2D(df,uv).r; float w=n2(vW.xz*.8)*.04;
  vec3 c=mix(deep,shallow,smoothstep(.0,.55,d+w));
  float band1=smoothstep(.07,.0,abs(fract(d*3.2-time*.18)-.5)-.38)*smoothstep(.25,.55,d)*smoothstep(.97,.8,d);
  float edge=smoothstep(.87,.95,d+w*.5);
  vec2 gp=vW.xz*1.7+vec2(time*.21,-time*.13); float sp=pow(max(sin(gp.x+sin(gp.y*1.31+time*.7)*1.9)*sin(gp.y*.83+sin(gp.x*1.17-time*.5)*1.7),0.),60.)*.18*(1.-smoothstep(.2,.7,d));
  c=mix(c,foam,clamp(band1*.35+edge*.7,0.,1.)); c+=sunC*sp;
  c=mix(c,vec3(.78,.88,.93),frz*.55);
  gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}` });
  sea=W.sea=new THREE.Mesh(new THREE.PlaneGeometry(320,320,64,64),seaMat); sea.rotation.x=-Math.PI/2; sea.position.y=-.26; sea.receiveShadow=false; W.scene.add(sea);
}


// ---------- cell instancing: one InstancedMesh per ~7-unit cell, so off-screen cells frustum-cull, plus distance LOD ----------
// lod(d) -> share of a cell's instances drawn at camera distance d (instances are shuffled, so thinning is even);
// far: a cheaper geometry swapped in beyond farD (same instance matrices).
const LODC=[]; W.lodCells=LODC;
function cellInst(geo,mat,items,{cell=7,lod=null,far=null,farD=26,shadow=false,name=''}={}){ const cells=new Map();
  for(const it of items){ const e=it.m.elements; const k=Math.floor(e[12]/cell)+','+Math.floor(e[14]/cell); (cells.get(k)||cells.set(k,[]).get(k)).push(it); }
  const grp=new THREE.Group(); grp.name=name;
  for(const arr of cells.values()){ for(let i=arr.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; }
    const m=new THREE.InstancedMesh(geo,mat,arr.length); arr.forEach((it,i)=>{ m.setMatrixAt(i,it.m); if(it.c) m.setColorAt(i,it.c); });
    m.receiveShadow=true; m.castShadow=shadow; m.computeBoundingSphere(); m.userData.cell={n:arr.length,lod,far,near:geo,farD}; grp.add(m); LODC.push(m); }
  W.scene.add(grp); return grp; }
function updLod(){ const cp=W.camera.position; for(const m of LODC){ const u=m.userData.cell; const d=cp.distanceTo(m.boundingSphere.center);
    if(u.lod){ m.count=Math.max(0,Math.min(u.n,Math.round(u.n*u.lod(d)))); m.visible=m.count>0; } if(u.far) m.geometry=d>u.farD?u.far:u.near; } }
// ---------- instanced grass tufts with wind ----------
function buildGrass(){
  const blade=new THREE.BufferGeometry(); const P=[],Cc=[]; for(let i=0;i<3;i++){ const a=i/3*Math.PI+rnd()*.4, w=.035, h=.16+rnd()*.06, lx=Math.cos(a)*.03, lz=Math.sin(a)*.03;
    P.push(-w*Math.cos(a)+lx,0,-w*Math.sin(a)+lz, w*Math.cos(a)+lx,0,w*Math.sin(a)+lz, lx*2.4,h,lz*2.4); Cc.push(.55,.6,.38, .55,.6,.38, .86,.84,.58); }
  blade.setAttribute('position',new THREE.Float32BufferAttribute(P,3)); blade.setAttribute('color',new THREE.Float32BufferAttribute(Cc,3)); blade.computeVertexNormals();
  const mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  mat.onBeforeCompile=sh=>{ sh.uniforms.time=U.time; sh.uniforms.wind=U.wind; sh.vertexShader='uniform float time; uniform float wind;\n'+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    vec3 ip=instanceMatrix[3].xyz; float k=position.y*6.; transformed.x+=(sin(time*2.1+ip.x*.8+ip.z*.3)*.035+sin(time*4.7+ip.z)*.01)*k*wind; transformed.z+=cos(time*1.7+ip.x*.4)*.02*k*wind;`); };
  const spots=[]; for(const t of tiles.values()){ const k=key(t.q,t.r); if(t.kind==='river'||road.has(k)||bTile.has(k)) continue; const c=hx(t.q,t.r); const n=t.kind==='town'?54:t.kind==='far'?8:24;
    for(let i=0;i<(LP?n/2:n);i++){ const a=rnd()*Math.PI*2, rr=Math.sqrt(rnd())*.88; spots.push([c.x+Math.cos(a)*rr,c.z+Math.sin(a)*rr,.8+rnd()*.9,rnd()*6]); } }
  // road verges: tufts along the road edges read as walked-around grass
  for(const k of road){ const [q,r]=k.split(',').map(Number); const c=hx(q,r); for(let i=0;i<5;i++){ const a=rnd()*Math.PI*2; spots.push([c.x+Math.cos(a)*.86,c.z+Math.sin(a)*.86,.5+rnd()*.5,rnd()*6]); } }
  const q=new THREE.Quaternion(), s=new THREE.Vector3(); const items=spots.map(([x,z,sc,ro])=>{ q.setFromAxisAngle(new THREE.Vector3(0,1,0),ro); s.set(sc,sc*(.8+rnd()*.5),sc); return {m:new THREE.Matrix4().compose(new THREE.Vector3(x,0,z),q,s)}; });
  // tufts are a pixel or two past ~30 units: keep 100% up close, thin to 45% at the overview
  grassMesh=cellInst(blade,mat,items,{name:'grass',lod:d=>d<18?1:Math.max(.45,1-(d-18)/40)}); W.grassCount=spots.length;
  buildCobbles(); buildFlowers();
}
// cobbles: one instanced mesh of worn setts laid along every street strip
function buildCobbles(){ const g=new THREE.CylinderGeometry(.056,.064,.024,6,1,false); g.translate(0,.008,0); const mat=new THREE.MeshLambertMaterial({color:0xffffff});
  // the bottom cap is never seen: drop it (24 -> 18 tris); far cells use a flat hex top (4 tris), the sides are sub-pixel there
  { const ix=g.index.array, keep=[]; const pos=g.attributes.position; for(let i=0;i<ix.length;i+=3){ const lo=[0,1,2].every(j=>pos.getY(ix[i+j])<-.003); if(!lo) keep.push(ix[i],ix[i+1],ix[i+2]); } g.setIndex(keep); }
  const gf=new THREE.CircleGeometry(.058,6); gf.rotateX(-Math.PI/2); gf.translate(0,.02,0);
  const pts=[]; for(const {q,r,set} of W.roadSets){ const c=hx(q,r); for(const i of set){ const [dq,dr]=DIRS[i]; const e=hx(q+dq,r+dr).sub(c).multiplyScalar(.5); const L=e.length(); const ux=e.x/L, uz=e.z/L;
      for(let a=.0;a<L;a+=.13) for(let b=-.16;b<=.161;b+=.107){ if(rnd()<.12) continue; const j=(rnd()-.5)*.03; pts.push([c.x+ux*a-uz*(b+j),c.z+uz*a+ux*(b+j)]); } } }
  const Q=new THREE.Quaternion(), S=new THREE.Vector3();
  const items=pts.map(([x,z])=>{ Q.setFromAxisAngle(new THREE.Vector3(0,1,0),rnd()*6); const k=.7+rnd()*.5; S.set(k,.6+rnd()*.8,k*(.8+rnd()*.3)); return {m:new THREE.Matrix4().compose(new THREE.Vector3(x,0,z),Q,S),c:new THREE.Color().setHSL(.07+rnd()*.03,.08+rnd()*.08,.26+rnd()*.12)}; });
  W.cobbles=cellInst(g,mat,items,{name:'cobbles',far:gf,farD:22}); W.cobbleCount=pts.length; }
// flowers in the squares and yards: tiny instanced heads in the warm palette (no bright primaries)
function buildFlowers(){ const g=new THREE.IcosahedronGeometry(.035,0); g.translate(0,.09,0); const stem=new THREE.CylinderGeometry(.006,.006,.09,3); stem.translate(0,.045,0);
  const pts=[]; for(const t of tiles.values()){ if(t.kind!=='town'&&!(t.kind==='wild'&&rnd()<.4)) continue; const k=key(t.q,t.r); if(road.has(k)||bTile.has(k)) continue; const c=hx(t.q,t.r);
    const n=t.kind==='town'?14:5; for(let i=0;i<n;i++){ const a=rnd()*6.28, rr=.2+Math.sqrt(rnd())*.66; pts.push([c.x+Math.cos(a)*rr,c.z+Math.sin(a)*rr]); } }
  const pal=['#e9d7a6','#d9a86a','#c97a5a','#efe3c8','#b98fb0','#e2b45a'];
  const items=pts.map(([x,z])=>{ const s=.8+rnd()*.6; return {m:new THREE.Matrix4().makeScale(s,s,s).setPosition(x,0,z),c:new THREE.Color(pal[(rnd()*pal.length)|0])}; });
  // heads: icosahedron up close, octahedron far; stems vanish past 24 units (sub-pixel)
  const gfar=new THREE.OctahedronGeometry(.04,0); gfar.translate(0,.09,0);
  cellInst(g,new THREE.MeshLambertMaterial({color:0xffffff,emissive:0x221408}),items,{name:'flowers',far:gfar,farD:22});
  cellInst(stem,new THREE.MeshLambertMaterial({color:0x56663a}),items.map(i=>({m:i.m})),{name:'stems',lod:d=>d<24?1:0}); W.flowerCount=pts.length; }

// ---------- textures ----------
export function radial(c,soft=.35){ const cv=document.createElement('canvas'); cv.width=cv.height=128; const x=cv.getContext('2d'); const g=x.createRadialGradient(64,64,0,64,64,64); g.addColorStop(0,c); g.addColorStop(soft,c+'88'); g.addColorStop(1,c+'00'); x.fillStyle=g; x.fillRect(0,0,128,128); const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t; }
const softT=radial('#ffffff',.25);

// ---------- lanterns (unlit at dusk until the Lamplighter passes) ----------
export const LAMPC={ warm:C('#b8ffe4'), coral:C('#ff6b6b'), ice:C('#a8d8ff'), mint:C('#7cf0c4') };
function buildLamps(){
  const spots=[[-4,1,.55,-.55],[-3,1,.6,.55],[-2,1,-.1,-.7],[-1,1,.62,.4],[0,1,-.55,.5],[1,0,.6,-.45],[1,-1,-.6,-.35],[2,-2,.55,.5],[2,-3,-.5,.5],[-1,0,-.6,.3],[-2,-1,.5,-.5],[-3,2,.65,.45],[-2,3,.6,.5],[0,2,.55,-.5],[-5,1,.6,.8],[-1,3,-.5,.5],[3,-2,-.3,.85]];
  const postG=new THREE.CylinderGeometry(.03,.045,1.05,6), armG=new THREE.BoxGeometry(.22,.025,.025), capG=new THREE.ConeGeometry(.09,.09,4), cageG=new THREE.CylinderGeometry(.065,.05,.13,4,1,true);
  const poolG=new THREE.CircleGeometry(.8,24);
  // all ironwork + brass cages of every lantern baked into one vertex-coloured mesh; flames, halos and light pools are one instanced draw each
  const parts=[], IRON=C('#4a3a2e'), BRASS=C('#9a7a46'); const n=spots.length;
  const flames=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.045),new THREE.MeshBasicMaterial({color:0xffffff,fog:false}),n);
  const pools=new THREE.InstancedMesh(poolG.rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:softT,color:0xffffff,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}),n);
  const hp=new Float32Array(n*3), hc=new Float32Array(n*3), hs=new Float32Array(n);
  const add=(geo,col,m)=>{ const g=geo.clone().toNonIndexed(); g.applyMatrix4(m); for(const k of Object.keys(g.attributes)) if(k!=='position'&&k!=='normal') g.deleteAttribute(k); const cc=new Float32Array(g.attributes.position.count*3); for(let i=0;i<cc.length;i+=3){ cc[i]=col.r; cc[i+1]=col.g; cc[i+2]=col.b; } g.setAttribute('color',new THREE.BufferAttribute(cc,3)); parts.push(g); };
  const baseG=new THREE.CylinderGeometry(.07,.09,.08,6); const M=new THREE.Matrix4(), L=new THREE.Matrix4(), e=new THREE.Euler();
  const at=(g,x,y,z,ry=0)=>L.copy(g).multiply(new THREE.Matrix4().makeRotationY(ry).setPosition(x,y,z));
  spots.forEach(([q,r,dx,dz],i)=>{ const c=hx(q,r); const ry=rnd()*6; M.makeRotationY(ry).setPosition(c.x+dx,0,c.z+dz);
    add(postG,IRON,at(M,0,.52,0)); add(baseG,IRON,at(M,0,.04,0)); add(armG,IRON,at(M,.1,1.02,0)); add(cageG,BRASS,at(M,.19,.89,0)); add(capG,IRON,at(M,.19,.98,0,Math.PI/4));
    const fp=new THREE.Vector3(.19,.89,0).applyMatrix4(M); flames.setMatrixAt(i,new THREE.Matrix4().makeTranslation(fp.x,fp.y,fp.z)); flames.setColorAt(i,C('#3a2a1c'));
    const pp=new THREE.Vector3(.19,.015,0).applyMatrix4(M); pools.setMatrixAt(i,new THREE.Matrix4().makeTranslation(pp.x,pp.y,pp.z)); pools.setColorAt(i,C('#000'));
    hp.set([fp.x,fp.y,fp.z],i*3);
    W.lamps.push({i,lit:0,goal:0,col:LAMPC.warm.clone(),pos:new THREE.Vector3(c.x+dx,0,c.z+dz),ph:rnd()*6}); });
  const ironM=new THREE.Mesh(mergeGeometries(parts,false),new THREE.MeshLambertMaterial({vertexColors:true})); ironM.castShadow=true; ironM.name='lampIron';
  const hg=new THREE.BufferGeometry(); hg.setAttribute('position',new THREE.BufferAttribute(hp,3)); hg.setAttribute('color',new THREE.BufferAttribute(hc,3)); hg.setAttribute('size',new THREE.BufferAttribute(hs,1));
  const halos=new THREE.Points(hg,new THREE.ShaderMaterial({uniforms:{map:{value:softT},k:{value:500}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:'attribute float size; attribute vec3 color; uniform float k; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=size*k/-mv.z; }',
    fragmentShader:'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*t.rgb*t.a,1.); }'}));
  halos.frustumCulled=false; pools.frustumCulled=false; flames.frustumCulled=false;
  W.lampFx={flames,pools,halos}; W.scene.add(ironM,flames,pools,halos);
}
export function lampState(l,on,col){ l.goal=on?1:0; if(col) l.col.copy(col); }

// ---------- the ward (the oath as a boundary) ----------
function buildWard(){
  const pos=[],uv=[],idx=[]; let along=0; const H=1.35;
  for(const t of tiles.values()){ if(t.kind!=='town') continue; DIRS.forEach(([dq,dr],d)=>{ if(isTown(t.q+dq,t.r+dr)) return; const a=d*Math.PI/3;
    const p1=edgePt(t.q,t.r,a-Math.PI/6), p2=edgePt(t.q,t.r,a+Math.PI/6); const b=pos.length/3; const L=p1.distanceTo(p2);
    pos.push(p1.x,0,p1.z, p2.x,0,p2.z, p2.x,H,p2.z, p1.x,H,p1.z); uv.push(along,0, along+L,0, along+L,1, along,1); along+=L; idx.push(b,b+1,b+2,b,b+2,b+3); }); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx);
  const mat=new THREE.ShaderMaterial({ uniforms:U, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.CustomBlending, blendSrc:THREE.OneFactor, blendDst:THREE.OneMinusSrcAlphaFactor, blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.OneFactor,
    vertexShader:`varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader:`uniform float time,hit,frz,glow,refuse; uniform vec3 hitPos; varying vec2 vUv; varying vec3 vW;
      float hexl(vec2 p){ p*=vec2(1.,1.732); vec2 a=mod(p,vec2(2.,3.464))-vec2(1.,1.732); vec2 b=mod(p+vec2(1.,1.732),vec2(2.,3.464))-vec2(1.,1.732); vec2 c=dot(a,a)<dot(b,b)?a:b; c=abs(c); float e=max(c.x*.866+c.y*.5,c.y); return smoothstep(.84,.98,e); }
      void main(){ float y=vUv.y; float fall=pow(1.-y,2.6);
        float d=distance(vW.xz,hitPos.xz);
        float ring=exp(-pow((d-(1.-hit)*9.)*1.3,2.))*hit*1.4 + exp(-d*1.1)*hit*.12;
        float lat=hexl(vec2(vUv.x*2.4, y*2.4-time*.2))*(1.-y)*(.35+ring*2.);
        float run=exp(-pow((fract(vUv.x*.05-time*.06)-.5)*10.,2.))*.25*fall;
        float lip=exp(-pow(y*14.,2.))*.6;
        vec3 cm=vec3(.0,.93,.6), cc=vec3(1.,.42,.42), ci=vec3(.66,.85,1.);
        vec3 col=mix(cm,ci,frz); float rf=refuse*exp(-d*.07); col=mix(col,cc,clamp(max(ring*1.6+hit*exp(-d*.2)*.8,rf*1.4),0.,1.));
        float a=(fall*.07+lat*(.15+ring*1.8)+run*.5+lip*.35)*glow*(1.+frz*2.2)+ring*.28;
        a+=rf*(.16+fall*.22+lat*.4+lip*.3); float gf=rf*exp(-pow(d*.7,2.)); a+=gf*(.3*(1.-y*.6)+lat*.6); a=min(a,.32+rf*.3+gf*.25);
        // refusal: alpha > 0 so the veil tints toward coral instead of only adding light (which washes to pink-white)
        col=mix(col,vec3(1.,.3,.25),clamp(rf,0.,1.)); gl_FragColor=vec4(col*a*(1.-clamp(rf,0.,1.)*.25),min(.85,clamp(rf,0.,1.)*a*2.)); }` });
  const ward=new THREE.Mesh(g,mat); ward.renderOrder=5; W.scene.add(ward); W.ward=ward;
  // gate: two stone pillars and a hanging seal
  const a=GATE.dir*Math.PI/3; const p1=edgePt(GATE.q,GATE.r,a-Math.PI/6), p2=edgePt(GATE.q,GATE.r,a+Math.PI/6); W.gatePos=p1.clone().add(p2).multiplyScalar(.5);
  const stone=new THREE.MeshLambertMaterial({color:0xa59a88});
  W.gateCaps=[]; [p1,p2].forEach(p=>{ const c=new THREE.Mesh(new THREE.BoxGeometry(.24,1.45,.24),stone); c.position.set(p.x,.72,p.z); c.castShadow=true; W.scene.add(c);
    const top=new THREE.Mesh(new THREE.BoxGeometry(.32,.08,.32),stone); top.position.set(p.x,1.48,p.z); W.scene.add(top);
    const cap=new THREE.Mesh(new THREE.OctahedronGeometry(.1),new THREE.MeshBasicMaterial({color:0x00ec97,fog:false})); cap.position.set(p.x,1.64,p.z); W.scene.add(cap); W.gateCaps.push(cap); });
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(.14,.12,p1.distanceTo(p2)+.3),stone); lintel.position.set(W.gatePos.x,1.42,W.gatePos.z); lintel.lookAt(p2.x,1.42,p2.z); W.scene.add(lintel);
}

// ---------- Ferry: jetty, posts, boat with mast + lantern, a ferryman stands on it ----------
function buildFerry(){
  const s=SHOPS.ferry; const a=hx(s.q,s.r), rv=hx(4,-2), far=hx(5,-2);
  const J=W.jetty; J.home=a.clone().lerp(rv,.7).setY(-.06); J.mid=rv.clone().lerp(far,.4).setY(-.06); J.far=rv.clone().lerp(far,.86).setY(-.06); J.stand=a.clone().lerp(rv,.42).setY(0);
  const wood=new THREE.MeshLambertMaterial({color:0x7a5236}), dark=new THREE.MeshLambertMaterial({color:0x4b3324});
  const dir=rv.clone().sub(a).setY(0).normalize(); const side=new THREE.Vector3(-dir.z,0,dir.x);
  // jetty planks and posts: baked into one mesh per wood tone (2 draws, was 11)
  { const JW=[], JD=[], o=new THREE.Object3D();
    for(let i=0;i<7;i++){ const p=a.clone().lerp(rv,.38+i*.045); o.position.set(p.x,.04,p.z); o.lookAt(p.x+side.x,.04,p.z+side.z); o.updateMatrix(); (i%2?JW:JD).push(new THREE.BoxGeometry(.16,.05,.62).applyMatrix4(o.matrix)); }
    for(let i=0;i<4;i++){ const p=a.clone().lerp(rv,.42+.1*(i>>1)).addScaledVector(side,(i%2?1:-1)*.33); JD.push(new THREE.CylinderGeometry(.04,.045,.55,6).toNonIndexed().translate(p.x,-.05,p.z)); }
    JD.forEach((g,i)=>{ if(g.index) JD[i]=g.toNonIndexed(); }); JW.forEach((g,i)=>{ JW[i]=g.toNonIndexed(); });
    [[JW,wood],[JD,dark]].forEach(([G,m])=>{ const j=new THREE.Mesh(mergeGeometries(G,false),m); j.castShadow=j.receiveShadow=true; j.name='jetty'; W.scene.add(j); }); }
  const b=W.boat=new THREE.Group(); const hull=new THREE.Mesh(new THREE.CylinderGeometry(.36,.24,.22,8,1,false),wood); hull.scale.set(2.0,1,.85); hull.castShadow=true; hull.userData.dynCast=true; b.add(hull);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.36,.025,4,16),dark); rim.rotation.x=Math.PI/2; rim.scale.set(2.0,.85,1); rim.position.y=.11; b.add(rim);
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.022,.026,1.05,5),dark); mast.position.set(.15,.6,0); b.add(mast);
  const sailG=new THREE.PlaneGeometry(.5,.62,4,4); sailG.translate(.25,0,0); const sail=new THREE.Mesh(sailG,new THREE.MeshLambertMaterial({color:0xe9dcc0,side:THREE.DoubleSide})); sail.position.set(.17,.72,0); b.add(sail); b.userData.sail=sail;
  const lan=new THREE.Sprite(new THREE.SpriteMaterial({map:softT,color:LAMPC.warm,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false})); lan.position.set(-.55,.42,0); lan.scale.setScalar(.6); b.add(lan); b.userData.lan=lan;
  const lpost=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.32,4),dark); lpost.position.set(-.55,.24,0); b.add(lpost);
  b.position.copy(J.home); b.lookAt(far.x,J.home.y,far.z); b.rotateY(-Math.PI/2); W.scene.add(b); b.userData.goal=0; b.userData.dir=b.rotation.y;
}
// ZEC drop: a gold coin rises off the boat, then sinks into a shielding mist (the amount stays hidden). Drawn on a canvas, no download.
const zec={t:-1,p:new THREE.Vector3()};
function buildZec(){ const cv=document.createElement('canvas'); cv.width=cv.height=96; const x=cv.getContext('2d');
  x.fillStyle='#f4b728'; x.beginPath(); x.arc(48,48,44,0,7); x.fill(); x.strokeStyle='#8a5a12'; x.lineWidth=5; x.beginPath(); x.arc(48,48,36,0,7); x.stroke();
  x.fillStyle='#3a2508'; x.font='bold 50px sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillText('Z',48,51);
  zec.coin=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthWrite:false,fog:false})); zec.coin.visible=false; W.scene.add(zec.coin);
  zec.mist=new THREE.Sprite(new THREE.SpriteMaterial({map:softT,color:0xcfd8e8,transparent:true,depthWrite:false})); zec.mist.visible=false; W.scene.add(zec.mist); }
export function zecDrop(p){ if(!zec.coin) return; zec.p.copy(p); zec.t=0; }
function updZec(dt){ if(zec.t<0) return; zec.t+=dt; const t=zec.t, c=zec.coin, m=zec.mist;
  if(t>3.4){ zec.t=-1; c.visible=m.visible=false; return; }
  const up=Math.min(1,t/1.1), sink=Math.max(0,(t-1.5)/1.1); c.visible=sink<1; c.position.copy(zec.p).setY(zec.p.y+.25+up*.7-sink*.35); c.scale.setScalar(.5*(1-sink*.9)); c.material.rotation=Math.sin(t*6)*.25;
  c.material.opacity=1-sink; m.visible=t>1.2; const k=Math.max(0,t-1.2); m.position.copy(zec.p).setY(zec.p.y+.75); m.scale.setScalar(.4+k*.9); m.material.opacity=Math.min(.75,k*1.5)*(1-Math.max(0,(t-2.4)));
}
// Vault Arena: a wire dome that takes hits and never breaks
let dome, sparks=[];
function buildArena(){ const p=hx(SHOPS.arena.q,SHOPS.arena.r);
  dome=new THREE.Mesh(new THREE.IcosahedronGeometry(1.25,2),new THREE.MeshBasicMaterial({color:0x00ec97,wireframe:true,transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
  dome.position.set(p.x,.1,p.z); dome.scale.y=.78; W.scene.add(dome);
  for(let i=0;i<5;i++){ const s=new THREE.Sprite(new THREE.SpriteMaterial({map:softT,color:0xff8a6b,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false})); s.scale.setScalar(.35); s.visible=false; W.scene.add(s); sparks.push({s,t:-1,from:new THREE.Vector3(),to:new THREE.Vector3()}); } }
// soft puffs (smoke, mist) as one Points draw per system instead of one Sprite each. Each puff is a light proxy with the
// Sprite fields the update code uses (position, scale.setScalar, material.opacity/color, userData); flushPuffs() writes them.
const puffSystems=[];
function puffs(n,map,col){ const g=new THREE.BufferGeometry(), P=new Float32Array(n*3), Cc=new Float32Array(n*4), Sz=new Float32Array(n);
  g.setAttribute('position',new THREE.BufferAttribute(P,3)); g.setAttribute('color',new THREE.BufferAttribute(Cc,4)); g.setAttribute('size',new THREE.BufferAttribute(Sz,1));
  const m=new THREE.ShaderMaterial({ uniforms:{t:{value:map},k:{value:400}}, transparent:true, depthWrite:false,
    vertexShader:`attribute float size; attribute vec4 color; uniform float k; varying vec4 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*k/max(.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader:`uniform sampler2D t; varying vec4 vC; void main(){ vec4 c=texture2D(t,gl_PointCoord); gl_FragColor=vec4(vC.rgb*c.rgb,c.a*vC.a); }` });
  const pts=new THREE.Points(g,m); pts.frustumCulled=false; W.scene.add(pts);
  const list=[...Array(n)].map(()=>{ const o={position:new THREE.Vector3(),userData:{},visible:true,sz:1,material:{opacity:1,color:new THREE.Color(col)}}; o.scale={setScalar:v=>{o.sz=v;}}; return o; });
  puffSystems.push({pts,list,P,Cc,Sz}); return list; }
function flushPuffs(){ const k=W.renderer.domElement.height/(2*Math.tan(W.camera.fov*Math.PI/360));
  for(const S of puffSystems){ S.pts.material.uniforms.k.value=k; S.list.forEach((o,i)=>{ o.position.toArray(S.P,i*3); const c=o.material.color; S.Cc.set([c.r,c.g,c.b,o.visible?o.material.opacity:0],i*4); S.Sz[i]=o.sz; });
    const a=S.pts.geometry.attributes; a.position.needsUpdate=a.color.needsUpdate=a.size.needsUpdate=true; } }
// mist curling round the bank
let mist=[];
function buildMist(){ const p=hx(SHOPS.bank.q,SHOPS.bank.r);
  const L=puffs(12,softT,0xe9e2d4); for(let i=0;i<12;i++){ const s=L[i]; s.material.opacity=0; s.userData={a:i/12*Math.PI*2,r:.8+rnd()*.5,y:.15+rnd()*.5,c:p}; s.scale.setScalar(1.1+rnd()*.8); mist.push(s); } }
// chimney smoke
let smoke=[];
function buildSmoke(){ const src=[[-4,0,.05,.55,-.15],[-1,-3,-.2,1.05,.1],[-3,-1,.3,.9,.0],[0,-4,.1,.65,.2],[-2,4,.0,.6,.1],[2,1,-.1,.6,.1]];
  const L=puffs(src.length*7,softT,0xcfc3b0); let n=0; src.forEach(([q,r,dx,y,dz],j)=>{ const c=hx(q,r); for(let i=0;i<7;i++){ const s=L[n++]; s.material.opacity=0; s.userData={o:new THREE.Vector3(c.x+dx,y,c.z+dz),ph:i/7+j*.13}; smoke.push(s); } }); }
// laundry: a line behind a few houses, shirts and sheets that lift in the wind (one instanced mesh; no random draws, so the rest of the town keeps its layout)
let wash=null; const washBase=[];
function buildLaundry(){ const CL=[0xe9e1cf,0x9fb7c9,0xd8a48f,0xc9c08a,0xf3ede2,0xa9c2a0,0xcf8f86,0xe2d6b8], wood=new THREE.MeshLambertMaterial({color:0x5a3d26}), rope=new THREE.LineBasicMaterial({color:0xd9cfb8});
  const hs=W.houses.filter((h,i)=>i%2===0).slice(0,LP?3:6); if(!hs.length) return; const n=hs.length*4;
  const cg=new THREE.PlaneGeometry(.2,.24); cg.translate(0,-.12,0); const cm=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
  wash=new THREE.InstancedMesh(cg,cm,n); wash.castShadow=true; wash.userData.dynCast=true; const col=new THREE.Color(); let k=0; const pg=new THREE.CylinderGeometry(.018,.022,.62,5); pg.translate(0,.31,0);
  hs.forEach((h,hi)=>{ const [dq,dr]=DIRS[h.dir]; const c=hx(h.q,h.r), f=hx(h.q+dq,h.r+dr).sub(c).setY(0).normalize(); const side=new THREE.Vector3(-f.z,0,f.x);
    const mid=c.clone().addScaledVector(f,-.72).addScaledVector(side,hi%2?.18:-.18); const a=mid.clone().addScaledVector(side,-.42), b=mid.clone().addScaledVector(side,.42);
    for(const e of [a,b]){ const p=new THREE.Mesh(pg,wood); p.position.copy(e); p.castShadow=true; W.scene.add(p); }
    const lg=new THREE.BufferGeometry().setFromPoints([a.clone().setY(.6),mid.clone().setY(.56),b.clone().setY(.6)]); W.scene.add(new THREE.Line(lg,rope));
    for(let j=0;j<4;j++){ const t=(j+.5)/4, p=a.clone().lerp(b,t); p.y=.6-Math.sin(t*Math.PI)*.04; washBase.push({p,yaw:Math.atan2(side.x,side.z)+Math.PI/2,ph:hi*1.7+j*.9,s:j%2?1:1.25});
      wash.setColorAt(k++,col.set(CL[(hi*3+j)%CL.length])); } });
  wash.instanceColor.needsUpdate=true; W.scene.add(wash); }
const wm=new THREE.Matrix4(), wq=new THREE.Quaternion(), we=new THREE.Euler(), wsv=new THREE.Vector3();
function tickLaundry(T){ if(!wash) return; washBase.forEach((w,i)=>{ const gust=.25+.2*Math.sin(T*.37+w.ph*.3); we.set(Math.sin(T*1.9+w.ph)*gust+.12,w.yaw,0,'YXZ'); wq.setFromEuler(we); wsv.set(w.s,1,1); wm.compose(w.p,wq,wsv); wash.setMatrixAt(i,wm); }); wash.instanceMatrix.needsUpdate=true; }
// birds: a loose flock that circles the bell tower and the shore
let birds=[];
function buildBirds(){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.06, -.22,0,-.02, 0,0,-.05,  0,0,.06, .22,0,-.02, 0,0,-.05],3));
  const m=new THREE.MeshBasicMaterial({color:0x2a1d14,side:THREE.DoubleSide});
  for(let i=0;i<9;i++){ const b=new THREE.Mesh(g.clone(),m); b.userData={r:6+rnd()*5,h:4+rnd()*2.5,sp:.18+rnd()*.08,ph:rnd()*6,fl:7+rnd()*3,c:hx(-1,-1)}; W.scene.add(b); birds.push(b); } }
function buildFireflies(){ const n=LP?40:90, a=new Float32Array(n*3); for(let i=0;i<n;i++){ const t=[...tiles.values()][(rnd()*tiles.size)|0]; const p=hx(t.q,t.r); a[i*3]=p.x+(rnd()-.5)*1.6; a[i*3+1]=.25+rnd()*1.2; a[i*3+2]=p.z+(rnd()-.5)*1.6; }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(a,3)); fireflyMat=new THREE.PointsMaterial({color:0xffd58a,map:softT,size:.16,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
  flies=new THREE.Points(g,fireflyMat); flies.userData.base=a.slice(); W.scene.add(flies); }
// Town Hall bell (swings on the curfew)
function buildBell(){ const p=hx(SHOPS.hall.q,SHOPS.hall.r); const piv=new THREE.Group(); piv.position.set(p.x,2.55,p.z); const bell=new THREE.Mesh(new THREE.CylinderGeometry(.06,.16,.2,10,1,true),new THREE.MeshLambertMaterial({color:0xc9a45c,side:THREE.DoubleSide})); bell.position.y=-.12; piv.add(bell);
  const frame=new THREE.Mesh(new THREE.BoxGeometry(.42,.04,.06),new THREE.MeshLambertMaterial({color:0x4b3324})); piv.add(frame); W.scene.add(piv); W.bell=piv; W.bell.userData.sw=0; }
// the oath plaque beside the House door (brass, lit when the oath holds)
function buildPlaque(){ const s=SHOPS.house; const c=hx(s.q,s.r).lerp(hx(...s.door),.5); const m=new THREE.Mesh(new THREE.BoxGeometry(.26,.32,.03),new THREE.MeshLambertMaterial({color:0xc9a45c,emissive:0x3a2a10}));
  const post=new THREE.Mesh(new THREE.BoxGeometry(.05,.5,.05),new THREE.MeshLambertMaterial({color:0x4b3324})); post.position.set(c.x+.35,.25,c.z); m.position.set(c.x+.35,.62,c.z); m.lookAt(hx(...s.door).x+1,.62,hx(...s.door).z+1); W.scene.add(post,m); W.plaque=m; }

// ---------- post chain: render → half-res bloom → ink outline + tilt-shift + grade + vignette + grain ----------
function buildPost(){
  const rt=new THREE.WebGLRenderTarget(innerWidth,innerHeight,{type:THREE.HalfFloatType}); rt.depthTexture=new THREE.DepthTexture(innerWidth,innerHeight); rt.depthTexture.type=THREE.UnsignedIntType;
  // hand-rolled chain (no ping-pong, so the depth texture is never bound while its own framebuffer is written)
  const pr=W.renderer.getPixelRatio(); rt.setSize(innerWidth*pr,innerHeight*pr); const post=new THREE.WebGLRenderTarget(innerWidth*pr,innerHeight*pr,{type:THREE.HalfFloatType,depthBuffer:false});
  W.sceneRT=rt; W.postRT=post; const comp=W.composer={ passes:[], addPass(p){ this.passes.push(p); }, setSize(w,h){ const pr=W.renderer.getPixelRatio(); rt.setSize(w*pr,h*pr); post.setSize(w*pr,h*pr); this.passes.forEach(p=>p.setSize(w*pr,h*pr)); } };
  const bloom=W.bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth/2,innerHeight/2),.55,.5,.82); comp.addPass(bloom); W.outp=new OutputPass();
  const fin=W.fin=new ShaderPass({ uniforms:{ tDiffuse:{value:null}, tDepth:{value:null}, res:{value:new THREE.Vector2(innerWidth,innerHeight)}, cn:{value:.3}, cf:{value:400}, con:{value:.32}, focus:{value:.55}, band:{value:.22}, tilt:{value:1}, ink:{value:C('#2a1d14')},
      lift:{value:C('#120806')}, sat:{value:.9}, frz:U.frz, time:U.time, vig:{value:.5}, hit:U.hit, pt:{value:0}, sh:{value:.05} },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform sampler2D tDiffuse,tDepth; uniform vec2 res; uniform float cn,cf,con,focus,band,tilt,sat,frz,time,vig,hit,pt,sh; uniform vec3 ink,lift; varying vec2 vUv;
      float ld(vec2 uv){ float z=texture2D(tDepth,uv).x; return cn*cf/((cf-cn)*z-cf)*-1.; }
      float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      void main(){ vec2 px=1./res;
        float bw=band*(1.+pt*.7); float b=smoothstep(0.,bw,abs(vUv.y-focus)-bw*.35)*tilt*(1.-pt*.55); vec3 c=vec3(0.); float wsum=0.;
        for(int i=0;i<9;i++){ float a=float(i)*2.39996; float r=sqrt(float(i)/9.)*b*3.2; vec2 o=vec2(cos(a),sin(a))*r*px*1.6; c+=texture2D(tDiffuse,vUv+o).rgb; wsum+=1.; } c/=wsum;
        float d0=ld(vUv); float dx=ld(vUv+vec2(px.x,0.))-ld(vUv-vec2(px.x,0.)); float dy=ld(vUv+vec2(0.,px.y))-ld(vUv-vec2(0.,px.y));
        float e=sqrt(dx*dx+dy*dy)/max(d0,1.); float edge=smoothstep(.03,.08,e)*(1.-smoothstep(45.,110.,d0))*(1.-b*.7);
        c=mix(c,ink*(.6+.4*c),edge*.55);
        float l=dot(c,vec3(.299,.587,.114)); c=mix(vec3(l),c,sat*(1.-frz*.45)); c=mix(c,c*vec3(.85,.95,1.08)+vec3(.04,.07,.1),frz*.6);
        c=clamp(c,0.,1.); c=pow(c,vec3(1.-sh-pt*.04)); c=mix(c,c*c*(3.-2.*c),con*(1.-pt*.25)); c=c*(1.-lift)+lift; c=mix(c,c*vec3(1.,.82,.8),hit*.18);
        vec2 q=vUv-.5; c*=mix(1.,smoothstep(.95,.25,length(q*vec2(1.,.8))),vig*.7*(1.-pt*.55));
        c+=(h(vUv*res+fract(time))-.5)*.018;
        gl_FragColor=vec4(c,1.); }` });
  comp.addPass(fin); comp.addPass(W.outp);
}

// ---------- update ----------
const tmp=new THREE.Vector3();
export function setTod(t){ W.tod=t; }
// shadows: the sun never moves at a given time of day, so the static town is drawn into the shadow map once ("static" mode)
// and only re-drawn when the light changes. Moving casters (characters, boat, sails, sign boards) are flagged userData.dynCast:
// in static mode they rely on their contact shadow; "dynamic" mode re-renders the map every frame and includes them.
export function setShadowMode(dyn){ const r=W.renderer; if(!r.shadowMap.enabled) return; W.dynShadow=dyn; W.scene.traverse(m=>{ if(m.userData.dynCast) m.castShadow=dyn; }); r.shadowMap.autoUpdate=dyn; r.shadowMap.needsUpdate=true; }
let lastElev=null;
export function update(dt){ const T=clock.T; U.time.value=T;
  const K=mixK(W.tod);
  U.frz.value=W.frz; U.wind.value=1-W.frz*.95;
  // sun direction from elevation; azimuth from the south-west so shadows fall toward the camera's right
  W.renderer.toneMappingExposure=K.expo; const el=Math.round(K.elev*80)/80, az=-2.25; /* quantised: a moving sun re-draws the static shadow map in steps, not every frame */ if(el!==lastElev){ lastElev=el; W.renderer.shadowMap.needsUpdate=true; } const sd=new THREE.Vector3(Math.cos(el)*Math.cos(az),Math.sin(el),Math.cos(el)*Math.sin(az)); sun.position.copy(sd).multiplyScalar(50); sun.target.position.set(0,0,0);
  sun.color.copy(K.sun).lerp(ICE,W.frz*.6); sun.intensity=K.sunI*(1-W.frz*.35); hemi.color.copy(K.hemiS).lerp(ICE,W.frz*.5); hemi.groundColor.copy(K.hemiG); hemi.intensity=K.hemiI;
  const su=sky.material.uniforms; su.top.value.copy(K.top).lerp(C('#9fb7c6'),W.frz*.5); su.mid.value.copy(K.mid).lerp(ICE,W.frz*.6); su.hor.value.copy(K.hor).lerp(ICE,W.frz*.7); su.sunDir.value.copy(sd); su.sunC.value.copy(K.sun).multiplyScalar(1-W.frz);
  W.scene.fog.color.copy(K.fog).lerp(ICE,W.frz*.6);
  seaMat.uniforms.shallow.value.copy(K.sea); seaMat.uniforms.deep.value.copy(K.deep); seaMat.uniforms.sunC.value.copy(K.sun).multiplyScalar(.6);
  seaMat.uniforms.fogColor.value.copy(W.scene.fog.color); seaMat.uniforms.fogNear.value=W.scene.fog.near; seaMat.uniforms.fogFar.value=W.scene.fog.far;
  if(W.fin){ const u=W.fin.uniforms; u.lift.value.copy(K.lift); u.sat.value=K.sat; u.sh.value=K.sh; u.pt.value=W.camera.aspect<.8?1:0; }
  W.lampAmb=K.lamp; { const wi=K.lamp*1.1*(1-W.frz*.7); for(const m of W.winMats) m.emissiveIntensity=wi; }
  // lanterns
  if(W.lampFx){ const {flames,pools,halos}=W.lampFx, hc=halos.geometry.attributes.color, hs=halos.geometry.attributes.size; const tc=new THREE.Color();
    halos.material.uniforms.k.value=W.renderer.domElement.height/(2*Math.tan(W.camera.fov*Math.PI/360));
    for(const l of W.lamps){ l.lit+=(l.goal-l.lit)*Math.min(1,dt*3.5); const fl=1+.07*Math.sin(T*9+l.ph)+.04*Math.sin(T*23+l.ph*2); const k=l.lit*(.35+.65*K.lamp)*fl;
      const col=l.col.clone().lerp(LAMPC.ice,W.frz); tc.copy(col).multiplyScalar(k*.5); hc.setXYZ(l.i,tc.r,tc.g,tc.b); hs.setX(l.i,.38+k*.3+(l.flare||0)*.6);
      tc.copy(col).multiplyScalar(k*.2); pools.setColorAt(l.i,tc); tc.copy(col).multiplyScalar(.25+l.lit*2.4); flames.setColorAt(l.i,tc); }
    hc.needsUpdate=hs.needsUpdate=true; pools.instanceColor.needsUpdate=true; flames.instanceColor.needsUpdate=true; }
  // fireflies
  const fa=flies.geometry.attributes.position.array,fb=flies.userData.base; for(let i=0;i<fa.length;i+=3){ fa[i]=fb[i]+Math.sin(T*.5+i)*.35; fa[i+1]=fb[i+1]+Math.sin(T*.9+i*.7)*.22; fa[i+2]=fb[i+2]+Math.cos(T*.43+i)*.35; } flies.geometry.attributes.position.needsUpdate=true; fireflyMat.opacity=K.fly*(1-W.frz)*(.65+.35*Math.sin(T*3));
  // clouds drift
  clouds.forEach(o=>{ o.rotation.y=-T*.006; o.material.color.copy(K.hor).lerp(C('#e8eef6'),.55).lerp(ICE,W.frz*.5); });
  // smoke rises unless frozen
  smoke.forEach(s=>{ const u=s.userData; const ph=(T*.12*(1-W.frz*.97)+u.ph)%1; s.position.set(u.o.x+Math.sin(ph*4+u.ph*9)*.12+ph*.5,u.o.y+ph*1.8,u.o.z-ph*.25); s.scale.setScalar(.18+ph*.7); s.material.opacity=Math.sin(ph*Math.PI)*.38; s.material.color.copy(K.fog).lerp(C('#d5dbe4'),.5); });
  tickLaundry(T*(1-W.frz*.9));
  // birds
  birds.forEach(b=>{ const u=b.userData; const a=u.ph+T*u.sp*(1-W.frz); b.position.set(u.c.x+Math.cos(a)*u.r,u.h+Math.sin(a*2.3)*.4,u.c.z+Math.sin(a)*u.r*.7); b.rotation.set(0,-a,Math.sin(a)*.2); const fl=Math.sin(T*u.fl+u.ph)*(1-W.frz); const p=b.geometry.attributes.position; p.setY(1,fl*.09); p.setY(4,fl*.09); p.needsUpdate=true; });
  // mist
  mist.forEach(s=>{ const u=s.userData; const a=u.a+T*.15*(1-W.frz); s.position.set(u.c.x+Math.cos(a)*u.r*1.2,u.y+Math.sin(T*.6+u.a)*.12,u.c.z+Math.sin(a)*u.r); s.material.opacity=.13+(W.mist||0)*.35; });
  // ward
  updZec(dt);
  W.hit=Math.max(0,W.hit-dt*.5); U.hit.value=W.hit; W.refuse=Math.max(0,(W.refuse||0)-dt*.3); U.refuse.value=Math.min(1,W.refuse); U.glow.value=.55+W.frz*.4;
  W.gateCaps.forEach(c=>c.material.color.set(W.hit>.08||W.refuse>.15?0xff6b6b:W.frz>.5?0xa8d8ff:0x00ec97));
  // boat
  const b=W.boat, bu=b.userData; const goal=[W.jetty.home,W.jetty.mid,W.jetty.far][bu.goal]; tmp.copy(goal).sub(b.position); const dl=tmp.length(); b.position.addScaledVector(tmp,Math.min(1,dt*.55)*(1-W.frz)); b.position.y=-.06+Math.sin(T*2)*.025*(1-W.frz); b.rotation.z=Math.sin(T*1.5)*.04*(1-W.frz);
  bu.sail.scale.x=1+Math.sin(T*1.7)*.05*(1-W.frz)+Math.min(dl,1)*.12; bu.lan.material.color.copy(LAMPC.warm).lerp(LAMPC.ice,W.frz); bu.lan.material.opacity=.4+K.lamp*.6;
  // arena
  dome.rotation.y=T*.08*(1-W.frz); W.domeHit=Math.max(0,(W.domeHit||0)-dt*1.8); dome.material.opacity=.16+W.domeHit*.45; dome.material.color.set(W.domeHit>.1?0xff8a6b:W.frz>.5?0xa8d8ff:0x00ec97);
  sparks.forEach(sp=>{ if(sp.t<0){ sp.s.visible=false; return; } sp.t+=dt*1.3; const k=Math.min(1,sp.t); sp.s.position.lerpVectors(sp.from,sp.to,k); sp.s.position.y+=Math.sin(k*Math.PI)*1.1; sp.s.visible=true; if(k>=1){ sp.t=-1; W.domeHit=1; W.domeHits=(W.domeHits||0)+1; } });
  if(W.frz<.5 && Math.floor(T*.45)!==Math.floor((T-dt)*.45)) fireSpark();
  // bell + windmill
  if(W.bell){ W.bell.userData.sw=Math.max(0,W.bell.userData.sw-dt*.3); W.bell.rotation.z=Math.sin(T*5)*.45*W.bell.userData.sw; }
  updSigns(T,dt); updLod();
  if(W.windmill){ W.windmill.traverse(m=>{ if(m.isMesh && /blade|wing|sail|fan/i.test(m.name)) m.rotation.z+=dt*.6*(1-W.frz); }); }
  flushPuffs();
}
function fireSpark(){ const sp=sparks.find(s=>s.t<0); if(!sp) return; const c=hx(SHOPS.arena.q,SHOPS.arena.r); const a=rnd()*Math.PI*2; sp.from.set(c.x+Math.cos(a)*4,.5,c.z+Math.sin(a)*3); const d=sp.from.clone().sub(c).setY(0).normalize(); sp.to.set(c.x+d.x*1.2,.6,c.z+d.z*1.); sp.t=0; }
export function render(){ const r=W.renderer; W.updBlobs?.(); if(!W.composer){ r.setRenderTarget(null); r.render(W.scene,W.camera); return; }
  r.setRenderTarget(W.sceneRT); r.clear(); r.render(W.scene,W.camera);
  W.bloom.render(r,null,W.sceneRT,0,false);
  const f=W.fin.uniforms; f.tDepth.value=W.sceneRT.depthTexture; f.cn.value=W.camera.near; f.cf.value=W.camera.far; W.fin.renderToScreen=false; W.fin.render(r,W.postRT,W.sceneRT,0,false);
  W.outp.renderToScreen=true; W.outp.render(r,null,W.postRT,0,false); }
// the town's current sky and sea, so a shop room is lit and backed by the same evening (js/shops.js)
export function skyCols(){ const su=sky.material.uniforms; return { top:su.top.value.clone(), mid:su.mid.value.clone(), hor:su.hor.value.clone(), sea:seaMat.uniforms.shallow.value.clone(), deep:seaMat.uniforms.deep.value.clone(), fog:W.scene.fog.color.clone() }; }
