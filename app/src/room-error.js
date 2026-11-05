// What a visitor sees when a room or a page fails. Raw engine text stays in the console.

export function roomError(err) {
  const m = String(err?.message || err || '');
  if (/failed to fetch|networkerror|load failed|aborted/i.test(m)) return 'The town API is not reachable just now.';
  if (/^http 5\d\d/.test(m)) return 'The town API is busy. Try again in a moment.';
  if (/cannot read properties|is not a function|is not iterable|unexpected token|reading ['"]/i.test(m)) return 'This room could not load. Try again.';
  if (!m || m.length > 140) return 'This room could not load. Try again.';
  return m;
}

export function showsRawEngineText(text) {
  return /cannot read properties|typeerror|syntaxerror/i.test(String(text || ''));
}
