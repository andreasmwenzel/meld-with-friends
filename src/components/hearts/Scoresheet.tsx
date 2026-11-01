import type { HeartsView, Penalties, SeatIndex } from "@/engine/hearts/types";

const ALL_SEATS: SeatIndex[] = [0, 1, 2, 3];

/**
 * What a player is sitting on this hand, as the cards themselves: a heart pip per heart taken, the queen as a
 * black Q♠, the jack as a red J♦. Reads at a glance under every name, so nobody has to count.
 */
export function Ledger({ taken, compact = false }: { taken: Penalties; compact?: boolean }) {
  if (!taken.hearts && !taken.queen && !taken.jack) return <span className={`text-ink-soft ${compact ? "text-[11px]" : "text-xs"}`}>clean</span>;
  const label = `${taken.hearts} ${taken.hearts === 1 ? "heart" : "hearts"}${taken.queen ? ", the queen of spades" : ""}${taken.jack ? ", the jack of diamonds" : ""}: ${taken.points} points`;
  const size = compact ? 11 : 13;
  // Up to five hearts are laid out as pips; more than that is a count, so the plate never grows past the name.
  const pips = taken.hearts <= 5 ? taken.hearts : 0;
  return (
    <span aria-label={label} className="inline-flex items-center gap-px leading-none" style={{ fontSize: size }}>
      {Array.from({ length: pips }, (_, i) => <span key={i} aria-hidden style={{ color: "var(--pip-red)", marginLeft: i ? -1 : 0 }}>♥</span>)}
      {pips === 0 && taken.hearts > 0 && <span aria-hidden className="tabular-nums font-semibold" style={{ color: "var(--pip-red)" }}>{taken.hearts}♥</span>}
      {taken.queen && <span aria-hidden className="ml-1 rounded-[3px] bg-ink px-1 font-semibold text-chalk" style={{ fontSize: size - 1, lineHeight: 1.4 }}>Q♠</span>}
      {taken.jack && <span aria-hidden className="ml-1 rounded-[3px] px-1 font-semibold text-chalk" style={{ fontSize: size - 1, lineHeight: 1.4, background: "var(--pip-red)" }}>J♦</span>}
    </span>
  );
}

/** The scoresheet as a hearts table keeps it: a column per player, a row per hand, the running total underneath. */
export function Scoresheet({ view, nameOf, bare = false }: { view: HeartsView; nameOf: (s: SeatIndex) => string; bare?: boolean }) {
  const lowest = Math.min(...ALL_SEATS.map((s) => view.score[s]));
  const body = (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-xs text-ink-soft">
          <th scope="col" className="pb-1 text-left font-normal">Hand</th>
          {ALL_SEATS.map((s) => <th key={s} scope="col" className="max-w-[5rem] truncate pb-1 text-right font-normal">{nameOf(s)}</th>)}
        </tr>
      </thead>
      <tbody>
        {view.history.map((h) => (
          <tr key={h.handNumber} className="border-t border-chalk-dim">
            <th scope="row" className="py-1 text-left font-normal text-ink-soft">{h.handNumber}{h.moon !== null && <span className="ml-1" title={`${nameOf(h.moon)} shot the moon`}>☾</span>}</th>
            {ALL_SEATS.map((s) => <td key={s} className="py-1 text-right" style={{ color: h.delta[s] < 0 ? "var(--pip-green)" : h.delta[s] >= 13 ? "var(--pip-red)" : undefined }}>{h.delta[s]}</td>)}
          </tr>
        ))}
        {view.history.length === 0 && <tr className="border-t border-chalk-dim"><td colSpan={5} className="py-2 text-center text-xs text-ink-soft">No hand scored yet.</td></tr>}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-ink/30 font-semibold">
          <th scope="row" className="pt-1 text-left font-normal text-ink-soft">Total</th>
          {ALL_SEATS.map((s) => <td key={s} className="pt-1 text-right" style={view.score[s] === lowest && view.history.length ? { color: "var(--brass-deep)" } : undefined}>{view.score[s]}</td>)}
        </tr>
      </tfoot>
    </table>
  );
  if (bare) return body;
  return (
    <section aria-label="Scoresheet" className="panel p-4">
      <p className="text-xs text-ink-soft">Playing to {view.rules.target}. Lowest score wins.</p>
      <div className="mt-2">{body}</div>
    </section>
  );
}
