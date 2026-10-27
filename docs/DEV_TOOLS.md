# Dev tools

Local-only tools for reproducing game positions, reviewing UI at phone size, and finding engine bugs.
None of this ships: `/dev/*` pages and routes return 404 in production.

## The lab: `/dev/lab`

The real table component (`Game.tsx`) runs on the real engine. Its API calls are answered in the
browser, so you can put the table in any position, play from any seat, and rewind.

- **Positions**: about 40 named edge cases (`src/engine/scenarios.ts`): dealer stuck, all-pass redeal,
  shoot available or already declared, every passing phase, double run, no meld, waiting on others,
  must trump / head / overtrump, last trick, went set, meld lost with no tricks, shoot made, missed or declared after passing,
  a hand played to the last trick, game won or lost, negative scores, classic counting, leisurely pace, short games.
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
| `chat=1` | give the board a local stand-in for table talk (the lab has none otherwise): its corner button and popover, with sample messages from the other seats. Nothing leaves the browser |
| `unread=N` | with `chat=1`: how many sample messages arrive unread (default 3, `0` for none) |
| `broadcast=1` | send the board game events as a live table does, with signed public moves (key made in the browser); every view the board applies is checked against the engine |
| `autoplay=1` | with `broadcast=1`: play every seat, the viewer's too, through to the end of the hand |

`broadcast=1` writes its tally to a hidden `<pre id="lab-broadcast">`: events sent, how many carried
a move, `/view` fetches, views applied and any that differ from the engine. Read it headless with
`google-chrome --headless --virtual-time-budget=60000 --dump-dom "http://localhost:3000/dev/lab?preset=bid-open&broadcast=1&autoplay=1&speed=150&chrome=0" | grep -o '{"events[^<]*'`.

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
meld.say("Nice hand", 1)                 // with ?chat=1: a message from seat 1, unread while the talk is closed
```

Table talk at phone size, for example: `/dev/lab?preset=play-lead&chat=1&chrome=0` (button with its unread count);
open it with a tap, or headless with `document.querySelector("[aria-haspopup=dialog]").click()`. At hand end
(`?preset=hand-made&chat=1`) the button sits on the result sheet. `scripts/overlap.mjs` (below) checks that the button
and its popover never lie on a hand.

### Scenario specs

`buildScenario(spec)` in `src/engine/scenario.ts` starts a hand, optionally stacks the deal, then
**replays real engine actions** up to the target. Choices you leave open are made by a fast bot, and
the same spec always gives the same position. Every position it produces is one the engine can
actually reach. Card names can be `AS0`, `AS` (first free copy), `10S` or `A♠`. Fields: `seed`,
`rules`, `dealer`, `handNumber`, `score`, `hands`, `to`, `bids` (`[25, null]` from the
dealer's left), `bidder`/`bid`, `shoot` or `shootAfterPass` (the bidder's decision after the pass; plays it out
when omitted), `trump`, `passToBidder`/`passBack`, `meld` per seat
(`"full"`, `"none"`, or cards), `confirmed`, `tricks`, `plays`, `turn`, `play` (scripted cards in order), `noClaims` (bots play every trick out).

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

## Nothing on a hand: `scripts/overlap.mjs`

```
node scripts/overlap.mjs                                    # every preset at ten sizes, about 3 minutes
node scripts/overlap.mjs --only hand-shoot-made,play-lead --size 390x844,375x667
node scripts/overlap.mjs --url "/dev/lab?spec=...&chrome=0&run=0" --shots .dev/shots/overlap
```

Needs `pnpm dev` running (`--base` as for shots.mjs). Headless Chrome, driven over the DevTools protocol, opens
every preset with table talk on (`chat=1&unread=3`) and "Tap twice to play" on at 360x640, 375x667, 390x844,
393x852, 414x896, 430x932, 844x390, 932x430, 768x1024 and 1280x800 (phone sizes as touch screens), with motion
reduced, and waits for the layout to stop moving. The screens:

- **table**: the position as it loads;
- **talk**: the same with the talk popover open;
- **armed**: on your turn in trick play, a playable card lifted by a first tap, with its Play button;
- **peek** / **peek+talk**: at hand end, "Look at the table" (every hand face up, the result's buttons along the
  bottom), without and with the popover. The result sheet itself is skipped, since the board is behind its scrim;
- **peek-dealt**: the face-up hands switched to "As dealt", where passing was played and the hand was not claimed.

Each screen a position should reach is required. A missing "Look at the table", Play button, "As dealt" toggle or
popover fails with the position, size and step. Which positions end the hand and play with passing is read from
`src/engine/scenarios.ts`, not from the page. The run also fails if fewer than two screens per position and size
were checked.

On each screen it reads the boxes of every card (`data-card`) of every hand (`data-hand`: `mine`, `west`, `north`,
`east`, also the set-aside stack after a shoot), the cards on the cloth (trick and meld, as `table`), the controls
(`data-overlay`: the talk button, its badge and popover, Menu, the peek buttons, the Play button; every button in
the action bar, `data-overlay-zone`) and the seat plates with their turn ring (`data-seat-plate`). It fails on:

- a hand that is not all there. The board says which hands it draws (`data-hands`) and each hand how many cards it
  holds (`data-hand-cards`); each named hand must be found with exactly that many cards, your hand's row must
  exist, and a face-up view needs all four hands, except a seat that sat out a shoot when the shooter claimed;
- a control on a hand card, two hands' cards on each other (the cloth counts as a hand), or two controls on each other;
- a control drawn over by another control;
- a hand card, control or seat plate cut off by the screen edge or a box that hides overflow (your hand may run
  off sideways, since it scrolls).

Intended overlaps, listed in `scripts/overlap-geometry.mjs` (`ALLOW`, `ALLOW_COVER`, `ALLOW_CONTROLS`): cards of
one hand overlap each other; the open talk popover may lie over the other seats, the cloth and any control, but
never your hand; the unread count sits on the talk button; the Play button may touch the card it plays.
It prints one line per failure (position, size, screen, what is wrong) and exits 1; `--shots <dir>` saves a
PNG of every screen measured, and the boxes go to `meld-overlap-report.json` in the temp directory. The rules
themselves are unit-tested on fixture boxes (`src/lib/__tests__/overlapGeometry.test.ts`). When you add a hand, a
floating control or a seat to the table, give it `data-hand` and `data-hand-cards`, `data-overlay` or
`data-seat-plate`; cards drawn without `PlayingCard` or `CardBack` need `data-card`.

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

Plays full games with random rules (target, min bid, step, pass count, counting, shooting on/off, dealer
stuck, meld saving) and the real bots. After every move it runs `checkState` and checks that no seat's
`viewFor` contains a card that seat shouldn't see (`leakedCards`). Each failure is saved
to `.dev/states/fuzz-*.json`; open it with `/dev/lab?state=<name>` and walk back to the move that
broke it. It prints how often each action was played; at the bidder's shoot decision after the pass it
shoots about one time in ten, since bots rarely hold a shooting hand. A small fuzz run is also part of `pnpm vitest run`.

## Front door: `/dev/welcome`

The signed-out front door at `/`, without signing out.

## Lobby: `/dev/home`

The signed-in lobby at `/` with sample tables. `?tables=N` limits them (`?tables=0` is the
empty lobby), `?as=guest` shows a guest's lobby and `?new=1` the open deal panel. Friends fetch from the
API, so without a session they show their loading or error notes.

## Past games: `/dev/history`

The past games page at `/history` with sample finished games: won and lost, long names, one hand and
many, one from an earlier year. `?rows=N` limits them (`?rows=0` is the empty list). The real page
fetches `/api/history`; this one passes the sample rows straight to the list.

## Groups: `/dev/groups`

A friend's table invitation, the deal panel's group picker and the groups list with its editor, on an
in-memory groups API, so groups can be checked without a session or a database. The fake API is installed
only while the page is mounted. The invitation card is static here (no session, so no Realtime).
`scripts/test-groups-db.sh` checks the groups SQL in a throwaway local PostgreSQL container (Docker).

## Older boards

`/dev/game` (`?play`, `?meld`, `?end=1`, `?return`, `?shoot=`, `?redeal`, `?ready`) and `/dev/seating`
still work. The lab covers everything `/dev/game` does.
