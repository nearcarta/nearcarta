# Phase 2 dry run

`phase2.py` rehearses the round trip Base USDC → shielded ZEC → Base USDC through 1Click. It
never signs and never broadcasts: there is no `--live` switch in this file.

Earlier network run (2026-10-29 02:13 Cairo, UTC+3), log in `phase2-dryrun.jsonl`:

| Step | Result |
|---|---|
| 1Click dry quote, leg A (2.5 USDC → ZEC) | 201, out 0.00158558 ZEC, ETA 150 s, no deposit address issued |
| 1Click dry quote, leg B (132,000 zats → USDC) | 201, out 1.721399 USDC, ETA 459 s |
| Base EVM (chain 84532) | gas 0.006 gwei; USDC `transfer` of 2.5 estimates 62,989 gas = 0.00000038 ETH |
| Zcash earlier network, NU7 zcash-devtool (`docs/nu7/`) on a copy of a test wallet | sync OK at height 4,552,431; `propose` 50,000 zats: 1 step, Ironwood pool, fee 10,000 zats (ZIP-317) |

1Click has no earlier network, so both quotes are mainnet prices with `dry: true`. Nothing was sent.

Run it again (read-only, mainnet):

    QUOTE_ZEC_ADDR=<mainnet zcash address> EVM_FROM=<address holding Base USDC> \
    python3 scripts/phase2/phase2.py --network mainnet

`ONECLICK_PARTNER_KEY` is read from env if set and is never logged. Still dry: the live legs stay out of this file.
