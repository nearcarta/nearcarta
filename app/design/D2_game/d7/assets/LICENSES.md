# design/assets — licenses for D7 additions

Older packs (KayKit, Kenney, robot-expressive, engines) keep their own
LICENSE files in their folders. This file covers what D7 added. Everything
listed here can ship in an open-source repo.

## 3dicons — `3dicons/192/*.webp`, `3dicons/384/*.webp`
- Source: https://3dicons.co by realvjy. Metadata from https://github.com/realvjy/3dicons (branch `develop`, `content/3dicons-meta/*.md`). PNGs from the project CDN `https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/dynamic/{premium|clay}/<name>-dynamic-<style>.png`.
- License: **CC0 1.0 Universal** (repo `LICENSE`). No attribution needed; we credit anyway.
- Count: 47 icons × 2 styles (`premium` = graphite+gold, `clay` = matte white) = 94 files per size. We downscaled them from 400 px to 192 and 384 px and saved as WebP q82, with no other edits. `sheild` was renamed to `shield`. `crown` returned HTTP 403 and was skipped.
- Size: 192 px set ≈ 0.6 MB (all 94), 384 px set ≈ 1.1 MB. The UI only loads the icons it uses.

## Token and chain icons — `tokens/tokens/*.svg`, `tokens/chains/*.svg`, `tokens/manifest.json`
- Source: npm `@web3icons/core` 4.0.58 (https://github.com/0xa3k5/web3icons), `dist/svgs/{tokens,networks}/branded`. We pulled the SVG strings out of the ES modules and ran svgo 3.
- License: **MIT** (package.json `"license": "MIT"`; repo `LICENCE`, GitHub SPDX MIT). The token logos are trademarks of their projects and are used only to identify those tokens.
- Coverage: the list is the live NEAR Intents 1Click catalogue, `GET https://1click.chaindefuser.com/v0/tokens`, fetched 2026-10-28: 208 assets, 121 distinct symbols, 37 chains.
  - 72 of the 121 symbols map to an icon, plus a BASE entry that uses the Base chain mark. Some use an alias to the base mark: wNEAR→NEAR, USDT0→USDT, WETH→ETH, cbBTC→BTC and others; see `aliased` in `manifest.json`.
  - 50 unique SVGs.
  - 35 of 37 chains have a mark: 30 from `networks`, and 5 (zec, bch, dash, aleo, fogo) use the token mark.
  - 49 symbols (mostly memecoins and new launches) and chains `qtc` and `adi` have no free icon. The UI draws a monogram chip for these. No third-party art is used.
- spothq `cryptocurrency-icons` 0.18.1 (CC0-1.0) was checked as a fallback. It had none of the missing symbols, so we use no files from it.

## Audio — `audio/*.ogg` (Vorbis, mono SFX) + `audio/*.mp3` fallback
Total: about 336 KB ogg and 356 KB mp3. SFX are each under 20 KB; the music loop is about 250 KB.
| file | made from | source | license |
|---|---|---|---|
| ui-click | `click_002.ogg` | Kenney Interface Sounds 1.0 (local `kenney_interface-sounds`, https://kenney.nl/assets/interface-sounds) | CC0 1.0 |
| ui-hover | `tick_002.ogg` at -8 dB | Kenney Interface Sounds | CC0 1.0 |
| allowed | `confirmation_002.ogg` + `handleCoins2.ogg` (RPG Audio), mixed | Kenney Interface Sounds + Kenney RPG Audio (https://kenney.nl/assets/rpg-audio) | CC0 1.0 |
| refuse | `bookClose.ogg` (low-passed) + `metalLatch.ogg`, mixed | Kenney RPG Audio | CC0 1.0 |
| freeze | `glass_003` + pitched `glass_006` + echo | Kenney Interface Sounds | CC0 1.0 |
| swap | `switch_002.ogg` | Kenney Interface Sounds | CC0 1.0 |
| send | `select_003.ogg` | Kenney Interface Sounds | CC0 1.0 |
| step-a / step-b | `footstep00/03.ogg` | Kenney RPG Audio | CC0 1.0 |
| water | `wave_01_cc0-11505__transitking__wavesound.flac`, with fades | "Water Waves" by transitking (via qubodup), https://opengameart.org/content/water-waves (origin freesound #11505) | CC0 1.0 (as labelled on OGA) |
| music-ambient | `Ambient-Loop-isaiah658_0.ogg` (24.5 s seamless loop), re-encoded | "Ambient Relaxing Loop" by isaiah658, https://opengameart.org/content/ambient-relaxing-loop | CC0 1.0 |

The audio player is howler.js v2.2.4 (`engines/howler/howler.min.js`, MIT, © James Simpson / GoldFire Studios).
