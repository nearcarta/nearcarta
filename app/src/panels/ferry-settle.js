// City Ferry settlement: a dry quote, then a deposit address, then a status beat.
// The boat says delivered only when 1Click says SUCCESS.
// propose_call is wrap.near only, and only when the row cap can hold the deposit.
// A function-call key cannot attach NEAR and must not fall through to a wallet.
// There is no product-wide USD cap here: the visitor's row is the only limit.
// Sources: shared/board/session.js FERRY_CALL_TARGETS;
// contracts/charter_board call_text; NEP-141 ft_transfer; wrap.near near_deposit / storage_deposit.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md

export const WRAP = 'wrap.near';
// Primary session settle. The row cap decides whether this fits; when it does not,
// depositPlan falls back to the you-send wallet path instead of a hardcoded USD limit.
// 1Click can still reject a corridor under that cap when the amount is below the
// bridge minimum ("Amount is too low for bridge, try at least N" raw units).
// https://docs.near-intents.org/integration/distribution-channels/1click-api
// wrap.near near_deposit / storage_deposit / ft_transfer:
// https://docs.near.org/tutorials/tokens/creating-a-ft
// The board signs call_text (contracts/charter_board/src/lib.rs) and the session key calls
// propose_call. A function-call key cannot attach NEAR:
// https://docs.near.org/protocol/accounts-contracts/access-keys
export const SESSION_SWAP = {
  from: 'wNEAR@near',
  to: 'USDC@near',
  amt: '0.05',
  fromId: 'wNEAR|near',
  toId: 'USDC|near',
};

/** Plain reason for a 1Click quote or checkout miss. Never says the boat delivered. */
export function explainQuoteMiss(error) {
  const raw = String(error || '').replace(/\s+/g, ' ').trim();
  const low = raw.match(/too low for bridge[^\d]*(\d+)/i);
  if (low) {
    return `Below this corridor's bridge minimum. 1Click asked for at least ${low[1]} raw units. No deposit address. Nothing was sent. The boat has not delivered.`;
  }
  if (/over_row_cap|over_per_action_cap/i.test(raw)) {
    return 'Over what your row allows for one payment. Raise the cap in /setup if you want to send more. No deposit address. Nothing was sent. The boat has not delivered.';
  }
  if (/over_checkout_cap/i.test(raw)) {
    return 'Over the limit your row allows. No deposit address. Nothing was sent. The boat has not delivered.';
  }
  if (/over_daily_budget/i.test(raw)) {
    return 'Over what your row allows for today. Raise the daily budget in /setup if you want to send more. No deposit address. Nothing was sent. The boat has not delivered.';
  }
  if (raw === 'no_usd' || /no usd|has no USD/i.test(raw)) {
    return 'No deposit address. This quote has no USD amount. Nothing was sent. The boat has not delivered.';
  }
  if (!raw) return 'Live quote did not return. No deposit address. Nothing was sent. The boat has not delivered.';
  return `${raw.slice(0, 180)} No deposit address. Nothing was sent. The boat has not delivered.`;
}
// wrap.near storage_balance_bounds.min — 0.00125 NEAR.
export const WRAP_STORAGE_YOCTO = '1250000000000000000000';
// Live near_deposit 6srGqpyujq1qfKvhTsWacj3rGqLJUZh1VcL71MtZ4W5U attached 42 Tgas on the
// previous board (8 Tgas callback). Board v2 forwards 30 Tgas to the shop and 20 Tgas
// to on_called, so the outer transaction prepays 54. 300 Tgas is the wallet default
// and is not used. The allowance is charged on prepaid gas at 0.001 NEAR/Tgas.
// https://docs.near.org/protocol/transactions/gas#buying-vs-burning-gas
export const PROPOSE_CALL_TGAS = 54;
export const PROPOSE_CALL_BYTES = 800;
// Inner burns we measured or budgeted. They sit inside the 30 Tgas the board forwards.
export const INNER_GAS_TGAS = { near_deposit: 10, storage_deposit: 10, ft_transfer: 20 };

export function quoteUsd(q) {
  const raw = q?.from?.usd ?? q?.usd ?? q?.amountInUsd ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * A quote is usable when it has a positive USD amount. There is no product cap: the
 * visitor's row is the limit, and the row cap check happens in depositPlan and again
 * on chain. The backend prices the row's NEAR allowance the same way.
 */
export function mayCheckout(q) {
  const usd = quoteUsd(q);
  if (usd == null) return { ok: false, reason: 'no_usd', usd: null };
  if (usd <= 0) return { ok: false, reason: 'bad_usd', usd };
  return { ok: true, reason: null, usd };
}

export function nearNative(from) {
  const chain = String(from || '').split('@').pop().split('|').pop().toLowerCase();
  return chain === 'near';
}

export function yoctoNear(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
}

/** Same string as contracts/charter_board `call_text`, once args are already sha256-hex. */
export function boardCallText({ contract, owner, receiver, method, argsHash, deposit, nonce }) {
  return `board-call-v1|${contract}|${owner}|${receiver}|${method}|${argsHash}|${deposit}|${nonce}`;
}

// Same split as shared/board/cost.js functionCallAllowanceCost. Kept here so the
// city panel does not import a path the browser cannot serve.
const GAS_PRICE_YOCTO = 100_000_000n;
const GAS_PURCHASE_YOCTO = 1_000_000_000n;
const CALL_SEND = 200_000_000_000n;
const CALL_SEND_PER_BYTE = 47_683_715n;
const CALL_EXEC = 780_000_000_000n;
const CALL_EXEC_PER_BYTE = 2_235_934n;
const RECEIPT_SEND = 108_059_500_000n;
const RECEIPT_EXEC = 108_059_500_000n;

/** Prepaid yocto one zero-deposit propose_call takes from the function-call allowance. */
export function proposeCallPrepaidYocto(tgas = PROPOSE_CALL_TGAS, numBytes = PROPOSE_CALL_BYTES) {
  const bytes = BigInt(numBytes);
  const attached = BigInt(tgas) * 10n ** 12n;
  const burnt = RECEIPT_SEND + CALL_SEND + CALL_SEND_PER_BYTE * bytes;
  const remaining = attached + RECEIPT_EXEC + CALL_EXEC + CALL_EXEC_PER_BYTE * bytes;
  const buy = GAS_PRICE_YOCTO > GAS_PURCHASE_YOCTO ? GAS_PRICE_YOCTO : GAS_PURCHASE_YOCTO;
  return burnt * GAS_PRICE_YOCTO + remaining * buy;
}

/**
 * Tgas the session key attaches for one propose_call.
 *
 * The promise tree is: this outer call pays for the board's own execution (which
 * hydrates the row and writes the counters), then the board forwards `forward` Tgas
 * to the shop and `GAS_CALLBACK` to on_called. The outer prepaid gas has to cover all
 * three, so it was underpaying by the board's own work whenever it was set to
 * `4 + forward + 20`: mainnet refused with "Exceeded the prepaid gas" before the
 * board's function body could even burn its first Tgas (propose_call with a 54 Tgas
 * attach failed on 2026-11-06, tx 6456LV35...).
 *
 * 30 Tgas covers the board's worst case measured on mainnet (a row write plus a call
 * policy write burns under 10), and the forward and callback are the contract's own
 * constants. Keep 100 Tgas of headroom under the 300 Tgas transaction limit.
 */
export const BOARD_SELF_TGAS = 30;
export function proposeCallTgas(method) {
  const inner = INNER_GAS_TGAS[method] || 20;
  const forward = Math.max(30, inner);
  return BOARD_SELF_TGAS + forward + 20;
}

/** Allowance the key must still hold before the first of these steps is sent. */
export function stepsAllowanceYocto(steps) {
  return (steps || []).reduce((n, s) => n + proposeCallPrepaidYocto(proposeCallTgas(s?.method)), 0n);
}

/** True when the live allowance can prepay one propose_call at this gas. */
export function proposeCallAllowanceOk(allowanceYocto, tgas = PROPOSE_CALL_TGAS) {
  try { return BigInt(allowanceYocto) >= proposeCallPrepaidYocto(tgas); }
  catch { return false; }
}

export function shortTx(hash) {
  const h = String(hash || '');
  return h.length > 6 ? `${h.slice(0, 4)}…` : h;
}

/**
 * What to say after propose_call steps. A landed near_deposit is not "nothing was sent".
 * Links are the steps that reached the chain.
 */
export function wrapProgressNote({ amount = '', landed = [], failedReason = '', stranded = false } = {}) {
  const rows = (Array.isArray(landed) ? landed : []).filter(s => s && typeof s.tx === 'string' && s.tx);
  const links = rows.map(s => ({
    hash: s.tx,
    method: s.method || '',
    url: `https://nearblocks.io/txns/${s.tx}`,
    label: `${s.method || 'tx'} ${shortTx(s.tx)}`,
  }));
  const wrap = rows.find(s => s.method === 'near_deposit');
  // "allowance" is the session key's gas budget. `receiver_not_allowlisted` contains
  // "allowlist", which the old test also matched, so a payee problem was reported as a gas
  // problem: measured 2026-11-08, the board refused wrap.near with receiver_not_allowlisted
  // and the page said "Session gas is low ... Refresh the agent key", which would never fix it.
  const reasonText = String(failedReason || '');
  const low = /not_enough_allowance|NotEnoughAllowance/i.test(reasonText)
    || (/\ballowance\b/i.test(reasonText) && !/allowlist/i.test(reasonText));
  const receiverRefused = /receiver_not_allowlisted/i.test(reasonText);
  // `ft_transfer` on a NEP-141 token attaches 1 yoctoNEAR by convention, and the live board
  // applied the row's `min_amount` (0.0001 NEAR) to every deposit, so the last step of a wrap
  // was refused `below_min_amount` after the token had already been registered and wrapped.
  // Measured 2026-11-08, tx 8vz7EkU55ifNaFPARLSFJ6H8eEKAZTBbfTz1WxQqAf4f. The fix that exempts
  // zero-value calls is staged; until it lands the ferry cannot finish on a row with a minimum.
  const belowMin = /below_min_amount/i.test(reasonText);
  const amt = String(amount || '').trim() || '0.05';
  if (wrap) {
    const why = low
      ? 'session gas allowance is low'
      : (String(failedReason || 'the send failed').replace(/\s+/g, ' ').trim().slice(0, 140) || 'the send failed');
    return {
      lowGas: low,
      wrapped: true,
      text: `Wrapped ${amt} NEAR (tx ${shortTx(wrap.tx)}). The send to 1Click did not go: ${why}. Your wNEAR is safe in your row and will be used on the next try.`,
      links,
    };
  }
  if (low && stranded) {
    return {
      lowGas: true,
      wrapped: true,
      text: 'Session gas is low. Your wNEAR is safe in your row and will be used on the next try. Refresh the agent key, then Load cargo again.',
      links,
    };
  }
  if (belowMin && wrap) {
    return {
      lowGas: false,
      wrapped: true,
      belowMin: true,
      text: `Wrapped ${amt} NEAR and registered the deposit address, but the token send was refused below_min_amount: your row has a smallest payment (0.0001 NEAR) and a token transfer attaches 1 yocto. Your wNEAR is safe in your row. The board build that exempts zero-value calls is staged; until it lands, lower the smallest payment in /setup to its floor or use a row without one.`,
      links,
    };
  }
  if (receiverRefused) {
    return {
      lowGas: false,
      wrapped: false,
      receiverRefused: true,
      text: 'This row may not pay wrap.near, so the wrap was not started and no NEAR left the row. Add wrap.near to your allowed shops in /setup if you want the ferry to wrap for you; the charter is the thing refusing, not the boat.',
      links,
    };
  }
  if (low) {
    return {
      lowGas: true,
      wrapped: false,
      text: 'Session gas is low. The wrap was not started, so no NEAR left the row. Refresh the agent key, then Load cargo again.',
      links,
    };
  }
  const why = String(failedReason || 'the charter did not send the wrap').replace(/\s+/g, ' ').trim().slice(0, 160);
  return {
    lowGas: false,
    wrapped: false,
    text: `No wrap was sent: ${why}. No wallet opened. You are not asked to send USDC on Base. The boat has not delivered.`,
    links,
  };
}

export function orderForStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESS') return 'delivered';
  if (s === 'REFUNDED') return 'refunded';
  if (s === 'FAILED') return 'frozen';
  if (s === 'KNOWN_DEPOSIT_TX' || s === 'PROCESSING') return 'transit';
  return 'deposit';
}

/** What the AI popup says when 1Click has delivered. NEAR links are the propose_call txs. destTx is the destination-chain hash. */
export function agentDeliveredNote({ amount, symbol, txs, destTx, destChain } = {}) {
  const sym = String(symbol || 'USDC').trim() || 'USDC';
  const amt = String(amount ?? '').trim();
  const hashes = (Array.isArray(txs) ? txs : []).filter(h => typeof h === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(h));
  const text = amt ? `Delivered ${amt} ${sym}.` : `Delivered ${sym}.`;
  const links = hashes.map(hash => ({
    hash,
    url: `https://nearblocks.io/txns/${hash}`,
    label: `tx ${hash.slice(0, 8)}…`,
  }));
  const dest = destExplorer(destChain, destTx);
  if (dest) links.push(dest);
  return { text, links };
}

/** Sail only the first time status is SUCCESS. A refund does not play delivered. */
export function nextFerryBeat(status, { sailed = false } = {}) {
  const raw = String(status || '').toUpperCase();
  const order = orderForStatus(raw);
  const play = order === 'delivered' && !sailed;
  const terminal = raw === 'SUCCESS' || raw === 'REFUNDED' || raw === 'FAILED';
  return { order, play, sailed: sailed || play, terminal };
}

/**
 * Decimal NEAR/wNEAR string from a yocto integer. Keeps exact fractions like 0.04875.
 */
export function nearAmount(yocto) {
  try {
    const s = BigInt(yocto).toString();
    if (s === '0') return '0';
    if (s.length <= 24) {
      const frac = s.padStart(24, '0').replace(/0+$/, '');
      return frac ? `0.${frac}` : '0';
    }
    const whole = s.slice(0, -24);
    const frac = s.slice(-24).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
  } catch { return null; }
}

/**
 * How much wNEAR this Load cargo should quote and transfer.
 * When wrap.near already holds stranded board balance from an earlier near_deposit
 * (e.g. 0.04875 after storage was kept), spend that and skip a new deposit.
 */
export function pickWrapSpend({ wantAmount, wrapBalanceYocto = null } = {}) {
  const want = yoctoNear(wantAmount);
  if (!want) return { amount: wantAmount == null ? '' : String(wantAmount), amountYocto: null, recover: false };
  let bal = 0n;
  try { if (wrapBalanceYocto != null && wrapBalanceYocto !== '') bal = BigInt(wrapBalanceYocto); } catch { bal = 0n; }
  if (bal <= 0n) return { amount: String(wantAmount), amountYocto: want, recover: false };
  const use = bal < BigInt(want) ? bal : BigInt(want);
  return { amount: nearAmount(use), amountYocto: use.toString(), recover: true };
}

/** NEAR attached to near_deposit so wrap.near credits exactly `transferYocto` wNEAR. */
export function wrapDepositYocto(transferYocto, wrapRegistered) {
  const t = BigInt(transferYocto);
  if (wrapRegistered === false) return (t + BigInt(WRAP_STORAGE_YOCTO)).toString();
  return t.toString();
}

/**
 * NEAR-native corridors can be wrap.near calls from the row.
 * Anything else, or a deposit over the cap, is "you send". wallet is always false.
 *
 * wrapRegistered / wrapBalanceYocto come from wrap.near view calls on the board:
 * - unregistered board: near_deposit keeps WRAP_STORAGE_YOCTO, so attach transfer+storage
 * - stranded wNEAR (wrapBalance >= transfer): skip near_deposit; only storage_deposit + ft_transfer
 */
export function depositPlan({
  from, amount, depositAddress, memo = null, capYocto = null, balanceYocto = null, keyMethods = null,
  wrapRegistered = null, wrapBalanceYocto = null, depositAccountRegistered = null,
} = {}) {
  const you = (why) => ({ kind: 'you-send', why, wallet: false, steps: [], recover: false });
  if (!nearNative(from)) return you('This chain is not wrap.near. Send the tokens yourself to the deposit address.');
  if (Array.isArray(keyMethods) && keyMethods.length && !keyMethods.includes('propose_call')) {
    return you('This session key cannot call propose_call. Send the tokens yourself. No wallet will open.');
  }
  if (!depositAddress) return you('No deposit address yet.');
  const amt = yoctoNear(amount);
  if (!amt) return you('The NEAR amount is not a number. Send the tokens yourself.');
  let cap = null;
  let bal = null;
  let wrapBal = 0n;
  try { if (capYocto != null && capYocto !== '') cap = BigInt(capYocto); } catch { return you('The session cap is not a number.'); }
  try { if (balanceYocto != null && balanceYocto !== '') bal = BigInt(balanceYocto); } catch { bal = null; }
  try { if (wrapBalanceYocto != null && wrapBalanceYocto !== '') wrapBal = BigInt(wrapBalanceYocto); } catch { wrapBal = 0n; }
  const recover = wrapBal >= BigInt(amt);
  const steps = [];
  if (!recover) {
    steps.push({
      receiver: WRAP, method: 'near_deposit', args: '{}',
      deposit: wrapDepositYocto(amt, wrapRegistered),
      gasTgas: proposeCallTgas('near_deposit'),
    });
  }
  if (depositAccountRegistered !== true) {
    steps.push({
      receiver: WRAP, method: 'storage_deposit',
      args: JSON.stringify({ account_id: depositAddress, registration_only: true }),
      deposit: WRAP_STORAGE_YOCTO,
      gasTgas: proposeCallTgas('storage_deposit'),
    });
  }
  steps.push({
    receiver: WRAP, method: 'ft_transfer',
    args: JSON.stringify({ receiver_id: depositAddress, amount: amt, memo: memo || null }),
    deposit: '1',
    gasTgas: proposeCallTgas('ft_transfer'),
  });
  let sum = 0n;
  for (const s of steps) {
    const d = BigInt(s.deposit);
    sum += d;
    if (cap != null && d > cap) return you('That amount is over the session cap. Send it yourself to the deposit address.');
  }
  if (bal != null && sum > bal) return you('The row does not hold enough NEAR for this wrap. Send it yourself to the deposit address.');
  return {
    kind: 'propose_call',
    why: recover ? 'Using stranded wNEAR on the board; no new near_deposit.' : '',
    wallet: false,
    steps,
    recover,
    transferYocto: amt,
  };
}

/** Chain of a "SYM@chain" string, a "SYM|chain" id, or a {chain} token. */
export function chainOf(token) {
  if (token && typeof token === 'object') return String(token.chain || token.blockchain || '').toLowerCase();
  const s = String(token || '');
  if (s.includes('@')) return s.split('@').pop().toLowerCase();
  if (s.includes('|')) return s.split('|').pop().toLowerCase();
  return '';
}

/** Implicit 64-hex account or a named NEAR account. A Zcash unified address is not one. */
export function isNearAccountId(s) {
  return typeof s === 'string' && s.length >= 2 && s.length <= 64
    && (/^[0-9a-f]{64}$/.test(s) || /^([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/.test(s));
}

const EVM_CHAINS = new Set([
  'eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism',
  'pol', 'polygon', 'matic', 'bsc', 'bnb', 'avax', 'avalanche',
  'gnosis', 'scroll', 'linea', 'blast', 'zksync', 'mantle', 'celo', 'ftm', 'fantom',
]);

/** 0x plus 40 hex. Any case is accepted; a checksum is not required. */
export function isEvmAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

export function isSolanaAddress(s) {
  return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export function isBtcAddress(s) {
  return typeof s === 'string' && (/^(bc1)[0-9a-z]{20,87}$/i.test(s) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s));
}

export function isZecAddress(s) {
  return typeof s === 'string' && (/^u1[0-9a-z]{20,200}$/i.test(s) || /^t[13][1-9A-HJ-NP-Za-km-z]{20,80}$/.test(s));
}

/**
 * Destination-chain recipient. Empty is never valid. Nothing here invents an address.
 * EVM is checksum-tolerant: 0x and 40 hex in any case. Solana is base58. BTC and Zcash
 * use their address shapes. Any other chain needs a single token of reasonable length.
 */
export function validateDestAddress(chain, address) {
  const c = String(chain || '').toLowerCase();
  const a = String(address || '').trim();
  if (!a) return { ok: false, address: '', reason: 'Enter the address that should receive the tokens.' };
  if (c === 'near') {
    return isNearAccountId(a)
      ? { ok: true, address: a, reason: '' }
      : { ok: false, address: a, reason: 'That is not a NEAR account.' };
  }
  if (EVM_CHAINS.has(c)) {
    return isEvmAddress(a)
      ? { ok: true, address: a, reason: '' }
      : { ok: false, address: a, reason: 'An EVM address is 0x followed by 40 hex characters.' };
  }
  if (c === 'sol' || c === 'solana') {
    return isSolanaAddress(a)
      ? { ok: true, address: a, reason: '' }
      : { ok: false, address: a, reason: 'That is not a Solana address.' };
  }
  if (c === 'btc' || c === 'bitcoin') {
    return isBtcAddress(a)
      ? { ok: true, address: a, reason: '' }
      : { ok: false, address: a, reason: 'That is not a Bitcoin address.' };
  }
  if (c === 'zec' || c === 'zcash') {
    return isZecAddress(a)
      ? { ok: true, address: a, reason: '' }
      : { ok: false, address: a, reason: 'That is not a Zcash address.' };
  }
  if (a.length >= 8 && a.length <= 256 && !/\s/.test(a)) return { ok: true, address: a, reason: '' };
  return { ok: false, address: a, reason: 'Enter the address on the destination chain.' };
}

const DEST_EXPLORER = {
  base: 'https://basescan.org/tx/',
  eth: 'https://etherscan.io/tx/',
  ethereum: 'https://etherscan.io/tx/',
  arb: 'https://arbiscan.io/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  pol: 'https://polygonscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  matic: 'https://polygonscan.com/tx/',
  sol: 'https://solscan.io/tx/',
  solana: 'https://solscan.io/tx/',
  op: 'https://optimistic.etherscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  bsc: 'https://bscscan.com/tx/',
  btc: 'https://mempool.space/tx/',
  bitcoin: 'https://mempool.space/tx/',
  zec: 'https://blockchair.com/zcash/transaction/',
  zcash: 'https://blockchair.com/zcash/transaction/',
};

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * One status line for a session swap. No deposit address and no raw 1Click help text.
 * SUCCESS names the amount and links each propose_call tx plus the destination explorer.
 */
export function ferryStatusView({ status, amount, symbol, txs, destTx, destChain } = {}) {
  const raw = String(status || '').toUpperCase();
  const hashes = (Array.isArray(txs) ? txs : []).filter(h => typeof h === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(h));
  const links = hashes.map(hash => ({
    hash,
    url: `https://nearblocks.io/txns/${hash}`,
    label: `tx ${hash.slice(0, 8)}…`,
  }));
  const dest = destExplorer(destChain, destTx);
  if (dest) links.push(dest);
  const sym = String(symbol || 'USDC').trim() || 'USDC';
  const amt = String(amount ?? '').trim();
  let text = 'Waiting on 1Click.';
  if (raw === 'SUCCESS') text = amt ? `Delivered ${amt} ${sym}.` : `Delivered ${sym}.`;
  else if (raw === 'REFUNDED') text = 'Refunded. The boat turns back.';
  else if (raw === 'FAILED') text = 'The swap failed. Nothing else is sent.';
  return { text, links, order: raw || 'waiting' };
}

/** The card's single status line: sentence, explorer links, and the 1Click status chip. */
export function ferryStatusHtml(view) {
  const v = view || ferryStatusView({});
  const links = (v.links || []).map(l => `<a class="tx" href="${escHtml(l.url)}" target="_blank" rel="noopener">${escHtml(l.label)}</a>`).join(' ');
  return `${escHtml(v.text)}${links ? ' ' + links : ''} <span class="rc" data-testid="ferry-order-state">order · ${escHtml(v.order)}</span>`;
}

/** Explorer link for a 1Click destination-chain tx. Unknown chains return null. */
export function destExplorer(chain, hash) {
  const h = String(hash || '').trim();
  const prefix = DEST_EXPLORER[String(chain || '').toLowerCase()];
  const ok = /^0x[0-9a-fA-F]{64}$/.test(h) || /^[0-9a-fA-F]{64}$/.test(h) || /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(h);
  if (!prefix || !ok) return null;
  const short = h.length > 12 ? `${h.slice(0, 8)}…` : h;
  return { hash: h, url: prefix + h, label: `${String(chain || '').toLowerCase()} ${short}` };
}

export function shortReceive(address) {
  const s = String(address || '');
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * Who receives the swapped tokens.
 * NEAR destinations use the visitor's NEAR account.
 * Every other chain uses only the address the visitor typed. An empty or invalid
 * address returns '' so a quote cannot fall back to an address they do not own.
 */
export function quoteRecipient(to, me, receiveAt) {
  const chain = chainOf(to);
  if (chain === 'near') return isNearAccountId(me) ? me : '';
  if (!chain) return '';
  const v = validateDestAddress(chain, receiveAt);
  return v.ok ? v.address : '';
}

export function cityCheckoutBody({ pair, recipient, charter, amountYocto, refundTo, visitor, session }) {
  const fromSym = pair.fromSym || String(pair.from || '').split('@')[0];
  const fromChain = String(pair.fromChain || String(pair.from || '').split('@')[1] || '').toLowerCase();
  const toSym = pair.toSym || String(pair.to || '').split('@')[0];
  // Prefer the @chain in pair.to when toChain is missing or a display label (e.g. "NEAR"/"Zcash").
  const toFromPair = chainOf(pair.to);
  const toChainRaw = String(pair.toChain || '').toLowerCase();
  const toChain = (toChainRaw === 'near' || toChainRaw === 'zec' || toChainRaw === 'base' || toChainRaw === 'eth' || toChainRaw === 'arb' || toChainRaw === 'sol')
    ? toChainRaw
    : (toFromPair || toChainRaw);
  const body = {
    from: { symbol: fromSym, chain: fromChain },
    to: { symbol: toSym, chain: toChain },
    amount: String(pair.amt),
    recipient,
    refundTo,
    charter,
    clause_id: 'pay',
    amount_yocto: String(amountYocto),
    privacy: 'public',
  };
  // The charter gate still checks `recipient` (an allowlisted shop).
  // 1Click is paid to swap_recipient: the visitor on NEAR, or the address they typed
  // on any other chain. refundTo stays the visitor's NEAR account for a NEAR origin.
  const swap = quoteRecipient({ chain: toChain }, visitor, pair.receiveAt || '');
  if (swap) body.swap_recipient = swap;
  // Board rows live on the board contract (get_charter { owner }), not on the visitor account.
  if (session === 'board') body.board = true;
  return body;
}

/** The receipt with the latest `at`. A missing time sorts last. Ties keep the earlier row. */
export function newestReceipt(rows) {
  let best = null;
  let bestAt = -1;
  (rows || []).forEach(r => {
    const at = Number(r?.at) || 0;
    if (!best || at > bestAt) { best = r; bestAt = at; }
  });
  return best;
}
