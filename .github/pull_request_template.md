## What and why

<!-- What changed, and the reason. Link issues with "Closes #N". -->

## How it was verified

- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
- [ ] Anything a player sees: checked with screenshots below at every breakpoint: 390x844, 360x640, 844x390,
      768x1024 and 1440x900 full size (`node scripts/shots.mjs --only <preset>` takes all five)
