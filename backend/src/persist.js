// Small counters that must survive a process restart (rate limits over hours, daily caps).
// Saved as one JSON file in STATE_DIR (default: the OS temp dir) every 15 s and on SIGTERM, read at start.
// A restart of the process keeps them; a brand-new instance (redeploy, free-plan spin-down) starts from an
// empty file, so the sponsor account's own testnet balance stays the hard cap behind the guest day cap.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE = () => join(process.env.STATE_DIR || tmpdir(), 'nearcarta-counters.json');
const parts = new Map(); // name -> { dump, load }
let saved = null, timer = null;
function read() { if (saved) return saved; try { saved = JSON.parse(readFileSync(FILE(), 'utf8')) || {}; } catch { saved = {}; } return saved; }
export function save() {
  if (!parts.size) return;
  const out = {}; for (const [n, p] of parts) { try { out[n] = p.dump(); } catch {} }
  try { mkdirSync(process.env.STATE_DIR || tmpdir(), { recursive: true }); const f = FILE(); writeFileSync(f + '.tmp', JSON.stringify(out)); renameSync(f + '.tmp', f); } catch (e) { console.error('counters not saved:', e.code || 'error'); }
}
export function persist(name, dump, load) {
  if (process.env.NODE_ENV === 'test' && !process.env.PERSIST_IN_TEST) return;
  parts.set(name, { dump, load });
  const v = read()[name]; if (v != null) { try { load(v); } catch {} }
  if (!timer) { timer = setInterval(save, 15e3); timer.unref?.(); process.once('SIGTERM', () => { save(); process.exit(0); }); }
}
export const _resetPersist = () => { parts.clear(); saved = null; };
