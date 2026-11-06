// Teardown note for arena.nearcarta.near. Does not sign and does not send.
// The owner calls close() with 1 yoctoNEAR. The contract deletes the account and
// sends every yocto to the stored owner, nearcarta.near.
// Source: contracts/arena/src/lib.rs close.
const plan = {
  contract: 'arena.nearcarta.near',
  method: 'close',
  deposit_yocto: '1',
  receiver_of_funds: 'nearcarta.near',
  signs: false,
  source: 'contracts/arena/src/lib.rs',
};
console.log(JSON.stringify(plan));
