// Nearcarta characters: the Lamplighter (RobotExpressive, CC0) and the townsfolk (KayKit Adventurers, CC0).
// One Char class: skinned clone + mixer, locomotion with acceleration / turn-rate / lean, speed-synced gait,
// footsteps from foot contact, head look-at, one-shot emotes, and (for the Lamplighter) a hand lantern.
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, clock, rnd, hx, key, toHex, walkPath, walkable, isTown, RM } from './core.js';
import { W, load, LAMPC, lampState, radial } from './world.js';

const V=()=>new THREE.Vector3(), Q=()=>new THREE.Quaternion();
const tv=V(), tv2=V(), tq=Q(), tq2=Q(), UP=new THREE.Vector3(0,1,0);
export const chars=[];
export const SCL=1.24; // everyone reads bigger at street distance
// rim light: a warm fresnel edge so silhouettes separate from the street
export function rimify(root,col=0xffd7a0,k=.55){ root.traverse(m=>{ if(!m.isMesh||!m.material) return; const mm=m.material=m.material.clone(); const rc=new THREE.Color(col);
  mm.onBeforeCompile=sh=>{ sh.uniforms.rimC={value:rc}; sh.uniforms.rimK={value:k}; sh.fragmentShader='uniform vec3 rimC; uniform float rimK;\n'+sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n{ float fr=1.-clamp(dot(normalize(normal),normalize(vViewPosition)),0.,1.); totalEmissiveRadiance+=rimC*pow(fr,2.6)*rimK; }'); }; mm.customProgramCacheKey=()=>'rim'+k; }); }
export let onStep=()=>{}, onEvent=()=>{};
export function setHooks(h){ if(h.step) onStep=h.step; if(h.event) onEvent=h.event; }

// clip names per rig
const RIG={
  robot:{ idle:'Idle', walk:'Walking', run:'Running', yes:'Yes', no:'No', thumbs:'ThumbsUp', jump:'Jump', wave:'Wave', kneel:'Sitting', stand:'Standing', head:'Head', feet:['FootL','FootR'], walkV:.62, runV:1.7, alt:[] },
  kay:{ idle:'Idle', walk:'Walking_A', walk2:'Walking_B', run:'Running_A', block:'Blocking', blockIn:'Block', cheer:'Cheer', interact:'Interact', hit:'Hit_A', sit:'Sit_Floor_Idle', cast:'Spellcast_Raise', use:'Use_Item', head:'head', feet:['footl','footr'], walkV:.5, runV:1.35, alt:['interact','use'] },
};

// draw calls: a KayKit character is ~10 skinned parts on one skeleton with one texture. Bake each part's bind matrix into
// its vertices and merge the visible parts per material into a single SkinnedMesh (attached bind mode, identity bind matrix),
// remapping joints onto one shared bone list. Rigid props parented to hand bones stay as they are.
const SKA=['position','normal','uv','skinIndex','skinWeight'];
function mergeSkin(root){ const groups=new Map(); root.updateMatrixWorld(true);
  const shown=m=>{ for(let p=m;p;p=p.parent) if(!p.visible) return false; return true; };
  const boneOf=m=>{ for(let p=m.parent;p;p=p.parent) if(p.isBone) return p; return null; };
  let ref=null; root.traverse(m=>{ if(!ref&&m.isSkinnedMesh) ref=m.skeleton; });
  root.traverse(m=>{ if(!m.isMesh||!shown(m)||m.morphTargetInfluences) return; const k=m.material.map?m.material.map.uuid:m.material.uuid;
    if(m.isSkinnedMesh?SKA.every(a=>m.geometry.attributes[a]):(ref&&boneOf(m)&&ref.bones.includes(boneOf(m))&&m.geometry.attributes.uv&&m.geometry.attributes.normal)) (groups.get(k)||groups.set(k,[]).get(k)).push(m); });
  for(let parts of groups.values()){ const bones=[], inv=[], bi=new Map();
    // skinned parts first; quantized parts carry their own inverse-bind frames, so each part gets a correction C into the shared frame
    parts=parts.filter(m=>m.isSkinnedMesh).concat(parts.filter(m=>!m.isSkinnedMesh)); if(parts.length<2||!parts[0].isSkinnedMesh) continue;
    parts=parts.filter(m=>m.isSkinnedMesh||(()=>{ const b=boneOf(m); return ref.bones.includes(b); })());
    const geos=parts.map(m=>{ const g=new THREE.BufferGeometry(), src=m.geometry, n=src.attributes.position.count;
      let sk=m.skeleton, bm, rigid=null, map;
      if(m.isSkinnedMesh){ let C=new THREE.Matrix4(); const k0=sk.bones.findIndex(b=>bi.has(b)); if(k0>=0) C.copy(inv[bi.get(sk.bones[k0])]).invert().multiply(sk.boneInverses[k0]);
        const Ci=C.clone().invert(); bm=C.clone().multiply(m.bindMatrix);
        map=sk.bones.map((b,i)=>{ if(!bi.has(b)){ bi.set(b,bones.length); bones.push(b); inv.push(sk.boneInverses[i].clone().multiply(Ci)); } return bi.get(b); }); }
      else { // rigid prop under a hand/head/chest bone: one joint at weight 1, vertices moved into that joint's bind space
        const b=boneOf(m); if(!bi.has(b)){ bi.set(b,bones.length); bones.push(b); inv.push(ref.boneInverses[ref.bones.indexOf(b)].clone()); }
        rigid=0; map=[bi.get(b)]; bm=inv[bi.get(b)].clone().invert().multiply(new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(m.matrixWorld)); }
      const f=(a,sz)=>{ const A=src.attributes[a], o=new Float32Array(n*sz); for(let i=0;i<n;i++) for(let c=0;c<sz;c++) o[i*sz+c]=A.getComponent(i,c); return o; };
      const pos=new THREE.BufferAttribute(f('position',3),3), nor=new THREE.BufferAttribute(f('normal',3),3);
      pos.applyMatrix4(bm); nor.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(bm)); for(let i=0;i<n;i++){ tv.fromBufferAttribute(nor,i).normalize(); nor.setXYZ(i,tv.x,tv.y,tv.z); }
      const si=new Uint16Array(n*4), SI=src.attributes.skinIndex; for(let i=0;i<n;i++) for(let c=0;c<4;c++) si[i*4+c]=rigid!==null?map[rigid]:map[SI.getComponent(i,c)]||0;
      g.setAttribute('position',pos); g.setAttribute('normal',nor); g.setAttribute('uv',new THREE.BufferAttribute(f('uv',2),2));
      g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4)); g.setAttribute('skinWeight',new THREE.BufferAttribute(rigid!==null?new Float32Array(n*4).map((_,i)=>i%4?0:1):f('skinWeight',4),4));
      if(src.index){ const I=src.index, ix=new Uint32Array(I.count); for(let i=0;i<I.count;i++) ix[i]=I.getX(i); g.setIndex(new THREE.BufferAttribute(ix,1)); } else { g.setIndex([...Array(n).keys()]); }
      return g; });
    const mg=mergeGeometries(geos); if(!mg) continue; const p0=parts.find(m=>m.isSkinnedMesh)||parts[0]; if(!p0.isSkinnedMesh) continue;
    const sm=new THREE.SkinnedMesh(mg,p0.material); sm.name=p0.name+'+merged'; sm.castShadow=true; sm.userData.dynCast=true; sm.frustumCulled=false;
    sm.bind(new THREE.Skeleton(bones,inv),new THREE.Matrix4()); p0.parent.add(sm); parts.forEach(m=>m.removeFromParent()); }
}

export class Char{
  constructor(g,{rig='kay',scale=.22,name='',keep=null,hide=[],tint=null,voice=1,height=.62}={}){
    this.rig=RIG[rig]; this.kind=rig; this.name=name; this.voice=voice;
    const o=this.root=skClone(g.scene); if(rig==='kay') o.traverse(m=>{ if(m.isBone) m.name=m.name.replace(/_\d+$/,''); }); /* the 5 KayKit rigs share one glb: GLTFLoader suffixes their bones (hips_4), the clips target the bare names */ o.scale.setScalar(scale*SCL); height*=SCL; this.height=height;
    // gait: wv/rv are the clip reference speeds (stride x scale); walkSpd/runSpd are the actual brisk speeds
    this.wv=this.rig.walkV*SCL; this.rv=this.rig.runV*SCL; this.walkSpd=this.wv*1.42; this.runSpd=this.rv*1.2; this.obj=new THREE.Group(); this.obj.add(o); W.scene.add(this.obj);
    o.traverse(m=>{ if(m.isMesh){ m.castShadow=true; m.userData.dynCast=true; m.receiveShadow=false; m.frustumCulled=false;
        if(keep && /Shield|Sword|Axe|Knife|Crossbow|Throwable|Wand|Staff|Spellbook|Mug/.test(m.name) && !keep.includes(m.name)) m.visible=false;
        if(hide.includes(m.name)) m.visible=false;
        if(tint && m.material){ m.material=m.material.clone(); m.material.color.multiply(new THREE.Color(tint)); }
        if(m.morphTargetDictionary && 'Surprised' in m.morphTargetDictionary) this.face=m; }
      if(m.isBone){ if(m.name===this.rig.head) this.head=m; if(m.name===this.rig.feet[0]) this.fl=m; if(m.name===this.rig.feet[1]) this.fr=m; if(m.name==='Palm2L'||m.name==='handslotl') this.handL=m; if(m.name==='Palm2R'||m.name==='handslotr') this.handR=m; if(m.name==='UpperArmL'||m.name==='upperarml') this.armL=m; if(m.name==='UpperArmR'||m.name==='upperarmr') this.armR=m; } });
    if(rig==='kay') mergeSkin(o);
    this.mixer=new THREE.AnimationMixer(o); this.A={};
    for(const [k,n] of Object.entries(this.rig)){ if(typeof n!=='string') continue; const c=g.animations.find(a=>a.name===n); if(c) this.A[k]=this.mixer.clipAction(c); }
    for(const k of ['idle','walk','run']){ const a=this.A[k]; if(a){ a.play(); a.setEffectiveWeight(k==='idle'?1:0); } }
    this.A.idle && (this.A.idle.time=rnd()*2);
    // motion state
    this.pos=this.obj.position; this.yaw=0; this.yawV=0; this.speed=0; this.goalSpeed=0; this.maxSpeed=this.walkSpd; this.path=[]; this.pi=0; this.lean=0;
    this.look=null; this.lookW=0; this.emote=null; this.busy=0; this.lastFoot=[1,1]; this.footMin=[9,9]; this.stepCD=0; this.idleT=3+rnd()*4; this.bob=0;
    this.surp=0; this.tag=null; chars.push(this);
    // contact shadow (always on; real shadows add on top when enabled)
    const sh=new THREE.Mesh(new THREE.CircleGeometry(.17*SCL,20),new THREE.MeshBasicMaterial({map:radial('#1a120c',.15),transparent:true,opacity:.55,depthWrite:false})); sh.rotation.x=-Math.PI/2; sh.position.y=.012; sh.renderOrder=2; this.obj.add(sh); this.blob=sh;
  }
  place(x,z,yaw=0){ this.pos.set(x,0,z); this.yaw=yaw; this.obj.rotation.y=yaw; return this; }
  placeHex(q,r,yaw=0,dx=0,dz=0){ const p=hx(q,r); return this.place(p.x+dx,p.z+dz,yaw); }
  tile(){ return toHex(this.pos.x,this.pos.z); }
  top(){ return tv.set(this.pos.x,this.pos.y+this.height,this.pos.z); }
  headPos(out=V()){ if(this.head){ this.head.getWorldPosition(out); return out; } return out.copy(this.pos).setY(this.height*.85); }
  // route: list of Vector3 (world). Speeds: 'walk' | 'run'
  go(points,{run=false,arrive=null}={}){ this.path=points.map(p=>p.clone()); this.pi=0; this.maxSpeed=run?this.runSpd:this.walkSpd; this.goalSpeed=this.maxSpeed; this.onArrive=arrive; this.arrived=false; return this; }
  goHex(target,opt={}){ const from=this.tile(); const p=walkPath(from,target); if(!p){ return false; } const pts=p.slice(1).map(([q,r])=>hx(q,r));
    if(opt.end) pts.push(opt.end.clone()); if(!pts.length && opt.end) pts.push(opt.end.clone()); this.go(smooth([this.pos.clone(),...pts]).slice(1),opt); return true; }
  stop(){ this.path=[]; this.goalSpeed=0; }
  faceTo(p){ this.faceGoal=Math.atan2(p.x-this.pos.x,p.z-this.pos.z); }
  lookAt(target,w=1){ this.look=target; this.lookGoal=w; }
  // one-shot or held emote. name: key in A, or procedural 'shrug'
  play(name,{hold=false,fade=.22,rate=1,surprised=false}={}){
    if(name==='shrug'){ this.shrugT=0; onEvent('cloth',this); return this; }
    const a=this.A[name]; if(!a) return this; if(this.emote && this.emote!==a) this.emote.fadeOut(fade);
    a.reset(); a.setLoop(hold?THREE.LoopRepeat:THREE.LoopOnce,hold?Infinity:1); a.clampWhenFinished=true; a.timeScale=rate; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.emote=a; this.emoteHold=hold; this.emoteEnd=hold?Infinity:clock.T+a.getClip().duration/rate-fade; this.goalSpeed=0; if(surprised) this.surp=1; onEvent('emote:'+name,this); return this; }
  wave(){ return this.play(this.A.wave?'wave':this.A.cheer?'cheer':'interact',{rate:1.15}); }
  release(fade=.35){ if(this.emote){ this.emote.fadeOut(fade); this.emote=null; } }
  update(dt){
    const T=clock.T;
    // emote lifetime
    if(this.emote && !this.emoteHold && T>=this.emoteEnd){ this.emote.fadeOut(.3); this.emote=null; if(this.path.length&&this.pi<this.path.length) this.goalSpeed=this.maxSpeed; }
    // path following with arrival easing
    let want=0, tgtYaw=this.faceGoal??this.yaw;
    if(this.steer && this.steer.lengthSq()>.01){ this.path=[]; this.pi=0; this.onArrive=null; const m=Math.min(1,this.steer.length()); tgtYaw=Math.atan2(this.steer.x,this.steer.y); this.faceGoal=null; this.maxSpeed=this.steerRun?this.runSpd:this.walkSpd; want=this.maxSpeed*m; if(this.emote&&!this.emoteHold){ this.emote.fadeOut(.2); this.emote=null; } }
    else if(!this.emote && this.pi<this.path.length){ const p=this.path[this.pi]; tv.copy(p).sub(this.pos).setY(0); const d=tv.length(); const last=this.pi===this.path.length-1;
      if(d<(last?.1:.32)){ this.pi++; if(this.pi>=this.path.length){ this.arrived=true; const f=this.onArrive; this.onArrive=null; f&&f(this); } }
      else { tgtYaw=Math.atan2(tv.x,tv.z); this.faceGoal=null; const remain=d+(last?0:pathLen(this.path,this.pi)); want=Math.min(this.maxSpeed,Math.max(.12,remain*1.1)); } }
    // separation from other walkers
    if(this.speed>.05||want>0) for(const o of chars){ if(o===this) continue; tv2.copy(this.pos).sub(o.pos).setY(0); const d=tv2.length(); if(d>0&&d<.5){ this.pos.addScaledVector(tv2.normalize(),(0.5-d)*dt*2.5); } }
    // turn rate limit: slow down when the turn is big (no moonwalking)
    let dy=wrap(tgtYaw-this.yaw); const turnRate=this.speed>this.walkSpd*1.2?6:8; const step=Math.max(-turnRate*dt,Math.min(turnRate*dt,dy)); this.yaw+=step; this.yawV=step/Math.max(dt,1e-4);
    if(Math.abs(dy)>1.2) want*=.25;
    // acceleration (walk .6s to full, run .45s), braking faster
    const acc=want>this.speed?(this.maxSpeed>this.walkSpd?5:3.4):5.5; this.speed+=Math.max(-acc*dt,Math.min(acc*dt,want-this.speed));
    if(W.frz>.6 && !this.immune) this.speed*=Math.max(0,1-dt*6);
    { const ox=this.pos.x, oz=this.pos.z; this.pos.x+=Math.sin(this.yaw)*this.speed*dt; this.pos.z+=Math.cos(this.yaw)*this.speed*dt;
      // player steering: stay on streets and squares; slide along walls instead of sticking
      if(this.steer && this.speed>.01){ const ok=(x,z)=>{ const t=toHex(x,z); return walkable(...t); };
        if(!ok(this.pos.x,this.pos.z)){ if(ok(this.pos.x,oz)) this.pos.z=oz; else if(ok(ox,this.pos.z)) this.pos.x=ox; else { this.pos.x=ox; this.pos.z=oz; this.speed*=.5; } } } }
    // lean into turns and accel
    const leanT=Math.max(-.16,Math.min(.16,-this.yawV*this.speed*.09)); this.lean+=(leanT-this.lean)*Math.min(1,dt*6);
    this.obj.rotation.set(0,this.yaw,0); this.root.rotation.z=this.lean; this.root.rotation.x=Math.max(0,(want-this.speed))*.05;
    // gait blend: idle / walk / run by speed, clip rate synced to ground speed (foot planting)
    const s=this.speed, wv=this.wv, rv=this.rv, ws=this.walkSpd, rs=this.runSpd; let wi=0,ww=0,wr=0;
    if(s<.04) wi=1; else if(s<wv*.7){ const k=s/(wv*.7); wi=1-k; ww=k; } else if(s<=ws*1.05) ww=1; else { const k=Math.min(1,(s-ws*1.05)/(rs-ws*1.05)); ww=1-k; wr=k; }
    const em=this.emote?1:0, sc=1-em;
    this.A.idle?.setEffectiveWeight(wi*sc+(this.A.walk?0:ww)); this.A.walk?.setEffectiveWeight(ww*sc); this.A.run?.setEffectiveWeight(wr*sc);
    if(this.A.walk) this.A.walk.timeScale=Math.max(.35,s/wv); if(this.A.run) this.A.run.timeScale=Math.max(.6,s/rv);
    // idle variants: an occasional look-around / interact when standing still
    if(!this.emote && s<.03 && this.rig.alt.length && !this.noAlt){ this.idleT-=dt; if(this.idleT<0){ this.idleT=5+rnd()*6; const n=this.rig.alt[(rnd()*this.rig.alt.length)|0]; if(this.A[n]) this.play(n,{fade:.4}); } }
    if(this._bw){ for(const [b,q] of this._bw) b.quaternion.copy(q); } else this._bw=[this.head,this.armL,this.armR].filter(Boolean).map(b=>[b,b.quaternion.clone()]);
    const fr=W.frz>.6&&!this.immune?.08:1; this.mixer.update(dt*fr);
    for(const [b,q] of this._bw) q.copy(b.quaternion);
    // head look (applied after the animation, in world space, clamped)
    this.lookW+=((this.look?this.lookGoal:0)-this.lookW)*Math.min(1,dt*4);
    if(this.head && this.lookW>.01 && this.look){ const tgt=this.look.isVector3?this.look:this.look.headPos(tv2); this.head.getWorldPosition(tv); const dx=tgt.x-tv.x, dz=tgt.z-tv.z;
      let yaw=wrap(Math.atan2(dx,dz)-this.yaw); yaw=Math.max(-1.05,Math.min(1.05,yaw)); const pitch=Math.max(-.35,Math.min(.35,-Math.atan2(tgt.y-tv.y,Math.hypot(dx,dz))));
      this.head.getWorldQuaternion(tq); tq2.setFromAxisAngle(UP,yaw*this.lookW); const side=tv.set(Math.cos(this.yaw+yaw),0,-Math.sin(this.yaw+yaw)); const qp=Q().setFromAxisAngle(side,pitch*.6*this.lookW);
      const nw=qp.multiply(tq2).multiply(tq); const pq=Q(); this.head.parent.getWorldQuaternion(pq); this.head.quaternion.copy(pq.invert().multiply(nw)); }
    // talking: a nod rhythm on the head and a little lift of the chest, so you can see who speaks
    const tk=(this.talkUntil||0)>T?1:0; this.talkW=(this.talkW||0)+(tk-(this.talkW||0))*Math.min(1,dt*6);
    if(this.head && this.talkW>.01){ this.head.rotateX((Math.sin(T*8.5)*.07+Math.sin(T*3.1)*.04)*this.talkW); this.head.rotateZ(Math.sin(T*2.3)*.05*this.talkW); }
    if(this.armR && this.talkW>.01 && this.speed<.1 && !this.emote) this.armR.rotateZ(-(.18+.12*Math.sin(T*2.6))*this.talkW);
    // procedural shrug (robot has no shrug clip): shoulders up, palms out, head tilt
    if(this.shrugT!=null){ this.shrugT+=dt; const k=Math.sin(Math.min(1,this.shrugT/1.1)*Math.PI); if(this.armL){ this.armL.rotateZ(-k*.5); } if(this.armR){ this.armR.rotateZ(k*.5); } if(this.head) this.head.rotateZ(k*.18); if(this.shrugT>1.1) this.shrugT=null; }
    // face morphs
    if(this.face){ this.surp=Math.max(0,this.surp-dt*.6); const d=this.face.morphTargetDictionary, inf=this.face.morphTargetInfluences; inf[d.Surprised]=this.surp; if(d.Sad!=null) inf[d.Sad]+=((this.sad||0)-inf[d.Sad])*Math.min(1,dt*3); }
    // footsteps from foot contact: a foot bone dipping to its running minimum height
    if(this.fl&&this.fr){ [this.fl,this.fr].forEach((f,i)=>{ f.getWorldPosition(tv); const y=tv.y-this.pos.y; this.footMin[i]=Math.min(this.footMin[i]+dt*.02,y); const c=y<this.footMin[i]+.012;
        if(c && !this.lastFoot[i] && this.speed>.15 && this.stepCD<=0){ onStep(this,i,tv.clone()); this.stepCD=.18; } this.lastFoot[i]=c; }); this.stepCD-=dt; }
    this.blob.scale.setScalar(1+this.speed*.15); this.blob.material.opacity=.5*(1-Math.min(.6,(this.pos.y)*2));
    this.lantern && this.updLantern(dt);
  }
  // the Lamplighter's lantern: brass frame + glass + halo, hangs from the left palm on a spring
  addLantern(){ const g=new THREE.Group(); const brass=new THREE.MeshLambertMaterial({color:0xb88a46}); const top=new THREE.Mesh(new THREE.ConeGeometry(.05,.045,6),brass); top.position.y=.055; const base=new THREE.Mesh(new THREE.CylinderGeometry(.04,.045,.016,6),brass); base.position.y=-.045;
    const glass=new THREE.Mesh(new THREE.CylinderGeometry(.034,.034,.075,6),new THREE.MeshBasicMaterial({color:0xffc27a})); const ring=new THREE.Mesh(new THREE.TorusGeometry(.018,.004,4,10),brass); ring.position.y=.09;
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:radial('#ffffff',.18),color:0xffc27a,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.9})); halo.scale.setScalar(.6); const pl=new THREE.PointLight(0xffc27a,.8,2.2,1.8); pl.position.y=.02; g.add(pl);
    const pool=new THREE.Mesh(new THREE.CircleGeometry(.9,24),new THREE.MeshBasicMaterial({map:radial('#ffffff',.1),color:0xffc27a,transparent:true,opacity:.35,depthWrite:false,blending:THREE.AdditiveBlending})); pool.rotation.x=-Math.PI/2; pool.renderOrder=3; W.scene.add(pool);
    g.add(top,base,glass,ring,halo); W.scene.add(g); this.lantern={g,glass,halo,pool,pl,col:LAMPC.warm.clone(),goal:LAMPC.warm.clone(),vel:V(),off:V(),on:1}; return this; }
  lanternColor(name){ this.lantern.goal.copy(LAMPC[name]||LAMPC.warm); }
  updLantern(dt){ const L=this.lantern; const hand=this.handL||this.head; hand.getWorldPosition(tv); tv.y-=.07;
    // spring pendulum: lags behind hand motion
    tv2.copy(tv).sub(L.g.position); L.vel.addScaledVector(tv2,dt*120).multiplyScalar(Math.max(0,1-dt*14)); L.g.position.addScaledVector(L.vel,dt); if(L.g.position.distanceTo(tv)>.12||!L.init){ L.g.position.copy(tv); L.init=1; }
    L.g.rotation.z=Math.max(-.5,Math.min(.5,-L.vel.x*.8)); L.g.rotation.x=Math.max(-.5,Math.min(.5,L.vel.z*.8));
    L.col.lerp(L.goal,Math.min(1,dt*4)); const c=L.col.clone().lerp(LAMPC.ice,W.frz); const fl=1+.06*Math.sin(clock.T*11)+.03*Math.sin(clock.T*27);
    L.glass.material.color.copy(c).multiplyScalar(1.3*fl); L.halo.material.color.copy(c); L.halo.material.opacity=(.4+.3*(W.lampAmb??1))*fl*L.on; L.pool.material.color.copy(c); L.pool.material.opacity=.2*(.3+.7*(W.lampAmb??1))*L.on; L.pool.position.set(L.g.position.x,.02,L.g.position.z); L.pl.color.copy(c); L.pl.intensity=.42*fl*L.on;
    // light any street lamp within reach (only when it's the Lamplighter's job)
    if(this.lights) for(const l of W.lamps){ if(l.goal) continue; const d=Math.hypot(l.pos.x-this.pos.x,l.pos.z-this.pos.z); if(d<.95){ lampState(l,true,LAMPC.warm); onEvent('lamp',this,l); } } }
}
function wrap(a){ while(a>Math.PI) a-=Math.PI*2; while(a<-Math.PI) a+=Math.PI*2; return a; }
function pathLen(p,i){ let s=0; for(let k=i;k<p.length-1;k++) s+=p[k].distanceTo(p[k+1]); return s; }
// corner-cut a hex-centre path into a softer street line (chaikin, 2 passes, ends kept)
export function smooth(pts){ let p=pts; for(let n=0;n<2;n++){ if(p.length<3) break; const o=[p[0]]; for(let i=0;i<p.length-1;i++){ o.push(p[i].clone().lerp(p[i+1],.25), p[i].clone().lerp(p[i+1],.75)); } o.push(p[p.length-1]); p=o; } return p; }

// ---------- cast ----------
export const CAST={};
export async function buildCast(){
  const [robot,knight,hooded,barb,mage,rogue]=await Promise.all([P.has('rorig')?'../chars/RobotExpressive':'RobotExpressive','Knight','Rogue_Hooded','Barbarian','Mage','Rogue'].map(n=>load('chars9/'+n+'.glb').catch(()=>null)));
  const R=CAST.robot=new Char(robot,{rig:'robot',scale:.135,name:'Lamplighter',voice:1.25,height:.7}); R.addLantern(); R.lights=true; R.immune=false;
  // the Lamplighter's palette: brass body instead of the stock yellow, so it reads as a lantern-bearer, not a toy
  R.root.traverse(m=>{ if(m.isMesh&&m.material){ m.material=m.material.clone(); const c=m.material.color; const hsl={}; c.getHSL(hsl); if(hsl.s>.4&&hsl.h>.08&&hsl.h<.2) c.set(0xc9a066); } });
  // knights hold the ward gate, facing out: shield arm toward the road, shields up on a refusal
  const g=W.gatePos; const gd=new THREE.Vector3(1,0,0);
  CAST.knights=[0,1].map(i=>new Char(knight,{scale:.22,name:'Knight',keep:[i?'Round_Shield':'Badge_Shield','1H_Sword'],voice:.8,height:.62}).place(g.x-.3,g.z+(i?.6:-.6),-Math.PI/2));
  CAST.knights.forEach(k=>{ k.noAlt=true; k.guard=true; });
  // the hooded stranger waits just outside the gate
  CAST.stranger=new Char(hooded,{scale:.21,name:'Stranger',keep:[],voice:.7,height:.6}).place(g.x-1.2,g.z+.1,Math.PI/2); CAST.stranger.noAlt=true;
  // the ferryman on the jetty
  const J=W.jetty; CAST.ferryman=new Char(barb,{scale:.21,name:'Ferryman',keep:['Mug'],voice:.75,height:.62}).place(J.stand.x,J.stand.z,0); CAST.ferryman.noAlt=false;
  // council on the hall steps
  const hall=hx(-2,-2), hd=hx(...((await import('./core.js')).SHOPS.hall.door));
  CAST.council=[0,1,2].map(i=>{ const p=hall.clone().lerp(hd,.62); const s=new THREE.Vector3(-(hd.z-hall.z),0,hd.x-hall.x).normalize(); const c=new Char(mage,{scale:.18,name:'Council',keep:i===1?['2H_Staff']:['Spellbook'],voice:.9,height:.6}); c.place(p.x+s.x*(i-1)*.42,p.z+s.z*(i-1)*.42,Math.atan2(hd.x-hall.x,hd.z-hall.z)); c.noAlt=false; return c; });
  // wanderers: townsfolk who walk between places and stop to talk
  const wset=[[rogue,{scale:.2,name:'Courier',keep:[]}],[barb,{scale:.2,name:'Smith',keep:['Mug'],hide:['Barbarian_Hat']}],[mage,{scale:.17,name:'Scribe',keep:['Spellbook']}],[rogue,{scale:.2,name:'Walker',keep:[]}],[knight,{scale:.21,name:'Watch',keep:['1H_Sword'],hide:['Knight_Helmet']}],[barb,{scale:.2,name:'Miller',keep:[]}]];
  const spots=[[1,-1],[2,-2],[0,-2],[1,2],[-2,-1],[0,3],[2,0],[-1,-1]];
  CAST.wander=wset.filter(([g])=>g).map(([g,o],i)=>{ const c=new Char(g,{...o,height:.6}); const [q,r]=spots[i%spots.length]; c.placeHex(q,r,rnd()*6,(rnd()-.5)*.6,(rnd()-.5)*.6); c.wanderer=true; c.wT=1+rnd()*4; return c; });
  // shop keepers: one per shop, beside the door, each with its own look and prop. They wave when the Lamplighter comes close.
  const KEEP={ chronicle:[mage,{scale:.18,name:'Archivist',keep:['Spellbook_open'],tint:0xf0d9b0}], bank:[rogue,{scale:.2,name:'Banker',keep:[],tint:0xe8c890}],
    guard:[knight,{scale:.22,name:'Captain',keep:['Badge_Shield']}], arena:[barb,{scale:.21,name:'Arena marshal',keep:['2H_Axe'],hide:['Barbarian_Hat']}],
    house:[hooded,{scale:.2,name:'Housekeeper',keep:[],tint:0xf2c8a8}], toll:[knight,{scale:.21,name:'Toll warden',keep:['Round_Shield'],hide:['Knight_Helmet'],tint:0xffd0c0}], hall:[mage,{scale:.18,name:'Clerk',keep:[],hide:['Mage_Hat'],tint:0xd8e0c0}] };
  const { SHOPS }=await import('./core.js'); CAST.keepers={};
  for(const [id,[gk,o]] of Object.entries(KEEP)){ if(!gk||!SHOPS[id]) continue; const s=SHOPS[id], c0=hx(s.q,s.r), d=hx(...s.door); const out=d.clone().sub(c0).setY(0).normalize(); const side=new THREE.Vector3(-out.z,0,out.x);
    const p=c0.clone().lerp(d,.58).addScaledVector(side,.62); const k=new Char(gk,{...o,height:.6}); k.place(p.x,p.z,Math.atan2(out.x,out.z)); k.noAlt=false; k.keeper=id; k.home=k.yaw; k.waveCD=0; CAST.keepers[id]=k; }
  for(const c of chars) rimify(c.root, c===R?0xffe2b0:0xffd2a0, c===R?.75:.6);
  return CAST;
}
const TOWN=[[0,1],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[2,-1],[-2,1],[-2,0],[0,-2],[1,-3],[-1,-1],[2,0],[-3,1],[0,2],[-1,3],[1,1],[2,-2],[-3,2]];
const _fr=new THREE.Frustum(), _pm=new THREE.Matrix4(), _sp=new THREE.Sphere();
export function updateCast(dt){
  const R=CAST.robot;
  if(R&&CAST.keepers) for(const k of Object.values(CAST.keepers)){ const d=Math.hypot(k.pos.x-R.pos.x,k.pos.z-R.pos.z); k.waveCD-=dt;
    if(d<2.4){ k.lookAt(R,1); if(k.waveCD<=0&&!k.emote&&R.speed>.05){ k.wave(); k.waveCD=9; onEvent('emote:wave',k); } } else if(k.look){ k.lookAt(null); } }
  // frustum-cull each character as a whole (the merged skinned meshes have no reliable bounds of their own)
  const cam=W.camera; if(cam){ cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }
  for(const c of chars){ if(cam){ _sp.center.set(c.pos.x,c.pos.y+c.height*.5,c.pos.z); _sp.radius=c.height*.9; c.root.visible=_fr.intersectsSphere(_sp); } }
  for(const c of chars){ if(c.wanderer && !c.hold){ if(!c.path.length||c.pi>=c.path.length){ c.wT-=dt; if(c.wT<0&&!c.emote){ const t=TOWN[(rnd()*TOWN.length)|0]; if(walkable(...t)) c.goHex(t,{end:hx(...t).add(new THREE.Vector3((rnd()-.5)*.7,0,(rnd()-.5)*.7))}); c.wT=3+rnd()*6; } } } c.update(dt); }
}
