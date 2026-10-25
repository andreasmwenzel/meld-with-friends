"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Status = "open" | "playing" | "finished";
interface AdminTable {
  code: string; status: Status; hostHandle: string | null;
  seats: { seat: number; name: string; bot: boolean }[];
  createdAt: string; lastActivity: string; rev: number; phase: string | null;
}

const FILTERS: { key: "" | Status; label: string }[] = [
  { key: "", label: "All" }, { key: "open", label: "Open" }, { key: "playing", label: "Playing" }, { key: "finished", label: "Finished" },
];

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** Every table on the server, filterable, with a way to close one that is stuck. */
export function Tables() {
  const [filter, setFilter] = useState<"" | Status>("");
  const [rows, setRows] = useState<AdminTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (f: "" | Status) => {
    try {
      const r = await api<AdminTable[]>(`/api/admin/tables?status=${f}&limit=50`);
      setRows(r); setError(null); setNow(Date.now());
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    // Clear the old list on filter change so the previous filter's rows never sit under the new label.
    const t = setTimeout(() => { setRows(null); void load(filter); }, 0);
    return () => clearTimeout(t);
  }, [filter, load]);

  async function finish(t: AdminTable) {
    if (!confirm(`Finish table ${t.code} now? Players will see the game as over.`)) return;
    setBusy(t.code);
    try { await api(`/api/admin/tables/${t.code}/finish`, { method: "POST", body: {} }); await load(filter); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section>
      <h2 className="display" style={{ fontSize: 30 }}>Tables</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter tables">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
            className={`tap rounded-full px-3 text-sm font-semibold ${filter === f.key ? "bg-ink text-chalk" : "text-chalk-faint hover:text-chalk"}`}>
            {f.label}
          </button>
        ))}
        <button type="button" onClick={() => void load(filter)} className="tap ml-auto text-sm text-chalk-faint underline underline-offset-4 hover:text-chalk">Refresh</button>
      </div>
      {error && <p className="mt-2 text-sm text-deck-red-soft">{error}</p>}
      {rows === null && !error ? (
        <p className="mt-3 text-chalk-faint">Counting tables.</p>
      ) : rows && rows.length === 0 ? (
        <p className="mt-3 text-chalk-faint">No tables match.</p>
      ) : rows && (
        <div className="scroll-x mt-3 -mx-6 px-6">
        <ul className="flex min-w-[560px] flex-col divide-y divide-chalk-ghost">
          {rows.map((t) => (
            <li key={t.code} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-5 gap-y-1 py-3">
              <div>
                <p className="code" style={{ fontSize: 20, letterSpacing: ".14em" }}>{t.code}</p>
                <p className="text-sm text-chalk-faint">{t.status}</p>
              </div>
              <div className="min-w-0 text-sm">
                <p>
                  <span className="text-chalk-faint">Host </span>{t.hostHandle ?? "unknown"}
                </p>
                <p className="truncate text-chalk-faint">
                  {[...t.seats].sort((a, b) => a.seat - b.seat).map((s) => (s.bot ? `${s.name} (computer)` : s.name)).join(", ") || "No one seated"}
                </p>
              </div>
              <div className="flex items-center gap-4 text-right text-sm">
                <div>
                  <p>{ago(t.lastActivity, now)}</p>
                  <p className="text-chalk-faint">rev {t.rev}{t.phase ? `, ${t.phase}` : ""}</p>
                </div>
                {t.status !== "finished" ? (
                  <button type="button" disabled={busy === t.code} onClick={() => void finish(t)}
                    className="tap text-deck-red-soft underline underline-offset-4 hover:text-chalk disabled:opacity-45">
                    {busy === t.code ? "Finishing" : "Finish"}
                  </button>
                ) : <span className="w-[3.2ch]" aria-hidden />}
              </div>
            </li>
          ))}
        </ul>
        </div>
      )}
    </section>
  );
}
