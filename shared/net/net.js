// The one place that knows which network a page is playing on.
//
// Every explorer link, account id, RPC URL and API base goes through this module. A page loads it as a
// raw module (it is copied to /shared/net/net.js by app/build.mjs), so it must stay free of node imports
// and of any package specifier a browser cannot resolve.
//
// The network is chosen once, at load: `?net=testnet` wins, then `localStorage['nearcarta.net']`, then
// mainnet. A recorded mainnet proof link stays mainnet on every page and is labelled "Recorded on
// mainnet": this module never rewrites a recorded hash, only the links the page builds now.
//
// Docs: https://docs.near.org/api/rpc/providers · https://api-testnet.nearblocks.io/api-docs
//       https://docs.base.org/base-chain/quickstart/connecting-to-base (chain ids)
export const NETWORKS = ['mainnet', 'testnet'];

const search = () => {
  try { return globalThis.location?.search || ''; } catch { return ''; }
};
const stored = () => {
  try { return globalThis.localStorage?.getItem('nearcarta.net') || ''; } catch { return ''; }
};

/** `testnet` when the URL says so or the visitor chose it last time; otherwise `mainnet`. */
export function pickNetwork() {
  const q = /[?&]net=([a-z]+)\b/.exec(search());
  const fromQuery = q ? q[1] : '';
  if (NETWORKS.includes(fromQuery)) return fromQuery;
  const saved = stored();
  return NETWORKS.includes(saved) ? saved : 'mainnet';
}

export const NET = pickNetwork();

const D = {
  mainnet: {
    suffix: 'near',
    root: 'nearcarta.near',
    // F64: more than one public node, so a 429 from one moves the read to the next (all allow CORS).
    rpc: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.fastnear.com', 'https://near.drpc.org', 'https://rpc.mainnet.near.org'],
    archivalRpc: 'https://archival-rpc.mainnet.fastnear.com',
    explorer: 'https://nearblocks.io',
    explorerApi: 'https://api.nearblocks.io',
    // The same image answers /api on mainnet and /tapi on testnet, so one page can reach either.
    api: '/api',
    mpc: 'v1.signer',
    guestRow: null,
    base: { chainId: 8453, rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
    // The city's shops. Read from the record at build time; these are the names the page falls back to
    // when a field is missing, so a broken record shows nothing rather than a wrong address.
    shops: {},
  },
  testnet: {
    suffix: 'testnet',
    root: 'nearcarta.testnet',
    rpc: ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'],
    archivalRpc: 'https://archival-rpc.testnet.fastnear.com',
    explorer: 'https://testnet.nearblocks.io',
    explorerApi: 'https://api-testnet.nearblocks.io',
    api: '/tapi',
    mpc: 'v1.signer-prod.testnet',
    guestRow: null,
    base: { chainId: 84532, rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
    shops: {},
  },
};

/** The chosen network's settings. `cfg.shops` is filled by `setShops` from the record. */
export const cfg = { ...D[NET], net: NET, scamLimit: null };

/** Install the shop names and the guest row defaults for the chosen network, from the record. */
export function setShops(shops = {}, guestRow = null) {
  cfg.shops = { ...shops };
  if (guestRow) cfg.guestRow = { ...guestRow };
  // Re-publish so a module that only reads the global (a page served from app/design) sees them too.
  try { globalThis.NEARCARTA_NET.shops = { ...shops }; globalThis.NEARCARTA_NET.guestRow = cfg.guestRow; } catch { /* nothing to publish to */ }
  return cfg;
}

/** A short name as the full account on this network: acct('arena') -> arena.near / arena.nearcarta.testnet. */
export function acct(short) {
  const s = String(short || '').trim();
  if (!s) return '';
  if (cfg.shops[s]) return cfg.shops[s];
  if (s.includes('.')) return s; // already a full name
  return s.includes('nearcarta') ? `${s}.${cfg.suffix}` : `${s}.${cfg.root}`;
}

/** A testnet transaction link for a hash the page just got. An empty hash gives an empty link. */
export function txUrl(hash) {
  const h = String(hash || '').trim();
  return h ? `${cfg.explorer}/txns/${h}` : '';
}

/** A testnet account link. */
export function addrUrl(account) {
  const a = String(account || '').trim();
  return a ? `${cfg.explorer}/address/${a}` : '';
}

/** A link on the foreign chain (Base), for an MPC-signed transaction hash. */
export function baseTxUrl(hash) {
  const h = String(hash || '').trim();
  return h ? `${cfg.base.explorer}/tx/${h}` : '';
}

export function baseAddrUrl(address) {
  const a = String(address || '').trim();
  return a ? `${cfg.base.explorer}/address/${a}` : '';
}

/**
 * The path prefix the API answers on: `/api` on mainnet, `/tapi` on testnet. A page that already has its
 * own origin (`NEARCARTA_API`, an override for a local run) appends this instead of a literal `/api`.
 */
export const API_PATH = cfg.api;

/** `/api/x` on mainnet, `/tapi/x` on testnet. A path that is already prefixed is left alone. */
export function api(path) {
  const p = String(path || '');
  if (p.startsWith('/tapi/')) return cfg.api + p.slice('/tapi'.length);
  if (p.startsWith('/api/')) return cfg.api + p.slice('/api'.length);
  return cfg.api + (p.startsWith('/') ? p : '/' + p);
}

/** True when a recorded link points at mainnet, so a card can say "Recorded on mainnet". */
export const isRecordedMainnet = (url) => /^https:\/\/(www\.)?nearblocks\.io\//.test(String(url || ''));

/**
 * The fetch every page uses for its API. It rewrites `/api/…` to this network's base, so no page has to
 * know which service it is talking to. Anything that is not an `/api/…` path (an absolute URL, or an
 * empty base with the path already added) passes through untouched.
 */
export function apiFetch(path, init) {
  const p = String(path || '');
  const url = /^https?:\/\//.test(p) || !p.includes('/api/') ? p : api(p);
  return globalThis.fetch(url, init);
}

/** Switch the network and remember it. A page that already rendered must reload. */
export function setNetwork(net) {
  if (!NETWORKS.includes(net)) return NET;
  try { globalThis.localStorage?.setItem('nearcarta.net', net); } catch { /* private mode */ }
  return net;
}

/** The link to the other network, keeping the current page. */
export function switchUrl(net = NET === 'testnet' ? 'mainnet' : 'testnet') {
  let href = '';
  try { href = String(globalThis.location?.href || ''); } catch { href = ''; }
  if (!href) return net === 'testnet' ? '?net=testnet' : '?net=mainnet';
  const u = new URL(href);
  u.searchParams.set('net', net);
  return u.pathname + u.search + u.hash;
}

/** The label a card shows: the network word, always visible so a judge can never mistake the two. */
export const networkLabel = () => (NET === 'testnet' ? 'TESTNET' : 'MAINNET');

/**
 * Publish the answer on the page, once. A module the city serves straight from app/design cannot import
 * shared/net/net.js (a relative path out of the served subtree is a module the build never publishes),
 * so it reads this object instead. net.js stays the only place that decides; this is only where it
 * says so.
 */
try {
  globalThis.NEARCARTA_NET = {
    net: NET,
    explorer: cfg.explorer,
    apiPath: cfg.api,
    rpc: cfg.rpc,
    mpc: cfg.mpc,
    base: cfg.base,
    market: cfg.shops.market || (NET === 'testnet' ? 'arena.nearcarta.testnet' : 'arena.nearcarta.near'),
    board: cfg.shops.board || (NET === 'testnet' ? 'board.nearcarta.testnet' : 'board.nearcarta.near'),
    shops: cfg.shops,
    guestRow: cfg.guestRow,
    scamLimit: cfg.scamLimit || null,
    txUrl,
    addrUrl,
    api,
  };
  globalThis.NEARCARTA_API_PATH = cfg.api;
} catch { /* a page with no globals (a unit test) needs nothing published */ }
