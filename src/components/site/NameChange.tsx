"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

/**
 * "Playing as Ann · Change name", opening into one field. The name is what everyone at the table sees;
 * the handle stays on the home page, where friends look you up.
 */
export function NameChange({ name, onSaved }: { name: string; onSaved?: (name: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  // The name just saved shows until the refreshed prop catches up; a newer prop (another tab) wins.
  const [saved, setSaved] = useState<string | null>(null);
  const [prevName, setPrevName] = useState(name);
  if (name !== prevName) { setPrevName(name); setSaved(null); }
  const shown = saved ?? name;
  // Closing the field hands focus back to the link that opened it.
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) { refocus.current = false; trigger.current?.focus(); }
  }, [open]);
  const close = () => { refocus.current = true; setOpen(false); };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (!next) return;
    if (next === shown) { close(); return; }
    setBusy(true); setError(null);
    try {
      await api("/api/me", { method: "PATCH", body: { displayName: next } });
      setSaved(next);
      close();
      onSaved?.(next);
      router.refresh();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <p className="text-sm text-chalk-faint">
        Playing as <span className="text-chalk">{shown}</span> ·{" "}
        <button ref={trigger} type="button" className="tap-link underline underline-offset-4 hover:text-chalk" onClick={() => { setValue(shown); setError(null); setOpen(true); }}>
          Change name
        </button>
      </p>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="name-change">Name at the table</label>
        <input id="name-change" className="field min-w-0 flex-1" value={value} onChange={(e) => setValue(e.target.value)}
          maxLength={40} required autoFocus autoComplete="nickname" enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }} />
        <button className="btn btn-chalk btn-compact" disabled={busy || !value.trim()}>{busy ? "Saving" : "Save"}</button>
        <button type="button" className="tap-link text-sm text-chalk-faint hover:text-chalk" onClick={close}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-deck-red-soft">{error}</p>}
    </form>
  );
}
