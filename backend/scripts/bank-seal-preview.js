// Prints the set_seal text for a visitor row. Does not sign, does not read a key, and does not send a transaction.
// set_seal is a full-access call by the visitor. The session key can call propose and propose_call only.
// After the last row, close_charter (or force_close on a wasm that has it) refunds the visitor, then reap returns the contract to nearcarta.near.
import { readFileSync } from 'node:fs';
import { sealText, revealArgs } from '../../shared/board/bank-seal.js';

const main = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const contract = main.board.contract;
const salt = process.argv[2] || 'previewSalt1';
const maxYocto = process.argv[3] || null;
const deny = (process.argv[4] || '').split(',').map(s => s.trim()).filter(Boolean);
const text = sealText({ contract, maxYocto, deny, salt });
const reveal = revealArgs({ maxYocto, deny, salt });
console.log(JSON.stringify({
  contract,
  method: 'set_seal',
  note: 'The visitor full-access key calls set_seal with sha256(text). This script does not sign. close_charter returns the row. reap runs only after the last row.',
  text,
  reveal,
}, null, 2));
