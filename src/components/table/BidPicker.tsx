"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

const BATCH_SIZE = 32;
const COLUMNS = 4;

/**
 * The bid amounts lie open on the cloth (portalled into `slot` when the table gives one), so bidding covers
 * nothing but the table. Tap an amount to pick it, then tap it again or the Bid button to bid.
 * Scrolling appends legal increments, so it never discards earlier bids or the selection.
 */
export function BidPicker({ min, step, busy, onBid, pass, misdeal = null, slot = null, compact = false }: {
  min: number; step: number; busy: boolean; onBid: (amount: number) => void;
  pass: { label: string; run: () => void } | null;
  /** throw the hand in for nines */
  misdeal?: (() => void) | null;
  /** where on the table the grid goes; without one it sits above the buttons */
  slot?: HTMLElement | null;
  /** sideways on a phone the cloth is shallow: two rows show instead of three */
  compact?: boolean;
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
  // Each amount takes a full 44px tap; the pill drawn inside it is smaller, so the rows still read as a grid.
  const rowH = 44;
  const colW = compact ? 48 : 54;
  const gap = 0;
  const rows = compact ? 2 : 3;
  const more = () => setCount((current) => Math.min(current + BATCH_SIZE, legalCount));
  // Near the end of what is loaded, load the next batch so the list never runs out under a finger.
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (count < legalCount && el.scrollTop + el.clientHeight > el.scrollHeight - 3 * (rowH + gap)) more();
  };
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

  const board = (
    <div className={`flex items-center ${compact ? "flex-row" : "flex-col"}`}>
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
                style={{ height: compact ? 34 : 36, width: colW - 5, padding: 0, fontSize: compact ? 16 : 18,
                  ...(picked === amount ? { background: "var(--brass)", boxShadow: "inset 0 0 0 3px var(--chalk)" } : null) }}>
                {amount}
              </span>
            </button>
          ))}
        </div>
      </div>
      <button type="button" aria-label="Higher bids" onClick={down} disabled={busy}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-chalk-faint hover:text-chalk">
        <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 2l7 6 7-6" />
        </svg>
      </button>
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

/** Five nines and no meld: the player may scrap the deal before their first call. */
export function MisdealButton({ busy, run }: { busy: boolean; run: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-compact" style={{ color: "var(--chalk)", boxShadow: "inset 0 0 0 1.5px var(--chalk-faint)" }} disabled={busy}
      aria-label="Throw the hand in for nines" onClick={() => run()}>
      Throw in
    </button>
  );
}
