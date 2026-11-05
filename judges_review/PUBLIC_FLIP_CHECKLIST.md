# Public flip checklist (internal, submission day)

Owner-only steps are marked OWNER. Nothing here is done by an agent without the owner's explicit OK.
Deadline: dev window closes Nov 14 23:59 UTC (Nov 15 02:59 Cairo). Keep the repo public until judging ends (Nov 18).

## 0. Before the flip (agent, private repo)
- [ ] `gitleaks git --config .gitleaks.toml --redact --no-banner .` on full history: 0 findings (dry run Oct 29: 498 commits, 0 with repo config, 0 with default config).
- [ ] Known, documented history item: retired testnet view-only UFVK in `ae15658` (removed in `f19e12f`), see `docs/HISTORY_REWRITE.md`. No rewrite, no force push.
- [ ] `git status` clean; no `*.tmp.mjs`, `__pycache__`, `.secrets/`, `.env*` tracked.
- [ ] `npm ci && npm test && npm run verify && npm run build` pass on a fresh clone.
- [ ] Every link in README / judges/VERIFY.md / docs resolves; no box paths.

## 1. Tag (OWNER OK, then agent)
- [ ] Pick the exact submitted commit on `main`.
- [ ] `git tag -a hackathon-submission <sha> -m "Hackathon submission"` and `git push origin hackathon-submission`. Annotated, never moved. `pre-hackathon` already exists (c60104d) and must not move.

## 2. Visibility (OWNER)
- [ ] GitHub > nearcarta/nearcarta > Settings > General > Danger Zone > Change visibility > Public.
- [ ] Check logged out (private window): repo, README, `judges/VERIFY.md` open.

## 3. CI badge and Actions minutes
- [ ] Public repos get free standard-runner Actions minutes; private org minutes for October are used up, so CI only runs reliably after the flip (or with billing).
- [ ] After the flip: Actions tab > enable workflows if prompted > re-run `ci` on the tagged commit; all jobs (node, contracts matrix, factory-sandbox, secrets) green.
- [ ] Only then add the badge to the README top (README has no badge today):
      `[![ci](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml/badge.svg)](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml)`
      Never add the badge while the run is red or missing.

## 4. README compare link
- [ ] README "Baseline tags" links `https://github.com/nearcarta/nearcarta/compare/pre-hackathon...hackathon-submission`. Today it 404s (private + tag missing). After steps 1-2, open it logged out and confirm the diff loads.
- [ ] If a badge commit lands after the tag, the compare link still shows the tagged diff; do not re-tag.

## 5. Submission (OWNER only, one attempt, Nov 1-14)
- [ ] Form uses the public repo URL, live site https://nearcarta.vercel.app, video, tag name `hackathon-submission`.
- [ ] X post and video publish: OWNER.

## Known link check notes (Oct 29 dry run)
- nearblocks / basescan / blockscout answer 403 to scripted curl (bot block); open in a browser.
- cipherscan answered 429 (rate limit).
- `/api/...` POST endpoints and bare RPC URLs answer 400/404/405 to GET by design.
- `http://localhost:8787` is the documented local dev URL.
