import React, { useState } from 'react';
import { Ship, ArrowDown, Route, Fingerprint, Check, CircleAlert, Waves, ListChecks, EyeOff, Clock } from 'lucide-react';
import { QUOTE, SIGNED, UNSIGNED, POOLS } from '../data.js';
import { Card, PageHead, Token, Amt, Dot, Ev, Proof, Steps, Note } from '../ui.jsx';

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

export default function FerryView() {
  const [amt, setAmt] = useState(3);
  const pool = POOLS[1].size;
  const share = amt / pool;
  const logPct = Math.min(100, Math.max(2, ((Math.log10(Math.max(share, 1e-9)) + 9) / 9) * 100));
  const out = (amt * (0.640 / 3)).toFixed(3);
  return (
    <>
      <PageHead icon={Ship} kicker="the Ferry · NEAR Intents via 1Click" title="Cross chains on a quote you can check"
        sub="The quote is signed. Your agent checks the signature and the fields it covers before it proposes a deposit. Fields the signature does not cover are shown as such.">
        <Ev src="live" label="Live 1Click read · no swap executed" />
      </PageHead>
      <div className="grid">
        <Card className="s4" title="Swap" icon={Ship} right={<span className="tag cau"><Clock size={11} />Confidential quote pending</span>}>
          <Side label="You send" sym="USDC" net="base" chain="Base">
            <input value={amt} onChange={(e) => setAmt(Math.max(0, parseFloat(e.target.value) || 0))} type="number" step="1" aria-label="Amount in USDC"
              style={{ width: '100%', background: 'transparent', border: 0, outline: 'none', color: 'var(--c-text)', font: '650 28px var(--f-sans)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }} />
          </Side>
          <div style={{ display: 'grid', placeItems: 'center', margin: '-9px 0', position: 'relative', zIndex: 1 }}><span className="iconbtn" style={{ background: 'var(--c-pane)' }}><ArrowDown size={14} /></span></div>
          <Side label="You receive" sym="NEAR" net="near" chain="NEAR"><div className="big" style={{ color: amt ? 'var(--c-text)' : 'var(--c-text-3)' }}>{amt ? out : '—'}</div></Side>
          <dl className="kv" style={{ marginTop: 14, gridTemplateColumns: '1fr auto' }}>
            <dt>Rate (signed amountOut)</dt><dd className="mono">1 USDC ≈ 0.2133 NEAR</dd>
            <dt>Cost, from signed fields</dt><dd className="mono">1 − amountOutUsd / amountInUsd</dd>
            <dt>Fee (keyless)</dt><dd className="mono">{QUOTE.fee}</dd>
            <dt>Time estimate</dt><dd className="mono">{QUOTE.eta}</dd>
            <dt>Minimum</dt><dd><Amt v="0.15" sym="USDC" size={14} net="base" /></dd>
          </dl>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14, height: 38 }} disabled={amt < 0.15}><Fingerprint size={15} />Check quote, then propose</button>
          <div className="sub" style={{ marginTop: 8, textAlign: 'center' }}>Rate scaled from the 3 USDC quote read at 01:15 EEST.</div>
        </Card>

        <Card className="s4" title="Quote signature" icon={Fingerprint} right={<Proof kind="verified" label="Signature valid" />}>
          <div className="mono t3" style={{ marginBottom: 10 }}>quote manager <span style={{ color: 'var(--c-text)' }}>ed25519:reYaWh…Rifc</span></div>
          <div className="sub" style={{ marginBottom: 6 }}>Covered by the signature · change any and it breaks</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
            {SIGNED.map((f, i) => <span key={f} className="tag pos" style={{ animation: `enter .4s var(--ease) both ${i * 0.03}s` }}><Check size={11} strokeWidth={3} /><span className="mono" style={{ fontSize: 11 }}>{f}</span></span>)}
          </div>
          <div className="sub" style={{ marginBottom: 6 }}>Not covered · the agent must not trust these</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {UNSIGNED.map((f) => <span key={f} className="tag cau"><CircleAlert size={11} /><span className="mono" style={{ fontSize: 11 }}>{f}</span></span>)}
          </div>
          <div className="divider" />
          <Note>Tamper test with the official SDK: changing <span className="mono">amountOut</span>, <span className="mono">recipient</span> or <span className="mono">refundTo</span> broke the signature. Changing <span className="mono">appFees</span> did not, so cost is computed from signed amounts.</Note>
        </Card>

        <Card className="s4" title="Route in the signed quote" icon={Route} right={<span className="sub">dry quote</span>}>
          <Steps items={[
            { s: 'plan', n: 1, t: <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Token sym="USDC" net="base" size={18} />Deposit on Base</span>, d: 'To the 1Click deposit address in the signed quote' },
            { s: 'plan', n: 2, t: 'NEAR Intents settles', d: 'Solver fills inside intents.near' },
            { s: 'plan', n: 3, t: <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Token sym="NEAR" net="near" size={18} />Withdraw to the House</span>, d: 'INTENTS → INTENTS legs take ≈ 12 s, refundFee 0' },
          ]} />
          <div className="divider" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><b style={{ fontWeight: 600 }}>Status</b><Ev src="sample" /></div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'].map((s, i) => (
              <div key={s} style={{ flex: 1 }}>
                <div style={{ height: 4, borderRadius: 4, background: i < 3 ? 'var(--c-text)' : 'var(--c-pane-3)', marginBottom: 6, animation: i === 2 ? 'pulse 1.6s infinite' : undefined }} />
                <div className="mono" style={{ fontSize: 9.5, color: i < 3 ? 'var(--c-text-2)' : 'var(--c-text-3)', letterSpacing: '-.02em' }}>{s}</div>
              </div>
            ))}
          </div>
          <div className="sub" style={{ marginTop: 8 }}>REFUNDED returns the deposit to <span className="mono">refundTo</span>, which is a signed field.</div>
        </Card>

        <Card className="s12" title="Pool-size exposure" icon={Waves} right={<><span className="sub">Treasury pools are public. A big trade in a small pool is easy to spot.</span><Ev src="live" label="Read 01:15 EEST" /></>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: 28, alignItems: 'center' }}>
            <div>
              <div className="sub" style={{ marginBottom: 6 }}>Your trade as a share of the Base USDC pool</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div className="big">{share < 0.0001 ? '< 0.01%' : (share * 100).toFixed(2) + '%'}</div>
                <Dot tone={share < 0.001 ? 'pos' : share < 0.02 ? 'cau' : 'crit'}>{share < 0.001 ? 'Blends in' : share < 0.02 ? 'Noticeable' : 'Stands out'}</Dot>
              </div>
              <div style={{ position: 'relative', height: 10, borderRadius: 10, marginTop: 14, background: 'linear-gradient(90deg, var(--c-pos-bg), var(--c-cau-bg) 70%, var(--c-crit-bg))', border: '1px solid var(--c-line)' }}>
                <div style={{ position: 'absolute', top: -5, left: `calc(${logPct}% - 2px)`, width: 4, height: 18, borderRadius: 3, background: 'var(--c-text)', transition: 'left .5s var(--spring)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }} className="mono t3"><span>1e-9</span><span>1e-6</span><span>1e-3</span><span>100%</span></div>
              <div className="sub" style={{ marginTop: 8 }}>Only 3 treasury moves were seen in about 4 minutes, so timing also leaks.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {POOLS.map((p) => (
                <div key={p.tok} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--c-pane-2)', border: `1px solid ${p.tok === 'Base USDC' ? 'var(--c-line-2)' : 'var(--c-line)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Token sym={p.tok.includes('USDC') ? 'USDC' : p.tok} net={p.tok === 'Base USDC' ? 'base' : p.tok === 'NEAR USDC' ? 'near' : undefined} size={22} /><span style={{ fontWeight: 550 }}>{p.tok}</span></div>
                  <div style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em' }} className="num">{fmt(p.size)}</div>
                  <div className="sub">{p.unit} in pool</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function Side({ label, sym, net, chain, children }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--c-pane-2)', border: '1px solid var(--c-line)' }}>
      <div className="sub" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        <span className="chip" style={{ height: 34, padding: '0 12px 0 6px', gap: 8, background: 'var(--c-pane)' }}><Token sym={sym} net={net} size={22} /><span><b style={{ display: 'block', lineHeight: 1.1 }}>{sym}</b><span className="t3" style={{ fontSize: 10.5 }}>on {chain}</span></span></span>
      </div>
    </div>
  );
}
