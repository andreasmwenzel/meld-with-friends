"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** The box a popover can show in: the screen, cut down by the nearest ancestor that clips its overflow. */
function visibleBox(el: HTMLElement) {
  let top = 0, bottom = window.innerHeight, left = 0, right = window.innerWidth;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    // A `display: contents` wrapper has no box of its own and clips nothing.
    if (s.display === "contents" || r.width === 0 || r.height === 0) continue;
    top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); left = Math.max(left, r.left); right = Math.min(right, r.right);
    break;
  }
  return { top, bottom, left, right };
}

/**
 * A small panel that opens from a chip round the table. Escape, a tap elsewhere, or a resize closes it; Escape hands
 * focus back to `trigger`. The panel opens on the `prefer` side unless the other has more room, stays 8px inside
 * whatever clips it, and scrolls when even the roomier side is too short. Put `root` on the element holding both.
 * `content` is any string that changes with what the panel shows, so a row arriving while it is open (friend status,
 * an error) measures it again.
 */
export function usePopover<R extends HTMLElement = HTMLDivElement>(prefer: "above" | "below" = "below", content = "") {
  const [open, setOpen] = useState(false);
  const root = useRef<R>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const [fit, setFit] = useState<{ nudge: number; above: boolean; maxHeight?: number }>({ nudge: 0, above: prefer === "above" });
  useLayoutEffect(() => {
    if (!open || !pop.current || !root.current) return;
    const box = visibleBox(root.current);
    const t = (trigger.current ?? root.current).getBoundingClientRect();
    const r = pop.current.getBoundingClientRect();
    // Horizontal: measured with the last nudge applied, so take it off first.
    const left = r.left - fit.nudge, right = r.right - fit.nudge;
    const nudge = right > box.right - 8 ? box.right - 8 - right : left < box.left + 8 ? box.left + 8 - left : 0;
    // Vertical: the panel's full height, whatever height it was last capped to.
    const h = pop.current.scrollHeight;
    const below = box.bottom - t.bottom - 12, above = t.top - box.top - 12;
    const up = prefer === "above" ? !(h > above && below > above) : h > below && above > below;
    const room = Math.max(80, Math.floor(up ? above : below));
    const next = { nudge, above: up, maxHeight: h > room ? room : undefined };
    if (next.nudge !== fit.nudge || next.above !== fit.above || next.maxHeight !== fit.maxHeight) setFit(next);
  }, [open, fit, prefer, content]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Focus inside the panel would be lost when it unmounts: hand it back to the chip.
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
      setOpen(false);
    };
    // Its placement was measured for this screen; a resize or rotation closes it rather than leave it adrift.
    const drift = () => setOpen(false);
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key); window.addEventListener("resize", drift);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); window.removeEventListener("resize", drift); };
  }, [open]);
  const style: CSSProperties = {
    ...(fit.nudge ? { transform: `translateX(${fit.nudge}px)` } : {}),
    ...(fit.maxHeight ? { maxHeight: fit.maxHeight, overflowY: "auto" } : {}),
  };
  /** Close from an action inside the panel, putting focus back on the chip. */
  const close = () => { trigger.current?.focus(); setOpen(false); };
  return { open, setOpen, close, root, trigger, pop, id, above: fit.above, style };
}
