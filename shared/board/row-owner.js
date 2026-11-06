// Top-level row_owner only. The board overwrites it after the signature.
// A nested row_owner is not authority. No crypto in this file: the town bundle
// can import it.

export function injectRowOwner(args, owner) {
  const value = JSON.parse(args);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ERR_ARGS');
  const body = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'row_owner') continue;
    body[key] = item;
  }
  body.row_owner = owner;
  return JSON.stringify(body);
}
