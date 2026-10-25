"use client";

import type { RulesConfig } from "@/engine/types";
import { resolveRules, type RulesPatch } from "./rules";

type Key = keyof RulesConfig;
type Opt = [string, string];
const opts = (pairs: [RulesConfig[Key], string][]): Opt[] => pairs.map(([v, t]) => [String(v), t]);

const FIELDS: { k: Key; label: string; options: Opt[]; when?: (r: RulesConfig) => boolean }[] = [
  { k: "target", label: "Play to", options: opts([[1000, "1,000"], [1500, "1,500"], [2000, "2,000"], [2500, "2,500"]]) },
  { k: "minBid", label: "Minimum bid", options: opts([[200, "200"], [250, "250"], [300, "300"]]) },
  { k: "bidStep", label: "Bid steps", options: opts([[10, "10"], [20, "20"], [25, "25"], [50, "50"]]) },
  { k: "passCount", label: "Pass cards", options: opts([[0, "No passing"], [3, "3 each way"], [4, "4 each way"], [5, "5 each way"]]) },
  { k: "counting", label: "Counting", options: opts([["tens", "Aces, tens, kings: 10"], ["classic", "Classic 11 / 10 / 4 / 3 / 2"]]) },
  { k: "lastTrickBonus", label: "Last trick", options: opts([[0, "Nothing"], [10, "10 points"], [20, "20 points"]]) },
  { k: "mustTakeTrickToSaveMeld", label: "Keeping meld", options: opts([[true, "Must take a trick"], [false, "Always counts"]]) },
  { k: "dealerStuck", label: "Everyone passes", options: opts([[true, "Dealer is stuck"], [false, "Redeal"]]) },
  { k: "revealHands", label: "After each hand", options: opts([[true, "Show everyone's cards"], [false, "Keep hands hidden"]]) },
  { k: "shoot", label: "Shooting the moon", options: opts([["off", "Not allowed"], ["game", "Wins or loses the game"], ["points", "Fixed points"]]) },
  { k: "pace", label: "Pace", options: opts([["live", "Live"], ["leisurely", "Leisurely (a trick a day is fine)"]]) },
  { k: "shootPoints", label: "Shoot is worth", options: opts([[500, "500"], [1000, "1,000"], [1500, "1,500"], [2000, "2,000"]]), when: (r) => r.shoot === "points" },
];

/** Decode the select's string back into the typed rule value. */
function decode(k: Key, raw: string): RulesConfig[Key] {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (k === "counting" || k === "shoot" || k === "pace") return raw as RulesConfig[Key];
  return Number(raw) as RulesConfig[Key];
}

/** House rules editor. Controlled: emits the full patch on every change. */
export function RulesForm({ value, onChange, compact = false }: { value: RulesPatch; onChange: (next: RulesPatch) => void; compact?: boolean }) {
  const r = resolveRules(value);
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1 min-[480px]:grid-cols-2" : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3"}`}>
      {FIELDS.filter((f) => !f.when || f.when(r)).map((f) => (
        <label key={f.k} className="min-w-0 text-sm text-ink-soft">
          {f.label}
          <select className="field mt-1" value={String(r[f.k])} onChange={(e) => onChange({ ...value, [f.k]: decode(f.k, e.target.value) })}>
            {f.options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
