"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlayerView, SeatIndex, Team } from "@/engine/types";
import { SUIT_GLYPH } from "@/components/cards/PlayingCard";
import { teamOf } from "./types";
import { BREAKDOWN_ROWS } from "./Scorepad";
import { NextHandCountdown } from "./NextHandCountdown";

export type ReadyInfo = { me: boolean; all: boolean; readyNames: string[]; waitingNames: string[]; post: () => void };
export type Which = "atPlay" | "dealt";

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const teamColor = (t: Team) => (t === "red" ? "var(--deck-red)" : "var(--deck-blue)");

/** Hand result headline from the last history record. */
function headline(view: PlayerView, nameOf: (s: SeatIndex) => string) {
  const h = view.history.at(-1);
  if (!h) return "Hand over.";
  const who = nameOf(h.bidder) === "You" ? "You" : nameOf(h.bidder);
  const verb = (a: string, b: string) => (who === "You" ? a : b);
  if (h.shotMade !== undefined) return h.shotMade ? `${who} ${verb("shot", "shot")} the moon.` : `${who} ${verb("missed", "missed")} the moon.`;
  return h.wentSet ? `${who} went set on ${h.bid}.` : `${who} made ${h.bid}${verb("", "")} in ${SUIT_GLYPH[h.trump]}.`;
}

/** Bottom sheet (phones) or centred card (desktop) over the table once a hand ends. */
export function ResultSheet({ view, nameOf, host, busy, onNext, onRematch, readyInfo, which, setWhich, peek, setPeek, countdown, local = false }: {
  local?: boolean;
  view: PlayerView; nameOf: (s: SeatIndex) => string; host: string | null; busy: boolean;
  onNext: () => void; onRematch: () => void; readyInfo: ReadyInfo | null;
  which: Which; setWhich: (w: Which) => void; peek: boolean; setPeek: (p: boolean) => void;
  countdown: { handKey: string; blocked: boolean; onNext: (signal: AbortSignal) => void };
}) {
  const [showBreakdown, setShowBreakdown] = useState(true);
  // The peek bar floats over the page; pad the page by its height so nothing (like the scorepad) is stuck under it.
  useEffect(() => {
    if (!peek) return;
    const before = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "4.5rem";
    return () => { document.body.style.paddingBottom = before; };
  }, [peek]);
  const over = view.phase === "game_over";
  const myTeam = teamOf(view.seat);
  const them: Team = myTeam === "red" ? "blue" : "red";
  const cols: Team[] = [myTeam, them];
  const h = view.history.at(-1);
  const rows = h ? BREAKDOWN_ROWS.filter(([k]) => cols.some((t) => (h.breakdown?.[t]?.[k] ?? 0) !== 0)) : [];
  const passing = view.rules.passCount > 0 && !!view.revealed;
  const won = view.winner === myTeam;
  const title = over ? (won ? "You and your partner win." : `${view.winner === "red" ? "Red" : "Blue"} team wins.`) : headline(view, nameOf);

  const toggle = passing && (
    <div className="flex gap-1 text-xs" role="group" aria-label="Which cards to show">
      {([["atPlay", "After passing"], ["dealt", "As dealt"]] as const).map(([w, label]) => (
        <button key={w} type="button" aria-pressed={which === w} onClick={() => setWhich(w)}
          className={`rounded-full px-2.5 py-1 ${which === w ? "bg-ink text-chalk" : "bg-chalk/90 text-ink"}`}>{label}</button>
      ))}
    </div>
  );

  if (peek) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-center gap-2 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 sm:bottom-4">
        {toggle}
        <button type="button" className="btn btn-brass btn-compact" style={{ height: "2.25rem" }} onClick={() => setPeek(false)}>
          Back to the result
        </button>
      </div>
    );
  }

  const next = !local && host !== null && readyInfo && !readyInfo.all
    ? (readyInfo.me
      ? <span className="text-sm text-ink-soft">Waiting for the others.</span>
      : <button className="btn btn-brass" disabled={busy} onClick={readyInfo.post}>Ready for the next hand</button>)
    : <button className="btn btn-brass" disabled={busy} onClick={onNext}>Deal the next hand</button>;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/55 sm:items-center sm:p-6">
      <section role="dialog" aria-label={over ? "Game result" : "Hand result"}
        className="panel max-h-[78dvh] w-full max-w-md overflow-y-auto rounded-b-none short:max-h-[calc(100dvh-1rem)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:rounded-b-[inherit] sm:p-5">
        <p className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>{title}</p>
        {over && <p className="mt-1 text-sm tabular-nums text-ink-soft">
          Final: <span style={{ color: teamColor(myTeam) }}>Us {view.score[myTeam].toLocaleString()}</span>, <span style={{ color: teamColor(them) }}>Them {view.score[them].toLocaleString()}</span>
        </p>}
        {h && (
          <div className="mt-3">
            <button type="button" aria-expanded={showBreakdown} onClick={() => setShowBreakdown((o) => !o)}
              className="flex w-full items-baseline justify-between text-sm">
              <span className="font-semibold">Hand {h.handNumber}: {h.shotMade !== undefined ? "shoot" : h.bid} {SUIT_GLYPH[h.trump]}</span>
              <span className="text-xs text-ink-soft underline underline-offset-2">{showBreakdown ? "Hide breakdown" : "Show breakdown"}</span>
            </button>
            {showBreakdown && (
              <div className="mt-1.5 grid grid-cols-[1fr_3.5rem_3.5rem] gap-x-3 gap-y-0.5 text-xs tabular-nums text-right">
                <span />
                {cols.map((t) => <span key={t} className="font-semibold" style={{ color: teamColor(t) }}>{t === myTeam ? "Us" : "Them"}</span>)}
                {rows.map(([k, name]) => (
                  <div key={k} className="contents">
                    <span className="text-left text-ink-soft">{name}</span>
                    {cols.map((t) => { const raw = h.breakdown?.[t]?.[k] ?? 0; const v = k === "setPenalty" ? -raw : raw; return <span key={t} style={{ color: v < 0 ? "var(--pip-red)" : undefined }}>{v === 0 ? "" : signed(v)}</span>; })}
                  </div>
                ))}
                <span className="col-span-3 border-t border-chalk-dim" />
                <span className="text-left font-semibold">Hand total</span>
                {cols.map((t) => <span key={t} className="font-semibold" style={{ color: h.delta[t] < 0 ? "var(--pip-red)" : undefined }}>{signed(h.delta[t])}</span>)}
                <span className="text-left text-ink-soft">Game score</span>
                {cols.map((t) => <span key={t}>{view.score[t].toLocaleString()}</span>)}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {over ? (
            <>
              {host === null
                ? <button className="btn btn-brass" disabled={busy} onClick={onRematch}>Play again</button>
                : <span className="text-sm text-ink-soft">Waiting for {host} to deal again.</span>}
              <Link href="/home" className={host === null ? "text-sm text-ink-soft underline hover:text-ink" : "btn btn-ink"}>Back to your tables</Link>
            </>
          ) : view.legal.canAdvanceHand ? next : <span className="text-sm text-ink-soft">Waiting for the next deal.</span>}
        </div>
        {!over && !local && host === null && <NextHandCountdown
          handKey={countdown.handKey} allowed={view.legal.canAdvanceHand && !busy && !countdown.blocked}
          allReady={readyInfo?.all ?? true} onNext={countdown.onNext} />}
        {!over && !local && readyInfo && (
          <p className="mt-2 text-center text-xs text-ink-soft">
            {readyInfo.all ? "Everyone is ready." : <>Ready: {readyInfo.readyNames.join(", ") || "no one yet"}. Still looking: {readyInfo.waitingNames.join(", ")}.</>}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-chalk-dim pt-3">
          <button type="button" className="text-sm font-semibold underline underline-offset-2" onClick={() => setPeek(true)}>
            Look at the table
          </button>
          {toggle}
        </div>
      </section>
    </div>
  );
}
