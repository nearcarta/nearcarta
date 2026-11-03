// Attested check: the Guardhouse pay clause run by OutLayer in a TEE (outlayer/charter_check, pinned by sha256)
// through the proxy contract contracts/attested_check. Read-only here. The charter never reads this decision:
// its own checks stay the final gate, so if OutLayer is down nothing is allowed and the demo keeps working.
import { DEP } from './config.js';
import { view } from './near.js';

const O = DEP.outlayer;
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
export async function attested() {
  if (!O) return { enabled: false };
  const last = await view(O.proxy, 'get_last', { n: 3 }).catch(() => null);
  const checks = (last || []).map(c => { const o = parse(c.output)?.output || {};
    return { id: c.id, decision: c.decision, receiver: c.receiver, amount: c.amount, reasons: o.reasons || [], input_sha256: o.input_sha256 || null, at_ns: c.at_ns }; });
  return { enabled: true, proxy: O.proxy, outlayer: O.contract, charter: O.charter, clause_id: O.clause_id,
    wasm_sha256: O.checker.sha256, wasm_url: O.checker.url, runs: O.runs, checks, live: last != null,
    final_gate: 'The charter checks every payment itself; this attested decision is an extra, independent proof.' };
}
