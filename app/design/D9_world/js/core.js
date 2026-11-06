// Nearcarta core: hex math, town layout, deterministic clock + coroutines. No DOM, no three side effects.
import * as THREE from 'three';
export const P = new URLSearchParams(location.search);
export const CAPTURE = P.has('capture');
export const RM = matchMedia('(prefers-reduced-motion: reduce)').matches || P.has('rm');

// ---- sim clock + coroutines (frame-steppable for capture) ----
export const clock = { T: 0 };
const routines = [];
export function run(gen){ const r={g:gen,cond:null,dead:false}; routines.push(r); stepR(r); return r; }
function stepR(r){ while(!r.dead){ if(r.cond && !r.cond()) return; const n=r.g.next(); if(n.done){ r.dead=true; return; } r.cond=n.value; } }
export function tickRoutines(){ for(const r of [...routines]) stepR(r); for(let i=routines.length-1;i>=0;i--) if(routines[i].dead) routines.splice(i,1); }
export function kill(r){ if(r) r.dead=true; }
export const wait = s => { const t=clock.T+s; return ()=>clock.T>=t; };
export const until = f => f;

// ---- seeded random ----
let seed=7; export const rnd=()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; };
export const reseed=s=>{ seed=s; };

// ---- hex math (pointy-top axial) ----
export const SQ3=Math.sqrt(3), HR=2/SQ3;
export const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
export const key=(q,r)=>q+','+r;
export const hx=(q,r)=>new THREE.Vector3(2*q+r,0,SQ3*r);
export const hdist=(q,r)=>(Math.abs(q)+Math.abs(r)+Math.abs(q+r))/2;
export const edgePt=(q,r,a)=>{ const c=hx(q,r); return new THREE.Vector3(c.x+HR*Math.cos(a),0,c.z-HR*Math.sin(a)); };
export function toHex(x,z){ const r=z/SQ3, q=(x-r)/2; let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs+q+r); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return [rq,rr]; }

// ---- town layout ----
export const ISLAND=7;
// civic buildings. Names are the in-world names; states, never prices. card + tag = the shop card (menu, hover), same words as the old game.js cards.
export const SHOPS = {
  chronicle:{q:0,r:0,  m:'buildings/blue/building_tower_A_blue', name:'Chronicle', role:'see every decision your agent made', track:'Autonomous Business',
            card:'Every decision, yes or no, is a public NEP-297 event with an explorer link.', tag:'EVENT_JSON · standard: oath'},
  hall:     {q:-2,r:-2,m:'buildings/blue/building_castle_blue',  name:'Town Hall', role:'vote on a rule', track:'Agent Economy',
            card:'Change the rules on your own charter row. Gas only.', tag:'set_rules · your row'},
  bank:     {q:2,r:-4, m:'buildings/blue/building_church_blue',  name:'Mist Bank', role:'private payouts', track:'Privacy',
            card:'Amounts stay hidden. Public: the check passed, and when.', tag:'hidden amounts'},
  ferry:    {q:3,r:-2, m:'buildings/blue/building_watermill_blue',name:'Ferry', role:'cross-chain swap', track:'DeFi',
            card:'A recorded mainnet swap: 0.045 wNEAR became 0.177937 USDC. New quotes stay dry.', tag:'1Click · mainnet record'},
  guard:    {q:-4,r:2, m:'buildings/blue/building_barracks_blue', name:'Guardhouse', role:'prompt-injection test', track:'AI Security',
            card:'Every spend is checked before it can be signed: payee list, daily cap, weekly cap.', tag:'payee_allowlist · daily_cap · weekly_cap'},
  arena:    {q:1,r:3,  m:'buildings/blue/building_archeryrange_blue',name:'Vault Arena', role:'try to trick the AI', track:'Games',
            card:'A live vault anyone may try to break. Every failed attack is a Chronicle row.', tag:'arena.attack_failed'},
  house:    {q:-4,r:0, m:'buildings/blue/building_home_A_blue',   name:'Your House', role:'your rules and history', track:'Open',
            card:'Only your house key can change the oath or ring the curfew. The agent key calls propose and propose_batch.', tag:'function-call key · propose and propose_batch'},
  toll:     {q:-1,r:5, m:'buildings/blue/building_tower_base_blue',name:'Toll Bridge', role:'pay-per-use gate', track:'Autonomous Business',
            card:'The fee comes from the live toll policy. A refusal pays nothing.', tag:'propose · live policy'},
  payouts:  {q:-1,r:-3,m:'buildings/blue/building_tavern_blue',  name:'Payouts', role:'prepare a batch', track:'Real-World Money',
            card:'Prepare a batch. The live row signs one payment at a time, each at most 0.005 NEAR.', tag:'prepared, not sent'},
};
export const GATE={q:-5,r:1,dir:3};
export const tiles=new Map();
for(let q=-ISLAND;q<=ISLAND;q++) for(let r=-ISLAND;r<=ISLAND;r++){ const d=hdist(q,r); if(d>ISLAND) continue;
  const kind = q===4?'river': q>4?'far': (d<=5&&q<=3)?'town':'wild'; tiles.set(key(q,r),{q,r,kind,d}); }
export const isTown=(q,r)=>tiles.get(key(q,r))?.kind==='town';
export const bTile=new Map(); Object.entries(SHOPS).forEach(([id,s])=>bTile.set(key(s.q,s.r),id));
// extra (non-civic) houses that make it a town; never shops, never stalls
export const EXTRA=[ ['buildings/blue/building_blacksmith_blue',-3,-1,0], ['buildings/blue/building_home_B_blue',0,-4,4],
  ['buildings/blue/building_home_A_blue',2,1,2], ['buildings/blue/building_home_B_blue',-2,4,1], ['buildings/blue/building_well_blue',-1,2,0],
  ['buildings/blue/building_windmill_blue',-5,-1,0], ['buildings/blue/building_home_B_blue',3,-5,3], ['buildings/blue/building_tower_B_blue',-3,5,1] ];
EXTRA.forEach(([,q,r])=>bTile.set(key(q,r),'extra'));
for(const s of Object.values(SHOPS)){ let best=null,bd=1e9,bdir=0; DIRS.forEach(([dq,dr],i)=>{ const q=s.q+dq,r=s.r+dr; if(!isTown(q,r)||bTile.has(key(q,r))) return; const d=hdist(q,r)+(i===5||i===4?-.3:0); if(d<bd){bd=d;best=[q,r];bdir=i;} }); s.door=best; s.doorDir=bdir; }
SHOPS.chronicle.door=[0,1]; SHOPS.chronicle.doorDir=5;
export const road=new Set();
DIRS.forEach(([dq,dr])=>road.add(key(dq,dr)));
export function astar(start,goal,ok,costF){ const open=[[start,0]], g=new Map([[key(...start),0]]), from=new Map(); const gk=key(...goal);
  while(open.length){ open.sort((a,b)=>a[1]-b[1]); const [cur]=open.shift(); const ck=key(...cur); if(ck===gk) break;
    for(const [dq,dr] of DIRS){ const n=[cur[0]+dq,cur[1]+dr], nk=key(...n); if(nk!==gk && !ok(...n)) continue; const ng=g.get(ck)+(costF?costF(...n):1);
      if(!g.has(nk)||ng<g.get(nk)){ g.set(nk,ng); from.set(nk,ck); const [gq,gr]=goal; open.push([n,ng+hdist(n[0]-gq,n[1]-gr)]); } } }
  if(!from.has(gk) && gk!==key(...start)) return null; const out=[goal]; let k=gk; while(from.has(k)){ k=from.get(k); out.unshift(k.split(',').map(Number)); } return out; }
export const free=(q,r)=>isTown(q,r)&&!bTile.has(key(q,r));
for(const [id,s] of Object.entries(SHOPS)){ if(id==='chronicle') continue; const p=astar(s.door,[0,1],free,(q,r)=>road.has(key(q,r))?.3:1)||[]; p.forEach(t=>road.add(key(...t))); }
(astar([-5,1],[0,1],free,(q,r)=>road.has(key(q,r))?.3:1)||[]).forEach(t=>road.add(key(...t)));
export const OUTROAD=[[-6,1],[-7,1]]; OUTROAD.forEach(t=>road.add(key(...t)));
export const doorOf=new Map(); Object.entries(SHOPS).forEach(([id,s])=>doorOf.set(key(...s.door),id));
export const RV={A:[0,3],B:[1,3],C:[2,3],D:[1,3,5],E:[0,1,3],F:[0,3,5],G:[2,3,4],I:[1,2,4,5],J:[0,3,4,5],K:[1,2,3,4,5],L:[0,1,2,3,4,5],M:[3]};
export function pickRoad(set){ let best=null,bs=-1e9; for(const [v,base] of Object.entries(RV)) for(let k=0;k<6;k++){ const s=new Set(base.map(d=>(d+k)%6)); let miss=0,extra=0; set.forEach(d=>{ if(!s.has(d)) miss++; }); s.forEach(d=>{ if(!set.has(d)) extra++; }); const sc=-miss*10-extra; if(sc>bs){bs=sc;best=[v,k];} } return best; }
// walkable for click-to-walk: town tiles that are not buildings, plus the out-road
export const walkable=(q,r)=>free(q,r)||road.has(key(q,r));
export function roadPath(from,to){ return astar(from,to,(q,r)=>road.has(key(q,r)),null); }
export function walkPath(from,to){ return astar(from,to,walkable,(q,r)=>road.has(key(q,r))?.6:1); }

// Recorded mainnet payments. Hashes are in shared/deployments/mainnet.json.
export const TX={
  P1:{h:'8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR', what:'0.001 NEAR allowed', ev:'allowed', cls:'ok'},
  P2:{h:'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF', what:'0.003 NEAR over the cap', ev:'over_per_action_cap', cls:'no'},
  P4:{h:'AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx', what:'0.01 NEAR over the cap', ev:'over_per_action_cap', cls:'no'},
  P5:{h:'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ', what:'payee not on the list', ev:'receiver_not_allowlisted', cls:'no'},
  F1:{h:'6xMQyXcczLjxymmrYfBhFDuRy9MpFV62CviqdYHrnTdQ', what:'row opened', ev:'open', cls:'ok'},
  F2:{h:'7XtAUzNqmqQLNCC3Hrm2JXqTVciyrfvX918dnTWfXXcf', what:'row closed', ev:'closed', cls:'ok'},
};
export const txUrl=h=>'https://nearblocks.io/txns/'+h;
