"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { api, ApiError, isTransientError, type Profile } from "@/lib/api";
import { ViewSync, type GameFeed } from "@/components/table/viewSync";
import type { HeartsAction, HeartsCardId, HeartsTrick, HeartsView, PassDirection, SeatIndex } from "@/engine/hearts/types";
import { sortHeartsHand } from "@/engine/hearts/deck";
import { PlayingCard, CardBack, cardName, SUIT_NAME } from "@/components/cards/PlayingCard";
import { newLogLines, speakLine } from "@/components/table/announce";
import { parseHeartsCard } from "@/engine/hearts/deck";
import { Avatar } from "@/components/site/Avatar";
import { SEAT_LABEL, type Snapshot } from "@/components/table/types";
import { PlayerMenu, type SeatActions, type SeatPerson } from "@/components/table/PlayerMenu";
import { useTablemates } from "@/components/table/tablemates";
import { Popover } from "@/components/site/Popover";
import { CodeHand, Dealing, DeadEnd, EmptySeat } from "@/components/site/TableScene";
import { ChatDock, type TableChat } from "@/components/table/ChatDock";
import { LookOptions } from "@/components/table/LookDock";
import { HeartsRulesForm } from "@/components/rules/HeartsRulesForm";
import { useSeenReporting } from "@/components/table/Recap";
import { useCardPrefs } from "@/lib/cardPrefs";
import { motionTimings, flyFrom, sweepTo } from "@/components/table/motion";
import type { CardId } from "@/engine/types";
import { Scoresheet, Ledger } from "./Scoresheet";

type ClientAction = HeartsAction extends infer A ? (A extends HeartsAction ? Omit<A, "seat"> : never) : never;
type Rel = 0 | 1 | 2 | 3;
type View = HeartsView & { ready?: SeatIndex[]; build?: string };

/** A board without a server (the dev board): the view and the moves come from here instead of the table's API. */
export interface LocalHearts {
  fetchView: () => Promise<View>;
  act: (action: HeartsAction) => Promise<View>;
  /** let the computer players move; resolves once they have */
  tick: () => Promise<void>;
}

const ALL_SEATS: SeatIndex[] = [0, 1, 2, 3];
const DIRECTION: Record<PassDirection, string> = { left: "to the left", right: "to the right", across: "across the table", hold: "nowhere" };
/** Why the playable cards are what they are, said to the player on turn. */
function reasonLine(view: HeartsView): string {
  const led = view.currentTrick?.plays[0]?.card;
  switch (view.legal.playReason) {
    case "lead_two_clubs": return view.pass === "hold" && view.handNumber > 1 ? "No passing this hand. The two of clubs leads." : "The two of clubs leads.";
    case "follow_suit": return led ? `Follow suit: ${SUIT_NAME[parseHeartsCard(led).suit]}.` : "Follow suit.";
    case "hearts_not_broken": return "Hearts aren't broken. Lead another suit.";
    case "no_points_first_trick": return "No points on the first trick.";
    case "lead_any": return "Your lead.";
    default: return "Play any card.";
  }
}
function listNames(list: string[]) {
  return list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
/** What the screen reader hears when it becomes your move. */
function yourTurnLine(view: HeartsView): string | null {
  if (view.phase === "passing" && view.legal.mustPassCount !== null) return `Your turn. Choose three cards to pass ${DIRECTION[view.pass]}`;
  if (view.phase === "playing" && view.turn === view.seat) return `Your turn. ${reasonLine(view)}`;
  if (view.phase === "hand_over") return "Hand over";
  return null;
}
const LIFT_PX = 14;

/**
 * The hearts table: three opponents round the trick, your hand along the bottom, and under every name the
 * cards that player is sitting on this hand. The hand ends on a chalk scoresheet; a moon gets its own moment.
 */
export function HeartsBoard({ code, me, snap, onTableChange, connection = "ok", guest = false, rev, feed, chat, local }: {
  code: string; me: Profile; snap: Snapshot; onTableChange: () => void; connection?: "ok" | "reconnecting"; guest?: boolean;
  /** boards without a channel reload whenever this changes */
  rev?: number;
  feed?: GameFeed;
  chat?: TableChat;
  local?: LocalHearts;
}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unseated, setUnseated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [selected, setSelected] = useState<HeartsCardId[]>([]);
  const [armed, setArmed] = useState<HeartsCardId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkDraft, setTalkDraft] = useState("");
  const { prefs, width: cardWidth, phone, short, look } = useCardPrefs();
  const trickWidth = short ? 44 : phone ? 56 : 76;
  const motion = prefs.motion;
  const { holdMs, sweepMs, slideMs } = motionTimings(motion);

  const fetchView = useCallback(() => local ? local.fetchView() : api<View>(`/api/tables/${code}/view`), [code, local]);
  const [sync] = useState(() => new ViewSync<View>({
    fetchView,
    apply: (next) => { setView(next); setDegraded(false); },
    onError: (e) => {
      if (isTransientError(e)) setDegraded(true);
      else {
        setUnseated(e instanceof ApiError && (e.data as { code?: string } | undefined)?.code === "not_seated");
        setError(e instanceof ApiError && e.status === 404 ? "No table has this code." : (e as Error).message);
      }
    },
  }));
  const load = useCallback(() => sync.load(), [sync]);
  useEffect(() => { sync.start(); return () => sync.dispose(); }, [sync]);
  useEffect(() => { void load(); }, [load, rev]);
  // Hearts moves never travel in the broadcast: every game event fetches the view once.
  useEffect(() => feed?.subscribe((event) => { if (event.type === "game") sync.event(event.rev); else sync.handle(event); }), [feed, sync]);
  const tableEnding = view?.phase === "game_over" && snap.table.status === "playing";
  useEffect(() => { if (tableEnding) onTableChange(); }, [tableEnding, onTableChange]);
  const sendSeen = useCallback((path: string, init: Parameters<typeof api>[1]) => local ? Promise.resolve() : api(path, init), [local]);
  useSeenReporting(code, snap.mySeat !== null && view && !local ? view.rev : null, sendSeen);

  async function act(action: ClientAction): Promise<View | null> {
    if (!view || busy) return null;
    const request = sync.begin();
    const full = { ...action, seat: view.seat } as HeartsAction;
    const body = { action: full, expectedRev: view.rev, requestId: crypto.randomUUID() };
    setBusy(true); setError(null);
    return sync.act(async () => {
      try {
        const next = local ? await local.act(full) : await api<View>(`/api/tables/${code}/act`, { body });
        sync.accept(next, request); setSelected([]); setArmed(null);
        return next;
      } catch (e) {
        if (!sync.current(request)) return null;
        if (e instanceof ApiError && e.status === 409 && e.data && typeof (e.data as View).rev === "number") {
          sync.accept(e.data as View, request); setSelected([]);
          return e.data as View;
        } else if (isTransientError(e)) setDegraded(true);
        else setError((e as Error).message);
        return null;
      } finally { setBusy(false); }
    });
  }

  const nameOf = useCallback((seat: SeatIndex) => {
    const s = snap.seats.find((x) => x.seat === seat);
    if (s?.user_id === me.id) return "You";
    return s?.profile?.display_name ?? s?.bot ?? SEAT_LABEL[seat];
  }, [snap.seats, me.id]);
  const isBot = useCallback((seat: SeatIndex | null) => seat !== null && !!snap.seats.find((x) => x.seat === seat)?.bot, [snap.seats]);
  const seatedIds = snap.seats.map((x) => x.user_id ?? "").join(",");
  const { mates, refresh: refreshMates, addFriend, acceptFriend } = useTablemates(code, !!local || guest, seatedIds);

  // Computer players: a tick asks the server to move them, a card at a time, once the table has had a moment to look.
  const botTurn = !!view && view.phase !== "hand_over" && view.phase !== "game_over"
    && (view.phase === "passing" ? snap.seats.some((x) => x.bot && !view.passed[x.seat]) : isBot(view.turn));
  const firstHuman = snap.seats.find((x) => x.user_id)?.user_id;
  const leader = firstHuman === me.id || !!local;
  const [pace, setPace] = useState(900);
  const live = !!feed && connection === "ok";
  useEffect(() => {
    if (!botTurn || !view) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const delay = (view.phase === "playing" ? pace : 500) + (leader ? 0 : 2500);
    const run = async () => {
      let nextDelay = delay;
      try {
        if (local) { await local.tick(); if (!cancelled) await load(); }
        else {
          const r = await api<{ acted: boolean; rev: number; delayMs?: number }>(`/api/tables/${code}/tick`, { body: {} });
          if (cancelled) return;
          if (typeof r.delayMs === "number") setPace(r.delayMs);
          if (r.acted || r.rev > sync.rev) { if (live) sync.expect(r.rev, 2000); else await load(); }
        }
      } catch {
        if (cancelled) return;
        setDegraded(true);
        nextDelay = Math.min(10000, delay * 2);
      }
      if (!cancelled) timer = setTimeout(run, nextDelay);
    };
    timer = setTimeout(run, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [botTurn, view, code, load, sync, live, leader, pace, local]);

  // A finished trick rests on the cloth a moment, then sweeps to the player who took it. The hold is keyed by the
  // trick, not the view object, so a resync or another player's move neither restarts nor cancels it; a hold that
  // ends while the hand is over still lets the result through afterwards.
  const [shown, setShown] = useState<{ trick: HeartsTrick; sweeping: boolean } | null>(null);
  const holdKey = useRef<string | null>(null);
  const holding = !!shown;
  const last = view?.lastTrick ?? null;
  const trickKey = view ? `${view.handNumber}:${last?.plays.map((p) => p.card).join(",") ?? ""}` : null;
  const trickComplete = !!last && last.winner != null && last.plays.length === 4;
  useLayoutEffect(() => {
    if (trickKey === null) return;
    // Arriving at the table (or a new hand being dealt from one) shows the board as it stands, with no replay of the old trick.
    if (holdKey.current === null || !trickComplete) { holdKey.current = trickKey; setShown(null); return; }
    if (trickKey === holdKey.current) return;
    holdKey.current = trickKey;
    const trick = last!;
    setShown({ trick, sweeping: false });
    const sweep = setTimeout(() => setShown({ trick, sweeping: true }), holdMs);
    const done = setTimeout(() => setShown(null), holdMs + sweepMs);
    return () => { clearTimeout(sweep); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `last` is captured by trickKey; timings are fixed per preference
  }, [trickKey, trickComplete, holdMs, sweepMs]);

  // A selection only means something for the hand it was made in, and only for cards still in the hand: a new hand
  // or phase clears it, and a card that left the hand (played from another tab) drops out of it.
  const handKey = view ? `${view.handNumber}:${view.phase}` : null;
  const [selectedFor, setSelectedFor] = useState(handKey);
  if (handKey !== selectedFor) { setSelectedFor(handKey); setSelected([]); setArmed(null); }
  if (view && selected.some((c) => !view.hand.includes(c))) setSelected(selected.filter((c) => view.hand.includes(c)));
  if (view && armed && !view.hand.includes(armed)) setArmed(null);
  // Spoken for screen readers: the log lines since the last view, and your turn when it comes.
  const spokenPrev = useRef<{ log: string[]; turn: string | null } | null>(null);
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    if (!view) return;
    const before = spokenPrev.current;
    const turn = yourTurnLine(view);
    spokenPrev.current = { log: view.log, turn };
    if (!before) return;
    const parts = newLogLines(before.log, view.log).map((l) => speakLine(l, nameOf));
    if (turn && turn !== before.turn) parts.push(turn);
    if (parts.length) setSpoken((t) => `${parts.map((p) => p.replace(/\.$/, "")).join(". ")}.${t.endsWith(" ") ? "" : " "}`);
  }, [view, nameOf]);

  async function postReady() {
    if (local) return;
    setError(null);
    try {
      await sync.act(async () => { await api(`/api/tables/${code}/ready`, { body: {} }); sync.invalidate(); });
    } catch (e) { setError((e as Error).message); }
  }
  async function rematch() {
    if (local) return;
    setBusy(true); setError(null);
    try { await api(`/api/tables/${code}/rematch`, { body: {} }); onTableChange(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function standIn(seat: SeatIndex, name: string) {
    if (local || !window.confirm(`Hand ${name}'s chair to a computer? The game continues without them.`)) return;
    setError(null);
    try { await api(`/api/tables/${code}/standin`, { body: { seat } }); onTableChange(); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  if (error && !view) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar code={code} />
        {unseated
          ? <DeadEnd art={<EmptySeat />} title="This game is full." actions={<Link href="/" className="btn btn-chalk">Back to your tables</Link>}>
              Four players are seated, and only they can see the cards.
            </DeadEnd>
          : <DeadEnd art={<CodeHand code={code} />} title={error} actions={<Link href="/" className="btn btn-chalk">Back to your tables</Link>} />}
      </div>
    );
  }
  if (!view) return <div className="flex flex-1 flex-col"><TopBar code={code} /><Dealing label="Dealing." /></div>;

  const mySeat = view.seat;
  const rel = (seat: SeatIndex): Rel => (((seat - mySeat + 4) % 4) as Rel);
  const seatAt = (r: Rel): SeatIndex => (((mySeat + r) % 4) as SeatIndex);
  const hand = sortHeartsHand(view.hand);
  const passing = view.phase === "passing" && view.legal.mustPassCount !== null;
  const myTurn = view.turn === mySeat && view.phase === "playing" && !holding;
  const playable = new Set(myTurn ? view.legal.playableCards : []);
  const received = new Set(view.received);
  // The hand's last trick finishes its hold before the result takes the table.
  const over = (view.phase === "hand_over" || view.phase === "game_over") && !holding;
  const lastHand = view.history[view.history.length - 1];
  const moon = over && lastHand?.moon != null ? lastHand.moon : null;
  const readySeats = view.ready ?? [];
  const isHost = snap.table.host === me.id;
  const humansWaiting = snap.seats.filter((s) => s.user_id && s.user_id !== snap.table.host && !readySeats.includes(s.seat));
  const trick = shown?.trick ?? view.currentTrick;
  const reconnecting = connection !== "ok" || degraded;

  function tapCard(card: HeartsCardId) {
    if (busy) return;
    if (passing) {
      setSelected((s) => s.includes(card) ? s.filter((c) => c !== card) : s.length < 3 ? [...s, card] : s);
      return;
    }
    if (!myTurn || !playable.has(card)) return;
    if (prefs.confirmPlay && armed !== card) { setArmed(card); return; }
    void act({ type: "play_card", card });
  }

  const person = (seat: SeatIndex): SeatPerson => {
    const s = snap.seats.find((x) => x.seat === seat);
    return { name: nameOf(seat), handle: s?.profile?.handle ?? null, userId: s?.user_id ?? null, bot: !!s?.bot, place: SEAT_LABEL[seat] };
  };
  const actionsFor = (seat: SeatIndex): SeatActions => {
    const s = snap.seats.find((x) => x.seat === seat);
    const uid = s?.user_id ?? null;
    return {
      friend: uid && !local && !guest && mates?.[uid] && mates[uid] !== "friend" ? { status: mates[uid], add: () => addFriend(uid), accept: () => acceptFriend(uid) } : undefined,
      standIn: isHost && uid && !local && view.phase !== "game_over" ? { run: () => void standIn(seat, nameOf(seat)) } : undefined,
      refresh: refreshMates,
    };
  };

  const status = (() => {
    if (snap.paused) return `Paused by ${snap.paused.name}.`;
    if (view.phase === "passing") {
      if (passing) return selected.length === 3 ? `Pass these three ${DIRECTION[view.pass]}.` : `Choose three cards to pass ${DIRECTION[view.pass]}.`;
      const waiting = ALL_SEATS.filter((s) => !view.passed[s] && s !== mySeat).map(nameOf);
      return `Waiting on ${listNames(waiting)} to pass.`;
    }
    if (holding && shown) return `${nameOf(shown.trick.winner!)} ${shown.trick.winner === mySeat ? "take" : "takes"} the trick.`;
    if (view.phase === "playing") {
      if (myTurn) return reasonLine(view);
      return view.turn !== null ? `${nameOf(view.turn)} to play.` : "";
    }
    // The panel in the middle names the hand and the winner; the line under your seat says what it did to the scores.
    if (moon !== null && lastHand) return view.rules.moon === "add" ? "Everyone else scores 26." : `${nameOf(moon)} ${moon === mySeat ? "score" : "scores"} −26.`;
    if (view.phase === "hand_over") return "Hand over.";
    return view.winner !== null ? `${view.score[view.winner]} points. Lowest score wins.` : "Game over.";
  })();

  const seatBlock = (r: Rel, className: string) => {
    const seat = seatAt(r);
    const n = view.handCounts[seat];
    const vertical = r === 1 || r === 3;
    return (
      <div className={`${className} flex min-w-0 flex-col items-center gap-1`}>
        <SeatPlate seat={seat} view={view} person={person(seat)} actions={actionsFor(seat)} active={view.turn === seat && view.phase === "playing"}
          align={r === 1 ? "left" : r === 3 ? "right" : "center"} passed={view.phase === "passing" && view.passed[seat]} compact={phone} />
        {!over && <div className={r === 2 ? "short:hidden" : ""}><Backs n={n} vertical={vertical} /></div>}
      </div>
    );
  };

  const score = <Scoresheet view={view} nameOf={nameOf} />;
  const menu = (
    <Popover label="Table menu" place="left-0 top-full mt-2 w-[min(92vw,22rem)]" buttonClassName="btn btn-ghost btn-compact hit"
      button={<span className="flex items-center gap-2"><span className="code text-chalk" style={{ fontSize: 15, letterSpacing: ".1em" }}>{code}</span><span className="text-chalk-faint">Menu</span></span>}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-chalk-faint">Hearts table <span className="code text-chalk" style={{ fontSize: 16, letterSpacing: ".1em" }}>{code}</span></p>
          <Link href="/" className="tap-link text-chalk-faint underline underline-offset-4 hover:text-chalk">Your tables</Link>
        </div>
        {score}
        <div className="max-h-32 overflow-y-auto text-xs leading-relaxed text-chalk-faint">
          {view.log.slice(-8).map((l, i) => <p key={i}>{speakLine(l, nameOf)}</p>)}
        </div>
        <details>
          <summary className="cursor-pointer text-chalk-faint hover:text-chalk">House rules</summary>
          <div className="panel mt-2 p-3"><HeartsRulesForm value={view.rules} compact /></div>
        </details>
        <details>
          <summary className="cursor-pointer text-chalk-faint hover:text-chalk">Table look</summary>
          <div className="panel mt-2 p-3"><LookOptions team="red" /></div>
        </details>
      </div>
    </Popover>
  );

  return (
    <div className="relative mx-auto flex h-full w-full max-w-5xl flex-1 flex-col px-3 pt-2 sm:px-6" data-motion={motion} data-back={look.back}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        {menu}
        <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-center text-sm text-chalk-faint">{reconnecting ? "Reconnecting…" : ""}</p>
        <p className="shrink-0 text-sm text-chalk-faint">Hand {view.handNumber}</p>
      </div>
      {error && <p className="mt-2 text-center text-sm text-deck-red-soft">{error}</p>}

      {/* Upright: the table, then your seat and what to do, then your hand. A phone held sideways puts your seat and the
          prompt in a column to the right of the table, so the table keeps its height. */}
      <div className="flex min-h-0 flex-1 flex-col short:flex-row short:items-stretch short:gap-4">
        {/* the table: north across, west and east either side, the trick in the middle. It hugs its contents and sits in the
            middle of whatever room the screen leaves, so a tall phone and a wide desktop both keep the seats close to the trick. */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <div className={`grid w-full max-w-[640px] items-center gap-x-2 gap-y-2 sm:gap-x-6 sm:gap-y-3 short:gap-y-2 ${over ? "grid-cols-3 grid-rows-[auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto]"}`}>
            {seatBlock(2, "col-start-2 row-start-1 justify-self-center")}
            {seatBlock(1, `col-start-1 row-start-1 ${over ? "justify-self-start" : "row-span-2 self-center"}`)}
            {seatBlock(3, `col-start-3 row-start-1 ${over ? "justify-self-end" : "row-span-2 self-center"}`)}
            {over ? (
              <div className="col-span-3 row-start-2 flex justify-center">
                <HandEnd view={view} nameOf={nameOf} moon={moon} mySeat={mySeat} sheetOpen={sheetOpen} setSheetOpen={setSheetOpen} />
              </div>
            ) : (
              <div className="col-start-2 row-start-2 flex min-h-0 flex-col items-center justify-center py-2 short:py-0">
                {view.phase === "passing"
                  ? <PassSign view={view} nameOf={nameOf} rel={rel} width={trickWidth} />
                  : <Trick trick={trick} rel={rel} sweeping={!!shown?.sweeping} slideMs={slideMs} sweepMs={sweepMs} width={trickWidth} fourColour={prefs.fourColour} />}
              </div>
            )}
          </div>
        </div>

        {/* your seat: name, what you are sitting on, your score; then what to do */}
        <div className="mt-1 flex shrink-0 flex-col items-center gap-2 short:w-60 short:justify-center short:self-stretch">
          <SeatPlate seat={mySeat} view={view} person={person(mySeat)} actions={actionsFor(mySeat)} active={myTurn} align="center" placement="above"
            passed={view.phase === "passing" && view.passed[mySeat]} compact={phone} me />
          <p className={`text-center text-sm ${myTurn || passing ? "text-chalk" : "text-chalk-faint"}`}>{status}</p>
          <p data-announcer="" className="sr-only" aria-live="polite" aria-atomic="true">{spoken}</p>
          {passing && (
            <button type="button" className="btn btn-brass btn-compact" disabled={selected.length !== 3 || busy} onClick={() => void act({ type: "pass_cards", cards: selected })}>
              Pass three cards
            </button>
          )}
          {view.phase === "hand_over" && !local && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {isHost
                ? <button type="button" className="btn btn-brass btn-compact" disabled={busy} onClick={() => void act({ type: "next_hand" })}>
                    {humansWaiting.length ? `Deal anyway (${humansWaiting.map((s) => nameOf(s.seat)).join(", ")} not ready)` : "Deal the next hand"}
                  </button>
                : readySeats.includes(mySeat)
                  ? <span className="text-sm text-chalk-faint">Ready. Waiting for the host to deal.</span>
                  : <button type="button" className="btn btn-brass btn-compact" onClick={() => void postReady()}>Ready for the next hand</button>}
            </div>
          )}
          {view.phase === "hand_over" && local && <button type="button" className="btn btn-brass btn-compact" onClick={() => void act({ type: "next_hand" })}>Deal the next hand</button>}
          {view.phase === "game_over" && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {isHost && !local && <button type="button" className="btn btn-brass btn-compact" disabled={busy} onClick={() => void rematch()}>Play again</button>}
              <Link href="/" className="btn btn-ghost btn-compact">Back to your tables</Link>
            </div>
          )}
        </div>
      </div>

      {/* your hand */}
      <div className="hand-scroll mt-2 shrink-0 overflow-x-auto pt-4 short:mt-1 short:pt-3" style={{ paddingBottom: "max(.75rem, env(safe-area-inset-bottom))" }}>
        <Hand cards={hand} width={cardWidth} selected={selected} armed={armed} playable={playable} received={received}
          interactive={passing || myTurn} onTap={tapCard} prefs={prefs} />
      </div>

      {chat && <div className="absolute bottom-3 right-3 z-30"><ChatDock chat={chat} open={talkOpen} setOpen={setTalkOpen} text={talkDraft} setText={setTalkDraft} /></div>}
    </div>
  );
}

function TopBar({ code }: { code: string }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3">
      <Link href="/" className="text-chalk-faint hover:text-chalk">Meld</Link>
      <span className="code text-chalk" style={{ fontSize: 18, letterSpacing: ".12em" }}>{code}</span>
    </header>
  );
}

/** A seat's name on a chalk plate, the cards it has taken under it, and its score. The plate opens the player's menu. */
function SeatPlate({ seat, view, person, actions, active, align, placement = "below", passed, compact, me = false }: {
  seat: SeatIndex; view: HeartsView; person: SeatPerson; actions: SeatActions; active: boolean; align: "left" | "center" | "right";
  placement?: "above" | "below"; passed: boolean; compact: boolean; me?: boolean;
}) {
  const taken = view.taken[seat];
  const plate = `${person.name}${active ? ", to play" : ""}, ${view.score[seat]} points`;
  return (
    <PlayerMenu person={person} team="red" actions={actions} align={align} placement={placement} plate={plate}
      className={`panel flex max-w-[min(44vw,15rem)] items-center gap-2 px-2 py-1.5 text-left ${compact ? "text-xs" : "text-sm"}`}
      style={active ? { boxShadow: "0 0 0 3px var(--brass), var(--shadow-card)" } : undefined}>
      <Avatar name={person.name} size={compact ? 26 : 32} bot={person.bot} team={null} />
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate font-semibold">{me ? "You" : person.name}</span>
          <span className="tabular-nums text-ink-soft" aria-label={`${view.score[seat]} points`}>{view.score[seat]}</span>
          {view.dealer === seat && <span className="rounded-full bg-ink px-1 text-[10px] font-semibold leading-4 text-chalk" title="Dealer">D</span>}
        </span>
        <span className="flex h-4 items-center">
          {passed ? <span className="text-xs text-ink-soft">passed</span> : <Ledger taken={taken} compact />}
        </span>
      </span>
    </PlayerMenu>
  );
}

/** An opponent's cards, face down, overlapping; along the side seats they lie sideways. */
function Backs({ n, vertical }: { n: number; vertical: boolean }) {
  const w = 22, step = 7;
  if (n === 0) return <div style={{ height: vertical ? 0 : (w * 7) / 5 }} />;
  return (
    <div role="img" aria-label={`${n} ${n === 1 ? "card" : "cards"}`} className="relative shrink-0" style={vertical ? { width: (w * 7) / 5, height: w + (n - 1) * step } : { width: w + (n - 1) * step, height: (w * 7) / 5 }}>
      {Array.from({ length: n }, (_, i) => (
        <CardBack key={i} width={w} team="red" className="absolute" style={vertical
          ? { top: i * step, left: 0, transform: "rotate(90deg)", transformOrigin: `${(w * 7) / 10}px ${(w * 7) / 10}px` }
          : { left: i * step, top: 0 }} />
      ))}
    </div>
  );
}

/** While cards are passed, the middle of the table says where they go: three backs slid toward the seat that gets them. */
function PassSign({ view, nameOf, rel, width }: { view: HeartsView; nameOf: (s: SeatIndex) => string; rel: (s: SeatIndex) => Rel; width: number }) {
  const h = (width * 7) / 5;
  const to = view.pass === "hold" ? null : (((view.seat + (view.pass === "left" ? 1 : view.pass === "right" ? 3 : 2)) % 4) as SeatIndex);
  const r = to === null ? 0 : rel(to);
  const slide: Record<Rel, [number, number]> = { 0: [0, 0], 1: [-18, 0], 2: [0, -18], 3: [18, 0] };
  const [dx, dy] = slide[r];
  return (
    <div className="flex flex-col items-center gap-3" style={{ width: width * 2.6, minHeight: h * 2.1, justifyContent: "center" }}>
      <div className="relative" style={{ width: width + 24, height: h + 8 }}>
        {[0, 1, 2].map((i) => (
          <CardBack key={i} width={width} team="red" className="absolute"
            style={{ left: i * 12, top: i * 4, transform: to === null ? undefined : `translate(${dx * (i + 1)}px, ${dy * (i + 1)}px) rotate(${(i - 1) * 4}deg)`, opacity: 1 - i * 0.12 }} />
        ))}
      </div>
      <p className="text-center text-sm text-chalk-faint">{to === null ? "No pass this hand." : `Three cards go to ${nameOf(to)}.`}</p>
    </div>
  );
}

/** The trick in the middle of the cloth: each seat's card in its own spot, arriving from that seat, leaving toward the winner. */
function Trick({ trick, rel, sweeping, slideMs, sweepMs, width, fourColour }: {
  trick: HeartsTrick | null; rel: (s: SeatIndex) => Rel; sweeping: boolean; slideMs: number; sweepMs: number; width: number; fourColour: boolean;
}) {
  const h = (width * 7) / 5;
  const box = { w: width * 2.6, h: h * 2.1 };
  const spot: Record<Rel, CSSProperties> = {
    0: { left: "50%", top: "100%", transform: "translate(-50%, -100%)" },
    1: { left: 0, top: "50%", transform: "translate(0, -50%)" },
    2: { left: "50%", top: 0, transform: "translate(-50%, 0)" },
    3: { left: "100%", top: "50%", transform: "translate(-100%, -50%)" },
  };
  const winner = trick?.winner != null ? rel(trick.winner) : 0;
  return (
    <div className="relative" style={{ width: box.w, height: box.h }}>
      <div className="absolute inset-[-6%] rounded-[40%]" style={{ boxShadow: "inset 0 0 0 1.5px var(--chalk-ghost)" }} />
      {trick?.plays.map((p, i) => (
        <div key={`${p.card}`} className="absolute" style={{ ...spot[rel(p.seat)], zIndex: i + 1 }}>
          <div className="trick-card" data-sweep={sweeping ? "" : undefined}
            style={{ ...flyFrom(rel(p.seat), p.card as unknown as CardId), ...(sweeping ? sweepTo(winner) : {}), "--pm": `${slideMs}ms`, "--sm": `${sweepMs}ms`, "--sd": "0ms" } as CSSProperties}>
            <PlayingCard card={p.card} width={width} fourColour={fourColour} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Your cards, overlapping, the playable ones lifted; cards you were passed carry a brass dot until you first play. */
function Hand({ cards, width, selected, armed, playable, received, interactive, onTap, prefs }: {
  cards: HeartsCardId[]; width: number; selected: HeartsCardId[]; armed: HeartsCardId | null; playable: Set<HeartsCardId>; received: Set<HeartsCardId>;
  interactive: boolean; onTap: (card: HeartsCardId) => void; prefs: ReturnType<typeof useCardPrefs>["prefs"];
}) {
  const step = Math.round(width * 0.42);
  const total = width + (cards.length - 1) * step;
  const h = (width * 7) / 5;
  return (
    <div className="relative mx-auto" style={{ width: total, height: h + LIFT_PX + 6 }}>
      {cards.map((card, i) => {
        const up = selected.includes(card) || armed === card;
        const can = interactive && (playable.size === 0 || playable.has(card));
        const dim = interactive && playable.size > 0 && !playable.has(card);
        return (
          <button key={card} type="button" data-hand-card={card}
            aria-label={`${cardName(card)}${received.has(card) ? ", passed to you" : ""}${selected.includes(card) ? ", chosen to pass" : armed === card ? ", tap again to play" : ""}`}
            aria-pressed={up} disabled={!can} onClick={() => onTap(card)}
            className="absolute bottom-0 block rounded-[12px] disabled:cursor-default"
            style={{ left: i * step, transform: up ? `translateY(-${LIFT_PX}px)` : undefined, transition: "transform .16s ease", zIndex: i }}>
            <PlayingCard card={card} width={width} selected={up} dimmed={dim} prefs={prefs} />
            {received.has(card) && <span aria-hidden className="absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full bg-brass" style={{ boxShadow: "0 0 0 1.5px var(--chalk)" }} />}
          </button>
        );
      })}
    </div>
  );
}

/** The end of a hand in the middle of the table: the moon, if anyone shot it, then the scoresheet. */
function HandEnd({ view, nameOf, moon, mySeat, sheetOpen, setSheetOpen }: {
  view: HeartsView; nameOf: (s: SeatIndex) => string; moon: SeatIndex | null; mySeat: SeatIndex; sheetOpen: boolean; setSheetOpen: (open: boolean) => void;
}) {
  const last = view.history[view.history.length - 1];
  const winner = view.winner;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      {moon !== null && (
        <div className="moon-rise relative z-10 flex h-36 w-36 items-center justify-center rounded-full sm:h-44 sm:w-44" style={{ background: "var(--chalk)", boxShadow: "0 0 70px 14px rgba(245,239,227,.28), var(--shadow-card)" }}>
          <span className="display text-center text-ink" style={{ fontSize: 26, lineHeight: 1 }}>{moon === mySeat ? "You shot" : `${nameOf(moon)} shot`}<br />the moon</span>
        </div>
      )}
      <div className="panel w-full p-3 sm:p-4">
        <p className="display" style={{ fontSize: 24 }}>
          {view.phase === "game_over" ? (winner !== null ? (winner === mySeat ? "You win." : `${nameOf(winner)} wins.`) : "Game over.") : `Hand ${last?.handNumber ?? view.handNumber}`}
        </p>
        {last && (
          // After a hand: what each player took, with the running total under it. After the game: the totals, the winner's in brass.
          <ul className="mt-2 grid grid-cols-4 gap-2 text-center">
            {ALL_SEATS.map((s) => {
              const done = view.phase === "game_over";
              const big = done ? view.score[s] : last.delta[s];
              const color = done ? (s === winner ? "var(--brass-deep)" : "var(--ink)") : big > 0 ? "var(--pip-red)" : "var(--ink)";
              return (
                <li key={s}>
                  <p className="truncate text-xs text-ink-soft">{nameOf(s)}</p>
                  <p className="display tabular-nums" style={{ fontSize: 26, color }}>
                    {big < 0 && <><span className="font-sans font-light" aria-hidden>−</span><span className="sr-only">minus </span></>}{Math.abs(big)}
                  </p>
                  <p className="text-xs tabular-nums text-ink-soft">{done ? `last hand ${last.delta[s] < 0 ? "−" : ""}${Math.abs(last.delta[s])}` : `total ${view.score[s]}`}</p>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="tap-link mt-1 text-xs text-ink-soft underline underline-offset-2 hover:text-ink" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)}>
          {sheetOpen ? "Hide scorepad" : "Show scorepad"}
        </button>
        {sheetOpen && <div className="mt-2 max-h-[30vh] overflow-y-auto"><Scoresheet view={view} nameOf={nameOf} bare /></div>}
      </div>
    </div>
  );
}

export type { ReactNode };
