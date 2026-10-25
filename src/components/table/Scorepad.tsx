import { Fragment, useState, useSyncExternalStore } from "react";
import type { HandRecord, HandScoreBreakdown, PlayerView, SeatIndex, Team } from "@/engine/types";
import { SUIT_GLYPH } from "@/components/cards/PlayingCard";
import { useOpponentPointsPref } from "@/lib/prefs";
import { useCardPrefs } from "@/lib/cardPrefs";
import { teamOf } from "./types";

const OPEN_KEY = "meld.scorepad.open";
const listeners = new Set<() => void>();
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
function subscribeOpen(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
function setOpen(next: boolean) {
  try { localStorage.setItem(OPEN_KEY, next ? "1" : "0"); } catch { /* storage may be blocked */ }
  listeners.forEach((l) => l());
}

/** Compact strip while a hand is being played; the full pad when the hand or game is over, or on request. */
export function Scorepad(props: { view: PlayerView; myTeam: Team; nameOf: (s: SeatIndex) => string }) {
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const { hideOpponentPoints } = useOpponentPointsPref();
  const { short } = useCardPrefs();
  const over = props.view.phase === "hand_over" || props.view.phase === "game_over";
  // Sideways on a phone the result sheet carries the full tally; the board keeps the strip.
  if (over && !(short && !open)) return <FullPad {...props} onCollapse={short ? () => setOpen(false) : undefined} />;
  if (open) return <FullPad {...props} hideOpponentPoints={hideOpponentPoints} onCollapse={() => setOpen(false)} />;
  return <Strip {...props} hideOpponentPoints={hideOpponentPoints} onExpand={() => setOpen(true)} />;
}

function Strip({ view, myTeam, nameOf, hideOpponentPoints, onExpand }: { view: PlayerView; myTeam: Team; nameOf: (s: SeatIndex) => string; hideOpponentPoints: boolean; onExpand: () => void }) {
  const them: Team = myTeam === "red" ? "blue" : "red";
  const color = (t: Team) => (t === "red" ? "var(--deck-red)" : "var(--deck-blue)");
  const meldFor = (t: Team) => ([0, 1, 2, 3] as SeatIndex[]).filter((s) => teamOf(s) === t).reduce((n: number, s) => n + (view.melds[s] ?? []).reduce((a, m) => a + m.points, 0), 0);
  const bid = view.highBid;
  const red = view.trump === "H" || view.trump === "D";
  return (
    <aside aria-label="Score" className="board-score panel order-first sticky top-0 z-10 self-start px-3.5 py-2 lg:order-none lg:top-4 short:static short:grid short:grid-cols-[minmax(0,1fr)_auto] short:items-center short:gap-x-2 short:py-1 short:pr-2.5">
      <div className="flex items-baseline justify-between gap-3 short:contents">
        <p className="text-sm font-semibold tabular-nums">
          <span style={{ color: color(myTeam) }}>Us</span> {view.score[myTeam].toLocaleString()}
          <span className="px-1.5 text-ink-soft">·</span>
          <span style={{ color: color(them) }}>Them</span> {hideOpponentPoints ? "Hidden" : view.score[them].toLocaleString()}
        </p>
        <button type="button" onClick={onExpand} aria-expanded={false} className="tap-link text-xs text-ink-soft underline underline-offset-2 hover:text-ink short:col-start-2 short:row-span-2 short:row-start-1">Scorepad</button>
      </div>
      <p className="mt-0.5 text-xs text-ink-soft tabular-nums">
        Hand {view.handNumber}
        {bid && <> · <span className="text-ink">{bid.shoot ? "Shoot" : bid.amount}</span>{view.trump && <> <span style={red ? { color: "var(--pip-red)" } : { color: "var(--ink)" }}>{SUIT_GLYPH[view.trump]}</span></>} {nameOf(bid.seat)}</>}
        {view.phase === "melding" && <> · Meld {meldFor(myTeam)}/{hideOpponentPoints ? "Hidden" : meldFor(them)}</>}
        {(view.phase === "melding" || view.phase === "playing") && <> · Tricks {view.trickCounts[myTeam]}/{hideOpponentPoints ? "Hidden" : view.trickCounts[them]}</>}
      </p>
    </aside>
  );
}

/** Bodoni's hyphen is a hairline at display size, so a negative score read as positive. Draw a real minus in the sans face.
 *  Below -999 the caller shrinks the type so the sign still fits the 280px desktop sidebar. */
function BigScore({ n }: { n: number }) {
  if (n >= 0) return <>{n.toLocaleString()}</>;
  return <><span className="font-sans font-light" aria-hidden>−</span><span className="sr-only">minus </span>{Math.abs(n).toLocaleString()}</>;
}

/** The scorepad at the corner of the table. Us on the left, them on the right. */
function FullPad({ onCollapse, ...rest }: { view: PlayerView; myTeam: Team; nameOf: (s: SeatIndex) => string; hideOpponentPoints?: boolean; onCollapse?: () => void }) {
  return <FullPadBody {...rest} onCollapse={onCollapse} />;
}

function FullPadBody({ view, myTeam, nameOf, hideOpponentPoints = false, onCollapse }: { view: PlayerView; myTeam: Team; nameOf: (s: SeatIndex) => string; hideOpponentPoints?: boolean; onCollapse?: () => void }) {
  const them: Team = myTeam === "red" ? "blue" : "red";
  const cols: Team[] = [myTeam, them];
  const meldFor = (t: Team) => ([0, 1, 2, 3] as SeatIndex[]).filter((s) => teamOf(s) === t).reduce((n: number, s) => n + (view.melds[s] ?? []).reduce((a, m) => a + m.points, 0), 0);
  const color = (t: Team) => (t === "red" ? "var(--deck-red)" : "var(--deck-blue)");
  const label = (t: Team) => (t === myTeam ? "Us" : "Them");
  return (
    <aside className={`board-pad panel self-start p-5 lg:sticky lg:top-4 ${onCollapse ? "order-first lg:order-none" : ""}`}>
      {/* Its own row: floated beside the scores it squeezed four-digit totals on phones. */}
      {onCollapse && <div className="-mr-1 -mt-3 flex justify-end"><button type="button" onClick={onCollapse} aria-expanded className="tap-link text-xs text-ink-soft underline underline-offset-2 hover:text-ink">Hide scorepad</button></div>}
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
          {view.trump && <Row k="Trump" v={SUIT_GLYPH[view.trump]} red={view.trump === "H" || view.trump === "D"} />}
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
    </aside>
  );
}


function Row({ k, v, red }: { k: string; v: string; red?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-soft">{k}</span>
      <span style={red ? { color: "var(--pip-red)" } : undefined}>{v}</span>
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
        <span className="text-left truncate">{h.shotMade !== undefined ? "Shoot" : h.bid} {SUIT_GLYPH[h.trump]} {nameOf(h.bidder)}{h.shotMade === false ? ", missed" : h.wentSet ? ", set" : ""}</span>
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
