"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// The server returns raw rows (snake_case, no handle); accept either shape.
interface BanRow { user_id?: string; userId?: string; handle?: string; reason: string | null; created_at?: string; createdAt?: string }

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Suspend a player by handle, and lift suspensions. */
export function Bans() {
  const [rows, setRows] = useState<BanRow[] | null>(null);
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api<BanRow[]>("/api/admin/bans")); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function suspend(e: React.FormEvent) {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    setBusy(true);
    try {
      await api("/api/admin/bans", { body: { handle: h, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      setHandle(""); setReason(""); await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function lift(userId: string) {
    if (!confirm("Lift this suspension?")) return;
    setBusy(true);
    try { await api("/api/admin/bans", { method: "DELETE", body: { userId } }); await load(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <section>
      <h2 className="display" style={{ fontSize: 30 }}>Suspensions</h2>
      <p className="mt-1 text-sm text-chalk-faint">A suspended player cannot sit at a table or play. Lifting it puts them back.</p>
      <form onSubmit={suspend} className="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row">
        <input className="field sm:max-w-48" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Handle" aria-label="Handle" autoComplete="off" />
        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" maxLength={1000} />
        <button className="btn btn-chalk" disabled={busy || !handle.trim()}>Suspend</button>
      </form>
      {error && <p className="mt-2 text-sm text-deck-red-soft">{error}</p>}
      {rows === null && !error ? (
        <p className="mt-3 text-chalk-faint">Checking the list.</p>
      ) : rows && rows.length === 0 ? (
        <p className="mt-3 text-chalk-faint">No one is suspended.</p>
      ) : rows && (
        <ul className="mt-3 flex max-w-2xl flex-col divide-y divide-chalk-ghost">
          {rows.map((b) => {
            const id = (b.userId ?? b.user_id)!;
            const when = b.createdAt ?? b.created_at;
            return (
              <li key={id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 text-sm">
                  <p>{b.handle ? `@${b.handle}` : `Account ${id.slice(0, 8)}`}{when && <span className="text-chalk-faint">, since {dateFmt.format(new Date(when))}</span>}</p>
                  <p className="truncate text-chalk-faint">{b.reason || "No reason given"}</p>
                </div>
                <button type="button" disabled={busy} onClick={() => void lift(id)}
                  className="tap text-sm text-chalk-faint underline underline-offset-4 hover:text-chalk disabled:opacity-45">Lift</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
