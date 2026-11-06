// Live toll views. Read-only. policy, get_tx. No signature and no broadcast.
// U64 view args are numbers here: a JSON string GuestPanics on deserialize. https://docs.near.org/chain-abstraction/chain-signatures/implementation
import { readFileSync } from 'node:fs';
import { assembleTollLive, describeVisitorPass } from '../../app/src/panels/toll-room.js';
export { describeVisitorPass };

export function tollContractId() {
  const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
  return dep.toll?.contract || '';
}

export function tollLiveError(e) {
  return { ok: false, error: String(e?.message || 'live toll read failed').slice(0, 180), contract: 'toll.nearcarta.near', recent: [] };
}

export async function readTollLive(call) {
  const contract = tollContractId();
  if (!contract) return { ok: false, error: 'no toll contract', contract: '', recent: [] };
  if (typeof call !== 'function') return { ok: false, error: 'no chain view', contract, recent: [] };
  const policy = await call(contract, 'policy', {});
  const next = Number(policy?.next_nonce || 0);
  const txs = [];
  const start = Number.isFinite(next) ? Math.max(0, next - 3) : 0;
  const end = Number.isFinite(next) ? next : 0;
  for (let n = start; n < end; n++) {
    try {
      // near-sdk u64 rejects JSON strings here (GuestPanic deserialize); numbers work.
      const tx = await call(contract, 'get_tx', { nonce: n });
      if (tx) txs.push(tx);
    } catch { /* a gap in the nonce list is skipped */ }
  }
  return assembleTollLive({ contract, policy, txs });
}
