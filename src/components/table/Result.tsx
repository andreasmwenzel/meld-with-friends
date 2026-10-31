"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  if (h.conceded) return `${who} threw in at ${h.bid} and went set.`;
  return h.wentSet ? `${who} went set on ${h.bid}.` : `${who} made ${h.bid}${verb("", "")} in ${SUIT_GLYPH[h.trump]}.`;
}

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]";
const LIVE = "[data-announcer]";

/** Makes everything on the page but `el` (and the table's live region, so moves are still heard) inert.
 *  Returns the undo. Elements that were inert already are left as they were. */
function isolate(el: HTMLElement) {
  const touched: Element[] = [];
  const walk = (parent: Element) => {
    for (const child of parent.children) {
      if (child === el || child.matches(LIVE)) continue;
      if (child.contains(el) || child.querySelector(LIVE)) walk(child);
      else if (!child.hasAttribute("inert")) { child.setAttribute("inert", ""); touched.push(child); }
    }
  };
  walk(document.body);
  return () => touched.forEach((child) => child.removeAttribute("inert"));
}

/** While `active`: the rest of the page is out of reach, Tab wraps inside `el`, Escape runs `onEscape`, the page holds still. */
function useModal(ref: React.RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  const escape = useRef(onEscape);
  useEffect(() => { escape.current = onEscape; });
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const restore = isolate(el);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") { e.preventDefault(); escape.current(); return; }
      if (e.key !== "Tab") return;
      const stops = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((s) => s.tabIndex >= 0 && !(s as HTMLButtonElement).disabled && !s.closest("[inert], [hidden]"));
      if (!stops.length) { e.preventDefault(); el.focus(); return; }
      const at = document.activeElement as HTMLElement | null;
      const inside = !!at && el.contains(at) && at !== el;
      if (e.shiftKey && (!inside || at === stops[0])) { e.preventDefault(); stops.at(-1)!.focus(); }
      else if (!e.shiftKey && (!inside || at === stops.at(-1))) { e.preventDefault(); stops[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      restore();
    };
  }, [ref, active]);
}

/** Bottom sheet (phones) or centred card (desktop) over the table once a hand ends. */
export function ResultSheet({ view, nameOf, host, busy, onNext, onRematch, readyInfo, which, setWhich, peek, setPeek, countdown, local = false, replayHref = null, talk }: {
  local?: boolean;
  /** table talk's button, which sits on the sheet while it is up (the board behind is out of reach) */
  talk?: ReactNode;
  /** where to step through every hand of this game, once a hand is complete */
  replayHref?: string | null;
  view: PlayerView; nameOf: (s: SeatIndex) => string; host: string | null; busy: boolean;
  onNext: () => void; onRematch: () => void; readyInfo: ReadyInfo | null;
  which: Which; setWhich: (w: Which) => void; peek: boolean; setPeek: (p: boolean) => void;
  countdown: { handKey: string; blocked: boolean; onNext: (signal: AbortSignal) => void };
}) {
  const [showBreakdown, setShowBreakdown] = useState(true);
  const over = view.phase === "game_over";
  const titleId = useId();
  const sheet = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const look = useRef<HTMLButtonElement>(null);
  const wasPeek = useRef(peek);
  // Focus follows the sheet: into it when it opens (the board behind goes inert), to "Back to the result"
  // while looking at the table, and to "Look at the table" on the way back.
  useEffect(() => {
    if (peek) back.current?.focus();
    else (wasPeek.current ? look.current : sheet.current)?.focus();
    wasPeek.current = peek;
  }, [peek]);
  // A button that goes away under focus ("Ready for the next hand") leaves it on the sheet, not the page.
  useEffect(() => { if (!peek && (!document.activeElement || document.activeElement === document.body)) sheet.current?.focus(); });
  // Modal while it is up; looking at the table lets go, and Escape is the way to look.
  useModal(sheet, !peek, () => setPeek(true));
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
        <button key={w} type="button" data-overlay="peek" data-reveal={w} aria-pressed={which === w} onClick={() => setWhich(w)}
          className={`hit rounded-full px-2.5 py-1 ${which === w ? "bg-ink text-chalk" : "bg-chalk/90 text-ink"}`}>{label}</button>
      ))}
    </div>
  );

  if (peek) {
    return (
      // Along the bottom, under your hand; on a phone held sideways, in the action column above table talk's button.
      // Under table talk (z-[25] in Game.tsx), so its popover opens over these buttons.
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-x-2 gap-y-4 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 sm:bottom-4
        short:left-auto short:right-[max(.75rem,env(safe-area-inset-right))] short:w-[clamp(15.5rem,33vw,18rem)] short:justify-end short:px-0 short:pb-0 short:bottom-[calc(max(.375rem,env(safe-area-inset-bottom))+3.5rem)]!">
        {toggle}
        <button ref={back} type="button" data-overlay="peek" data-action="back-to-result" className="hit btn btn-brass btn-compact" style={{ height: "2.25rem" }} onClick={() => setPeek(false)}>
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
      <section ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="panel outline-none max-h-[78dvh] w-full max-w-md overflow-y-auto rounded-b-none short:max-h-[calc(100dvh-1rem)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:rounded-b-[inherit] sm:p-5">
        <p id={titleId} className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>{title}</p>
        {view.claim && <p className="mt-1 text-sm text-ink-soft">{nameOf(view.claim.seat)} {nameOf(view.claim.seat) === "You" ? "claim" : "claims"} the rest. {13 - view.claim.fromTrick} remaining tricks.</p>}
        {h?.conceded && <p className="mt-1 text-sm text-ink-soft">Thrown in before the first lead: the defenders keep their meld, and nobody takes counters.</p>}
        {h?.sittingOut != null && <p className="mt-2 text-sm text-ink-soft">
          {headline(view, nameOf)} {h.shotMade ? `Every trick taken alone adds ${view.rules.target} points.` : "The first lost trick ends the game; the shooting side loses."} {nameOf(h.sittingOut)} sat out. No meld or counters count.
        </p>}
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
              <Link href="/" className={host === null ? "text-sm text-ink-soft underline hover:text-ink" : "btn btn-ink"}>Back to your tables</Link>
              {replayHref && <Link href={replayHref} className="text-sm text-ink-soft underline hover:text-ink">Review every hand</Link>}
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
          <button ref={look} type="button" data-action="look-at-table" className="text-sm font-semibold underline underline-offset-2" onClick={() => setPeek(true)}>
            Look at the table
          </button>
          {toggle}
          {talk}
        </div>
      </section>
    </div>
  );
}
