"use client";

import { useId, useRef, type ReactNode } from "react";

/** The rules and the meld chart, kept in a sheet so the front door stays one screen. */
export function HowToPlay({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className="btn btn-ghost btn-compact" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        How to play
      </button>
      <dialog ref={dialog} aria-labelledby={titleId}
        onClick={(e) => { if (e.target === dialog.current) dialog.current.close(); }}
        className="m-auto w-[calc(100%-1.5rem)] max-w-3xl max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[14px] p-0 text-chalk backdrop:bg-black/60"
        style={{ background: "var(--cloth-deep)", boxShadow: "inset 0 0 0 1.5px var(--cloth-edge), var(--shadow-card)" }}>
        <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-chalk-ghost px-5 py-3">
            <h2 id={titleId} className="display" style={{ fontSize: 28 }}>How to play</h2>
            <button type="button" className="btn btn-chalk btn-compact" onClick={() => dialog.current?.close()}>Close</button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 pt-5">{children}</div>
        </div>
      </dialog>
    </>
  );
}
