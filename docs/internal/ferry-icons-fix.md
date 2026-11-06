# Ferry icons + picker fix (Ferry only)

**Internal.** Attach with any Ferry Cursor chat that touches the tray/hero/dropdowns.
**Symptom (owner hand-test):** picked **USDC on Solana → USDC on Polygon**; hero / flow still showed a static pair (wNEAR→USDC@near look). Chain/token `<select>` options are plain text with **no** icons.

## Root cause (cite)

1. Hard-coded symbol→file maps cover only a handful of assets:
   - `app/src/panels/token-badge.js` `TOK` ≈ NEAR/USDC/USDT/ETH/BTC/ZEC/SOL; `CHAIN` ≈ eth/base/arb/zec/near (no sol/polygon/…).
   - `app/design/D8_shops/js/core.js` `tok()` `TOK` even thinner (no USDT/SOL).
2. Dropdown options are text-only: `deep.js` `pickerOptions` builds `<option value="…">label</option>` (≈ L117) with no icon HTML (native `<option>` cannot host rich icons reliably — need a custom menu or prefix + adjacent badge).
3. Live list is loaded (`GET /api/ferry/tokens` → `tokenChoices`) but icon rendering does not follow the **picked** `fromId`/`toId` everywhere (hero export `HERO` in `ferry.js` L15 is still the snapshot `QUOTE`; room `applyPair` updates cargo, but badges fall back to letter coins for unknown symbols/chains).
4. 1Click `GET https://1click.chaindefuser.com/v0/tokens` (verified this run): **215 tokens / 39 chains**, and **`icon` is null on every row today**. Do not claim hotlink icons from 1Click until the field appears; still prefer `icon` when non-empty.

## Required behavior

1. **Hero + ferry-flow pills + crate tag** show the real token icon and chain badge for the **currently selected** pair (including USDC@sol → USDC@polygon).
2. **Every dropdown option** (You pay / You get / chain filter) shows token icon and/or chain badge for that row — custom listbox if native `<option>` cannot. No bare “USDC|sol” text-only UX.
3. Coverage: all live 1Click tokens (~215) and chains (~38–39). Unknown → brass letter coin fallback is OK **only** as last resort after library miss; **no `?` placeholders**.
4. Prefer, in order:
   1. `token.icon` from 1Click when present (HTTPS img, CSP-safe).
   2. Bundled / generated assets from `@web3icons/core` (MIT) and/or `cryptocurrency-icons` (CC0-1.0).
   3. Existing `/tokens/*.svg` + `/tokens/chains/*.svg` (see `app/src/tokens/LICENSES.md`).
5. Update `LICENSES.md` for any new vendored files. Do not hotlink random CDNs without CSP allow + license note.
6. When the picker changes, call the same path as `applyPair` / `onPair` so 3D crate + hero stay in sync (already partially wired in `shopui.js`).

## Implementation sketch (non-binding — Cursor may choose better)

- Extend `token-badge.js` (and/or `tok()` consumers) with a resolver: `(symbol, blockchain) → { tokenSrc, chainSrc }`.
- Prebuild or lazy-load a map for web3icons network+token ids covering 1Click’s `blockchain` strings (`near`, `sol`, `polygon`, `base`, `eth`, `arb`, …).
- Replace native selects with accessible listboxes **or** keep selects for value and render a rich closed-state badge beside them — but **open** list must show icons.
- Tests: unit tests that USDC+sol and USDC+polygon resolve to non-letter icons; that `pickerOptions` / listbox includes icon markup or data attributes; that changing `fromId` updates hero HTML; snapshot or DOM test that no `?` appears.

## Sources

- Live catalog: https://1click.chaindefuser.com/v0/tokens (200; 215/39 this run; icons absent).
- https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
- https://github.com/spothq/cryptocurrency-icons (CC0)
- https://github.com/0xa3k5/web3icons · `@web3icons/core` (MIT) · https://registry.npmjs.org/@web3icons/core (200)
- In-repo: `app/src/tokens/LICENSES.md`, `token-badge.js`, `deep.js` ferryMarkup, `ferry.js` `applyPair` / `heroOf`, `ferry-catalog.js` `tokenChoices`

## Acceptance

- [ ] Hand-test: select USDC sol → USDC polygon; hero, flow pills, crate tag, and both open menus show USDC + sol/polygon badges (not wNEAR/near static).
- [ ] Spot-check ≥5 other chains from the live list (e.g. base, arb, eth, near, bitcoin if present).
- [ ] Unit tests green; no `?` in icon slots.
- [ ] LICENSES.md updated; CSP still passes (no inline onerror — keep `bindTokenFallbacks`).

## Out of scope

Other shops. Real 1Click deposit / propose_call settle (separate Ferry depth work). Do not rename tracks.
