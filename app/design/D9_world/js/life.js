// Town life between the story beats: townsfolk stop in pairs to talk, greet the Lamplighter as it passes,
// and the sky turns day → dusk → night → dawn on a slow loop (or holds the time picked on the sun button).
import * as THREE from 'three';
import { clock } from './core.js';
import { W } from './world.js';
import { CAST, chars } from './chars.js';
import * as SP from './speech.js';

let seed=11; const rr=()=>(seed=(seed*16807)%2147483647)/2147483647; const pick=a=>a[(rr()*a.length)|0];
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
// what the town talks about: the shops, the oath, the weather. Two or three short lines per talk.
const TALK={
  day:[["Ferry's running full today.","The river's calm for it."],["Saw the Captain at the gate.","The oath keeps him busy."],["Off to the Chronicle?","Every receipt ends up there."],["Bank's open early.","Good, I need a word."],["Market cart's late again.","Roads are dry, at least."],["Nice morning for it.","Too nice to stay indoors."]],
  dusk:[["Lamps will be lit soon.","The Lamplighter's on its way."],["Busy day at the arena.","You could hear the crowd from here."],["Heading home?","After one stop at the hall."],["Did the ferry cross?","It did. The oath let it through."],["Smell that? Bread.","The mill never sleeps."]],
  night:[["Quiet night.","The ward is up. Sleep well."],["Late for a walk.","The lamps make it easy."],["Curfew tonight?","Only if the owner says so."],["Stars are out.","And every lamp in town."]],
};
const GREET={day:['Morning, Lamplighter.','Off early today?','Good day to you.'],dusk:['Evening, Lamplighter.','Lamps first, eh?','Evening!'],night:['Late round tonight?','Still lighting lamps?','Night, Lamplighter.']};
export const phase=()=>W.tod<.5?'day':W.tod<1.5?'dusk':'night';

let chat=null, nextChat=5, greetCD=4; const greeted=new Map();
const free=c=>c&&c.wanderer&&!c.hold&&!c.emote&&!c._chat;
function endChat(){ if(!chat) return; for(const c of [chat.a,chat.b]){ c._chat=false; c.hold=false; c.lookAt(null); c.wT=1.5+rr()*3; } chat=null; nextChat=8+rr()*8; }
function startChat(){ const ws=(CAST.wander||[]).filter(free); if(ws.length<2) return;
  // prefer someone the camera can see
  const seen=ws.filter(c=>c.root.visible); const a=pick(seen.length?seen:ws);
  let b=null, bd=4.5; for(const c of ws){ if(c===a) continue; const d=c.pos.distanceTo(a.pos); if(d<bd){ bd=d; b=c; } } if(!b) return;
  a._chat=b._chat=true; a.hold=b.hold=true; b.stop(); const dir=a.pos.clone().sub(b.pos).setY(0); if(dir.lengthSq()<1e-4) dir.set(1,0,0); dir.normalize();
  const meet=b.pos.clone().addScaledVector(dir,.62); if(!a.goHex(b.tile(),{end:meet})) a.go([meet],{}); chat={a,b,t:0,met:false,lines:pick(TALK[phase()]),i:0,next:0}; }
function tickChat(dt){ const c=chat; c.t+=dt; const {a,b}=c;
  if(!c.met){ if(a.arrived||a.pos.distanceTo(b.pos)<.75||c.t>7){ c.met=true; a.stop(); a.faceTo(b.pos); b.faceTo(a.pos); a.lookAt(b,1); b.lookAt(a,1); c.next=c.t+.4; } return; }
  if(c.t>=c.next){ if(c.i>=c.lines.length){ endChat(); return; } const who=c.i%2?b:a; SP.say(who,c.lines[c.i],{dur:2.6,name:who.name}); if(who.A.interact&&rr()<.6) who.play('interact',{rate:.9}); c.i++; c.next=c.t+2.9; } }
function tickGreet(dt){ const R=CAST.robot; for(const c of chars) if(c._lookOff&&clock.T>c._lookOff){ c._lookOff=0; if(!c._chat) c.lookAt(null); } greetCD-=dt; if(!R||greetCD>0||R.speed<.2) return;
  for(const c of chars){ if(c===R||!(c.wanderer||c.sitter)||c._chat||(c.emote&&!c.sitter)||!c.root.visible) continue; const d=c.pos.distanceTo(R.pos); const last=greeted.get(c)??-1e9;
    if(d<1.5&&clock.T-last>40){ greeted.set(c,clock.T); greetCD=7; c.lookAt(R,1); SP.say(c,pick(GREET[phase()]),{dur:2.2,name:c.name}); if(R.A.yes&&rr()<.5&&!R.emote) R.play('yes',{rate:1.2}); c._lookOff=clock.T+2.6; return; } } }

// the sky clock: seconds per stretch (hold, then blend). Starts at dusk, where the story is set.
const LOOP=[[1,40],[2,18],[2,55],[0,22],[0,80],[1,22]]; // [target tod, seconds to reach and hold]
let cyc={on:true,i:0,t:0,from:1}, fixed=null;
export function setSky(m){ fixed=m==='auto'?null:{day:0,dusk:1,night:2}[m]; if(fixed==null){ cyc={on:true,i:0,t:0,from:W.tod}; } }
function tickSky(dt){ if(fixed!=null){ W.tod+=(fixed-W.tod)*Math.min(1,dt*1.2); if(Math.abs(fixed-W.tod)<.002) W.tod=fixed; return; }
  const [to,dur]=LOOP[cyc.i]; cyc.t+=dt; const blend=Math.min(1,cyc.t/Math.min(dur,18)); const k=blend*blend*(3-2*blend);
  W.tod=cyc.from+(to-cyc.from)*k; if(cyc.t>=dur){ cyc.from=to; cyc.t=0; cyc.i=(cyc.i+1)%LOOP.length; } }

// called every town frame (not in the story, not inside a room)
export function tickLife(dt,{sky=true}={}){ if(W.frz>.5){ if(chat) endChat(); return; }
  if(sky) tickSky(dt);
  if(chat) tickChat(dt); else { nextChat-=dt; if(nextChat<=0){ nextChat=3; startChat(); } }
  tickGreet(dt); }
export function hushLife(){ if(chat) endChat(); }
