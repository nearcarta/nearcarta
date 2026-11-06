// Prints the spends that need an owner yes. This process does not sign and does not send.
//
//   node backend/scripts/spend-plan.js
const YOCTO = 10n ** 24n;
const near = n => `${n} NEAR (${(YOCTO * BigInt(Math.round(n * 1e6)) / 1_000_000n).toString()} yoctoNEAR)`;

const plan = [
  {
    id: 'S1',
    action: 'Ferry live deposit, one corridor',
    script: 'node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS',
    cost: 'The token amount you send, plus that chain\'s fee. NEAR gas is not spent by this repo. The row cap is the only limit; there is no product-wide USD cap. The script asks for a deposit address and does not send the deposit.',
    execute: false,
  },
  {
    id: 'S2',
    action: 'Fresh board proposes for Chronicle, Toll and Payouts',
    script: 'not run. Each call is board propose, deposit 0, value taken from the row balance.',
    cost: `Three calls at 0.001 NEAR would move ${near(0.003)} from the row. Gas is paid by the signer and stays under 0.003 NEAR. Not signed here.`,
    execute: false,
  },
  {
    id: 'S3',
    action: 'One mainnet USDC payout',
    script: 'not run. The payout page keeps a USDC row and does not send it.',
    cost: 'The invoice amount. The visitor row sets the limit; there is no product-wide USD cap. No NEAR transfer is attached. Not signed here.',
    execute: false,
  },
  {
    id: 'S4',
    action: 'Shared mainnet council',
    script: 'not built',
    cost: 'Several NEAR of storage. Owner decision. Not signed here.',
    execute: false,
  },
];

console.log(JSON.stringify({ signed: false, sent: false, plan }, null, 2));
