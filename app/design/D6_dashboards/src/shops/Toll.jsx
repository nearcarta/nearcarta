import React from 'react';
import { Coins, Network, ShieldX, Snowflake, Bitcoin, Send, X } from 'lucide-react';
import { MPC, NBA } from '../data.js';
import { Card, PageHead, Token, Dot, Ev, Tx, Steps, Proof, short } from '../ui.jsx';

const EXP = (h) => `https://sepolia.basescan.org/address/${h}`;

export default function TollView() {
  const p = MPC.oathPay;
  return (
    <>
      <PageHead icon={Coins} kicker="Toll · NEAR Chain Signatures" title="Pay on another chain, still under the oath"
        sub={<>The oath checks the payment first, then asks the MPC network to sign a Base Sepolia transaction. No single node holds the key: {MPC.threshold} of {MPC.nodes} must sign.</>}>
        <a className="btn ghost" href={NBA(MPC.oath)} target="_blank" rel="noreferrer">{MPC.oath}</a>
      </PageHead>
      <div className="grid">
        <Card className="s7" title="Payment" icon={Send} right={<Ev label="Testnet" tx={p.tx} />}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '4px 0 16px' }}>
            <Token sym="ETH" net="base" size={44} />
            <div>
              <div className="sub">Amount</div>
              <div style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em' }} className="num">0.00001 <span className="t3" style={{ fontSize: 16 }}>ETH</span></div>
              <div className="sub mono">{p.wei} wei · Base Sepolia</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div className="sub">To</div>
              <a className="txl mono" href={EXP(p.to)} target="_blank" rel="noreferrer">{short(p.to, 8, 6)}</a>
            </div>
          </div>
          <Steps items={[
            { s: 'done', t: 'Oath allows it', d: 'Recipient on the allowlist, value and gas fee under their caps', r: <Tx h={p.tx} /> },
            { s: 'done', t: `MPC network signs · ${p.secs} s`, d: `${MPC.signer} · ECDSA domain 0`, r: <Proof kind="verified" label="Signature returned" /> },
            { s: '', t: 'Broadcast to Base Sepolia', d: 'The signed transaction was not sent in this run', r: <Proof kind="notrec" /> },
            { s: 'done', t: 'Foreign-chain check', d: `Separate run: MPC verified a ${MPC.foreignVerify.chain} tx in ${MPC.foreignVerify.secs} s`, r: <Tx h={MPC.foreignVerify.tx} /> },
          ]} />
        </Card>

        <Card className="s5" title="Signer network" icon={Network} right={<Dot tone="pos">Testnet · read 28 Oct</Dot>}>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div><div className="sub">Nodes</div><div className="big">{MPC.nodes}</div></div>
            <div><div className="sub">Threshold</div><div className="big">{MPC.threshold}</div></div>
            <div><div className="sub">Version</div><div className="big" style={{ fontSize: 22 }}>{MPC.version}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 4, margin: '14px 0' }}>
            {Array.from({ length: MPC.nodes }, (_, i) => (
              <span key={i} style={{ aspectRatio: '1', borderRadius: 4, background: i < MPC.threshold ? 'var(--c-text)' : 'var(--c-line-2)', opacity: i < MPC.threshold ? 0.85 : 1, animation: `enter .4s var(--ease) both ${i * 0.03}s` }} />
            ))}
          </div>
          <div className="sub" style={{ marginBottom: 8 }}>Signature domains</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{MPC.domains.map((d) => <span key={d} className="tag neu mono">{d}</span>)}</div>
          <div className="sub" style={{ marginTop: 12 }}>Direct sign without the oath: <Tx h={MPC.directSign.tx} /> · {MPC.directSign.secs} s</div>
        </Card>

        <Card className="s6" title="Refused before signing" icon={ShieldX} right={<span className="sub">The MPC network was never asked</span>} flush>
          <div className="rows">
            {MPC.refusals.map((r) => (
              <div key={r.tx} className="row" style={{ gridTemplateColumns: '1fr auto' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="tag crit"><X size={11} strokeWidth={3} />Refused</span>{r.what}</span>
                <Tx h={r.tx} />
              </div>
            ))}
            <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Snowflake size={15} className="t2" />Owner freeze, then unfreeze</span>
              <span style={{ display: 'flex', gap: 10 }}><Tx h={MPC.freeze} /><Tx h={MPC.unfreeze} /></span>
            </div>
          </div>
        </Card>

        <Card className="s6" title="Read Bitcoin from NEAR" icon={Bitcoin} right={<Ev label="Testnet" tx={MPC.btcVerify.tx} />}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Token sym="BTC" size={36} />
            <div style={{ minWidth: 0 }}>
              <div className="sub">Bitcoin testnet tx checked by the MPC network</div>
              <div className="mono" style={{ fontSize: 12.5 }}>{short(MPC.btcVerify.btc, 14, 10)}</div>
            </div>
          </div>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 14 }}>
            <div><div className="sub">Confirmations</div><div className="big" style={{ fontSize: 22 }}>{MPC.btcVerify.conf}</div></div>
            <div><div className="sub">Round trip</div><div className="big" style={{ fontSize: 22 }}>{MPC.btcVerify.secs} s</div></div>
            <div><div className="sub">Result</div><div style={{ marginTop: 6 }}><Proof kind="verified" /></div></div>
          </div>
        </Card>
      </div>
    </>
  );
}
