// A live 1Click swap creates a deposit address and moves real funds.
// This repo's ferry quotes are dry (backend/src/ferry.js). This script does not turn that off.
const live = process.argv.includes('--live');
if (live) {
  console.error('Refusing --live. backend/src/ferry.js always sends dry:true, so no deposit address is created and no mainnet funds move. Run a real swap with your own wallet outside this API.');
  process.exit(2);
}
console.log('Dry only. POST /api/ferry/quote with dry quotes. Nothing is spent. Pass --live to see why a real swap is refused here.');
