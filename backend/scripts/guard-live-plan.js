// Steps for a person with a funded row. This file does not sign.
export const GUARD_LIVE_STEPS = [
  'Open the town and choose Guardhouse. Stay in the city.',
  'Type your own payee, chain near, asset NEAR, and an amount inside the row cap.',
  'Press Check payee. A block refunds once and does not forward. A warning stays held.',
  'Press Confirm yourself. The agent line must not release a warning.',
  'The check is server-side: age, code hash, lookalike, deny list. There is no TEE signature.',
  'Allow prepares propose_call_as with hold false. A warning prepares it with hold true. Confirm is confirm_hold. Cancel is cancel_hold.',
  'Until scripts/guard-deploy.js --live has run, the guard account is not on mainnet, so Pay does not sign.',
  'Freeze my row is set_frozen with deposit 0. Do not unfreeze from this shop.',
  'Do not call request_execution on outlayer.near.',
].join('\n');

if (import.meta.url === `file://${process.argv[1]}`) console.log(GUARD_LIVE_STEPS);
