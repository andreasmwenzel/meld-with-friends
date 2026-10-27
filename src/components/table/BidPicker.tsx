"use client";

import { useId, useRef, useState } from "react";

const BATCH_SIZE = 30;

/** Append legal increments so scrolling never discards earlier bids or the selection. */
export function BidPicker({ min, step, busy, onBid, pass, shoot, misdeal = null }: {
  min: number; step: number; busy: boolean; onBid: (amount: number) => void;
  pass: { label: string; run: () => void } | null; shoot: (() => void) | null;
  /** throw the hand in for nines; offered on the table row only, not inside the bid dialog */
  misdeal?: (() => void) | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [count, setCount] = useState(BATCH_SIZE);
  const [picked, setPicked] = useState<number | null>(null);
  // The engine accepts safe integers and has no game-rule maximum bid.
  const legalCount = Math.floor((Number.MAX_SAFE_INTEGER - min) / step) + 1;
  const amounts = Array.from({ length: Math.min(count, legalCount) }, (_, i) => min + i * step);
  const close = () => dialog.current?.close();
  const grid = useRef<HTMLDivElement>(null);
  // Into the dialog at the bid already picked, else the lowest; the dialog would otherwise start on Close.
  const open = () => {
    dialog.current?.showModal();
    (grid.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]") ?? grid.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  };
  // Arrow keys walk the grid of amounts: sideways by one, up and down by a row.
  const walk = (e: React.KeyboardEvent) => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const by = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (i < 0 || !by || !buttons[i + by]) return;
    e.preventDefault();
    buttons[i + by].focus();
  };
  const alternatives = (inDialog = false) => <>
    {pass && <button type="button" className="btn btn-ghost btn-compact" style={{ color: inDialog ? "var(--ink-soft)" : "var(--chalk-faint)" }} onClick={pass.run} disabled={busy}>{pass.label}</button>}
    {shoot && (
      <button type="button" className="btn btn-ghost btn-compact" style={{ color: inDialog ? "var(--brass-deep)" : "var(--brass)", boxShadow: "inset 0 0 0 1.5px var(--brass)" }} onClick={shoot} disabled={busy}
        aria-label="Shoot the moon">
        {/* Short on narrow phones so bid, pass and shoot stay on one row. */}
        <span className={inDialog ? "hidden" : "sm:hidden"}>Shoot</span><span className={inDialog ? "" : "hidden sm:inline"}>Shoot the moon</span>
      </button>
    )}
  </>;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-2 py-1 sm:gap-3 sm:px-3">
      <button type="button" className="btn btn-chalk" aria-haspopup="dialog" onClick={open} disabled={busy}>
        {picked === null ? "Choose bid" : `Choose bid (${picked})`}
      </button>
      {alternatives()}
      {misdeal && <MisdealButton busy={busy} run={misdeal} />}
      <dialog ref={dialog} aria-labelledby={titleId}
        className="panel m-auto w-[calc(100%-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-hidden p-0 backdrop:bg-black/50">
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 p-4">
            <h2 id={titleId} className="display text-2xl">Choose your bid</h2>
            <button type="button" className="btn btn-ink btn-compact" onClick={close}>Close</button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4" role="group" aria-label="Bid amounts">
            <div ref={grid} className="grid grid-cols-3 gap-2" onKeyDown={walk}>
              {amounts.map((amount) => (
                <button type="button" key={amount} className="btn btn-chalk tabular-nums" aria-pressed={picked === amount} disabled={busy}
                  style={{ fontSize: 18, ...(picked === amount ? { background: "var(--brass)", boxShadow: "inset 0 0 0 3px var(--chalk)" } : null) }}
                  onClick={() => setPicked(amount)}>
                  {amount}
                </button>
              ))}
            </div>
            {count < legalCount && (
              <button type="button" className="btn btn-ink mt-3 w-full" disabled={busy}
                onClick={() => setCount((current) => Math.min(current + BATCH_SIZE, legalCount))}>
                Load higher bids
              </button>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-chalk-ghost p-4">
            {alternatives(true)}
            <button type="button" className="btn btn-brass" onClick={() => { if (picked !== null) onBid(picked); }} disabled={busy || picked === null}>
              {picked === null ? "Pick a bid" : `Bid ${picked}`}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/** Five nines and no meld: the player may scrap the deal before their first call. */
export function MisdealButton({ busy, run }: { busy: boolean; run: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-compact" style={{ color: "var(--chalk)", boxShadow: "inset 0 0 0 1.5px var(--chalk-faint)" }} disabled={busy}
      aria-label="Throw the hand in for nines" onClick={() => { if (window.confirm("Throw this hand in? You hold five or more nines and no other meld, so the same dealer deals again.")) run(); }}>
      Throw in
    </button>
  );
}
