"use client";

import { DEFAULT_HEARTS_RULES, type HeartsRules } from "@/engine/hearts/types";

type Key = keyof HeartsRules;
type Value = HeartsRules[Key];

/** Hearts house rules, in the same grid as pinochle's: a label, a select, a line of help where one word cannot say it. */
const FIELDS: { k: Key; label: string; values: Value[]; text: (v: Value) => string; help?: (r: HeartsRules) => string | null }[] = [
  { k: "target", label: "Play to", values: [50, 75, 100, 150, 200], text: (v) => `${v} points` ,
    help: () => "The game ends when someone reaches it. Lowest score wins." },
  { k: "passing", label: "Passing", values: ["rotate", "none"], text: (v) => v === "rotate" ? "Left, right, across, hold" : "No passing" },
  { k: "moon", label: "Shooting the moon", values: ["add", "subtract"], text: (v) => v === "add" ? "Everyone else takes 26" : "Shooter drops 26" },
  { k: "jackOfDiamonds", label: "Jack of diamonds", values: [false, true], text: (v) => v ? "Worth −10" : "Just a card" },
  { k: "noPointsFirstTrick", label: "First trick", values: [true, false], text: (v) => v ? "No points on it" : "Anything goes" },
  { k: "pace", label: "Pace", values: ["live", "leisurely"], text: (v) => v === "leisurely" ? "Leisurely (a trick a day is fine)" : "Live",
    help: (r) => r.pace === "leisurely" ? "The table waits weeks for your turn." : null },
];

/** The rules as the game will use them, with anything missing or unknown filled from the defaults. */
export function resolveHeartsRulesPatch(value: unknown): HeartsRules {
  const v = (value ?? {}) as Partial<HeartsRules>;
  const r = { ...DEFAULT_HEARTS_RULES };
  for (const f of FIELDS) {
    const given = v[f.k];
    if (f.values.some((x) => x === given)) (r as Record<Key, Value>)[f.k] = given as Value;
  }
  return r;
}

function decode(k: Key, raw: string): Value {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return k === "target" ? Number(raw) : raw as Value;
}

function Help({ text }: { text?: string | null }) {
  return text ? <p className="mt-1 text-xs leading-snug text-ink-soft">{text}</p> : null;
}

export function HeartsRulesForm({ value, onChange, compact = false }: { value: unknown; onChange?: (next: HeartsRules) => void; compact?: boolean }) {
  const r = resolveHeartsRulesPatch(value);
  const grid = `grid gap-3 ${compact ? "grid-cols-1 min-[480px]:grid-cols-2" : "grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3"}`;
  if (!onChange) {
    return (
      <dl className={grid}>
        {FIELDS.map((f) => (
          <div key={f.k} className="min-w-0 text-sm">
            <dt className="text-ink-soft">{f.label}</dt>
            <dd className="mt-1">
              <div className="flex min-h-11 items-center rounded-[10px] bg-ink/5 px-[.9rem] text-base text-ink">{f.text(r[f.k])}</div>
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
            <select className="field mt-1" value={String(r[f.k])} onChange={(e) => onChange({ ...r, [f.k]: decode(f.k, e.target.value) })}>
              {f.values.map((v) => <option key={String(v)} value={String(v)}>{f.text(v)}</option>)}
            </select>
          </label>
          <Help text={f.help?.(r)} />
        </div>
      ))}
    </div>
  );
}
