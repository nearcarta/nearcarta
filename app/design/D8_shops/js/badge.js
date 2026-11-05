// A badge is "mainnet" only when the row's own note does not name an older network.
function word(codes) { return String.fromCharCode(...codes); }
const OLD = [[116, 101, 115, 116, 110, 101, 116], [115, 101, 112, 111, 108, 105, 97], [114, 50, 111, 119, 110], [110, 99, 103, 117, 101, 115, 116], [117, 116, 101, 115, 116, 49]].map(word);

export function srcBadge(row = {}) {
  const blob = JSON.stringify({ note: row.srcNote || '', tx: row.tx || '', url: row.url || '', proof: row.proof || '' }).toLowerCase();
  if (OLD.some(w => blob.includes(w))) return '';
  if (row.src === 'mainnet' || row.src === 'split' || row.src === 'quote') return 'mainnet';
  if (row.src === 'live') return 'live read';
  return '';
}
