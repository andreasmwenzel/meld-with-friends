"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Group } from "@/lib/api";
import { RulesForm } from "@/components/rules/RulesForm";
import type { RulesPatch } from "@/components/rules/rules";
import { useRulesPref } from "@/components/rules/useRulesPref";

/** Pick a group and each member finds an invitation to the new table in their lobby. */
function InviteGroup({ groups, value, onChange }: { groups: Group[]; value: string | null; onChange: (id: string | null) => void }) {
  const choices: { id: string | null; label: string; count?: number }[] = [{ id: null, label: "Nobody, I'll share the code" }, ...groups.map((g) => ({ id: g.id, label: g.name, count: g.members.length }))];
  return (
    <fieldset className="mt-4">
      <legend className="text-sm text-ink-soft">Invite a group</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {choices.map((c) => {
          const on = value === c.id;
          return (
            <button key={c.id ?? "none"} type="button" aria-pressed={on} onClick={() => onChange(c.id)} disabled={c.count === 0}
              className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-40"
              style={on ? { background: "var(--ink)", color: "var(--chalk)" } : { color: "var(--ink)", boxShadow: "inset 0 0 0 1.5px var(--chalk-dim)" }}>
              {c.label}
              {c.count !== undefined && <span className="font-normal tabular-nums opacity-70">{c.count}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function DealTable({ autoOpen = false, defaults = null, saved = false }: { autoOpen?: boolean; defaults?: RulesPatch | null; saved?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rules, setRules, remember } = useRulesPref(defaults);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  // Groups are a saved-account feature; guests deal without the picker.
  useEffect(() => {
    if (!open || !saved) return;
    let active = true;
    api<Group[]>("/api/groups").then((list) => { if (active) setGroups(list); }).catch(() => {});
    return () => { active = false; };
  }, [open, saved]);

  async function deal() {
    setBusy(true); setError(null);
    try {
      const t = await api<{ code: string }>("/api/tables", { body: { gameKind: "pinochle", rules, ...(groupId ? { groupId } : {}) } });
      void remember(rules, true);
      router.push(`/t/${t.code}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (!open) {
    return <button className="btn btn-chalk" onClick={() => setOpen(true)}>Deal a new table</button>;
  }
  return (
    <div className="panel max-w-2xl p-4 sm:p-5">
      <p className="display" style={{ fontSize: 26 }}>Deal a table</p>
      <p className="mt-1 text-ink-soft">Four-hand partnership pinochle. Set the house rules; you can still change them at the table before the first deal.</p>
      <div className="mt-4"><RulesForm value={rules} onChange={setRules} /></div>
      {groups.length > 0 && <InviteGroup groups={groups} value={groupId} onChange={setGroupId} />}
      {error && <p className="mt-3 text-sm text-pip-red">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-ink" onClick={deal} disabled={busy}>{busy ? "Dealing" : "Deal"}</button>
        <button className="btn" style={{ color: "var(--ink-soft)" }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
