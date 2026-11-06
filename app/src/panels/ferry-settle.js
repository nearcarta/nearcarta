// City Ferry settlement: a dry quote, then a deposit address, then a status beat.
// The boat says delivered only when 1Click says SUCCESS.
// propose_call is wrap.near only, and only when the row cap can hold the deposit.
// A function-call key cannot attach NEAR and must not fall through to a wallet.
// Sources: backend/src/ferry-checkout.js MAX_CHECKOUT_USD; shared/board/session.js FERRY_CALL_TARGETS;
// contracts/charter_board call_text; NEP-141 ft_transfer; wrap.near near_deposit / storage_deposit.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md

export const MAX_CHECKOUT_USD = 0.2;
export const WRAP = 'wrap.near';
// Primary session settle. A dry 1Click quote of 0.05 wNEAR@near → USDC@near is about $0.185,
// under MAX_CHECKOUT_USD, and the origin chain is NEAR so depositPlan returns propose_call.
// 1Click can still reject a different corridor under that USD cap when the amount is below the
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
  if (/over_checkout_cap|over 0\.20/i.test(raw)) {
    return 'Over the 0.20 USD checkout cap. No deposit address. Nothing was sent. The boat has not delivered.';
  }
  if (raw === 'no_usd' || /no usd|has no USD/i.test(raw)) {
    return 'No deposit address. This quote has no USD amount. Nothing was sent. The boat has not delivered.';
  }
  if (!raw) return 'Live quote did not return. No deposit address. Nothing was sent. The boat has not delivered.';
  return `${raw.slice(0, 180)} No deposit address. Nothing was sent. The boat has not delivered.`;
}
// wrap.near storage_balance_bounds.min — 0.00125 NEAR.
export const WRAP_STORAGE_YOCTO = '1250000000000000000000';
// Board forwards 30 Tgas plus an 8 Tgas callback. 42 Tgas leaves a little for propose_call
// itself and buys at about 0.042 NEAR, under the 0.05 session allowance.
export const PROPOSE_CALL_TGAS = 42;

export function quoteUsd(q) {
  const raw = q?.from?.usd ?? q?.usd ?? q?.amountInUsd ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** No deposit address unless the signed quote is known and at most 0.20 USD. */
export function mayCheckout(q) {
  const usd = quoteUsd(q);
  if (usd == null) return { ok: false, reason: 'no_usd', usd: null };
  if (usd <= 0 || usd > MAX_CHECKOUT_USD + 1e-9) return { ok: false, reason: 'over_checkout_cap', usd };
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

/** 0.001 NEAR per Tgas, plus 0.001 NEAR of slack for the receipt fees. */
export function proposeCallAllowanceOk(allowanceYocto, tgas = PROPOSE_CALL_TGAS) {
  try {
    const need = BigInt(tgas) * 10n ** 21n + 10n ** 21n;
    return BigInt(allowanceYocto) >= need;
  } catch { return false; }
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
    });
  }
  if (depositAccountRegistered !== true) {
    steps.push({
      receiver: WRAP, method: 'storage_deposit',
      args: JSON.stringify({ account_id: depositAddress, registration_only: true }),
      deposit: WRAP_STORAGE_YOCTO,
    });
  }
  steps.push({
    receiver: WRAP, method: 'ft_transfer',
    args: JSON.stringify({ receiver_id: depositAddress, amount: amt, memo: memo || null }),
    deposit: '1',
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
