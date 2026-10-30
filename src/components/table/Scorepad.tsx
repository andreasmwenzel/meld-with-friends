import { Fragment, useState } from "react";
import type { HandRecord, HandScoreBreakdown, PlayerView, SeatIndex, Team } from "@/engine/types";
import { SUIT_GLYPH, suitInk } from "@/components/cards/PlayingCard";
import { useCardPrefs } from "@/lib/cardPrefs";
import { teamOf } from "./types";

/** Bodoni's hyphen is a hairline at display size, so a negative score read as positive. Draw a real minus in the sans face.
 *  Below -999 the caller shrinks the type so the sign still fits the menu drawer. */
function BigScore({ n }: { n: number }) {
  if (n >= 0) return <>{n.toLocaleString()}</>;
  return <><span className="font-sans font-light" aria-hidden>−</span><span className="sr-only">minus </span>{Math.abs(n).toLocaleString()}</>;
}

/** The full scorepad: both sides' totals, this hand so far, past hands with their breakdowns, and the latest log lines. Us on the left, them on the right. */
export function Scorepad({ view, myTeam, nameOf, hideOpponentPoints = false }: { view: PlayerView; myTeam: Team; nameOf: (s: SeatIndex) => string; hideOpponentPoints?: boolean }) {
  const them: Team = myTeam === "red" ? "blue" : "red";
  const cols: Team[] = [myTeam, them];
  const four = useCardPrefs().prefs.fourColour;
  const meldFor = (t: Team) => ([0, 1, 2, 3] as SeatIndex[]).filter((s) => teamOf(s) === t).reduce((n: number, s) => n + (view.melds[s] ?? []).reduce((a, m) => a + m.points, 0), 0);
  const color = (t: Team) => (t === "red" ? "var(--deck-red)" : "var(--deck-blue)");
  const label = (t: Team) => (t === myTeam ? "Us" : "Them");
  return (
    <section aria-label="Scorepad" className="panel p-5">
      <div className="grid grid-cols-2 gap-4">
        {cols.map((t) => (
          <div key={t} className="text-center">
            <p className="text-sm font-semibold" style={{ color: color(t) }}>{label(t)}</p>
            <p className="display" style={{ fontSize: view.score[t] <= -1000 ? 34 : 44 }}>{hideOpponentPoints && t === them ? "Hidden" : <BigScore n={view.score[t]} />}</p>
            <p className="text-xs text-ink-soft">{([0, 1, 2, 3] as SeatIndex[]).filter((s) => teamOf(s) === t).map(nameOf).join(" & ")}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-ink-soft">Playing to {view.rules.target.toLocaleString()}</p>

      {view.phase !== "game_over" && (
        <div className="mt-5 border-t border-chalk-dim pt-4 text-sm">
          <Row k="Hand" v={String(view.handNumber)} />
          {view.highBid && <Row k="Bid" v={`${view.highBid.shoot ? "Shoot" : view.highBid.amount} · ${nameOf(view.highBid.seat)}`} />}
          {view.trump && <Row k="Trump" v={SUIT_GLYPH[view.trump]} ink={suitInk(view.trump, four)} />}
          <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 text-right">
            <span />
            {cols.map((t) => <span key={t} className="text-xs font-semibold" style={{ color: color(t) }}>{label(t)}</span>)}
            {view.phase !== "playing" && <>
              <span className="text-left text-ink-soft">Meld</span>
              {cols.map((t) => <span key={t}>{hideOpponentPoints && t === them ? "Hidden" : meldFor(t)}</span>)}
            </>}
            <span className="text-left text-ink-soft">Tricks</span>
            {cols.map((t) => <span key={t}>{hideOpponentPoints && t === them ? "Hidden" : view.trickCounts[t]}</span>)}
          </div>
        </div>
      )}

      {view.history.length > 0 && (
        <div className="mt-5 border-t border-chalk-dim pt-4">
          <p className="text-xs text-ink-soft mb-1">Past hands</p>
          <ul>
            {view.history.map((h, i) => (
              <PastHand key={h.handNumber} h={h} cols={cols} myTeam={myTeam} nameOf={nameOf} latestOpen={i === view.history.length - 1 && (view.phase === "hand_over" || view.phase === "game_over")} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 border-t border-chalk-dim pt-3 max-h-40 overflow-y-auto text-xs text-ink-soft leading-relaxed">
        {view.log.slice(-8).map((l, i) => <p key={i}>{l}</p>)}
      </div>
    </section>
  );
}


function Row({ k, v, ink }: { k: string; v: string; ink?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-soft">{k}</span>
      <span style={ink ? { color: ink } : undefined}>{v}</span>
    </div>
  );
}

export const BREAKDOWN_ROWS: [keyof HandScoreBreakdown, string][] = [
  ["meldDeclared", "Meld declared"],
  ["meldSaved", "Meld kept"],
  ["counters", "Counters"],
  ["lastTrick", "Last trick"],
  ["setPenalty", "Set"],
  ["shoot", "Shoot"],
];

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

function PastHand({ h, cols, myTeam, nameOf, latestOpen }: { h: HandRecord; cols: Team[]; myTeam: Team; nameOf: (s: SeatIndex) => string; latestOpen: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? latestOpen;
  const color = (t: Team) => (t === "red" ? "var(--deck-red)" : "var(--deck-blue)");
  const rows = BREAKDOWN_ROWS.filter(([k]) => cols.some((t) => (h.breakdown?.[t]?.[k] ?? 0) !== 0));
  const id = `hand-${h.handNumber}-breakdown`;
  return (
    <li className="text-sm">
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-3 text-right">
        <span className="text-ink-soft">{h.handNumber}</span>
        <span className="text-left truncate">{h.shotMade !== undefined ? "Shoot" : h.bid} {SUIT_GLYPH[h.trump]} {nameOf(h.bidder)}{h.shotMade === false ? ", missed" : h.conceded ? ", threw in" : h.wentSet ? ", set" : ""}</span>
        {cols.map((t) => <span key={t} className="tabular-nums" style={{ color: h.delta[t] < 0 ? "var(--pip-red)" : undefined }}>{signed(h.delta[t])}</span>)}
      </div>
      <button type="button" className="tap-link ml-5 text-xs text-ink-soft underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2" aria-expanded={open} aria-controls={id} onClick={() => setToggled(!open)}>
        {open ? "Hide breakdown" : "Show breakdown"}
      </button>
      {open && (
        <div id={id} className="mb-2 mt-1 ml-6 grid grid-cols-[1fr_3rem_3rem] gap-x-3 gap-y-0.5 text-xs tabular-nums text-right">
          <span />
          {cols.map((t) => <span key={t} className="font-semibold" style={{ color: color(t) }}>{t === myTeam ? "Us" : "Them"}</span>)}
          {rows.map(([k, name]) => (
            <Fragment key={k}>
              <span className="text-left text-ink-soft">{name}</span>
              {cols.map((t) => { const raw = h.breakdown?.[t]?.[k] ?? 0; const v = k === "setPenalty" ? -raw : raw; return <span key={t} style={{ color: v < 0 ? "var(--pip-red)" : undefined }}>{v === 0 ? "" : signed(v)}</span>; })}
            </Fragment>
          ))}
          <span className="col-span-3 border-t border-chalk-dim" />
          <span className="text-left font-semibold">Total</span>
          {cols.map((t) => <span key={t} className="font-semibold" style={{ color: h.delta[t] < 0 ? "var(--pip-red)" : undefined }}>{signed(h.delta[t])}</span>)}
        </div>
      )}
    </li>
  );
}
