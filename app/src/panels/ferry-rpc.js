// The browser's RPC for reading balances.
//
// `shared/vault/tx.js` is not served to the browser (only some shared files are copied into the
// build), so the panel cannot import it. This is the thinnest possible client for the two view
// calls a balance needs, built on the same JSON-RPC shape and pointed at the same endpoints the
// rest of the town uses.

const DEFAULT_URLS = ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'];

export function ferryRpc({ urls = globalThis.NEARCARTA_RPC_URLS || DEFAULT_URLS, fetchImpl = fetch } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  let id = 0;
  return async (method, params) => {
    let last = null;
    for (const url of list) {
      try {
        const r = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        const j = await r.json();
        if (j?.error) { last = new Error(j.error?.cause?.name || j.error?.message || 'rpc error'); continue; }
        return j?.result ?? null;
      } catch (e) { last = e; }
    }
    throw last || new Error('no rpc endpoint answered');
  };
}
