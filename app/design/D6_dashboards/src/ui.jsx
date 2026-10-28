import React from 'react';
import { ArrowUpRight, Check, Clock, X, Minus, ArrowRight, Info, FlaskConical } from 'lucide-react';
import { TOKEN_SVG } from './tokenIcons.js';
import { NB } from './data.js';

export const short = (h, a = 6, b = 4) => (h && h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);

export function Token({ sym, size = 18, net }) {
  const key = { wNEAR: 'NEAR', 'NEAR USDC': 'USDC', 'Base USDC': 'USDC' }[sym] || sym;
  const svg = TOKEN_SVG[key];
  const t = svg
    ? <span className="tok" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
    : <span className="tok" style={{ width: size, height: size, background: 'var(--c-pane-3)', fontSize: size * 0.4, fontWeight: 700 }}>{sym?.[0]}</span>;
  if (!net) return t;
  const n = TOKEN_SVG['net:' + net];
  return (
    <span className="tok-stack" style={{ width: size, height: size }}>
      {t}
      {n && <span className="tok net" style={{ width: size * 0.48, height: size * 0.48 }} dangerouslySetInnerHTML={{ __html: n }} />}
    </span>
  );
}

export function Amt({ v, sym = 'NEAR', size = 16, net, dim, strong = true }) {
  const val = v === null || v === undefined ? '—' : v;
  return (
    <span className="amt">
      <Token sym={sym} size={size} net={net} />
      {strong ? <b>{val}</b> : <span>{val}</span>}
      <span className={dim === false ? '' : 't3'}>{sym}</span>
    </span>
  );
}

const TONE = { allowed: 'pos', confirmed: 'pos', ok: 'pos', allow: 'pos', denied: 'crit', block: 'crit', escalated: 'cau', warn: 'cau', frozen: 'crit', pending: 'cau', neutral: 'neu' };
export function Dot({ tone = 'neu', children, live }) {
  return <span className={`dot ${TONE[tone] || tone} ${live ? 'live' : ''}`}><i />{children}</span>;
}

const PROOF = {
  verified: ['pos', Check, 'Verified'],
  pending: ['cau', Clock, 'Pending'],
  gateway: ['cau', Clock, 'Gateway only'],
  failed: ['crit', X, 'Check failed'],
  external: ['crit', ArrowUpRight, 'External'],
  none: ['neu', Minus, 'No proof'],
  notrec: ['neu', Minus, 'Not recorded'],
};
export function Proof({ kind, label }) {
  const [tone, I, word] = PROOF[kind];
  return <span className={`tag ${tone}`}><I size={12} strokeWidth={2.4} />{label || word}</span>;
}

export function Ev({ src, tx, label }) {
  if (src === 'sample') return <span className="ev sample" title="Invented values that show the layout. Not a proof.">Sample data</span>;
  if (src === 'sandbox') return <span className="ev" title="near-workspaces sandbox, not a public network"><FlaskConical size={11} />Sandbox</span>;
  if (src === 'live') return <span className="ev" title="Live keyless read during research">{label || 'Live read'}</span>;
  if (src === 'preview') return <span className="ev sample">Design preview</span>;
  return tx
    ? <a className="ev" href={NB(tx)} target="_blank" rel="noreferrer">{label || 'Testnet tx'}<ArrowUpRight size={11} /></a>
    : <span className="ev">{label || 'Testnet'}</span>;
}

export function Tx({ h, a = 6, b = 4 }) {
  if (!h) return <span className="t3 mono">—</span>;
  return <a className="txl" href={NB(h)} target="_blank" rel="noreferrer" title={h}>{short(h, a, b)}<ArrowUpRight size={11} /></a>;
}

export function Card({ title, icon: I, right, children, className = '', flush, style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || right) && (
        <header className="ch">
          {title && <h3>{I && <I size={15} strokeWidth={2} />}{title}</h3>}
          {right && <div className="r">{right}</div>}
        </header>
      )}
      <div className={`cb ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function PageHead({ kicker, title, sub, children, icon: I }) {
  return (
    <div className="ph">
      <div className="tl">
        <div className="kick">{I && <I size={13} />}{kicker}</div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="acts">{children}</div>
    </div>
  );
}

export function Meter({ value, max, mark, tone, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <div className={`fill ${tone || ''}`} style={{ width: pct + '%' }} />
      {mark !== undefined && <div className="mark" style={{ left: `calc(${(mark / max) * 100}% - 1px)` }} />}
    </div>
  );
}

export function Steps({ items }) {
  const icon = (s) => (s === 'done' ? <Check size={12} strokeWidth={3} /> : s === 'fail' ? <X size={12} strokeWidth={3} /> : s === 'wait' ? <Clock size={11} strokeWidth={2.5} /> : <Minus size={11} />);
  return (
    <div className="steps">
      {items.map((it, i) => (
        <div key={i} className={`step ${it.s || ''}`}>
          <div className="b">{it.s === 'plan' ? <span className="mono" style={{ fontSize: 10.5, fontWeight: 600 }}>{it.n}</span> : icon(it.s)}</div>
          <div><div className="t">{it.t}</div>{it.d && <div className="d">{it.d}</div>}</div>
          <div>{it.r}</div>
        </div>
      ))}
    </div>
  );
}

export function Note({ children, icon: I = Info }) {
  return <div className="note"><I size={14} /><div>{children}</div></div>;
}

export { ArrowRight };
