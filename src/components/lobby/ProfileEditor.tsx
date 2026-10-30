"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, type Profile } from "@/lib/api";

/**
 * Name and handle, as a card in the account menu. The name is typed; the handle friends find you by is drawn from
 * two random words. `onDone` closes the card after a save or a cancel.
 */
export function ProfileEditor({ me, onDone }: { me: Profile; onDone: () => void }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(me.display_name);
  const [handle, setHandle] = useState(me.handle);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNote(null);
    try {
      await api("/api/me", { method: "PATCH", body: { displayName: displayName.trim() } });
      onDone();
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

  return (
    <form onSubmit={save} className="panel grid gap-3 p-4">
      <label className="text-sm text-ink-soft">Name at the table
        <input className="field mt-1" autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
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
        <button type="button" className="btn" style={{ color: "var(--ink-soft)" }} onClick={onDone}>Cancel</button>
      </div>
      <p aria-live="polite" className={`text-sm empty:hidden ${note?.ok ? "text-ink-soft" : "text-pip-red"}`}>{note?.text}</p>
    </form>
  );
}
