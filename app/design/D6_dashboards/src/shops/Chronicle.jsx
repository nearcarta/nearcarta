import React, { useState } from 'react';
import { ScrollText, Filter, Terminal, KeyRound, ShieldCheck, Snowflake, FileCog, ArrowUpCircle, Check, X, Hourglass, Copy, ExternalLink } from 'lucide-react';
import { CORE, CORE_TXS, P2_EVENT, NB, NBA } from '../data.js';
import { Card, PageHead, Dot, Ev, Tx, Amt, short } from '../ui.jsx';

const FILTERS = [
  ['all', 'All'], ['action', 'Actions'], ['denied', 'Refusals'], ['gov', 'Governance'],
];
const KIND_ICON = { agent_key: KeyRound, policy: FileCog, freeze: Snowflake, escalation: ShieldCheck, upgrade: ArrowUpCircle };
const match = (t, f) => f === 'all' || (f === 'action' && t.kind === 'action') || (f === 'denied' && t.decision === 'denied') || (f === 'gov' && t.kind !== 'action');

function Mark({ t }) {
  if (t.kind === 'action') {
    const d = t.decision;
    const I = d === 'allowed' ? Check : d === 'denied' ? X : Hourglass;
    const c = d === 'allowed' ? 'var(--c-pos)' : d === 'denied' ? 'var(--c-crit)' : 'var(--c-cau)';
    return <span className="cmark" style={{ color: c, borderColor: c }}><I size={12} strokeWidth={3} /></span>;
  }
  const I = KIND_ICON[t.kind] || ScrollText;
  return <span className="cmark"><I size={12} /></span>;
}

const CURL_TX = `curl -s https://rpc.testnet.near.org \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tx",
       "params":{"tx_hash":"${CORE_TXS.find((t) => t.id === 'P2').tx}",
                 "sender_account_id":"${CORE.oath}",
                 "wait_until":"FINAL"}}' \\
| jq -r '.result.receipts_outcome[].outcome.logs[]'`;

const CURL_CODE = `curl -s https://rpc.testnet.near.org \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"query",
       "params":{"request_type":"view_account",
                 "finality":"final","account_id":"${CORE.oath}"}}' \\
| jq -r .result.code_hash`;

export default function ChronicleView() {
  const [f, setF] = useState('all');
  const [sel, setSel] = useState('P2');
  const [copied, setCopied] = useState('');
  const rows = CORE_TXS.filter((t) => match(t, f));
  const s = CORE_TXS.find((t) => t.id === sel) || CORE_TXS[0];
  const copy = (k, txt) => { navigator.clipboard?.writeText(txt).catch(() => {}); setCopied(k); setTimeout(() => setCopied(''), 1200); };
  return (
    <>
      <PageHead icon={ScrollText} kicker={`Chronicle · ${CORE.oath}`} title="Check every claim without our site"
        sub="Each line is a testnet transaction. The oath logs a NEP-297 event for every decision, so anyone can rebuild this page from a public RPC.">
        <div className="seg" role="tablist">
          {FILTERS.map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}<span className="t3 num" style={{ marginLeft: 4 }}>{CORE_TXS.filter((t) => match(t, k)).length}</span></button>)}
        </div>
      </PageHead>
      <div className="grid">
        <Card className="s7" title="Timeline · 28 Oct 2026, EEST" icon={Filter} right={<Ev label="Testnet" />} flush>
          <div className="ctl">
            {rows.map((t, i) => (
              <button key={t.id} className={`crow ${sel === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)} style={{ animation: `enter .3s var(--ease) both ${Math.min(i, 12) * 0.025}s` }}>
                <span className="mono t3 ctime">{t.time}</span>
                <Mark t={t} />
                <span className="mono t3" style={{ width: 24 }}>{t.id}</span>
                <span className="cwhat">{t.what}</span>
                {t.reason && t.decision !== 'allowed' && <span className="reason" style={{ flex: 'none' }}>{t.reason}</span>}
                <span className="mono t3" style={{ marginLeft: 'auto', flex: 'none', whiteSpace: 'nowrap', fontSize: 11.5 }}>{short(t.tx, 5, 3)}</span>
              </button>
            ))}
          </div>
        </Card>

        <div className="s5" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <Card title={`${s.id} · ${s.time}`} icon={ScrollText} right={<a className="btn sm ghost" href={NB(s.tx)} target="_blank" rel="noreferrer">nearblocks<ExternalLink size={12} /></a>}>
            <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 8 }}>{s.what}</div>
            <div className="kv">
              <span>Tx</span><Tx h={s.tx} a={10} b={6} />
              {s.decision && <><span>Decision</span><Dot tone={s.decision === 'allowed' ? 'pos' : s.decision === 'denied' ? 'crit' : 'cau'}>{s.decision}</Dot></>}
              {s.amount != null && <><span>Amount</span><Amt v={s.amount} size={13} /></>}
              {s.clause && <><span>Clause</span><span className="mono">{s.clause}</span></>}
            </div>
            {s.id === 'P2' ? (
              <>
                <div className="sub" style={{ margin: '12px 0 6px' }}>Event log, exactly as the chain returns it</div>
                <pre className="code" style={{ maxHeight: 210, overflow: 'auto', fontSize: 11 }}>{'EVENT_JSON:' + JSON.stringify(P2_EVENT, null, 1)}</pre>
              </>
            ) : <div className="sub" style={{ marginTop: 12 }}>Open the tx on nearblocks, or run the commands below with this hash.</div>}
          </Card>

          <Card title="Verify from a terminal" icon={Terminal} right={<span className="sub">Public RPC, no key</span>}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}><span className="sub">1 · Read the P2 event</span><button className="btn sm ghost" onClick={() => copy('tx', CURL_TX)}>{copied === 'tx' ? <Check size={12} /> : <Copy size={12} />}{copied === 'tx' ? 'Copied' : 'Copy'}</button></div>
            <pre className="code" style={{ fontSize: 10.5, whiteSpace: 'pre', wordBreak: 'normal' }}>{CURL_TX}</pre>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 6px' }}><span className="sub">2 · Match the deployed code</span><button className="btn sm ghost" onClick={() => copy('code', CURL_CODE)}>{copied === 'code' ? <Check size={12} /> : <Copy size={12} />}{copied === 'code' ? 'Copied' : 'Copy'}</button></div>
            <pre className="code" style={{ fontSize: 10.5, whiteSpace: 'pre', wordBreak: 'normal' }}>{CURL_CODE}</pre>
            <div className="kv" style={{ marginTop: 10 }}>
              <span>Expect</span><span className="mono" style={{ fontSize: 11.5 }}>{CORE.codeHash}</span>
              <span>Account</span><a className="txl mono" href={NBA(CORE.oath)} target="_blank" rel="noreferrer">{CORE.oath}</a>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
