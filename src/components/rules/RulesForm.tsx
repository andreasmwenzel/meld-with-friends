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
  { k: "shoot", label: "Shooting the moon", options: opts([["on", "Allowed"], ["off", "Not allowed"]]) },
  { k: "ninesMisdeal", label: "Five nines, no meld", options: opts([[true, "May throw the hand in"], [false, "Must play it"]]) },
  { k: "revealHands", label: "After each hand", options: opts([[true, "Show everyone's cards"], [false, "Keep hands hidden"]]) },
  { k: "pace", label: "Pace", options: opts([["live", "Live"], ["leisurely", "Leisurely (a trick a day is fine)"]]) },
];

/** Decode the select's string back into the typed rule value. */
function decode(k: Key, raw: string): RulesConfig[Key] {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (k === "scoring" || k === "counting" || k === "shoot" || k === "pace") return raw as RulesConfig[Key];
  return Number(raw) as RulesConfig[Key];
}

/**
 * House rules, the one way they are shown: with `onChange` an editor, without it the same grid read-only, so a
 * rule sits where it was set. Each value is the text its select shows.
 */
export function RulesForm({ value, onChange, compact = false }: { value: RulesPatch | Record<string, unknown> | undefined; onChange?: (next: RulesPatch) => void; compact?: boolean }) {
  const r = resolveRules(value);
  const grid = `grid gap-3 ${compact ? "grid-cols-1 min-[480px]:grid-cols-2" : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3"}`;
  const fields = FIELDS.filter((f) => !f.when || f.when(r));
  const optionsOf = (f: typeof FIELDS[number]) => typeof f.options === "function" ? f.options(r) : f.options;
  if (!onChange) {
    return (
      <dl className={grid}>
        {fields.map((f) => (
          <div key={f.k} className="min-w-0 text-sm">
            <dt className="text-ink-soft">{f.label}</dt>
            {/* As tall as the select it stands in for, so the grid lines up with the editor. */}
            <dd className="mt-1 flex min-h-11 items-center rounded-[10px] bg-ink/5 px-[.9rem] text-base text-ink">
              {optionsOf(f).find(([v]) => v === String(r[f.k]))?.[1] ?? String(r[f.k])}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className={grid}>
      {fields.map((f) => (
        <label key={f.k} className="min-w-0 text-sm text-ink-soft">
          {f.label}
          <select className="field mt-1" value={String(r[f.k])} onChange={(e) => onChange(changeRule(value as RulesPatch, f.k, decode(f.k, e.target.value)))}>
            {optionsOf(f).map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
