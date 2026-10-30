"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BATCH_SIZE = 32;

export type GridFit = { cols: number; rows: number; beside: boolean; cellW: number; cellH: number };
/**
 * How the amounts lie on a cloth `w` by `h` (the table's own px, before it is scaled by `scale`). Each cell wants a
 * full 44px tap on screen, so `44 / scale` in the table's px. Four across where they fit, else three (a 360px phone);
 * three rows between an up and a down chevron, so the amounts sit in the middle of the cloth, then two rows, then two
 * rows with both chevrons stacked beside them. On a cloth too small for any of them at full size, whichever layout
 * gives the biggest cells.
 */
export function fitGrid(w: number, h: number, scale: number, base: number): GridFit {
  const want = Math.ceil(44 / Math.min(1, scale)) + 1;
  const layouts = [4, 3].flatMap((cols) => [{ cols, rows: 3, beside: false }, { cols, rows: 2, beside: false }, { cols, rows: 2, beside: true }]);
  const sized = layouts.map((l) => {
    const roomW = (w * 0.96) / (l.cols + (l.beside ? 1 : 0));
    // The chevrons may lie on the oval's rim; the amounts stay inside it.
    const roomH = (h * 0.92) / (l.rows + (l.beside ? 0 : 2));
    const tall = Math.floor(Math.min(want, roomH));
    const cellW = Math.floor(Math.min(roomW, Math.max(base, tall)));
    // A cell too narrow for a full tap is no use taller than it is wide.
    return { ...l, cellW, cellH: cellW < want ? Math.min(tall, cellW) : tall };
  });
  const tap = (l: typeof sized[number]) => Math.min(l.cellW, l.cellH);
  return sized.find((l) => tap(l) >= want) ?? sized.reduce((a, b) => (tap(b) > tap(a) ? b : a));
}

/**
 * The bid amounts lie open on the cloth (portalled into `slot` when the table gives one), so bidding covers
 * nothing but the table. Tap an amount to pick it, then tap it again or the Bid button to bid.
 * Scrolling appends legal increments, so it never discards earlier bids or the selection.
 */
export function BidPicker({ min, step, busy, onBid, pass, misdeal = null, slot = null, compact = false, scale = 1 }: {
  min: number; step: number; busy: boolean; onBid: (amount: number) => void;
  pass: { label: string; run: () => void } | null;
  /** throw the hand in for nines */
  misdeal?: (() => void) | null;
  /** where on the table the grid goes; without one it sits above the buttons */
  slot?: HTMLElement | null;
  /** sideways on a phone: smaller pills */
  compact?: boolean;
  /** how far the table is scaled down to fit the screen; the grid sits inside it, so its taps grow to make up */
  scale?: number;
}) {
  const [count, setCount] = useState(BATCH_SIZE);
  const [picked, setPicked] = useState<number | null>(null);
  // One tab stop for the whole grid (arrow keys move inside it), so Tab reaches Pass and Bid however many amounts have loaded.
  const [cursor, setCursor] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The engine accepts safe integers and has no game-rule maximum bid.
  const legalCount = Math.floor((Number.MAX_SAFE_INTEGER - min) / step) + 1;
  const amounts = Array.from({ length: Math.min(count, legalCount) }, (_, i) => min + i * step);
  // The cloth's size before the table is scaled, to see how many amounts it holds.
  const [cloth, setCloth] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!slot || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setCloth({ w: slot.offsetWidth, h: slot.offsetHeight }));
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);
  // Each amount takes a full 44px tap on screen where the cloth has room (fitGrid), with a smaller pill drawn inside so
  // the rows still read as a grid.
  const shrink = Math.min(1, scale);
  const fit = cloth ? fitGrid(cloth.w, cloth.h, scale, compact ? 48 : 54)
    : { cols: 4, rows: compact ? 2 : 3, beside: compact, cellW: compact ? 48 : 54, cellH: 45 };
  const { cols: COLUMNS, rows, beside, cellW: colW, cellH: rowH } = fit;
  const tapPx = Math.min(colW, rowH);
  const gap = 0;
  const more = () => setCount((current) => Math.min(current + BATCH_SIZE, legalCount));
  // Near the end of what is loaded, load the next batch so the list never runs out under a finger.
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrolled(el.scrollTop > 1);
    if (count < legalCount && el.scrollTop + el.clientHeight > el.scrollHeight - 3 * (rowH + gap)) more();
  };
  // The up chevron keeps its place when there is nothing above, so the amounts never shift.
  const [scrolled, setScrolled] = useState(false);
  const up = () => scroller.current?.scrollBy({ top: -(rowH + gap), behavior: "smooth" });
  const down = () => {
    const el = scroller.current;
    if (!el) return;
    if (count < legalCount && el.scrollTop + el.clientHeight >= el.scrollHeight - 2 * (rowH + gap)) more();
    el.scrollBy({ top: rowH + gap, behavior: "smooth" });
  };
  // Arrow keys walk the grid of amounts: sideways by one, up and down by a row.
  const walk = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const by = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (i < 0 || !by || !buttons[i + by]) return;
    e.preventDefault();
    buttons[i + by].focus();
  };
  const tap = (amount: number, i: number) => {
    setCursor(i);
    if (picked === amount) onBid(amount);
    else setPicked(amount);
  };

  const upButton = <Chevron label="Lower bids" onClick={up} up size={tapPx} disabled={busy} hidden={!scrolled} />;
  const downButton = <Chevron label="Higher bids" onClick={down} size={tapPx} disabled={busy} />;

  const board = (
    <div className={`flex items-center ${beside ? "flex-row" : "flex-col"}`}>
      {!beside && upButton}
      <div ref={scroller} onScroll={onScroll} role="group" aria-label="Bid amounts"
        className="overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: rows * rowH + (rows - 1) * gap, scrollSnapType: "y mandatory" }}>
        <div ref={grid} className="grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, ${colW}px)`, gridAutoRows: rowH, gap }} onKeyDown={walk}
          onFocus={(e) => { const i = amounts.indexOf(Number(e.target.textContent)); if (i >= 0) setCursor(i); }}>
          {amounts.map((amount, i) => (
            <button type="button" key={amount} aria-pressed={picked === amount} disabled={busy} tabIndex={i === cursor ? 0 : -1}
              className="group flex items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-45" onClick={() => tap(amount, i)}
              style={{ height: rowH, width: colW, scrollSnapAlign: "start" }}>
              <span className="btn btn-chalk tabular-nums group-hover:bg-white"
                style={{ height: Math.min(rowH - 6, (compact ? 34 : 36) / shrink), width: colW - 5, padding: 0, fontSize: Math.min((compact ? 16 : 18) / shrink, rowH * 0.45),
                  ...(picked === amount ? { background: "var(--brass)", boxShadow: "inset 0 0 0 3px var(--chalk)" } : null) }}>
                {amount}
              </span>
            </button>
          ))}
        </div>
      </div>
      {beside ? <div className="flex flex-col">{upButton}{downButton}</div> : downButton}
    </div>
  );

  return (<>
    {slot ? createPortal(board, slot) : <div className="flex justify-center pt-1">{board}</div>}
    <div className="flex flex-wrap items-center justify-center gap-2 px-2 py-1 sm:gap-3 sm:px-3">
      <button type="button" className="btn btn-brass tabular-nums" onClick={() => { if (picked !== null) onBid(picked); }} disabled={busy || picked === null}>
        {picked === null ? "Pick a bid" : `Bid ${picked}`}
      </button>
      {pass && <button type="button" className="btn btn-ghost btn-compact" style={{ color: "var(--chalk-faint)" }} onClick={pass.run} disabled={busy}>{pass.label}</button>}
      {misdeal && <MisdealButton busy={busy} run={misdeal} />}
    </div>
  </>);
}

/** Scrolls the bid grid a row. A hidden chevron keeps its place so the amounts never shift. */
function Chevron({ label, onClick, up = false, size, disabled, hidden = false }: {
  label: string; onClick: () => void; up?: boolean; size: number; disabled: boolean; hidden?: boolean;
}) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled || hidden} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}
      className="flex shrink-0 items-center justify-center rounded-full text-chalk-faint hover:text-chalk"
      style={{ width: size, height: size, visibility: hidden ? "hidden" : undefined }}>
      <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={up ? "M2 8l7-6 7 6" : "M2 2l7 6 7-6"} />
      </svg>
    </button>
  );
}

/** Five nines and no meld: the player may scrap the deal before their first call. */
export function MisdealButton({ busy, run }: { busy: boolean; run: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-compact" style={{ color: "var(--chalk)", boxShadow: "inset 0 0 0 1.5px var(--chalk-faint)" }} disabled={busy}
      aria-label="Throw the hand in for nines" onClick={() => run()}>
      Throw in
    </button>
  );
}
