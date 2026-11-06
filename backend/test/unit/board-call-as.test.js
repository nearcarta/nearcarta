import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callAsMessage, confirmMessage, injectRowOwner } from '../../../shared/board/call-as.js';
import * as shared from '../../../shared/board/call-as.js';
import * as browser from '../../../app/src/board-call-as.js';

test('the call-as envelope matches the contract fixture', () => {
  const args = '{"amount":"1","note":{"row_owner":"mallory.near"}}';
  assert.equal(injectRowOwner(args, 'alice.near'), '{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"alice.near"}');
  assert.equal(callAsMessage({
    network: 'mainnet',
    contract: 'charters.nearcarta.near',
    owner: 'alice.near',
    receiver: 'shop.nearcarta.near',
    method: 'ft_transfer',
    args,
    deposit: '1',
    nonce: '0',
    expiry: '99',
    epoch: '0',
    effects: [],
    hold: false,
  }), 'board-call-as-v1|mainnet|charters.nearcarta.near|2|alice.near|shop.nearcarta.near|ft_transfer|b99351d51b134e460c661fda6f7bfedf1ed9ba92d887028a142a14469a2308f3|1|0|99|0|-|exec');
  assert.equal(confirmMessage({
    contract: 'board.nearcarta.near', owner: 'alice.near', actionId: '4', digest: 'ab'.repeat(32),
  }), `board-confirm-v1|board.nearcarta.near|alice.near|4|${'ab'.repeat(32)}|present`);
  assert.throws(() => injectRowOwner('[1]', 'alice.near'), /ERR_ARGS/);
});

// House, Arena and the city import shared/board/call-as.js, which re-exports the
// browser module. Both sides must be the same functions, and the toll helpers
// (which main's own module did not have) must survive the merge on both paths.
test('the shared module and the browser module are the same envelope', () => {
  const names = ['CALL_AS_VERSION', 'BOARD_V2', 'injectRowOwner', 'effectsCanon', 'callAsMessage', 'confirmMessage',
    'refundActionArgs', 'settleArgs', 'unitsOf', 'crossArgs'];
  for (const name of names) {
    assert.ok(name in shared, `shared is missing ${name}`);
    assert.equal(shared[name], browser[name], `${name} differs between the two modules`);
  }
  assert.deepEqual(shared.BOARD_V2, {
    open: 'propose_call_as', confirm: 'confirm_hold', cancel: 'cancel_hold', expire: 'expire_sent', refund: 'refund_action', settle: 'settle',
  });
  assert.equal(shared.CALL_AS_VERSION, '2');
});

// The toll helpers main's module did not have. A row_owner the visitor typed is
// dropped, the real owner is appended, and the shop args hash over that text.
test('the toll helpers survive on both import paths', () => {
  for (const mod of [shared, browser]) {
    assert.equal(mod.unitsOf('0.00001', 18), '10000000000000');
    assert.equal(mod.unitsOf('1', 6), '1000000');
    assert.throws(() => mod.unitsOf('1.0000001', 6));
    const args = mod.crossArgs({
      actionId: '4', chain: 'base', asset: 'native', to: '0x2222222222222222222222222222222222222222',
      amount: '10000000000000', rowBudget: '10000000000000',
    });
    assert.equal(args, '{"action_id":4,"chain":"base","asset":"native","to":"0x2222222222222222222222222222222222222222","amount":"10000000000000","row_budget":"10000000000000"}');
    assert.equal(mod.injectRowOwner(args, 'visitor.near'),
      '{"action_id":4,"chain":"base","asset":"native","to":"0x2222222222222222222222222222222222222222","amount":"10000000000000","row_budget":"10000000000000","row_owner":"visitor.near"}');
    assert.deepEqual(mod.refundActionArgs('visitor.near', 4), { owner: 'visitor.near', action_id: '4' });
    assert.deepEqual(mod.settleArgs('visitor.near', 4), { owner: 'visitor.near', action_id: '4' });
  }
});

// The shared module is imported by the city bundle, so it must not pull in
// node:crypto. Only the re-export is allowed here.
test('the shared module stays free of node built-ins', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../../../shared/board/call-as.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /from\s+['"]node:/);
  assert.doesNotMatch(src, /require\(/);
});

// A static host serves only the built deploy root, which is app/src copied to app/dist.
// A module the city imports raw cannot use a bare specifier unless the page's import
// map names it, and cannot reach outside that root. The Toll tray hung on "Opening…"
// because two of these failed: ../../../shared/guard/board-pay.js 404'd, and
// @noble/hashes did not resolve. Reads app/src so CI needs no build first.
test('browser modules the city imports raw resolve without a bundler', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  // build.mjs copies app/src to the root of dist, and app/design to design/.
  const served = p => `${root}app/src${p}`;
  const design = p => `${root}app/design${p}`;
  // The page's own import map is the only thing that can resolve a bare specifier.
  const town = readFileSync(`${root}app/design/D9_world/index.html`, 'utf8');
  const map = JSON.parse((town.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [, '{"imports":{}}'])[1]);
  const mapped = key => Object.keys(map.imports || {}).some(k => (k.endsWith('/') ? key.startsWith(k) : key === k));
  // Loaded by the browser as modules, not bundled by esbuild. '/design/...' is app/design.
  const entries = ['/board-call-as.js', '/panels/guard-board-pay.js', '/panels/guard-agent.js',
    '/panels/deep.js', '/panels/toll-room.js', '/design/D8_shops/js/apps.js', '/design/D8_shops/js/shopui.js'];
  const fileFor = url => (url.startsWith('/design/') ? design(url.slice('/design'.length)) : served(url));
  // build.mjs also copies whole directories to the deploy root (shared/hall -> /shared/hall).
  // A path there is reachable even though it is not under app/src.
  // Chronicle's rules and receipts are copied the same way; v2.js is bundled by build.mjs,
  // so it is generated rather than a plain copy.
  const COPIES = [['/shared/hall/', `${root}shared/hall/`], ['/shared/chronicle/', `${root}shared/chronicle/`]];
  const onDisk = (url) => {
    const copy = COPIES.find(([prefix]) => url.startsWith(prefix));
    if (copy) return copy[1] + url.slice(copy[0].length);
    return fileFor(url);
  };
  // Generated by app/build.mjs, so they are absent in a source checkout.
  const generated = new Set(['/house-shop.js', '/design/D8_shops/js/wallet.bundle.js', '/config.js', '/shared/hall/v2.js', '/shared/guard/board-pay.js']);
  const seen = new Set();
  const bad = [];
  const walk = (url) => {
    if (seen.has(url)) return;
    seen.add(url);
    if (generated.has(url)) return;
    const file = onDisk(url);
    if (!existsSync(file)) { bad.push(`${url} does not exist in the deploy root`); return; }
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        if (!mapped(spec)) bad.push(`${url} -> ${spec} (bare, not in the import map)`);
        continue;
      }
      // Resolve like a browser: relative to the module, clamped at the origin root.
      const next = new URL(spec, 'https://site' + url).pathname;
      if (generated.has(next)) { walk(next); continue; }
      // Anything that leaves the root resolves to a path the host does not have.
      if (!existsSync(onDisk(next))) { bad.push(`${url} -> ${spec} (${next} is not in the deploy root)`); continue; }
      walk(next);
    }
  };
  for (const e of entries) walk(e);
  assert.deepEqual(bad, [], `unreachable browser imports:\n${bad.join('\n')}`);
});

// The guard board module is imported by a browser module, so the implementation
// has to sit inside the deploy root. shared/ keeps the node import path.
test('the guard board module resolves inside the deploy root', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const src = readFileSync(`${root}app/src/panels/guard-agent.js`, 'utf8');
  assert.match(src, /from '\.\/guard-board-pay\.js'/);
  assert.doesNotMatch(src, /\.\.\/\.\.\/\.\.\/shared\//);
  assert.ok(existsSync(`${root}shared/guard/board-pay.js`));
  assert.match(readFileSync(`${root}shared/guard/board-pay.js`, 'utf8'), /from '\.\.\/\.\.\/app\/src\/panels\/guard-board-pay\.js'/);
  assert.ok(existsSync(`${root}app/src/panels/guard-board-pay.js`), 'the implementation lives in app/src so the browser can load it');
  // The browser copy cannot import @noble: shared/ wires the hash in instead.
  const envelope = readFileSync(`${root}app/src/board-call-as.js`, 'utf8');
  assert.doesNotMatch(envelope, /^\s*import[^;]*from\s*'@noble/m);
  assert.match(envelope, /setSha256Hex/);
  assert.match(readFileSync(`${root}shared/board/call-as.js`, 'utf8'), /setSha256Hex/);
});
