// The sealed-rule text the board hashes (`oath-hidden-v1`, clause id `pay`).
// `max` is a yoctoNEAR integer or the word `none`. `deny` is account ids, in order.
export function sealText({ contract, deny = [], salt, max = 'none' }) {
  return `oath-hidden-v1|${contract}|pay|${max}|${deny.join(',')}|${salt}`;
}
