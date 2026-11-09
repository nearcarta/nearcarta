// Steps for a person with a funded row. This file does not sign.
export const GUARD_LIVE_STEPS = [
  'Open the town and choose Guardhouse. Stay in the city.',
  'Type your own payee, chain near, asset NEAR, and an amount inside the row cap.',
  'Press Check payee. A block refunds once and does not forward. A warning stays held.',
  'Press Confirm yourself. The agent line must not release a warning.',
  'The check is server-side: age, code hash, lookalike, deny list. There is no TEE signature.',
  'Allow prepares propose_call_as with hold false. A warning prepares it with hold true. Confirm is confirm_hold. Cancel is cancel_hold.',
  'guard.nearcarta.near IS deployed on mainnet (code GutWQgGC, 0.35366 NEAR locked, no full-access key, pay exported). What is not wired is the tray: pressing Pay builds the board call, it does not call the guard contract, so no NEAR moves from here.',
  'Freeze my row is set_frozen with deposit 0. Do not unfreeze from this shop.',
  'Do not call request_execution on outlayer.near.',
].join('\n');

if (import.meta.url === `file://${process.argv[1]}`) console.log(GUARD_LIVE_STEPS);
