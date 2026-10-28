import React, { useMemo, useState } from 'react';
import { House, KeyRound, Snowflake, Gauge, ScrollText, Pencil, Lock, Users, ArrowRight, RotateCcw } from 'lucide-react';
import { CORE, CLAUSES, CORE_TXS, AGENT_NAME, NBA } from '../data.js';
import { Card, PageHead, Token, Amt, Dot, Ev, Tx, Meter, Proof, short, Note } from '../ui.jsx';
import SpendChart, { ts } from '../Chart.jsx';

export default function HouseView() {
  const [draft, setDraft] = useState({ tip: { cap: 0.5, budget: 1.0 }, big: { cap: 0.1, budget: 2.0 } });
  const dirty = draft.tip.cap !== 0.5 || draft.tip.budget !== 1 || draft.big.cap !== 0.1 || draft.big.budget !== 2;
  const set = (id, k, v) => setDraft({ ...draft, [id]: { ...draft[id], [k]: Math.max(0, Math.round(v * 100) / 100) } });

  const pts = useMemo(() => [
    { time: ts('01:13:57'), value: 0 }, { time: ts('01:14:22'), value: 0.3 }, { time: ts('01:14:29'), value: 0.3 },
    { time: ts('01:14:37'), value: 0.8 }, { time: ts('01:14:44'), value: 0.8 }, { time: ts('01:14:51'), value: 0.8 },
    { time: ts('01:15:09'), value: 0.8 }, { time: ts('01:24:00'), value: 0.9 }, { time: ts('01:25:00'), value: 0.9 }, { time: ts('01:25:49'), value: 0.9 },
  ], []);
  const mk = useMemo(() => [
    { time: ts('01:14:22'), position: 'belowBar', shape: 'circle', tone: 'pos', text: 'P1' },
    { time: ts('01:14:29'), position: 'aboveBar', shape: 'arrowDown', tone: 'crit', text: 'P2' },
    { time: ts('01:14:37'), position: 'belowBar', shape: 'circle', tone: 'pos', text: 'P3' },
    { time: ts('01:14:44'), position: 'aboveBar', shape: 'arrowDown', tone: 'crit', text: 'P4' },
    { time: ts('01:14:51'), position: 'aboveBar', shape: 'arrowDown', tone: 'crit', text: 'P5' },
    { time: ts('01:15:09'), position: 'aboveBar', shape: 'arrowDown', tone: 'crit', text: 'F2' },
    { time: ts('01:24:00'), position: 'belowBar', shape: 'circle', tone: 'pos', text: 'M2' },
    { time: ts('01:25:00'), position: 'aboveBar', shape: 'arrowDown', tone: 'crit', text: 'M3' },
  ], []);

  return (
    <>
      <PageHead icon={House} kicker={<>Your House · <span className="mono">{CORE.oath}</span></>} title="The oath your agent cannot break"
        sub={<>{AGENT_NAME} holds one key that can only call <span className="mono">propose()</span>. Every payment passes these clauses on chain. A refusal is a public event, not an error.</>}>
        {dirty && <button className="btn ghost" onClick={() => setDraft({ tip: { cap: 0.5, budget: 1 }, big: { cap: 0.1, budget: 2 } })}><RotateCcw size={14} />Discard</button>}
        <button className="btn primary" disabled={!dirty} style={{ opacity: dirty ? 1 : 0.55 }}><Pencil size={14} />{dirty ? 'Propose oath v5' : 'Edit a clause to propose'}</button>
      </PageHead>

      <div className="grid">
        <Card className="s7" title="Oath v4 · clauses" icon={ScrollText} right={<><span className="mono t3">policy_hash {short(CORE.policyHash, 8, 4)}</span><Ev tx="eJVximieXtbjgZ28ZtYk1pWwTWLEZxdifqrxxa93i9S" /></>} flush>
          <div className="thead" style={{ gridTemplateColumns: '120px 1.3fr 1fr 1fr 1.3fr' }}><span>Clause</span><span>Pays only to</span><span>Per action</span><span>Per day</span><span>Over the cap</span></div>
          <div className="rows">
            {CLAUSES.map((c) => (
              <div key={c.id} className="row" style={{ gridTemplateColumns: '120px 1.3fr 1fr 1fr 1.3fr', padding: '12px 16px' }}>
                <div><div className="mono" style={{ fontWeight: 600, color: 'var(--c-text)' }}>{c.id}</div><div className="sub">{c.kind}</div></div>
                <div className="mono t2" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.payees[0]}</div>
                <Edit v={draft[c.id].cap} base={c.cap} on={(v) => set(c.id, 'cap', v)} />
                <Edit v={draft[c.id].budget} base={c.budget} on={(v) => set(c.id, 'budget', v)} />
                <div>{c.escalate ? <><Dot tone="cau">Ask owner up to {c.escalate.max}</Dot><div className="sub">{c.escalate.by} · times out after {c.escalate.timeout}</div></> : <Dot tone="crit">Refuse</Dot>}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 16px 6px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['Typed clauses', 'Daily budget with reserve / release', 'NEP-519 yield / resume escalation', 'ed25519 receipt check', 'NEP-297 refusal events'].map((t) => <span key={t} className="chip" style={{ height: 24 }}>{t}</span>)}
          </div>
          {dirty && <div style={{ padding: '6px 16px 8px' }}><Note icon={Pencil}>Draft only. Changing a clause needs the owner or a DAO vote, bumps the policy version, and every pending proposal signed for v4 is refused with <span className="reason">stale policy_version</span>.</Note></div>}
        </Card>

        <Card className="s5" title="Today’s budget" icon={Gauge} right={<Ev label="Testnet state" />}>
          {CLAUSES.map((c) => {
            const left = +(c.budget - c.spent).toFixed(2);
            return (
              <div key={c.id} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{c.id}</span>
                  <span className="sub">spent</span>
                  <span style={{ marginLeft: 'auto' }}><Amt v={c.spent.toFixed(2)} size={15} /></span>
                  <span className="t3">of {c.budget.toFixed(1)}</span>
                </div>
                <Meter value={c.spent} max={c.budget} mark={c.cap} tone={left / c.budget < 0.2 ? 'cau' : ''} label={`${c.id} budget`} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }} className="sub">
                  <span>{left} left · reserved {c.reserved}</span><span>│ marks the per-action cap ({c.cap})</span>
                </div>
              </div>
            );
          })}
          <div className="stats" style={{ margin: '0 -16px -16px' }}>
            <div className="stat"><div className="l">Allowed action</div><div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>5.9 Tgas</div></div>
            <div className="stat"><div className="l">Refusal</div><div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>2.2 Tgas</div></div>
            <div className="stat"><div className="l">Refusal storage</div><div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>0 bytes</div></div>
          </div>
        </Card>

        <Card className="s7" title="Clause tip · cumulative spend" icon={Gauge} right={<><Dot tone="pos">paid</Dot><Dot tone="crit">refused</Dot><span className="sub">28 Oct, EEST</span></>}>
          <SpendChart points={pts} markers={mk} budget={1.0} cap={0.5} height={232} />
        </Card>

        <Card className="s5" title="Keys and guardians" icon={KeyRound} right={<Ev tx="5cdQHpZJ29DwRQUYaJsefHbiYmZuUeyvAMZ4a4oq9TFV" label="Lock tx" />} flush>
          <div className="rows">
            <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div style={{ fontWeight: 550 }}>Agent key · function-call</div><div className="mono t3" title={CORE.agentKey}>{short(CORE.agentKey, 14, 6)} → propose()</div></div>
              <Dot tone="pos">Active</Dot>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr 150px' }}>
              <div><div style={{ fontWeight: 550 }}>Gas allowance</div><div className="sub">Can pay gas, cannot move funds</div></div>
              <div><div style={{ textAlign: 'right', marginBottom: 6 }}><Amt v={CORE.allowanceNow} size={14} /></div><Meter value={CORE.allowanceNow} max={1} /></div>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div style={{ fontWeight: 550 }}>Full-access keys</div><div className="sub">Deleted. Code changes only by DAO vote</div></div>
              <span className="tag pos"><Lock size={11} />0 keys</span>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div style={{ fontWeight: 550 }}>Guardians</div><div className="mono t3"><a href={NBA(CORE.owner)} target="_blank" rel="noreferrer">{CORE.owner}</a> · <a href={NBA(CORE.dao)} target="_blank" rel="noreferrer">r2guard.sputnikv2</a></div></div>
              <span className="chip" style={{ height: 24 }}><Users size={12} />2 can freeze</span>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div style={{ fontWeight: 550 }}>Freeze epoch</div><div className="sub">Owner froze at F1, DAO vote froze at D4</div></div>
              <span className="mono" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Snowflake size={13} className="t3" />{CORE.freezeEpoch}<Dot tone="pos">Open</Dot></span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function Edit({ v, base, on }) {
  const changed = v !== base;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="amt" style={{ border: `1px solid ${changed ? 'var(--c-cau-line)' : 'var(--c-line)'}`, background: changed ? 'var(--c-cau-bg)' : 'var(--c-pane-2)', borderRadius: 7, padding: '3px 4px 3px 7px', transition: 'all .2s' }}>
        <Token sym="NEAR" size={14} />
        <input type="number" step="0.05" value={v} onChange={(e) => on(parseFloat(e.target.value || '0'))} aria-label="NEAR"
          style={{ width: 48, background: 'transparent', border: 0, color: 'var(--c-text)', font: '600 13px var(--f-sans)', fontVariantNumeric: 'tabular-nums', outline: 'none' }} />
        <span className="t3" style={{ fontSize: 12 }}>NEAR</span>
      </span>
      {changed && <span className="mono t3" style={{ fontSize: 11 }}>was {base}</span>}
    </div>
  );
}
