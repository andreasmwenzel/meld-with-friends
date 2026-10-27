"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, type Profile } from "@/lib/api";

/** Name and handle. The name is typed; the handle friends find you by is drawn from two random words. */
export function ProfileEditor({ me }: { me: Profile }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [handle, setHandle] = useState(me.handle);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNote(null);
    try {
      await api("/api/me", { method: "PATCH", body: { displayName: displayName.trim() } });
      setNote({ text: "Saved.", ok: true });
      setOpen(false);
      router.refresh();
    } catch (err) { setNote({ text: (err as Error).message, ok: false }); } finally { setBusy(false); }
  }

  // Draws a fresh two-word handle and saves it straight away; the name field is left as typed.
  async function reroll() {
    setBusy(true); setNote(null);
    try {
      const next = await api<Profile>("/api/me/handle", { method: "POST" });
      setHandle(next.handle);
      setNote({ text: `Saved as @${next.handle}.`, ok: true });
      router.refresh();
    } catch (err) { setNote({ text: (err as Error).message, ok: false }); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button className="tap text-left text-sm text-chalk-faint hover:text-chalk" onClick={() => setOpen(true)}>
        {me.display_name} · @{me.handle} · edit
      </button>
    );
  }
  return (
    <form onSubmit={save} className="panel mt-2 grid max-w-md gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-sm text-ink-soft">Name at the table
        <input className="field mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
      </label>
      <div className="text-sm text-ink-soft">
        <p>Handle</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-base font-semibold text-ink">@{handle}</p>
          <button type="button" className="btn btn-compact shrink-0" style={{ color: "var(--ink)" }} onClick={reroll} disabled={busy} aria-label="New words: draw a random handle">New words</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ink" disabled={busy}>Save</button>
        <button type="button" className="btn" style={{ color: "var(--ink-soft)" }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p aria-live="polite" className={`text-sm sm:col-span-3 empty:hidden ${note?.ok ? "text-ink-soft" : "text-pip-red"}`}>{note?.text}</p>
    </form>
  );
}
