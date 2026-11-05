# Internal competitors register (Nearcarta)
**Not public.** Do not link from README, site, or llms.txt. Never paste rival names into UI copy.

Status: **baseline from existing `/workspace/near` research only** (I0). Cursor must append **NEW** finds from GitHub/X (I1–I3) below, then re-rank and set "raise H?" (I4–I5).

Sources read for this baseline: see `docs/internal/RESEARCH_SOURCES.md`.

## Per-track bar (known — I0)

| Track | Strongest known bar | What they actually do (verified in pack) | Depth metrics | Our shop | Raise H? |
|---|---|---|---|---|---|
| security | OutLayer (policy in TEE + on-chain freeze); Shore (scoped API key, limits, freeze, Intents balance) | OutLayer: keys in TDX, policy order frozen→types→whitelist→per-tx→velocity(best-effort)→…; controller freeze without agent key. Shore: agent never holds private key | OutLayer: full Decision enum; Shore: multi-chain one balance via Intents | Guardhouse, Vault/Charter, Arena | Beat with **on-chain hard caps** (board counters), visible mainnet allow+refuse txs, 0 FAKs — already H2/H3; keep TEE custody claims honest (we are not OutLayer) |
| agents | Agent Market (hire/escrow); Illia universal Intents checkout wish | Market: escrow, 5% fee, accept window (catalog/docs claims); checkout = Intents | Escrow state machine; paid hire | Ferry + agent | H1 full token list + live status/refund; H11 no fake multi-agent |
| business | NEAR Business / Trezu treasuries; Shore | Treasury + Intents swaps (35+ chains claimed for Business) | Chains/assets, fee transparency | Toll, Payouts, Hall rules | H4/H6/H8; no fake shared DAO |
| defi | Rhea (venue); HEX (Intents UI); 1Click token list | Rhea: routing venue; HEX: Intents front (often single route); 1Click `/v0/tokens` live **215 tokens / 38 chains** (re-counted 2026-11-05) | Token/chain count, live settlement | Ferry | **H1a critical** — UI must not stay at 4 hard-coded pairs |
| privacy | NEAR AI Cloud TEE; Confidential Intents | Attested inference; confidential balances/quotes | Attestation verify path | Mist Bank | H5 — attestation proof file; no testnet Zcash |
| social | Sputnik DAO + Trezu (named in track card) | Multisig/treasury — "don't rebuild the multisig" | Real DAO proposals vs own-row rules | Town Hall | H4 — A20 own-row; A21 blocked |
| games | Spatial demos (Agentropolis-class); NEP-245 inventories | Loop first; chain invisible | Playable loop, not token chart | Town + Arena | G2 intro + H12 town gate |
| nfts | Dynamic NFT / account-with-behavior | Deed or NFT controlling rights | Behavior proven by tx | House | H9 |
| realworld | Stablecoin payroll / merchant rails | USDC etc. | Live stablecoin tx | Payouts | H6; USDC = spend S3 |
| swarms | Multi-agent coordination markets | 2+ agents settling | Multi-agent proof tx | Agent | H11c — omit track unless proof |
| open | Chain abstraction skins | Whole product | Cross-shop proofs | Whole town | H12 |
| thesis / memecoins | (we are not entering unless product changes) | — | — | — | Skip |

## Closest product-shaped rivals (internal notes)
- **SCRiM** — full forensic in `/workspace/near/SCRIM_FORENSIC.md` (policy/backend vs our on-chain board).
- **Emet / Gleipnir** — non-NEAR or analysis-only; see TOWN_PLAN §1 (do not cite in public).
- Past NEAR winners patterns: `/workspace/near/pack/files/near-competitors-winners.md`.

## NEW finds (I1–I3) — Cursor fills
| Project | Repo / X | Tracks | Depth metrics | Real txs | Raise H? |
|---|---|---|---|---|---|
| _none yet_ | | | | | |

## Decisions log
| Date | Change |
|---|---|
| 2026-11-05 | Baseline I0 table seeded from pack; awaiting Cursor I1–I6 |
