"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** The dark cloth surface popovers and sheets are laid on, so chalk text inside reads as it does on the table. */
export const CLOTH_SURFACE = { background: "var(--cloth-deep)", boxShadow: "inset 0 0 0 1.5px var(--cloth-edge), var(--shadow-card)" };

/**
 * A button that opens a panel on the cloth. The panel stays mounted while closed (hidden), so whatever it holds keeps
 * listening (friends coming online, a request arriving) and can report back to the button. Escape or a tap elsewhere
 * closes it. `place` positions the panel against the nearest positioned ancestor, so a dock can centre it on the
 * screen rather than on the button; the panel scrolls inside itself when it is taller than the screen allows.
 */
export function Popover({ button, label, children, place, buttonClassName, open: controlled, onOpenChange }: {
  button: ReactNode; label: string; children: ReactNode;
  place: string; buttonClassName: string; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (next: boolean) => { setOwn(next); onOpenChange?.(next); };
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const latest = useRef(setOpen);
  useEffect(() => { latest.current = setOpen; });
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) latest.current(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
      latest.current(false);
    };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={root} className="contents">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} aria-haspopup="dialog"
        className={buttonClassName} onClick={() => setOpen(!open)}>
        {button}
      </button>
      <div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1} hidden={!open} style={{ ...CLOTH_SURFACE, outline: "none" }}
        className={`absolute z-40 overflow-y-auto overscroll-contain rounded-[14px] p-4 text-left text-chalk outline-none ${place}`}>
        {children}
      </div>
    </div>
  );
}

/**
 * A modal sheet: rises from the bottom edge on a phone, sits in the middle of a wider screen. Escape or a tap on the
 * shade closes it. Used for what is too big for a popover, like dealing a table.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onClose);
  useEffect(() => { latest.current = onClose; });
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") latest.current(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); back?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-2 sm:items-center sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} style={{ outline: "none", paddingBottom: "env(safe-area-inset-bottom)" }}
        className="max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-2xl overflow-y-auto overscroll-contain outline-none">
        {children}
      </div>
    </div>
  );
}
