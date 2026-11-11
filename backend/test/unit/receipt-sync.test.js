import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = p => readFileSync(new URL(p, import.meta.url), 'utf8');
test('browser receipt.js is the same file as shared/vault/receipt.js', () => {
  assert.equal(r('../../../app/design/D8_shops/js/receipt.js'), r('../../../shared/vault/receipt.js'));
});
test('arena status links a real transaction and does not invent one', () => {
  const tray = r('../../../app/src/panels/arena/tray.js');
  const shop = r('../../../app/design/D8_shops/js/shopui.js');
  // The link goes through the network module, so the same tray serves both networks: on testnet it
  // points at the testnet explorer, on mainnet at nearblocks.io. No hash is invented either way.
  assert.match(tray, /txUrl\(h\)/);
  assert.match(tray, /shared\/net\/net\.js/);
  assert.match(tray, /Nothing was signed/);
  assert.match(shop, /Nothing was signed/);
  assert.match(shop, /netCfg\(\)\.explorer/);
  assert.doesNotMatch(shop, /A\.scam\(/);
});
