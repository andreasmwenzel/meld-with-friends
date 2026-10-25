"use client";

import type { RulesConfig } from "@/engine/types";
import { changeRule, POINT_OPTIONS, resolveRules, type RulesPatch } from "./rules";

type Key = keyof RulesConfig;
type Opt = [string, string];
const opts = (pairs: [RulesConfig[Key], string][]): Opt[] => pairs.map(([v, t]) => [String(v), t]);

const pointOptions = (key: keyof typeof POINT_OPTIONS.modern) => (r: RulesConfig): Opt[] =>
  POINT_OPTIONS[r.scoring][key].map(value => [String(value), key === "lastTrickBonus"
    ? value === 0 ? "Nothing" : `${value} ${value === 1 ? "point" : "points"}`
    : value.toLocaleString()]);

const FIELDS: { k: Key; label: string; options: Opt[] | ((r: RulesConfig) => Opt[]); when?: (r: RulesConfig) => boolean }[] = [
  { k: "scoring", label: "Scoring", options: opts([["modern", "Modern (bid 25, play to 150)"], ["classic", "Classic ×10 (bid 250, play to 1,500)"]]) },
  { k: "target", label: "Play to", options: pointOptions("target") },
  { k: "minBid", label: "Minimum bid", options: pointOptions("minBid") },
  { k: "bidStep", label: "Bid steps", options: pointOptions("bidStep") },
  { k: "passCount", label: "Pass cards", options: opts([[0, "No passing"], [3, "3 each way"], [4, "4 each way"], [5, "5 each way"]]) },
  { k: "counting", label: "Counting", options: (r) => opts([["tens", `Aces, tens, kings: ${r.scoring === "modern" ? 1 : 10}`], ["classic", "Old-style 11 / 10 / 4 / 3 / 2"]]) },
  { k: "lastTrickBonus", label: "Last trick", options: pointOptions("lastTrickBonus") },
  { k: "mustTakeTrickToSaveMeld", label: "Keeping meld", options: opts([[true, "Must take a trick"], [false, "Always counts"]]) },
  { k: "dealerStuck", label: "Everyone passes", options: opts([[true, "Dealer is stuck"], [false, "Redeal"]]) },
  { k: "revealHands", label: "After each hand", options: opts([[true, "Show everyone's cards"], [false, "Keep hands hidden"]]) },
  { k: "shoot", label: "Shooting the moon", options: opts([["off", "Not allowed"], ["game", "Wins or loses the game"], ["points", "Fixed points"]]) },
  { k: "pace", label: "Pace", options: opts([["live", "Live"], ["leisurely", "Leisurely (a trick a day is fine)"]]) },
  { k: "shootPoints", label: "Shoot is worth", options: pointOptions("shootPoints"), when: (r) => r.shoot === "points" },
];

/** Decode the select's string back into the typed rule value. */
function decode(k: Key, raw: string): RulesConfig[Key] {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (k === "scoring" || k === "counting" || k === "shoot" || k === "pace") return raw as RulesConfig[Key];
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
          <select className="field mt-1" value={String(r[f.k])} onChange={(e) => onChange(changeRule(value, f.k, decode(f.k, e.target.value)))}>
            {(typeof f.options === "function" ? f.options(r) : f.options).map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
