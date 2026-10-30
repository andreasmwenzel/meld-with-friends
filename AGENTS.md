<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working on Meld

Meld is public: https://github.com/andreasmwenzel/meld-with-friends. GitHub issues are the backlog of
record: https://github.com/andreasmwenzel/meld-with-friends/issues. Contributor guide:
[CONTRIBUTING.md](CONTRIBUTING.md).

If `~/.config/meld/WORKFLOW.private.md` exists, read it before starting: it holds the owner's private
session rules. This file wins on everything about the repository itself.

### This repository is public
Everything committed, and every issue, PR and comment, is world-readable. Before committing or posting:
- No secrets or credentials (they live in `.env.local` and a local env file), no personal email
  addresses or real players' data, no production game dumps (`scripts/pull-game.mjs` writes to the
  gitignored `.dev/`).
- No screenshots, assets or copied text from other apps. Describe what Meld does in its own terms.
- Security problems are not filed as public issues; see [SECURITY.md](SECURITY.md).
- Commit as the GitHub noreply address.

### Changes go through pull requests
`main` is protected: no direct pushes, CI (`tsc`, `lint`, `vitest`) must pass.
1. Branch from up-to-date `main`: `git switch -c <type>/<short-name> origin/main`.
2. Commit by explicit path list (`git add path1 path2`, never `git add -A`) so other work in the checkout
   is not swept in. Commit messages say what changed and why.
3. Verify locally: `pnpm next typegen && pnpm tsc --noEmit && pnpm lint && pnpm vitest run` (a fresh checkout
   needs the typegen step first, as CI does). For anything a player sees, check it with the dev tools below
   at every breakpoint, and put before/after screenshots of each in the PR: 390x844 phone, 360x640 small
   phone, 844x390 phone sideways, 768x1024 tablet and 1440x900 desktop (full size, not cropped).
   `node scripts/shots.mjs --only <ids>` takes all five by default.
4. `gh pr create` with a summary, how it was verified, and `Closes #N` for the issues it finishes.
5. Review: an agent may review and merge its own PR, but the review must be a separate pass with fresh
   context (a second agent given the diff, not the author's conclusions). Address findings or reply to them.
6. Merge with `gh pr merge --squash --delete-branch` once CI is green and the review is resolved.
7. Merging to `main` deploys production through Vercel's Git integration; PRs get preview builds, and
   the "Vercel" check on the PR shows the build state. After a merge, wait until
   `gh api repos/andreasmwenzel/meld-with-friends/commits/main/status -q .state` says `success`,
   then smoke-test production.
   The rest is maintainer tooling and needs the owner's credentials (Supabase service key in `.env.local`,
   Vercel token in the owner's local env file). Without them, stop at the merge and say the smoke test
   is left to the maintainer.
   - `node scripts/smoke.mjs <production URL>` plays a full hand through the API with four disposable
     confirmed users (admin magic links, captcha stays on) and deletes them afterwards.
   - `./scripts/deploy.sh` triggers a production deploy by hand if the integration ever misses one.

### Issue maintenance
- Close with a reason: `gh issue close N -c "one line why"`. Duplicates: `--reason "not planned"` plus a link.
- Anything found but not done becomes a new issue with a "Done when" section.
- Triage `idea` issues into concrete issues; close the idea with links.
- Label `needs-owner` for work only the owner can do (accounts, real devices).
- Labels: ui-polish, gameplay, mobile, admin, infra, deferred, needs-owner, idea.

### Verifying and dev tools
- Stale worktrees under `.claude/worktrees` break lint: `git worktree remove --force <path>; git worktree prune`.
- Headless screenshots: `google-chrome --headless --screenshot --window-size=390,844 URL` (repeat for each
  breakpoint above).
- Dev tools on `pnpm dev` (:3000), full guide in [docs/DEV_TOOLS.md](docs/DEV_TOOLS.md): `/dev/lab` puts the
  real table in any position (`?preset=<id>`, `?spec=`, `?state=`), plays any seat, and rewinds.
  `node scripts/shots.mjs [--only ids]` screenshots presets at every breakpoint into `.dev/shots`.
  `node scripts/pull-game.mjs CODE` copies a production game into the lab. `node scripts/fuzz.mjs N` fuzzes
  the engine. Older boards: `/dev/game` (`?play`, `?meld`, `?end=1`).
- App env lives in `.env.local` (see `.env.example`). Never print or commit it. It holds production
  credentials: agent worktrees must not copy it from another checkout. Unit tests and `/dev/lab` run without
  Supabase; start `pnpm dev` with placeholder values (`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`,
  any string for the anon key) when you only need the lab. Never point a dev server, a load measurement or
  a script of your own at the production project; a stray run has taken production down (#67). The only
  production operations are the maintainer steps named in this file, run from the main checkout by the
  orchestrating session, not by a delegated agent: `scripts/smoke.mjs` once after a merge,
  `scripts/pull-game.mjs CODE` to copy one game read-only into the lab, and `scripts/deploy.sh`.
