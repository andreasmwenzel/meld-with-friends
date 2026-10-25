# Curated practice deal

Issue #27 uses `newPracticeGame()` in `src/engine/practice.ts`. It calls the normal
engine with seed `practice-v1-1784606`, dealer South, modern scoring and end-of-hand
reveals enabled. Both mounting practice and Start over call this factory. Each
call returns fresh state, including the original hands, empty bids, zero scores
and revision zero. Multiplayer continues to call `newGame` with its own seed.

The fixture uses the existing seeded shuffle. It contains the full 48-card deck,
with twelve distinct card IDs per seat and two copies of each face. The test pins
every card ID so a shuffle change cannot silently change the lesson.

| Seat | Spades | Hearts | Diamonds | Clubs |
| --- | --- | --- | --- | --- |
| South, learner | A K Q | A 10 K Q 9 | J | 10 K 9 |
| West | Q | 10 Q 9 | 10 Q Q J | A 10 Q J |
| North, partner | A 10 10 K 9 | K J | A K K 9 | 9 |
| East | J J 9 | A J | A 10 9 | A K Q J |

## Learning opportunities

Hearts are the intended trump choice. South has five hearts, including A 10 K Q,
and needs only a jack to complete a run. Spades have only three cards, A K Q,
and need both a ten and a jack. South has two aces and no complete run, so the
opening hand still needs help from the partner and points from trick play.

- **Bidding.** West bids 25, North passes, and East bids 26 under the existing
  bot policy. A learner raise to 31 makes West and East pass on their second
  turns. This is the repeatable teaching path. A smaller raise lets West compete
  again. The initial 11 heart meld does not cover the contract; account for
  partner support and counters. If everyone passes instead, South is stuck at 25.
- **Trump.** Hearts give 11 opening meld: royal marriage 4, spade marriage 2,
  pinochle 4 and dix 1. Spades give 10, clubs 9 and diamonds 8. Heart length
  and the easier run completion make hearts the clear choice beyond the small
  difference in meld. North's missing jack is hidden until the pass, so it is a
  retrospective teaching point rather than information available during bidding.
- **Passing and meld.** With hearts trump, the actual partner bot passes KH0,
  JH1, AD0 and AS0. This completes the run and adds two aces. Returning 9C0, KC1,
  TC1 and KS0 is the existing bot's choice for South. It keeps seven hearts,
  all four aces, and Q spades with J diamonds for the pinochle, while breaking
  the spade marriage. The learner can compare keeping that marriage with keeping
  the extra ace or trump. The resulting 20 meld is run 15, pinochle 4 and
  dix 1. The royal marriage is part of the run and does not score separately.
- **Trick play.** With 20 personal meld against a 31 bid, counters and the
  partner's contribution still matter. Observe follow-suit, heading and trumping
  obligations. A side must take a trick to save its meld.

## Coach suggestions

The coach (`src/engine/coach/advice.ts`, tests in `src/engine/__tests__/advice.test.ts`) follows
the same teaching path. Its bid limit for South is 31: 11 heart meld, about 15 in tricks, about 2
from a partner who passed, and the chance that North holds the J♥ for the run, less a small
margin. It suggests the minimum each turn (27, 29, then 31), which wins the auction at 31.
It names hearts. On the pass back it suggests 9♣, K♣, 10♣ and A♦ instead of the bot's K♠:
that keeps the spade marriage for 22 meld, leaves South void in clubs, and the A♦ still wins
for North. The bot's choice stays as it is, so the two can be compared. Once everyone has
melded, practice waits for "Start play" before a computer leads, so the meld can be read first.

Card IDs use rank, suit and copy number, with `T` for ten. Tests verify the actual
bot auction and pass choices, complete all twelve tricks with legal plays, and
check both original and post-pass reveal snapshots. They also verify an all-pass
auction and a fresh restart after play or mutation.

Start over always returns to hand one for another comparison. Subsequent hands
advanced through the normal engine follow the same seeded sequence. This fixture
fixes the deal and the documented opening auction, not every later bot decision
under its existing time budget. No bidding or passing policy is overridden.
