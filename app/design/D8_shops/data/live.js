// Snapshot of live reads (tools/snapshot.mjs, 2026-10-28 03:19 UTC, nearcarta-api.onrender.com). Hosted app replaces these with fresh reads.
export const BANK = {
 "src": "testnet",
 "at": "2026-10-28 03:19 UTC",
 "street": {
  "txid": "d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897",
  "url": "https://testnet.cipherscan.app/tx/d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897",
  "height": 4549357,
  "confirmations": 224,
  "fee": "20000",
  "hidden": true,
  "reasons": [],
  "pool": "ironwood",
  "actions": {
   "ironwood": 4,
   "orchard": 0,
   "sapling_spends": 0,
   "sapling_outputs": 0
  }
 },
 "oath": {
  "tx": "5HG5SPJ53MhW799NjbqJGyUS1ymEiRvP9BWwLem1a3ua",
  "ok": true,
  "clause": "tip2"
 },
 "ledger": {
  "commitment": "b22cc85878be366a3edb1d4ef3afbeea0813d4be02aec95a387242fa9a6055ce",
  "scheme": "sha256(\"mistbank:v1:<amount>:<salt>\")"
 },
 "desk": [
  {
   "leg": "shield",
   "ok": true,
   "privacy": "basic",
   "sig": true,
   "echo": true,
   "out": "0.1"
  },
  {
   "leg": "transfer",
   "ok": true,
   "privacy": "basic",
   "sig": true,
   "echo": true,
   "out": "1.0"
  },
  {
   "leg": "unshield",
   "ok": true,
   "privacy": "basic",
   "sig": true,
   "echo": true,
   "out": "1.0"
  }
 ]
};
export const QUOTE = {
 "src": "live",
 "at": "2026-10-28 03:19 UTC",
 "api": "nearcarta-api.onrender.com",
 "from": {
  "sym": "USDC",
  "chain": "Base",
  "amt": "3.0"
 },
 "to": {
  "sym": "ZEC",
  "chain": "Zcash",
  "amt": "0.00196",
  "exact": "0.00195967"
 },
 "eta": "≈ 152 s",
 "etaS": 152,
 "feeBps": 20,
 "costBps": 1430,
 "privacy": "basic",
 "sig": true,
 "dry": true,
 "fee": "20 bps (1Click) · signature verified",
 "ua": {
  "addr": "u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex",
  "receivers": [
   "Orchard"
  ],
  "orchardOnly": true
 },
 "refused": [
  {
   "case": "UA with Orchard + Sapling",
   "receivers": [
    "Sapling",
    "Orchard"
   ],
   "why": "not Orchard-only"
  },
  {
   "case": "UA with Orchard + transparent",
   "receivers": [
    "P2PKH",
    "Orchard"
   ],
   "why": "a sender may pick the transparent receiver"
  },
  {
   "case": "Echo drops confidentiality",
   "diffs": [
    {
     "field": "confidentiality",
     "sent": "basic",
     "got": "public"
    }
   ],
   "why": "downgrade from basic to public"
  },
  {
   "case": "Echo swaps the recipient",
   "diffs": [
    {
     "field": "recipient",
     "sent": "u1naczqa5m…",
     "got": "u1snf9yr88…"
    }
   ],
   "why": "the quote would pay someone else"
  }
 ]
};
