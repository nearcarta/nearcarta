// Ferry on Tidepool (ENV=TIDEPOOL): a real quote -> deposit -> settle on NEAR testnet, plus a refund case,
// each tracked through /v0/status until a final state. Tidepool is a community-run 1Click-compatible
// testnet sandbox: community testnet, not 1Click. Its verifier must run the unmodified near/intents
// defuse v0.4.2 code (sha256 f67f9559…); this script checks the on-chain code hash before any deposit.
// Deposits use ft_transfer_call(verifier, msg = depositAddress) from a wallet balance (INTENTS deposit).
// Usage (testnet only): WALLET_KEY_FILE=... OUT=judges/proofs/ferry-tidepool.json node backend/scripts/ferry-tidepool.js [success|refund|all]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { cfg } from '../src/config.js';
import { view } from '../src/near.js';
import { TIDEPOOL, tidepoolVerifierOk } from '../src/ferry.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env, CASE = process.argv[2] || 'all';
const provider = new JsonRpcProvider({ url: cfg.rpc });
const k = JSON.parse(readFileSync(E.WALLET_KEY_FILE, 'utf8'));
const me = new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key));
const out = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { label: 'community testnet, not 1Click', api: TIDEPOOL.api, wallet: me.accountId, cases: {} };
const save = () => writeFileSync(E.OUT, JSON.stringify(out, null, 1) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function api(method, path, body) {
  const r = await fetch(TIDEPOOL.api + path, { method, headers: { 'content-type': 'application/json', 'user-agent': 'nearcarta-ferry' }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`${method} ${path} ${r.status}: ${j?.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

const v = await tidepoolVerifierOk();
out.verifier_check = { ...v, at: new Date().toISOString() }; save();
if (!v.ok) { console.error('verifier code hash is not the defuse v0.4.2 release; stopping', JSON.stringify(v)); process.exit(3); }
const tokens = await api('GET', '/v0/tokens');
const USDC = tokens.find(t => t.symbol === 'USDC' && t.blockchain === 'near'), WNEAR = tokens.find(t => t.symbol === 'wNEAR');
const usdcContract = USDC.contractAddress || USDC.assetId.replace(/^nep141:/, '');
const bal = async () => BigInt(await view(usdcContract, 'ft_balance_of', { account_id: me.accountId }).catch(() => '0'));
if (await bal() < 5_000_000n) {
  try { out.faucet = await api('POST', '/v0/faucet', { accountId: me.accountId, mode: 'wallet' }).then(j => ({ ok: true, at: new Date().toISOString(), drips: j?.drips?.map?.(d => ({ token: d.token || d.symbol, amount: d.amount, tx: d.tx || d.txHash })) ?? null })); }
  catch (e) { out.faucet = { ok: false, error: e.message }; }
  save(); say('faucet', JSON.stringify(out.faucet));
  for (let i = 0; i < 20 && await bal() < 5_000_000n; i++) await sleep(3000);
}
say('wallet USDC', String(await bal()));

const quote = (deadlineMs, amount) => api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: USDC.assetId, destinationAsset: WNEAR.assetId,
  amount, depositType: 'INTENTS', refundTo: me.accountId, refundType: 'INTENTS', recipient: me.accountId, recipientType: 'INTENTS',
  deadline: new Date(Date.now() + deadlineMs).toISOString() });
async function deposit(depositAddress, amount) {
  const r = await me.signAndSendTransaction({ receiverId: usdcContract, waitUntil: 'FINAL', throwOnFailure: false, actions: [
    actions.functionCall('ft_transfer_call', { receiver_id: TIDEPOOL.verifier, amount, msg: depositAddress }, 100n * 10n ** 12n, 1n)] });
  const fail = r.receipts_outcome.find(o => o.outcome.status.Failure);
  if (fail) throw new Error('deposit failed: ' + JSON.stringify(fail.outcome.status.Failure).slice(0, 300));
  await api('POST', '/v0/deposit/submit', { txHash: r.transaction.hash, depositAddress, nearSenderAccount: me.accountId }).catch(e => say('submit', e.message));
  return r.transaction.hash;
}
async function watch(name, depositAddress, timeoutMs = 300_000) {
  let last; const t0 = Date.now(), seen = [];
  while (Date.now() - t0 < timeoutMs) {
    const st = await api('GET', `/v0/status?depositAddress=${depositAddress}`);
    if (st.status !== last) { last = st.status; seen.push({ status: st.status, at: new Date().toISOString() }); say(`[${name}] ${st.status}`); }
    if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(st.status)) return { seen, final: st };
    await sleep(4000);
  }
  return { seen, final: null, timeout: true };
}
const trim = st => st && ({ status: st.status, updatedAt: st.updatedAt, swapDetails: st.swapDetails && Object.fromEntries(Object.entries(st.swapDetails).filter(([key]) =>
  /amount|Amount|refund|Refund|Hashes|txHashes|nearTxHashes|originChainTxHashes|destinationChainTxHashes|intentHashes/.test(key))) });

async function run(name, deadlineMs, part) {
  if (out.cases[name]?.final) return;
  const q = await quote(deadlineMs, '2000000');
  const { depositAddress, amountIn, minAmountIn, amountOut, deadline } = q.quote;
  const amt = part ? (BigInt(amountIn) / 2n).toString() : amountIn;
  say(`[${name}] quote`, depositAddress, 'in', amountIn, 'out', amountOut, 'deadline', deadline);
  const tx = await deposit(depositAddress, amt);
  say(`[${name}] deposit ${amt} https://testnet.nearblocks.io/txns/${tx}`);
  const w = await watch(name, depositAddress);
  out.cases[name] = { depositAddress, quote: { amountIn, minAmountIn, amountOut, deadline, signature: q.signature ? 'present (Tidepool maker key, not 1Click)' : null },
    deposited: amt, deposit_tx: tx, statuses: w.seen, final: trim(w.final), timeout: w.timeout || undefined,
    track: `${TIDEPOOL.api}/v0/status?depositAddress=${depositAddress}` };
  save(); say(`[${name}] final`, JSON.stringify(out.cases[name].final).slice(0, 400));
}
if (CASE === 'success' || CASE === 'all') await run('success', 600_000, false);
if (CASE === 'refund' || CASE === 'all') await run('refund_partial_deposit', 75_000, true);
