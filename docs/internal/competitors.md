# Internal competitors register (Nearcarta)
**Not public.** Do not link from README, site, or llms.txt. Never paste rival names into UI copy.

Status: **I0 baseline plus I1–I3 on 2026-11-05, pack re-read this round.** The zip was unpacked to `/tmp/research-pack`. `START_HERE.md`, `WIN_MATRIX.md` and `HACKATHON-now.md` were read. The I0 table still matches. New rows below are from the earlier public GitHub pass. Their transactions were not re-read on an explorer. X search for `#NEARHackathon` returned no posts.

Sources: `docs/internal/RESEARCH_SOURCES.md`.

## Per-track bar (known — I0)

| Track | Strongest known bar | What they actually do (verified in pack) | Depth metrics | Our shop | Raise H? |
|---|---|---|---|---|---|
| security | OutLayer (policy in TEE + on-chain freeze); Shore (scoped API key, limits, freeze, Intents balance) | OutLayer: keys in TDX, policy order frozen→types→whitelist→per-tx→velocity(best-effort)→…; controller freeze without agent key. Shore: agent never holds private key | OutLayer: full Decision enum; Shore: multi-chain one balance via Intents | Guardhouse, Vault/Charter, Arena | Beat with **on-chain hard caps** (board counters), visible mainnet allow+refuse txs, 0 FAKs — already H2/H3; keep TEE custody claims honest (we are not OutLayer) |
| agents | Agent Market (hire/escrow); Illia universal Intents checkout wish | Market: escrow, 5% fee, accept window (catalog/docs claims); checkout = Intents | Escrow state machine; paid hire | Ferry + agent | H1 full token list + live status/refund; H11 no fake multi-agent |
| business | NEAR Business / Trezu treasuries; Shore | Treasury + Intents swaps (35+ chains claimed for Business) | Chains/assets, fee transparency | Toll, Payouts, Hall rules | H4/H6/H8; no fake shared DAO |
| defi | Rhea (venue); HEX (Intents UI); 1Click token list | Rhea: routing venue; HEX: Intents front (often single route); 1Click `/v0/tokens` live **215 tokens / 38 chains** (re-counted 2026-11-05) | Token/chain count, live settlement | Ferry | **H1a critical** — UI must not stay at 4 hard-coded pairs |
| privacy | NEAR AI Cloud TEE; Confidential Intents | Attested inference; confidential balances/quotes | Attestation verify path | Mist Bank | H5 — attestation proof file; no earlier network Zcash |
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

## NEW finds (I1–I3), 2026-11-05
GitHub search: public repos whose description or README says NEAR HACKATHON 2026, updated since 2026-10-19, excluding the I0 names. All of the ones opened below had **0 stars**. X: no posts returned for `#NEARHackathon`.

| Project | Repo | Tracks they claim | What the README actually shows | Real txs I checked | Raise H? |
|---|---|---|---|---|---|
| Countersign | https://github.com/Thiago-spart/countersign | security, agents | SDK score plus a vault the agent can only `pay` through, and a report registry. README says sandbox 7/7, read-only mainnet scoring, and a earlier network attack run with 2 failures | Not re-read. README says no registry is configured on mainnet | H2 shows our on-chain caps and both methods. We do not claim a shared registry |
| Halter | https://github.com/Arashrahmaniii/halter | security, agents | On-chain policy, scam registry, scout, published agent key, red-team page. Badge says earlier network | Not re-read | Same as Countersign. Our refusals stay the recorded mainnet txs |
| Settle | https://github.com/MFrancis-dev/settle | realworld | Invoices paid in any token, delivered as exact dollars via Intents | Not opened | H1 lists the 1Click catalog and a dry quote. We do not claim exact-dollar settlement |
| Hearthmarket | https://github.com/nguyenkhangph/hearthmarket | games, agents | Six NPC accounts on earlier network, NEP-141/171/245, 126 tests claimed, red-team refusal txs on earlier network | Not re-read | G2 intro is the games-loop gap we can close without claiming six agents. Swarms stay omitted (H11c) |
| near-policy-vault | https://github.com/Alan021011/near-policy-vault | nfts | NFT that would own a cross-chain account. README: signing path and NFT base on earlier network; spending policy not built | Not re-read | No raise. House deed allow/refuse txs stay the proof |
| Laurel | https://github.com/agadape/laurel | privacy, agents | TEE / private decision models (description) | README not fully read | H5 stays an attestation check. No custody claim |
| IntentWatch | https://github.com/surs51/IntentWatch | agents, defi | Intents detector, policy, guard wallet (description) | Not opened | H1 status words cover the quote. No new spend |
| capgrate, AgentGuard, Aegis, Hermes, Stashway | several repos in the search | security | Spend policy, function-call keys, panic button. Several say earlier network | Not opened | H2 policy card. No shared scam registry |

Other names seen in the same search and not read past the description: skyll-private-grading, veilprocure, ghosterdex-near, midge, darkroom, waybill, intents-desk, stack, werracle, market-town, openteller, invoicerail, release-passport, judge-near, polaris. None of those descriptions showed a mainnet tx I verified.

## Raise H? decisions (I5)
| Gap | Decision |
|---|---|
| Four hard-coded Pay pairs vs a full 1Click list | Implemented: Pay loads `/api/ferry/tokens`, filters, and shows amount out, USD, ETA, fee, plus refund words. A live deposit is still S1 and was not sent |
| Shared scam registry (Countersign, Halter) | Not built. A recorded mainnet refusal (`shop-moved-pay-here.near`, tx `E7KMexjS…`) is a block reason before signing. No shared on-chain registry |
| Six-agent game loop (Hearthmarket, earlier network) | Intro plays on the 3D town and the 2D fallback. Swarms track stays omitted |
| Exact-dollar invoices (Settle) | Not claimed |
| NFT that signs on another chain (near-policy-vault, unfinished) | Not claimed |
| Confidential swap as a settled private payment | The confidential button is labeled quote only |
| USDC payroll | S3, not run |
| Shared mainnet DAO | A21 / S4, still blocked |
