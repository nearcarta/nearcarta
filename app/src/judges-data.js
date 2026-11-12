// The judges page and the live console read these words from here, so the script and the buttons stay the same.

export const FERRY_BUTTON = 'Get dry quote';
// A refusal is a transaction the contract made fail on purpose, so the explorer marks it Failed.
export const FAILED_NOTE = 'The explorer shows Failed on purpose: the contract refused this payment.';

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

// Games track: the four lines of the track brief, each with one click to its proof. Status says what is still practice.
export const GAMES = [
  { h: 'NPCs with wallets', href: 'https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ', go: 'Open the refusal', failed: true,
    see: 'The Guardhouse step: the board refuses a payee that is not on its list, on mainnet. In Market Day, tap a keeper for their name, mood and purse.', status: 'Live: nine keeper sub-accounts with board rows and market shops. Keepers restock on TEE-signed NEAR AI decisions; the decision id is on chain (tx 6YiRK25TR8…).' },
  { h: 'Player-owned markets', href: 'https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26', go: 'Open the deed sale',
    see: 'Your House: the deed moves with its purse, so what a player owns is theirs on chain. In Market Day, Invest 10 buys a Ferry share that claims its part of sales.', status: 'Live: Arena stalls rented from the purse and held on chain for 7 days (tx 8JxnSuDg…); a purse buys a Ferry share (tx 3BFDcPwr…).' },
  { h: 'Economy evolves without a dev patch', href: '/?play', go: 'Play Market Day',
    see: 'Sell 3 salt, then Why this price? The price moves with the shelf (price A → B). Finish the day and press Week: a week in a minute, and on day 4 a council vote changes a rule.', status: 'Live: market prices from on-chain stock and demand. The keeper council changed floor_bps 10000 → 9000 on chain by a 5–0 vote, with no code change (tx Gub1q247gy…). Week replays the real moves, then a practice week clearly marked.' },
  { h: 'Players never notice the chain', href: '/?play&receipt', go: 'Open the Receipt',
    see: 'The whole day says coins, purse, share. The chain lives only in the Receipt behind the purse: each step and its real mainnet record.', status: 'Live: sponsored gas. The relayer sends the player-signed moves and pays the gas; the player’s NEAR did not move (tx 2TXeZ4hR…). Google sign-in (Privy) on /setup plays the same account in Market Day, with no popup.' },
];
export function renderGames() {
  return GAMES.map((g, i) => `<article class="card judge-step"><span class="n">${i + 1}</span><div><h2>${g.h}</h2><p>${g.see}</p><p><a class="pill" href="${g.href}"${g.href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''} data-testid="games-proof-${i + 1}">${g.go}</a>${g.failed ? `<span class="why-failed" data-testid="games-failed-note-${i + 1}">${FAILED_NOTE}</span>` : ''}</p><p><small>${g.status}</small></p></div></article>`).join('');
}
