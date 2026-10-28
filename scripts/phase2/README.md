# Phase 2 dry run

`phase2.py` rehearses the round trip Base USDC → shielded ZEC → Base USDC through 1Click. It
never signs and never broadcasts: there is no `--live` switch in this file.

Testnet run (2026-10-29 02:13 Cairo, UTC+3), log in `phase2-dryrun.jsonl`:

| Step | Result |
|---|---|
| 1Click dry quote, leg A (2.5 USDC → ZEC) | 201, out 0.00158558 ZEC, ETA 150 s, no deposit address issued |
| 1Click dry quote, leg B (132,000 zats → USDC) | 201, out 1.721399 USDC, ETA 459 s |
| Base Sepolia (chain 84532) | gas 0.006 gwei; USDC `transfer` of 2.5 estimates 62,989 gas = 0.00000038 ETH |
| Zcash testnet, NU7 zcash-devtool (`docs/nu7/`) on a copy of a test wallet | sync OK at height 4,552,431; `propose` 50,000 zats: 1 step, Ironwood pool, fee 10,000 zats (ZIP-317) |

1Click has no testnet, so both quotes are mainnet prices with `dry: true`. Nothing was sent.

Run it again:

    QUOTE_ZEC_ADDR=<mainnet zcash address> EVM_FROM=<address holding Base Sepolia USDC> \
    ZCASH_DEVTOOL=<NU7 zcash-devtool> ZCASH_WALLET=<testnet wallet dir, copied, never written> \
    ZEC_ACCOUNT=<account uuid> ZEC_TO=<testnet shielded address> \
    python3 scripts/phase2/phase2.py --network testnet

`ONECLICK_PARTNER_KEY` is read from env if set and is never logged. `--network mainnet` does the
same reads on mainnet. Still dry: the live legs need the spend approval in MAINNET_COST_PLAN.md.
