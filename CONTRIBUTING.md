# Contributing to Meld

Thanks for helping. Meld is a small, opinionated project, so it's worth opening or commenting on an
issue before starting anything large.

## Getting going

1. `corepack enable && pnpm install`
2. Copy `.env.example` to `.env.local` and fill in a Supabase project (see the README). The dev lab
   below works without one for most UI work.
3. `pnpm dev`, then open http://localhost:3000.

[docs/DEV_TOOLS.md](docs/DEV_TOOLS.md) explains the dev lab: `/dev/lab` puts the real table into any
game state (dealer stuck, must trump, last trick, game over…), lets you play any seat, and rewinds.
That's the fastest way to see or reproduce a change.

## Making a change

- Branch from `main` and open a pull request. `main` is protected and CI must pass.
- Before pushing: `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`.
- For anything a player sees, check it at phone size (390x844) and include screenshots.
  `node scripts/shots.mjs --only <preset ids>` takes them for you.
- Engine changes need tests. `src/engine` is pure and deterministic, and `node scripts/fuzz.mjs`
  plays thousands of random games checking invariants and that no player can see hidden cards.
- Keep commits and PR descriptions about what changed and why.

## Ground rules

- No secrets, personal data or production game dumps in commits, issues or PRs.
- No screenshots, assets or copied text from other games or apps.
- Security problems: see [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
