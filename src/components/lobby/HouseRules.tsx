"use client";

import { useState } from "react";
import { RulesForm } from "@/components/rules/RulesForm";
import { describeRules, type RulesPatch } from "@/components/rules/rules";
import { useRulesPref } from "@/components/rules/useRulesPref";

/** The player's own default house rules, used to prefill every table they deal. */
export function HouseRules({ initial }: { initial: RulesPatch | null }) {
  const { rules, setRules, remember } = useRulesPref(initial);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    await remember(rules, true);
    setSaved(true); setOpen(false);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="display" style={{ fontSize: 34 }}>Your house rules</h2>
        {!open && <button className="tap text-sm text-chalk-faint hover:text-chalk" onClick={() => setOpen(true)}>{saved ? "Saved" : "Change"}</button>}
      </div>
      <p className="mt-1 text-sm text-chalk-faint">Every table you deal starts with these. You can still adjust them at the table.</p>
      {open ? (
        <div className="panel mt-3 max-w-2xl p-4 sm:p-5">
          <RulesForm value={rules} onChange={setRules} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-ink" onClick={save}>Save as my defaults</button>
            <button className="btn" style={{ color: "var(--ink-soft)" }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <ul className="mt-3 max-w-md text-chalk-faint text-sm flex flex-col gap-0.5">
          {describeRules(rules).map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </section>
  );
}
