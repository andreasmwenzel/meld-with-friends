# Computer players

How Meld's bots bid, pass, meld and play, and how they are kept honest. Short version: a bot gets
exactly the `PlayerView` a human gets, bids from a projection of meld plus likely tricks, and plays
tricks by sampling hidden hands consistent with everything seen so far and playing each option out.
Tuning knobs live in the admin page (`/admin`) and are described at the end.

## No cheating, by construction

The computer player entry point is `chooseAction(view, options)` in `src/engine/ai/index.ts`. Its only game input is a `PlayerView`. The server constructs that view with `viewFor` before asking for an action. Other hands and the shuffle seed never enter the decision code. The optional AI seed controls sampling, independently of the engine's deal seed. Even the hand-over `revealed` field is ignored.

`src/engine/game.ts` records every play with its seat, resets that list when dealing, and copies it into each view as `playedCards`. Public meld declarations, bids, trick counts, the current trick, rules, and the bot's own cards supply the rest of its information. The engine tests check the AI's imports: only sibling AI modules and engine types, meld, and rules are permitted. They reject private state, server imports, I/O imports, and reads of revealed hands. Full-game tests apply every chosen action through the actual engine, and sampling tests verify counts, unique cards, public voids, and exclusion of played cards and the bot's own cards from opponents' sampled hands.

## What a bot knows

`knowledge.ts` groups the ordered plays into tricks. Failing to follow a lead proves a void in the led suit. Discarding a different non-trump suit also proves a void in trump, since this ruleset requires trumping when unable to follow. Played cards are definitely gone. Unplayed cards exposed in meld stay assigned to the declaring seat. Cards the bot passed to its partner (`recap.myPassedOut`, its own action) stay assigned to the partner unless they came back or were played. Every other card outside the bot's hand is unknown. Per-seat estimates include the most recent bid, public known cards, remaining hand count, and suit expectations distributed among seats that have not shown a void. Bids weight where unknown cards are sampled (below), but never become hard ownership constraints.

## Bidding

For each possible trump, `bid.ts` computes own meld and estimates trick points. With tens counting, the projection below is expressed in classic units. Modern games divide all point terms by ten:

`own meld + partner signal + 35 + 12 × trump length + 17 × aces + 8 × tens backed by an ace + 0.15 × own counter points`

The trick-strength part scales with the configured deck counter total. The partner signal comes from partner's public calls (conventions below). A bid is a rough meld signal. It does not reveal any specific card. The ceiling is the projection minus the bid margin, rounded down to `bidStep`. The bot bids only the legal minimum, and passes when that minimum exceeds the ceiling. A forced dealer contract remains the engine's decision.

### Bidding conventions

`chooseBid` and `partnerSignal` in `bid.ts`. Signal values are in classic units (modern games scale them by 0.1).

- **Don't bid against partner.** When partner holds the high bid, a bot passes and lets it stand. It takes over only if its own hand could carry the higher contract with no help: its ceiling, computed with a partner signal of 0, still reaches the next legal bid. This holds whether or not an opponent is still in the auction, so two bots on one side never race each other, and once both opponents have passed the auction ends at partner's bid unless the next bidder's solo ceiling justifies a takeover.
- **Reading partner's calls.** No call yet: 60. A pass at any time when the other side held the bid, or when nobody had bid: 25, a weak hand. A pass over our own side's high bid: 60, since by the first convention it only says partner had no takeover hand. Any bid, even one partner later stopped raising: 100 plus `partnerBidBonus`.
- **Jump bids show meld.** Each step a partner's bid goes over the cheapest legal bid adds 30, up to two steps (60). Bots do not make jump bids themselves (the arena showed it cost them, see Measured results); the reading is there for a human partner who jumps to show meld.
- **Opponents' calls** do not change the bid, but they shape how a bot imagines the hidden hands during play.

### Opponent modelling from the auction

`bidStrength` in `knowledge.ts` reads each seat's public calls the same way `partnerSignal` does: -0.5 for passing without a bid while the other side held the bid or nobody had bid, 0 before any call or for a pass over its partner's high bid, and 0.4 rising to 1 for a bid ten steps above the minimum (or a shoot). `cardWeights` turns that into relative odds for unknown cards: aces `exp(0.6 × strength)`, trump `exp(0.4 × strength)`, and on top of that trump is `exp(0.8)` likelier with the declarer (it chose trump and was passed trump) and `exp(-0.4)` with the declarer's partner, when passing is on. `sampleDeal` tries seats for each card in a weighted random order (first choice proportional to weight) inside the same backtracking, so counts, voids and public meld still hold exactly.

For example, in classic scoring, `AS0 AH0 AD0 AC0 TS0 KS0 QS0 JS0 9S0 KH0 QH0 JD0` has 320 meld with spades: a run, dix, heart marriage, aces around, and pinochle. Six trump, four aces, one protected ten, and 70 counter points give a 573.5 projection before the partner acts. With a 35 safety margin and a step of 10, the ceiling is 530. A partner pass lowers it to 500; a partner bid raises it to 570. The bot still bids only the next legal increment. Bots consider shooting only at `deciding_shoot`, after the pass or after naming trump when passing is off. The test uses the named trump and assumes no help from partner. It requires at least `shootMinTrump` trump, both trump aces, and enough unbeatable trump leads to draw every missing trump even if one opponent holds them all. Every non-trump card must be an ace. Voids in side suits are fine once opposing trump is gone. All unseen trump is treated as hostile, including cards that could be set aside with partner. This deliberately declines uncertain shoots. Partner signals and meld add nothing to the test. A decline starts normal melding; a shoot starts play immediately with the partner sitting out.

## Trump, passing and meld

Trump selection maximizes this projection, whose suit-dependent terms reward meld and trump length. Passing toward the bidder ranks trump first, with higher ranks first, then aces, cards in meld, and pinochle pieces. Passing back reverses those priorities, protecting trump, aces, and meld. It selects exactly the requested number of distinct cards, including unusual configured pass counts. During melding the bot declares its whole hand and confirms; `computeMeld` remains the authority on points.

## Trick play: determinized Monte Carlo

Bots claim the rest whenever `legal.canClaim` is true, before choosing a card. This is a proof from their own hand and public plays, independent of sampling or hidden ownership; the ordinary bot tick commits the claim as one action.

`play.ts` evaluates only `legal.playableCards`. For each sample, `knowledge.ts` assigns the unknown deck to the other seats, respecting remaining counts, shown voids, ownership established by public meld and passing, and leaning toward what each seat's bids suggest. Randomized backtracking gives constrained deals; an assignment has a bounded search limit and failure falls back to the heuristic. Every candidate uses the same sampled deal, reducing sampling noise between candidates.

Each candidate is played to the hand's end. The active simulated seats use the same heuristic and `legalPlays` from the real rules. The policy leads boss cards, favors drawing trump when the bidding team holds length, wins cheaply against an opponent, puts counters on a safe partner trick, and otherwise discards low non-counters. The policy sees its simulated own hand and the union of unplayed cards, which is public information, rather than consulting a simulated opponent's hand to select a card. Scoring includes counters, the last trick bonus, whether each side saved meld, and the bidding side's make/set result. Solo shoot simulations skip the partner, group plays into three-card tricks, and stop at the first trick the declarer loses. They use the all-tricks outcome, with no meld, counters or last-trick bonus. The candidate with the best mean team score difference wins.

## Budget and determinism

The default work budget is 40 deals, corresponding to `budgetMs: 60`. Smaller budgets reduce the sample count; below 2 ms the pure heuristic runs. Seeded calls use a fixed work count so identical views, seeds, and options give identical actions regardless of CPU speed. This makes `budgetMs` a soft effort budget for seeded calls, rather than a hard wall-clock deadline. Unseeded calls also stop between complete sample rounds when elapsed time reaches the budget. A round evaluates every candidate, so a deadline can overrun by one round. JavaScript scheduling can add further latency.

## Bots at the table

Bots occupy `seats.bot`, with a null `user_id`. The six names are Mabel, Otto, Pearl, Gus, Hazel, and Walt, choosing unused names in that order. Migration `0003_bots.sql` adds the column and the human-or-bot constraint. Host-only management, seat claims, and game start all lock the parent table. A human cannot overwrite a bot; the host must remove it first. Trades identify seated humans by user ID. Starting counts bots toward four occupied chairs and requires at least one human.

## Pacing and the tick endpoint

`POST /api/tables/[code]/tick` verifies that the caller is a seated human. `botTick` makes one turn action, using the seed `gameId:rev`, or declares and confirms every unconfirmed bot during melding. It never advances a finished hand. Human actions that leave the game in melding immediately run the bot melding worker. Other bot moves wait for the client's next paced tick, including the first move after game start.

Each bot action uses `commit_bot_action`. That service-role-only transaction verifies bot ownership, compares the old revision, updates the game, and appends the seat and action to `game_actions`. A stale revision returns a null commit result without updating the game or inserting an audit row. The worker translates that result to `acted: false` with the current revision. Migration `0004_bot_conflict_noop.sql` makes this an ordinary return rather than raising `40001`: the live database API retried that serialization error until an upstream timeout during concurrent ticks. The winner broadcasts the committed revision. Melding uses one transaction per declaration or confirmation; concurrent workers may split progress across those actions, but cannot duplicate any revision. A dedicated melding-only path prevents the human action hook from accidentally playing a bot turn if another request has already finished melding.

## Table talk

A seated bot offers a short comment every three or four deals, alternating those gaps with a
starting offset derived from the table id. The first deal stays quiet. Throw-ins and all-pass
redeals count as deals too. One bot speaks per event, even when several bots are seated.
A successful rematch also gets a greeting, separately from the hand cadence.

The pure, seeded picker in `src/lib/bots/tableTalk.ts` uses only the scored hand record, public
scores and seat names. It reacts to made or set contracts, big opposing bids, moon attempts,
big meld, score gaps and game results. It receives no hands, passes, private views or deal seed.
Display names in lines are bounded to keep comments under 80 characters: a name longer than 16
characters is shortened to its first word, or cut at 16 when that word is still too long. Names are
substituted literally, so `$&` in a name stays as typed.

Situations are told apart by who bid: the speaker itself, its partner, or an opponent, each for a
made bid, a set and (for the bidder's side) a moon. A shoot decides the game, so a moon line is
the only comment on that game and reads as a game-over line.

Each bot has its own voice, rooted in its name, in `src/lib/bots/tableTalkLines.ts`: at least six
lines per bot for each of the twenty situations. Any other speaker name falls back to a plain,
neutral voice. The voices:

- **Mabel**: a cheerful grandmother. Calls everyone "dear" and "love", talks in baking and kitchen
  metaphors, and encourages everyone, opponents included.
- **Otto**: a dry numbers man. Quotes odds and percentages, understated, quietly pleased when the
  arithmetic holds, and allowed the odd joke about his name reading the same backwards.
- **Pearl**: old-Hollywood elegance. "Darling", scripts, premieres and encores; compliments
  come with one eyebrow raised.
- **Gus**: big-hearted and loud. Sports-commentator energy, exclamation marks, a theatrical
  groan at a set and a high five for everything else.
- **Hazel**: sharp and competitive. Trash-talks with a wink, then gives credit anyway.
- **Walt**: an unhurried old-timer. Fishing and porch talk, and tall tales from back in '62.

House rules for the words: friendly table banter only, nothing that could sting a beginner, no
gambling talk. A bot that bid and went set, or shot and missed, owns it and apologizes to its
partner; when the partner bid, the bot is kind and never scolds. Teasing an opponent who went set
stays playful, and an opponent's missed moon gets respect, not gloating. Big-meld lines name
nobody, since either side may have melded. Lines speak only of the scored, public result and
never claim a margin ("so close") the picker cannot know. Moon lines promise no next hand.

Both human and bot scoring actions schedule a comment only after winning the revision-guarded
commit. Losing ticks and duplicate human actions schedule nothing. `src/server/botTableTalk.ts`
uses Next.js `after()` for seat-name lookup and delivery, so chat cannot delay the action response;
lookup, scheduling and delivery failures are logged. There are no retries or stored messages.
Delivery is best effort, with at most one send attempt per committed event. A disconnected player
may miss a line, just as with human chat.

Bot messages use the existing `chat:{code}` channel's `message` event and
`{ id, from, name, text, at }` shape. `from` is `bot:{tableId}:{seat}`, distinct from human UUIDs;
the stable event id also lets the client deduplicate delivery. No chat UI changes are needed.

## Measured results

Measured results are recorded below after running `node scripts/bot-arena.mjs 50 3` and `node scripts/bot-arena.mjs 50 60`. Those arena runs alternated the bot team's seats and used complete games to the former default 1500 target with classic scoring. The random team chooses random legal trump, passes, and plays, declares full meld, and randomly bids one legal increment with 25% probability rather than selecting arbitrary unbounded bid amounts. These results measure performance against that baseline, not against skilled humans.

The reduced-budget run won 50/50 games, 100%, over 20,715 positions. Its 10,300 bot decisions averaged 0.454 ms. At the default 60 ms effort budget, the bots also won 50/50 games over 20,247 positions. Its 10,055 decisions averaged 8.119 ms. Both measurements include bidding, passing, and melding decisions as well as trick decisions, and exclude database and network time.

### Bidding conventions against the previous bots (issue #5)

`node scripts/bot-duel.mjs [deals] [ref] [budgetMs]` plays the working tree's bots against the bots at a git ref, default `origin/main`. Every deal is played twice with the teams swapped and the same sampling seeds, so deal luck cancels. Games use default rules (modern scoring, 150 to win). `partnerRaises` counts bids over partner's high bid after both opponents had passed.

Against the bots before this change (2026-10-26):

| Run | Games | New bots win | Mean final score, new minus old | Bids made, new / old | Partner raises, new / old |
| --- | --- | --- | --- | --- | --- |
| `bot-duel.mjs 500 origin/main 0` (heuristic play) | 1000 | 54.8% | +9.2 | 83.0% / 78.8% | 99 / 4449 |
| `bot-duel.mjs 150 origin/main 15` (10 samples per play; measured before the takeover ceiling dropped partner's signal to 0) | 300 | 55.7% | +10.8 | 87.8% / 82.5% | 76 / 1276 |

Variants tried on the way, each as a paired duel of new against new with one switch: allowing one "support" raise of partner while an opponent is still bidding lost 44.7% of 2000 games (-9.1 per game), so bots never make it. Jump bids to show meld cost about 2 points per game against the old bots, so bots don't jump. Turning the auction-based card weights off lost 47.5% of 400 games at 15 ms (-3.6 per game), so the weights stay.

## Known weaknesses and next steps

The partner conventions are hand-set, not learned, and the auction-based card weights are fixed constants rather than fitted to real players. Bots keep no memory across hands beyond public information in the view. The projection does not estimate the value of each possible four-card exchange. Sampling does not read subtle card choices during play (for example a discard showing strength). The playout policy has no search for coordinated squeezes or deliberate losing plays. Future work should evaluate partner signalling, fit opponent bidding tendencies, and learn calibrated projections from audited game logs. A stronger baseline and held-out seeds would give a more useful measure than random opponents.

## Validation

Validation uses TypeScript, ESLint, Vitest, the arena, and the HTTP smoke script. Server regression tests cover a null stale-commit result, exactly one committed action per tick, and waiting on human turns and hand advancement. The smoke script covers a four-human hand and a second hand with Ada plus three bots. It verifies management permissions, bot chair protection, rejection of ticks from unseated callers, concurrent tick progress, and absence of other hands throughout the bot hand with `revealHands: false`.

Both database pushes completed successfully: `Applying migration 0003_bots.sql...` and `Applying migration 0004_bot_conflict_noop.sql...`, each followed by `Finished supabase db push.` The stale-commit probe returned `data: null, error: null` in 424 ms after the fix.

## Files

The implementation touches `src/engine/game.ts`; the seven modules under `src/engine/ai/`; `src/engine/__tests__/ai.test.ts` and `arena.ts`; `src/server/game.ts`, `tables.ts`, and the `bots.test.ts` and `contract.test.ts` server tests; the bots, bots/fill, and tick API route files; migrations 0003 and 0004; `scripts/bot-arena.mjs` and `scripts/smoke.mjs`; and this document. No UI files were edited by the implementation worker.

## Tuning

The admin saves `bots` in `app_settings.global`. Each bot tick reads settings through a 30-second process cache and passes them to `chooseAction`. Partial configs inherit `DEFAULT_SETTINGS.bots` in `src/lib/settings.ts`.

- `samples`, default 40, caps sampled deals. `budgetMs`, default 40, also caps work at `floor(budgetMs * 2 / 3)` samples. Below 2 ms the heuristic runs alone. Unseeded decisions check elapsed time between complete sample rounds. Seeded server decisions use a fixed work count for replay, so this is a soft compute budget rather than a hard deadline.
- `bidMargin`, default 20 in classic units, subtracts points from the projection before rounding down to the bid step. `bidAggression`, default 1, multiplies projected trick points, including the counter-point term, while leaving meld and partner signals unchanged.
- `partnerBidBonus`, default 20 in classic units, adds to the existing 100-point partner-bid signal. The signals before a partner acts and after a partner passes remain 60 and 25.
- `shootMinTrump`, default 8, replaces the minimum trump count in the shoot test. Both trump aces, enough safe trump leads to draw every missing trump, and only aces outside trump are still required.
- `pullTrumpMin`, default 6, replaces the bidding partnership's trump-length threshold for favoring trump leads. Boss cards still take priority.
- `smearWillingness`, default 0.7, weights counter points against card strength on a safe partner trick. At zero the policy uses its ordinary cheap-discard logic; at one it puts the most counters on the trick. The same settings govern simulated playouts.
- `tickDelayMs`, default 900, is returned as `delayMs` by the tick endpoint for client pacing.

The arena referee now lives in `src/engine/ai/arena.ts`; it uses complete engine state to run games but passes only `PlayerView` into decision code. The admin arena runs 1 to 40 complete games with the saved strategy settings and a 1 ms effort override, selecting heuristic-only play. Its `avgBidMade` counts all completed hands where the bidding side succeeded, including shoot outcomes. The CLI imports this same referee and accepts a separate effort budget. Its legacy metrics remain available alongside the admin response fields.

Guest accounts cannot add or fill bot chairs. Both HTTP handlers and the database management function require a saved account. The smoke test now checks these denials after its four-human hand; full bot games remain covered by engine tests.

New tables use modern scoring. Point-valued bot settings and heuristic constants remain in classic
units and are scaled by 0.1 for modern games. Meld, counters, bid increments and contract amounts
use the table's chosen scale.
