import React, { useState } from 'react';
import { Landmark, BookLock, Eye, Cpu, BadgeCheck, ArrowUpRight, ShieldQuestion, Check, Minus } from 'lucide-react';
import { Card, PageHead, Token, Amt, Dot, Ev, Proof, Note } from '../ui.jsx';

const ROWS = [
  { sym: 'NEAR', net: 'near', name: 'NEAR', bal: '42.180', moves: 6 },
  { sym: 'USDC', net: 'base', name: 'USDC · Base', bal: '310.00', moves: 3 },
  { sym: 'ZEC', name: 'Zcash', bal: '1.2500', moves: 1 },
  { sym: 'BTC', net: 'bitcoin', name: 'Bitcoin', bal: '0.00410', moves: 1 },
];

const MODELS = [
  { m: 'glm-5-3-flash', where: 'NEAR AI · TEE endpoint', proof: 'verified', how: 'Direct attestation report · all checks passed', src: 'live' },
  { m: 'glm-5-3-flash receipt', where: 'Per-reply ed25519 signature', proof: 'pending', how: 'Needs a NEAR AI Cloud key to run', src: null },
  { m: 'On-chain DCAP check', where: 'register_from_quote · 417 Tgas', proof: 'verified', how: 'Quote + collateral checked in wasm', src: 'sandbox' },
  { m: 'On-chain ITA check', where: 'register_from_ita · 41.1 Tgas', proof: 'verified', how: 'Intel Trust Authority JWT checked in wasm', src: 'sandbox' },
  { m: 'typesafe/jev-1.13', where: 'External provider', proof: 'external', how: 'ITA returns 400: runs outside the TEE', src: 'live' },
  { m: 'Levanto Sage 1.4', where: 'External provider', proof: 'external', how: 'ITA returns 400: runs outside the TEE', src: 'live' },
];

export default function BankView() {
  const [view, setView] = useState('owner');
  const street = view === 'street';
  return (
    <>
      <PageHead icon={Landmark} kicker="Privacy Bank · NEAR Intents confidential balances + NEAR AI" title="What you see, and what the street sees"
        sub="Balances held as confidential intents are hidden from the public ledger. Each claim carries the proof that backs it, and nothing is labelled Verified unless a check passed.">
        <div className="seg" role="tablist">
          <button className={!street ? 'on' : ''} onClick={() => setView('owner')}><BookLock size={13} />Owner ledger</button>
          <button className={street ? 'on' : ''} onClick={() => setView('street')}><Eye size={13} />Street view</button>
        </div>
      </PageHead>
      <div className="grid">
        <Card className="s7" title={street ? 'Street view · what any observer reads' : 'Owner ledger'} icon={street ? Eye : BookLock} right={<><Ev src="sample" /><Proof kind="pending" label="Confidential balances pending" /></>} flush>
          <div className="thead" style={{ gridTemplateColumns: '1.3fr 1.2fr 0.9fr 1.4fr' }}><span>Asset</span><span>Balance</span><span>Moves</span><span>Proof</span></div>
          <div className="rows" key={view}>
            {ROWS.map((r, i) => (
              <div key={r.sym} className="row" style={{ gridTemplateColumns: '1.3fr 1.2fr 0.9fr 1.4fr', padding: '13px 16px', animation: `enter .35s var(--ease) both ${i * 0.05}s` }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Token sym={r.sym} net={r.net} size={26} /><span><b style={{ fontWeight: 600, display: 'block' }}>{r.sym}</b><span className="sub">{r.name}</span></span></span>
                {street
                  ? <span className="t2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ letterSpacing: 3, color: 'var(--c-text-3)' }}>••••••</span><span className="sub">hidden from the public ledger</span></span>
                  : <span style={{ fontSize: 15, fontWeight: 600 }} className="num">{r.bal}</span>}
                <span className="num t2">{street ? '—' : r.moves}</span>
                <span><Proof kind="pending" label={street ? 'Amount hidden · Pending' : 'Pending'} /></span>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 16px 8px' }}>
            <Note icon={ShieldQuestion}>{street
              ? <>An observer still sees that this House uses NEAR Intents, and the public treasury pools move when you trade. The Ferry shows that exposure before each trade.</>
              : <>Confidential quotes return <span className="mono">401</span> without a partner key. Until it is issued, these rows are sample values and stay <b>Pending</b>.</>}
            </Note>
          </div>
        </Card>

        <Card className="s5" title="Attestation · glm-5-3-flash" icon={BadgeCheck} right={<><Proof kind="verified" /><Ev src="live" label="Live check" /></>}>
          <div className="steps">
            {[
              ['Intel TDX quote valid', 'dcap-qvl · TCB UpToDate · debug off'],
              ['Report bound to key and nonce', 'report_data = signing key ‖ our 64-hex nonce'],
              ['Container is the published one', 'mrconfigid = 01 ‖ compose_hash'],
              ['Boot log replays', 'RTMR3 event log replayed'],
              ['NVIDIA GPU evidence', 'NRAS · checked off chain only'],
            ].map(([t, d]) => (
              <div key={t} className="step done"><div className="b"><Check size={12} strokeWidth={3} /></div><div><div className="t">{t}</div><div className="d mono" style={{ fontSize: 11 }}>{d}</div></div><div /></div>
            ))}
          </div>
          <a className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 2 }} href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer">Verify at NEAR AI<ArrowUpRight size={14} /></a>
          <div className="sub" style={{ marginTop: 8, textAlign: 'center' }}>Receipts ride in the URL fragment, which the page never sends to a server.</div>
        </Card>

        <Card className="s12" title="Who did the thinking" icon={Cpu} right={<span className="sub">The proof label is fixed per row. External models never show Verified.</span>} flush>
          <div className="thead" style={{ gridTemplateColumns: '1.3fr 1.3fr 1fr 1.8fr 0.8fr' }}><span>Model or check</span><span>Where it runs</span><span>Proof</span><span>Basis</span><span>Evidence</span></div>
          <div className="rows">
            {MODELS.map((m) => (
              <div key={m.m} className="row" style={{ gridTemplateColumns: '1.3fr 1.3fr 1fr 1.8fr 0.8fr' }}>
                <span className="mono" style={{ color: 'var(--c-text)', fontWeight: 500 }}>{m.m}</span>
                <span className="t2">{m.where}</span>
                <span><Proof kind={m.proof} /></span>
                <span className="t2">{m.how}</span>
                <span>{m.src ? <Ev src={m.src} label={m.src === 'live' ? 'Live read' : undefined} /> : <span className="t3">Not recorded</span>}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
