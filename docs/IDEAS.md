## Tracking · [GitHub issues](https://github.com/andreasmwenzel/meld-with-friends/issues)
GitHub issues are now the backlog of record. New ideas go in as issues labelled `idea`; this file keeps the shipped and rejected history.
# Backlog and progress

Working list of improvements for Meld. Status: `done`, `doing`, `next`, `idea`, `no` (decided against).

## Shipped
- done · Landing, guest play, lobby, friends with presence, table codes, seats and swaps
- done · Full pinochle engine with house rules (counting, shoot the moon, reveal hands) and saved defaults
- done · Computer players (PlayerView-only, Monte Carlo trick play), host controls, pacing
- done · Admin page: bot tuning, free-tier limits, arena, usage (server wiring in progress)

## Doing
- done · Free-tier guardrails: rate limits, growth caps, cleanup cron, account check for bots
- done · Admin page wired: settings row, arena, usage, bot tuning

## Next (ordered)
0. done · Robustness batch (from review): resync on reconnect and tab focus; keep last snapshot on transient errors; discard stale responses; bind actions to the revision the player saw (expectedRev + action id); retry stalled bot ticks with backoff; keep the last trick visible into hand over; brief pause showing who took each trick; 16-card hand (bidder after passing) must fit a phone (wrap or scroll)
1. done · Rematch at game over: same table, same seats, fresh game, one click for the host
2. done · Your-turn cues: tab title flash, soft chime (opt-in), brass glow already on the seat
3. done · Show my meld value during bidding (own hand only, so no information leak)
4. done · Bot stand-in when a human leaves mid-game: host can hand a chair to a computer
5. next · Trick history viewer: step back through the hand's tricks
6. done · Game history for saved accounts: past games, scores, partners
7. done · PWA manifest and icons so the table installs on phones
8. done · Score breakdown per hand on the scorepad: declared vs saved meld, counters, last trick, set penalty
9. done · Generated rules tests: card conservation, legal-action consistency, deterministic replay, edge pass counts, early failed shoots, both teams crossing target
10. done · Explain why a card is illegal (reason codes from the rules module shown on hover/long-press)
11. done · Admin: table inspector (state, players, last activity) with finish/kill, and a ban list

## Shipped in the second round
- done · Card options: four-colour deck, big corner index, hand size (per browser)
- done · Compact scorepad during play; full pad at hand over
- done · "This hand so far" recap with since-you-were-away marks; leisurely table pace with 60-day idle timeout
- done · Branded email templates written (needs a free SMTP account before Supabase will accept them; see supabase/README.md)
- done · Mobile polish pass across landing, lobby, join, seating, chat, admin, practice

## Next
- done · Web push "your turn" notifications for leisurely tables (not yet tried on a real device)
- done · "Add as friend" buttons on the seating screen using the tablemates endpoint
- next · Custom SMTP (Brevo/SendGrid free tier) then apply the branded emails
- next · Board-level mobile pass once more with real players (Game.tsx was off limits in the polish pass)

## Ideas
- done · Guided practice hand for first-time players, driven by the real engine
- done · Everyone-ready acknowledgement before the next deal, with host override
- done · Tablemates endpoint for adding table companions as friends (UI pending); named friend groups that can be invited when dealing (#2)
- done · Table pause and host handoff (bots stop while paused)
- done · Admin telemetry: tick no-ops, broadcast failures, resync fetches, last cleanup run
- idea · Spectator chairs (watch a table without a seat)
- idea · Double-deck pinochle (80 cards, no nines) as a second rules family
- idea · Emoji reactions in table talk
- idea · Partner signalling conventions for bots; opponent modelling from bid history
- idea · Weekly recap email for saved accounts (needs custom SMTP first)
- idea · Accessibility pass with a screen reader: trick announcements, card labels, focus order

## Decided against (for now)
- no · Undo a played card: pinochle has no take-backs at the kitchen table either
- no · Public lobbies with strangers: the brief is friends only
