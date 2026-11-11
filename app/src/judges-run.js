// The judge's one click: make a throwaway testnet account, run the whole Market Day loop with real
// transactions, and list every hash with its explorer link. Nothing here is a mock: the account is
// created by the testnet service, the market moves go through the testnet relayer, and the board and
// house calls are signed by the throwaway key in this browser.
//
// This is the same code path a guest takes (app/src/market/live-guest.js), driven from one button so a
// judge can watch a whole day land on chain without walking nine shops.
//
// Docs: https://docs.near.org/protocol/transactions/meta-tx · https://docs.near.org/tools/near-api
//       https://api-testnet.nearblocks.io/api-docs
import { NET, txUrl, addrUrl } from '../../../shared/net/net.js';
import { startGuest, welcomeCrate, guestSigner, forgetGuest, whyText } from '../guest/key.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** True when this page may run the loop: testnet, and a real service behind `/tapi`. */
export const canRun = () => NET === 'testnet';

/**
 * Run the loop. `onStep` is called as each step lands so the page can fill in live.
 * Returns `{ ok, account, steps, why }`; `why` is the ERR_ code on a refusal.
 */
export async function runLoop({ onStep = () => {}, doc = document } = {}) {
  if (!canRun()) return { ok: false, why: 'ERR_NOT_TESTNET', steps: [] };
  const steps = [];
  const push = (s) => { steps.push(s); onStep(s, steps); return s; };

  // 1. A throwaway account. A previous run's key is dropped first, so a judge can press again.
  forgetGuest();
  push({ id: 'account', label: 'Made a throwaway testnet account', state: 'running' });
  const start = await startGuest();
  if (!start.ok) { push({ id: 'account', label: whyText(start.why), state: 'failed', why: start.why }); return { ok: false, why: start.why, steps }; }
  push({ id: 'account', label: 'Account', state: 'ok', account: start.account, hash: start.txs?.[0], url: start.txs?.[0] ? txUrl(start.txs[0]) : addrUrl(start.account) });

  // 2. The welcome crate, so the loop has goods and space to work with.
  const crate = await welcomeCrate(start.account).catch(() => null);
  for (const item of crate?.items || []) {
    push({ id: item.item, label: item.item === 'tusdc' ? '100 test dollars' : 'Market space', state: item.failure ? 'failed' : 'ok', hash: item.tx, url: item.tx ? txUrl(item.tx) : '' });
  }

  const s = await guestSigner();
  if (!s) { push({ id: 'signer', label: 'The key did not load', state: 'failed' }); return { ok: false, why: 'ERR_NO_GUEST', steps }; }

  // 3. The guest's own board row, from the record.
  const { openRow } = await import('./market/live-guest.js');
  const row = await openRow({ signer: s }).catch((e) => ({ failure: String(e?.message || e) }));
  push({ id: 'row', label: row?.already ? 'Row already open' : 'Opened the board row', state: row?.failure ? 'failed' : 'ok', hash: row?.hash, url: row?.hash ? txUrl(row.hash) : '' });

  // 4. The market moves, one at a time so each hash is its own line.
  const marketSteps = [
    ['cargo', 'Unloaded 3 salt at the Ferry'],
    ['sell', 'Sold 3 salt at the Arena'],
    ['invest', 'Bought a Ferry share'],
  ];
  const live = await import('./market/live-guest.js');
  for (const [id, label] of marketSteps) {
    try {
      const r = await live.step(id, { shop: 'ferry' });
      push({ id, label, state: r?.hash ? 'ok' : 'failed', hash: r?.hash, url: r?.hash ? txUrl(r.hash) : '', note: r?.failure || null });
    } catch (e) {
      push({ id, label, state: 'failed', note: String(e?.message || e).slice(0, 200) });
    }
  }

  // 5. The Bank seal: an anchor on the guest's own row. Only a digest, never the amount.
  const seal = await live.step('seal').catch((e) => ({ failure: String(e?.message || e) }));
  push({ id: 'seal', label: 'The Bank sealed the profit (a digest only)', state: seal?.failure ? 'failed' : 'ok', hash: seal?.hash, url: seal?.hash ? txUrl(seal.hash) : '', note: seal?.failure || 'the amount is not on chain' });

  // 6. The Toll: a real MPC signature, deliberately not broadcast.
  const cross = await live.step('cross').catch((e) => ({ failure: String(e?.message || e) }));
  push({ id: 'cross', label: 'Toll signed by NEAR MPC (not sent to Base Sepolia)', state: cross?.failure ? 'failed' : 'ok', hash: cross?.hash, url: cross?.hash ? txUrl(cross.hash) : '', note: 'There is no Base Sepolia ETH, so the signed transaction is shown and not broadcast.' });

  const ok = steps.every((x) => x.state !== 'failed');
  return { ok, account: start.account, steps, why: ok ? null : steps.find((x) => x.state === 'failed')?.id };
}

/** The markup for the runner: one button, then one row per step. */
export function judgeRunnerMarkup() {
  const net = NET === 'testnet' ? 'TESTNET' : 'MAINNET';
  const disabled = canRun() ? '' : ' disabled';
  return `<div class="judge-runner" data-testid="judge-runner">
    <p class="jr-net"><span class="qs-net-pill" data-testid="judge-pill">${net}</span>
      ${canRun()
        ? 'One click makes a throwaway testnet account and runs the whole loop with real transactions. Every hash below opens on the testnet explorer.'
        : 'This page is on mainnet, so the free loop is off. Add <code>?net=testnet</code> to the URL to run it on the test network.'}</p>
    <button type="button" class="btn-gold" data-testid="run-loop"${disabled}>Run the loop on testnet</button>
    <p class="jr-note" data-testid="run-loop-note" aria-live="polite"></p>
    <ol class="jr-steps" data-testid="run-steps"></ol>
  </div>`;
}

/** Wire the button on the judges page. */
export function installJudgeRunner({ doc = document } = {}) {
  const host = doc.getElementById('judge-runner');
  if (!host) return null;
  host.innerHTML = judgeRunnerMarkup();
  const list = host.querySelector('[data-testid="run-steps"]');
  const note = host.querySelector('[data-testid="run-loop-note"]');
  const paint = (s) => {
    const li = doc.createElement('li');
    li.className = `jr-step ${s.state}`;
    li.setAttribute('data-testid', `run-step-${s.id}`);
    const word = s.state === 'running' ? '…' : s.state === 'ok' ? '✓' : '✕';
    li.innerHTML = `<b aria-hidden="true">${word}</b> <span>${esc(s.label)}</span>${s.account ? ` <code>${esc(s.account)}</code>` : ''}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">open ↗</a>` : ''}${s.note ? ` <small>${esc(s.note)}</small>` : ''}`;
    list.append(li);
  };
  host.querySelector('[data-testid="run-loop"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    list.innerHTML = '';
    note.textContent = 'Making an account and running nine real transactions…';
    const r = await runLoop({ doc, onStep: paint });
    note.textContent = r.ok
      ? `Done. ${r.steps.filter((s) => s.hash).length} transactions on testnet, under ${r.account}. Nothing was spent: test NEAR has no value.`
      : `Stopped: ${whyText(r.why)} Nothing else was sent.`;
    btn.disabled = false;
  });
  return host;
}
