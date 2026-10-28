"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * A small panel that opens from a chip round the table. Escape, a tap elsewhere, or a resize closes it, and
 * `nudge` keeps it 8px inside the screen. Put `root` on the element holding both the trigger and the panel.
 */
export function usePopover<R extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<R>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const [nudge, setNudge] = useState(0);
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    const r = pop.current.getBoundingClientRect();
    const left = r.left - nudge, right = r.right - nudge;
    const shift = right > window.innerWidth - 8 ? window.innerWidth - 8 - right : left < 8 ? 8 - left : 0;
    if (shift !== nudge) setNudge(shift);
  }, [open, nudge]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Its placement was measured for this screen; a resize or rotation closes it rather than leave it adrift.
    const drift = () => setOpen(false);
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key); window.addEventListener("resize", drift);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); window.removeEventListener("resize", drift); };
  }, [open]);
  return { open, setOpen, root, pop, id, style: nudge ? { transform: `translateX(${nudge}px)` } : undefined };
}
