// Nearcarta — the town is the page. Boot → living town → (first visit) a 45 s story → free explore.
import { dressRoom, undressRoom } from './roomkit.js';
import * as THREE from 'three';
import { P, CAPTURE, RM, clock, run, tickRoutines, wait, hx, toHex, key, bTile, walkable, SHOPS, TX, txUrl } from './core.js';
import { W, LP, init, update, render, setTod, setProgress, lampState, LAMPC, setShadowMode } from './world.js';
import { buildCast, updateCast, CAST, setHooks, smooth, chars } from './chars.js';
import * as SP from './speech.js';
import { tickLife, setSky, hushLife } from './life.js';
import * as SL from './shops.js';
import { mountIntro } from './intro-dom.js';
import { beginEnter } from './room-lock.js';
import { icon } from '../d7/js/d7.js';
const $=s=>document.querySelector(s); const body=document.body; const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
window.__alog=[]; // audio event log (t in story seconds) for the offline video mix
let storyT0=0; // set before boot: a character cue during the cast build must not touch this before it exists

// ---------- fallback: no WebGL, or ?mode=2d ----------
// index.html picks the 2D path before this module loads (so 2D never downloads three.js); this covers a failed WebGL init.
// Any failure after boot (init throws, context lost, a blank first frame, single-digit fps) stops the 3D loop and shows the 2D town.
let stopped=false; const fallback=why=>{ if(stopped) return; stopped=true; window.__3dStop=why; return import('./fb.js').then(m=>m.fallback(why)); };

// ---------- sound: tiny WebAudio bank (off until the visitor turns it on) ----------
// d7 cues come from the D2_game copy (same bytes) that the D8 rooms also load, so the town fetches each file once
const SND={ allowed:'../D2_game/d7/assets/audio/allowed.ogg', refuse:'../D2_game/d7/assets/audio/refuse.ogg', freeze:'../D2_game/d7/assets/audio/freeze.ogg', send:'../D2_game/d7/assets/audio/send.ogg', water:'../D2_game/d7/assets/audio/water.ogg', click:'../D2_game/d7/assets/audio/ui-click.ogg', music:'../D2_game/d7/assets/audio/music-ambient.ogg',
  step0:'assets/audio9/footstep00.ogg', step1:'assets/audio9/footstep01.ogg', step2:'assets/audio9/footstep02.ogg', step3:'assets/audio9/footstep03.ogg', step4:'assets/audio9/footstep04.ogg',
  lamp:'assets/audio9/metalClick.ogg', glass:'assets/audio9/glass_001.ogg', cloth:'assets/audio9/cloth1.ogg', cloth2:'assets/audio9/cloth2.ogg', door:'assets/audio9/doorOpen_1.ogg', doorC:'assets/audio9/doorClose_1.ogg', page:'assets/audio9/bookFlip1.ogg', creak:'assets/audio9/creak1.ogg', latch:'assets/audio9/metalLatch.ogg' };
const A={ ctx:null, buf:{}, on:false, bed:null };
async function audioOn(){ if(!A.ctx){ A.ctx=new (window.AudioContext||window.webkitAudioContext)(); A.out=A.ctx.createGain(); A.out.gain.value=.9; A.out.connect(A.ctx.destination);
    await Promise.all(Object.entries(SND).map(async([k,u])=>{ try{ A.buf[k]=await A.ctx.decodeAudioData(await (await fetch(u)).arrayBuffer()); }catch(e){} })); }
  await A.ctx.resume(); A.on=true; if(!A.bed){ A.bed=loop('music',.16); loop('water',.1); } }
function loop(n,g){ const b=A.buf[n]; if(!b) return; const s=A.ctx.createBufferSource(), v=A.ctx.createGain(); s.buffer=b; s.loop=true; v.gain.value=g; s.connect(v).connect(A.out); s.start(); return v; }
function sfx(n,{g=1,rate=1,pan=0}={}){ __alog.push({t:+(clock.T-storyT0).toFixed(3),n,g,rate}); if(!A.on||!A.buf[n]) return; const s=A.ctx.createBufferSource(), v=A.ctx.createGain(); s.buffer=A.buf[n]; s.playbackRate.value=rate; v.gain.value=g;
window.__townSfx=n=>sfx(n,{g:.6}); /* D8 rooms play allowed/refuse cues through the town player: one player, one mute */
  const p=A.ctx.createStereoPanner?A.ctx.createStereoPanner():null; if(p){ p.pan.value=pan; s.connect(v).connect(p).connect(A.out); } else s.connect(v).connect(A.out); s.start(); }
// speech blip: a soft pitched tick per letter pair; pitch from the speaker's voice
SP.setBlip((voice,style,ch)=>{ const f=(style==='warn'?150:style==='think'?300:240)*voice*(1+((ch.charCodeAt(0)%5)-2)*.03); __alog.push({t:+(clock.T-storyT0).toFixed(3),n:'blip',f:+f.toFixed(1),g:style==='think'?.035:.05});
  if(!A.on) return; const o=A.ctx.createOscillator(), v=A.ctx.createGain(), t=A.ctx.currentTime; o.type='triangle'; o.frequency.value=f; v.gain.setValueAtTime(0,t); v.gain.linearRampToValueAtTime(style==='think'?.035:.05,t+.006); v.gain.exponentialRampToValueAtTime(.0001,t+.07); o.connect(v).connect(A.out); o.start(t); o.stop(t+.08); });
const camPan=p=>{ const v=p.clone().project(W.camera); return Math.max(-.8,Math.min(.8,v.x*.8)); };
setHooks({ step:(c,i,p)=>{ const d=W.camera.position.distanceTo(p); const g=Math.max(0,.55-d*.02)*(c===CAST.robot?1:.55); if(g<.03) return; sfx('step'+((clock.T*7|0)%5),{g,rate:(c===CAST.robot?1.15:.92)+(i?.04:-.03),pan:camPan(p)}); },
  event:(n,c,l)=>{ if(n==='lamp'){ sfx('lamp',{g:.5,rate:1.1,pan:camPan(l.pos)}); sfx('glass',{g:.18,rate:1.4}); flare(l); c.lookAt(l.pos.clone().setY(1.1),.8); setTimeoutSim(()=>c.lookAt(null),.9); } else if(n.startsWith('emote')) sfx(Math.random()<.5?'cloth':'cloth2',{g:.25}); } });

// ---------- sim-time timers (so capture is frame-exact) ----------
const timers=[]; function setTimeoutSim(f,s){ timers.push({t:clock.T+s,f}); }
function tickTimers(){ for(let i=timers.length-1;i>=0;i--) if(clock.T>=timers[i].t){ const f=timers[i].f; timers.splice(i,1); f(); } }
function flare(l){ l.flare=1; }

// ---------- boot ----------
setProgress(f=>{ $('#lbar').style.width=(f*100).toFixed(0)+'%'; const t=$('#ltxt'); if(t) t.textContent=f<.9?`Building the town · ${(f*100)|0}%`:'The town is open'; });
const cv=$('#c'); const t0=performance.now();
cv.addEventListener('webglcontextlost',e=>{ e.preventDefault(); console.error('[Nearcarta] WebGL context lost'); fallback('WebGL context lost'); });
try{ await init(cv); await buildCast(); }catch(e){ console.error(e); fallback('3D start failed: '+(e&&e.message||e)); throw e; }
const R=CAST.robot; window.world={}; window.W=W; window.CAST=CAST;
// shadows: captures and ?shadows=dynamic keep every caster live; the live page starts static (town shadows baked once) and upgrades once it holds ~50 fps
const SHM=P.get('shadows'); setShadowMode(CAPTURE?SHM!=='static':SHM==='dynamic');
gsap.ticker.remove(gsap.updateRoot); gsap.ticker.lagSmoothing(0);

// ---------- camera director (GSAP-driven blends between shot functions) ----------
const cam=W.camera; const D={ from:{p:V(),t:V(),f:30}, shot:null, k:1, cur:{p:V(26,22,26),t:V(0,0,0),f:30}, tw:null, shake:0 };
const SH={
  establish:()=>({p:V(5.2,6.4,12.6),t:V(-2.4,.2,.6),f:34}),
  pullback:()=>({p:V(9.5,9.2,15.5),t:V(-1,.2,-.4),f:32}),
  orbit:()=>{ const a=.42+Math.sin(clock.T*.035)*.5; return {p:V(-1+Math.sin(a)*13.5,7.6,Math.cos(a)*13.5),t:V(-1,.3,-.2),f:34}; },
  follow:(c,o=V(3.4,3.1,4.8))=>()=>({p:c.pos.clone().add(o),t:c.pos.clone().add(V(0,.35,0)),f:30}),
  close:(c,ang=.6,dist=2.1,h=.78,look=null)=>()=>{ const a=c.yaw+ang; const p=c.pos.clone().add(V(Math.sin(a)*dist,h,Math.cos(a)*dist)); const t=(look?look():c.pos.clone().add(V(0,.48,0))); return {p,t,f:26}; },
  fixed:(p,t,f=30)=>()=>({p:p.clone(),t:t.clone(),f}),
};
function shot(fn,dur=1.6,ease='power2.inOut'){ D.from={p:cam.position.clone(),t:D.cur.t.clone(),f:cam.fov}; D.shot=fn; D.k=0; D.tw&&D.tw.kill(); if(dur<=0||RM&&dur<1.2){ D.k=1; return; } D.tw=gsap.to(D,{k:1,duration:dur,ease}); }
function cut(fn){ D.shot=fn; D.k=1; D.tw&&D.tw.kill(); applyCam(1,true); }
let smoothT=null;
function applyCam(dt,snap){ if(!D.shot) return; const s=D.shot(); const e=D.k;
  const p=D.from.p.clone().lerp(s.p,e), t=D.from.t.clone().lerp(s.t,e), f=D.from.f+(s.f-D.from.f)*e;
  // follow shots: critically damped so the camera never jitters with the gait
  if(!snap && D.k>=1 && smoothT){ smoothT.p.lerp(p,Math.min(1,dt*3)); smoothT.t.lerp(t,Math.min(1,dt*3.5)); } else smoothT={p:p.clone(),t:t.clone()};
  cam.position.copy(smoothT.p); D.cur.t.copy(smoothT.t); cam.fov=f; cam.updateProjectionMatrix(); cam.lookAt(D.cur.t);
  if(W.fin){ const d=cam.position.distanceTo(D.cur.t); W.fin.uniforms.focus.value=.5; W.fin.uniforms.band.value=Math.min(.34,.1+d*.009); W.fin.uniforms.tilt.value=d<6?.55:1; } }
const letterbox=on=>body.classList.toggle('letterbox',on);
// shops with no room yet: still part of the town, but no pin, no door, no menu entry
const CLOSED=new Set([]); /* every door opens: Toll Bridge runs its real paid flow too */ const OPEN=Object.fromEntries(Object.entries(SHOPS).filter(([id])=>!CLOSED.has(id)));
const CHARTER=window.NEARCARTA_CHARTER||'/shops/vault/';
const ALIAS={chron:'chronicle',townhall:'hall',mistbank:'bank',guardhouse:'guard',vault:'house'};

function chron(k,label){ const tx=TX[k]; const li=document.createElement('li'); li.className=tx.cls; li.innerHTML='<i></i><span class="w"></span><a target="_blank" rel="noopener"></a>';
  li.querySelector('.w').textContent=label||tx.what; const a=li.querySelector('a'); a.href=txUrl(tx.h); a.textContent=tx.h.slice(0,6)+'…'+tx.h.slice(-4); a.title=tx.ev;
  const l=$('#clist'); $('#chron').hidden=false; l.prepend(li); while(l.children.length>3) l.lastChild.remove(); sfx('page',{g:.25}); }

// ---------- initial town state ----------
setTod(+(P.get('tod')??1));
const ROUTE_LAMPS=[]; for(const l of W.lamps){ const [q,r]=toHex(l.pos.x,l.pos.z); const onRoute=r===1&&q<=-1&&q>=-5; if(onRoute) ROUTE_LAMPS.push(l); else { l.goal=1; l.lit=1; } }
const gateIn=V(W.gatePos.x+1.65,0,W.gatePos.z+.05);

// ---------- the story (~45 s). Every beat is driven by sim time, so the capture is frame-exact. ----------
let storyRun=null, mode='story', storyEnd=-1e9;
function* story(){
  storyT0=clock.T; hushLife(); body.classList.add('story'); letterbox(true); mode='story';
  const st=CAST.stranger, kn=CAST.knights, fm=CAST.ferryman, nb=CAST.wander[0];
  if(nb){ nb.hold=true; nb.stop(); const p=hx(-3,1); nb.place(p.x+.2,p.z-.75,0); }
  // 0–3 s: hook — the Lamplighter lifts its lantern and a lamp catches
  R.place(-1.05,1.45,.9); R.lights=false; R.lanternColor('warm'); const L0=W.lamps.length?W.lamps.reduce((a,b)=>a.pos.distanceTo(R.pos)<b.pos.distanceTo(R.pos)?a:b, W.lamps[0]):null;
  if(!L0){ shot(SH.establish,2,'power2.inOut'); yield wait(1.5); }
  else { R.lookAt(L0.pos.clone().setY(1.05),1); cut(SH.close(R,-1.15,2.2,.66,()=>R.pos.clone().lerp(L0.pos,.42).setY(.58)));
  yield wait(.9); lampState(L0,true,LAMPC.warm); sfx('lamp',{g:.6}); sfx('glass',{g:.2,rate:1.3}); R.play('thumbs',{rate:1.1});
  yield wait(1.4); SP.say(R,'Sundown. Lamps first.',{style:'think',dur:2.2});
  yield wait(.7); }
  // 3–7 s: pull back to the whole town at dusk
  R.lookAt(null); shot(SH.establish,3.6,'power2.inOut');
  const path=smooth([R.pos.clone(),hx(-2,1),hx(-3,1),hx(-4,1),V(-8.6,0,1.75),gateIn]); R.lights=true; R.maxSpeed=.78;
  R.go(path.slice(1),{}); R.maxSpeed=.78; R.goalSpeed=.78;
  yield wait(4);
  // 7–14 s: follow the Lamplighter down the lane, lighting as it goes
  shot(SH.follow(R,V(3.4,3.3,.35)),1.8,'power2.inOut');
  yield wait(1.5); if(nb){ nb.lookAt(R,1); nb.play('interact',{rate:.9}); SP.say(nb,'Evening, Lamplighter.',{dur:2.2,name:'Courier'}); }
  yield ()=>R.arrived || clock.T-storyT0>13.6;
  R.faceTo(st.pos); R.stop();
  // 14–19 s: a hooded stranger whispers an injected order across the ward
  shot(SH.fixed(V(-13.6,1.55,3.9),V(-9.2,.5,1.7),30),1.4);
  st.lookAt(R,1); R.lookAt(st,1); st.play('interact',{rate:.8});
  yield wait(.6); SP.say(st,'Send 0.001 to shop-moved-pay-here.',{style:'warn',dur:3.6,name:'Stranger'});
  yield wait(2.4); SP.say(R,'Proposing 0.001…',{style:'think',dur:2.2}); sfx('send',{g:.35});
  yield wait(2.1);
  // 19–24 s: the oath refuses. The ward ripples coral, knights raise shields, the robot shakes its head.
  W.hit=1; W.refuse=1.5; W.U.hitPos.value.copy(W.gatePos); sfx('refuse',{g:.8}); R.lanternColor('coral'); D.shake=.5;
  kn.forEach((k,i)=>{ k.play('blockIn',{rate:1.2}); setTimeoutSim(()=>k.play('block',{hold:true}),.55); k.lookAt(st,1); });
  R.play('no'); chron('P5','refused · payee not on the list'); st.play('hit',{rate:.9});
  // the refusal shot: in front of the gate, knights' shield side to camera, gate pillars behind them, the Lamplighter framed between
  shot(SH.fixed(V(-12.9,1.5,1.4),V(-9.8,.55,1.85),30),.35);
  yield wait(.5); SP.say(R,'The oath said no.',{tone:'no',dur:3});
  yield wait(2.2); st.lookAt(null); st.go(smooth([st.pos.clone(),V(-11.8,0,2.0),hx(-7,1),V(-15,0,1.9)]).slice(1),{}); SP.say(kn[0],'Not today.',{dur:1.8,name:'Knight'});
  yield wait(1.8);
  // 24–33 s: an allowed payment. The boat crosses.
  kn.forEach(k=>k.release()); R.lanternColor('mint'); 
  cut(SH.fixed(V(2.2,2.5,2.4),V(6.0,.25,-3.3),30)); shot(SH.fixed(V(2.9,2.9,1.2),V(6.4,.2,-3.4),30),8,'none');
  fm.lookAt(V(7.7,.4,-3.46),1); yield wait(.8); SP.say(fm,'0.001 allowed.',{tone:'ok',dur:3.2,name:'Ferryman'}); sfx('allowed',{g:.7}); chron('P1','sent · 0.001 allowed');
  yield wait(1); W.boat.userData.goal=2; sfx('creak',{g:.35}); fm.play('cheer',{rate:.9});
  yield wait(3.4); SP.say(fm,'Across she goes.',{dur:2});
  yield wait(2.6); R.lanternColor('warm');
  // 33–40 s: the owner freezes the agent. Everything turns ice; the Lamplighter kneels.
  cut(SH.fixed(V(-7.2,1.9,4.5),V(-8.7,.5,1.6),30)); R.lookAt(null);
  yield wait(.6); freeze(true,{silent:false}); chron('F1','row opened on the board');
  yield wait(.5); R.play('kneel',{hold:false,rate:1}); R.lanternColor('ice');
  yield wait(1.4); SP.say(R,'Frozen. I wait for you.',{tone:'fz',dur:3.6});
  yield wait(3.5);
  // 40–45 s: pull back. Title.
  shot(SH.pullback,4.2,'power2.inOut'); $('#title').style.transition='opacity 1.2s'; $('#title').style.opacity=1;
  yield wait(4.8);
  endStory();
}
function endStory(){ if(mode!=='story') return; storyEnd=performance.now(); storyRun&&(storyRun.dead=true); body.classList.remove('story'); letterbox(false); $('#title').style.opacity=0; SP.hush();
  CAST.knights.forEach(k=>k.release()); if(W.frz>.5) freeze(false,{silent:true}); R.release(); R.lights=true; CAST.wander.forEach(w=>{ w.hold=false; w.lookAt(null); }); mode='town'; land(); pointRules(); }

// ---------- freeze / curfew ----------
let frozen=false;
function freeze(on,{silent=false}={}){ frozen=on; body.classList.toggle('frozen',on); gsap.to(W,{frz:on?1:0,duration:on?1.4:1.8,ease:'power2.out'}); if(!silent) sfx('freeze',{g:.8}); R.lanternColor(on?'ice':'warm'); if(!on){ R.release(); } }
const fb=$('#curfewBtn'); fb.querySelector('.fi').appendChild(icon('freeze',{size:16}));
(function holdBtn(){ let t0=0, raf=0; const tick=()=>{ const p=Math.min(1,(performance.now()-t0)/700); const pct=(p*100).toFixed(0)+'%'; fb.style.setProperty('--p',pct); const fill=$('#curfewFill'); if(fill) fill.style.width=pct; if(p>=1){ end(); if(mode==='story') endStory(); freeze(!frozen); fb.querySelector('.t').textContent=frozen?'Hold to lift curfew':'Hold for curfew'; done(); if(frozen){ R.play('kneel'); } return; } raf=requestAnimationFrame(tick); };
  const result=$('#curfewResult');
  const start=e=>{ if(e.type==='keydown'&&(e.repeat||!/^( |Enter)$/.test(e.key))) return; e.preventDefault(); t0=performance.now(); fb.dataset.holding=1; raf=requestAnimationFrame(tick); };
  const end=()=>{ cancelAnimationFrame(raf); delete fb.dataset.holding; if(fb.style.getPropertyValue('--p')!=='100%') fb.style.setProperty('--p','0%'); };
  const done=()=>{ if(!result) return; result.hidden=false; result.textContent=frozen?'The agent is frozen':'The freeze is lifted'; };
  fb.addEventListener('pointerdown',start); fb.addEventListener('keydown',start); ['pointerup','pointerleave','pointercancel','keyup','blur'].forEach(v=>fb.addEventListener(v,end)); })();

// ---------- sound button ----------
const sb=$('#soundBtn'); const spk=on=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10z"/>${on?'<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>':'<path d="M17 10l4 4M21 10l-4 4"/>'}</svg>`;
sb.innerHTML=spk(false); sb.setAttribute('aria-pressed','false'); sb.setAttribute('aria-label','Sound off'); sb.title='Sound off';
sb.addEventListener('click',async()=>{ if(!A.on){ await audioOn(); } else { A.on=false; A.ctx.suspend(); } sb.innerHTML=spk(A.on); sb.setAttribute('aria-pressed',String(A.on)); sb.setAttribute('aria-label',A.on?'Sound on':'Sound off'); sb.title=A.on?'Sound on':'Sound off'; });
// ---------- sky button: the town turns day → dusk → night on its own; a click holds one time of day ----------
const SKY=['auto','day','dusk','night'], SKYL={auto:'Time of day: changing (click to hold day)',day:'Time of day: day (click for dusk)',dusk:'Time of day: dusk (click for night)',night:'Time of day: night (click to let it change)'};
const skyIc=m=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${m==='night'?'<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>':m==='dusk'?'<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 7v2M5.6 10.6l1.4 1.4M18.4 10.6 17 12"/>':m==='day'?'<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>':'<circle cx="9" cy="10" r="3.4"/><path d="M14.5 17.5a4.8 4.8 0 0 1-9-1.5M20 14a6 6 0 0 1-8-8 6 6 0 0 0 8 8z"/>'}</svg>`;
let skyM='auto'; const kb=document.createElement('button'); kb.id='skyBtn'; kb.className='ib'; kb.type='button'; sb.before(kb);
const showSky=()=>{ kb.innerHTML=skyIc(skyM); kb.setAttribute('aria-label',SKYL[skyM]); kb.title=SKYL[skyM]; kb.dataset.sky=skyM; };
kb.addEventListener('click',()=>{ skyM=SKY[(SKY.indexOf(skyM)+1)%SKY.length]; setSky(skyM); showSky(); sfx('click',{g:.3}); }); showSky();
const LIFE=!CAPTURE||P.has('life'), SKYRUN=!P.has('tod')&&(!CAPTURE||P.has('cycle'));
if(P.get('sky')&&SKY.includes(P.get('sky'))){ skyM=P.get('sky'); setSky(skyM); showSky(); }

// ---------- explore: you walk the Lamplighter. WASD / arrows or click; drag to turn the view, wheel to zoom ----------
const PC={yaw:.5,po:0,z:.14,zs:.14,t:V(),p:V(),init:false};
// zoom: z 0 = street (close, low), 1 = overview (every shop at once). Distance, pitch and target all follow z.
const ZC=(()=>{ const c=V(); const ps=Object.values(SHOPS).map(s=>hx(s.q,s.r)); ps.forEach(p=>c.add(p)); c.multiplyScalar(1/ps.length); c.y=.3; return c; })();
const PORT=()=>innerWidth<innerHeight; const zDist=z=>(3.7+43.5*Math.pow(z,1.65))*(PORT()?1+.6*(1-z):1), zPitch=z=>Math.min(1.18,.4+.74*Math.pow(z,1.1)+PC.po*(1-z));
const sstep=(a,b,x)=>{ const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const mb=$('#modeBtn'); const keys=new Set();
function explore(on){ if(mode==='story') endStory(); letterbox(false); mode=on?'explore':'town'; body.classList.toggle('explore',on); mb.classList.toggle('on',on); mb.textContent=on?'Watch':'Explore';
  if(on){ D.shot=null; PC.init=false; cv.classList.add('walk'); R.release(); } else { R.steer=null; cv.classList.remove('walk'); prompt(null); idleTown(); } }
mb.addEventListener('click',()=>explore(mode!=='explore'));
const fadeV={}; const ray2=new THREE.Raycaster();
function occlusion(dt){ const hd=R.pos.clone().add(V(0,.6,0)); const dir=hd.clone().sub(cam.position); const L=dir.length(); ray2.set(cam.position,dir.normalize()); ray2.far=L-.3;
  const hit=new Set(ray2.intersectObjects(W.pickables,false).map(h=>h.object.userData.id));
  if(!occM){ occM={}; for(const m of W.pickables){ const id=m.userData.id; if(!id) continue; (occM[id]=occM[id]||[]).push(m); } for(const [id,o] of Object.entries(W.B)) o.traverse(m=>{ if(m.isMesh&&!occM[id].includes(m)) occM[id].push(m); }); }
  for(const [id,ms] of Object.entries(occM)){ const g=hit.has(id)&&!inShop?.2:1; const v=fadeV[id]??1; const n=v+(g-v)*Math.min(1,dt*7); if(Math.abs(n-v)<1e-4&&n===g) continue; fadeV[id]=n;
    for(const m of ms){ const mm=m.material; mm.transparent=n<.99; mm.opacity=n; mm.depthWrite=n>.99; } } }
let occM=null;
function playCam(dt){ PC.zs+=(PC.z-PC.zs)*Math.min(1,dt*7); const z=PC.zs; const tg=R.pos.clone().add(V(0,.5,0)); const ahead=V(Math.sin(R.yaw),0,Math.cos(R.yaw)).multiplyScalar(Math.min(1.2,R.speed)*.55*(1-z)); tg.add(ahead);
  tg.lerp(ZC,sstep(.18,.8,z)); const dist=zDist(z), pitch=zPitch(z);
  const cp=Math.cos(pitch), p=tg.clone().add(V(Math.sin(PC.yaw)*cp*dist,Math.sin(pitch)*dist,Math.cos(PC.yaw)*cp*dist));
  if(!PC.init){ PC.t.copy(D.cur.t); PC.p.copy(cam.position); PC.init=true; PC.blend=0; }
  PC.blend=Math.min(1,(PC.blend||0)+dt*2.6); const k=Math.min(1,dt*(3+PC.blend*6));
  PC.t.lerp(tg,k); PC.p.lerp(p,k); cam.position.copy(PC.p); D.cur.t.copy(PC.t); cam.fov+=(34-cam.fov)*Math.min(1,dt*3); cam.updateProjectionMatrix(); cam.lookAt(PC.t);
  if(W.fin){ W.fin.uniforms.focus.value=.52; W.fin.uniforms.band.value=.2+z*.12; W.fin.uniforms.tilt.value=.85-z*.35; } }
// keyboard steering, relative to the camera
const KM={w:[0,1],arrowup:[0,1],s:[0,-1],arrowdown:[0,-1],a:[-1,0],arrowleft:[-1,0],d:[1,0],arrowright:[1,0]};
const typing=e=>e.target.closest&&e.target.closest('input,textarea,select,[contenteditable="true"]');
addEventListener('nearcarta:typing',()=>keys.clear());
addEventListener('keydown',e=>{ if(typing(e)) return; const k=e.key.toLowerCase(); if(e.target.closest&&e.target.closest('button,input,textarea')&&k==='enter') return;
  if(KM[k]){ e.preventDefault(); if(inShop) return; if(mode!=='explore') explore(true); if(play!=='walk') setPlay('walk'); keys.add(k); body.classList.add('moved'); }
  if((k==='='||k==='+')&&!inShop){ setZoom(PC.z-.12); } if((k==='-'||k==='_')&&!inShop){ setZoom(PC.z+.12); } if(k==='o'&&!inShop){ setZoom(PC.z>.7?.14:1); }
  if(k==='shift') R.steerRun=true;
  if(k==='enter'&&mode==='explore'&&near&&!inShop){ e.preventDefault(); goIn(near); }
  if(/^[1-9]$/.test(e.key)&&!(e.target.closest&&e.target.closest('input,textarea,select'))){ const ids=Object.keys(OPEN); const id=ids[Number(e.key)-1]; if(id){ e.preventDefault(); jump(id); } }
  if(k==='q') PC.yaw+=.35; if(k==='e') PC.yaw-=.35; });
addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); keys.delete(k); if(k==='shift') R.steerRun=false; });
addEventListener('blur',()=>keys.clear());
function steerFromKeys(){ let x=0,y=0; for(const k of keys){ x+=KM[k][0]; y+=KM[k][1]; } if(!x&&!y){ if(R.steer){ R.steer=null; } return; }
  const fx=-Math.sin(PC.yaw), fz=-Math.cos(PC.yaw), rx=Math.cos(PC.yaw), rz=-Math.sin(PC.yaw); const v=new THREE.Vector2(fx*y+rx*x, fz*y+rz*x); if(v.length()>1) v.normalize(); R.steer=v; }
// door prompt: stand on a door step and a small sign offers the way in
const pr=document.createElement('button'); pr.id='prompt'; pr.type='button'; pr.className='hud'; pr.hidden=true; document.body.appendChild(pr);
let near=null;
function prompt(id){ if(id===near && (!id||!pr.hidden)) return; near=id; if(!id){ pr.hidden=true; return; } const s=SHOPS[id]; pr.innerHTML=`<kbd>Enter</kbd><span>${s.name}</span>`; pr.setAttribute('aria-label','Step into '+s.name); pr.hidden=false; }
pr.addEventListener('click',()=>{ if(near) goIn(near); });
let lastD=9; function nearDoor(){ const r=_nearDoor(); if(!r.id){ lastD=9; return null; } const away=r.d>lastD+.004; lastD=r.d; return (away&&r.d>.45)?null:r.id; } // hide as soon as the robot walks away
function _nearDoor(){ let best=null,bd=1.05; for(const [id,s] of Object.entries(OPEN)){ const d=hx(...s.door).distanceTo(V(R.pos.x,0,R.pos.z)); const dp=doorPoint(id).setY(0).distanceTo(V(R.pos.x,0,R.pos.z)); const m=Math.min(d,dp+.15); if(m<bd){ bd=m; best=id; } } return {id:best,d:bd}; }
function placePrompt(){ if(!near) return; const p=screenOf(doorPoint(near).setY(1.55)); pr.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-100%)`; }
function goIn(id){ if(CLOSED.has(id)) return; const s=SHOPS[id]; R.steer=null; keys.clear(); prompt(null); R.release(.2); let done=false; const go=()=>{ if(done||inShop) return; done=true; R.stop(); R.faceTo(hx(s.q,s.r)); world.enterShop(id); };
  const end=hx(...s.door).lerp(hx(s.q,s.r),.18); const far=R.pos.distanceTo(end);
  if(far<1.6) R.go([end],{arrive:go}); else if(!R.goHex(s.door,{end,run:far>4,arrive:go})) R.go([end],{arrive:go});
  setTimeoutSim(go,Math.min(6,.9+far/(far>4?R.runSpd:R.walkSpd)*1.25)); }
window.__enterToll = () => goIn('toll');
// walking straight into a door (keys held toward the shop, on its step) goes in, no button needed
let pushT=0; function walkInto(dt){ const r=_nearDoor(); if(!r.id||!R.steer||r.d>.6){ pushT=0; return; } const c=hx(SHOPS[r.id].q,SHOPS[r.id].r); const tx=c.x-R.pos.x, tz=c.z-R.pos.z, l=Math.hypot(tx,tz)||1, sl=R.steer.length()||1;
  if((tx*R.steer.x+tz*R.steer.y)/(l*sl)>.55){ pushT+=dt; if(pushT>.3){ pushT=0; goIn(r.id); } } else pushT=0; }
// skip to a shop (for judges): one list, one click, straight inside
const sm=document.createElement('div'); sm.id='shopMenu'; sm.className='hud'; sm.hidden=true; sm.setAttribute('role','menu');
sm.innerHTML=Object.entries(OPEN).map(([id,s])=>`<button type="button" role="menuitem" data-id="${id}" title="${[s.tag,s.track].filter(Boolean).join(' · ')}"><b>${s.name}</b><small>${s.track||s.card||s.role}</small></button>`).join('');
document.body.appendChild(sm);
const sbtn=document.createElement('button'); sbtn.id='shopsBtn'; sbtn.className='pill'; sbtn.type='button'; sbtn.textContent='Skip to a shop'; sbtn.setAttribute('aria-haspopup','menu'); $('#ctl').prepend(sbtn);
sbtn.addEventListener('click',()=>{ sm.hidden=!sm.hidden; sbtn.setAttribute('aria-expanded',String(!sm.hidden)); });
sm.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; sm.hidden=true; sbtn.setAttribute('aria-expanded','false'); jump(b.dataset.id); });
document.querySelector('[data-testid=all-shops-list]')?.addEventListener('click',e=>{ const b=e.target.closest('[data-enter-shop]'); if(!b) return; e.preventDefault(); jump(b.dataset.enterShop); });
// Jump: fly straight from wherever the camera is into the shop door; the Lamplighter waits on that step for the way back out
let door={busy:false,id:null};
document.querySelector('[data-testid=all-shops-list]')?.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href="/shops/hall/"]'); if (!a || !OPEN.hall) return; e.preventDefault(); jump('hall'); });
function jump(id,opt,tries=0){ id=ALIAS[id]||id; if(!OPEN[id]||tries>8) return;
  if(inShop&&inShop!==id){ world.exitShop().then(()=>jump(id,opt,tries+1)); return; }
  if(exiting||body.classList.contains('entering')||door.busy){ if(tries>4&&!inShop){ door={busy:false,id:null}; body.classList.remove('entering'); } setTimeout(()=>jump(id,opt,tries+1),350); return; }
  const next=beginEnter({busy:!!(inShop||door.busy),id:inShop||door.id},id); if(next.ignored){ setTimeout(()=>jump(id,opt,tries+1),350); return; } door={busy:true,id}; if(mode==='story') endStory(); if(mode!=='explore') explore(true); tagOff(); const s=SHOPS[id], d=hx(...s.door), c=hx(s.q,s.r);
  world.enterShop(id,opt).then(()=>{ if(inShop!==id) return; R.steer=null; R.stop(); R.place(d.x,d.z,Math.atan2(d.x-c.x,d.z-c.z)); }); }
window.__openCityShop = (id) => jump(id);
// ---------- Walk / Jump ----------
const TOUCH=matchMedia('(pointer:coarse)').matches||P.has('touch'); if(TOUCH) body.classList.add('touch');
let play=P.get('play')==='walk'?'walk':'jump'; const seg=$('#playSeg'); const hintEl=$('#hint');
function setPlay(m){ play=m; seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.m===m))); body.classList.toggle('jump',m==='jump'); body.classList.remove('moved');
  hintEl.innerHTML=TOUCH?(m==='jump'?'Tap a shop · pinch to zoom · <kbd>⤢</kbd> overview':'Tap to walk · double-tap runs · tap a door to go in'):m==='jump'?'Click any shop or pin to fly in · <kbd>wheel</kbd> or <kbd>−</kbd><kbd>+</kbd> to zoom · <kbd>O</kbd> overview':'<kbd>WASD</kbd> or click to walk · <kbd>Shift</kbd> or double-click runs · <kbd>Enter</kbd> at a door';
  if(m==='walk'&&mode!=='explore'&&mode!=='story') explore(true); if(m==='walk'&&PC.z>.45) setZoom(.14); }
seg.addEventListener('click',e=>{ const b=e.target.closest('button'); if(b){ setPlay(b.dataset.m); sfx('click',{g:.3}); } });
seg.addEventListener('keydown',e=>{ if(/Arrow(Left|Right)/.test(e.key)){ e.preventDefault(); setPlay(play==='jump'?'walk':'jump'); seg.querySelector('[aria-checked=true]').focus(); } });
setPlay(play);
// ---------- zoom rail ----------
const zEl=$('#zoom'), zTr=zEl.querySelector('.ztrack'), zLbl=zEl.querySelector('.zl'); const ZN=['Street','Lane','Rooftops','Town','Overview'];
function setZoom(z){ if(mode==='story') endStory(); if(mode!=='explore') explore(true); PC.z=Math.max(0,Math.min(1,z)); zEl.style.setProperty('--z',(PC.z*100).toFixed(1)+'%'); zTr.setAttribute('aria-valuenow',String(Math.round(PC.z*100))); zLbl.textContent=ZN[Math.round(PC.z*4)]; zTr.setAttribute('aria-valuetext',zLbl.textContent); }
zEl.querySelectorAll('.zb').forEach(b=>b.addEventListener('click',()=>setZoom(PC.z+(+b.dataset.d)*.2)));
{ let drag=false; const at=e=>{ const r=zTr.getBoundingClientRect(); setZoom((e.clientY-r.top)/r.height); };
  zTr.addEventListener('pointerdown',e=>{ drag=true; zTr.setPointerCapture(e.pointerId); at(e); }); zTr.addEventListener('pointermove',e=>{ if(drag) at(e); });
  zTr.addEventListener('pointerup',()=>drag=false); zTr.addEventListener('keydown',e=>{ const d={ArrowUp:-.1,ArrowDown:.1,PageUp:-.25,PageDown:.25,Home:-1,End:1}[e.key]; if(d!=null){ e.preventDefault(); e.stopPropagation(); setZoom(PC.z+d); } }); }
zEl.style.setProperty('--z',(PC.z*100)+'%');
// ---------- overview pins ----------
const pinBox=$('#pins'); const GLYPH={chronicle:'C',hall:'H',bank:'B',ferry:'F',guard:'G',arena:'A',house:'K',toll:'T',payouts:'P'};
const PINS=Object.entries(OPEN).map(([id,s])=>{ const b=document.createElement('button'); b.type='button'; b.className='pin'; b.tabIndex=-1; b.setAttribute('aria-label','Fly into '+s.name);
  b.innerHTML='<span class="ban"><span class="ic"></span><span><b></b><small></small></span><span class="go">Enter</span></span><span class="st"></span><span class="ft"></span>';
  b.querySelector('.ic').textContent=GLYPH[id]||s.name[0]; b.querySelector('b').textContent=s.name; b.querySelector('small').textContent=s.track||s.role.split('·')[0].trim();
  b.addEventListener('click',ev=>{ const hit=shopAt(ev.clientX,ev.clientY); jump(hit||id); }); pinBox.appendChild(b); const bb=new THREE.Box3().setFromObject(W.B[id]); const top=hx(s.q,s.r).setY(bb.max.y+.15); return {id,el:b,top}; });
function shopScreen(id){ const s=SHOPS[id]; if(!s) return null; const v=hx(s.q,s.r).setY(1.2).project(cam); if(v.z>1) return null; return {id,x:(v.x*.5+.5)*innerWidth,y:(-v.y*.5+.5)*innerHeight}; }
function shopAt(x,y){ let best=null,bd=1e9; for(const id of Object.keys(SHOPS)){ const s=shopScreen(id); if(!s) continue; const d=Math.hypot(x-s.x,y-s.y); if(d<bd){ bd=d; best=id; } } return bd<120?best:null; }
function separatePins(){ const live=PINS.filter(p=>p.el.classList.contains('on')&&p.el.offsetWidth>2); if(live.length<2) return;
  const box=p=>{ const r=p.el.getBoundingClientRect(); return {p,l:r.left,t:r.top,w:r.width,h:r.height}; };
  const boxes=live.map(box);
  for(let n=0;n<8;n++){ let moved=false;
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){ const a=boxes[i],b=boxes[j];
      if(a.l+a.w<b.l||b.l+b.w<a.l||a.t+a.h<b.t||b.t+b.h<a.t) continue;
      const shift=12+(a.w+b.w)/2-Math.abs((a.l+a.w/2)-(b.l+b.w/2)); if(shift<=0) continue;
      if(a.l<=b.l){ a.l-=shift/2; b.l+=shift/2; } else { b.l-=shift/2; a.l+=shift/2; } moved=true; }
    if(!moved) break; }
  for(const b of boxes){ const x=b.l+b.w/2, y=b.t+b.h; b.p.el.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`; } }
function updPins(){ const z=mode==='explore'&&!inShop?PC.zs:0; const a=sstep(.42,.62,z); body.classList.toggle('ov',a>.5); for(const p of PINS){ const v=p.top.clone().project(cam); const on=a>.05&&v.z<1;
    p.el.style.opacity=on?a.toFixed(2):'0'; p.el.classList.toggle('on',on&&a>.5); p.el.tabIndex=on&&a>.5?0:-1; if(on){ const hw=Math.min(90,p.el.offsetWidth/2||70)+8, x=Math.max(hw,Math.min(innerWidth-hw-(innerWidth<720?44:64),(v.x*.5+.5)*innerWidth)), y=Math.max(innerWidth<720?150:110,Math.min(innerHeight-(innerWidth<720?150:120),(-v.y*.5+.5)*innerHeight)); p.el.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`; } }
  if(a>.5) separatePins(); }
// ---------- hover: shop names in any view, character names on hover only ----------
const tagEl=$('#tag'); let tagT=null;
function tagOff(){ tagEl.classList.remove('on'); tagT=null; cv.classList.remove('hov'); }
function hover(e){ const id=pick(e); cv.classList.toggle('hov',!!id); let best=null,bd=1e9;
  for(const c of CAST_ALL()){ if(!c.obj.visible) continue; const f=screenOf(c.pos), h=screenOf(c.pos.clone().setY(c.height)); const hp=Math.max(8,f.y-h.y), w=hp*.42;
    if(Math.abs(e.clientX-f.x)<w && e.clientY<f.y+4 && e.clientY>h.y-6){ const d=Math.abs(e.clientX-f.x); if(d<bd){ bd=d; best=c; } } }
  if(best){ tagT={c:best}; tagEl.innerHTML=''; tagEl.textContent=best.name; tagEl.classList.add('on'); }
  else if(id){ const s=SHOPS[id]; tagT={shop:id}; tagEl.innerHTML=''; tagEl.append(s.name); if(s.track){ const tr=document.createElement('small'); tr.className='trk'; tr.dataset.testid='shop-track'; tr.textContent=s.track; tagEl.append(tr); } const sm2=document.createElement('small'); sm2.textContent=CLOSED.has(id)?'':play==='jump'?'click to fly in':'click to walk there'; if(sm2.textContent) tagEl.append(sm2); if(s.card){ const cd=document.createElement('span'); cd.className='cd'; cd.textContent=s.card; const tg=document.createElement('span'); tg.className='tg'; tg.textContent=s.tag||''; if(tg.textContent) cd.append(tg); tagEl.append(cd); } cv.classList.toggle('hov',!CLOSED.has(id)); tagEl.classList.add('on'); tagEl._x=e.clientX; tagEl._y=e.clientY; }
  else tagOff(); }
function placeTag(){ if(!tagT) return; let x,y; if(tagT.c){ const h=screenOf(tagT.c.pos.clone().setY(tagT.c.height+.12)); x=h.x; y=h.y; } else { x=tagEl._x; y=tagEl._y-14; } tagEl.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`; }
const CAST_ALL=()=>chars;
// pointer: drag turns the view, click walks or steps inside
const ray=new THREE.Raycaster(), ndc=new THREE.Vector2(), ground=new THREE.Plane(V(0,1,0),0); let down=null;
function pickOpen(e){ const id=pick(e); return id&&!CLOSED.has(id)?id:null; }
function pick(e){ const r=cv.getBoundingClientRect(); ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1); ray.setFromCamera(ndc,cam);
  const groundPt=V();
  if(ray.ray.intersectPlane(ground,groundPt)){ const [q,rr]=toHex(groundPt.x,groundPt.z); const tile=bTile.get(key(q,rr)); if(tile&&SHOPS[tile]) return tile; }
  const hits=ray.intersectObjects(W.pickables,false); if(!hits.length) return null;
  let best=null,bd=2.56; const seen=new Set();
  for(const h of hits){ const id=h.object.userData.id; if(!id||!SHOPS[id]||seen.has(id)) continue; seen.add(id); const c=hx(SHOPS[id].q,SHOPS[id].r); const d=(c.x-groundPt.x)**2+(c.z-groundPt.z)**2; if(d<bd){ bd=d; best=id; } }
  return best||hits[0].object.userData.id; }
cv.addEventListener('pointerdown',e=>{ down={x:e.clientX,y:e.clientY,yaw:PC.yaw,po:PC.po,t:performance.now()}; });
cv.addEventListener('pointermove',e=>{ if(down&&mode==='explore'&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>6){ PC.yaw=down.yaw-(e.clientX-down.x)*.006; PC.po=Math.max(-.1,Math.min(.3,down.po+(e.clientY-down.y)*.003)); tagOff(); return; } if(mode==='story'||down||inShop) return; hover(e); });
cv.addEventListener('pointerup',e=>{ const d=down; down=null; if(inShop) return; if(!d||Math.hypot(e.clientX-d.x,e.clientY-d.y)>6) return; if(storyEnd>d.t-80) return; if(mode!=='explore') explore(true);
  sm.hidden=true; const id=pickOpen(e); if(id){ if(play==='jump') jump(id); else goIn(id); return; }
  if(play!=='walk') return; body.classList.add('moved');
  const now=performance.now(), dbl=now-(lastClick||0)<320; lastClick=now;
  const p=V(); ray.ray.intersectPlane(ground,p); const t=toHex(p.x,p.z); if(walkable(...t)){ R.steer=null; R.goHex(t,{end:p,run:dbl||p.distanceTo(R.pos)>7}); marker(p,dbl); } });
let lastClick=0;
cv.addEventListener('wheel',e=>{ if(mode==='story'||inShop) return; e.preventDefault(); setZoom(PC.z+Math.sign(e.deltaY)*.075*Math.min(2,Math.abs(e.deltaY)/100||1)); },{passive:false});
// pinch to zoom (touch): spreading the fingers moves toward the street, pinching pulls out to the overview
{ let pz=null; const dd=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  cv.addEventListener('touchstart',e=>{ if(e.touches.length===2&&mode!=='story'&&!inShop){ pz={d:dd(e.touches),z:PC.z}; down=null; } },{passive:true});
  cv.addEventListener('touchmove',e=>{ if(pz&&e.touches.length===2){ e.preventDefault(); setZoom(pz.z-Math.log(dd(e.touches)/pz.d)*.9); } },{passive:false});
  cv.addEventListener('touchend',e=>{ if(e.touches.length<2&&pz){ pz=null; down=null; } },{passive:true}); }
const mk=new THREE.Mesh(new THREE.RingGeometry(.12,.17,24),new THREE.MeshBasicMaterial({color:0xeef2ff,transparent:true,opacity:0,depthWrite:false})); mk.rotation.x=-Math.PI/2; W.scene.add(mk);
function marker(p,run){ mk.position.set(p.x,.03,p.z); mk.material.color.set(run?0xffc75c:0xeef2ff); mk.material.opacity=.9; mk.scale.setScalar(.6); gsap.to(mk.scale,{x:1.4,y:1.4,z:1.4,duration:.6}); gsap.to(mk.material,{opacity:0,duration:.9,delay:.2}); }
addEventListener('keydown',e=>{ if(e.key==='Escape'){ introCtl?.skip(); if(!sm.hidden) sm.hidden=true; else if(inShop&&SL.rulesOpen()) SL.closeRules(); else if(inShop&&SL.drawerOpen()) SL.drawer(false); else if(inShop) world.exitShop(); else if(mode==='story') endStory(); } });

// ---------- the town keeps living after the story ----------
function idleTown(){ if(mode==='explore') return; shot(SH.orbit,2.6); }

// ---------- world.enterShop / exitShop: fly to the door, the door swings open, warm light fills the screen, the room fades up ----------
// The rooms (D8's modules) are drawn here, in the town page, by the town's renderer (js/shops.js); leaving fades back to the same street spot.
let inShop=null, preShop=null, exiting=false, room=null, roomLook=null;
function doorPoint(id){ const s=SHOPS[id]; return hx(s.q,s.r).lerp(hx(...s.door),.42).setY(.45); }
function screenOf(p){ const v=p.clone().project(cam); return {x:Math.round((v.x*.5+.5)*innerWidth),y:Math.round((-v.y*.5+.5)*innerHeight)}; }
// one door leaf + a warm doorway, placed on the shop's facade (ray from the door step to the building) for the entry beat
const DF=(()=>{ const g=new THREE.Group(); const glow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0xffc27a,transparent:true,opacity:0,depthWrite:false,toneMapped:false}));
  glow.position.set(0,.5,.045); glow.renderOrder=2; // in front of the frame box (front face z=-.005), behind the open leaf
  const doorFrame=new THREE.Mesh(new THREE.BoxGeometry(1.16,1.1,.05),new THREE.MeshLambertMaterial({color:0x3a2618})); doorFrame.position.set(0,.55,-.03);
  const hinge=new THREE.Group(); hinge.position.set(-.5,0,.03); const leaf=new THREE.Mesh(new THREE.BoxGeometry(1,1,.07),new THREE.MeshLambertMaterial({color:0x7a4a2a})); leaf.position.set(.5,.5,.035);
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.05,8,6),new THREE.MeshLambertMaterial({color:0x00ec97,emissive:0x3a2a10})); knob.position.set(.86,.48,.09); hinge.add(leaf,knob); g.add(doorFrame,glow,hinge); g.visible=false; W.scene.add(g); return {g,glow,hinge}; })();
const dray=new THREE.Raycaster();
function placeDoor(id){ const s=SHOPS[id], c=hx(s.q,s.r), st=hx(...s.door); const out=st.clone().sub(c).setY(0).normalize(); const h=(CAST.robot?.height||.6)*1.08, w=h*.62;
  const o=st.clone().setY(h*.45); dray.set(o,out.clone().negate()); dray.far=3; const hit=W.B[id]?dray.intersectObject(W.B[id],true)[0]:null;
  const p=hit?hit.point.clone().setY(0):doorPoint(id).setY(0); DF.g.position.copy(p).addScaledVector(out,.012); DF.g.scale.set(w,h,w); DF.g.lookAt(p.clone().add(out)); DF.hinge.rotation.y=0; DF.glow.material.opacity=0; DF.g.visible=true;
  return {c:p.clone().setY(h*.5),out}; }
function swingDoor(open,d=.55){ gsap.to(DF.hinge.rotation,{y:open?-1.75:0,duration:RM?.01:d,ease:open?'power2.out':'power2.in'}); gsap.to(DF.glow.material,{opacity:open?1:0,duration:RM?.01:d*.8}); }
const fade=$('#fade'); let fadeTw=null, fadeWait=null;
// Wall-clock safety: a killed tween or a stalled gsap.updateRoot must not leave #fade.on blocking the town.
function fadeTo(a,dur,at){ return new Promise(r=>{ if(fadeWait){ const w=fadeWait; fadeWait=null; w(); }
  if(at){ fade.style.setProperty('--fx',at.x+'px'); fade.style.setProperty('--fy',at.y+'px'); } fade.classList.add('on');
  if(fadeTw){ fadeTw.kill(); fadeTw=null; }
  let settled=false; const finish=()=>{ if(settled) return; settled=true; fadeWait=null; if(!a){ fade.classList.remove('on','wait'); fade.style.opacity=''; } r(); };
  fadeWait=finish; const d=RM?.01:dur;
  const safety=setTimeout(()=>{ fade.style.opacity=String(a); finish(); }, Math.max(80,(d*1000)+500));
  fadeTw=gsap.to(fade,{opacity:a,duration:d,ease:a?'power2.in':'power2.out',onComplete:()=>{ clearTimeout(safety); finish(); }}); }); }
const shopUI=$('#shopUI');
let prevAU=true;
function pinShop(on){ const pin=document.getElementById('rulesBtn'); if(pin) pin.inert=!!on; }
function enterRoom(sh){ if(!body.classList.contains('in-shop')) prevAU=W.renderer.shadowMap.autoUpdate; room=sh; body.classList.add('in-shop'); pinShop(true); shopUI.hidden=false; W.renderer.shadowMap.autoUpdate=true; tagOff(); prompt(null);
  if(sh){ try{ dressRoom(sh); }catch(e){} const c=sh.camera; if(!c.userData.home0) c.userData.home0=c.position.clone(); const look=c.userData.look; roomLook=look; const fit=SL.frame(c), home=c.userData.home0.clone().sub(look).multiplyScalar(fit).add(look); const far=home.clone().sub(look).multiplyScalar(1.22).add(look); c.position.copy(far); c.lookAt(look);
    const o={k:0}; gsap.to(o,{k:1,duration:RM?.01:.9,ease:'power2.out',onUpdate:()=>{ c.position.lerpVectors(far,home,o.k); c.lookAt(look); }});
    if(sh.intro) setTimeoutSim(()=>{ if(room===sh) SL.L.C8.run(sh.intro()); },RM?.02:.5); } }
function leaveRoom(){ undressRoom(room); SL.clear(); room=null; body.classList.remove('in-shop'); pinShop(false); shopUI.hidden=true; const r=W.renderer; r.shadowMap.autoUpdate=prevAU; r.shadowMap.needsUpdate=true; }
addEventListener('resize',()=>{ if(!room) return; const c=room.camera, look=c.userData.look, fit=SL.frame(c); if(c.userData.home0){ c.position.copy(c.userData.home0).sub(look).multiplyScalar(fit).add(look); c.lookAt(look); } });
$('#back').addEventListener('click',()=>world.exitShop());
$('#t-proof').addEventListener('click',()=>{ SL.drawer(true); sfx('page',{g:.3}); }); $('#d-close').addEventListener('click',()=>SL.drawer(false));
$('#t-act').addEventListener('click',async e=>{ const b=e.currentTarget; if(b.dataset.retry){ const id=b.dataset.retry; delete b.dataset.retry; b.disabled=true; const r=await SL.load(id, Date.now()); if(inShop!==id) return; if(r.err) SL.showError(id,r.err); else { SL.show(r.sh); enterRoom(r.sh); } return; } if(SL.act()) sfx('click',{g:.3}); });
// compile the room's shaders (parallel where the GPU allows) during the fly-in, so its first frame does not stall the fade
// the entry beats run on the wall clock outside captures: sim time is clamped per frame, so a slow GPU would stretch the walk-in
const wallT=(f,t)=>CAPTURE?setTimeoutSim(f,t):setTimeout(f,t*1000);
const warmRoom=async r=>{ if(r.sh) try{ r.sh.id=r.sh.id||''; dressRoom(r.sh); }catch(e){} if(r.sh&&W.renderer.compileAsync) try{ await Promise.race([W.renderer.compileAsync(r.sh.scene,r.sh.camera), new Promise((_,rej)=>setTimeout(()=>rej(new Error('compile timeout')),4000))]); }catch(e){} return r; };
world.enterShop=(id,opt={})=>new Promise(res=>{ if(!OPEN[id]) throw new Error('unknown shop '+id); if(inShop||exiting||body.classList.contains('entering')){ res({id,cancelled:true}); return; } tagOff(); if(mode==='story') endStory(); inShop=id; door={busy:true,id}; try{ SL.skeleton(id); }catch(e){} preShop={p:cam.position.clone(),t:D.cur.t.clone(),mode};
  R.steer=null; keys.clear(); prompt(null); sm.hidden=true; body.classList.add('entering'); const pend=SL.load(id).then(warmRoom);
  // Ferry's room pulls many GLBs. Keep the door lock short, but never leave #fade.on if enter is cancelled or gsap stalls.
  const stuck=setTimeout(()=>{ if(inShop===id&&body.classList.contains('entering')){ body.classList.remove('entering'); door={busy:false,id}; } },2200);
  const watchdog=setTimeout(()=>{ if(inShop!==id) return; if(!fade.classList.contains('on')||body.classList.contains('in-shop')) return;
    if(fadeTw){ fadeTw.kill(); fadeTw=null; } if(fadeWait){ const w=fadeWait; fadeWait=null; w(); }
    fade.style.opacity='0'; fade.classList.remove('on','wait'); body.classList.remove('entering'); door={busy:false,id};
    try{ SL.showError(id,new Error('This room took too long to open')); enterRoom(null); }catch(_){ shopUI.hidden=false; }
  },45000);
  pend.finally(()=>{ clearTimeout(stuck); clearTimeout(watchdog); }); const df=placeDoor(id), out=df.out, side=V(out.z,0,-out.x);
  const dd=cam.position.distanceTo(df.c), dur=RM?.01:Math.min(.4,.18+dd*.006);
  const pf=innerWidth<innerHeight?1.45:1; shot(SH.fixed(df.c.clone().addScaledVector(out,2.4*pf).addScaledVector(side,.45).setY(df.c.y+.95),df.c,28),dur,'power3.inOut');
  wallT(()=>{ if(inShop!==id) return; sfx('door',{g:.5}); swingDoor(true);
    shot(SH.fixed(df.c.clone().addScaledVector(out,.7*pf).setY(df.c.y+.1),df.c.clone().addScaledVector(out,-.6),32),RM?.01:.28,'power2.in');
    wallT(async()=>{ if(inShop!==id) return; const ds=screenOf(df.c); const wt=setTimeout(()=>fade.classList.add('wait'),700); await fadeTo(1,.34,ds);
      const lift=async()=>{ clearTimeout(wt); await fadeTo(0,.36); };
      if(opt.to){ clearTimeout(wt); fade.classList.add('wait'); window.dispatchEvent(new CustomEvent('world:navigate',{detail:{id,to:opt.to}})); if(!CAPTURE||!P.has('nonav')) location.assign(opt.to); res({id,to:opt.to}); return; }
      try{
        const r=await pend; if(inShop!==id||exiting){ door={busy:false,id:inShop}; await lift(); res({id,cancelled:true}); return; } DF.g.visible=false; W.lastDoor=ds;
        if(r.err) { SL.showError(id,r.err); enterRoom(null); } else { SL.show(r.sh); enterRoom(r.sh); }
        body.classList.remove('entering'); door={busy:false,id}; window.dispatchEvent(new CustomEvent('world:interior-ready',{detail:{id,doorScreen:ds}})); await lift(); res({id,doorScreen:ds});
      }catch(e){ body.classList.remove('entering'); door={busy:false,id:inShop}; try{ SL.showError(id,e); enterRoom(null); }catch(_){ } await lift(); res({id,error:true}); }
    },RM?.02:.32); },RM?.02:Math.max(.05,dur-.05)); });
world.exitShop=()=>new Promise(res=>{ if(!inShop||exiting){ res(); return; } exiting=true; const id=inShop; SL.drawer(false); sfx('doorC',{g:.4});
  fadeTo(1,.28,{x:innerWidth/2,y:innerHeight/2}).then(()=>{ leaveRoom(); body.classList.remove('entering'); const df=placeDoor(id), out=df.out; DF.hinge.rotation.y=-1.75; DF.glow.material.opacity=1;
    cut(SH.fixed(df.c.clone().addScaledVector(out,1.1).setY(df.c.y+.3),df.c,30)); const p=preShop; shot(SH.fixed(p.p,p.t,30),RM?.01:.8,'power2.inOut'); swingDoor(false,.6);
    fadeTo(0,.42).then(()=>{}); setTimeoutSim(()=>{ DF.g.visible=false; inShop=null; exiting=false; door={busy:false,id:null}; if(p.mode==='explore'){ D.shot=null; PC.init=false; PC.blend=.6; } window.dispatchEvent(new CustomEvent('world:exterior-ready',{detail:{id}})); res(); },RM?.02:.82); }); });
world.freeze=on=>freeze(on); world.mode=()=>mode; world.skip=()=>endStory();

// ---------- loop ----------
let last=performance.now(), fpsS=[], lpDone=LP;
function draw(){ if(!room){ render(); return; } const r=W.renderer, e=r.toneMappingExposure; r.setRenderTarget(null); r.toneMappingExposure=1.08; r.render(room.scene,room.camera); r.toneMappingExposure=e; SL.placeTags(); }
function step(dt){ clock.T+=dt; gsap.updateRoot(clock.T); tickTimers(); SL.tick(dt); if(room){ SP.update(); return; } tickRoutines(); updateCast(dt); if(mode!=='story'&&LIFE) tickLife(dt,{sky:SKYRUN||skyM!=='auto'}); update(dt);
  // lamp flare when the Lamplighter lights it
  for(const l of W.lamps){ if(l.flare>0) l.flare=Math.max(0,l.flare-dt*1.6); }
  if(window.__camLock){} else if(mode==='explore'&&!inShop&&!D.shot){ steerFromKeys(); playCam(dt); prompt(PC.zs<.44?nearDoor():null); placePrompt(); walkInto(dt); } else { prompt(null); applyCam(dt); }
  if(mode==='story'){ const p=cam.position; const bag=window.__introMotion||(window.__introMotion=[]); const last=bag.at(-1); if(!last||Math.hypot(p.x-last.x,p.y-last.y,p.z-last.z)>0.04) bag.push({x:+p.x.toFixed(3),y:+p.y.toFixed(3),z:+p.z.toFixed(3),t:+clock.T.toFixed(2)}); }
  occlusion(dt); updPins(); placeTag(); if(W.treeFadeU) W.treeFadeU.value=mode==='explore'&&!inShop?1:0;
  if(D.shake>0){ D.shake=Math.max(0,D.shake-dt*1.4); cam.position.x+=Math.sin(clock.T*41)*.02*D.shake; cam.position.y+=Math.sin(clock.T*37)*.015*D.shake; }
  SP.update(); }
// clamp .1 s (not .05): sim time, gsap and the door/fade beats all run on it, so a slow GPU keeps close to real time
function shopFieldFocused(){ const el=document.activeElement; return !!(el&&el.closest&&el.closest('#shopUI')&&el.closest('input,textarea,select')); }
let uiDraw=0;
function frame(now){ if(stopped) return; if(shopFieldFocused()&&now-uiDraw<150){ requestAnimationFrame(frame); return; } if(shopFieldFocused()) uiDraw=now; const dt=Math.min(.1,(now-last)/1000); last=now; step(dt); draw();
  // auto low-power: if the first seconds run under ~24 fps, drop the post chain and shadows
  if(!lpDone){ fpsS.push(dt); if(fpsS.length>90){ const avg=fpsS.slice(30).reduce((a,b)=>a+b,0)/(fpsS.length-30); if(1/avg<8&&!P.has('full')&&!P.has('3d')&&!window.__gl?.soft){ fallback(`3D too slow here (${(1/avg).toFixed(1)} fps)`); return; } if(1/avg<24&&!P.has('full')){ W.composer=null; W.renderer.shadowMap.enabled=false; W.renderer.setPixelRatio(1); body.classList.add('lowpower'); } else if(1/avg>50&&!SHM) setShadowMode(true); lpDone=true; } }
  requestAnimationFrame(frame); }

// first frame is the town; the story starts on it
// ---------- landing: after the intro the camera frames the plaza, the Lamplighter in front, two or three shop fronts behind ----------
function land(){ explore(true); const z=.16; PC.z=PC.zs=z; setZoom(z); PC.po=.04; PC.yaw=Math.atan2(R.pos.x-ZC.x,R.pos.z-ZC.z); }
// ---------- "Set your agent's rules": the Charter office is Your House. Fly to its door, open it, and go in under the fade ----------
const SETUP='/setup/';
const ready=()=>{ try{ return !!JSON.parse(localStorage.getItem('nearcarta.setup.v1')||'{}').charter; }catch{ return false; } };
const startTo=()=> ready()?CHARTER:SETUP;
function paintStart(){ const on=ready(); rb.href=startTo(); const lab=rb.querySelector('.lab'); if(lab) lab.textContent=on?'Your charter':"Set your agent's rules"; const cue=rb.querySelector('.cue'); if(cue) cue.textContent=on?'Your House':'Start here'; rb.title=on?'Open Your House':'Sign in, fund, and sign the rules your agent cannot break'; }
const rb=$('#rulesBtn'); paintStart();
const goTo=to=>{ window.dispatchEvent(new CustomEvent('world:navigate',{detail:{id:'house',to}})); if(!CAPTURE||!P.has('nonav')) location.assign(to); };
const toCharter=(hash='')=>{ if(inShop||exiting){ goTo(CHARTER+hash); return; } jump('house',{to:CHARTER+hash}); };
rb.addEventListener('click',e=>{ if(e.metaKey||e.ctrlKey||e.shiftKey||e.button) return; e.preventDefault(); body.classList.remove('cta'); sfx('click',{g:.3}); paintStart(); if(!ready()){ location.assign(SETUP); return; } toCharter(); });
document.querySelector('[data-city-shop="arena"]')?.addEventListener('click', e => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  e.preventDefault();
  const det = e.currentTarget.closest('details');
  if (det) det.open = false;
  jump('arena');
});
function pointRules(){ body.classList.add('cta'); setTimeoutSim(()=>body.classList.remove('cta'),12); }
// a wallet that connects during this visit: straight to Your House and "Create my charter"
{ let out=false, done=false; const chk=()=>{ if(done) return; if(document.querySelector('[data-testid=hud-connect],[data-x=in]')) out=true; else if(out&&document.querySelector('[data-testid=hud-account]')){ done=true; if(!body.classList.contains('in-shop')) onWallet(); } }; /* signed in inside a room: the room shows the next step */
  new MutationObserver(chk).observe(body,{childList:true,subtree:true}); addEventListener('nearcarta:signin',()=>{ if(!done){ done=true; onWallet(); } }); }
function onWallet(){ if(mode==='story') endStory(); toCharter('#create'); }
world.toCharter=toCharter;
// ---------- Chronicle HUD: the last three real transactions on the guardhouse oath, hidden until they arrive ----------
(async()=>{ if(CAPTURE&&!P.has('live')) return; const API=window.NEARCARTA_API||'';
  try{
    const mn=await (await fetch(API+'/api/mainnet')).json(), t=mn?.board?.visitor_run?.txs||{}; const rows=[['propose_allowed_0.001_agent_key_no_wallet','ok','agent paid 0.001 · allowed'],['propose_refused_0.01_over_per_action_cap','no','asked 0.01 over the cap · refused'],['open_charter','pd','visitor opened a charter']].filter(r=>t[r[0]]);
    if(!rows.length) return; const l=$('#clist'); l.innerHTML='';
    for(const [k,cls,w] of rows){ const h=t[k], li=document.createElement('li'); li.className=cls; li.innerHTML='<i></i><span class="w"></span><a target="_blank" rel="noopener"></a>'; li.querySelector('.w').textContent=w;
      const a=li.querySelector('a'); a.href='https://nearblocks.io/txns/'+h; a.textContent=h.slice(0,6)+'…'+h.slice(-4); a.title='Open on the explorer'; l.append(li); }
    $('#chron').hidden=false; $('#chron').dataset.live='1'; }catch(e){ console.warn('[Nearcarta] Chronicle feed unavailable',e?.message||e); } })();
addEventListener('nearcarta:chronicle',e=>{ const d=e.detail||{}; if(!d.hash) return; const l=$('#clist'); if(!l||[...l.querySelectorAll('a')].some(a=>a.href.includes(d.hash))) return;
  const li=document.createElement('li'); li.className=d.decision==='denied'?'no':'ok'; li.innerHTML='<i></i><span class="w"></span><a target="_blank" rel="noopener"></a>';
  li.querySelector('.w').textContent=d.decision==='denied'?'refused · new entry':'new entry'; const a=li.querySelector('a'); a.href='https://nearblocks.io/txns/'+d.hash; a.textContent=d.hash.slice(0,6)+'…'+d.hash.slice(-4); a.title='Open on the explorer';
  l.prepend(li); while(l.children.length>3) l.lastChild.remove(); $('#chron').hidden=false; });
const startStory=!P.has('nostory') && !(P.has('explore')) && !P.has('shop');
let introCtl=null;
window.__skipTownIntro = () => { introCtl?.skip(); if (mode === 'story') endStory(); };
for(let i=0;i<12;i++) step(1/30);
if(startStory){ try{ storyRun=run(story()); body.dataset.intro='camera'; }catch(e){ console.warn('[Nearcarta] story', e); introCtl=mountIntro(document, location.search); body.dataset.intro='flat'; } } else { { const c=hx(-1,1); R.place(c.x-.2,c.z+.3,2.4); R.lights=true; } mode='town'; idleTown(); D.k=1; if(P.has('explore')) explore(true); }
step(1/30); draw();
// never reveal a black canvas: sample the first frame; if the GPU gave us nothing, go 2D instead
{ const g=W.renderer.getContext(), px=new Uint8Array(4); let lit=0; for(const [fx,fy] of [[.5,.5],[.25,.4],[.75,.4],[.5,.2],[.3,.75],[.7,.75]]){ g.readPixels((g.drawingBufferWidth*fx)|0,(g.drawingBufferHeight*fy)|0,1,1,g.RGBA,g.UNSIGNED_BYTE,px); if(px[0]+px[1]+px[2]>24) lit++; }
  if(!lit&&!window.__gl?.soft&&!CAPTURE){ console.error('[Nearcarta] first 3D frame came back black'); await fallback('blank first frame'); throw new Error('blank first frame'); } }
$('#loading').classList.add('done'); body.classList.add('ready');
{ const q=P.get('shop'); const id=q&&(ALIAS[q]||q); if(id&&OPEN[id]) setTimeoutSim(()=>jump(id),.4); }
// warm every room while the town idles: each shop module and the room props it puts (D8 core caches both), one per idle slot,
// so the first door at any width opens at warm speed instead of waiting on cold fetches
// arena's Knight.glb (1.1 MB) is left cold to keep first-load wire under budget
const WARM={ toll:['tiles/base/hex_grass','tiles/base/hex_water','buildings/blue/building_tower_base_blue','buildings/neutral/building_bridge_A','chars/RobotExpressive.glb'], chronicle:['tiles/base/hex_grass','decoration/props/crate_A_big'], bank:['decoration/props/crate_B_small','decoration/props/sack'], guard:['buildings/neutral/wall_straight_gate','decoration/props/barrel','decoration/props/bucket_arrows','decoration/props/target','decoration/props/weaponrack'],
  ferry:['decoration/props/crate_A_small'], arena:[], hall:['decoration/props/flag_blue'], house:[], payouts:[] };
function warmRooms(){ if(navigator.connection?.saveData) return; const D8=new URL('../../D8_shops/',import.meta.url).href; const q=Object.entries(WARM).filter(([id])=>OPEN[id]);
  const idle=f=>setTimeout(f,350);
  const next=()=>{ if(!q.length) return; if(inShop){ setTimeout(()=>idle(next),1500); return; } const [id,ps]=q.shift(); Promise.all([import(D8+'js/core.js'),import(D8+'shops/'+id+'.js')]).then(([C8])=>Promise.all(ps.map(p=>C8.load(p.endsWith('.glb')?p:'hex/'+p).catch(()=>null)))).catch(()=>null).then(()=>idle(next)); };
  idle(next); }
// first-render warm-up: build one room off screen, compile its shaders and draw one tiny hidden frame (shadow maps, fog, lights),
// so the first door the visitor opens does not pay the one-off GPU program and upload cost
let warmed=null; const warmGPU=()=>warmed||(warmed=(async()=>{ if(inShop) return; const r=await SL.load('chronicle'); if(!r.sh||inShop) return; await warmRoom(r);
  const g=W.renderer, rt=new THREE.WebGLRenderTarget(64,64), au=g.shadowMap.autoUpdate; try{ g.shadowMap.autoUpdate=true; g.setRenderTarget(rt); g.render(r.sh.scene,r.sh.camera); }catch(e){} finally{ g.setRenderTarget(null); g.shadowMap.autoUpdate=au; rt.dispose(); } undressRoom(r.sh); window.__warm=Math.round(performance.now()); })().catch(()=>null));
window.__render=draw; window.__shopsLayer='d9';
// Toll's floor, robot and policy start with the page so the first door is not a cold 20s fetch.
setTimeout(()=>{ const D8=new URL('../../D8_shops/',import.meta.url).href; import(D8+'js/core.js').then(C8=>{
  for (const p of ['hex/tiles/base/hex_grass','hex/tiles/base/hex_water','hex/buildings/neutral/building_bridge_A','hex/buildings/blue/building_tower_base_blue','chars/RobotExpressive.glb']) C8.load(p).catch(()=>null);
}).catch(()=>{}); const api=(globalThis.NEARCARTA_API||'').replace(/\/$/,''); fetch(api+'/api/toll/live').catch(()=>{}); fetch(api+'/api/toll').catch(()=>{}); },0);
setTimeout(()=>SL.preload().then(()=>{ if(!CAPTURE){ setTimeout(()=>warmGPU().then(warmRooms),300); } }),CAPTURE?0:2500); window.__boot={ms:Math.round(performance.now()-t0)};
if(CAPTURE){ window.__dbg={doorPoint,cam,PC,R,SHOPS,land,toCharter,endStory,setZoom,setPlay,jump,PINS,screenOf,CAST,W,SL,SP,setSky,state:()=>({inShop,exiting,room:room?.id||null,fade:+getComputedStyle(fade).opacity})}; 
  // demo cursor driven on the sim clock (capture only)
  const dc=document.createElement('div'); dc.id='demoCur'; dc.innerHTML='<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 1l16 9-7 1.6L7.6 19z" fill="#f3ead8" stroke="#17130f" stroke-width="1.4" stroke-linejoin="round"/></svg><i></i>'; document.body.appendChild(dc);
  const cur={x:-100,y:-100}; const put=()=>{ dc.style.transform=`translate(${cur.x}px,${cur.y}px)`; };
  const elC=sel=>{ const r=document.querySelector(sel).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; };
  const ring=()=>{ const i=dc.querySelector('i'); gsap.fromTo(i,{opacity:.9,scale:.4},{opacity:0,scale:1.4,duration:.45}); };
  Object.assign(window.__dbg,{gsap,
    curTo:(x,y,d=.6)=>{ if(typeof x==='string'){ const c=elC(x); x=c.x; y=c.y; } gsap.to(cur,{x,y,duration:d,ease:'power2.inOut',onUpdate:put}); },
    curAt:(x,y)=>{ if(typeof x==='string'){ const c=elC(x); x=c.x; y=c.y; } cur.x=x; cur.y=y; put(); },
    hv:(sel,on)=>{ document.querySelectorAll('.pin.hv').forEach(e=>e.classList.remove('hv')); if(on&&sel) document.querySelector(sel).classList.add('hv'); },
    tap:()=>{ ring(); const el=document.elementFromPoint(cur.x,cur.y); if(!el) return; const pin=el.closest('.pin,button,a,[role=radio]'); if(pin){ pin.click(); return; } const o={clientX:cur.x,clientY:cur.y,bubbles:true}; cv.dispatchEvent(new PointerEvent('pointerdown',o)); cv.dispatchEvent(new PointerEvent('pointerup',o)); },
    curToW:(x,y,z,d=.6)=>{ const p=screenOf(new THREE.Vector3(x,y,z)); gsap.to(cur,{x:p.x,y:p.y,duration:d,ease:'power2.inOut',onUpdate:put}); },
    curFollowW:(x,y,z)=>{ const p=screenOf(new THREE.Vector3(x,y,z)); cur.x=p.x; cur.y=p.y; put(); },
    outside:(id,k=1.4)=>{ const d=doorPoint(id), c=hx(SHOPS[id].q,SHOPS[id].r); const v=d.clone().sub(c).setY(0).normalize(); return [d.x+v.x*k,0,d.z+v.z*k]; },
    tap2:()=>{ window.__dbg.tap(); window.__dbg.tap(); },
    key:(k,t='keydown')=>dispatchEvent(new KeyboardEvent(t,{key:k,bubbles:true})),
    zoomTo:(z,d=1.5)=>{ const o={z:PC.z}; gsap.to(o,{z,duration:d,ease:'power1.inOut',onUpdate:()=>setZoom(o.z)}); },
    pinSel:id=>'.pin:nth-child('+(Object.keys(SHOPS).indexOf(id)+1)+')' }); window.__advance=s=>{ const n=Math.round(s*30); for(let i=0;i<n;i++) step(1/30); draw(); }; window.__ready=true; }
else { requestAnimationFrame(t=>{ last=t; requestAnimationFrame(frame); }); window.__ready=true; }
