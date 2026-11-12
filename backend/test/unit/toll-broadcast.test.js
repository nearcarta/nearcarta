// The toll's foreign leg. On the guest network there is no funded Base Sepolia key, so a signed transaction
// is SHOWN and NOT sent, and the answer says so. A mainnet deployment keeps broadcasting exactly as before.
// Docs: https://docs.base.org/base-chain/quickstart/connecting-to-base
//       https://docs.near.org/chain-abstraction/chain-signatures · https://docs.near.org/api/rpc/transactions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { broadcastLatest } from '../../src/toll-relay.js';

const root = new URL('../../../', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');

const signedRow = { raw_signed: '0x02f8', status: 'signed', tx_hash: '0x' + 'ab'.repeat(32), to: '0x2222222222222222222222222222222222222222', sign_path: 'base-1' };
const policy = { verify_chain: 'Base', allow_to: [], recent: [signedRow] };

test('the guest record says not to broadcast, and the mainnet record does not say it', () => {
  const testnet = JSON.parse(read('shared/deployments/testnet.json'));
  const mainnet = JSON.parse(read('shared/deployments/mainnet.json'));
  assert.equal(testnet.base.broadcast, false);
  assert.equal(testnet.toll.broadcast, false);
  assert.match(testnet.toll.broadcast_note, /not broadcast/);
  // The mainnet record has no such flag, so the mainnet path is unchanged.
  assert.equal(mainnet.base?.broadcast, undefined);
});

test('a signed crossing is shown and not sent when the record says so', async () => {
  let sent = 0;
  const fetchImpl = async () => { sent++; return { ok: true, json: async () => ({ jsonrpc: '2.0', result: '0xDEAD' }) }; };
  // `broadcastOff: true` is what the guest record sets; it is passed explicitly here so the test states the
  // behaviour it is checking rather than inheriting whichever record this process loaded.
  const r = await broadcastLatest({ policy, txs: [signedRow], fetchImpl, broadcastOff: true });
  // One read for the receipt status at most; the raw send is never reached.
  assert.equal(sent <= 1, true, 'the raw transaction send is not called');
  assert.equal(r.claim, 'signed');
  assert.match(r.text, /Signed by NEAR's MPC network/);
  // The explorer link is the *would-be* one: the transaction was never sent, so the card shows where it
  // would appear and says so.
  assert.match(r.text, /not sent/);
  assert.match(r.text, /basescan\.org\/tx\/0xabab/);
  // With the flag off the same row IS handed to the send, so the mainnet path is unchanged.
  sent = 0;
  const live = await broadcastLatest({ policy, txs: [signedRow], fetchImpl, broadcastOff: false });
  assert.equal(sent >= 1, true, 'the mainnet path still sends');
  assert.equal(live.step, 'broadcast');
});
