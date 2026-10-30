"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Suit, Team } from "@/engine/types";
import { BACKS, CLOTHS, useCardPrefs } from "@/lib/cardPrefs";
import { CardBack } from "@/components/cards/CardBack";
import { CardOptionsPanel } from "@/components/cards/CardOptions";

/** A cog, drawn to sit with the talk button's line work. */
function CogIcon() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.4a1.75 1.75 0 0 1 3.4 0l.2.9a1.75 1.75 0 0 0 2.5 1.1l.8-.5a1.75 1.75 0 0 1 2.4 2.4l-.5.8a1.75 1.75 0 0 0 1.1 2.5l.9.2a1.75 1.75 0 0 1 0 3.4l-.9.2a1.75 1.75 0 0 0-1.1 2.5l.5.8a1.75 1.75 0 0 1-2.4 2.4l-.8-.5a1.75 1.75 0 0 0-2.5 1.1l-.2.9a1.75 1.75 0 0 1-3.4 0l-.2-.9a1.75 1.75 0 0 0-2.5-1.1l-.8.5a1.75 1.75 0 0 1-2.4-2.4l.5-.8a1.75 1.75 0 0 0-1.1-2.5l-.9-.2a1.75 1.75 0 0 1 0-3.4l.9-.2a1.75 1.75 0 0 0 1.1-2.5l-.5-.8a1.75 1.75 0 0 1 2.4-2.4l.8.5a1.75 1.75 0 0 0 2.5-1.1Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * The table's look and every card option: the cloth, the pattern on the backs, then the deck, size and hand order.
 * Each choice applies at once, so the popover can show the table changing behind it.
 */
export function LookOptions({ team, trump = null }: { team: Team; trump?: Suit | null }) {
  const { look, update } = useCardPrefs();
  const clothName = CLOTHS.find(([c]) => c === look.cloth)?.[1];
  const backName = BACKS.find(([b]) => b === look.back)?.[1];
  const ring = "ring-2 ring-brass ring-offset-2 ring-offset-chalk";
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Cloth" className="flex flex-col gap-2">
        <p className="flex justify-between text-sm text-ink-soft"><span>Cloth</span><span aria-hidden>{clothName}</span></p>
        <div className="flex justify-between">
          {CLOTHS.map(([cloth, name]) => (
            <button key={cloth} type="button" data-cloth-swatch={cloth} aria-pressed={look.cloth === cloth} aria-label={name} title={name}
              onClick={() => update({ cloth })}
              className={`hit grid size-10 shrink-0 place-items-center rounded-full transition-shadow ${look.cloth === cloth ? "ring-2 ring-brass" : "hover:ring-1 hover:ring-ink/30"}`}>
              {/* The cloth's own gradient, read off the same variables the table uses. */}
              <span aria-hidden data-cloth={cloth} className="size-[34px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.25)]"
                style={{ background: "radial-gradient(120% 120% at 30% 20%, var(--cloth-edge), var(--cloth) 50%, var(--cloth-deep))" }} />
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Card backs" className="flex flex-col gap-2">
        <p className="flex justify-between text-sm text-ink-soft"><span>Card backs</span><span aria-hidden>{backName}</span></p>
        <div className="flex justify-between pr-6">
          {BACKS.map(([back, name]) => (
            <button key={back} type="button" aria-pressed={look.back === back} aria-label={name} title={name} onClick={() => update({ back })}
              className={`rounded-[5px] transition-shadow ${look.back === back ? ring : "hover:ring-1 hover:ring-ink/30"}`}>
              <CardBack width={40} team={team} design={back} />
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-soft">Backs keep each team&apos;s colour.</p>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-chalk-dim pt-3">
        <p className="text-sm font-semibold text-ink">Cards</p>
        <CardOptionsPanel trump={trump} />
      </div>
    </div>
  );
}

const MAX_W = 320;
const MIN_W = 248;
const MAX_H = 600;
const MIN_H = 200;
const GAP = 10;
const EDGE = 8;
const POP_SHADOW = "0 0 0 1px rgba(36,29,29,.14), 0 14px 40px rgba(0,0,0,.45)";

interface Place { top: number; left: number; width: number; height: number; tail: number | null; above: boolean }

/**
 * The box round what is drawn of your own hand's cards, or of the right-hand seat (its chip, and its cards or the count
 * a sideways phone shows instead); null when there is none.
 */
function drawnBox(side: "mine" | "east"): DOMRect | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const el of document.querySelectorAll(side === "mine" ? '[data-hand="mine"] svg' : ".board-east *")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0) continue;
    l = Math.min(l, box.left); t = Math.min(t, box.top); r = Math.max(r, box.right); b = Math.max(b, box.bottom);
  }
  return l === Infinity ? null : new DOMRect(l, t, r - l, b - t);
}

/**
 * Where the popover goes: from the button's corner, opening down from a button near the top (the cloth's corner on
 * an upright phone) and up from one near the bottom (a sideways phone's action column, a wide screen's corner).
 * It keeps clear of your own hand and the right-hand seat, so the cards you are restyling stay in view, while
 * that leaves it a usable size; otherwise it takes what the screen gives.
 */
function placeNear(button: HTMLElement): Place {
  const r = button.getBoundingClientRect();
  const vv = window.visualViewport;
  const vTop = vv?.offsetTop ?? 0;
  const vBottom = vTop + (vv?.height ?? window.innerHeight);
  const pageW = document.documentElement.clientWidth;
  const fromLeft = r.left + r.width / 2 < pageW / 2;
  const above = r.top + r.height / 2 > (vTop + vBottom) / 2;

  let width = Math.min(MAX_W, pageW - 24);
  let left = Math.min(Math.max(12, fromLeft ? r.left : r.right - width), pageW - 12 - width);
  const east = drawnBox("east");
  if (east && fromLeft && east.left - GAP - left >= MIN_W) width = Math.min(width, east.left - GAP - left);
  // Opening from the right (a sideways phone's action column), it may slide out to the screen's edge to clear the seat.
  if (east && !fromLeft && left < east.right + GAP) {
    const clearLeft = east.right + GAP;
    const clearWidth = Math.min(width, pageW - 12 - clearLeft);
    if (clearWidth >= MIN_W) { left = clearLeft; width = clearWidth; }
  }

  const mine = drawnBox("mine");
  const mineTop = mine && mine.right > left && mine.left < left + width ? mine.top - GAP : Infinity;
  let top: number, height: number;
  if (above) {
    let bottom = Math.min(r.top - GAP, vBottom - EDGE);
    if (bottom > mineTop && mineTop - (vTop + EDGE) >= MIN_H) bottom = mineTop;
    height = Math.min(MAX_H, bottom - (vTop + EDGE));
    top = bottom - height;
  } else {
    top = r.bottom + GAP;
    const room = vBottom - EDGE - top;
    const clear = mineTop - top;
    height = Math.min(MAX_H, room, clear >= MIN_H ? clear : Infinity);
  }
  const tail = r.left + r.width / 2 - left;
  return { top, left, width, height, tail: tail > 14 && tail < width - 14 ? tail : null, above };
}

/**
 * The table's look at the board: a round cog, opposite table talk, that opens every card and table option in a
 * popover. The board owns `open`, so the table menu can open it too.
 */
export function LookDock({ team, trump, open, setOpen }: { team: Team; trump: Suit | null; open: boolean; setOpen: (open: boolean) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const popId = useId();
  const titleId = useId();
  const [place, setPlace] = useState<Place | null>(null);

  const measure = useCallback(() => {
    if (!button.current) return;
    const next = placeNear(button.current);
    setPlace((p) => (p && p.top === next.top && p.left === next.left && p.width === next.width && p.height === next.height && p.tail === next.tail && p.above === next.above ? p : next));
  }, []);
  // The board moves under it (the action bar grows, a card size changes the hand): follow it on every render while open.
  useLayoutEffect(() => { if (open) measure(); });
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    // A new card size or deck re-lays the hands after this render; measure again once they have.
    window.addEventListener("meld:cards", measure);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      window.removeEventListener("meld:cards", measure);
    };
  }, [open, measure]);

  // Focus moves to the chosen cloth on opening, and back to the cog when closed with Escape or Close.
  const refocus = useRef(false);
  const shown = open && place !== null;
  useEffect(() => {
    if (shown) body.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
    else if (!open && refocus.current) button.current?.focus();
    refocus.current = false;
  }, [shown, open]);
  const close = useCallback((restore: boolean) => { refocus.current = restore; setOpen(false); }, [setOpen]);

  // A tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || button.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open, close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button ref={button} type="button" data-overlay="look" onClick={() => (open ? close(true) : setOpen(true))}
        aria-label="Table and cards" aria-expanded={open} aria-controls={popId} aria-haspopup="dialog"
        className={`relative grid size-11 place-items-center rounded-full shadow-[0_2px_10px_rgba(0,0,0,.28)] transition-colors ${open
          ? "bg-chalk text-ink"
          : "bg-cloth-deep/85 text-chalk ring-1 ring-chalk-ghost hover:bg-cloth-deep hover:ring-chalk-faint"}`}>
        <CogIcon />
      </button>
      <div ref={pop} id={popId} role="dialog" data-overlay="look-popover" aria-labelledby={titleId} hidden={!open || !place}
        className={`look-pop panel fixed z-40 flex flex-col overflow-visible ${place?.above ? "look-pop-above" : ""}`}
        style={place ? { top: place.top, left: place.left, width: place.width, height: place.height, boxShadow: POP_SHADOW } : undefined}>
        <div className="flex shrink-0 items-center justify-between border-b border-chalk-dim py-1 pl-4 pr-2">
          <h2 id={titleId} className="display" style={{ fontSize: 21 }}>Table and cards</h2>
          <button type="button" onClick={() => close(true)} className="tap-link text-sm text-ink-soft underline underline-offset-4 hover:text-ink">Close</button>
        </div>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-[inherit] px-4 pb-4 pt-3">
          {open && <LookOptions team={team} trump={trump} />}
        </div>
        {place?.tail != null && (
          <span aria-hidden className={`absolute size-3 rotate-45 bg-chalk ${place.above ? "-bottom-[6px]" : "-top-[6px]"}`} style={{ left: place.tail - 6 }} />
        )}
      </div>
    </div>
  );
}
