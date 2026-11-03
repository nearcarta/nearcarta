import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cfg, DEP } from '../../src/config.js';
import { _resetRpcCache } from '../../src/near.js';
import { makeApp } from '../../src/app.js';

const real = globalThis.fetch, saved = { ...cfg };
const viewResult = v => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { result: [...Buffer.from(JSON.stringify(v))], logs: [] } }), { status: 200 });
beforeEach(() => { _resetRpcCache(); Object.assign(cfg, { rpc: 'https://p.example', rpcFallbacks: [], rpcRetries: 1, rpcBackoffMs: 1 }); });
afterEach(() => { globalThis.fetch = real; Object.assign(cfg, saved); });

test('deed mint: returns an unsigned mint_deed call for the wallet; no signing on the server', async () => {
  const r = await makeApp().request('/api/house/deed/mint?house=r11house-31474.testnet');
  assert.equal(r.status, 200);
  const { transaction: t } = await r.json();
  assert.equal(t.receiverId, DEP.house_deed.contract);
  assert.equal(t.actions[0].params.methodName, 'mint_deed');
  assert.deepEqual(t.actions[0].params.args, { house: 'r11house-31474.testnet', cap: '50000000000000000000000' });
  assert.equal(t.actions[0].params.deposit, '120000000000000000000000');
  assert.equal((await makeApp().request('/api/house/deed/mint?house=' + encodeURIComponent('Bad..x'))).status, 400);
});

test('deed lookup: token by account, 404 with the mint call when there is none', async () => {
  let ask; globalThis.fetch = async (u, init) => { ask = JSON.parse(Buffer.from(JSON.parse(init.body).params.args_base64, 'base64')); const m = JSON.parse(init.body).params.method_name;
    if (m === 'nft_tokens_for_owner') return viewResult(ask.account_id === 'a.testnet' ? [{ token_id: 'a.testnet', owner_id: 'a.testnet' }] : []);
    if (m === 'house_purse') return viewResult({ balance: '1', cap: '1', paid: '0', pays: 0 });
    return viewResult(ask.token_id === 'a.testnet' ? { token_id: 'a.testnet', owner_id: 'a.testnet' } : null); };
  const ok = await makeApp().request('/api/house/deed/a.testnet');
  assert.equal(ok.status, 200); const j = await ok.json(); assert.equal(j.token.owner_id, 'a.testnet'); assert.equal(j.purses['a.testnet'].cap, '1');
  const none = await makeApp().request('/api/house/deed/b.testnet');
  assert.equal(none.status, 404); assert.equal((await none.json()).mint.actions[0].params.methodName, 'mint_deed');
});
