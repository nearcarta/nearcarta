// The judges page and the live console read these words from here, so the script and the buttons stay the same.

export const FERRY_BUTTON = 'Get dry quote';

export const FERRY_PASS = [
  { id: 'signature', label: '1Click signature (ed25519, manager key)' },
  { id: 'echo', label: 'Echo guard: every field we asked for came back unchanged' },
  { id: 'dry', label: 'Dry: no deposit address, nothing can be sent' },
];

export const PRIVACY = [
  { value: 'public', label: 'public' },
  { value: 'basic', label: 'confidential (basic)' },
  { value: 'advanced', label: 'confidential (advanced)' },
];

export function chronicleRowsFromMainnet(d) {
  const b = d?.board || {};
  const txs = b.txs || {};
  const v = b.visitor_run?.txs || {};
  return [
    { what: 'Board allowed', method: 'propose', h: txs['allowed_0.001'], result: 'allowed' },
    { what: 'Board refused, over cap', method: 'propose', h: txs.refused_over_per_action_cap, result: 'denied' },
    { what: 'Board refused, off list', method: 'propose', h: txs.refused_receiver_not_allowlisted, result: 'denied' },
    { what: 'Visitor allowed', method: 'propose', h: v['propose_allowed_0.001'], result: 'allowed' },
    { what: 'Visitor refused, over cap', method: 'propose', h: v['propose_refused_0.01_over_per_action_cap'], result: 'denied' },
  ];
}

export function chronicleSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const allowed = list.filter(r => r.result === 'allowed' || r.decision === 'allowed').length;
  const refused = list.length - allowed;
  const word = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return `${word(allowed, 'allowed payment', 'allowed payments')} and ${word(refused, 'refusal', 'refusals')}`;
}

const FAK = '71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt';

export function renderJudges(rows) {
  const list = rows || chronicleRowsFromMainnet({
    board: {
      txs: { 'allowed_0.001': '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR', refused_over_per_action_cap: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF', refused_receiver_not_allowlisted: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ' },
      visitor_run: { txs: { 'propose_allowed_0.001': '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia', 'propose_refused_0.01_over_per_action_cap': 'AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx' } },
    },
  });
  const summary = chronicleSummary(list);
  const pass = FERRY_PASS.map(r => r.label).join(', ');
  const privacy = PRIVACY.find(p => p.value === 'basic')?.label || 'confidential (basic)';
  return `<article class="card judge-step"><span class="n">1</span><div><h2>Ferry quote stays dry</h2>
    <p>Open <a href="/console#ferry">the Ferry tab</a> and press ${FERRY_BUTTON}. You should see three PASS rows: ${pass}. A dry quote has no deposit address.</p></div></article>
    <article class="card judge-step"><span class="n">2</span><div><h2>Confidential quote is still signed</h2>
    <p>On the same <a href="/console#ferry">Ferry tab</a>, set privacy to ${privacy} and quote again. You should see privacy <b>basic</b> echoed back, and the signature check still PASS.</p></div></article>
    <article class="card judge-step"><span class="n">3</span><div><h2>The agent key can only propose</h2>
    <p>Open <a href="/console#guardhouse">Guardhouse</a>. You should see 0 full-access keys, and an agent key whose methods are only <code>propose</code> and <code>propose_batch</code>.</p>
    <p>The full-access key was deleted in <a href="https://nearblocks.io/txns/${FAK}" title="${FAK}">${FAK.slice(0, 10)}…</a>.</p></div></article>
    <article class="card judge-step"><span class="n">4</span><div><h2>Chronicle shows allowed and refused</h2>
    <p data-testid="chronicle-script">Open <a href="/console#chronicle">Chronicle</a>. You should see ${summary}, each linked on nearblocks.io.</p></div></article>
    <article class="card judge-step"><span class="n">5</span><div><h2>Town Hall payments</h2>
    <p>Open <a href="/shops/hall/">Town Hall</a>. You should see the recorded 0.001 NEAR reward marked allowed, and the 0.002 NEAR reward marked refused. A rule change is <code>set_rules</code> on your own row.</p></div></article>`;
}
