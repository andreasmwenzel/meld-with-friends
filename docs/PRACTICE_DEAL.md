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

- **Bidding.** West bids 25, North passes, and East passes rather than raise its
  own partner (bots let a partner's bid stand; see `docs/COMPUTER_PLAYERS.md`).
  West has bid to its limit, so any raise from South wins the auction, and the
  learner can take it cheaply at 26. The initial 11 heart meld does not cover
  the contract; account for partner support and counters. If South passes too,
  West plays at 25.
- **Trump.** Hearts give 11 opening meld: royal marriage 4, spade marriage 2,
  pinochle 4 and dix 1. Spades give 10, clubs 9 and diamonds 8. Heart length
  and the easier run completion make hearts the clear choice beyond the small
  difference in meld. North's missing jack is hidden until the pass, so it is a
  retrospective teaching point rather than information available during bidding.
- **Passing and meld.** With hearts trump, the actual partner bot passes KH0,
  JH1, AD0 and AS0. This completes the run and adds two aces. Returning JD0,
  QS0, KC1 and 9C0 is the bot's choice for South. It keeps seven hearts and
  all its aces while moving the whole weak pinochle to North. Neither piece
  has enough suit length and high-card control to justify keeping it for tricks.
  South's resulting 16 meld is run 15 and dix 1; North can declare the pinochle's
  4 points instead. The royal marriage is part of the run and does not score separately.
- **Trick play.** With 16 personal meld against a 26 bid, counters and the
  partner's contribution still matter. Observe follow-suit, heading and trumping
  obligations. A side must take a trick to save its meld.

## Coach suggestions

The coach (`src/engine/coach/advice.ts`, tests in `src/engine/__tests__/advice.test.ts`) follows
the same teaching path. Its bid limit for South is 31: 11 heart meld, about 15 in tricks, about 2
from a partner who passed, and the chance that North holds the J♥ for the run, less a small
margin. It suggests the minimum, 26, which wins the auction.
It names hearts. On the pass back it suggests 9♣, K♣, 10♣ and A♦, keeping the spade marriage
and pinochle for 22 personal meld. That leaves South void in clubs, and the A♦ still wins
for North. Compare that with the bot's choice to transfer the pinochle and keep its aces. Once everyone has
melded, practice waits for "Start play" before a computer leads, so the meld can be read first.

Card IDs use rank, suit and copy number, with `T` for ten. Tests verify the actual
bot auction and pass choices, complete all twelve tricks with legal plays, and
check both original and post-pass reveal snapshots. They also verify an all-pass
auction and a fresh restart after play or mutation.

Start over always returns to hand one for another comparison. Subsequent hands
advanced through the normal engine follow the same seeded sequence. This fixture
fixes the deal and the documented opening auction, not every later bot decision
under its existing time budget. No bidding or passing policy is overridden.
