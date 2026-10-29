"use client";

import type { RulesConfig } from "@/engine/types";
import { changeRule, POINT_OPTIONS, resolveRules, type RulesPatch } from "./rules";

type Key = keyof RulesConfig;
type Opt = [string, string];
type Value = RulesConfig[Key];

const points = (n: number) => `${n.toLocaleString()} ${n === 1 ? "point" : "points"}`;

/**
 * Every rule: its label, the values its select offers, and how a value reads, taken from the table's actual rules so
 * the view and the editor never claim a number the game does not use. `text` also words a stored value that is not
 * on the menu. `help` is a line under the rule, for the few whose one-word value cannot say what they mean.
 */
const FIELDS: {
  k: Key; label: string; values: (r: RulesConfig) => Value[]; text: (v: Value, r: RulesConfig) => string;
  help?: (r: RulesConfig) => string | null;
}[] = [
  { k: "scoring", label: "Scoring", values: () => ["modern", "classic"],
    text: (v) => v === "classic" ? "Classic, counted in tens" : "Modern, counted in ones" },
  { k: "target", label: "Play to", values: (r) => POINT_OPTIONS[r.scoring].target, text: (v) => (v as number).toLocaleString() },
  { k: "minBid", label: "Minimum bid", values: (r) => POINT_OPTIONS[r.scoring].minBid, text: (v) => (v as number).toLocaleString() },
  { k: "bidStep", label: "Bid steps", values: (r) => POINT_OPTIONS[r.scoring].bidStep, text: (v) => (v as number).toLocaleString() },
  { k: "passCount", label: "Pass cards", values: () => [0, 3, 4, 5], text: (v) => v === 0 ? "No passing" : `${v} each way` },
  { k: "counting", label: "Counting", values: () => ["tens", "classic"],
    text: (v, r) => v === "classic" ? "Aces 11, tens 10, kings 4, queens 3, jacks 2" : `Aces, tens, kings: ${r.counterValue} each` },
  { k: "lastTrickBonus", label: "Last trick", values: (r) => POINT_OPTIONS[r.scoring].lastTrickBonus,
    text: (v) => v === 0 ? "Nothing" : points(v as number) },
  { k: "mustTakeTrickToSaveMeld", label: "Keeping meld", values: () => [true, false], text: (v) => v ? "Must take a trick" : "Always counts" },
  { k: "dealerStuck", label: "Everyone passes", values: () => [true, false], text: (v) => v ? "Dealer is stuck" : "Redeal" },
  { k: "shoot", label: "Shooting the moon", values: () => ["on", "off"], text: (v) => v === "on" ? "Allowed" : "Not allowed",
    help: (r) => r.shoot === "on" ? `After the pass the bidder may play alone: partner sits out, no meld. Take every trick for ${r.target.toLocaleString()}; miss and lose the game.` : null },
  { k: "ninesMisdeal", label: "Five nines, no meld", values: () => [true, false], text: (v) => v ? "May throw the hand in" : "Must play it",
    help: (r) => r.ninesMisdeal ? "Five or more nines and no other meld, before your first bid or pass. The same dealer redeals." : null },
  { k: "revealHands", label: "After each hand", values: () => [true, false], text: (v) => v ? "Show everyone's cards" : "Keep hands hidden" },
  { k: "pace", label: "Pace", values: () => ["live", "leisurely"], text: (v) => v === "leisurely" ? "Leisurely (a trick a day is fine)" : "Live",
    help: (r) => r.pace === "leisurely" ? "The table waits weeks for your turn." : null },
];

/** A field's select options, plus the stored value when it is not one of them, so the select never loses it. */
function optionsOf(f: typeof FIELDS[number], r: RulesConfig): Opt[] {
  const values = f.values(r);
  const all = values.some((v) => String(v) === String(r[f.k])) ? values : [...values, r[f.k]];
  return all.map((v) => [String(v), f.text(v, r)]);
}

/** Decode the select's string back into the typed rule value. */
function decode(k: Key, raw: string): RulesConfig[Key] {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (k === "scoring" || k === "counting" || k === "shoot" || k === "pace") return raw as RulesConfig[Key];
  return Number(raw) as RulesConfig[Key];
}

function Help({ text }: { text?: string | null }) {
  return text ? <p className="mt-1 text-xs leading-snug text-ink-soft">{text}</p> : null;
}

/**
 * House rules, the one way they are shown: with `onChange` an editor, without it the same grid read-only, so a
 * rule sits where it was set. Each value is the text its select shows.
 */
export function RulesForm({ value, onChange, compact = false }: { value: RulesPatch | Record<string, unknown> | undefined; onChange?: (next: RulesPatch) => void; compact?: boolean }) {
  const r = resolveRules(value);
  const grid = `grid gap-3 ${compact ? "grid-cols-1 min-[480px]:grid-cols-2" : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3"}`;
  if (!onChange) {
    return (
      <dl className={grid}>
        {FIELDS.map((f) => (
          <div key={f.k} className="min-w-0 text-sm">
            <dt className="text-ink-soft">{f.label}</dt>
            <dd className="mt-1">
              {/* As tall as the select it stands in for, so the grid lines up with the editor. */}
              <div className="flex min-h-11 items-center rounded-[10px] bg-ink/5 px-[.9rem] text-base text-ink">{f.text(r[f.k], r)}</div>
              <Help text={f.help?.(r)} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className={grid}>
      {FIELDS.map((f) => (
        <div key={f.k} className="min-w-0 text-sm text-ink-soft">
          <label className="block">
            {f.label}
            <select className="field mt-1" value={String(r[f.k])} onChange={(e) => onChange(changeRule(value as RulesPatch, f.k, decode(f.k, e.target.value)))}>
              {optionsOf(f, r).map(([v, text]) => <option key={v} value={v}>{text}</option>)}
            </select>
          </label>
          <Help text={f.help?.(r)} />
        </div>
      ))}
    </div>
  );
}
