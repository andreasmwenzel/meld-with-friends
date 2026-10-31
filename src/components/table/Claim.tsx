import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseCard, RANK_ORDER } from "@/engine/deck";
import type { CardId, PlayerView, Suit } from "@/engine/types";
import type { MotionPref } from "@/lib/cardPrefs";
import { CLAIM_STEP_PX, claimSweep, claimTimings } from "./motion";

export function ClaimButton({ busy, onClaim }: { busy: boolean; onClaim: () => void }) {
  return <button type="button" disabled={busy} className="tap-link ml-3 text-sm font-semibold text-brass underline underline-offset-4"
    onClick={() => onClaim()}>
    Claim all
  </button>;
}

/**
 * Only a live transition animates. Reloads show the saved reveal without making the reader wait. While it is true the
 * table shows the hands as they stood at the claim; afterwards, the hands as played (Game.tsx).
 */
export function useClaimReveal(view: PlayerView | null, motion: MotionPref, root: React.RefObject<HTMLElement | null>) {
  const previous = useRef<PlayerView | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const key = view?.claim ? `${view.handNumber}:${view.claim.fromTrick}:${view.rev}` : null;
  const revealing = active !== null && active === key;
  /** When the claim landed: a fresh copy of the same view mid-reveal picks the cards up where they were, not from the top. */
  const startedAt = useRef(0);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (view?.claim && before?.phase === "playing" && before.handNumber === view.handNumber) {
      startedAt.current = performance.now();
      setActive(key);
    }
  }, [view, key]);
  const claimedCount = view?.claim ? view.claim.hands[view.claim.seat].length : 0;
  useLayoutEffect(() => {
    if (!revealing || !view?.claim || !root.current) return;
    const claim = view.claim;
    const target = root.current.querySelector<HTMLElement>(`[data-claim-seat="${claim.seat}"]`);
    if (!target) return;
    const to = target.getBoundingClientRect();
    const box = root.current.getBoundingClientRect();
    const still = motion === "off";
    const { revealMs, stepMs, sweepAt, outMs } = claimTimings(motion, claim.hands[claim.seat].length);
    const animations: Animation[] = [];
    const cards = [...root.current.querySelectorAll<HTMLElement>("[data-claim-card]")];
    // Your own cards sit in your hand, outside your seat's plate.
    const ownerOf = (card: HTMLElement) => Number(card.closest("[data-claim-seat]")?.getAttribute("data-claim-seat") ?? view.seat);
    const turn = revealOrder(cards.filter(card => ownerOf(card) === claim.seat), view.trump);
    cards.forEach(card => {
      if (!card.animate) return;
      const from = card.getBoundingClientRect();
      const scale = from.width / card.offsetWidth || 1;
      const owner = ownerOf(card);
      const claimed = owner === claim.seat;
      // The claimer's cards step toward the cloth along the seat's own axis, as a card lifted to be played does.
      const fan = (card.closest("[data-hand]") ?? card).getBoundingClientRect();
      const dx = box.left + box.width / 2 - fan.left - fan.width / 2, dy = box.top + box.height / 2 - fan.top - fan.height / 2;
      const [px, py] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy) || -1];
      const lx = claimed && !still ? (px * CLAIM_STEP_PX) / scale : 0, ly = claimed && !still ? (py * CLAIM_STEP_PX) / scale : 0;
      const pose = (out: number, turn: number) => `translate(${lx * out}px, ${ly * out}px) rotateY(${turn}deg)`;
      const mine = owner === view.seat;
      const at = claimed ? (turn.get(card) ?? 0) * stepMs : 0;
      // Someone else's claim lies face down (Game.tsx lays a back over each card), and each card turns over halfway
      // through its step out. Your own cards are already face up, so as the claimer you see them only step out. They stay
      // out until the sweep. The other hands turn up together at the start; yours, already face up, stays as it is.
      const back = claimed ? card.querySelector<HTMLElement>("[data-claim-back]") : null;
      // The back goes the moment the card stands edge-on, halfway; without motion it fades instead.
      if (back) animations.push(back.animate(still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
        { delay: at, duration: revealMs, fill: "both" }));
      const hidden = !mine && !back;
      if (!still && (claimed || !mine)) {
        // Linear overall, eased per half, so the card is edge-on exactly halfway, when its back goes.
        animations.push(card.animate(mine ? [{ transform: pose(0, 0), easing: "ease-out" }, { transform: pose(1, 0) }]
          : [{ transform: pose(0, 0), opacity: hidden ? 0 : 1, easing: "ease-in" }, { transform: pose(0.5, 90), offset: 0.5, easing: "ease-out" }, { transform: pose(1, 0), opacity: 1 }],
        { delay: at, duration: revealMs, easing: "linear", fill: claimed ? "both" : "backwards" }));
      } else if (still && hidden) {
        animations.push(card.animate([{ opacity: 0 }, { opacity: 1 }], { delay: at, duration: revealMs, fill: "backwards" }));
      }
      animations.push(card.animate([still ? { opacity: 1 } : { transform: pose(1, 0), opacity: 1 }, still ? { opacity: 0 } : claimSweep(from, to, scale)],
        { delay: sweepAt, duration: outMs, easing: "ease-in-out", fill: "forwards" }));
    });
    const elapsed = performance.now() - startedAt.current;
    animations.forEach(animation => { animation.currentTime = elapsed; });
    return () => animations.forEach(animation => animation.cancel());
  }, [revealing, view, motion, root]);
  useEffect(() => {
    if (!revealing) return;
    const left = claimTimings(motion, claimedCount).totalMs - (performance.now() - startedAt.current);
    const timer = setTimeout(() => setActive(null), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [revealing, claimedCount, motion]);
  return revealing;
}

/**
 * The order a claim's cards turn up: from the high end, whichever way the hand is sorted. Trumps first, highest down,
 * then each other suit, ace down, taking the suits in the order the fan shows them.
 */
function revealOrder(cards: HTMLElement[], trump: Suit | null): Map<HTMLElement, number> {
  const card = (el: HTMLElement) => parseCard(el.dataset.claimCard as CardId);
  const suitAt = new Map<Suit, number>();
  cards.forEach((el, i) => { if (!suitAt.has(card(el).suit)) suitAt.set(card(el).suit, i); });
  const ordered = cards.map((el, i) => ({ el, i, ...card(el) })).sort((a, b) =>
    Number(b.suit === trump) - Number(a.suit === trump) || suitAt.get(a.suit)! - suitAt.get(b.suit)!
    || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) || a.i - b.i);
  return new Map(ordered.map(({ el }, n) => [el, n]));
}
