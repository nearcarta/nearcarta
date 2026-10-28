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
  const el=document.createElement('div'); el.className='bub '+style+(tone?' '+tone:''); el.setAttribute('role','status');
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
    const op=on?fade*life:0; b.el.style.opacity=op.toFixed(3);
    if(op<.02){ continue; }
    if(!b.w){ const cur=b.tx.textContent; b.tx.textContent=b.text; b.w=b.el.offsetWidth+1||160; b.h=b.el.offsetHeight||40; b.el.style.width=b.w+'px'; b.el.style.minHeight=b.h+'px'; b.tx.textContent=cur; }
    b.ax=(tv.x*.5+.5)*w; b.ay=(-tv.y*.5+.5)*h; vis.push(b);
    const sc=.86+.14*fade; b.sc=sc;
  }
  // de-overlap: place in order of anchor height, push up past already-placed boxes
  vis.sort((a,b)=>b.ay-a.ay); const placed=[];
  for(const b of vis){ let x=b.ax-b.w*.3, y=b.ay-b.h-14; x=Math.max(10,Math.min(w-b.w-10,x));
    for(let it=0;it<8;it++){ const hit=placed.find(o=>x<o.x+o.w+8 && x+b.w+8>o.x && y<o.y+o.h+6 && y+b.h+6>o.y); if(!hit) break; y=hit.y-b.h-8; }
    y=Math.max(10,y);
    // ease toward the slot so bubbles never jitter
    if(b.x==null||RM){ b.x=x; b.y=y; } else { b.x+=(x-b.x)*.35; b.y+=(y-b.y)*.35; }
    placed.push({x:b.x,y:b.y,w:b.w,h:b.h});
    const txp=Math.max(14,Math.min(b.w-14,b.ax-b.x)); b.el.style.setProperty('--tx',txp+'px'); b.el.style.setProperty('--ty',(b.h)+'px');
    b.el.style.setProperty('--sx',((b.ax-b.x-txp)/40).toFixed(2));
    b.el.style.transform=`translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px) scale(${b.sc.toFixed(3)})`; b.el.style.transformOrigin=`${txp}px 100%`;
    // when the tail must stretch (pushed up), dim slightly so the stack reads as secondary
  }
}
