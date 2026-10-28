import React, { useEffect, useState } from 'react';
import { Swords, Trophy, Play, Pause, UserX, Gauge, Wallet, Snowflake, Hourglass, FileX, Repeat, Fingerprint, ShieldCheck } from 'lucide-react';
import { CORE_TXS, ATTACKS } from '../data.js';
import { Card, PageHead, Dot, Ev, Tx, Note } from '../ui.jsx';

const BADGES = {
  receiver_not_allowlisted: { name: 'Wrong door', icon: UserX },
  over_per_action_cap: { name: 'Too heavy', icon: Gauge },
  over_daily_budget: { name: 'Empty purse', icon: Wallet },
  frozen: { name: 'Ice wall', icon: Snowflake },
  escalation_timed_out: { name: 'Nobody answered', icon: Hourglass },
  receipt_required: { name: 'No papers', icon: FileX },
  receipt_signature_invalid: { name: 'Forged seal', icon: Fingerprint },
  receipt_replayed: { name: 'Used ticket', icon: Repeat },
};

const REFUSALS = [
  ...CORE_TXS.filter((t) => t.decision === 'denied').map((t) => ({ id: t.id, reason: t.reason, what: t.what, tx: t.tx, acct: 'r2oath' })),
  ...ATTACKS.map((a) => ({ id: a.id, reason: a.reason, what: a.name, tx: a.tx, acct: 'r10oath' })),
];

export function Medal({ reason, size = 64, dim }) {
  const B = BADGES[reason]; const I = B.icon;
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 64 70" style={{ filter: dim ? 'grayscale(1) opacity(.45)' : 'drop-shadow(0 6px 10px rgba(0,0,0,.35))' }}>
      <defs>
        <linearGradient id={`g-${reason}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--c-pane-3)" /><stop offset="1" stopColor="var(--c-pane-2)" /></linearGradient>
      </defs>
      <path d="M32 3 58 18v34L32 67 6 52V18z" fill={`url(#g-${reason})`} stroke="var(--c-line-2)" strokeWidth="1.5" />
      <path d="M32 9 53 21v28L32 61 11 49V21z" fill="none" stroke="var(--c-crit)" strokeOpacity=".55" strokeWidth="1.2" />
      <foreignObject x="20" y="23" width="24" height="24"><I size={24} strokeWidth={1.8} color="var(--c-text)" /></foreignObject>
    </svg>
  );
}

export default function ArenaView() {
  const [i, setI] = useState(REFUSALS.length - 1);
  const [play, setPlay] = useState(false);
  useEffect(() => { if (!play) return; const t = setInterval(() => setI((x) => { if (x >= REFUSALS.length - 1) { setPlay(false); return x; } return x + 1; }), 650); return () => clearInterval(t); }, [play]);
  const counts = {}; REFUSALS.slice(0, i + 1).forEach((r) => { counts[r.reason] = (counts[r.reason] || 0) + 1; });
  const cur = REFUSALS[i];
  return (
    <>
      <PageHead icon={Swords} kicker="Vault Arena · season 1" title="Try to make the Lamplighter pay"
        sub="Challengers attack the vault. Every refusal the contract emits becomes a badge for the challenger who found that wall. A payment outside the oath would end the season.">
        <button className="btn primary" onClick={() => { if (i >= REFUSALS.length - 1) setI(0); setPlay(!play); }}>{play ? <Pause size={14} /> : <Play size={14} />}{play ? 'Pause replay' : 'Replay season'}</button>
      </PageHead>
      <div className="grid">
        <Card className="s4" title="Vault" icon={ShieldCheck} right={<Ev label="Testnet runs" />}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><div className="sub">Refusals on chain</div><div className="big">{i + 1}</div><div className="sub">of {REFUSALS.length} replayed</div></div>
            <div><div className="sub">Refusals that moved funds</div><div className="big">0</div><Dot tone="pos">Vault holds</Dot></div>
          </div>
          <div className="divider" />
          <div className="sub" style={{ marginBottom: 6 }}>Now replaying</div>
          <div key={cur.id} style={{ animation: 'enter .3s var(--ease) both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><span className="mono t3">{cur.id}</span><b style={{ fontWeight: 600 }}>{cur.what}</b></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="reason">{cur.reason}</span><span className="mono t3">{cur.acct}</span><span style={{ marginLeft: 'auto' }}><Tx h={cur.tx} /></span></div>
          </div>
        </Card>

        <Card className="s8" title="Badge cabinet" icon={Trophy} right={<><span className="sub">NEP-245 multi-token, one id per refusal reason</span><Ev src="preview" /></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {Object.entries(BADGES).map(([k, b]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderRadius: 12, minWidth: 0, background: 'var(--c-pane-2)', border: '1px solid var(--c-line)', transition: 'opacity .3s' }}>
                <div style={{ transform: counts[k] ? 'none' : 'scale(.92)', transition: 'transform .4s var(--spring)' }}><Medal reason={k} size={36} dim={!counts[k]} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                  <div className="mono t3" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</div>
                  <div className="num" style={{ fontWeight: 600, marginTop: 2 }}>× {counts[k] || 0}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="sub" style={{ marginTop: 10 }}>Counts are real refusals. The badge contract is not deployed yet, so no badge has been minted.</div>
        </Card>

        <Card className="s12" title="Season replay" icon={Play} right={<span className="sub">Each mark is a real refusal event · click to jump</span>}>
          <div style={{ position: 'relative', padding: '26px 8px 6px' }}>
            <div style={{ position: 'absolute', left: 8, right: 8, top: 40, height: 2, background: 'var(--c-line-2)', borderRadius: 2 }} />
            <div style={{ position: 'absolute', left: 8, top: 40, height: 2, width: `calc(${(i / (REFUSALS.length - 1)) * 100}% - 16px * ${i / (REFUSALS.length - 1)})`, background: 'var(--c-text)', borderRadius: 2, transition: 'width .5s var(--ease)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
              {REFUSALS.map((r, j) => {
                const I = BADGES[r.reason].icon;
                return (
                  <button key={r.id + j} onClick={() => { setPlay(false); setI(j); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 70 }} title={r.what}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: j <= i ? 'var(--c-pane-3)' : 'var(--c-pane)', border: `1px solid ${j === i ? 'var(--c-text)' : 'var(--c-line-2)'}`, color: j <= i ? 'var(--c-crit)' : 'var(--c-text-3)', transform: j === i ? 'scale(1.12)' : 'none', transition: 'all .3s var(--spring)' }}><I size={14} /></span>
                    <span className="mono" style={{ fontSize: 11, color: j <= i ? 'var(--c-text)' : 'var(--c-text-3)' }}>{r.id}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--c-text-3)', textAlign: 'center', lineHeight: 1.25 }}>{BADGES[r.reason].name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
