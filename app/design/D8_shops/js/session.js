// One session for setup and every shop panel.
export const SESSION_KEY = 'nearcarta.setup.v1';

export function sessionAccount(raw) {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
    const id = j && (j.accountId || j.account);
    const ok = typeof id === 'string' && (/^[a-z0-9][a-z0-9._-]*\.near$/.test(id) || /^[a-f0-9]{64}$/.test(id));
    return ok ? id : null;
  } catch { return null; }
}

export function readSessionAccount(storage = globalThis.localStorage) {
  try { return sessionAccount(storage?.getItem(SESSION_KEY)); } catch { return null; }
}

export function tollRefusal(why) {
  const reason = String(why || 'refused');
  let line = `Refused: ${reason}. Nothing was paid.`;
  if (line.length > 140) line = `Refused: ${reason.slice(0, 90)}. Nothing was paid.`;
  return line;
}
