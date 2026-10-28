# D9_world (Nearcarta) assets and licenses

| Asset | Path | Author | License | Source |
|---|---|---|---|---|
| KayKit Medieval Hexagon Pack 1.0 (tiles, buildings, nature, props, mountains) | assets/hex/ | Kay Lousberg | CC0 1.0 | https://kaylousberg.com · assets/hex/LICENSE_KayKit_Medieval_Hexagon.txt |
| KayKit Adventurers 1.0 (Knight, Barbarian, Mage, Rogue, Rogue_Hooded) | assets/chars/, assets/chars9/ | Kay Lousberg | CC0 1.0 | assets/chars/LICENSE_KayKit_Adventurers.txt |
| RobotExpressive.glb (the Lamplighter; recoloured brass in code) | assets/chars/, assets/chars9/ | Tomás Laulhé (Quaternius), mods by Don McCurdy | CC0 1.0 | three.js r170 examples · assets/chars/LICENSE_RobotExpressive.txt |
| Foley: footstep00–04, metalClick, metalLatch, glass_001, cloth1/2, doorOpen_1, doorClose_1, bookFlip1, bookOpen, creak1 | assets/audio9/ | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio · https://kenney.nl/assets/interface-sounds · LICENSE_kenney_*.txt in that folder |
| UI/story stings + ambient music (allowed, refuse, freeze, send, water, ui-click, music-ambient) | d7/assets/audio/ | Kenney (sources), mixed by D7 | CC0 1.0 | d7/assets/LICENSES.md |
| three.js r170 + addons (GLTFLoader, SkeletonUtils, postprocessing) | vendor/ | three.js authors | MIT | https://github.com/mrdoob/three.js |
| dist/main.js: the app bundle (our code + three.js r170, tree-shaken; MIT notice kept at end of file) | dist/ | built with esbuild (MIT, build tool only, not shipped) via tools/build.sh | MIT (three.js part) | https://esbuild.github.io |
| assets/hex_bundle.glb (the 190+ KayKit hex models merged into one file) and assets/chars9/kay.glb (KayKit Adventurers, resampled; unused props removed) | assets/ | Kay Lousberg (derived with gltf-transform, MIT) | CC0 1.0 | as KayKit rows above |
| GSAP 3 (camera director, deterministic ticker) | vendor/gsap | GreenSock | GSAP standard "no charge" license (free for all uses since 2025) | https://gsap.com/licensing |
| Fonts: Inter, Fraunces, JetBrains Mono (latin subsets) | assets/fonts/ | respective authors | SIL OFL 1.1 | assets/fonts/OFL_Inter.txt · https://fonts.google.com |

Drawn in code, original, no AI: shop sign glyphs (scroll, bell, coins, boat, shield, target, key, bridge) on canvas;
window-glow emissive map; cobble setts, flowers and grass blades (instanced primitives); oath-ward shader; lantern halos;
skyline tint; speech bubbles; HUD. Speech blips in the video mix are synthesised sine ticks.
No AI-generated images or sounds are used anywhere. CC0 needs no attribution; credits are kept anyway.

3:48 pass additions (all drawn in code, no new files): brass zoom rail and lantern knob, Jump/Walk segment icons (inline SVG),
shop pin banners and glyphs, rim-light shader, demo cursor used only in ?capture recordings, inline SVG favicon. KayKit props reused
for the keepers (Spellbook_open, Badge_Shield, 2H_Axe, Round_Shield).
