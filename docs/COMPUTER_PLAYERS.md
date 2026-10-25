# Computer players

How Meld's bots bid, pass, meld and play, and how they are kept honest. Short version: a bot gets
exactly the `PlayerView` a human gets, bids from a projection of meld plus likely tricks, and plays
tricks by sampling hidden hands consistent with everything seen so far and playing each option out.
Tuning knobs live in the admin page (`/admin`) and are described at the end.

## No cheating, by construction

The computer player entry point is `chooseAction(view, options)` in `src/engine/ai/index.ts`. Its only game input is a `PlayerView`. The server constructs that view with `viewFor` before asking for an action. Other hands and the shuffle seed never enter the decision code. The optional AI seed controls sampling, independently of the engine's deal seed. Even the hand-over `revealed` field is ignored.

`src/engine/game.ts` records every play with its seat, resets that list when dealing, and copies it into each view as `playedCards`. Public meld declarations, bids, trick counts, the current trick, rules, and the bot's own cards supply the rest of its information. The engine tests check the AI's imports: only sibling AI modules and engine types, meld, and rules are permitted. They reject private state, server imports, I/O imports, and reads of revealed hands. Full-game tests apply every chosen action through the actual engine, and sampling tests verify counts, unique cards, public voids, and exclusion of played cards and the bot's own cards from opponents' sampled hands.

## What a bot knows

`knowledge.ts` groups the ordered plays into tricks. Failing to follow a lead proves a void in the led suit. Discarding a different non-trump suit also proves a void in trump, since this ruleset requires trumping when unable to follow. Played cards are definitely gone. Unplayed cards exposed in meld stay assigned to the declaring seat. Every other card outside the bot's hand is unknown. Per-seat estimates include the most recent bid, public known cards, remaining hand count, and suit expectations distributed among seats that have not shown a void. Bids affect the partnership strength estimate, but never become hard ownership constraints.

## Bidding

For each possible trump, `bid.ts` computes own meld and estimates trick points. In default tens counting, the projection is:

`own meld + partner signal + 35 + 12 × trump length + 17 × aces + 8 × tens backed by an ace + 0.15 × own counter points`

The trick-strength part scales with the configured deck counter total. The partner signal is 60 before any partner action, 25 after a partner pass, or 100 after a partner bid. A bid is a rough meld signal. It does not reveal any specific card. The ceiling is the projection minus 35, rounded down to `bidStep`. The bot bids only the legal minimum, and passes when that minimum exceeds the ceiling. A forced dealer contract remains the engine's decision.

For example, `AS0 AH0 AD0 AC0 TS0 KS0 QS0 JS0 9S0 KH0 QH0 JD0` has 320 meld with spades: a run, dix, heart marriage, aces around, and pinochle. Six trump, four aces, one protected ten, and 70 counter points give a 573.5 projection before the partner acts. With a 35 safety margin and a step of 10, the ceiling is 530. A partner pass lowers it to 500; a partner bid raises it to 570. The bot still bids only the next legal increment. Shooting requires permission from the rules plus eight trump, both trump aces, and an ace in every side suit.

## Trump, passing and meld

Trump selection maximizes this projection, whose suit-dependent terms reward meld and trump length. Passing toward the bidder ranks trump first, with higher ranks first, then aces, cards in meld, and pinochle pieces. Passing back reverses those priorities, protecting trump, aces, and meld. It selects exactly the requested number of distinct cards, including unusual configured pass counts. During melding the bot declares its whole hand and confirms; `computeMeld` remains the authority on points.

## Trick play: determinized Monte Carlo

`play.ts` evaluates only `legal.playableCards`. For each sample, `knowledge.ts` assigns the unknown deck to opponents, respecting remaining counts, shown voids, and ownership established by public meld. Randomized backtracking gives constrained deals; an assignment has a bounded search limit and failure falls back to the heuristic. Every candidate uses the same sampled deal, reducing sampling noise between candidates.

Each candidate is played to the hand's end. All four simulated seats use the same heuristic and `legalPlays` from the real rules. The policy leads boss cards, favors drawing trump when the bidding team holds length, wins cheaply against an opponent, puts counters on a safe partner trick, and otherwise discards low non-counters. The policy sees its simulated own hand and the union of unplayed cards, which is public information, rather than consulting a simulated opponent's hand to select a card. Scoring includes counters, the last trick bonus, whether each side saved meld, and the bidding side's make/set result. Shoot contracts use the all-tricks outcome. The candidate with the best mean team score difference wins.

## Budget and determinism

The default work budget is 40 deals, corresponding to `budgetMs: 60`. Smaller budgets reduce the sample count; below 2 ms the pure heuristic runs. Seeded calls use a fixed work count so identical views, seeds, and options give identical actions regardless of CPU speed. This makes `budgetMs` a soft effort budget for seeded calls, rather than a hard wall-clock deadline. Unseeded calls also stop between complete sample rounds when elapsed time reaches the budget. A round evaluates every candidate, so a deadline can overrun by one round. JavaScript scheduling can add further latency.

## Bots at the table

Bots occupy `seats.bot`, with a null `user_id`. The six names are Mabel, Otto, Pearl, Gus, Hazel, and Walt, choosing unused names in that order. Migration `0003_bots.sql` adds the column and the human-or-bot constraint. Host-only management, seat claims, and game start all lock the parent table. A human cannot overwrite a bot; the host must remove it first. Trades identify seated humans by user ID. Starting counts bots toward four occupied chairs and requires at least one human.

## Pacing and the tick endpoint

`POST /api/tables/[code]/tick` verifies that the caller is a seated human. `botTick` makes one turn action, using the seed `gameId:rev`, or declares and confirms every unconfirmed bot during melding. It never advances a finished hand. Human actions that leave the game in melding immediately run the bot melding worker. Other bot moves wait for the client's next paced tick, including the first move after game start.

Each bot action uses `commit_bot_action`. That service-role-only transaction verifies bot ownership, compares the old revision, updates the game, and appends the seat and action to `game_actions`. A stale revision returns a null commit result without updating the game or inserting an audit row. The worker translates that result to `acted: false` with the current revision. Migration `0004_bot_conflict_noop.sql` makes this an ordinary return rather than raising `40001`: the live database API retried that serialization error until an upstream timeout during concurrent ticks. The winner broadcasts the committed revision. Melding uses one transaction per declaration or confirmation; concurrent workers may split progress across those actions, but cannot duplicate any revision. A dedicated melding-only path prevents the human action hook from accidentally playing a bot turn if another request has already finished melding.

## Measured results

Measured results are recorded below after running `node scripts/bot-arena.mjs 50 3` and `node scripts/bot-arena.mjs 50 60`. The arena alternates the bot team's seats and uses complete games to the default 1500 target. The random team chooses random legal trump, passes, and plays, declares full meld, and randomly bids one legal increment with 25% probability rather than selecting arbitrary unbounded bid amounts. These results measure performance against that baseline, not against skilled humans.

The reduced-budget run won 50/50 games, 100%, over 20,715 positions. Its 10,300 bot decisions averaged 0.454 ms. At the default 60 ms effort budget, the bots also won 50/50 games over 20,247 positions. Its 10,055 decisions averaged 8.119 ms. Both measurements include bidding, passing, and melding decisions as well as trick decisions, and exclude database and network time.

## Known weaknesses and next steps

The bots have no convention for partner signals, no learned opponent model, and no memory across hands beyond public information in the view. The projection does not estimate the value of each possible four-card exchange. Sampling uses hard public constraints without weighting deals by bidding style or subtle card choices. The playout policy has no search for coordinated squeezes or deliberate losing plays. Future work should evaluate partner signalling, fit opponent bidding tendencies, and learn calibrated projections from audited game logs. A stronger baseline and held-out seeds would give a more useful measure than random opponents.

## Validation

Validation uses TypeScript, ESLint, Vitest, the arena, and the HTTP smoke script. Server regression tests cover a null stale-commit result, exactly one committed action per tick, and waiting on human turns and hand advancement. The smoke script covers a four-human hand and a second hand with Ada plus three bots. It verifies management permissions, bot chair protection, rejection of ticks from unseated callers, concurrent tick progress, and absence of other hands throughout the bot hand with `revealHands: false`.

Both database pushes completed successfully: `Applying migration 0003_bots.sql...` and `Applying migration 0004_bot_conflict_noop.sql...`, each followed by `Finished supabase db push.` The stale-commit probe returned `data: null, error: null` in 424 ms after the fix.

## Files

The implementation touches `src/engine/game.ts`; the seven modules under `src/engine/ai/`; `src/engine/__tests__/ai.test.ts` and `arena.ts`; `src/server/game.ts`, `tables.ts`, and the `bots.test.ts` and `contract.test.ts` server tests; the bots, bots/fill, and tick API route files; migrations 0003 and 0004; `scripts/bot-arena.mjs` and `scripts/smoke.mjs`; and this document. No UI files were edited by the implementation worker.

## Tuning

The admin saves `bots` in `app_settings.global`. Each bot tick reads settings through a 30-second process cache and passes them to `chooseAction`. Partial configs inherit `DEFAULT_SETTINGS.bots` in `src/lib/settings.ts`.

- `samples`, default 40, caps sampled deals. `budgetMs`, default 40, also caps work at `floor(budgetMs * 2 / 3)` samples. Below 2 ms the heuristic runs alone. Unseeded decisions check elapsed time between complete sample rounds. Seeded server decisions use a fixed work count for replay, so this is a soft compute budget rather than a hard deadline.
- `bidMargin`, default 20, subtracts points from the projection before rounding down to the bid step. `bidAggression`, default 1, multiplies projected trick points, including the counter-point term, while leaving meld and partner signals unchanged.
- `partnerBidBonus`, default 20, adds to the existing 100-point partner-bid signal. The signals before a partner acts and after a partner passes remain 60 and 25.
- `shootMinTrump`, default 8, replaces the minimum trump count in the shoot test. Both trump aces and an ace in every side suit are still required.
- `pullTrumpMin`, default 6, replaces the bidding partnership's trump-length threshold for favoring trump leads. Boss cards still take priority.
- `smearWillingness`, default 0.7, weights counter points against card strength on a safe partner trick. At zero the policy uses its ordinary cheap-discard logic; at one it puts the most counters on the trick. The same settings govern simulated playouts.
- `tickDelayMs`, default 900, is returned as `delayMs` by the tick endpoint for client pacing.

The arena referee now lives in `src/engine/ai/arena.ts`; it uses complete engine state to run games but passes only `PlayerView` into decision code. The admin arena runs 1 to 40 complete games with the saved strategy settings and a 1 ms effort override, selecting heuristic-only play. Its `avgBidMade` counts all completed hands where the bidding side succeeded, including shoot outcomes. The CLI imports this same referee and accepts a separate effort budget. Its legacy metrics remain available alongside the admin response fields.

Guest accounts cannot add or fill bot chairs. Both HTTP handlers and the database management function require a saved account. The smoke test now checks these denials after its four-human hand; full bot games remain covered by engine tests.
