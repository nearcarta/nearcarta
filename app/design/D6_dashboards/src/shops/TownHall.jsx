import React from 'react';
import { Vote, FileDiff, History, Gavel, Check, X, ArrowRight } from 'lucide-react';
import { TH, NBA } from '../data.js';
import { Card, PageHead, Amt, Dot, Ev, Tx, Proof } from '../ui.jsx';

const v2 = TH.versions[1], v3 = TH.versions[2];
const DIFF = [
  { k: 'Per-reward cap', a: <Amt v={v2.cap} size={14} />, b: <Amt v={v3.cap} size={14} /> },
  { k: 'Total budget', a: <Amt v={v2.total} size={14} />, b: <Amt v={v3.total} size={14} /> },
  { k: 'Council threshold', a: <span className="num">{v2.threshold} of 2</span>, b: <span className="num">{v3.threshold} of 2</span> },
];

export default function TownHallView() {
  return (
    <>
      <PageHead icon={Vote} kicker="Town Hall · SputnikDAO v2 proposal" title="The oath changes only by vote"
        sub="The agent cannot edit its own oath. A council proposal on the DAO is the only path to set_policy, and every attempt to skip it is refused on chain.">
        <a className="btn ghost" href={NBA(TH.dao)} target="_blank" rel="noreferrer">Open the DAO<ArrowRight size={14} /></a>
      </PageHead>
      <div className="grid">
        <Card className="s7" title={`Proposal ${TH.proposal.id} · tighten the oath to v3`} icon={FileDiff} right={<><Dot tone="pos">Executed</Dot><Ev label="Mainnet" tx={TH.proposal.filed} /></>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span className="tag neu mono">{TH.proposal.tag}</span>
            <span className="sub">filed</span><Tx h={TH.proposal.filed} />
          </div>
          <div className="thead" style={{ gridTemplateColumns: '1.3fr 1fr 24px 1fr', padding: '0 0 8px' }}><span>Clause</span><span>Oath v2</span><span /><span>Oath v3</span></div>
          <div className="rows">
            {DIFF.map((d) => (
              <div key={d.k} className="row" style={{ gridTemplateColumns: '1.3fr 1fr 24px 1fr', padding: '11px 0' }}>
                <span style={{ fontWeight: 550 }}>{d.k}</span>
                <span style={{ opacity: 0.55, textDecoration: 'line-through', textDecorationColor: 'var(--c-crit)' }}>{d.a}</span>
                <ArrowRight size={14} className="t3" />
                <span>{d.b}</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div><div className="sub">Votes</div><div className="big" style={{ fontSize: 28 }}>2 / 2</div></div>
            <div style={{ flex: 1, display: 'grid', gap: 8 }}>
              {TH.proposal.votes.map((h, i) => (
                <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--c-pane-2)', borderRadius: 10, border: '1px solid var(--c-line)' }}>
                  <span className="tag pos"><Check size={11} strokeWidth={3} />Approve</span>
                  <span>Councillor {i + 1}</span>
                  <span style={{ marginLeft: 'auto' }}><Tx h={h} /></span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="s5" title="Oath versions" icon={History} right={<span className="mono t3">{TH.oath}</span>}>
          <div style={{ display: 'grid', gap: 0 }}>
            {[...TH.versions].reverse().map((v, i) => (
              <div key={v.v} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 12, paddingBottom: i < 2 ? 18 : 0, position: 'relative' }}>
                {i < 2 && <span style={{ position: 'absolute', left: 12, top: 26, bottom: 0, width: 1, background: 'var(--c-line-2)' }} />}
                <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 650, background: i === 0 ? 'var(--c-ink)' : 'var(--c-pane-2)', color: i === 0 ? 'var(--c-ink-text)' : 'var(--c-text-2)', border: '1px solid var(--c-line-2)' }}>v{v.v}</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontWeight: 600 }}>{v.how}</b>{i === 0 && <Dot tone="pos">In force</Dot>}<span style={{ marginLeft: 'auto' }}><Tx h={v.tx} /></span></div>
                  <div className="sub" style={{ marginTop: 3 }}>cap {v.cap} N · budget {v.total} N · threshold {v.threshold} of 2{v.deny ? ` · deny ${v.deny}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="s12" title="Attempts to skip the vote" icon={Gavel} right={<span className="sub">{TH.log.filter((l) => !l.ok).length} refused · {TH.log.filter((l) => l.ok).length} allowed · on mainnet</span>} flush>
          <div className="thead" style={{ gridTemplateColumns: '54px 1fr 2fr 1.6fr 1fr' }}><span>Run</span><span>Actor</span><span>Tried</span><span>Result</span><span>Tx</span></div>
          <div className="rows">
            {TH.log.map((l) => (
              <div key={l.id} className="row" style={{ gridTemplateColumns: '54px 1fr 2fr 1.6fr 1fr' }}>
                <span className="mono t3">{l.id}</span>
                <span>{l.who}</span>
                <span className="t2">{l.what}</span>
                <span>{l.ok ? <Dot tone="pos">{l.res}</Dot> : <span className="reason"><X size={11} strokeWidth={3} />{l.res}</span>}</span>
                <span><Tx h={l.tx} /></span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
