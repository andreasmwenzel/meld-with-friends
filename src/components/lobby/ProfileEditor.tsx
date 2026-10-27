"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, type Profile } from "@/lib/api";

/** Name and handle. Friends find you by the handle, so it is worth getting right on day one. */
export function ProfileEditor({ me }: { me: Profile }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [handle, setHandle] = useState(me.handle);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNote(null);
    try {
      await api("/api/me", { method: "PATCH", body: { displayName: displayName.trim(), handle: handle.trim().replace(/^@/, "").toLowerCase() } });
      setNote("Saved.");
      setOpen(false);
      router.refresh();
    } catch (err) { setNote((err as Error).message); } finally { setBusy(false); }
  }

  // Draws a fresh two-word handle and saves it straight away; the name field is left as typed.
  async function reroll() {
    setBusy(true); setNote(null);
    try {
      const next = await api<Profile>("/api/me/handle", { method: "POST" });
      setHandle(next.handle);
      router.refresh();
    } catch (err) { setNote((err as Error).message); } finally { setBusy(false); }
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
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="profile-handle">Handle</label>
          <button type="button" className="tap font-semibold text-ink hover:underline" onClick={reroll} disabled={busy}>New words</button>
        </div>
        <input id="profile-handle" className="field mt-1" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={32} required autoCapitalize="off" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ink" disabled={busy}>Save</button>
        <button type="button" className="btn" style={{ color: "var(--ink-soft)" }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {note && <p className="text-sm text-pip-red sm:col-span-3">{note}</p>}
    </form>
  );
}
