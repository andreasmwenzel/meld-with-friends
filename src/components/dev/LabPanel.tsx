"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildDeck, cardLabel, sortHand, type CardId, type GameState, type Phase, type SeatIndex, type Suit } from "@/engine";
import { checkState, SEATS, type ScenarioSpec, type ScenarioTarget } from "@/engine/scenario";
import { resolveRules, changeScoring } from "@/components/rules/rules";
import { PRESETS, presetById } from "@/engine/scenarios";
import { describeAction, encodeSpec, labStore, parseImport, type LabSnapshot } from "./labStore";

const NAMES = ["South", "West", "North", "East"] as const;
const SHORT = ["S", "W", "N", "E"] as const;
const TABS = ["Positions", "Build", "Timeline", "State"] as const;
type Tab = (typeof TABS)[number];
const PHASE_LABEL: Record<Phase, string> = {
  dealing: "Dealing", bidding: "Bidding", declaring_trump: "Naming trump", passing_to_bidder: "Passing to bidder",
  passing_back: "Passing back", deciding_shoot: "Shoot or play", melding: "Melding", playing: "Trick play", hand_over: "Hand over", game_over: "Game over",
};
const SUIT_INK: Record<Suit, string> = { S: "text-pip-black", H: "text-pip-red", D: "text-pip-red", C: "text-pip-black" };

const btn = "rounded-md border border-ink/15 bg-white/60 px-2.5 py-1.5 text-[13px] font-medium text-ink hover:bg-white active:translate-y-px disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brass-deep";
const on = "border-brass-deep bg-brass/30 hover:bg-brass/40";
const field = "w-full rounded-md border border-ink/15 bg-white/70 px-2 py-1 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-brass-deep";

export function LabPanel({ snap, state }: { snap: LabSnapshot; state: GameState }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Positions");
  const problems = useMemo(() => checkState(state), [state]);
  const turn = state.phase === "melding" ? "everyone" : state.turn === null ? "nobody" : NAMES[state.turn];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open the dev lab"
        className="fixed bottom-3 right-3 z-[60] rounded-full bg-brass px-3 py-1.5 text-[12px] font-semibold text-ink shadow-[var(--shadow-card)] lg:hidden">
        Lab{problems.length ? <span className="ml-1.5 rounded-full bg-pip-red px-1.5 text-chalk">{problems.length}</span> : null}
      </button>
      <aside aria-label="Dev lab"
        className={`fixed inset-x-0 bottom-0 z-[70] flex max-h-[78vh] flex-col overflow-y-auto lg:overflow-hidden rounded-t-[var(--radius-panel)] bg-chalk text-ink shadow-[0_-12px_40px_-8px_rgba(0,0,0,.55)] transition-transform lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[360px] lg:translate-y-0 lg:rounded-none ${open ? "translate-y-0" : "translate-y-[110%]"}`}>
        <header className="flex items-baseline gap-2 border-b border-ink/10 px-4 pb-2 pt-3">
          <h2 className="font-display text-[22px] leading-none">Lab</h2>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">{sourceLabel(snap)}</span>
          <button type="button" className="text-[13px] text-ink-soft underline lg:hidden" onClick={() => setOpen(false)}>Close</button>
        </header>

        <div className="space-y-2 border-b border-ink/10 px-4 py-2.5">
          <p className="text-[13px]">
            <b>{PHASE_LABEL[state.phase]}</b>, hand {state.handNumber}, {turn} to act
            <span className="text-ink-soft"> · rev {state.rev}</span>
          </p>
          <div className="grid grid-cols-[3.2rem_1fr] items-center gap-x-2 gap-y-1.5 text-[12px] text-ink-soft">
            <span>View as</span>
            <div className="flex gap-1">
              {SEATS.map(seat => (
                <button key={seat} type="button" className={`${btn} flex-1 px-0 ${snap.view === seat ? on : ""}`} aria-pressed={snap.view === seat}
                  onClick={() => labStore.setView(seat)} title={NAMES[seat]}>{NAMES[seat]}</button>
              ))}
            </div>
            <span>Bots</span>
            <div className="flex gap-1">
              {SEATS.map(seat => (
                <button key={seat} type="button" disabled={seat === snap.view} aria-pressed={snap.bots.includes(seat)}
                  className={`${btn} flex-1 px-0 ${snap.bots.includes(seat) ? on : ""}`} onClick={() => labStore.toggleBot(seat)}>
                  {snap.bots.includes(seat) ? `${SHORT[seat]} bot` : seat === snap.view ? "you" : `${SHORT[seat]} hand`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} onClick={labStore.undo} disabled={snap.cursor === 0} title="Undo ( [ )">Undo</button>
            <button type="button" className={btn} onClick={labStore.redo} disabled={snap.cursor === snap.actions.length} title="Redo ( ] )">Redo</button>
            <button type="button" className={`${btn} ${snap.running ? on : ""}`} onClick={() => labStore.setRunning(!snap.running)} title="Pause or run bots ( \\ )">
              {snap.running ? "Bots running" : "Bots paused"}
            </button>
            <button type="button" className={btn} onClick={() => labStore.step()} title="Play one move for whoever is on turn ( . )">Step</button>
            <select aria-label="Bot speed" className={`${field} w-auto`} value={snap.speed} onChange={e => labStore.setSpeed(Number(e.target.value))}>
              <option value={60}>Instant</option><option value={300}>Quick</option><option value={700}>Table</option><option value={1600}>Slow</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} onClick={() => { const n = tricksDone(labStore.state); labStore.fastForward(s => tricksDone(s) > n || s.phase !== "playing"); }}
              disabled={state.phase !== "playing"}>Finish trick</button>
            <button type="button" className={btn} onClick={() => labStore.fastForward(s => s.phase === "hand_over" || s.phase === "game_over")}
              disabled={state.phase === "hand_over" || state.phase === "game_over"}>Finish hand</button>
            <button type="button" className={btn} onClick={() => { const h = labStore.state.handNumber; labStore.fastForward(s => s.handNumber > h || s.phase === "game_over"); }}
              disabled={state.phase === "game_over"}>Next hand</button>
          </div>
          {snap.error && <Alert onDismiss={() => labStore.clearError()}>{snap.error}</Alert>}
          {snap.notes.map(n => <p key={n} className="text-[12px] text-ink-soft">{n}</p>)}
          {problems.length > 0 && <Alert>{problems.length === 1 ? "1 invariant broken: " : `${problems.length} invariants broken: `}{problems[0]}</Alert>}
        </div>

        <nav className="flex border-b border-ink/10 px-2" role="tablist">
          {TABS.map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`flex-1 border-b-2 px-1 py-2 text-[13px] ${tab === t ? "border-brass-deep font-semibold" : "border-transparent text-ink-soft"}`}>{t}</button>
          ))}
        </nav>
        <div className="px-4 py-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {tab === "Positions" && <Positions snap={snap} />}
          {tab === "Build" && <Build snap={snap} />}
          {tab === "Timeline" && <Timeline snap={snap} />}
          {tab === "State" && <StateTab snap={snap} state={state} problems={problems} />}
        </div>
      </aside>
    </>
  );
}

const tricksDone = (s: GameState) => s.tricksTaken.red.length + s.tricksTaken.blue.length;

function sourceLabel(s: LabSnapshot) {
  if (s.source.kind === "preset") return presetById(s.source.id)?.title ?? s.source.id;
  if (s.source.kind === "import") return `Imported: ${s.source.name}`;
  return "Built position";
}

function Alert({ children, onDismiss }: { children: React.ReactNode; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-pip-red/40 bg-pip-red/10 px-2.5 py-1.5 text-[12px] text-ink">
      <span className="flex-1">{children}</span>
      {onDismiss && <button type="button" className="text-ink-soft underline" onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}

function Positions({ snap }: { snap: LabSnapshot }) {
  const groups = [...new Set(PRESETS.map(p => p.group))];
  const current = snap.source.kind === "preset" ? snap.source.id : null;
  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group}>
          <h3 className="mb-1 font-display text-[16px]">{group}</h3>
          <ul className="divide-y divide-ink/10">
            {PRESETS.filter(p => p.group === group).map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => labStore.loadPreset(p.id)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left hover:bg-white/70 ${current === p.id ? "bg-brass/25" : ""}`}>
                  <span className="text-[13px] font-semibold">{p.title}</span>
                  <span className="block text-[12px] leading-snug text-ink-soft">{p.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ---------- Build ---------- */

const TARGETS: ScenarioTarget[] = ["bidding", "declaring_trump", "passing_to_bidder", "passing_back", "deciding_shoot", "melding", "playing", "hand_over", "game_over"];

function startingSpec(snap: LabSnapshot): ScenarioSpec {
  if (snap.source.kind === "spec") return snap.source.spec;
  if (snap.source.kind === "preset") return presetById(snap.source.id)?.spec ?? {};
  return {};
}

function Build({ snap }: { snap: LabSnapshot }) {
  const [spec, setSpec] = useState<ScenarioSpec>(() => structuredClone(startingSpec(snap)));
  const [copied, setCopied] = useState(false);
  const rules = resolveRules(spec.rules);
  const set = (patch: Partial<ScenarioSpec>) => setSpec(s => ({ ...s, ...patch }));
  const setRules = (patch: Partial<NonNullable<ScenarioSpec["rules"]>>) => setSpec(s => ({ ...s, rules: { ...resolveRules(s.rules), ...patch } }));
  const setScoring = (scoring: "modern" | "classic", oldStyle = false) => setSpec(s => {
    const current = resolveRules(s.rules);
    const next = changeScoring(current, scoring);
    const factor = current.scoring === scoring ? 1 : scoring === "modern" ? 0.1 : 10;
    const bid = (amount: number) => Math.max(next.minBid, Math.ceil(amount * factor / next.bidStep) * next.bidStep);
    return {
      ...s,
      rules: { ...next, ...(oldStyle ? { counting: "classic" as const } : {}) },
      bid: s.bid === undefined ? undefined : bid(s.bid),
      bids: s.bids?.map(amount => typeof amount === "number" ? bid(amount) : amount),
      score: s.score && Object.fromEntries(Object.entries(s.score).map(([team, amount]) => [team, Math.round(amount * factor)])),
    };
  });
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const to = spec.to ?? "bidding";
  const past = (p: ScenarioTarget) => TARGETS.indexOf(to) > TARGETS.indexOf(p);

  const link = () => {
    const url = `${location.origin}/dev/lab?spec=${encodeSpec(spec)}`;
    void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <form className="space-y-3 text-[12px]" onSubmit={e => { e.preventDefault(); labStore.loadSpec(spec); }}>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Stop at" span={2}>
          <select className={field} value={to} onChange={e => set({ to: e.target.value as ScenarioTarget })}>
            {TARGETS.map(t => <option key={t} value={t}>{PHASE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Dealer"><SeatSelect value={spec.dealer} onChange={v => set({ dealer: v })} /></Field>
        <Field label="Hand no."><input className={field} type="number" min={1} value={spec.handNumber ?? ""} onChange={e => set({ handNumber: num(e.target.value) })} /></Field>
        <Field label="Red score"><input className={field} type="number" step={10} value={spec.score?.red ?? ""} onChange={e => set({ score: { ...spec.score, red: num(e.target.value) } })} /></Field>
        <Field label="Blue score"><input className={field} type="number" step={10} value={spec.score?.blue ?? ""} onChange={e => set({ score: { ...spec.score, blue: num(e.target.value) } })} /></Field>
        <Field label="Seed" span={3}><input className={field} value={spec.seed ?? ""} placeholder="lab" onChange={e => set({ seed: e.target.value || undefined })} /></Field>
      </div>

      {past("bidding") && (
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="mb-1 font-display text-[15px]">Contract</legend>
          <Field label="Bidder"><SeatSelect value={spec.bidder} onChange={v => set({ bidder: v, bids: undefined })} allowBot /></Field>
          <Field label="Bid"><input className={field} type="number" step={rules.bidStep} value={spec.bid ?? ""} onChange={e => set({ bid: num(e.target.value) })} /></Field>
          <Field label="Trump">
            <select className={field} value={spec.trump ?? ""} onChange={e => set({ trump: (e.target.value || undefined) as Suit | undefined })}>
              <option value="">Bot picks</option><option value="S">♠ Spades</option><option value="H">♥ Hearts</option><option value="D">♦ Diamonds</option><option value="C">♣ Clubs</option>
            </select>
          </Field>
          <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={!!spec.shoot} onChange={e => set({ shoot: e.target.checked || undefined, rules: { ...rules, shoot: e.target.checked && (rules.shoot ?? "off") === "off" ? "on" : rules.shoot } })} /> Bidder shoots the moon</label>
        </fieldset>
      )}
      {to === "bidding" && (
        <Field label={`Auction so far (from the dealer's left: ${rules.minBid}, pass)`} span={3}>
          <input className={field} value={(spec.bids ?? []).map(b => (b === null ? "pass" : b)).join(", ")} placeholder={`${rules.minBid}, pass, ${rules.minBid + rules.bidStep}`}
            onChange={e => set({ bids: e.target.value.split(",").map(x => x.trim()).filter(Boolean).map(x => (x === "pass" ? null : x === "shoot" ? "shoot" : Number(x))) })} />
        </Field>
      )}
      {to === "melding" && (
        <Field label="Already confirmed" span={3}>
          <div className="flex gap-1">{SEATS.map(s => {
            const sel = spec.confirmed?.includes(s);
            return <button key={s} type="button" className={`${btn} flex-1 ${sel ? on : ""}`} aria-pressed={sel}
              onClick={() => set({ confirmed: sel ? spec.confirmed!.filter(x => x !== s) : [...(spec.confirmed ?? []), s] })}>{NAMES[s]}</button>;
          })}</div>
        </Field>
      )}
      {to === "playing" && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Tricks done"><input className={field} type="number" min={0} max={11} value={spec.tricks ?? ""} onChange={e => set({ tricks: num(e.target.value) })} /></Field>
          <Field label="Then to"><SeatSelect value={spec.turn} onChange={v => set({ turn: v })} allowBot botLabel="Leader" /></Field>
          <Field label="Cards down"><input className={field} type="number" min={0} max={3} value={spec.plays ?? ""} onChange={e => set({ plays: num(e.target.value) })} /></Field>
          <Field label="Scripted plays, in order (AC 9C JC)" span={3}>
            <input className={field} value={(spec.play ?? []).join(" ")} onChange={e => set({ play: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
          </Field>
        </div>
      )}

      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="mb-1 font-display text-[15px]">Rules</legend>
        <Field label="Scoring"><select className={field} value={rules.scoring} onChange={e => setScoring(e.target.value as "modern" | "classic")}><option value="modern">Modern</option><option value="classic">Classic ×10</option></select></Field>
        <Field label="Target"><input className={field} type="number" step={rules.scoring === "modern" ? 5 : 50} value={rules.target} onChange={e => setRules({ target: num(e.target.value) })} /></Field>
        <Field label="Min bid"><input className={field} type="number" step={rules.bidStep} value={rules.minBid} onChange={e => setRules({ minBid: num(e.target.value) })} /></Field>
        <Field label="Pass"><input className={field} type="number" min={0} max={12} value={rules.passCount ?? ""} placeholder="4" onChange={e => setRules({ passCount: num(e.target.value) })} /></Field>
        <Field label="Shoot">
          <select className={field} value={rules.shoot ?? "off"} onChange={e => setRules({ shoot: e.target.value as "off" | "on" })}>
            <option value="off">Off</option><option value="on">On</option>
          </select>
        </Field>
        <Field label="Counting">
          <select className={field} value={rules.counting ?? "tens"} onChange={e => e.target.value === "classic" ? setScoring("classic", true) : setRules({ counting: "tens" })}>
            <option value="tens">Aces, tens, kings: {rules.counterValue}</option><option value="classic">Old-style 11 / 10 / 4 / 3 / 2</option>
          </select>
        </Field>
        <Field label="Pace">
          <select className={field} value={rules.pace ?? "live"} onChange={e => setRules({ pace: e.target.value as "live" | "leisurely" })}>
            <option value="live">Live</option><option value="leisurely">Leisurely</option>
          </select>
        </Field>
        <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={rules.dealerStuck ?? true} onChange={e => setRules({ dealerStuck: e.target.checked })} /> Dealer stuck when everyone passes</label>
        <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={rules.ninesMisdeal ?? true} onChange={e => setRules({ ninesMisdeal: e.target.checked })} /> Five nines and no meld may throw the hand in</label>
        <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={rules.mustTakeTrickToSaveMeld ?? true} onChange={e => setRules({ mustTakeTrickToSaveMeld: e.target.checked })} /> Take a trick to save meld</label>
      </fieldset>

      <DealGrid hands={spec.hands ?? {}} onChange={hands => set({ hands })} />

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-ink/10 bg-chalk px-4 py-2">
        <button type="submit" className={`${btn} ${on} flex-1`}>Build position</button>
        <button type="button" className={btn} onClick={link}>{copied ? "Link copied" : "Copy link"}</button>
        <button type="button" className={btn} onClick={() => setSpec({})}>Clear</button>
      </div>
    </form>
  );
}

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: 1 | 2 | 3 }) {
  return (
    <label className={`flex flex-col gap-0.5 text-ink-soft ${span === 3 ? "col-span-3" : span === 2 ? "col-span-2" : ""}`}>
      <span>{label}</span>{children}
    </label>
  );
}

function SeatSelect({ value, onChange, allowBot, botLabel = "Bot picks" }: { value?: SeatIndex; onChange: (v?: SeatIndex) => void; allowBot?: boolean; botLabel?: string }) {
  return (
    <select className={field} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? undefined : (Number(e.target.value) as SeatIndex))}>
      <option value="">{allowBot ? botLabel : "Default"}</option>
      {SEATS.map(s => <option key={s} value={s}>{NAMES[s]}</option>)}
    </select>
  );
}

const SEAT_TINT = ["bg-deck-red/80 text-chalk", "bg-deck-blue/80 text-chalk", "bg-deck-red-soft text-ink", "bg-deck-blue-soft text-ink"];

/** Tap a card to cycle who is dealt it: nobody (random), South, West, North, East. */
function DealGrid({ hands, onChange }: { hands: NonNullable<ScenarioSpec["hands"]>; onChange: (h: NonNullable<ScenarioSpec["hands"]>) => void }) {
  const owner = new Map<CardId, SeatIndex>();
  for (const seat of SEATS) for (const id of hands[seat] ?? []) if (/^[ATKQJ9][SHDC][01]$/.test(id)) owner.set(id as CardId, seat);
  const counts = SEATS.map(s => (hands[s] ?? []).length);
  const cycle = (card: CardId) => {
    const current = owner.get(card);
    const next = current === undefined ? 0 : current === 3 ? undefined : ((current + 1) as SeatIndex);
    const out: NonNullable<ScenarioSpec["hands"]> = {};
    for (const seat of SEATS) {
      const list = (hands[seat] ?? []).filter(c => c !== card);
      if (seat === next) list.push(card);
      if (list.length) out[seat] = list;
    }
    onChange(out);
  };
  const deck = buildDeck();
  return (
    <fieldset>
      <legend className="mb-1 font-display text-[15px]">Deal</legend>
      <p className="mb-1.5 text-ink-soft">Tap a card to give it to a seat. Untouched cards are dealt at random.</p>
      <div className="mb-1.5 flex gap-1">
        {SEATS.map(s => <span key={s} className={`flex-1 rounded px-1 py-0.5 text-center ${SEAT_TINT[s]} ${counts[s] > 12 ? "outline-2 outline-pip-red" : ""}`}>{NAMES[s]} {counts[s]}/12</span>)}
      </div>
      <div className="grid grid-cols-12 gap-0.5">
        {deck.map(card => {
          const o = owner.get(card);
          return (
            <button key={card} type="button" onClick={() => cycle(card)} aria-label={`${cardLabel(card)} copy ${Number(card[2]) + 1}: ${o === undefined ? "random" : NAMES[o]}`}
              className={`rounded-sm border border-ink/10 py-1 text-center text-[11px] font-semibold leading-none ${o === undefined ? `bg-white ${SUIT_INK[card[1] as Suit]}` : SEAT_TINT[o]}`}>
              {cardLabel(card)}
            </button>
          );
        })}
      </div>
      <button type="button" className={`${btn} mt-1.5`} onClick={() => onChange({})}>Clear deal</button>
    </fieldset>
  );
}

/* ---------- Timeline ---------- */

function Timeline({ snap }: { snap: LabSnapshot }) {
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => { current.current?.scrollIntoView({ block: "nearest" }); }, [snap.cursor]);
  const states = labStore.allStates;
  return (
    <ol className="text-[13px]">
      <TimelineRow index={0} active={snap.cursor === 0} refEl={snap.cursor === 0 ? current : undefined} label="Deal" />
      {snap.actions.map((a, i) => {
        const before = states[i];
        const newHand = i > 0 && states[i].handNumber !== states[i - 1].handNumber;
        return (
          <TimelineRow key={i} index={i + 1} active={snap.cursor === i + 1} future={i + 1 > snap.cursor} refEl={snap.cursor === i + 1 ? current : undefined}
            label={describeAction(a)} divider={newHand ? `Hand ${before.handNumber}` : undefined} />
        );
      })}
    </ol>
  );
}

function TimelineRow({ index, label, active, future, divider, refEl }: { index: number; label: string; active: boolean; future?: boolean; divider?: string; refEl?: React.Ref<HTMLLIElement> }) {
  return (
    <li ref={refEl}>
      {divider && <p className="mt-2 border-t border-ink/15 pt-1 font-display text-[14px]">{divider}</p>}
      <button type="button" onClick={() => labStore.goto(index)}
        className={`flex w-full gap-2 rounded px-1.5 py-0.5 text-left hover:bg-white/70 ${active ? "bg-brass/30 font-semibold" : ""} ${future ? "text-ink-soft/60" : ""}`}>
        <span className="w-7 shrink-0 text-right tabular-nums text-ink-soft">{index}</span>{label}
      </button>
    </li>
  );
}

/* ---------- State ---------- */

function StateTab({ snap, state, problems }: { snap: LabSnapshot; state: GameState; problems: string[] }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => fetch("/dev/states").then(r => r.json()).then((d: { names: string[] }) => setSaved(d.names)).catch(() => setSaved([]));
  useEffect(() => { void refresh(); }, []);
  const exportData = () => JSON.stringify({ base: snap.base, actions: snap.actions.slice(0, snap.cursor) }, null, 1);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2000); };
  const doImport = (raw: string, label: string) => {
    try {
      const parsed = parseImport(JSON.parse(raw));
      labStore.load(parsed.base, parsed.actions, { kind: "import", name: label }, { notes: [parsed.note] });
      flash(parsed.note);
    } catch (e) { flash(`Import failed: ${(e as Error).message}`); }
  };
  const save = async () => {
    const res = await fetch("/dev/states", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, data: JSON.parse(exportData()) }) });
    flash(res.ok ? `Saved as ${name}; open with /dev/lab?state=${name}` : `Save failed: ${(await res.json()).error}`);
    void refresh();
  };
  const load = async (n: string) => doImport(await (await fetch(`/dev/states?name=${encodeURIComponent(n)}`)).text(), n);

  return (
    <div className="space-y-4 text-[12px]">
      <section>
        <h3 className="mb-1 font-display text-[16px]">Hands</h3>
        <dl className="space-y-1">
          {state.players.map(p => (
            <div key={p.seat} className="grid grid-cols-[3.5rem_1fr] gap-1">
              <dt className="text-ink-soft">{NAMES[p.seat]}{state.bidder === p.seat ? " ★" : ""}</dt>
              <dd className="flex flex-wrap gap-x-1.5 font-semibold">
                {sortHand(p.hand, state.trump).map(c => <span key={c} className={SUIT_INK[c[1] as Suit]}>{cardLabel(c)}</span>)}
                {!p.hand.length && <span className="font-normal text-ink-soft">empty</span>}
                {p.meldPoints > 0 && <span className="font-normal text-ink-soft">meld {p.meldPoints}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-ink-soft">Score red {state.score.red}, blue {state.score.blue}{state.highBid ? `; bid ${state.highBid.amount}${state.highBid.shoot ? " (shoot)" : ""}` : ""}{state.trump ? `, trump ${state.trump}` : ""}</p>
      </section>

      <section>
        <h3 className="mb-1 font-display text-[16px]">Invariants</h3>
        {problems.length ? <ul className="list-disc space-y-0.5 pl-4 text-pip-red">{problems.map(p => <li key={p}>{p}</li>)}</ul> : <p className="text-ink-soft">All hold.</p>}
      </section>

      <section className="space-y-1">
        <h3 className="mb-1 font-display text-[16px]">Table conditions</h3>
        <Toggle label="Connection reconnecting" checked={snap.flags.reconnecting} onChange={v => labStore.setFlags({ reconnecting: v })} />
        <Toggle label="Table paused by host" checked={snap.flags.paused} onChange={v => labStore.setFlags({ paused: v })} />
        <Toggle label="Everyone ready for the next hand" checked={snap.flags.ready.length === 4} onChange={v => labStore.setFlags({ ready: v ? [0, 1, 2, 3] : [] })} />
        <Toggle label="Practice board (no ready or countdown)" checked={snap.flags.local} onChange={v => labStore.setFlags({ local: v })} />
      </section>

      <section className="space-y-1.5">
        <h3 className="font-display text-[16px]">Save and share</h3>
        <div className="flex gap-1">
          <input className={field} value={name} onChange={e => setName(e.target.value.replace(/[^\w-]/g, ""))} placeholder="name, e.g. bug-142" />
          <button type="button" className={btn} disabled={!name} onClick={() => void save()}>Save</button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(exportData()).then(() => flash("Copied base and actions"))}>Copy JSON</button>
          <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(JSON.stringify(state, null, 1)).then(() => flash("Copied the current GameState"))}>Copy state only</button>
        </div>
        {saved && saved.length > 0 && (
          <ul className="flex flex-wrap gap-1">{saved.map(n => <li key={n}><button type="button" className={btn} onClick={() => void load(n)}>{n}</button></li>)}</ul>
        )}
        {saved?.length === 0 && <p className="text-ink-soft">No saved states yet. Saves go to .dev/states, and scripts/pull-game.mjs writes production games there.</p>}
      </section>

      <section className="space-y-1.5">
        <h3 className="font-display text-[16px]">Import</h3>
        <textarea className={`${field} h-20 font-mono text-[11px]`} value={text} onChange={e => setText(e.target.value)} placeholder="Paste a GameState, { state, actions } or { base, actions }" />
        <button type="button" className={btn} disabled={!text.trim()} onClick={() => doImport(text, "pasted")}>Load pasted JSON</button>
      </section>
      {msg && <p role="status" className="sticky bottom-0 rounded-md bg-ink px-2 py-1.5 text-chalk">{msg}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}</label>;
}
