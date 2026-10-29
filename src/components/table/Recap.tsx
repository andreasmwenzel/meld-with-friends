"use client";

import { useCallback, useEffect, useRef } from "react";
import type { CardId, PlayerView, SeatIndex, Team } from "@/engine/types";
import { sortHand } from "@/engine/hand";
import { PlayingCard, SUIT_GLYPH, SUIT_NAME, suitInk, splitCard } from "@/components/cards/PlayingCard";
import { useCardPrefs } from "@/lib/cardPrefs";
import { api } from "@/lib/api";
import { teamOf } from "./types";
import { TrickReview } from "./TrickReview";

const THREE_MINUTES = 3 * 60 * 1000;

/**
 * Tells the server how far you have read: when the tab is hidden, when you leave, and at most
 * every three minutes while you watch. Pass null to stay silent (spectators). The report also carries
 * your automatic-meld choice, so a leisurely table can meld for you while you are away; a changed
 * choice goes out at once.
 */
export function useSeenReporting(code: string, rev: number | null, send: (path: string, init: Parameters<typeof api>[1]) => Promise<unknown> = api, autoMeld?: boolean) {
  const latest = useRef<{ rev: number | null; autoMeld?: boolean }>({ rev, autoMeld });
  const sent = useRef<{ at: number; rev: number | null; autoMeld?: boolean }>({ at: 0, rev: null });
  useEffect(() => { latest.current = { rev, autoMeld }; }, [rev, autoMeld]);
  const report = useCallback((force: boolean) => {
    const { rev: r, autoMeld: a } = latest.current;
    if (r === null) return;
    const changed = a !== sent.current.autoMeld;
    if (r === sent.current.rev && !changed) return;
    if (!force && !changed && Date.now() - sent.current.at < THREE_MINUTES) return;
    sent.current = { at: Date.now(), rev: r, autoMeld: a };
    void send(`/api/tables/${code}/seen`, { body: a === undefined ? { rev: r } : { rev: r, autoMeld: a } }).catch(() => { sent.current = { at: 0, rev: null }; });
  }, [code, send]);
  // A changed choice must reach the server before meld can start without you.
  const firstChoice = useRef(autoMeld);
  useEffect(() => {
    if (autoMeld === firstChoice.current) return;
    firstChoice.current = autoMeld;
    report(true);
  }, [autoMeld, report]);
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) report(true); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onVisibility);
    const timer = setInterval(() => { if (!document.hidden) report(false); }, 30000);
    const first = setTimeout(() => { if (!document.hidden) report(false); }, 2000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
      clearInterval(timer); clearTimeout(first);
      report(true);
    };
  }, [report]);
}

const teamInk = (t: Team) => (t === "red" ? "var(--deck-red)" : "var(--deck-blue)");
const lc = (name: string) => (name === "You" ? "you" : name);

function Trump({ suit }: { suit: NonNullable<PlayerView["trump"]> }) {
  const { prefs } = useCardPrefs();
  return <span style={{ color: suitInk(suit, prefs.fourColour) }}>{SUIT_GLYPH[suit]} {SUIT_NAME[suit]}</span>;
}

function Cards({ cards, width = 26 }: { cards: CardId[]; width?: number }) {
  const { prefs } = useCardPrefs();
  return <span className="inline-flex flex-wrap gap-1 align-middle">{cards.map((c) => <PlayingCard key={c} card={c} width={width} prefs={prefs} />)}</span>;
}

/** Everything that has happened this hand, for tables that are played over days. */
export function Recap({ view, nameOf, lastSeenRev }: {
  view: PlayerView; nameOf: (s: SeatIndex) => string; lastSeenRev: number | null;
}) {
  const { prefs } = useCardPrefs();
  const r = view.recap;
  const myTeam = teamOf(view.seat);
  const them: Team = myTeam === "red" ? "blue" : "red";

  // The recap has no revisions of its own, so "new" is a hint: roughly one trick per few revisions.
  const missed = lastSeenRev === null ? 0 : Math.max(0, view.rev - lastSeenRev);
  const firstNewTrick = r.tricks.length - Math.min(missed, r.tricks.length);
  const currentNew = missed > 0 && !!r.current && r.current.plays.length > 0;
  const firstNew = missed === 0 ? null : firstNewTrick < r.tricks.length ? firstNewTrick : currentNew ? "current" : null;
  const mark = (isNew: boolean) => `border-l-2 pl-2.5 ${isNew ? "border-brass" : "border-transparent"}`;
  const away = (is: boolean) => is ? <p className="mb-0.5 text-xs font-semibold" style={{ color: "var(--brass-deep)" }}>since you were away</p> : null;

  // Bidding, told as a sentence.
  const bidText = r.bids.map((b, i) => {
    const who = i === 0 ? nameOf(b.seat) : lc(nameOf(b.seat));
    if (b.shoot) return `${who} shot the moon`;
    if (b.amount === null) return `${who} passed`;
    const opened = !r.bids.slice(0, i).some((x) => x.amount !== null);
    return `${who} ${opened ? "opened" : "raised to"} ${b.amount}`;
  });

  // A shoot after the pass replaces the contract's amount; the auction still says what was won.
  const won = view.highBid?.shoot ? Math.max(view.rules.minBid, ...r.bids.map((b) => b.amount ?? 0)) : r.bid;

  const partner = ((view.seat + 2) % 4) as SeatIndex;
  const iBid = r.bidder === view.seat, iPartner = r.bidder === partner;
  const bidderPartner = r.bidder === null ? null : (((r.bidder + 2) % 4) as SeatIndex);
  const seatsFromMe = [0, 1, 2, 3].map((n) => ((view.seat + n) % 4) as SeatIndex);

  return (
    <section className="panel p-4" aria-label="This hand so far">
      <h2 className="display" style={{ fontSize: 24 }}>Hand {r.handNumber} so far</h2>

      <div className="mt-3 space-y-4 text-[15px] leading-relaxed">
        <p>
          {bidText.length === 0 ? "Bidding has not begun." : <>{bidText.join(", ")}.</>}
          {r.bidder !== null && r.bid !== null && (r.bids.some((b) => b.shoot)
            ? r.trump && <>{" "}Trump is <Trump suit={r.trump} />.</>
            : <>{" "}{nameOf(r.bidder)} took it at {won}{r.trump && <> in <Trump suit={r.trump} /></>}{view.highBid?.shoot && <>, then shot the moon after the pass</>}.</>)}
        </p>

        {view.sittingOut != null && <p>{nameOf(view.sittingOut)} {view.sittingOut === view.seat ? "sit" : "sits"} out with cards face down. No meld is shown or scored. {view.history.find(h => h.handNumber === r.handNumber)?.shotMade === true
          ? `The shoot was made for ${view.rules.target} points.`
          : view.history.find(h => h.handNumber === r.handNumber)?.shotMade === false ? "The shoot missed; the shooting side loses the game." : "The declarer must win every trick alone."}</p>}

        {r.passing.count > 0 && r.bidder !== null && (
          <p>
            {iBid || iPartner ? (
              <>
                {r.myPassedOut.length === 0 && r.myPassedIn.length === 0 && <>Passing is under way.</>}
                {iPartner && r.myPassedOut.length > 0 && <>You sent {nameOf(r.bidder)}: <Cards cards={sortHand(r.myPassedOut, r.trump, prefs.sort)} />. </>}
                {iPartner && r.myPassedIn.length > 0 && <>{nameOf(r.bidder)} sent back: <Cards cards={sortHand(r.myPassedIn, r.trump, prefs.sort)} />.</>}
                {iBid && r.myPassedIn.length > 0 && <>{nameOf(partner)} sent you: <Cards cards={sortHand(r.myPassedIn, r.trump, prefs.sort)} />. </>}
                {iBid && r.myPassedOut.length > 0 && <>You sent back: <Cards cards={sortHand(r.myPassedOut, r.trump, prefs.sort)} />.</>}
              </>
            ) : (
              <>{nameOf(r.bidder)} and {lc(nameOf(bidderPartner!))} {r.passing.done ? "passed" : "are passing"} {r.passing.count} cards each way.</>
            )}
          </p>
        )}

        {Object.values(r.melds).some((m) => m.items.length > 0) && (
          <div>
            <p className="text-sm font-semibold">Meld</p>
            <ul className="mt-1 space-y-1.5">
              {seatsFromMe.filter((s) => r.melds[s].items.length > 0).map((s) => (
                <li key={s} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span><span className="font-semibold" style={{ color: teamInk(teamOf(s)) }}>{nameOf(s)}</span> {r.melds[s].points}</span>
                  <Cards cards={sortHand([...new Set(r.melds[s].items.flatMap((m) => m.cards))], r.trump, prefs.sort)} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {view.claim && (
          <div>
            <p>{nameOf(view.claim.seat)} claimed the rest from trick {view.claim.fromTrick}. Remaining hands:</p>
            <ul className="mt-1 space-y-2">
              {seatsFromMe.map(seat => <li key={seat} className="flex flex-wrap items-center gap-2">
                <span>{nameOf(seat)}</span><Cards cards={sortHand(view.claim!.hands[seat], view.trump, prefs.sort)} />
              </li>)}
            </ul>
          </div>
        )}

        {(r.tricks.length > 0 || r.current) && (
          <div>
            <p className="text-sm font-semibold">Tricks</p>
            <TrickReview key={r.handNumber} tricks={r.tricks} trump={r.trump} seat={view.seat} nameOf={nameOf} />
            <ol className="mt-1 space-y-2">
              {r.tricks.map((t, i) => (
                <li key={t.index} className={mark(firstNew !== null && firstNew !== "current" && i >= firstNewTrick)}>
                  {away(firstNew === i)}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="w-5 text-right text-ink-soft tabular-nums">{t.index}</span>
                    <span className="inline-flex gap-1">
                      {t.plays.map((p) => (
                        <span key={p.card} className="flex flex-col items-center gap-0.5" title={`${nameOf(p.seat)}${p.seat === t.leader ? ", led" : ""}`}>
                          <PlayingCard card={p.card} width={30} prefs={prefs} trump={splitCard(p.card).suit === r.trump} selected={p.seat === t.winner} />
                          <span className="h-0.5 w-5 rounded" style={{ background: p.seat === t.leader ? "var(--brass)" : "transparent" }} />
                        </span>
                      ))}
                    </span>
                    <span className="text-sm">
                      {view.claim && t.index >= view.claim.fromTrick ? "Claimed: " : <>{nameOf(t.leader)} led, </>}<span className="font-semibold" style={{ color: teamInk(teamOf(t.winner)) }}>{nameOf(t.winner)}</span> took it{t.counters > 0 ? `, ${t.counters}` : ""}
                    </span>
                  </div>
                </li>
              ))}
              {r.current && r.current.plays.length > 0 && (
                <li className={mark(firstNew === "current")}>
                  {away(firstNew === "current")}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="w-5 text-right text-ink-soft tabular-nums">{r.tricks.length + 1}</span>
                    <span className="inline-flex gap-1">
                      {r.current.plays.map((p) => (
                        <span key={p.card} className="flex flex-col items-center gap-0.5" title={nameOf(p.seat)}>
                          <PlayingCard card={p.card} width={30} prefs={prefs} trump={splitCard(p.card).suit === r.trump} />
                          <span className="h-0.5 w-5 rounded" style={{ background: p.seat === r.current!.leader ? "var(--brass)" : "transparent" }} />
                        </span>
                      ))}
                    </span>
                    <span className="text-sm text-ink-soft">{nameOf(r.current.leader)} led, still being played</span>
                  </div>
                </li>
              )}
            </ol>
          </div>
        )}

        {r.tricks.length > 0 && (
          <p className="text-sm text-ink-soft">
            Tricks <span style={{ color: teamInk(myTeam) }}>us {r.trickCounts[myTeam]}</span>, <span style={{ color: teamInk(them) }}>them {r.trickCounts[them]}</span>
            {view.sittingOut == null && <>{" · "}counters <span style={{ color: teamInk(myTeam) }}>us {r.counters[myTeam]}</span>, <span style={{ color: teamInk(them) }}>them {r.counters[them]}</span></>}
          </p>
        )}
      </div>
    </section>
  );
}
