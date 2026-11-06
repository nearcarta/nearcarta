import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cfg, DEP } from '../../src/config.js';
import { HOUSE_SHOP } from '../../../shared/house/shop.js';
import { _resetRpcCache } from '../../src/near.js';
import { makeApp } from '../../src/app.js';

const real = globalThis.fetch, saved = { ...cfg };
const viewResult = v => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { result: [...Buffer.from(JSON.stringify(v))], logs: [] } }), { status: 200 });
// house_deed was never a key in mainnet.json. The routes fall back to the live shop.
const DEED = DEP.house_deed || { contract: HOUSE_SHOP, mint: { gas: '100000000000000', deposit_yocto: '20000000000000000000000' } };
beforeEach(() => { _resetRpcCache(); Object.assign(cfg, { rpc: 'https://p.example', rpcFallbacks: [], rpcRetries: 1, rpcBackoffMs: 1 }); });
afterEach(() => { globalThis.fetch = real; Object.assign(cfg, saved); });

test('deed mint: returns an unsigned mint_deed call for the wallet; no signing on the server', async () => {
  const r = await makeApp().request('/api/house/deed/mint?house=r11house-31474.near');
  assert.equal(r.status, 200);
  const { transaction: t } = await r.json();
  assert.equal(t.receiverId, DEED.contract);
  assert.equal(t.actions[0].params.methodName, 'mint_deed');
  assert.deepEqual(t.actions[0].params.args, { house: 'r11house-31474.near', cap: '50000000000000000000000' });
  assert.equal(t.actions[0].params.deposit, DEED.mint.deposit_yocto);
  assert.equal((await makeApp().request('/api/house/deed/mint?house=' + encodeURIComponent('Bad..x'))).status, 400);
});

test('deed lookup: token by account, 404 with the mint call when there is none', async () => {
  let ask; globalThis.fetch = async (u, init) => { ask = JSON.parse(Buffer.from(JSON.parse(init.body).params.args_base64, 'base64')); const m = JSON.parse(init.body).params.method_name;
    if (m === 'nft_tokens_for_owner') return viewResult(ask.account_id === 'a.near' ? [{ token_id: 'a.near', owner_id: 'a.near' }] : []);
    if (m === 'house_purse') return viewResult({ balance: '1', cap: '1', paid: '0', pays: 0 });
    return viewResult(ask.token_id === 'a.near' ? { token_id: 'a.near', owner_id: 'a.near' } : null); };
  const ok = await makeApp().request('/api/house/deed/a.near');
  assert.equal(ok.status, 200); const j = await ok.json(); assert.equal(j.token.owner_id, 'a.near'); assert.equal(j.purses['a.near'].cap, '1');
  const none = await makeApp().request('/api/house/deed/b.near');
  assert.equal(none.status, 404); assert.equal((await none.json()).mint.actions[0].params.methodName, 'mint_deed');
});

test('the deed routes name the live shop, not a config key that never existed', async () => {
  assert.equal(DEP.house_deed, undefined);
  assert.equal(DEED.contract, HOUSE_SHOP);
  assert.equal(HOUSE_SHOP, 'house.nearcarta.near');
  const r = await makeApp().request('/api/house/deed/mint');
  assert.equal(r.status, 200);
  const { transaction: t } = await r.json();
  assert.equal(t.receiverId, 'house.nearcarta.near');
  assert.equal(t.actions[0].params.methodName, 'mint_deed');
  assert.equal(t.actions[0].params.deposit, '20000000000000000000000');
});
