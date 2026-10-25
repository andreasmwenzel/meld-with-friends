# Dev tools

Local-only tools for reproducing game positions, reviewing UI at phone size, and finding engine bugs.
None of this ships: `/dev/*` pages and routes return 404 in production.

## The lab: `/dev/lab`

The real table component (`Game.tsx`) runs on the real engine. Its API calls are answered in the
browser, so you can put the table in any position, play from any seat, and rewind.

- **Positions**: about 40 named edge cases (`src/engine/scenarios.ts`): dealer stuck, all-pass redeal,
  shoot available or already declared, every passing phase, double run, no meld, waiting on others,
  must trump / head / overtrump, last trick, went set, meld lost with no tricks, shoot made or missed,
  game won or lost, negative scores, classic counting, leisurely pace, short games.
- **Build**: make your own position. Pick where to stop (any phase, so many tricks in, whose turn),
  the dealer, hand number and scores (earlier hands are synthesised so the scorepad adds up), the
  contract, rules, and the deal. In the 48-card grid, tap a card to give it to a seat; cards you
  don't place are dealt at random. "Copy link" gives you a `?spec=` URL for the position.
- **Timeline**: every action since the deal. Click a row to go back to it. A new move after going
  back drops the old future, as undo does in an editor.
- **State**: all four hands, invariant checks, table conditions (reconnecting, paused, everyone
  ready, practice board), saving to `.dev/states`, and JSON import and export.
- **Controls**: view as any seat; set each other seat to bot or hand (step a hand seat yourself, or
  switch the view to it); pause bots; Step; Finish trick / hand; Next hand; bot speed.
  Keys: `[` undo, `]` redo, `.` step, `\` pause or run bots.
- A red count on the Lab tab means an engine invariant is broken in the current state.

URL parameters:

| Param | Effect |
| --- | --- |
| `preset=<id>` | load a named position (ids in `src/engine/scenarios.ts`) |
| `spec=<base64url>` | load a built position (from "Copy link" or `meld.spec({...})`) |
| `state=<name>` | load `.dev/states/<name>.json` |
| `seat=0-3` | view from this seat |
| `bots=all\|none\|13` | which other seats bots play |
| `run=0` | start with bots paused |
| `speed=<ms>` | ms between bot moves |
| `chrome=0` | hide the lab panel and the Next.js badge, for screenshots |

With no position parameter the lab reopens where you left it (localStorage).

Console, for agents using `preview_evaluate`, or anyone in DevTools:

```js
meld.load("play-must-trump")             // a preset id, or a spec object
meld.load({ to: "playing", tricks: 11, turn: 0, hands: { 0: ["AS", "AS", "10S"] } })
meld.view(0).legal                       // the PlayerView that seat sees
meld.act({ type: "play_card", seat: 0, card: "AS0" })
meld.step(); meld.undo(); meld.goto(12); meld.seat(2)
meld.check()                             // invariant problems, [] when healthy
meld.spec({...})                         // encode a spec for ?spec=
```

### Scenario specs

`buildScenario(spec)` in `src/engine/scenario.ts` starts a hand, optionally stacks the deal, then
**replays real engine actions** up to the target. Choices you leave open are made by a fast bot, and
the same spec always gives the same position. Every position it produces is one the engine can
actually reach. Card names can be `AS0`, `AS` (first free copy), `10S` or `A♠`. Fields: `seed`,
`rules`, `dealer`, `handNumber`, `score`, `hands`, `to`, `bids` (`[25, null, "shoot"]` from the
dealer's left), `bidder`/`bid`/`shoot`, `trump`, `passToBidder`/`passBack`, `meld` per seat
(`"full"`, `"none"`, or cards), `confirmed`, `tricks`, `plays`, `turn`, `play` (scripted cards in order).

When you add a preset, `src/engine/__tests__/scenario.test.ts` builds it and checks that it reaches
its target with no broken invariants. Forced-play and outcome presets also have assertions there.

## Replay viewer: `/dev/replay`

The game replay page on a game the bots play when you open it, with no database. `?seed=` picks the
deals, `?hands=N` stops after N finished hands so the viewer shows an unfinished game, `?seat=`
marks the reader's seat, `?target=` shortens the game, and `?m=<frame>` opens at a move.

## Screenshots: `scripts/shots.mjs`

```
node scripts/shots.mjs                                  # every preset at 390x844
node scripts/shots.mjs --only bid-stuck,hand-set --size 390x844,1440x900
node scripts/shots.mjs --url "/dev/lab?spec=...&chrome=0&run=0"
```

Needs `pnpm dev` running (`--base` changes the server, default `http://localhost:3000`). It writes
PNGs and an `index.html` contact sheet to `.dev/shots`. Use it for the 390x844 check on UI work:
shoot before and after, and compare the two sheets.

## Production games: `scripts/pull-game.mjs`

```
node scripts/pull-game.mjs 9QRTDV [name]     # then open /dev/lab?state=prod-9qrtdv
```

Read-only. It selects the table's current game and its action log with the service key in
`.env.local`, then writes `.dev/states/<name>.json`. The lab rebuilds the game from its seed and log,
so the whole hand is on the timeline and you can step back to the move a bug report mentions. If the
log doesn't replay, for example because the engine changed since that game, the lab loads the
stored state on its own.

## Fuzzing: `scripts/fuzz.mjs`

```
node scripts/fuzz.mjs 500 [prefix]
```

Plays full games with random rules (target, min bid, step, pass count, counting, shoot mode, dealer
stuck, meld saving) and the real bots. After every move it runs `checkState` and checks that no seat's
`viewFor` contains a card that seat shouldn't see (`leakedCards`). Each failure is saved
to `.dev/states/fuzz-*.json`; open it with `/dev/lab?state=<name>` and walk back to the move that
broke it. A small fuzz run is also part of `pnpm vitest run`.

## Older boards

`/dev/game` (`?play`, `?meld`, `?end=1`, `?return`, `?shoot=`, `?redeal`, `?ready`) and `/dev/seating`
still work. The lab covers everything `/dev/game` does.
