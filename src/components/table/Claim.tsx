import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlayerView } from "@/engine/types";
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
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (view?.claim && before?.phase === "playing" && before.handNumber === view.handNumber) setActive(key);
  }, [view, key]);
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
    let step = 0;
    root.current.querySelectorAll<HTMLElement>("[data-claim-card]").forEach(card => {
      if (!card.animate) return;
      const from = card.getBoundingClientRect();
      const scale = from.width / card.offsetWidth || 1;
      // Your own cards sit in your hand, outside your seat's plate.
      const owner = Number(card.closest("[data-claim-seat]")?.getAttribute("data-claim-seat") ?? view.seat);
      const claimed = owner === claim.seat;
      // The claimer's cards step toward the cloth along the seat's own axis, as a card lifted to be played does.
      const fan = (card.closest("[data-hand]") ?? card).getBoundingClientRect();
      const dx = box.left + box.width / 2 - fan.left - fan.width / 2, dy = box.top + box.height / 2 - fan.top - fan.height / 2;
      const [px, py] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy) || -1];
      const lift = claimed && !still ? `translate(${(px * CLAIM_STEP_PX) / scale}px, ${(py * CLAIM_STEP_PX) / scale}px)` : "none";
      // The claimer already sees its own cards, so they only step out; everyone else sees each one turn up. Each stands
      // out while the next turns up, then settles back into the fan.
      const mine = claimed && owner === view.seat;
      const first = still ? { opacity: mine ? 1 : 0 } : mine ? { transform: "none", opacity: 1 } : { transform: "rotateY(90deg)", opacity: 0 };
      const out = still ? { opacity: 1 } : { transform: lift, opacity: 1 };
      const settled = still ? { opacity: 1 } : { transform: "none", opacity: 1 };
      const span = revealMs * 2 + stepMs;
      animations.push(claimed
        ? card.animate([{ ...first, offset: 0 }, { ...out, offset: revealMs / span }, { ...out, offset: (revealMs + stepMs) / span }, { ...settled, offset: 1 }],
          { delay: step++ * stepMs, duration: span, easing: "ease-out", fill: "both" })
        : card.animate([first, settled], { duration: revealMs, easing: "ease-out", fill: "backwards" }));
      animations.push(card.animate([settled, still ? { opacity: 0 } : claimSweep(from, to, scale)],
        { delay: sweepAt, duration: outMs, easing: "ease-in-out", fill: "forwards" }));
    });
    return () => animations.forEach(animation => animation.cancel());
  }, [revealing, view, motion, root]);
  useEffect(() => {
    if (!revealing || !view?.claim) return;
    const timer = setTimeout(() => setActive(null), claimTimings(motion, view.claim.hands[view.claim.seat].length).totalMs);
    return () => clearTimeout(timer);
  }, [revealing, view, motion]);
  return revealing;
}
