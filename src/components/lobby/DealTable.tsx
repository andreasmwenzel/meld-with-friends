"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { RulesForm } from "@/components/rules/RulesForm";
import type { RulesPatch } from "@/components/rules/rules";
import { useRulesPref } from "@/components/rules/useRulesPref";

export function DealTable({ autoOpen = false, defaults = null }: { autoOpen?: boolean; defaults?: RulesPatch | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rules, setRules, remember } = useRulesPref(defaults);

  async function deal() {
    setBusy(true); setError(null);
    try {
      const t = await api<{ code: string }>("/api/tables", { body: { gameKind: "pinochle", rules } });
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
      {error && <p className="mt-3 text-sm text-pip-red">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-ink" onClick={deal} disabled={busy}>{busy ? "Dealing" : "Deal"}</button>
        <button className="btn" style={{ color: "var(--ink-soft)" }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
