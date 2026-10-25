"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { SETTING_FIELDS, type Settings } from "@/lib/settings";

export function SettingsPanel({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(group: "bots" | "limits", key: string, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    setSettings((s) => ({ ...s, [group]: { ...s[group], [key]: n } }));
    setDirty(true); setNote(null);
  }
  async function save() {
    setBusy(true); setNote(null);
    try {
      const saved = await api<Settings>("/api/admin/settings", { method: "PATCH", body: settings });
      setSettings(saved); setDirty(false); setNote("Saved. Bots pick this up within 30 seconds.");
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-10">
      {(["bots", "limits"] as const).map((group) => (
        <section key={group}>
          <h2 className="display" style={{ fontSize: 30 }}>{group === "bots" ? "Computer players" : "Free-tier guardrails"}</h2>
          <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {SETTING_FIELDS.filter((f) => f.group === group).map((f) => (
              <label key={f.key} className="text-sm">
                <span className="text-chalk">{f.label}</span>
                <input
                  type="number" step={f.step ?? 1} className="field mt-1"
                  value={String((settings[group] as Record<string, number>)[f.key])}
                  onChange={(e) => update(group, f.key, e.target.value)}
                />
                <span className="mt-1 block text-xs text-chalk-faint">{f.help}</span>
              </label>
            ))}
          </div>
        </section>
      ))}
      <div className="flex items-center gap-3">
        <button className="btn btn-brass" onClick={save} disabled={!dirty || busy}>{busy ? "Saving" : "Save settings"}</button>
        {note && <span className="text-sm text-chalk-faint">{note}</span>}
      </div>
    </div>
  );
}
