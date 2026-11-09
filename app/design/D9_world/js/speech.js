// Speech bubbles: DOM, anchored over heads, never overlapping, typewriter with a pitched blip, fade by distance.
// Styles: say (default, optional tone ok/no/fz), think (italic, dotted tail), warn (dark, coral rim).
import * as THREE from 'three';
import { clock, RM } from './core.js';
import { W } from './world.js';
const layer=()=>document.getElementById('bubbles');
const live=[]; const tv=new THREE.Vector3();
export let blip=()=>{}; export function setBlip(f){ blip=f; }
const words=s=>s.trim().split(/\s+/).length;
export function say(who,text,{style='say',tone='',dur=null,name=null}={}){
  if(words(text)>12) console.warn('bubble over 10 words:',text);
  // one bubble per speaker
  for(const b of live) if(b.who===who) b.end=Math.min(b.end,clock.T);
  const el=document.createElement('div'); el.className='bub '+style+(tone?' '+tone:''); el.dataset.testid='speech-line'; el.setAttribute('role','status');
  const nm=name??who.name; if(nm){ const w=document.createElement('span'); w.className='who'; w.textContent=nm; el.appendChild(w); }
  const tx=document.createElement('span'); tx.className='tx'; el.appendChild(tx); layer().appendChild(el);
  const speed=style==='think'?24:30; // chars / s
  const b={who,el,tx,text,t0:clock.T,shown:0,speed,end:clock.T+(dur??Math.max(2.2,text.length/speed+1.6)),x:null,y:null,w:0,h:0,style};
  if(RM){ tx.textContent=text; b.shown=text.length; }
  if(who&&style!=='think') who.talkUntil=clock.T+Math.min(text.length/speed+.3,3.2);
  live.push(b); return b;
}
export function hush(who){ for(const b of live) if(!who||b.who===who) b.end=Math.min(b.end,clock.T); }
export function clear(){ for(const b of live) b.el.remove(); live.length=0; }
// layout: every visible bubble gets a box that touches no other bubble, no HUD control and no screen edge.
// Each bubble tries slots near its head (above, then stepped up, then sideways); if no slot is free it waits hidden.
let hudR=[], hudT=-1;
const HUDQ='.hud,.pill,#prompt:not([hidden]),.pin,#ctl,#zoom,.md-hud,.md-dock,.md-sheet.open,.md-node'; // pins and Market Day too: a line never covers a shop label, a spot or the game sheet
function huds(){ if(hudT===clock.T) return hudR; hudT=clock.T; hudR=[];
  for(const e of document.querySelectorAll(HUDQ)){ const r=e.getBoundingClientRect(); if(r.width<2||r.height<2||r.bottom<0||r.top>innerHeight) continue; let o=1; for(let n=e;n&&n.nodeType===1;n=n.parentElement){ const cs=getComputedStyle(n); if(cs.display==='none'||cs.visibility==='hidden'){ o=0; break; } o*=+cs.opacity; } if(o>.1) hudR.push({x:r.left,y:r.top,w:r.width,h:r.height}); }
  return hudR; }
const GAP=8;
const hit=(a,b,g=GAP)=>a.x<b.x+b.w+g && a.x+a.w+g>b.x && a.y<b.y+b.h+g && a.y+a.h+g>b.y;
function slot(b,taken,w,h){ const H=huds(); const bw=b.w, bh=b.h+10; /* +10: the tail under the box */
  const x0=Math.max(10,Math.min(w-bw-10,b.ax-bw*.3)), y0=b.ay-bh-4;
  const free=(x,y)=>{ if(x<6||y<6||x+bw>w-6||y+bh>h-6) return false; const c={x,y,w:bw,h:bh}; for(const o of taken) if(hit(c,o)) return false; for(const o of H) if(hit(c,o,6)) return false; return true; };
  const dxs=[0,-bw*.55,bw*.55,-bw*1.1,bw*1.1];
  for(let k=0;k<14;k++){ const dy=-k*(bh*.5); for(const dx of dxs){ const x=Math.max(10,Math.min(w-bw-10,x0+dx)), y=y0+dy; if(free(x,y)) return {x,y}; } }
  // nothing above: try below the anchor (feet side), then give up
  for(let k=0;k<4;k++) for(const dx of dxs){ const x=Math.max(10,Math.min(w-bw-10,x0+dx)), y=b.ay+40+k*(bh*.5); if(free(x,y)) return {x,y}; }
  return null; }
export function update(){
  const T=clock.T, cam=W.camera, w=innerWidth, h=innerHeight;
  for(let i=live.length-1;i>=0;i--){ const b=live[i]; if(T>b.end+.35){ b.el.remove(); live.splice(i,1); } }
  const vis=[];
  for(const b of live){
    // typewriter: reveal by sim time, blip every other letter, pitch per speaker
    const n=Math.min(b.text.length,Math.floor((T-b.t0)*b.speed)); if(n>b.shown){ for(let k=b.shown;k<n;k++){ const ch=b.text[k]; if(k%2===0 && /[a-z0-9]/i.test(ch)) blip(b.who.voice||1,b.style,ch); } b.shown=n; b.tx.textContent=b.text.slice(0,n); }
    const p=b.who.top(); tv.copy(p); tv.y+=.12; const dist=cam.position.distanceTo(tv); tv.project(cam);
    const on=tv.z<1 && Math.abs(tv.x)<1.15 && Math.abs(tv.y)<1.15;
    const fade=1-Math.min(1,Math.max(0,(dist-28)/18)); const life=T>b.end?0:Math.min(1,(T-b.t0)*6);
    b.op=on?fade*life:0;
    if(b.op<.02){ b.el.style.opacity='0'; b.x=null; continue; }
    if(!b.w){ const cur=b.tx.textContent; b.tx.textContent=b.text; b.w=Math.min(b.el.offsetWidth+1||160,w-24); b.h=b.el.offsetHeight||40; b.el.style.width=b.w+'px'; b.el.style.minHeight=b.h+'px'; b.tx.textContent=cur; b.h=Math.max(b.h,b.el.offsetHeight); }
    b.ax=(tv.x*.5+.5)*w; b.ay=(-tv.y*.5+.5)*h; vis.push(b);
    b.sc=.86+.14*fade;
  }
  // priority: the Lamplighter first, then the newest line; ties by the nearer (lower) head
  vis.sort((a,b)=>((b.who.kind==="robot"?1:0)-(a.who.kind==="robot"?1:0))||(b.t0-a.t0)||(b.ay-a.ay));
  const tgt=[];
  for(const b of vis){ const s=slot(b,tgt.map(t=>t.box),w,h); b.slot=s; if(s) tgt.push({b,box:{x:s.x,y:s.y,w:b.w,h:b.h+10}}); }
  // ease toward the slot, but only while the eased box stays clear of everyone's slot and of boxes already drawn; otherwise jump
  const drawn=[];
  for(const b of vis){ const s=b.slot; if(!s){ b.el.style.opacity='0'; b.x=null; continue; }
    let x=s.x, y=s.y;
    if(b.x!=null && !RM){ const ex=b.x+(s.x-b.x)*.35, ey=b.y+(s.y-b.y)*.35, e={x:ex,y:ey,w:b.w,h:b.h+10};
      const clear=!tgt.some(t=>t.b!==b&&hit(e,t.box,2)) && !drawn.some(o=>hit(e,o,2)); if(clear){ x=ex; y=ey; } }
    b.x=x; b.y=y; drawn.push({x,y,w:b.w,h:b.h+10});
    b.el.style.opacity=b.op.toFixed(3);
    const txp=Math.max(14,Math.min(b.w-14,b.ax-b.x)); b.el.style.setProperty('--tx',txp+'px'); b.el.style.setProperty('--ty',(b.h)+'px');
    b.el.style.setProperty('--sx',((b.ax-b.x-txp)/40).toFixed(2));
    b.el.style.transform=`translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px) scale(${b.sc.toFixed(3)})`; b.el.style.transformOrigin=`${txp}px 100%`;
  }
  window.__bubbles=drawn;
}
