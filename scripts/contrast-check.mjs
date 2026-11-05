// Graphite pairs. Body text is at least 4.5:1. Large text and UI chrome are at least 3:1.
const pairs = [
  ['text on bg', '#f4f6f8', '#0c0e11', 4.5],
  ['text-2 on bg', '#c5ccd6', '#0c0e11', 4.5],
  ['muted on bg', '#a8b0bd', '#0c0e11', 4.5],
  ['muted on surface', '#a8b0bd', '#16191f', 4.5],
  ['muted on surface-2', '#a8b0bd', '#1e222a', 4.5],
  ['violet text on surface', '#c4b5fd', '#16191f', 4.5],
  ['brand text on brand', '#04140e', '#00ec97', 4.5],
  ['line on bg', '#8b93a3', '#0c0e11', 3],
  ['focus on bg', '#b7a6ff', '#0c0e11', 3],
  ['disabled on surface', '#8b93a3', '#16191f', 3],
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
