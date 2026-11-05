import React, { useEffect, useState, useCallback } from 'react';
import { House, Shield, Ship, Landmark, Swords, Package, Gavel, Signature, ScrollText, Snowflake, Search, Sun, Moon, ArrowLeft, ChevronRight, CornerDownLeft } from 'lucide-react';
import { PROJECT_NAME, AGENT_NAME, CORE, NBA } from './data.js';
import { Dot, short } from './ui.jsx';
import HouseView from './shops/House.jsx';
import GuardView from './shops/Guardhouse.jsx';
import FerryView from './shops/Ferry.jsx';
import BankView from './shops/Bank.jsx';
import ArenaView from './shops/Arena.jsx';
import NftView from './shops/Nft.jsx';
import HallView from './shops/TownHall.jsx';
import TollView from './shops/Toll.jsx';
import ChronicleView from './shops/Chronicle.jsx';

export const SHOPS = [
  { id: 'house', name: 'Your House', icon: House, tone: 'pos', state: 'Oath v4 in force', C: HouseView },
  { id: 'guardhouse', name: 'Guardhouse', icon: Shield, tone: 'pos', state: '5 of 5 attacks refused', C: GuardView },
  { id: 'ferry', name: 'the Ferry', icon: Ship, tone: 'pos', state: 'Quote signature checked', C: FerryView },
  { id: 'bank', name: 'Privacy Bank', icon: Landmark, tone: 'cau', state: 'Receipt check pending', C: BankView },
  { id: 'arena', name: 'Vault Arena', icon: Swords, tone: 'neu', state: 'Season 1 · preview', C: ArenaView },
  { id: 'nft', name: 'NFT Handoff', icon: Package, tone: 'neu', state: 'Not on chain yet', C: NftView },
  { id: 'townhall', name: 'Town Hall', icon: Gavel, tone: 'pos', state: 'Proposal 4 passed 2/2', C: HallView },
  { id: 'toll', name: 'Toll', icon: Signature, tone: 'pos', state: 'MPC 11-of-16 signed', C: TollView },
  { id: 'chronicle', name: 'Chronicle', icon: ScrollText, tone: 'pos', state: '21 events, all on chain', C: ChronicleView },
];

export function Lamplighter({ size = 18 }) {
  // Non-human brass automaton holding a lantern. Pure geometry, no face.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--c-brass)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-label={AGENT_NAME}>
      <rect x="5" y="3" width="9" height="7" rx="2.2" />
      <path d="M7.5 6.5h4" strokeWidth="2" />
      <path d="M9.5 10v2.5M6 21v-6.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V21" />
      <path d="M13 14l4-1.5v2" />
      <path d="M16 14.5h3v4.5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1z" fill="var(--c-brass)" fillOpacity=".35" />
      <path d="M17.5 13v-1" />
    </svg>
  );
}

const route = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'house');

export default function App() {
  const [id, setId] = useState(route());
  const [theme, setTheme] = useState(new URLSearchParams(location.search).get('theme') || 'dark');
  const [pal, setPal] = useState(false);
  const [frozen, setFrozen] = useState(false);
  useEffect(() => { const f = () => setId(route()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPal((p) => !p); } if (e.key === 'Escape') setPal(false); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  const shop = SHOPS.find((s) => s.id === id) || SHOPS[0];
  const V = shop.C;
  return (
    <div className="app">
      <header className="hdr">
        <div className="brand"><span className="glyph"><Lamplighter /></span>{PROJECT_NAME}</div>
        <div className="crumb"><shop.icon size={14} /><b>{shop.name}</b></div>
        <div className="sp" />
        <span className="chip"><Dot tone="pos" live />Mainnet</span>
        <a className="chip mono" href={NBA(CORE.oath)} target="_blank" rel="noreferrer" title={`policy_hash ${CORE.policyHash}`}>
          oath <b>{CORE.oath}</b><span className="t3">·</span><b>v{CORE.policyVersion}</b><span className="t3">{short(CORE.policyHash, 6, 4)}</span>
        </a>
        <span className="chip" title={CORE.agentKey}><Lamplighter size={14} />{AGENT_NAME}<span className="t3">·</span>{frozen ? <Dot tone="crit">frozen</Dot> : <Dot tone="pos">propose-only key</Dot>}</span>
        <button className="search" onClick={() => setPal(true)}><Search size={14} /><span>Jump to…</span><span className="kbd">⌘K</span></button>
        <button className="iconbtn" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className={`btn sm ${frozen ? 'ghost' : 'danger'}`} onClick={() => setFrozen(!frozen)} title="Demo toggle. Sends no transaction.">
          <Snowflake size={13} />{frozen ? 'Unfreeze' : 'Freeze'}
        </button>
      </header>
      <nav className="rail" aria-label="Shops">
        <h6>Shops</h6>
        {SHOPS.map((s) => (
          <a key={s.id} href={`#/${s.id}`} className={`shop ${s.id === shop.id ? 'on' : ''}`} data-shop={s.id}>
            <span className="tile"><s.icon size={15} strokeWidth={1.9} /></span>
            <span><div className="nm">{s.name}</div><div className="st"><Dot tone={frozen && s.tone === 'pos' ? 'crit' : s.tone}>{frozen && s.tone === 'pos' ? 'Frozen' : s.state}</Dot></div></span>
          </a>
        ))}
        <div className="foot">
          <a className="town-thumb" href="../D2_game/" title="Back to the island"><img src="town.jpg" alt="" /><span><ArrowLeft size={13} />Back to {PROJECT_NAME}</span></a>
          <div className="sub" style={{ marginTop: 8 }}>Mainnet record · {CORE.snapshot}</div>
        </div>
      </nav>
      <main className="main">
        {frozen && <div className="banner"><Snowflake size={15} />Demo freeze: every proposal would be refused with reason <span className="reason">frozen</span>. No transaction was sent. A recorded refusal: <a className="txl" href="https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF" target="_blank" rel="noreferrer">CcPMX1…9ceF</a></div>}
        <div className="page" key={shop.id}><V /></div>
      </main>
      {pal && <Palette onClose={() => setPal(false)} />}
    </div>
  );
}

function Palette({ onClose }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = SHOPS.filter((s) => (s.name + s.state).toLowerCase().includes(q.toLowerCase()));
  const go = useCallback((s) => { location.hash = '/' + s.id; onClose(); }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="Go to a shop…" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') setI(Math.min(i + 1, list.length - 1)); if (e.key === 'ArrowUp') setI(Math.max(i - 1, 0)); if (e.key === 'Enter' && list[i]) go(list[i]); }} />
        <div style={{ padding: 6 }}>
          {list.map((s, j) => (
            <a key={s.id} href={`#/${s.id}`} className={j === i ? 'on' : ''} onClick={onClose} style={{ borderRadius: 8 }}>
              <span className="tile"><s.icon size={14} /></span><b style={{ fontWeight: 550 }}>{s.name}</b><span className="sub">{s.state}</span>
              <span style={{ marginLeft: 'auto' }} className="t3">{j === i ? <CornerDownLeft size={13} /> : <ChevronRight size={13} />}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
