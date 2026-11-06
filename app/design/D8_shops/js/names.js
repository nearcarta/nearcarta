// One shop-name map. Every room title reads this.
export const NAME = {
  guard: 'Guardhouse',
  ferry: 'Ferry',
  hall: 'Town Hall',
  bank: 'Mist Bank',
  arena: 'Vault Arena',
  toll: 'Toll Bridge',
  chronicle: 'Chronicle',
  house: 'Your House',
  payouts: 'Payouts',
};
export const TRACK = {
  ferry: 'DeFi',
  bank: 'Privacy',
  chronicle: 'Autonomous Business',
  toll: 'Autonomous Business',
  guard: 'AI Security',
  hall: 'Agent Economy',
  payouts: 'Real-World Money',
  arena: 'Games',
  house: 'Open',
};
// Insert the track under the shop title. Standalone /shops/<id>/ pages use header h1;
// the city tray uses #t-title / #t-label. Charter office (vault) shares House's track.
export function paintTrack(id) {
  const text = TRACK[id === 'vault' ? 'house' : id] || '';
  let el = document.getElementById('t-track');
  if (!el) {
    el = document.createElement('p');
    el.id = 't-track';
    el.dataset.testid = 'shop-track';
    el.className = 'note shop-track';
  }
  el.textContent = text;
  el.hidden = !text;
  if (!el.isConnected) {
    const anchor =
      document.getElementById('t-label') ||
      document.getElementById('t-title') ||
      document.querySelector('header.shop-page h1') ||
      document.querySelector('header.top h1') ||
      document.querySelector('.vault-head h1');
    anchor?.after(el);
  }
}
export const PURPOSE = {
  guard: 'Check a payee before anything is signed',
  ferry: 'A recorded cross-chain swap',
  hall: 'Change the rules on your own row',
  bank: 'A charter check before a payment',
  arena: 'Try to trick the Lamplighter',
  toll: 'Pay the live policy fee, or pay nothing',
  chronicle: 'What the charter allowed and refused',
  house: 'Your rules, on chain',
  payouts: 'Prepare a batch. The live row signs one payment at a time',
};
