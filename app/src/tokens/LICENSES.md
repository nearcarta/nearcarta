# Token icons
- btc, eth, sol, usdc, usdt: cryptocurrency-icons 0.18.1 (svg/color), CC0-1.0, https://github.com/spothq/cryptocurrency-icons
- zec.svg: Zcash mark redrawn for this app from the public Zcash “Z” (gold disc + white Z), same palette as cryptocurrency-icons zec (#ECB244 / #FFF), CC0-1.0 intent; replaces a broken web3icons path that painted blank on the brown UI.
- near.svg, base.svg: simple marks drawn for this app, used only to name the asset/network next to an amount.
- chains/eth.svg, chains/base.svg, chains/arb.svg, chains/near.svg: copied from design/D2_game/d7/assets/tokens/chains (web3icons @web3icons/core 4.0.58, MIT). See design/D7_system/tokens/token-icons.json.
- chains/zec.svg: circular Zcash chain badge drawn for this app (gold disc + white Z, viewBox 0 0 24 24), same palette; replaces the prior web3icons path that had no viewBox and no disc fill.
Served from this site (no hotlinking).

## Added for the live 1Click catalog
- Token SVGs not already in this folder, and chain badges for the live 1Click chain ids (including `chains/sol.svg` and `chains/polygon.svg`), are copied from the in-repo web3icons set at `design/D2_game/d7/assets/tokens` (`@web3icons/core` 4.0.58, MIT). See that folder's license note. The Polygon mark is stored as `chains/polygon.svg`; the live 1Click blockchain id `pol` uses the same file.
- Existing coins in this folder (cryptocurrency-icons CC0, the app-drawn NEAR/Base marks, and the app-drawn ZEC discs) were left in place when a file of the same name already existed.
- `app/src/panels/icon-map.js` is the symbol and chain lookup. A 1Click `icon` URL is used only when it is `https`. Anything the library does not know falls back to a brass letter coin. No question-mark placeholder and no third-party image CDN.
