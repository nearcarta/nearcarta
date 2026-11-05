// Snapshot of live reads (tools/snapshot.mjs, 2026-10-28 05:00 UTC, nearcarta-api.onrender.com). Hosted app replaces these with fresh reads.
export const BANK = {
 "src": "mainnet",
 "at": "2026-10-28 05:00 UTC",
 "street": {
  "txid": "446dde4a68790dc842ca826b4c2c7a46786288aa54156e74ac463fb6caf4f984",
  "url": "https://cipherscan.app/tx/446dde4a68790dc842ca826b4c2c7a46786288aa54156e74ac463fb6caf4f984",
  "height": 4552488,
  "confirmations": 1,
  "fee": "10000",
  "hidden": true,
  "reasons": [],
  "pool": "ironwood",
  "actions": {
   "ironwood": 2,
   "orchard": 0,
   "sapling_spends": 0,
   "sapling_outputs": 0
  }
 },
 "oath": {
  "tx": "Df7D29qiAKG2aKJ8U54Uen8yS8birtNBoDvTZG6FmDyh",
  "url": "https://nearblocks.io/txns/Df7D29qiAKG2aKJ8U54Uen8yS8birtNBoDvTZG6FmDyh",
  "ok": true,
  "clause": "tip2"
 },
 "commitment": {
  "value": "76f7dc33248f69c986cc1e3a901f8670303874de4cf48426c842e9f47a00d868",
  "scheme": "sha256(\"mistbank:v1:<amount>:<salt>\")"
 },
 "binding": {
  "capsAmount": false,
  "timing": "Future payouts wait a random delay after the NEAR approval before the Zcash send, so the two are not linkable by time. The first payout (2026-10-28) had no delay: mined 29 s after its approval."
 },
 "auditor": {
  "verify": "POST /api/mistbank/verify"
 },
 "desk": [
  {
   "leg": "shield",
   "ok": true,
   "privacy": "basic",
   "sig": true,
   "echo": true
  },
  {
   "leg": "transfer",
   "ok": true,
   "privacy": "basic",
   "sig": true,
   "echo": true
  },
  {
   "leg": "unshield",
   "ok": true,
   "privacy": "basic",
   "sig": true,
   "echo": true
  }
 ]
};
export const QUOTE = {
 "src": "live",
 "at": "2026-10-28 05:00 UTC",
 "api": "nearcarta-api.onrender.com",
 "from": {
  "sym": "USDC",
  "chain": "Base",
  "amt": "3.0"
 },
 "to": {
  "sym": "ZEC",
  "chain": "Zcash",
  "amt": "0.00195",
  "exact": "0.00195219"
 },
 "eta": "≈ 152 s",
 "etaS": 152,
 "feeBps": 20,
 "costBps": 1441,
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
