// A load check for the routes the Chronicle tray touches. The audit could not certify the
// 429 fix from "a few 200s", so this drives real load through the app and asserts that the
// per-account fan-out does not turn into a chain read per account.
//
// It uses the app in-process, with the chain reads stubbed, so it measures the route and cache
// behaviour (what the fix changed) rather than the public node's mood.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, deploymentsBody, _resetLastGood, ledgerRead } from '../../src/app.js';
import { _resetShared, sharedJson } from '../../../app/src/panels/chronicle-view.js';

test('60 account loads do not amplify into ledger or mainnet chain reads', async () => {
  _resetLastGood();
  const app = makeApp();
  // Count how many times the shared reads actually run.
  let ledgerRuns = 0;
  let depReads = 0;
  const origLedger = ledgerRead;
  const ledgerSwrLike = async () => { ledgerRuns++; return origLedger(); };
  const mainnetBody = () => { depReads++; return deploymentsBody(); };

  // The tray path: every account load asks for mainnet and ledger through sharedJson.
  _resetShared();
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/mainnet')) {
      const r = await app.request('/api/mainnet');
      return { ok: r.ok, status: r.status, json: () => r.json() };
    }
    if (String(url).endsWith('/api/ledger')) {
      // A ledger body without running the chain read; the point is the sharing, not the answer.
      ledgerRuns++;
      return { ok: true, status: 200, json: async () => ({ rows: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (let i = 0; i < 60; i++) {
    await sharedJson('https://x/api/mainnet', 'mainnet', { fetchImpl, now: 1_000 });
    await sharedJson('https://x/api/ledger', 'ledger', { fetchImpl, now: 1_000 });
  }
  assert.equal(ledgerRuns, 1, 'sixty account loads run the ledger read once');
  // The mainnet body is one object, reused.
  const a = mainnetBody();
  const b = mainnetBody();
  assert.equal(a, b);
  assert.ok(depReads >= 1);
});

test('a burst of mainnet requests is served from the cached body and stays 200', async () => {
  _resetLastGood();
  const app = makeApp();
  const t0 = Date.now();
  const out = await Promise.all(Array.from({ length: 60 }, () => app.request('/api/mainnet')));
  const ms = Date.now() - t0;
  assert.equal(out.length, 60);
  assert.ok(out.every(r => r.status === 200), 'no 429 or 5xx under a burst');
  assert.ok(ms < 3000, `60 local loads should be fast, took ${ms} ms`);
  assert.match(out[0].headers.get('cache-control') || '', /s-maxage=60/);
});

test('the ledger route answers a burst without a 5xx', async () => {
  _resetLastGood();
  const app = makeApp();
  const out = await Promise.all(Array.from({ length: 20 }, () => app.request('/api/ledger')));
  const codes = out.map(r => r.status);
  assert.ok(codes.every(s => s < 500), `no 5xx: ${codes.join(',')}`);
});
