// Chain amounts are smallest units. NEAR is 24 decimals. A token uses its own decimals.
// Nearblocks writes a yocto integer as JSON scientific notation (1.25e+21). That is not 1.25e+21 NEAR.

function expandSci(raw) {
  const m = String(raw || '').trim().match(/^(-?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (!m) return '';
  const frac = m[3] || '';
  const exp = Number(m[4]);
  if (!Number.isInteger(exp) || exp < frac.length || exp > 80) return '';
  return m[1] + m[2] + frac + '0'.repeat(exp - frac.length);
}

function integerDigits(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'bigint') return raw.toString();
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw === 0) return null;
    if (Number.isInteger(raw) && Math.abs(raw) < 1e15) return String(raw);
    return expandSci(raw.toExponential()) || null;
  }
  const s = String(raw).trim();
  if (/^-?\d+$/.test(s)) return s;
  if (/e/i.test(s)) return expandSci(s) || null;
  return null;
}

function trimFrac(text) {
  return String(text || '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Smallest units to a trimmed decimal. Empty when the value is zero or dust below 8 places. */
export function unitsToDecimal(raw, decimals) {
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return '';
  const digits = integerDigits(raw);
  if (digits == null) {
    const human = String(raw ?? '').trim();
    if (/^-?\d+\.\d+$/.test(human)) return trimFrac(human);
    return '';
  }
  const neg = digits.startsWith('-');
  const body = digits.replace('-', '').replace(/^0+/, '') || '0';
  if (body === '0') return '';
  const scale = 10n ** BigInt(dec);
  const v = BigInt(body);
  const whole = v / scale;
  const fracFull = (v % scale).toString().padStart(dec, '0');
  const frac = fracFull.slice(0, 8).replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : String(whole);
  if (text === '0') return '';
  return (neg ? '-' : '') + text;
}

export function formatUnits(raw, decimals, symbol) {
  const text = unitsToDecimal(raw, decimals);
  if (!text) return '';
  return symbol ? `${text} ${symbol}` : text;
}

/** A row amount that arrived as yocto, scientific NEAR, or an already formatted decimal. */
export function presentAmount(amount) {
  const s = String(amount || '').trim();
  if (!s) return '';
  const m = s.match(/^(-?(?:\d+\.\d+[eE][+-]?\d+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))\s+([A-Za-z][A-Za-z0-9.]*)\s*$/);
  if (!m) return s;
  const num = m[1];
  const symbol = m[2];
  if (!/e/i.test(num) && !/^-?\d{16,}$/.test(num)) return s;
  if (symbol.toUpperCase() !== 'NEAR') return s;
  return formatUnits(num, 24, symbol) || s;
}
