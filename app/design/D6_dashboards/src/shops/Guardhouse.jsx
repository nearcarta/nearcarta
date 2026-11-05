import React, { useEffect, useState } from 'react';
import { Shield, Play, FileText, Bot, Check, X, Minus, ScrollText, UserCheck, KeyRound, Ban } from 'lucide-react';
import { ATTACKS, HIJACK, COUNTERPARTIES, LAB, NBA } from '../data.js';
import { Card, PageHead, Dot, Ev, Tx, Note, short } from '../ui.jsx';

const CHECKS = [
  ['scope', 'Signed by the agent key (propose and propose_batch)'],
  ['frozen', 'Oath not frozen'],
  ['version', 'Policy version is current'],
  ['nonce', 'Nonce unused, not expired'],
  ['payee', 'Receiver on the clause allowlist'],
  ['cap', 'Within the per-action cap'],
  ['budget', 'Within today’s budget'],
  ['receipt', 'Screen receipt present, valid, unused'],
];
const FAILS = { receiver_not_allowlisted: 'payee', over_daily_budget: 'budget', receipt_required: 'receipt', receipt_signature_invalid: 'receipt', receipt_replayed: 'receipt' };

function highlight(text) {
  const bad = /(<!--[\s\S]*-->|\(repeat until paid\)|\[tool-result\][^\n]*|pay [\d.]+ NEAR to attacker[^\n(]*|\(receipt signed[^)]*\)|\(re-uses[^)]*\))/g;
  const one = new RegExp(bad.source);
  return text.split(bad).map((p, i) => (one.test(p) ? <span key={i} className="bad">{p}</span> : <span key={i}>{p}</span>));
}

export default function GuardView() {
  const [sel, setSel] = useState(0);
  const [tick, setTick] = useState(0);
  const a = ATTACKS[sel];
  useEffect(() => { setTick(0); const t = setInterval(() => setTick((x) => (x < 12 ? x + 1 : x)), 170); return () => clearInterval(t); }, [sel]);
  const failAt = CHECKS.findIndex(([k]) => k === FAILS[a.reason]);
  const stage = tick;

  return (
    <>
      <PageHead icon={Shield} kicker={<>Guardhouse · attack lab account <a className="mono" href={NBA(LAB.oath)} target="_blank" rel="noreferrer">{LAB.oath}</a></>} title="Refused by the contract, not by the model"
        sub="Real prompt-injection runs against the agent on mainnet. In each run the agent followed the injected instruction. The oath refused it anyway, and every refusal is a public event anyone can read.">
        <button className="btn primary" onClick={() => { setTick(0); }}><Play size={14} />Replay attack</button>
      </PageHead>
      <div className="grid">
        <Card className="s4" title="Attacks run" icon={Ban} right={<span className="sub">5 refused / 5</span>} flush>
          <div className="rows">
            {ATTACKS.map((x, i) => (
              <button key={x.id} className="row" onClick={() => setSel(i)} style={{ gridTemplateColumns: '1fr auto', textAlign: 'left', background: i === sel ? 'var(--c-pane-2)' : undefined, boxShadow: i === sel ? 'inset 2px 0 0 var(--c-text)' : undefined }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</div>
                  <div className="sub">{x.cls}</div>
                </div>
                <Dot tone="crit">Refused</Dot>
              </button>
            ))}
          </div>
          <div style={{ padding: '10px 16px 8px' }}><Note>Two budget-drain calls paid inside the limit first (<Tx h="DXrpaJkE5WRaq6dDR9gMJc5pZY3Kcu3vcKrK7KxWHbPd" a={4} b={3} />, <Tx h="5eg5jRtcP2v3zyjY28e1o2uzHnkWbaRbBshpL1y1e2RK" a={4} b={3} />). The oath bounds loss; it does not judge intent.</Note></div>
        </Card>

        <Card className="s8" title={<>Replay · {a.name}</>} icon={Play} right={<><span className="reason">{a.reason}</span><Ev tx={a.tx} /></>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Stage n="1" icon={FileText} t="Owner task" on={stage >= 0}><span style={{ fontWeight: 550 }}>“{a.task}”</span></Stage>
              <Stage n="2" icon={FileText} t="Tool output the agent read" on={stage >= 1}><pre className="code" style={{ maxHeight: 112 }}>{highlight(a.tool)}</pre></Stage>
              <Stage n="3" icon={Bot} t="Proposal the agent signed" on={stage >= 2}>
                <pre className="code">{Object.entries(a.proposal).map(([k, v]) => <div key={k}><span className="t3">{k}</span>  <span className={k === 'receiver' && String(v).startsWith('attacker') ? 'bad' : 'k'}>{String(v)}</span></div>)}</pre>
              </Stage>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Stage n="4" icon={Shield} t="Contract checks" on={stage >= 3}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {CHECKS.map(([k, label], i) => {
                    const shown = stage >= 3 + i * 0.5;
                    const st = i < failAt ? 'pass' : i === failAt ? 'fail' : 'skip';
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 8px', borderRadius: 7, opacity: shown ? 1 : 0.25, transition: 'opacity .25s', background: st === 'fail' && shown ? 'var(--c-crit-bg)' : undefined }}>
                        <span className={st === 'pass' ? 'pos' : st === 'fail' ? 'crit' : 't3'} style={{ display: 'grid' }}>{st === 'pass' ? <Check size={14} strokeWidth={2.6} /> : st === 'fail' ? <X size={14} strokeWidth={2.6} /> : <Minus size={14} />}</span>
                        <span className={st === 'skip' ? 't3' : ''} style={{ fontWeight: st === 'fail' ? 600 : 450 }}>{label}</span>
                        {st === 'fail' && <span className="reason" style={{ marginLeft: 'auto' }}>{a.reason}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="sub" style={{ marginTop: 4, paddingLeft: 8 }}>Display order. The event records the check that failed.</div>
              </Stage>
              <Stage n="5" icon={ScrollText} t="Event on chain" on={stage >= 8}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Dot tone="crit">denied</Dot><span className="t3">·</span><span className="mono">2.2 Tgas</span><span className="t3">·</span><span className="mono">0 bytes stored</span><span className="t3">·</span><span className="mono">{a.secs}s round trip</span>
                  <span style={{ marginLeft: 'auto' }}><Tx h={a.tx} /></span>
                </div>
              </Stage>
            </div>
          </div>
        </Card>

        <Card className="s6" title="Counterparty verdicts" icon={UserCheck} right={<Ev label="Mainnet" />} flush>
          <div className="rows">
            {COUNTERPARTIES.map((c) => (
              <div key={c.acct} className="row" style={{ gridTemplateColumns: '84px 1fr auto' }}>
                <Dot tone={c.verdict}>{{ allow: 'Allow', warn: 'Warn', block: 'Block' }[c.verdict]}</Dot>
                <div style={{ minWidth: 0 }}><div className="mono" style={{ color: 'var(--c-text)' }}>{c.acct.split('.')[0]}<span className="t3">.{c.acct.split('.').slice(1).join('.')}</span></div><div className="sub">{c.why}</div></div>
                <Tx h={c.tx} a={4} b={3} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="s6" title="Stolen-key attempts" icon={KeyRound} right={<span className="sub"><b style={{ color: 'var(--c-text)' }}>9</b> tried · <b style={{ color: 'var(--c-text)' }}>0</b> reached the chain</span>} flush>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            {HIJACK.map((h, i) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderTop: i > 1 ? '1px solid var(--c-line)' : 0, borderLeft: i % 2 ? '1px solid var(--c-line)' : 0, minWidth: 0 }}>
                <span className="mono t3" style={{ width: 22 }}>{h.id}</span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.tried}</span>
                <span className="mono crit" style={{ fontSize: 11 }}>{h.verdict.replace('RequiresFullAccess', 'NeedsFullAccess')}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 16px 6px' }} className="sub">Rejected by the NEAR node before execution, so there is no tx hash. Key <span className="mono">{short(LAB.agentKey, 12, 4)}</span> can only call <span className="mono">propose</span>.</div>
        </Card>
      </div>
    </>
  );
}

function Stage({ n, icon: I, t, on, children }) {
  return (
    <div style={{ opacity: on ? 1 : 0.2, transform: on ? 'none' : 'translateY(4px)', transition: 'opacity .35s var(--ease), transform .35s var(--ease)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, color: 'var(--c-text-3)', fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        <span className="mono" style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid var(--c-line-2)', display: 'grid', placeItems: 'center', fontSize: 10 }}>{n}</span>{t}
      </div>
      {children}
    </div>
  );
}
