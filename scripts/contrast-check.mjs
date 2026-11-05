// Espresso and brass. Body text is at least 4.5:1. Large text and UI chrome are at least 3:1.
const pairs = [
  ['ink on panel', '#FFF8EE', '#1A1410', 4.5],
  ['title on panel', '#FFFFFF', '#1A1410', 4.5],
  ['muted on panel', '#D4C4A8', '#1A1410', 4.5],
  ['brass on panel', '#E2B35B', '#1A1410', 3],
  ['label on brass', '#2A1608', '#E2B35B', 4.5],
  ['refusal on no-bg', '#F0D0C8', '#2A1210', 4.5],
  ['dim on panel', '#A89272', '#1A1410', 3],
];
const lin = c => {
  const n = parseInt(c.slice(1), 16);
  const ch = i => { const v = ((n >> (8 * i)) & 255) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(2) + 0.7152 * ch(1) + 0.0722 * ch(0);
};
const ratio = (a, b) => { const [x, y] = [lin(a), lin(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let bad = 0;
for (const [name, fg, bg, min] of pairs) {
  const r = ratio(fg, bg);
  const ok = r + 1e-9 >= min;
  if (!ok) bad++;
  console.log(`${ok ? 'ok' : 'FAIL'} ${r.toFixed(2)}:1 ${name} (need ${min}:1)`);
}
if (bad) process.exit(1);
