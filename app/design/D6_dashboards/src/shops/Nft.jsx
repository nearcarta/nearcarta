import React from 'react';
import { Package, ArrowRight, ScrollText, ListChecks, Hammer } from 'lucide-react';
import { AGENT_NAME } from '../data.js';
import { Card, PageHead, Amt, Dot, Ev, Steps, Note } from '../ui.jsx';
import { Lamplighter } from '../App.jsx';

function Deed({ size = 220 }) {
  // Generated geometric artwork for the sample item. No image model used.
  const cells = Array.from({ length: 7 * 7 }, (_, i) => i);
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" style={{ borderRadius: 16, display: 'block' }}>
      <rect width="140" height="140" fill="var(--c-pane-2)" />
      {cells.map((i) => {
        const x = i % 7, y = Math.floor(i / 7); const h = (x * 7 + y * 13) % 5;
        return <rect key={i} x={8 + x * 18} y={8 + y * 18} width="14" height="14" rx={h > 2 ? 7 : 3} fill={h === 0 ? 'var(--c-text)' : 'var(--c-line-2)'} opacity={h === 0 ? 0.9 : 0.6 + h * 0.08} />;
      })}
    </svg>
  );
}

export default function NftView() {
  return (
    <>
      <PageHead icon={Package} kicker="NFT Handoff · design preview" title="Hand over an item only after the payment settles"
        sub={<>{AGENT_NAME} would release a NEP-171 token from the House to the buyer under its own clause. This shop is not on chain yet: the oath today moves native NEAR and NEP-141 tokens only.</>}>
        <Ev src="preview" />
      </PageHead>
      <div className="grid">
        <Card className="s5" title="Item" icon={Package} right={<Ev src="sample" />}>
          <div style={{ display: 'flex', gap: 18 }}>
            <div style={{ animation: 'enter .6s var(--ease) both', boxShadow: '0 20px 40px -20px rgba(0,0,0,.6)', borderRadius: 16, border: '1px solid var(--c-line-2)' }}><Deed size={190} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <div><div className="sub">Token</div><div style={{ fontWeight: 650, fontSize: 16 }}>Workshop deed #07</div></div>
              <div><div className="sub">Contract</div><div className="mono">house.nearcarta.near</div></div>
              <div><div className="sub">Standard</div><div className="mono">NEP-171</div></div>
              <div><div className="sub">Price asked</div><Amt v="2.0" size={16} net="near" /></div>
            </div>
          </div>
          <div className="divider" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="chip"><Lamplighter size={14} />House</span><ArrowRight size={14} className="t3" /><span className="chip mono">nearcarta.near</span>
            <span style={{ marginLeft: 'auto' }}><Dot tone="neu">Not started</Dot></span>
          </div>
        </Card>

        <Card className="s7" title="Handoff" icon={ListChecks} right={<span className="sub">Nothing below has run on chain</span>}>
          <Steps items={[
            { s: 'plan', n: 1, t: 'Buyer pays the House', d: '2.0 NEAR arrives; the agent sees it in a settled block, not in a promise', r: <Dot tone="neu">Not run</Dot> },
            { s: 'plan', n: 2, t: 'Agent proposes nft_transfer', d: 'Clause nft: token contract allowlist, receiver = the payer, one token per payment', r: <Dot tone="neu">Not run</Dot> },
            { s: 'plan', n: 3, t: 'Oath checks and emits an event', d: 'Same NEP-297 action / settle events as every other shop', r: <Dot tone="neu">Not run</Dot> },
            { s: 'plan', n: 4, t: 'Buyer owns the token', d: 'nft_token view shows the new owner; the Chronicle links both txs', r: <Dot tone="neu">Not run</Dot> },
          ]} />
          <Note icon={Hammer}>To build: an <span className="mono">nft_transfer</span> payload kind in the oath, a clause type that binds receiver to the payer, and a mainnet run. Until then this page stays a preview.</Note>
        </Card>

        <Card className="s12" title="Clause draft" icon={ScrollText} right={<Ev src="preview" />}>
          <pre className="code">{`clause "nft" {
  kind              = nft_transfer        // NEP-171, not supported by the deployed oath yet
  token_contracts   = ["house.nearcarta.near"]
  receiver          = payer_of(settled_payment)
  per_action        = 1 token
  per_day           = 3 tokens
  over_limit        = refuse               // emits {"event":"action","decision":"denied"}
}`}</pre>
        </Card>
      </div>
    </>
  );
}
