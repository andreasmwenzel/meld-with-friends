// Coaching suggestions for the seat that has to act. Pure functions of a PlayerView: they use only
// what that player can see, and each returns the action, the cards it involves, and a plain reason.
import { DEFAULT_SETTINGS, type BotConfig } from '../../lib/settings';
import { cardLabel } from '../deck';
import { autoMeldSelection } from '../hand';
import { computeMeld } from '../meld';
import { trickWinner } from '../rules';
import { scoringFactor } from '../scoring';
import type { Action, CardId, MeldKind, PlayerView, Rank, RulesConfig, SeatIndex, Suit } from '../types';
import { heuristic } from '../ai/play';
import { points, ranks, strength, suits, suitOf, team } from '../ai/shared';

export interface Advice {
  /** what "Do this" performs */
  action: Action;
  /** cards the suggestion is about, for highlighting in the hand */
  cards: CardId[];
  /** the suggestion in a few words, e.g. "Bid 27, up to 31" */
  headline: string;
  /** one or two plain sentences saying why */
  reason: string;
}

export interface AdviceOptions {
  /** display name for a seat; defaults to "your partner" and seat words */
  nameOf?: (seat: SeatIndex) => string;
  config?: BotConfig;
}

export const SUIT_WORD: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const SINGULAR: Record<Suit, string> = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
const SEAT_WORD = ['South', 'West', 'North', 'East'] as const;
const partnerOf = (seat: SeatIndex) => ((seat + 2) % 4) as SeatIndex;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "A♠", "A♠ and K♦", "9♣, K♣ and 10♣". */
export function listCards(cards: CardId[]): string {
  const labels = cards.map(cardLabel);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
function listWords(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
function nameFor(view: PlayerView, options: AdviceOptions) {
  return (seat: SeatIndex) => options.nameOf?.(seat) ?? (seat === partnerOf(view.seat) ? 'your partner' : SEAT_WORD[seat]);
}
const meldTotal = (cards: CardId[], trump: Suit, rules: RulesConfig) => computeMeld(cards, trump, rules).total;
const without = (cards: CardId[], card: CardId) => cards.filter(c => c !== card);
/** Table points for one classic point, so estimates read in the table's own scale. */
const unit = (rules: RulesConfig) => scoringFactor(rules);
const roundPoints = (n: number) => Math.round(n);

const MELD_WORD: Record<MeldKind, string> = {
  run: 'run', double_run: 'double run', royal_marriage: 'royal marriage', marriage: 'marriage', dix: 'dix',
  pinochle: 'pinochle', double_pinochle: 'double pinochle', aces_around: 'aces around', kings_around: 'kings around',
  queens_around: 'queens around', jacks_around: 'jacks around', double_aces_around: 'double aces around',
  double_kings_around: 'double kings around', double_queens_around: 'double queens around', double_jacks_around: 'double jacks around',
};
/** "run in hearts", "marriage in spades", "pinochle". */
function meldName(kind: MeldKind, cards: CardId[]): string {
  return ['run', 'double_run', 'royal_marriage', 'marriage'].includes(kind) ? `${MELD_WORD[kind]} in ${SUIT_WORD[suitOf(cards[0])]}` : MELD_WORD[kind];
}

// ---------------------------------------------------------------------------------------------
// Estimates

/** Cards not in this hand. Before any play, that is every other card in the deck. */
function unseen(hand: CardId[]): CardId[] {
  const mine = new Set(hand);
  return suits.flatMap(s => [...ranks].flatMap(r => [0, 1].map(c => `${r}${s}${c}` as CardId))).filter(c => !mine.has(c));
}

/** Chance that a partner holding `size` of the `pool` unseen cards has at least one of `copies` cards. */
function chanceHolds(copies: number, pool: number, size: number): number {
  if (copies <= 0) return 0;
  let miss = 1;
  for (let i = 0; i < copies; i++) miss *= (pool - size - i) / (pool - i);
  return 1 - miss;
}

export interface NearMeld {
  /** the card face that would complete it, e.g. "JH" */
  needs: `${Rank}${Suit}`;
  /** meld points it would add, in table points */
  gain: number;
  /** chance the partner holds one, given only your own hand */
  chance: number;
}

/** Melds one card short: the faces that would add meld if a partner passed one over. */
export function nearMelds(hand: CardId[], trump: Suit, rules: RulesConfig): NearMeld[] {
  const base = meldTotal(hand, trump, rules);
  const pool = unseen(hand);
  const size = hand.length;
  const out: NearMeld[] = [];
  for (const s of suits) for (const r of ranks) {
    const copies = pool.filter(c => c[0] === r && c[1] === s);
    if (!copies.length) continue;
    const gain = meldTotal([...hand, copies[0]], trump, rules) - base;
    if (gain > 0) out.push({ needs: `${r as Rank}${s}`, gain, chance: chanceHolds(copies.length, pool.length, size) });
  }
  return out.sort((a, b) => b.gain * b.chance - a.gain * a.chance || a.needs.localeCompare(b.needs));
}

/** Expected trick points for your side, in table points. Mirrors the bots' trick term in ai/bid.ts. */
export function trickEstimate(view: PlayerView, trump: Suit, config: BotConfig = DEFAULT_SETTINGS.bots): number {
  const hand = view.hand;
  const factor = scoringFactor(view.rules);
  const length = hand.filter(c => suitOf(c) === trump).length;
  const aces = hand.filter(c => c[0] === 'A').length;
  const protectedTens = hand.filter(c => c[0] === 'T' && hand.some(a => a[0] === 'A' && a[1] === c[1])).length;
  const scale = (view.rules.counting === 'classic' ? 240 : 24 * view.rules.counterValue / factor) / 240;
  return factor * config.bidAggression * (scale * (35 + length * 12 + aces * 17 + protectedTens * 8)
    + hand.reduce((n, c) => n + points(c, view.rules) / factor, 0) * .15);
}

export interface BidEstimate {
  trump: Suit;
  meld: number;
  tricks: number;
  /** expected meld gained from the partner's pass */
  passing: number;
  /** what a partner usually adds in meld and tricks, given how they bid */
  partner: number;
  /** the highest bid this hand should make, a legal multiple of the bid step */
  ceiling: number;
  /** the most likely one-card completion, if any */
  near: NearMeld | null;
}

function partnerAllowance(view: PlayerView): number {
  const partnerBids = view.bids.filter(b => b.seat === partnerOf(view.seat));
  const classic = partnerBids.some(b => b.amount !== null) ? 60 : partnerBids.some(b => b.amount === null) ? 20 : 40;
  return classic * unit(view.rules);
}

function estimateFor(view: PlayerView, trump: Suit, config: BotConfig): Omit<BidEstimate, 'ceiling' | 'partner'> {
  const meld = meldTotal(view.hand, trump, view.rules);
  const near = view.rules.passCount > 0 ? nearMelds(view.hand, trump, view.rules)[0] ?? null : null;
  return { trump, meld, tricks: trickEstimate(view, trump, config), passing: near ? near.gain * near.chance : 0, near };
}

/**
 * How high to go: meld in your best trump, plus expected tricks, plus what the partner's pass and
 * the partner's own hand usually add, less a safety margin. All in the table's scale.
 */
export function bidEstimate(view: PlayerView, config: BotConfig = DEFAULT_SETTINGS.bots): BidEstimate {
  const options = suits.map(s => estimateFor(view, s, config));
  const best = options.reduce((a, b) => (b.meld + b.tricks + b.passing > a.meld + a.tricks + a.passing ? b : a));
  const partner = partnerAllowance(view);
  const value = best.meld + best.tricks + best.passing + partner - config.bidMargin * unit(view.rules);
  const ceiling = Math.floor(value / view.rules.bidStep + 1e-9) * view.rules.bidStep;
  return { ...best, partner, ceiling };
}

// ---------------------------------------------------------------------------------------------
// Bidding and trump

export function adviseBid(view: PlayerView, options: AdviceOptions = {}): Advice | null {
  const L = view.legal;
  if (view.phase !== 'bidding' || (!L.canBid && !L.canPassBid)) return null;
  const est = bidEstimate(view, options.config);
  const name = nameFor(view, options);
  const partner = name(partnerOf(view.seat));
  const meldCards = autoMeldSelection(view.hand, est.trump);
  const near = est.near && est.near.chance * est.near.gain >= unit(view.rules) * 10
    ? ` ${capital(partner)} may hold the ${cardLabel(`${est.near.needs}0` as CardId)}, worth ${est.near.gain} more.` : '';
  const partnerBid = view.bids.filter(b => b.seat === partnerOf(view.seat));
  const partnerWord = partnerBid.some(b => b.amount !== null) ? `${capital(partner)} bid, so count on about ${roundPoints(est.partner)} from that hand`
    : partnerBid.length ? `${capital(partner)} passed, so expect only about ${roundPoints(est.partner)} from that hand`
    : `${capital(partner)} usually adds about ${roundPoints(est.partner)}`;
  const worth = `Your meld in ${SUIT_WORD[est.trump]} is ${est.meld}, and your tricks should bring about ${roundPoints(est.tricks)}. ${partnerWord}.${near}`;
  if (!L.canBid) {
    // Passing is the only move. What it does depends on why: a shoot is on, or everyone else passed to the dealer.
    const shooter = view.bids.find(b => b.shoot);
    if (shooter) return { action: { type: 'pass_bid', seat: view.seat }, cards: [], headline: 'Pass',
      reason: `${capital(name(shooter.seat))} shot the moon, so the only call left is a pass.` };
    if (view.rules.dealerStuck) return { action: { type: 'pass_bid', seat: view.seat }, cards: meldCards, headline: `Take it at ${view.rules.minBid}`,
      reason: `Everyone else passed, so as dealer you must take the bid. ${worth}` };
    return { action: { type: 'pass_bid', seat: view.seat }, cards: [], headline: 'Pass',
      reason: 'Everyone else passed. Passing as dealer throws the hand in for a redeal.' };
  }
  const min = L.minBid!;
  if (min > est.ceiling) {
    return { action: { type: 'pass_bid', seat: view.seat }, cards: meldCards, headline: 'Pass',
      reason: `${worth} That makes ${est.ceiling} a safe limit, and the bid is already ${min}.` };
  }
  const headline = min === est.ceiling ? `Bid ${min}, then stop` : `Bid ${min}, up to ${est.ceiling}`;
  return { action: { type: 'bid', seat: view.seat, amount: min }, cards: meldCards, headline,
    reason: `${worth} ${min === est.ceiling ? 'This is your limit: pass if anyone goes higher.' : `Raise one step at a time up to ${est.ceiling}, then pass.`}` };
}

export function adviseTrump(view: PlayerView, options: AdviceOptions = {}): Advice | null {
  if (!view.legal.canDeclareTrump) return null;
  const config = options.config ?? DEFAULT_SETTINGS.bots;
  const ranked = suits.map(s => estimateFor(view, s, config)).sort((a, b) => (b.meld + b.tricks + b.passing) - (a.meld + a.tricks + a.passing));
  const [best, next] = ranked;
  const s = best.trump;
  const held = view.hand.filter(c => suitOf(c) === s);
  const tops = [...'ATKQJ'].filter(r => held.some(c => c[0] === r)).map(r => (r === 'T' ? '10' : r));
  const parts = [`You hold ${held.length} ${SUIT_WORD[s]}${tops.length ? `, with ${tops.join(' ')}` : ''}`];
  if (best.near?.needs[1] === s && best.near.gain >= 10 * unit(view.rules)) parts.push(`one ${cardLabel(`${best.near.needs}0` as CardId)} from ${best.near.needs[0] === '9' ? 'more meld' : 'a run'}`);
  const aces = view.hand.filter(c => c[0] === 'A').length;
  return {
    action: { type: 'declare_trump', seat: view.seat, suit: s },
    cards: held,
    headline: `Name ${SUIT_WORD[s]}`,
    reason: `${parts.join(', ')}. Meld in ${SUIT_WORD[s]} is ${best.meld}; ${SUIT_WORD[next.trump]} would give ${next.meld}. Length in trump${aces ? ` and your ${aces === 1 ? 'ace' : `${aces} aces`}` : ''} win${aces ? '' : 's'} tricks.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Passing

/** Value of one modern table point when weighing meld against trick-taking cards. */
const MELD_WEIGHT = 15;

function meldLoss(kept: CardId[], card: CardId, trump: Suit, rules: RulesConfig): number {
  return (meldTotal(kept, trump, rules) - meldTotal(without(kept, card), trump, rules)) / unit(rules) / 10;
}
/** Meld items that use this card, in the hand as it stands. */
function meldsUsing(hand: CardId[], card: CardId, trump: Suit, rules: RulesConfig) {
  return computeMeld(hand, trump, rules).items.filter(item => item.cards.includes(card));
}

/** Choose `n` cards greedily: each step takes the best card given the cards still held. */
function greedy(hand: CardId[], n: number, score: (card: CardId, kept: CardId[]) => number): CardId[] {
  let kept = [...hand];
  const chosen: CardId[] = [];
  for (let i = 0; i < n; i++) {
    const best = [...kept].sort((a, b) => score(b, kept) - score(a, kept) || a.localeCompare(b))[0];
    chosen.push(best);
    kept = without(kept, best);
  }
  return chosen;
}

/** Partner to bidder: trump and aces, plus cards that could finish the bidder's meld. Keep your own meld. */
function toBidder(view: PlayerView, trump: Suit, n: number) {
  const rules = view.rules;
  return greedy(view.hand, n, (card, kept) => {
    const [r, s] = [card[0], suitOf(card)];
    let v = strength(card);
    if (s === trump) v += 50 + strength(card) * 2 + ('KQ'.includes(r) ? 15 : 'ATJ'.includes(r) ? 10 : 0);
    else if (r === 'A') v += 40;
    if (card.startsWith('QS') || card.startsWith('JD')) v += 20;
    if (s !== trump && 'TK'.includes(r)) v += 5;
    return v - MELD_WEIGHT * meldLoss(kept, card, trump, rules);
  });
}

/**
 * Bidder back to partner: keep the meld and the trump. Side cards that are not meld go back; an ace
 * passed back still wins tricks for your side, and clearing a short suit lets you trump it.
 */
function toPartner(view: PlayerView, trump: Suit, n: number) {
  const rules = view.rules;
  const keep = (card: CardId, kept: CardId[]) => {
    const s = suitOf(card);
    let v = strength(card) + 2 * kept.filter(c => suitOf(c) === s).length;
    if (s === trump) v += 50 + strength(card);
    else if (card[0] === 'A') v += 20;
    // A second copy of a card you keep anyway is the cheaper one to let go.
    if (s !== trump && kept.some(c => c !== card && c.slice(0, 2) === card.slice(0, 2))) v -= 3;
    return v + MELD_WEIGHT * meldLoss(kept, card, trump, rules);
  };
  return greedy(view.hand, n, (card, kept) => -keep(card, kept));
}

export function advisePass(view: PlayerView, options: AdviceOptions = {}): Advice | null {
  const n = view.legal.mustPassCount;
  if (n === null || !view.trump || view.bidder === null) return null;
  const trump = view.trump;
  const name = nameFor(view, options);
  const rules = view.rules;
  const toBid = view.phase === 'passing_to_bidder';
  const cards = toBid ? toBidder(view, trump, n) : toPartner(view, trump, n);
  const kept = view.hand.filter(c => !cards.includes(c));
  const keptMeld = computeMeld(kept, trump, rules).items.filter(item => item.kind !== 'dix');
  const keptNames = [...new Set(keptMeld.map(item => meldName(item.kind, item.cards)))];
  const sentences: string[] = [];
  const other = name(toBid ? view.bidder : partnerOf(view.seat));

  if (toBid) {
    const trumps = cards.filter(c => suitOf(c) === trump);
    const aces = cards.filter(c => suitOf(c) !== trump && c[0] === 'A');
    const pin = cards.filter(c => suitOf(c) !== trump && (c.startsWith('QS') || c.startsWith('JD')));
    const royal = trumps.filter(c => 'KQ'.includes(c[0]));
    if (trumps.length) sentences.push(`${listCards(trumps)} ${trumps.length === 1 ? 'is' : 'are'} trump: more length for ${other} to win tricks with${royal.length ? `, and ${listCards(royal)} could finish a royal marriage or a run` : ''}.`);
    if (aces.length) sentences.push(`${listCards(aces)} ${aces.length === 1 ? 'is a sure winner' : 'are sure winners'} in ${other}'s hand.`);
    if (pin.length) sentences.push(`${listCards(pin)} could finish a pinochle (Q♠ with J♦) for ${other}.`);
    const rest = cards.filter(c => !trumps.includes(c) && !aces.includes(c) && !pin.includes(c));
    if (rest.length) sentences.push(`${listCards(rest)} ${rest.length === 1 ? 'is' : 'are'} your next most useful ${rest.length === 1 ? 'card' : 'cards'} for ${other}.`);
    if (keptNames.length) sentences.push(`Keep your ${listWords(keptNames)}: meld only scores in the hand that holds it.`);
    const broken = cards.filter(c => meldsUsing(view.hand, c, trump, rules).some(item => item.kind !== 'dix'));
    if (broken.length) sentences.push(`Sending ${listCards(broken)} breaks some of your meld, but in ${other}'s hand ${broken.length === 1 ? 'it is' : 'they are'} worth more.`);
  } else {
    if (keptNames.length) sentences.push(`Keep everything in your meld: ${listWords(keptNames)}.`);
    const trumpKept = kept.filter(c => suitOf(c) === trump).length;
    if (trumpKept) sentences.push(`Hold on to all ${trumpKept} trump.`);
    const voided = [...new Set(cards.map(suitOf))].filter(s => s !== trump && !kept.some(c => suitOf(c) === s));
    if (voided.length) sentences.push(`Passing every ${listWords(voided.map(s => SINGULAR[s]))} leaves you void, so you can trump ${listWords(voided.map(s => SUIT_WORD[s]))}.`);
    const aces = cards.filter(c => c[0] === 'A');
    if (aces.length) sentences.push(`${capital(other)} can still win with ${listCards(aces)}.`);
    const halves = cards.filter(c => suitOf(c) !== trump && nearMelds([...kept, c], trump, rules)
      .some(near => !nearMelds(kept, trump, rules).some(k => k.needs === near.needs && k.gain >= near.gain)));
    if (halves.length && !voided.length) sentences.push(`${listCards(halves)} would only score with a partner card, and no more cards come to you after this pass.`);
    const broken = cards.filter(c => meldsUsing(view.hand, c, trump, rules).some(item => item.kind !== 'dix'));
    if (broken.length) sentences.push(`${listCards(broken)} costs some meld, but the trump and aces you keep should win more.`);
  }
  return {
    action: { type: 'pass_cards', seat: view.seat, cards },
    cards,
    headline: `Pass ${listCards(cards)}`,
    reason: sentences.join(' '),
  };
}

// ---------------------------------------------------------------------------------------------
// Meld and play

export function adviseMeld(view: PlayerView): Advice | null {
  if (view.phase !== 'melding' || !view.trump || view.meldConfirmed[view.seat]) return null;
  const { items, total } = computeMeld(view.hand, view.trump, view.rules);
  const declared = view.melds[view.seat].reduce((n, item) => n + item.points, 0);
  const cards = autoMeldSelection(view.hand, view.trump);
  const list = listWords(items.map(item => `${meldName(item.kind, item.cards)} ${item.points}`));
  if (view.legal.canDeclareMeld && total > declared && cards.length) {
    return { action: { type: 'declare_meld', seat: view.seat, cards }, cards, headline: `Lay down all ${total}`,
      reason: `Your meld is ${list}. Laying down everything never costs you anything.` };
  }
  if (!view.legal.canConfirmMeld) return null;
  return { action: { type: 'confirm_meld', seat: view.seat }, cards: [], headline: total ? `Confirm your ${total}` : 'Confirm no meld',
    reason: total ? `Your meld is ${list}.` : `This hand has no meld in ${SUIT_WORD[view.trump]}. Your cards still count in tricks.` };
}

export function advisePlay(view: PlayerView, options: AdviceOptions = {}): Advice | null {
  const legal = view.legal.playableCards;
  if (view.phase !== 'playing' || !legal.length || !view.trump || !view.currentTrick) return null;
  const trump = view.trump;
  const config = options.config ?? DEFAULT_SETTINGS.bots;
  const name = nameFor(view, options);
  const gone = new Set(view.playedCards.map(p => p.card));
  const remaining = suits.flatMap(s => [...ranks].flatMap(r => [0, 1].map(c => `${r}${s}${c}` as CardId))).filter(c => !gone.has(c));
  const trick = view.currentTrick;
  const card = legal.length === 1 ? legal[0]
    : heuristic(view.hand, legal, trick, trump, view.seat, view.bidder, remaining, view, config);
  const label = cardLabel(card);
  const outside = remaining.filter(c => !view.hand.includes(c));
  const boss = !outside.some(c => suitOf(c) === suitOf(card) && strength(c) > strength(card));
  const ourBid = view.bidder !== null && team(view.bidder) === team(view.seat);
  const counters = points(card, view.rules) > 0;
  let reason: string;
  if (legal.length === 1) reason = `It is your only legal card.`;
  else if (!trick.plays.length) {
    const theirTrump = outside.some(c => suitOf(c) === trump);
    if (suitOf(card) === trump && ourBid && theirTrump) reason = `Leading trump pulls the other side's trump, so your aces and side winners are safe later.`;
    else if (boss) reason = `${label} is the highest ${SINGULAR[suitOf(card)]} still out, so it should take the trick.`;
    else reason = `None of your cards is sure to win yet; ${label} is your strongest lead.`;
  } else {
    const winner = trickWinner(trick, trump);
    const wins = trickWinner({ ...trick, plays: [...trick.plays, { seat: view.seat, card }] }, trump) === view.seat;
    const partnerWinning = winner === partnerOf(view.seat);
    const last = trick.plays.length === 3;
    if (partnerWinning && !wins) reason = counters ? `${capital(name(winner))} is winning${last ? '' : ' and should hold it'}, so give a counter.` : `${capital(name(winner))} is winning, so keep your better cards and play low.`;
    else if (wins) reason = suitOf(card) === trump && suitOf(trick.plays[0].card) !== trump
      ? `You are out of ${SUIT_WORD[suitOf(trick.plays[0].card)]}, so trump to take the trick.`
      : `${label} is the cheapest card that ${last ? 'takes' : 'is winning'} the trick.`;
    else reason = `You cannot take this trick, so play your lowest card and save your counters and aces.`;
  }
  return { action: { type: 'play_card', seat: view.seat, card }, cards: [card], headline: `Play ${label}`, reason };
}

/** The suggestion for whatever this seat has to do now, or null when it has nothing to decide. */
export function advise(view: PlayerView, options: AdviceOptions = {}): Advice | null {
  switch (view.phase) {
    case 'bidding': return adviseBid(view, options);
    case 'declaring_trump': return adviseTrump(view, options);
    case 'passing_to_bidder': case 'passing_back': return advisePass(view, options);
    case 'melding': return adviseMeld(view);
    case 'playing': return advisePlay(view, options);
    default: return null;
  }
}
