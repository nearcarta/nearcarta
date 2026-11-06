// Teardown for toll.nearcarta.near. Does not sign and does not send.
// Owner close() with 1 yocto deletes the account. The balance, including storage,
// returns to the owner nearcarta.near. contracts/toll/src/lib.rs close().
// The assistant runs the live transaction. This script only prints the call.
const call = {
  network: 'mainnet',
  contract: 'toll.nearcarta.near',
  method: 'close',
  args: {},
  deposit_yocto: '1',
  signer: 'nearcarta.near',
  sends: false,
  note: 'Predecessor must be the owner. A full-access key must attach 1 yocto. Funds return to nearcarta.near.',
};
console.log(JSON.stringify(call, null, 2));
