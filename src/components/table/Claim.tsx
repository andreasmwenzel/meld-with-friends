import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlayerView } from "@/engine/types";
import type { MotionPref } from "@/lib/cardPrefs";
import { claimSweep, motionTimings } from "./motion";

export function ClaimButton({ busy, onClaim }: { busy: boolean; onClaim: () => void }) {
  return <button type="button" disabled={busy} className="tap-link ml-3 text-sm font-semibold text-brass underline underline-offset-4"
    onClick={() => onClaim()}>
    Claim all
  </button>;
}

/** Only a live transition animates. Reloads show the saved reveal without making the reader wait. */
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
    const target = root.current.querySelector<HTMLElement>(`[data-claim-seat="${view.claim.seat}"]`);
    if (!target) return;
    const to = target.getBoundingClientRect();
    const { slideMs, holdMs, sweepMs } = motionTimings(motion);
    const animations: Animation[] = [];
    root.current.querySelectorAll<HTMLElement>("[data-claim-card]").forEach(card => {
      if (!card.animate) return;
      const from = card.getBoundingClientRect();
      animations.push(card.animate(motion === "off" ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ transform: "rotateY(90deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: slideMs, easing: "ease-out", fill: "backwards" }));
      animations.push(card.animate([motion === "off" ? { opacity: 1 } : { transform: "none", opacity: 1 }, motion === "off" ? { opacity: 0 } : claimSweep(from, to, from.width / card.offsetWidth || 1)],
        { delay: motion === "off" ? slideMs : holdMs, duration: motion === "off" ? slideMs : sweepMs, easing: "ease-in-out", fill: "forwards" }));
    });
    return () => animations.forEach(animation => animation.cancel());
  }, [revealing, view, motion, root]);
  useEffect(() => {
    if (!revealing) return;
    const { holdMs, sweepMs } = motionTimings(motion);
    const timer = setTimeout(() => setActive(null), holdMs + sweepMs);
    return () => clearTimeout(timer);
  }, [revealing, motion]);
  return revealing;
}
