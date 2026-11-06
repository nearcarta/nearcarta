import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { assembleLive, readLive, _resetLiveCache } from '../../src/chronicle-live.js';
import { formatUnits, presentAmount } from '../../../app/src/chronicle-amount.js';
import { signStatement } from '../../src/chronicle-statement.js';
import { bundleDigest } from '../../../app/src/chronicle-audit.js';

const HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FT = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

test('a live timeline names each source and an empty account stays empty', () => {
  const empty = assembleLive({
    account: 'nobody.near', board: { ok: true, row: null }, indexOk: true, ftOk: true, receipts: [], fts: [], confirmed: [],
  });
  assert.equal(empty.rows.length, 0);
  assert.match(empty.label, /No rows for this account/);
  assert.match(empty.label, /board none, rules missing/);
  assert.match(empty.label, /1click none/);
  assert.match(empty.gaps.join(' '), /rules version: missing/i);
  assert.match(empty.gaps.join(' '), /No 1Click deposit matched/);
  assert.equal(empty.rows.some(r => r.hash), false);

  const live = assembleLive({
    account: 'alice.near',
    boardContract: 'board.nearcarta.near',
    board: { ok: true, row: { owner: 'alice.near' } },
    indexOk: true,
    ftOk: true,
    receipts: [{ hash: HASH, signer: 'alice.near', method: 'TRANSFER', amount: '1 NEAR', at: '2026-11-01T00:00:00.000Z', receiver: 'bob.near', indexerOk: true }],
    fts: [{ hash: FT, symbol: 'USDC', contract: 'wrap.near', amount: '-1 USDC', involved: 'intents.near', affected: 'alice.near', at: '', ok: true, signer: 'alice.near' }],
    confirmed: [{ hash: HASH, ok: true, success: true }],
    indexedCount: 8,
  });
  assert.equal(live.rows.length, 2);
  assert.ok(live.rows.every(r => /^https:\/\/nearblocks\.io\/txns\//.test(r.url)));
  assert.equal(live.rows.find(r => r.hash === FT).source, '1click');
  assert.match(live.label, /1click matched, not a swap/);
  assert.match(live.label, /tx 1\+/);
  assert.equal(live.sources.find(s => s.source === 'rpc').rows, 1);
  assert.match(live.gaps.join(' '), /rules version: missing/i);
});

test('a warm live read is served from cache and confirms receipts with tx status', async () => {
  _resetLiveCache();
  let calls = 0;
  const methods = [];
  const fetchFn = async (url, opts = {}) => {
    calls++;
    if (opts.method === 'POST') {
      methods.push(JSON.parse(opts.body).method);
      return new Response(JSON.stringify({ result: { status: { SuccessValue: '' } } }), { status: 200 });
    }
    const u = String(url);
    if (u.includes('/ft-txns')) return new Response(JSON.stringify({ txns: [] }), { status: 200 });
    if (u.includes('/v1/txns/')) {
      return new Response(JSON.stringify({ txns: [{ signer_account_id: 'alice.near', receiver_account_id: 'bob.near', actions: [{ action: 'TRANSFER', deposit: 1 }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ txns: [{
      transaction_hash: HASH, predecessor_account_id: 'alice.near', receiver_account_id: 'bob.near',
      block_timestamp: '1700000000000000000', actions: [{ action: 'TRANSFER', deposit: 1 }], receipt_outcome: { status: true },
    }] }), { status: 200 });
  };
  const deps = { fetch: fetchFn, view: async () => null, board: 'board.nearcarta.near', index: 'https://index.test', rpc: 'https://rpc.test' };
  const first = await readLive('alice.near', deps);
  const n = calls;
  const t0 = Date.now();
  const second = await readLive('alice.near', deps);
  assert.equal(second.cached, true);
  assert.equal(calls, n);
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(first.rows.some(r => r.hash === HASH && r.url.includes('nearblocks.io')));
  assert.deepEqual(methods, ['EXPERIMENTAL_tx_status']);
  assert.match(first.label, /Live timeline/);
  assert.match(first.gaps.join(' '), /No 1Click deposit matched/);
});

test('a statement without a key is labelled, and a signed one binds the digest', async () => {
  const prev = process.env.NEARAI_CLOUD_API_KEY;
  delete process.env.NEARAI_CLOUD_API_KEY;
  try {
    const plain = await signStatement({ account: 'alice.near', rows: [{ h: HASH }], period: {} });
    assert.equal(plain.mode, 'local-fallback');
    assert.match(plain.status, /Nothing was signed/);
    assert.match(plain.attestation.note, /Local fallback\. Not a NEAR AI signature/);
    assert.equal(plain.signature, '');
  } finally {
    if (prev === undefined) delete process.env.NEARAI_CLOUD_API_KEY;
    else process.env.NEARAI_CLOUD_API_KEY = prev;
  }

  const digest = bundleDigest({ account: 'alice.near', period: {}, rows: [{ h: HASH }] });
  const model = 'test-model';
  let seen = '';
  let built = null;
  const pre = { ok: true, models: [] };
  const signed = await signStatement(
    { account: 'alice.near', rows: [{ h: HASH }], period: {}, totals: { delivered: 1, refunded: 0, attempted: 1 } },
    {
      preflight: async () => pre,
      complete: async (messages) => {
        seen = messages[0].content;
        const reqBody = JSON.stringify({ model, messages });
        const resp = '{"id":"c1"}';
        built = {
          id: 'c1', model, reqModel: model, content: `${digest} Count is one.`,
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          reqSha: createHash('sha256').update(reqBody).digest('hex'),
          respSha: createHash('sha256').update(resp).digest('hex'),
          reqBody,
        };
        return built;
      },
      signature: async () => {
        const text = `${model}:${built.reqSha}:${built.respSha}`;
        const kp = nacl.sign.keyPair();
        const address = Buffer.from(kp.publicKey).toString('hex');
        pre.models = [{ ok: true, signing_algo: 'ed25519', signing_address: address }];
        return {
          available: true, signature_kind: 'provider_tee', signing_algo: 'ed25519', signing_address: address, text,
          signature: Buffer.from(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey)).toString('hex'),
        };
      },
    },
  );
  assert.match(seen, new RegExp(digest));
  assert.equal(signed.mode, 'near-ai');
  assert.equal(signed.digest, digest);
  assert.equal(signed.serverVerified, true);
  assert.match(signed.text, /Historic rules: missing/);
  assert.equal(signed.text.startsWith(digest), false);
  assert.match(signed.text, /^Count is one/);
  assert.match(signed.status, /Nothing was signed on chain/);
  assert.ok(signed.attestation.unverified.some(s => /Intel DCAP/.test(s)));
  assert.equal(/bearer /i.test(signed.requestBody), false);
});

const HASH2 = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

test('a nearblocks 429 falls back to fastnear and the key stays out of the body', async () => {
  _resetLiveCache();
  let auth = '';
  const fetchFn = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nearblocks.io')) {
      if (opts.headers?.authorization) auth = opts.headers.authorization;
      return new Response('slow', { status: 429 });
    }
    if (u.includes('/v0/account')) {
      return new Response(JSON.stringify({ account_txs: [{
        transaction_hash: HASH2, tx_block_timestamp: '1700000000000000000', is_success: true, is_real_signer: true, account_id: 'alice.near',
      }] }), { status: 200 });
    }
    if (u.includes('/v0/transactions')) {
      return new Response(JSON.stringify({ transactions: [{
        transaction: { hash: HASH2, signer_id: 'alice.near', receiver_id: 'bob.near', actions: [{ Transfer: { deposit: '1000000000000000000000000' } }] },
        execution_outcome: { block_timestamp: '1700000000000000000', outcome: { status: { SuccessValue: '' } } },
      }] }), { status: 200 });
    }
    if (u.includes('/ft')) return new Response(JSON.stringify({ account_id: 'alice.near', tokens: [] }), { status: 200 });
    if (opts.method === 'POST') return new Response(JSON.stringify({ result: { status: { SuccessValue: '' } } }), { status: 200 });
    return new Response('no', { status: 500 });
  };
  const deps = {
    fetch: fetchFn, view: async () => null, board: 'board.nearcarta.near', nearblocksKey: 'super-secret-key',
    index: 'https://api.nearblocks.io', fastnearTx: 'https://tx.main.fastnear.com', fastnear: 'https://api.fastnear.com', rpc: 'https://rpc.test',
  };
  const first = await readLive('alice.near', deps);
  assert.ok(first.rows.some(r => r.hash === HASH2 && r.url.includes('nearblocks.io')));
  assert.match(first.health, /transactions fastnear/);
  assert.equal(auth, 'Bearer super-secret-key');
  assert.equal(JSON.stringify(first).includes('super-secret-key'), false);
  const calls = [];
  const wrapped = async (url, opts) => { calls.push(String(url)); return fetchFn(url, opts); };
  const second = await readLive('alice.near', { ...deps, fetch: wrapped });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 0);
});

test('yocto and token units are not shown as whole NEAR', () => {
  assert.equal(formatUnits('1250000000000000000000', 24, 'NEAR'), '0.00125 NEAR');
  assert.equal(formatUnits(1.25e21, 24, 'NEAR'), '0.00125 NEAR');
  assert.equal(presentAmount('1.25e+21 NEAR'), '0.00125 NEAR');
  assert.equal(formatUnits('1000000000000000000000000', 24, 'NEAR'), '1 NEAR');
  assert.equal(formatUnits(-297, 6, 'USDC'), '-0.000297 USDC');
  assert.equal(presentAmount('0.00125 NEAR'), '0.00125 NEAR');
});

test('a chain failure is not called a refusal', async () => {
  _resetLiveCache();
  const HASH3 = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
  const fetchFn = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('nearblocks.io')) return new Response('no', { status: 429 });
    if (u.includes('/v0/account')) {
      return new Response(JSON.stringify({ account_txs: [{
        transaction_hash: HASH3, tx_block_timestamp: '1700000000000000000', is_success: false, is_real_signer: true,
      }] }), { status: 200 });
    }
    if (u.includes('/v0/transactions')) {
      return new Response(JSON.stringify({ transactions: [{
        transaction: { hash: HASH3, signer_id: 'carol.near', receiver_id: 'wrap.near', actions: [{ FunctionCall: { method_name: 'storage_deposit', deposit: '1250000000000000000000' } }] },
        execution_outcome: { block_timestamp: '1700000000000000000', outcome: { status: { Failure: { ActionError: { kind: { AccountDoesNotExist: { account_id: 'carol.near' } } } } } } },
      }] }), { status: 200 });
    }
    if (u.includes('/ft')) return new Response(JSON.stringify({ account_id: 'carol.near', tokens: [] }), { status: 200 });
    if (opts.method === 'POST') return new Response(JSON.stringify({ result: { status: { Failure: {} } } }), { status: 200 });
    return new Response('no', { status: 500 });
  };
  const body = await readLive('carol.near', {
    fetch: fetchFn, view: async () => null, board: 'board.nearcarta.near',
    index: 'https://api.nearblocks.io', fastnearTx: 'https://tx.main.fastnear.com', fastnear: 'https://api.fastnear.com', rpc: 'https://rpc.test',
  });
  const row = body.rows.find(r => r.hash === HASH3);
  assert.ok(row);
  assert.equal(row.decision, 'failed');
  assert.equal(row.amount, '0.00125 NEAR');
  assert.equal(body.rows.some(r => r.decision === 'denied'), false);
});

test('an older page follows the nearblocks cursor and a yocto deposit stays NEAR', async () => {
  _resetLiveCache();
  const seen = [];
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const hashes = Array.from({ length: 25 }, (_, i) => alphabet[i] + 'C'.repeat(42));
  const fetchFn = async (url, opts = {}) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/ft-txns')) {
      return new Response(JSON.stringify({
        txns: [{ transaction_hash: hashes[0], delta_amount: -297, ft: { symbol: 'USDC', decimals: 6, contract: 'usdc.near' }, outcomes: { status: true } }],
      }), { status: 200 });
    }
    if (u.includes('/txns')) {
      const txns = hashes.map(h => ({
        transaction_hash: h, predecessor_account_id: 'aurora.near', receiver_account_id: 'wrap.near',
        block_timestamp: '1700000000000000000', receipt_outcome: { status: true },
        actions: [{ action: 'FUNCTION_CALL', method: 'storage_deposit', deposit: 1.25e21 }],
      }));
      const body = JSON.stringify({ cursor: 'cursor-2', txns });
      assert.match(body, /1\.25e\+21/);
      return new Response(body, { status: 200 });
    }
    if (opts.method === 'POST') return new Response(JSON.stringify({ result: { status: { Failure: {} } } }), { status: 200 });
    return new Response('no', { status: 500 });
  };
  const deps = {
    fetch: fetchFn, view: async () => null, board: 'board.nearcarta.near',
    index: 'https://api.nearblocks.io', fastnearTx: 'https://tx.main.fastnear.com', fastnear: 'https://api.fastnear.com', rpc: 'https://rpc.test',
  };
  const first = await readLive('aurora.near', deps);
  assert.equal(first.rows.filter(r => r.amount === '0.00125 NEAR').length, 24);
  assert.equal(first.rows.find(r => r.hash === hashes[0]).amount, '-0.000297 USDC');
  assert.equal(first.nextCursor, 'cursor-2');
  assert.equal(first.rows.length, 25);
  const older = await readLive('aurora.near', { ...deps, cursor: 'cursor-2', more: true });
  assert.ok(seen.some(u => u.includes('cursor=cursor-2')));
  assert.equal(older.cached, false);
});

test('an unanswered timeline is not cached', async () => {
  _resetLiveCache();
  let n = 0;
  const fetchFn = async () => { n += 1; return new Response('no', { status: 429 }); };
  const deps = {
    fetch: fetchFn, view: async () => { throw new Error('down'); }, board: 'board.nearcarta.near',
    index: 'https://api.nearblocks.io', fastnearTx: 'https://tx.main.fastnear.com', fastnear: 'https://api.fastnear.com', rpc: 'https://rpc.test',
  };
  const first = await readLive('bob.near', deps);
  assert.equal(first.rows.length, 0);
  assert.equal(first.cached, false);
  assert.match(first.health, /transactions none/);
  const seen = n;
  await readLive('bob.near', deps);
  assert.ok(n > seen);
});
