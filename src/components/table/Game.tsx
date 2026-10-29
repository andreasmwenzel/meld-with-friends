"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, isTransientError, type Profile } from "@/lib/api";
import { ViewSync, type GameFeed } from "./viewSync";
import { applyPublicMove, type PublicMove } from "@/engine/publicMove";
import { openMove } from "@/lib/moveAuth";
import { BUILD_ID, recordBuildReload, reloadPage, staleBuild } from "@/lib/staleClient";
import type { Action, CardId, PlayerView, SeatIndex, Suit, Team } from "@/engine/types";
import { PlayingCard, CardBack, SUIT_GLYPH, SUIT_NAME, RANK_LABEL, splitCard, cardName, suitInk, suitInkOnCloth } from "@/components/cards/PlayingCard";
import { Avatar } from "@/components/site/Avatar";
import { SEAT_LABEL, teamOf, type Snapshot } from "./types";
import { Scorepad } from "./Scorepad";
import { DealerMark, ScoreTag, seatScore, type ScoreFacts, type SeatScore } from "./SeatScore";
import { PlayerMenu, type SeatActions, type SeatPerson } from "./PlayerMenu";
import { useTablemates } from "./tablemates";
import { BidPicker, MisdealButton } from "./BidPicker";
import { ResultSheet, type Which } from "./Result";
import { canCountdownAdvance } from "./nextHandCountdown";
import { Recap, useSeenReporting } from "./Recap";
import { itemLabel } from "./meldLabel";
import { CardOptionsPanel } from "@/components/cards/CardOptions";
import { NameChange } from "@/components/site/NameChange";
import { useOpponentPointsPref } from "@/lib/prefs";
import { useCardPrefs } from "@/lib/cardPrefs";
import { usePushNotifications } from "@/lib/push";
import { autoMeldSelection, meldBySuit, sortHand } from "@/engine/hand";
import { describeConstraint } from "@/engine/rules";
import { RulesForm } from "@/components/rules/RulesForm";
import { cardLabel } from "@/engine/deck";
import { motionTimings, flyFrom, sweepTo } from "./motion";
import { ClaimButton, useClaimReveal } from "./Claim";
import { ChatDock, type TableChat } from "./ChatDock";
import { FOLD_MS, SitOutStack } from "./SitOutStack";
import { newLogLines, speakLine } from "./announce";
import { DOUBLE_TAP_MS, isRealPress, isTimedActivation, releasePress, secondPress, type Armed, type Press } from "./tapTwice";

type ClientAction = Action extends infer A ? (A extends Action ? Omit<A, "seat"> : never) : never;

const CHIME_KEY = "meld.chime";
const WIDE = "(min-width: 64rem)";
const subscribeWide = (cb: () => void) => { const mq = window.matchMedia(WIDE); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); };
const readWide = () => window.matchMedia(WIDE).matches;
type MenuTab = "score" | "hand" | "rules" | "options";
const TURN_PREFIX = "Your turn · ";
/** How far a lifted card rises out of the hand. */
const LIFT_PX = 14;

function countersIn(trick: NonNullable<PlayerView["currentTrick"]>, rules: PlayerView["rules"]): number {
  const classic: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2 };
  return trick.plays.reduce((n, p) => {
    const { rank } = splitCard(p.card);
    return n + (rules.counting === "classic" ? classic[rank] ?? 0 : "ATK".includes(rank) ? rules.counterValue : 0);
  }, 0);
}

export function Game({ code, me, snap, rev, feed, inspect, onTableChange, connection = "ok", local = false, guest = false, suggested, chat }: {
  code: string; me: Profile; snap: Snapshot; onTableChange: () => void; connection?: "ok" | "reconnecting"; local?: boolean;
  /** a guest viewer: no friend actions, since guests cannot add friends */
  guest?: boolean;
  /** boards without a channel (lab, practice) reload whenever this changes */
  rev?: number;
  /** the table room's channel events; the board fetches once per game event */
  feed?: GameFeed;
  /** lab only: sees every view the board applies, fetched or built from a broadcast move */
  inspect?: (view: PlayerView) => void;
  /** cards a coach suggests, outlined in the hand (practice) */
  suggested?: CardId[];
  /** table talk, behind the round button in the corner; only real tables pass it (not practice) */
  chat?: TableChat;
}) {
  const [view, setView] = useState<PlayerView | null>(null);
  const push = usePushNotifications();
  const [selected, setSelected] = useState<CardId[]>([]);
  /** Cards lit by tapping a suit or meld item in the meld readout; purely a visual aid. */
  const [lit, setLit] = useState<CardId[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Card lifted awaiting a second tap; only valid for the view revision it was lifted in.
   *  While `open`, a second tap plays it (the card wears its ring); once the window closes a tap puts it down. */
  const [armed, setArmed] = useState<Armed | null>(null);
  /** The last pointer press on a hand card; a click not just after it was let go is a keyboard or screen-reader press. */
  const lastPress = useRef<Press | null>(null);
  /** The card you just played, held up in your hand while the play is sent. */
  const [sending, setSending] = useState<CardId | null>(null);
  /** Where that card sat in your hand, so it flies to the table from there. */
  const launch = useRef<{ card: CardId; rect: DOMRect } | null>(null);
  const [cardHint, setCardHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  const [degraded, setDegraded] = useState(false);
  const [updating, setUpdating] = useState(false);
  // The ref blocks handlers immediately, before React renders the inert controls.
  const updatingRef = useRef<string | null>(null);
  const pendingMutations = useRef(0);
  const [mutations, setMutations] = useState(0);
  const mutate = useCallback(async <T,>(send: () => Promise<T>): Promise<T> => {
    setMutations(++pendingMutations.current);
    try { return await send(); }
    finally { setMutations(--pendingMutations.current); }
  }, []);
  const checkBuild = useCallback((next: PlayerView & { build?: string }) => {
    if (updatingRef.current || !next.build || !staleBuild(next.build)) return;
    updatingRef.current = next.build;
    setUpdating(true);
  }, []);
  const reloadIfNeeded = useCallback(() => {
    const build = updatingRef.current;
    if (build && recordBuildReload(build)) reloadPage();
  }, []);
  useEffect(() => {
    if (!updating) return;
    // A hung request must not leave the table inert forever. This deadline never resets on settlement.
    const timer = setTimeout(reloadIfNeeded, 5000);
    return () => clearTimeout(timer);
  }, [updating, reloadIfNeeded]);
  useEffect(() => {
    if (!updating || mutations > 0) return;
    // Let the status paint and sync.act settle, unless the drain deadline above expires first.
    const timer = setTimeout(() => { if (pendingMutations.current === 0) reloadIfNeeded(); }, 300);
    return () => clearTimeout(timer);
  }, [updating, mutations, reloadIfNeeded]);
  // eslint-disable-next-line react-hooks/refs -- ViewSync stores apply; it runs only after requests or feed events, never during render.
  const [sync] = useState(() => new ViewSync<PlayerView, PublicMove>({
    fetchView: () => api<PlayerView>(`/api/tables/${code}/view`),
    applyMove: applyPublicMove,
    apply: (next) => { inspect?.(next); setView(next); setDegraded(false); checkBuild(next); },
    onError: (e) => {
      if (isTransientError(e)) setDegraded(true);
      else setError(e instanceof ApiError && e.status === 404 ? "No table has this code." : (e as Error).message);
    },
  }));
  const reconnecting = connection === "reconnecting" || degraded;
  const { prefs: cardPrefs, width: cardW, short, reducedMotion } = useCardPrefs();
  useEffect(() => {
    if (!armed) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest("[data-keep-armed]")) setArmed(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [armed]);
  useEffect(() => {
    if (!armed?.open || !armed.timed) return;
    const timer = setTimeout(() => setArmed((a) => (a === armed ? { ...a, open: false } : a)), DOUBLE_TAP_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const motion = reducedMotion ? "off" : cardPrefs.motion;
  const { slideMs, holdMs, sweepMs } = motionTimings(motion);
  const claimRoot = useRef<HTMLDivElement>(null);
  const revealingClaim = useClaimReveal(view, motion, claimRoot);
  const router = useRouter();

  const load = useCallback(() => sync.load(), [sync]);
  // Leaving the board (or a rematch remounting it) cancels its grace timers and late answers.
  useEffect(() => { sync.start(); return () => sync.dispose(); }, [sync]);
  useEffect(() => { void load(); }, [load, rev]);
  // Public moves apply locally, other game events fetch once at most; seat events (ready checks) and
  // resyncs (reconnect, tab shown, polling) always fetch.
  const opening = useRef<Promise<void>>(Promise.resolve());
  const gameId = snap.table.current_game_id;
  useEffect(() => feed?.subscribe((event) => {
    if (event.type !== "game") { sync.handle(event); return; }
    // Check signatures in arrival order; a move that does not check out counts as a bare revision.
    opening.current = opening.current.then(async () => {
      // The server's public key for broadcast moves comes with the view.
      const key = (sync.latest as (PlayerView & { moveKey?: string }) | null)?.moveKey;
      const move = key && gameId && event.move ? await openMove(key, gameId, event.move, event.sig) : null;
      // A newer server may describe rules this bundle cannot apply. Fetch its view before reloading,
      // even if this build was already attempted, and let the normal view path check the build.
      if (move && move.build !== BUILD_ID) { await sync.load(); return; }
      sync.event(event.rev, move?.move);
    }).catch(() => sync.event(event.rev)); // never let one bad event stop the ones after it
  }), [feed, sync, gameId]);
  const live = !!feed && connection === "ok";
  // The game ending also finishes the table; game events no longer refetch the table, so ask once.
  const tableEnding = view?.phase === "game_over" && snap.table.status === "playing";
  useEffect(() => { if (tableEnding) onTableChange(); }, [tableEnding, onTableChange]);

  /** Sends an action; resolves to the view it brought back, or null if nothing came back. */
  async function act(action: ClientAction): Promise<PlayerView | null> {
    if (!view || busy || updatingRef.current) return null;
    const request = sync.begin();
    const body = { action: { ...action, seat: view.seat }, expectedRev: view.rev, requestId: crypto.randomUUID() };
    setBusy(true); setError(null);
    // The response carries the new view, so the broadcast for this move needs no fetch.
    return mutate(() => sync.act(async () => {
      try {
        let next: PlayerView;
        try { next = await api<PlayerView>(`/api/tables/${code}/act`, { body }); }
        catch (e) {
          if (e instanceof ApiError) throw e;
          next = await api<PlayerView>(`/api/tables/${code}/act`, { body });
        }
        sync.accept(next, request); setSelected([]);
        return next;
      } catch (e) {
        if (!sync.current(request)) return null;
        if (e instanceof ApiError && e.status === 409 && e.data && typeof (e.data as PlayerView).rev === "number") {
          sync.accept(e.data as PlayerView, request); setSelected([]);
          return e.data as PlayerView;
        } else if (isTransientError(e)) setDegraded(true);
        else setError((e as Error).message);
        return null;
      } finally { setBusy(false); }
    }));
  }

  async function countdownNext(signal: AbortSignal) {
    if (!view || busy || error || reconnecting || document.hidden || updatingRef.current) return;
    let submitted = false;
    try {
      const [table, latest] = await Promise.all([
        api<Snapshot>(`/api/tables/${code}`),
        api<PlayerView & { ready?: SeatIndex[] }>(`/api/tables/${code}/view`),
      ]);
      checkBuild(latest);
      if (updatingRef.current || signal.aborted || document.hidden || !canCountdownAdvance(table, latest, {
        tableId: snap.table.id, userId: me.id, handNumber: view.handNumber, rev: view.rev,
      })) return;
      const request = sync.begin();
      submitted = true;
      setBusy(true);
      // One normal action request, with the freshly checked revision and no retry.
      const next = await mutate(() => api<PlayerView>(`/api/tables/${code}/act`, { body: {
        action: { type: "next_hand", seat: latest.seat }, expectedRev: latest.rev, requestId: crypto.randomUUID(),
      } }));
      sync.accept(next, request);
      setSelected([]);
    } catch (e) {
      if (submitted || !signal.aborted) setError((e as Error).message);
    } finally { if (submitted) setBusy(false); }
  }

  const nameOf = useCallback((seat: SeatIndex) => {
    const s = snap.seats.find((x) => x.seat === seat);
    if (s?.user_id === me.id) return "You";
    return s?.profile?.display_name ?? s?.bot ?? SEAT_LABEL[seat];
  }, [snap.seats, me.id]);
  const isBot = useCallback((seat: SeatIndex | null) => seat !== null && !!snap.seats.find((x) => x.seat === seat)?.bot, [snap.seats]);
  // Friend status for each player's menu; boards without a server (lab, practice) and guests have none.
  const seatedIds = snap.seats.map((x) => x.user_id ?? "").join(",");
  const { mates, refresh: refreshMates, addFriend, acceptFriend } = useTablemates(code, local || guest, seatedIds);

  // Computer players move one card at a time, paced by the table so everyone can follow the trick.
  const botTurn = !!view && (view.phase === "melding" ? snap.seats.some((x) => x.bot && !view.meldConfirmed[x.seat]) : isBot(view.turn)) && view.phase !== "hand_over" && view.phase !== "game_over";
  const firstHuman = snap.seats.find((x) => x.user_id)?.user_id;
  const leader = firstHuman === me.id;
  const [pace, setPace] = useState(900);
  const [stalledSince, setStalledSince] = useState<number | null>(null);
  const [nudgeVersion, setNudgeVersion] = useState(0);
  const tickFailures = useRef(0);
  const nudgePending = useRef(false);
  const nudge = useCallback(() => { tickFailures.current = 0; nudgePending.current = true; setNudgeVersion(n => n + 1); void load(); }, [load]);
  useEffect(() => {
    // A new revision is progress. Start the clock for the next bot turn.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- timestamp follows the server revision
    setStalledSince(botTurn ? Date.now() : null);
  }, [botTurn, view?.rev]);
  useEffect(() => {
    if (!botTurn || !view || updating) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const delay = (view.phase === "playing" ? pace : Math.min(pace, 600)) + (leader ? 0 : 2500);
    const run = async () => {
      if (updatingRef.current) return;
      let nextDelay = delay;
      try {
        const r = await mutate(() => api<{ acted: boolean; rev: number; delayMs?: number }>(`/api/tables/${code}/tick`, { body: {} }));
        if (cancelled) return;
        tickFailures.current = 0;
        if (typeof r.delayMs === "number") setPace(r.delayMs);
        // With a live channel the broadcast brings the move; fetch only if it has not arrived shortly.
        if (r.acted || r.rev > sync.rev) {
          if (live) sync.expect(r.rev, 2000);
          else await load();
        }
      } catch {
        if (cancelled) return;
        setDegraded(true);
        nextDelay = Math.min(10000, 1500 * 2 ** Math.min(tickFailures.current++, 3) * (0.9 + Math.random() * 0.2));
      }
      if (!cancelled) timer = setTimeout(run, nextDelay);
    };
    timer = setTimeout(run, nudgePending.current ? 0 : delay);
    nudgePending.current = false;
    return () => { cancelled = true; clearTimeout(timer); };
  }, [botTurn, view, code, load, sync, live, leader, pace, nudgeVersion, updating, mutate]);

  const [displayedTrick, setDisplayedTrick] = useState<PlayerView["currentTrick"]>(null);
  /** The revision at which you asked to see the last trick again; any move puts the table back. */
  const [peekRev, setPeekRev] = useState<number | null>(null);
  const trickHold = useRef<{ key: string; until: number }>({ key: "", until: 0 });
  // Before paint, so a card you play never shows gone from your hand and not yet on the table.
  useLayoutEffect(() => {
    if (!view) return;
    const last = view.claim ? null : view.lastTrick;
    const key = `${view.handNumber}:${last?.plays.map(p => p.card).join(",") ?? ""}`;
    if (last?.winner != null && key !== trickHold.current.key) {
      trickHold.current = { key, until: Date.now() + (holdMs + sweepMs) };
    }
    const live = view.currentTrick?.plays.length ? view.currentTrick
      : view.phase === "hand_over" || view.phase === "game_over" ? last : view.currentTrick;
    const remaining = trickHold.current.until - Date.now();
    setDisplayedTrick(remaining > 0 && last?.winner != null ? last : live);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setDisplayedTrick(live), remaining);
    return () => clearTimeout(timer);
  }, [view, pace, holdMs, sweepMs]);

  // Offer a manual nudge once computers have been silent for 20 seconds.
  const [lateFor, setLateFor] = useState<number | null>(null);
  useEffect(() => {
    if (stalledSince === null) return;
    const timer = setTimeout(() => setLateFor(stalledSince), Math.max(0, stalledSince + 20000 - Date.now()));
    return () => clearTimeout(timer);
  }, [stalledSince]);
  const stalled = stalledSince !== null && lateFor === stalledSince;

  // Your-turn cues: title prefix and an opt-in chime, only while the tab is away.
  const [chime, setChime] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the stored preference once after mount
  useEffect(() => { setChime(localStorage.getItem(CHIME_KEY) === "1"); }, []);
  const audio = useRef<AudioContext | null>(null);
  const ding = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (audio.current ??= new Ctx());
      void ctx.resume();
      const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime;
      osc.type = "sine"; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.4);
    } catch { /* audio is a nicety */ }
  }, []);
  const toggleChime = () => {
    const next = !chime;
    setChime(next);
    try { localStorage.setItem(CHIME_KEY, next ? "1" : "0"); } catch { /* storage may be blocked */ }
    if (next) ding();
  };
  const myTurnNow = !!view && view.turn === view.seat && view.phase !== "hand_over" && view.phase !== "game_over";
  useEffect(() => {
    if (!myTurnNow || (!document.hidden && document.hasFocus())) return;
    const base = document.title.startsWith(TURN_PREFIX) ? document.title.slice(TURN_PREFIX.length) : document.title;
    document.title = TURN_PREFIX + base;
    if (localStorage.getItem(CHIME_KEY) === "1") ding();
    const restore = () => { if (!document.hidden && document.hasFocus()) document.title = base; };
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", restore);
      if (document.title.startsWith(TURN_PREFIX)) document.title = base;
    };
  }, [myTurnNow, ding]);

  // A seat that has been on turn for a minute is probably away; touch screens have no hover to reach the stand-in.
  const [awaySeat, setAwaySeat] = useState<SeatIndex | null>(null);
  const turnSeat = view?.phase === "playing" ? view.turn : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock restarts whenever the turn moves
    setAwaySeat(null);
    if (turnSeat === null) return;
    const timer = setTimeout(() => setAwaySeat(turnSeat), 60000);
    return () => clearTimeout(timer);
  }, [turnSeat]);

  async function rematch() {
    if (updatingRef.current) return;
    setBusy(true); setError(null);
    try {
      await mutate(() => api<{ code: string; rev: number }>(`/api/tables/${code}/rematch`, { body: {} }));
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function standIn(seat: SeatIndex, name: string) {
    if (updatingRef.current) return;
    if (!window.confirm(`Hand ${name}'s chair to a computer? The game continues without them.`)) return;
    setError(null);
    try {
      await mutate(() => api(`/api/tables/${code}/standin`, { body: { seat } }));
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function postReady() {
    if (updatingRef.current) return;
    setError(null);
    try {
      // The answer is the table, not the view: ask for one view fetch, which the seat broadcast for
      // this same change shares if it arrives first.
      await mutate(() => sync.act(async () => {
        await api(`/api/tables/${code}/ready`, { body: {} });
        sync.invalidate();
      }));
    } catch (e) { setError((e as Error).message); }
  }
  async function pauseTable() {
    if (updatingRef.current) return;
    const reason = window.prompt("Why the pause? (optional, 80 characters)", "");
    if (reason === null) return;
    setError(null);
    try {
      await mutate(() => api(`/api/tables/${code}/pause`, { body: { reason: reason.trim().slice(0, 80) } }));
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function resumeTable() {
    if (updatingRef.current) return;
    setError(null);
    try {
      await mutate(() => api(`/api/tables/${code}/resume`, { body: {} }));
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function makeHost(userId: string, name: string) {
    if (updatingRef.current) return;
    if (!window.confirm(`Make ${name} the host? They will deal and run the table from here.`)) return;
    setError(null);
    try {
      await mutate(() => api(`/api/tables/${code}/host`, { body: { toUserId: userId } }));
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function leave() {
    if (updatingRef.current) return;
    if (!window.confirm("Leave the game? A computer will take your chair and play on.")) return;
    setError(null);
    try {
      await mutate(() => api(`/api/tables/${code}/seat`, { method: "DELETE" }));
      router.push("/");
    } catch (e) { setError((e as Error).message); }
  }

  const lastSeenRev = (snap as Snapshot & { lastSeenRev?: number | null }).lastSeenRev ?? null;
  // Everything that is not the table (scorepad, this hand, options) lives behind Menu; table talk has its own button.
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<MenuTab>("score");
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Focus goes into the drawer when it opens and back to the Menu button when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (menu) closeButton.current?.focus();
    else if (wasOpen.current) menuButton.current?.focus();
    wasOpen.current = menu;
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setMenu(false); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [menu]);
  const recapOpen = menu && tab === "hand";
  // Table talk's popover and draft belong to the board, so they survive the button moving onto the result sheet.
  const [talkOpen, setTalkOpen] = useState(false);
  // The menu covers the chat popover, so opening it closes talk: hidden messages then count as unread again.
  if (menu && talkOpen) setTalkOpen(false);
  const [talkDraft, setTalkDraft] = useState("");
  const autoRecap = useRef(false);
  const sendSeen = useCallback((path: string, init: Parameters<typeof api>[1]) => {
    if (updatingRef.current) return Promise.resolve(null);
    return api(path, init);
  }, []);
  useSeenReporting(code, snap.mySeat !== null && view ? view.rev : null, sendSeen);
  useEffect(() => {
    if (!view || autoRecap.current) return;
    autoRecap.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens once, after the first view arrives
    if (view.rules.pace === "leisurely" && lastSeenRev !== null && view.rev > lastSeenRev) { setTab("hand"); setMenu(true); }
  }, [view, lastSeenRev]);

  const [which, setWhich] = useState<Which>("atPlay");
  const [peekKey, setPeekKey] = useState<string | null>(null);
  // Automatic meld (the default): lay down the best meld and confirm it with no taps, one step per revision.
  const autoMelded = useRef<string | null>(null);
  useEffect(() => {
    if (!view || !cardPrefs.autoMeld || busy || error || snap.paused || view.phase !== "melding" || !view.trump) return;
    if (view.meldConfirmed[view.seat] || !view.legal.canConfirmMeld) return;
    const step = `${view.handNumber}:${view.rev}`;
    if (autoMelded.current === step) return;
    const cards = autoMeldSelection(view.hand, view.trump);
    const declare = cards.length > 0 && !view.melds[view.seat]?.length && view.legal.canDeclareMeld;
    // A short beat so the meld visibly lands before the table moves on.
    const timer = setTimeout(() => {
      autoMelded.current = step;
      void act(declare ? { type: "declare_meld", cards } : { type: "confirm_meld" });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- act is recreated each render; the revision key runs each step once
  }, [view, busy, error, snap.paused, cardPrefs.autoMeld]);
  // A choice made in one phase never carries into the next (an outside move, such as the practice coach, can change it).
  // A shoot sets the partner's hand aside. Seen happening (no one sitting out, then someone, in the same hand), the cards
  // fold away; a view that arrives with the shoot already declared (a reload, joining mid-hand) shows the stack as it is.
  const outKey = view ? `${view.handNumber}:${view.sittingOut ?? ""}` : "";
  const [seenOut, setSeenOut] = useState(outKey);
  const [folding, setFolding] = useState<string | null>(null);
  if (seenOut !== outKey) {
    setSeenOut(outKey);
    const [hand, out] = outKey.split(":");
    if (out && seenOut === `${hand}:`) setFolding(outKey);
  }
  useEffect(() => {
    if (!folding) return;
    const timer = setTimeout(() => setFolding(null), FOLD_MS + 100);
    return () => clearTimeout(timer);
  }, [folding]);
  const phaseKey = view ? `${view.handNumber}:${view.phase}` : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drops a stale choice when the phase moves on
  useEffect(() => { setSelected([]); }, [phaseKey]);
  const handRef = useRef<HTMLDivElement>(null);
  const handId = useId();
  /** Keyboard users in the hand, the action bar, the Play button or the result sheet (each a `data-focus-zone`) stay there:
   *  a played card's button, the remounted action bar or a closed sheet would otherwise drop focus to the page. */
  const handFocused = useRef(false);
  const actionRef = useRef<HTMLDivElement>(null);
  /** The card that holds the hand's one tab stop; arrow keys move it. */
  const [rove, setRove] = useState<CardId | null>(null);
  /** Into the hand: your playable card, else the card holding the tab stop, else the hand itself. */
  const focusHand = useCallback(() => {
    const hand = handRef.current;
    const card = hand?.querySelector<HTMLButtonElement>("[data-hand-card]:not([aria-disabled=true])") ?? hand?.querySelector<HTMLButtonElement>("[data-hand-card][tabindex='0']");
    (card ?? hand)?.focus({ preventScroll: true });
  }, []);
  const keepFocus = {
    "data-focus-zone": "",
    onFocus: () => { handFocused.current = true; },
    onBlur: (e: React.FocusEvent) => { if (e.relatedTarget && !inFocusZone(e.relatedTarget)) handFocused.current = false; },
  };
  const [handW, setHandW] = useState(0);
  const hasView = view !== null;
  useLayoutEffect(() => {
    const el = handRef.current;
    if (!el) return;
    const measure = () => setHandW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasView]);
  const { hideOpponentPoints } = useOpponentPointsPref();
  // The board scales down to the room between the score strip and your actions, so the page never scrolls.
  const stage = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, w: 0, h: 0, top: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const s = stage.current, b = boardRef.current;
      if (!s || !b) return;
      // Sideways on a phone the board's pieces sit straight in the page grid, and nothing scales.
      const flat = getComputedStyle(s).display === "contents";
      const cs = getComputedStyle(s);
      const padY = parseFloat(cs.paddingTop || "0") + parseFloat(cs.paddingBottom || "0");
      const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
      const w = b.offsetWidth, h = b.offsetHeight, room = s.clientHeight - padY;
      const scale = flat ? 1 : Math.min(1, room / Math.max(1, h), (s.clientWidth - padX) / Math.max(1, w));
      // The felt goes in the middle of the room between the score strip and your actions, as far as the whole board
      // still fits: the felt holds still while lines come and go under it. Whole pixels, so the cards stay crisp.
      const felt = b.querySelector<HTMLElement>("[data-felt]");
      const box = b.getBoundingClientRect(), shown = box.height / Math.max(1, h);
      const mid = felt ? (felt.getBoundingClientRect().top + felt.getBoundingClientRect().height / 2 - box.top) / Math.max(0.01, shown) : h / 2;
      const top = flat ? 0 : Math.max(0, Math.min(room - h * scale, Math.floor(room / 2 - mid * scale)));
      setFit((prev) => (prev.scale === scale && prev.w === w && prev.h === h && prev.top === top ? prev : { scale, w, h, top }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    if (boardRef.current) ro.observe(boardRef.current);
    return () => ro.disconnect();
  }, [hasView]);
  // Your card flies to the table from where it sat in your hand: start it at that spot and size, then let card-play run.
  useLayoutEffect(() => {
    const from = launch.current;
    if (!from || !displayedTrick?.plays.some((p) => p.card === from.card)) return;
    launch.current = null;
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-trick-card="${from.card}"]`);
    const slot = el?.parentElement;
    if (!el || !slot || motion === "off") return;
    const to = slot.getBoundingClientRect();
    const scale = to.width / Math.max(1, el.offsetWidth) || 1;
    const dx = (from.rect.left + from.rect.width / 2 - (to.left + to.width / 2)) / scale;
    const dy = (from.rect.top + from.rect.height / 2 - (to.top + to.height / 2)) / scale;
    el.style.setProperty("--fx", `${dx}px`);
    el.style.setProperty("--fy", `${dy}px`);
    el.style.setProperty("--fr", "0deg");
    el.style.setProperty("--fs", `${from.rect.width / Math.max(1, to.width)}`);
    el.style.setProperty("--fo", "1");
    // Measuring started the animation from the old spot; restart it from the new one.
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }, [displayedTrick, motion]);
  // Meld lies on the table in front of each player from the lay-down until the first card is led.
  // Yours joins it once you confirm: until then a new lay-down replaces the old one, so every card stays pickable.
  const laidOf = useCallback((seat: SeatIndex): CardId[] => {
    if (!view || view.revealed) return [];
    const out = view.phase === "melding" ? seat !== view.seat || view.meldConfirmed[seat] : view.phase === "playing" && view.playedCards.length === 0;
    return out ? sortHand([...new Set((view.melds[seat] ?? []).flatMap((m) => m.cards))], view.trump, cardPrefs.sort) : [];
  }, [view, cardPrefs.sort]);
  // Lead while the last trick still rests on the table and your card waits, lifted in your hand, until the table shows it.
  const unshown = view?.currentTrick?.plays.find((p) => p.seat === view.seat && !displayedTrick?.plays.some((d) => d.card === p.card))?.card ?? null;
  const hand = useMemo(() => {
    if (!view) return [];
    // Once play starts your meld is back in your hand to be played, even while it still shows on the table.
    const laid = new Set(view.phase === "melding" ? laidOf(view.seat) : []);
    const cards = (view.claim ? view.claim.hands[view.seat] : view.revealed ? view.revealed[which][view.seat] ?? [] : view.hand).filter((c) => !laid.has(c));
    if (unshown) cards.push(unshown);
    return sortHand(cards, view.trump, cardPrefs.sort);
  }, [view, cardPrefs.sort, which, laidOf, unshown]);
  // After each move, and when a played card leaves the hand (the trick shows it later than the move lands).
  useEffect(() => {
    const row = handRef.current;
    if (!handFocused.current || !row) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== row) {
      if (!inFocusZone(active)) handFocused.current = false;
      return;
    }
    // Your playable card, else the first live action (a bid or pass button), else the hand's tab stop.
    const card = row.querySelector<HTMLButtonElement>("[data-hand-card]:not([aria-disabled=true])");
    const yours = view?.turn === view?.seat || (view?.phase === "melding" && !view.meldConfirmed[view.seat]);
    const action = yours ? actionRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
    // Melding starts at "Lay down all meld"; picking cards is the less common path.
    if (action && (view?.phase === "melding" || !card)) action.focus({ preventScroll: true });
    else focusHand();
  }, [view, hand, focusHand]);
  const revealedFor = (seat: SeatIndex): CardId[] | undefined => view?.claim ? sortHand(view.claim.hands[seat], view.trump, cardPrefs.sort)
    : view?.revealed ? sortHand(view.revealed[which][seat] ?? [], view.trump, cardPrefs.sort) : undefined;

  // The table has no header, so until the board loads (or if it cannot, say for someone without a seat) keep a way out.
  if (!view) {
    return (
      <div className="flex-1 px-6 py-6 text-chalk-faint">
        <p>{error ?? "Dealing."}</p>
        {!local && <Link href="/" className="tap-link mt-2 inline-flex underline underline-offset-4 hover:text-chalk">Back to your tables</Link>}
      </div>
    );
  }

  const myTeam = teamOf(view.seat);
  const rel = (seat: SeatIndex): 0 | 1 | 2 | 3 => (((seat - view.seat + 4) % 4) as 0 | 1 | 2 | 3);
  const seatAt = (r: number): SeatIndex => (((view.seat + r) % 4) as SeatIndex);
  const isMyTurn = view.turn === view.seat;
  const picking = view.legal.mustPassCount !== null || view.legal.canDeclareMeld;
  // Picking your own meld: outline every card that scores, so nothing is missed.
  const meldable = new Set(view.phase === "melding" && !cardPrefs.autoMeld && view.trump && view.legal.canDeclareMeld ? autoMeldSelection(view.hand, view.trump) : []);

  function play(card: CardId) {
    setArmed(null);
    // Measure the card's slot, not the card, so a lift still under way doesn't matter; it flies from the lifted spot.
    const slot = handRef.current?.querySelector(`[data-hand-card="${card}"]`)?.parentElement?.getBoundingClientRect();
    launch.current = slot ? { card, rect: new DOMRect(slot.x, slot.y - LIFT_PX, slot.width, slot.height) } : null;
    setSending(card);
    void act({ type: "play_card", card }).then((next) => {
      if (!next || next.hand.includes(card)) launch.current = null;
      setSending(null);
    });
  }

  function toggle(card: CardId, timed: boolean) {
    // One action at a time; a press while the last is in flight would clear the card being sent.
    if (busy || updatingRef.current) return;
    if (view!.phase === "playing") {
      if (!view!.legal.playableCards.includes(card)) return;
      if (cardPrefs.confirmPlay) {
        // A quick second tap plays the card; coming back to it later puts it down. Keyboard and screen-reader
        // presses (untimed, see isTimedActivation) can't be quick, so for them any second press plays.
        // The Play button always plays.
        const next = secondPress(armed, card, view!.rev, timed);
        if (next === "arm") { setArmed({ card, rev: view!.rev, open: true, timed }); return; }
        if (next === "put-back") { setArmed(null); return; }
      }
      play(card);
      return;
    }
    if (!picking) return;
    setSelected((s) => (s.includes(card) ? s.filter((c) => c !== card) : [...s, card]));
  }

  // Seeing the last trick again: the centre shows it, the status above your hand says who took it.
  const lastTrick = view.lastTrick && view.lastTrick.winner !== null ? view.lastTrick : null;
  const peeking = !!lastTrick && view.phase === "playing" && peekRev === view.rev;
  const showingLast = !!lastTrick && displayedTrick?.winner != null && displayedTrick.plays.every((p, i) => p.card === lastTrick.plays[i].card);
  const peek = { last: peeking ? lastTrick : null, can: !!lastTrick && view.phase === "playing" && !showingLast,
    toggle: () => setPeekRev((r) => (r === view.rev ? null : view.rev)) };
  // The cloth is not read out, so say what the last trick held when it is shown again.
  const peekSpoken = peeking && lastTrick ? `Last trick, ${nameOf(lastTrick.winner!)} took it: ${lastTrick.plays.map((p) => `${nameOf(p.seat)}, ${cardName(p.card)}`).join("; ")}` : null;

  const armedCard = armed && armed.rev === view.rev && isMyTurn && view.phase === "playing" && view.legal.playableCards.includes(armed.card) ? armed.card : null;
  const trickCards = displayedTrick;
  const constraintText = constraintSentence(view);
  function showHint() {
    if (!constraintText) return;
    setCardHint(constraintText);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setCardHint(null), 1500);
  }
  const hostHere = snap.table.host === me.id && view.phase === "playing";
  const standInFor = (seat: SeatIndex) => {
    if (!hostHere || seat === view.seat || isBot(seat)) return undefined;
    if (!snap.seats.some((x) => x.seat === seat && x.user_id)) return undefined;
    return { away: awaySeat === seat, run: () => standIn(seat, nameOf(seat)) };
  };
  const makeHostFor = (seat: SeatIndex) => {
    const uid = snap.seats.find((x) => x.seat === seat)?.user_id;
    if (snap.table.host !== me.id || !uid || uid === me.id || isBot(seat)) return undefined;
    return () => makeHost(uid, nameOf(seat));
  };
  const paused = snap.paused ?? null;
  const isHostNow = snap.table.host === me.id;
  const canResume = !!paused && (paused.by === me.id || isHostNow);
  const readySeats = (view as PlayerView & { ready?: SeatIndex[] }).ready ?? [];
  const humanSeats = snap.seats.filter((x) => x.user_id).map((x) => x.seat);
  const isReady = (seat: SeatIndex) => readySeats.includes(seat) || snap.seats.find((x) => x.seat === seat)?.user_id === snap.table.host;
  const readyNames = humanSeats.filter(isReady).map(nameOf);
  const waitingNames = humanSeats.filter((s) => !isReady(s)).map(nameOf);
  // Finished games replay for anyone; while a game is going, only seated players may, and only if the table reveals hands.
  const replayable = view.phase === "game_over" || (view.history.length > 0 && snap.mySeat !== null && view.rules.revealHands);
  const replayHref = snap.table.current_game_id && replayable ? `/replay/${snap.table.current_game_id}` : null;
  const readyInfo = view.phase === "hand_over" && snap.seats.filter((x) => x.user_id).length > 1
    ? { me: isReady(view.seat), all: waitingNames.length === 0, readyNames, waitingNames, post: postReady } : null;
  // Tighten the fan until it fits the row; scroll only once cards would get too thin to tap.
  const handCount = view.sittingOut === view.seat && view.phase === "playing" ? view.handCounts[view.seat] : hand.length;
  const baseStep = cardW * (cardW < 60 ? 0.42 : 0.5);
  const fitStep = handW > 0 && handCount > 1 ? (handW - cardW) / (handCount - 1) : baseStep;
  const step = Math.max(Math.max(20, cardW * 0.34), Math.min(baseStep, fitStep));
  const overlap = cardW - step;
  const scrollHand = handW > 0 && cardW + (handCount - 1) * step > handW + 0.5;

  // Numbers only beside each name; the breakdown is a tap away. The other side's meld and totals hide with the preference, bids never do.
  const sum = (seat: SeatIndex) => (view.melds[seat] ?? []).reduce((n, m) => n + m.points, 0);
  const facts: ScoreFacts = {
    sittingOut: view.sittingOut, phase: view.phase, handNumber: view.handNumber, dealer: view.dealer, bidder: view.bidder, highBid: view.highBid, trump: view.trump, bids: view.bids,
    meldPoints: { 0: sum(0), 1: sum(1), 2: sum(2), 3: sum(3) }, melds: view.melds, counters: view.recap.counters, history: view.history,
  };
  const over = view.phase === "hand_over" || view.phase === "game_over";
  const hidePoints = hideOpponentPoints && !over;
  const scoreOf = (seat: SeatIndex): SeatScore => {
    const score = seatScore(facts, seat, nameOf, view.phase === "melding");
    // Nothing to count until a seat has laid down or said it has no meld.
    if (view.phase === "melding" && !view.meldConfirmed[seat] && !view.melds[seat]?.length) score.small = null;
    return hidePoints && teamOf(seat) !== myTeam && view.phase !== "bidding" ? { ...score, total: null, small: null, top: [], meld: [], rows: [] } : score;
  };
  const fold = folding === outKey && motion !== "off";
  const seatProps = (r: 1 | 2 | 3) => {
    const seat = seatAt(r);
    const s = snap.seats.find((x) => x.seat === seat);
    const uid = s?.user_id ?? null;
    const status = uid ? mates?.[uid] : undefined;
    const person: SeatPerson = { name: nameOf(seat), handle: s?.profile?.handle ?? null, userId: uid, bot: isBot(seat),
      place: `${teamOf(seat) === myTeam ? "Your partner" : "Opponent"}, ${SEAT_LABEL[seat]}` };
    const standIn = standInFor(seat), makeHost = makeHostFor(seat);
    const actions: SeatActions = {
      friend: uid && status ? { status, add: () => addFriend(uid), accept: () => acceptFriend(uid) } : undefined,
      makeHost, standIn, refresh: uid ? refreshMates : undefined,
    };
    return { seat, view, name: person.name, person, actions, score: scoreOf(seat), faceUp: revealedFor(seat), laid: laidOf(seat).length, standIn, compact: short, fold };
  };
  const them: Team = myTeam === "red" ? "blue" : "red";
  const peekingResult = over && !recapOpen && peekKey === `${view.handNumber}-${view.phase}`;
  // The result sheet is modal: while it is up, the board behind it is out of reach.
  const resultModal = over && !menu && !peekingResult && !revealingClaim;
  // The hand's one tab stop: the card last focused, else your first playable card, else the first card.
  const tabStop = rove && hand.includes(rove) ? rove
    : hand.find((c) => view.phase === "playing" ? view.legal.playableCards.includes(c) : picking) ?? hand[0];
  const moveInHand = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const cards = [...(handRef.current?.querySelectorAll<HTMLButtonElement>("[data-hand-card]") ?? [])];
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(cards.length - 1, i + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(0, i - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? cards.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    cards[to].focus();
  };
  const tabs: [MenuTab, string][] = [["score", "Score"], ["hand", "This hand"], ["rules", "Rules"], ["options", "Options"]];
  // What scripts/overlap.mjs should find on screen, so a hand that fails to render (or to be found) fails the check
  // instead of passing it with nothing measured: the hands drawn as cards (a sideways phone shows the others as a count
  // until they are face up), the phase, whether a card of yours can be played now, and whether the end is a claim.
  const myStack = view.sittingOut === view.seat && view.phase === "playing" ? view.handCounts[view.seat] : 0;
  const drawnHands: string[] = ([1, 2, 3] as const).filter((r) => {
    const seat = seatAt(r), faceUp = revealedFor(seat);
    return (faceUp?.length ?? view.handCounts[seat] - laidOf(seat).length) > 0 && (!short || !!faceUp);
  }).map((r) => SIDE[r === 1 ? "left" : r === 2 ? "center" : "right"]);
  if (hand.length + myStack > 0) drawnHands.push("mine");
  // A shooter's claim shows no cards for the partner sitting out (Claim.tsx), so that seat may have no hand at the end.
  const outSeat = view.sittingOut ?? (over ? view.history.at(-1)?.sittingOut ?? null : null);
  const outSide = outSeat == null || outSeat === view.seat ? undefined : SIDE[rel(outSeat) === 1 ? "left" : rel(outSeat) === 2 ? "center" : "right"];
  const layoutFacts = { "data-phase": view.phase, "data-hands": drawnHands.join(" "), "data-sitting-out": outSide,
    "data-can-play": view.phase === "playing" && isMyTurn && view.legal.playableCards.length > 0 ? "" : undefined, "data-claim": view.claim ? "" : undefined };
  const talk = chat && <ChatDock chat={chat} open={talkOpen} setOpen={setTalkOpen} text={talkDraft} setText={setTalkDraft} />;
  const linkCls = "tap-link text-left text-sm text-chalk-faint underline underline-offset-4 hover:text-chalk disabled:opacity-60";

  return (
    // Looking at the table after a hand, the result's buttons run along the bottom (Result.tsx), so the board keeps
    // clear of them; sideways phones put them in the action column instead.
    <div ref={claimRoot} aria-busy={updating || undefined} className={`board relative flex min-h-0 w-full flex-1 flex-col overflow-hidden ${peekingResult ? "pb-[4.5rem] short:pb-0" : ""}`}
      data-motion={motion} {...layoutFacts} style={{ "--pm": `${slideMs}ms`, "--sd": `${holdMs}ms`, "--sm": `${sweepMs}ms` } as React.CSSProperties}>
      <div className={`board-flat flex min-h-0 flex-1 flex-col ${menu ? "lg:pr-[380px]" : ""}`} inert={(menu && !wide) || resultModal ? true : undefined}>
        {/* One slim strip: the hand, the score, and the way to everything else. */}
        <div inert={updating || undefined} className="board-score flex shrink-0 flex-wrap items-center justify-between gap-x-3 px-3 py-1.5 text-sm tabular-nums sm:px-4">
          <p className="min-w-0 truncate">
            <span className="font-semibold">Hand {view.handNumber}</span>
            {view.dealer === view.seat && view.phase === "bidding" && <span className="text-chalk-faint"> · you deal</span>}
            {view.highBid && <span className="text-chalk-faint"> · <span className="text-chalk">{view.highBid.shoot ? "moon" : view.highBid.amount}</span>{view.trump && <span style={{ color: suitInkOnCloth(view.trump, cardPrefs.fourColour) }}>{SUIT_GLYPH[view.trump]}</span>} {nameOf(view.highBid.seat)}</span>}
          </p>
          <p className="whitespace-nowrap short:order-last short:basis-full">
            <span className={myTeam === "red" ? "text-deck-red-soft" : "text-deck-blue-soft"}>Us</span> {view.score[myTeam].toLocaleString()}
            <span className="px-1.5 text-chalk-faint">·</span>
            <span className={them === "red" ? "text-deck-red-soft" : "text-deck-blue-soft"}>Them</span> {hidePoints ? "Hidden" : view.score[them].toLocaleString()}
          </p>
          <button ref={menuButton} type="button" data-overlay="menu" onClick={() => setMenu((o) => !o)} aria-expanded={menu} aria-controls="table-menu"
            className="tap-link -mr-1 text-sm text-chalk-faint underline underline-offset-4 hover:text-chalk">
            Menu
          </button>
        </div>
        {paused && (
          <div inert={updating || undefined} className="board-banner panel mx-2 mb-1 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:mx-auto sm:w-[min(100%-1rem,760px)]">
            <p className="text-sm">
              {canResume
                ? <>Paused by {paused.by === me.id ? "you" : paused.name}{paused.reason ? `: ${paused.reason}` : ""}.</>
                : <>Paused by {paused.name}{paused.reason ? `: ${paused.reason}` : ""}. Waiting for {paused.name} to come back.</>}
            </p>
            {(canResume || (talk && !resultModal)) && (
              <div className="flex items-center gap-3">
                {canResume && <button type="button" className="btn btn-ink" style={{ height: "2.25rem" }} onClick={resumeTable}>Resume</button>}
                {/* The paused board is out of reach, but a pause is when the table talks; table talk waits here. */}
                {!resultModal && talk}
              </div>
            )}
          </div>
        )}
        {updating ? <p role="status" className="board-note mb-1 shrink-0 text-center text-xs text-chalk-faint">Updating the table…</p>
          : reconnecting && <p role="status" className="board-note mb-1 shrink-0 text-center text-xs text-chalk-faint">Reconnecting to the table.</p>}
        <div aria-disabled={paused || updating ? true : undefined} inert={paused || updating ? true : undefined} className={`board-flat flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-[max(.5rem,env(safe-area-inset-bottom))] sm:px-4 ${paused ? "pointer-events-none opacity-70" : ""}`}>
        {/* Table talk never lies on a hand (scripts/overlap.mjs checks every position and size). On an upright phone or
            tablet it sits in the cloth's top-right corner, under Menu: the partner's row across is narrower than the
            screen and the side seats start below it, so that corner is empty in every phase, while the bottom corner
            meets the right-hand seat's cards on shorter phones and in a hand shown face up. Sideways phones put it at
            the foot of the action column (globals.css). At hand end it moves onto the result sheet. */}
        {talk && !resultModal && !paused && (
          <div className="board-talk relative z-[25] h-0 shrink-0">
            {/* Wide screens centre a narrow hand, which leaves the screen's own bottom corner free. */}
            <div className={`absolute right-0 top-1 short:top-auto short:bottom-1 lg:fixed lg:top-auto lg:bottom-[max(1.25rem,env(safe-area-inset-bottom))] ${menu ? "lg:right-[400px]" : "lg:right-5"}`}>{talk}</div>
          </div>
        )}
        {/* Centred between the score strip and your actions. When the action bar grows or shrinks the board glides to the
            new middle (globals.css, .board-lift) rather than jumping. The stage's padding keeps the side seats' turn rings,
            which stand 2px outside their plates, inside the stage's clip. */}
        <div ref={stage} className="board-flat flex min-h-0 flex-1 items-start justify-center overflow-hidden p-1">
          <div className="board-flat board-lift" style={{ ...(fit.scale < 1 ? { width: fit.w * fit.scale, height: fit.h * fit.scale } : null), transform: fit.top ? `translateY(${fit.top}px)` : undefined }}>
            <div ref={boardRef} className="board-flat w-[min(100vw-2rem,760px)] origin-top-left" style={{ transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined, "--board-scale": fit.scale } as React.CSSProperties}>
              {/* partner across */}
              <OpponentRow className="board-north" align="center" {...seatProps(2)} />
              <div className="board-flat grid grid-cols-[minmax(64px,auto)_minmax(0,1fr)_minmax(64px,auto)] items-center gap-2">
                <OpponentRow className="board-west" align="left" {...seatProps(1)} />
                <Centre compact={short} view={view} trick={trickCards} rel={rel} nameOf={nameOf} stalled={stalled && !paused} nudge={nudge} peek={peek}
                  laid={{ 0: laidOf(seatAt(0)), 1: laidOf(seatAt(1)), 2: laidOf(seatAt(2)), 3: laidOf(seatAt(3)) }} lit={lit}
                  mySeat={<MySeat view={view} me={me} score={scoreOf(view.seat)} profileHref={local ? undefined : "/#profile"} />} />
                <OpponentRow className="board-east" align="right" {...seatProps(3)} />
              </div>
            </div>
          </div>
        </div>

        {/* action bar: as tall as what it holds, so a waiting player's board has the whole room to centre in. */}
        <div ref={actionRef} {...keepFocus} data-overlay-zone="action" className="board-action mt-1 shrink-0 sm:mt-2">
          <ActionBar key={view.rev} view={view} selected={selected} busy={busy || updating} act={act} nameOf={nameOf} autoMeld={cardPrefs.autoMeld} />
          {/* Whose turn it is lives here, by your hand, so the cloth holds only the cards. */}
          {view.phase === "playing" && (
            <PlayStatus view={view} trick={trickCards} nameOf={nameOf} peek={peek} stalled={stalled && !paused} nudge={nudge} compact={short}
              busy={busy || updating} claim={() => void act({ type: "claim" })} armed={armedCard ? { card: armedCard, play: () => play(armedCard) } : null} />
          )}
          {(view.phase === "bidding" || (view.phase === "melding" && view.trump)) && (
            <MeldLine key={view.phase} rules={view.rules} hand={view.hand} trump={view.phase === "melding" ? view.trump : null} lit={lit} setLit={setLit} />
          )}
          {/* In the flow, not over the hand, so it never lands on the meld chips. */}
          {view.melds[view.seat]?.length > 0 && view.phase === "melding" && (
            <p className="mt-1 text-center text-xs text-brass">
              Laid down for {view.melds[view.seat].reduce((n, m) => n + m.points, 0)}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-deck-red-soft">{error}</p>}
        </div>

        {/* my hand */}
        <div ref={handRef} tabIndex={-1} {...keepFocus} data-hand="mine" data-hand-cards={hand.length + myStack} role="group" aria-label="Your hand" onKeyDown={moveInHand} className={`board-hand relative mt-1 flex shrink-0 outline-none sm:mt-2 ${scrollHand ? "hand-scroll overflow-x-auto" : "justify-center"}`} style={{ minHeight: (cardW * 7) / 5 + (short ? 8 : 20), paddingTop: scrollHand ? 16 : undefined }}>
          <div className={`flex items-end ${scrollHand ? "mx-auto w-max" : ""}`} style={{ paddingLeft: overlap }}>
            {/* Your partner is shooting: your cards are set aside in a small stack, in the room the fan had. */}
            {view.sittingOut === view.seat && view.phase === "playing" && (
              <SitOutStack n={view.handCounts[view.seat]} team={teamOf(view.seat)} cardW={cardW} step={step} orient="row" fold={fold} token={28}
                label="Your cards are set aside; you sit this hand out" style={{ marginLeft: -overlap }} />
            )}
            {hand.map((c) => {
              const playable = view.phase === "playing" ? view.legal.playableCards.includes(c) || c === unshown : picking;
              const isArmed = armedCard === c;
              const sel = selected.includes(c) || isArmed || c === sending || c === unshown;
              // The ring says a tap plays it; a lifted card without one goes back down when tapped.
              const ringed = (sel && !isArmed) || (isArmed && armed!.open);
              const blocked = view.phase === "playing" && isMyTurn && !playable && !!constraintText;
              return (
                <span key={c} data-claim-card={view.claim ? c : undefined} data-keep-armed={isArmed || armedCard ? "" : undefined} className="shrink-0" style={{ marginLeft: -overlap }} onClick={() => { if (view.phase === "playing" && isMyTurn && !playable) showHint(); }}>
                  <button data-hand-card={c}
                    onPointerDown={(e) => { lastPress.current = { card: c, pointerId: e.pointerId, real: isRealPress(e.pointerType, window.matchMedia("(any-pointer: fine)").matches), upAt: null }; }}
                    onPointerUp={(e) => { lastPress.current = releasePress(lastPress.current, c, e.pointerId, e.timeStamp); }}
                    onPointerCancel={() => { lastPress.current = null; }}
                    onClick={(e) => { const timed = isTimedActivation(lastPress.current, c, e.timeStamp, e.detail); lastPress.current = null; toggle(c, timed); }}
                    // Unplayable cards stay focusable, so the hand can be read with the keyboard and a press says why.
                    aria-disabled={!playable || undefined} aria-pressed={sel} aria-describedby={blocked ? `${handId}-why` : undefined}
                    tabIndex={c === tabStop ? 0 : -1} onFocus={() => setRove(c)}
                    className="group relative block touch-manipulation rounded-[10px] focus-visible:z-20 aria-disabled:cursor-default"
                    style={{ transform: sel || lit?.includes(c) ? `translateY(-${LIFT_PX}px)` : undefined, transition: "transform .14s ease" }}>
                    {suggested?.includes(c) && <SuggestedMark />}
                    <PlayingCard card={c} width={cardW} prefs={cardPrefs} trump={splitCard(c).suit === view.trump} selected={ringed || (lit?.includes(c) ?? false)} dimmed={(view.phase === "playing" && isMyTurn && !playable) || (lit !== null && !lit.includes(c))}
                      {...(meldable.has(c) && !sel ? { style: { boxShadow: "0 0 0 2px var(--brass), var(--shadow-card)" }, title: `${cardName(c)}, scores in your meld` } : {})} />
                  </button>
                </span>
              );
            })}
          </div>
          {/* Always mounted, so screen readers hear each change; empty when there is nothing to say. */}
          <p role="status" className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-chalk-faint whitespace-nowrap">
            {(armedCard || cardHint) && view.phase === "playing" && isMyTurn
              ? armedCard ? `${cardName(armedCard)}, ${!armed!.open ? "tap to put it back" : armed!.timed ? "tap again to play" : "press again to play"}` : cardHint
              : ""}
          </p>
          {constraintText && <span id={`${handId}-why`} hidden>Not playable. {constraintText}</span>}
        </div>
        </div>
      </div>
      {over && !menu && !revealingClaim && (() => {
        const key = `${view.handNumber}-${view.phase}`;
        return <div {...keepFocus} inert={updating || undefined}><ResultSheet local={local} view={view} nameOf={nameOf} host={isHostNow ? null : snap.seats.find((x) => x.user_id === snap.table.host)?.profile?.display_name ?? "the host"}
          busy={busy || updating} onNext={() => act({ type: "next_hand" })} onRematch={rematch} readyInfo={readyInfo}
          countdown={{ handKey: `${snap.table.id}-${code}-${key}`, blocked: !!paused || !!error || reconnecting || snap.table.status !== "playing",
            onNext: countdownNext }}
          which={which} setWhich={setWhich} peek={peekKey === key} setPeek={(p) => setPeekKey(p ? key : null)} replayHref={replayHref}
          talk={resultModal ? talk : undefined} /></div>;
      })()}
      <Announcer view={view} nameOf={nameOf} seats={snap.seats} paused={paused} myId={me.id} peek={peekSpoken} />

      {menu && <button inert={updating || undefined} type="button" aria-label="Close the menu" tabIndex={-1} onClick={() => setMenu(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}
      <aside id="table-menu" aria-label="Table menu" hidden={!menu} inert={updating || undefined}
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-cloth-deep pt-[env(safe-area-inset-top)] shadow-2xl sm:w-[380px] lg:border-l lg:border-chalk-ghost">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <p className="flex items-baseline gap-2 text-sm text-chalk-faint">
            Table <span className="code text-chalk" style={{ fontSize: 22, letterSpacing: ".14em" }}>{code}</span>
          </p>
          <button ref={closeButton} type="button" onClick={() => setMenu(false)} className="tap-link -mr-2 shrink-0 text-sm text-chalk-faint underline underline-offset-4 hover:text-chalk">Close</button>
        </div>
        <div role="tablist" aria-label="Menu" className="mx-4 mt-2 flex gap-1 rounded-full bg-black/25 p-1 text-sm"
          onKeyDown={(e) => {
            // Arrow keys move between tabs, Home and End jump to either end; focus follows the selection.
            const i = tabs.findIndex(([t]) => t === tab);
            const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
            if (to < 0) return;
            e.preventDefault();
            setTab(tabs[to][0]);
            document.getElementById(`menu-tab-${tabs[to][0]}`)?.focus();
          }}>
          {tabs.map(([t, label]) => (
            <button key={t} type="button" role="tab" id={`menu-tab-${t}`} aria-selected={tab === t} aria-controls={`menu-panel-${t}`} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}
              className={`min-h-11 flex-1 whitespace-nowrap rounded-full px-2 ${tab === t ? "bg-chalk text-ink" : "text-chalk-faint hover:text-chalk"}`}>{label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {tab === "score" && (
            <div role="tabpanel" id="menu-panel-score" aria-labelledby="menu-tab-score">
              <Scorepad view={view} myTeam={myTeam} nameOf={nameOf} hideOpponentPoints={hidePoints} />
            </div>
          )}
          {recapOpen && (
            <div role="tabpanel" id="menu-panel-hand" aria-labelledby="menu-tab-hand">
              <Recap view={view} nameOf={nameOf} lastSeenRev={lastSeenRev} />
            </div>
          )}
          {tab === "rules" && (
            <div role="tabpanel" id="menu-panel-rules" aria-labelledby="menu-tab-rules" tabIndex={0}>
              <p className="text-sm font-semibold text-chalk">House rules</p>
              <div className="panel mt-2 p-4"><RulesForm value={view.rules} compact /></div>
            </div>
          )}
          {tab === "options" && (
            <div role="tabpanel" id="menu-panel-options" aria-labelledby="menu-tab-options" className="flex flex-col gap-4">
              <p className="text-sm text-chalk-faint">
                {SEAT_LABEL[view.seat]} · <span className={myTeam === "red" ? "text-deck-red-soft" : "text-deck-blue-soft"}>{myTeam} team</span>
                {view.trump && <> · trump {SUIT_NAME[view.trump]}</>}
              </p>
              {!local && <NameChange name={me.display_name} onSaved={onTableChange} />}
              <div className="flex flex-col items-start">
                <button type="button" onClick={toggleChime} aria-pressed={chime} className={linkCls}>Sound {chime ? "on" : "off"}</button>
                {push.supported && view.rules.pace === "leisurely" && (
                  <button type="button" onClick={() => void (push.enabled ? push.disable() : push.enable())} disabled={push.busy} aria-pressed={push.enabled} className={linkCls}>
                    {push.busy ? "Turning on…" : push.enabled ? "Notifications on" : "Notify me"}
                  </button>
                )}
                {push.error && push.supported && view.rules.pace === "leisurely" && <p role="status" className="text-xs text-chalk-faint">{push.error}</p>}
                {replayHref && <Link href={replayHref} className={linkCls}>Review the game</Link>}
                {!local && view.phase !== "game_over" && snap.mySeat !== null && !paused && <button type="button" onClick={() => { setMenu(false); void pauseTable(); }} className={linkCls}>Pause the table</button>}
                {!local && view.phase !== "game_over" && snap.mySeat !== null && <button type="button" onClick={leave} className={linkCls}>Leave the game</button>}
                {!local && <Link href="/" className={linkCls}>Your tables</Link>}
              </div>
              <div className="panel flex flex-col gap-2.5 p-3 text-left">
                <p className="text-sm font-semibold text-ink">Cards</p>
                <CardOptionsPanel trump={view.trump} />
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * A coach suggestion on a card in your hand: a chalk-dashed outline, plus a chalk dot above the
 * corner index that stays visible where the next card overlaps. Selection (lifted, brass ring) and
 * the pick-your-own meld outline (solid brass) both read differently.
 */
function SuggestedMark() {
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute -inset-1 z-[1] rounded-[13px] border-2 border-dashed border-chalk">
        <span className="absolute -top-[11px] left-[8px] size-1.5 rounded-full bg-chalk" />
      </span>
      <span className="sr-only">Suggested: </span>
    </>
  );
}

/** What a shoot after the pass would stake, against the bid it replaces. */
function shootStake(view: PlayerView, nameOf: (s: SeatIndex) => string): string {
  const who = view.bidder === null ? "The bidder" : nameOf(view.bidder);
  if (who !== "You") return `${who} may shoot the moon. Their partner sits out; they must take every trick.`;
  const wins = view.score[teamOf(view.bidder!)] + view.rules.target >= view.rules.target;
  return `Your partner sits out; take every trick and your side gains ${view.rules.target} points${wins ? "; that wins the game" : ""}.`;
}

/** "You are shooting the moon" or "West is shooting the moon". */
function shootLine(who: string): string {
  return `${who} ${who === "You" ? "are" : "is"} shooting the moon`;
}

const REV_W = 36;
/** Where a seat sits from your chair, for `data-hand` (scripts/overlap.mjs finds the hands by it). */
const SIDE = { left: "west", center: "north", right: "east" } as const;
const MELD_W = 28;

/** A player round the table: the name chip with its score tag, then their cards (backs while playing, face up at the end). */
function OpponentRow({ seat, view, name, person, actions, align, score, laid, standIn, faceUp, compact = false, fold = false, className = "" }: {
  faceUp?: CardId[]; seat: SeatIndex; view: PlayerView; name: string; align: "left" | "center" | "right"; score: SeatScore;
  person: SeatPerson; actions: SeatActions;
  /** how many of their cards lie on the table as meld */
  laid: number;
  /** the host may hand this seat to a computer; `away` puts the offer out on the table, not only in the menu */
  standIn?: { away: boolean; run: () => void }; compact?: boolean; className?: string;
  /** the shoot was just declared: this seat's cards fold away as you watch */
  fold?: boolean;
}) {
  const four = useCardPrefs().prefs.fourColour;
  // The engine keeps meld in the hand; while it lies on the table it is not among the backs.
  const n = faceUp?.length ?? view.handCounts[seat] - laid;
  const team = teamOf(seat);
  const sittingOut = view.sittingOut === seat;
  const active = view.turn === seat;
  const vertical = align !== "center";
  const side = SIDE[align];
  const items = align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
  const chip = (
    <>
      <span className="relative shrink-0">
        <Avatar name={name} team={team} size={28} bot={person.bot} />
        {score.dealer && <DealerMark />}
      </span>
      <span className={`truncate text-xs font-semibold ${compact ? "max-w-[88px]" : "max-w-[96px] sm:text-sm"}`}>{name}{score.dealer && <span className="sr-only">, dealer</span>}{active && <span className="sr-only">, their turn</span>}</span>
      {/* After the name, as your own chip reads ("You sitting out"). */}
      {sittingOut && <span className="text-xs text-chalk-faint">sitting out</span>}
    </>
  );
  if (compact) {
    return <CompactSeat {...{ seat, className, team, active, name, person, actions, chip, score, n, faceUp, standIn, align }} setAside={sittingOut && !faceUp} />;
  }
  return (
    // Side seats hang from the same line at the top of their row, so a longer fan (sixteen cards while passing, a bid under
    // the name) grows downwards on its own side and never pushes its plate out of line with the other side's.
    <div data-claim-seat={seat} className={`group flex flex-col ${items} gap-1 py-1 sm:gap-1.5 sm:py-2 min-w-0 ${vertical ? "self-start pt-6 sm:pt-8" : ""} ${className}`}>
      <div className={`relative flex max-w-full items-center ${vertical ? "flex-col" : "flex-row"}`}>
        <PlayerMenu person={person} team={team} actions={actions} align={align} plate={side}
          className={`flex ${vertical ? "flex-col" : "flex-row"} items-center gap-1 sm:gap-2 rounded-2xl px-2 py-1 max-w-full`}
          style={active ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
          {chip}
        </PlayerMenu>
        {/* Out of the layout flow, so nothing moves when a number appears. */}
        <div className={vertical ? "flex h-7 items-center" : "absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap"}>
          <ScoreTag score={score} name={name} align={align} />
        </div>
      </div>
      {/* A shoot sets this hand aside: a small stack where the fan was, until the hand is shown at the end. */}
      {sittingOut && !faceUp ? (
        <SitOutStack n={n} team={team} cardW={34} step={vertical ? (34 * 7) / 5 - 40 : 10} pad={7} orient={vertical ? align as "left" | "right" : "row"}
          fold={fold} label={`${name} sits this hand out; cards set aside`} hand={side} handCards={n} />
      ) : <div data-hand={side} data-hand-cards={n} className={`flex ${vertical ? "flex-col" : "flex-row"}`} style={vertical ? { padding: "0 7px" } : undefined} role={faceUp ? "group" : "img"} aria-label={`${n} cards`}>
        {faceUp ? faceUp.map((c, i) => vertical ? (
          <div key={c} data-claim-card={view.claim ? c : undefined} className="relative shrink-0" style={{ width: (REV_W * 7) / 5, height: i === faceUp.length - 1 ? REV_W : 17, zIndex: align === "right" ? faceUp.length - i : i }}>
            <PlayingCard card={c} width={REV_W} fourColour={four} style={{ position: "absolute", left: "50%", top: REV_W / 2, transform: `translate(-50%, -50%) rotate(${align === "left" ? 90 : -90}deg)` }} />
          </div>
        ) : <span key={c} data-claim-card={view.claim ? c : undefined} style={{ marginLeft: i ? -REV_W * 0.45 : 0 }}><PlayingCard card={c} width={REV_W} fourColour={four} /></span>)
        : Array.from({ length: n }).map((_, i) => (
          <CardBack key={i} width={34} team={team}
            style={vertical ? { marginTop: i ? -40 : 0, transform: align === "left" ? "rotate(90deg)" : "rotate(-90deg)" } : { marginLeft: i ? -24 : 0 }} />
        ))}
      </div>}
      {/* Handing a seat over and making a host live in the player's menu; a seat that seems away also says so here. */}
      {standIn?.away && (
        <button type="button" onClick={standIn.run}
          className={`max-w-[200px] text-xs text-chalk-faint underline hover:text-chalk ${align === "center" ? "text-center" : align === "left" ? "text-left" : "text-right"}`}>
          {name} seems to be away. Hand to a computer
        </button>
      )}
    </div>
  );
}

/**
 * An opponent on a phone held sideways: name, turn ring and a card count in place of the fanned backs.
 * Hands shown at the end stay face up in a tight overlapping fan; across the table it goes under the name, since
 * beside it the fan would be squeezed into a tall column down the middle of the screen.
 */
function CompactSeat({ seat, className, team, active, name, person, actions, chip, score, n, faceUp, standIn, align, setAside }: {
  seat: SeatIndex; setAside: boolean; person: SeatPerson; actions: SeatActions;
  className: string; team: Team; active: boolean; name: string; chip: React.ReactNode; score: SeatScore; n: number;
  faceUp?: CardId[]; standIn?: { away: boolean; run: () => void }; align: "left" | "center" | "right";
}) {
  const across = align === "center";
  return (
    <div data-claim-seat={seat} className={`flex min-w-0 items-center ${!across ? "flex-col gap-2" : faceUp ? "flex-col gap-1" : "flex-row justify-center gap-2"} ${className}`}>
      <div className={`relative flex max-w-full items-center ${across ? "flex-row" : "flex-col"}`}>
        <PlayerMenu person={person} team={team} actions={actions} align={align} plate={SIDE[align]}
          className={`flex max-w-full items-center gap-x-2 gap-y-0.5 rounded-2xl px-2 py-1 ${across ? "flex-row" : "flex-col"}`}
          style={active ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
          {chip}
          {!faceUp && (
            setAside
              // The count keeps its room, so the chip holds its size; the small back alone marks the hand set aside.
              ? <span className="flex items-center gap-1 text-xs tabular-nums text-chalk-faint" role="img" aria-label={`${name} sits this hand out; cards set aside`}>
                <CardBack width={12} team={team} style={{ opacity: 0.6, transform: "rotate(-4deg)" }} /><span aria-hidden className="invisible">{n}</span>
              </span>
              : <span className="flex items-center gap-1 text-xs tabular-nums text-chalk-faint" role="img" aria-label={`${n} cards`}>
                <CardBack width={12} team={team} />{n}
              </span>
          )}
        </PlayerMenu>
        <div className={across ? "absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap" : "flex h-7 items-center"}>
          <ScoreTag score={score} name={name} align={align} />
        </div>
      </div>
      {faceUp && faceUp.length > 0 && <SmallFan cards={faceUp} perRow={across ? faceUp.length : 5} label={`${n} cards`} hand={SIDE[align]} />}
      {/* As on an upright phone: no hover here, so the hand-off shows once a seat seems away, and making a host waits for a bigger screen. */}
      {standIn?.away && (
        <button type="button" onClick={standIn.run} className="tap max-w-[120px] text-center text-xs text-chalk-faint underline hover:text-chalk">
          {name} seems to be away. Hand to a computer
        </button>
      )}
    </div>
  );
}

/** Small face-up cards overlapping so each shows only its corner index, wrapping after `perRow`. */
function SmallFan({ cards, perRow, label, width = MELD_W, lit, hand }: { cards: CardId[]; perRow: number; label: string; width?: number; lit?: CardId[] | null; hand?: string }) {
  const four = useCardPrefs().prefs.fourColour;
  const w = width, h = (w * 7) / 5, peekX = Math.round(w / 2), peekY = Math.round(w * 0.72);
  const cols = Math.min(perRow, cards.length);
  return (
    <div data-hand={hand} data-hand-cards={hand ? cards.length : undefined} className="flex flex-wrap" role="group" aria-label={label} title={label}
      style={{ width: w + (cols - 1) * peekX + 0.5, paddingLeft: w - peekX, paddingTop: h - peekY }}>
      {cards.map((c) => <span key={c} data-claim-card={c} style={{ marginLeft: peekX - w, marginTop: peekY - h, flexShrink: 0 }}><PlayingCard card={c} width={w} fourColour={four} selected={lit?.includes(c) ?? false} /></span>)}
    </div>
  );
}

/** Meld by suit while bidding, or the trump suit's items once trump is named. Tapping lights the cards in your hand. */
function MeldLine({ rules, hand, trump, lit, setLit }: { rules: PlayerView["rules"]; hand: CardId[]; trump: Suit | null; lit: CardId[] | null; setLit: (c: CardId[] | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => meldBySuit(hand, rules), [hand, rules]);
  const same = (a: CardId[]) => lit !== null && lit.length === a.length && a.every((c) => lit.includes(c));
  const pick = (key: string, cards: CardId[]) => {
    if (open === key) { setOpen(null); setLit(null); } else { setOpen(key); setLit(cards); }
  };
  useEffect(() => () => setLit(null), [setLit]);
  const worth = all.filter((x) => x.total > 0);
  const four = useCardPrefs().prefs.fourColour;
  if (trump) {
    const mine = all.find((x) => x.suit === trump);
    if (!mine || mine.items.length === 0) return <p className="mt-2 text-center text-xs text-chalk-faint">No meld in {SUIT_NAME[trump]}.</p>;
    return (
      <div className="mt-2 mb-1.5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-3 text-xs text-chalk-faint">
        <span>Your meld, tap to see it:</span>
        {mine.items.map((it, i) => {
          const key = `${i}`, on = open === key && same(it.cards);
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => pick(key, it.cards)}
              className={`hit inline-flex h-8 min-w-11 items-center justify-center rounded-full px-2.5 text-chalk ${on ? "bg-chalk text-[color:var(--pip-black)]" : "bg-white/10 hover:bg-white/20"}`}>
              {itemLabel(it)} {it.points}
            </button>
          );
        })}
      </div>
    );
  }
  if (worth.length === 0) return <p className="mt-2 text-center text-xs text-chalk-faint">No meld yet.</p>;
  const shown = worth.find((x) => x.suit === open);
  return (
    <div className="mt-2 text-center text-xs text-chalk-faint">
      <div className="mb-1.5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-3">
        <span>Your meld, tap a suit:</span>
        {worth.map((x) => {
          const on = open === x.suit;
          return (
            <button key={x.suit} type="button" aria-pressed={on} onClick={() => pick(x.suit, x.cards)}
              className={`hit inline-flex h-8 min-w-11 items-center justify-center gap-1 rounded-full px-2.5 ${on ? "bg-chalk" : "bg-white/10 hover:bg-white/20"}`}>
              <span style={{ color: on ? suitInk(x.suit, four) : suitInkOnCloth(x.suit, four) }}>{SUIT_GLYPH[x.suit]}</span>
              {" "}<span className={on ? "text-[color:var(--pip-black)]" : "text-chalk"}>{x.total}</span>
            </button>
          );
        })}
      </div>
      {shown && (
        <p className="mt-1.5 text-chalk" role="status">
          {shown.items.map(itemLabel).map((l, i) => `${l} ${shown.items[i].points}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Seeing the last trick again: `last` is set while it shows, `can` when there is one to see. */
type Peek = { last: NonNullable<PlayerView["lastTrick"]> | null; can: boolean; toggle: () => void };

/** Your own chair below the cloth: the same name and score chip as the other three. */
function MySeat({ view, me, score, profileHref }: { view: PlayerView; me: Profile; score: SeatScore; profileHref?: string }) {
  const name = me.display_name;
  const person: SeatPerson = { name, handle: me.handle, userId: me.id, bot: false, place: `You, ${SEAT_LABEL[view.seat]}` };
  return (
    <div data-claim-seat={view.seat} className="flex justify-center py-1">
      <div className="relative flex items-center">
        <PlayerMenu person={person} team={teamOf(view.seat)} actions={{ profileHref }} align="center" placement="above" plate="mine"
          className="flex items-center gap-1 rounded-2xl px-2 py-1 sm:gap-2" style={view.turn === view.seat ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
          <span className="relative shrink-0">
            <Avatar name={name} team={teamOf(view.seat)} size={28} />
            {score.dealer && <DealerMark />}
          </span>
          <span className="text-xs font-semibold sm:text-sm">You{view.sittingOut === view.seat && <span className="ml-1 text-chalk-faint">sitting out</span>}{score.dealer && <span className="sr-only">, dealer</span>}{view.turn === view.seat && <span className="sr-only">, your turn</span>}</span>
        </PlayerMenu>
        {/* Above the side seats' cards, and opening up and over the cloth: below this seat the board ends. */}
        <div className="absolute left-full top-1/2 z-30 ml-1 -translate-y-1/2 whitespace-nowrap">
          <ScoreTag score={score} name="You" align="right" placement="above" />
        </div>
      </div>
    </div>
  );
}

/** A player's name within a line, cut short with an ellipsis when it would not fit; the text keeps all of it for screen readers. */
function Name({ name }: { name: string }) {
  return <span className="min-w-0 truncate" title={name}>{name}</span>;
}

/**
 * Trick play's status, just above your hand: whose turn it is, then what the last trick brought,
 * the rule you must follow, and the way to see the last trick again. Fixed height, so the hand never moves:
 * a long name is cut short, and on an upright phone the second row keeps room for two lines.
 */
function PlayStatus({ view, trick, nameOf, peek, stalled, nudge, compact, busy, claim, armed }: {
  view: PlayerView; trick: PlayerView["currentTrick"]; nameOf: (s: SeatIndex) => string; peek: Peek;
  stalled: boolean; nudge: () => void; compact: boolean;
  busy: boolean; claim: () => void;
  /** a card of yours lifted by a first tap: its Play button takes the place of "Your play." */
  armed: { card: CardId; play: () => void } | null;
}) {
  const mine = view.turn === view.seat;
  const done = !peek.last && !!trick && trick.winner !== null;
  const took = done && view.sittingOut == null ? countersIn(trick, view.rules) : 0;
  const shootStatus = view.sittingOut == null ? null : view.seat === view.sittingOut
    ? "Your partner is shooting the moon. You sit this hand out."
    : view.seat === view.bidder ? "Shooting alone; take every trick."
    : `${nameOf(view.bidder!)} is shooting alone; win one trick to win the game.`;
  const detail = peek.last ? null
    : done ? <><Name name={nameOf(trick.winner!)} />{` took it${took > 0 ? `, ${took} ${took === 1 ? "counter" : "counters"}` : view.sittingOut == null ? ", no counters" : ""}.`}</>
    : mine ? shootStatus ?? constraintSentence(view) ?? "Tap a card to play it."
    : shootStatus;
  const link = "hit whitespace-nowrap text-xs text-chalk-faint underline underline-offset-4 hover:text-chalk";
  // Each line is a single row of text, so a name can shrink inside it while the words round it stay whole.
  const line = "flex min-w-0 max-w-full whitespace-pre";
  return (
    <div data-play-status="" className="flex w-full flex-col items-center text-center pb-5 short:pb-0">
      {/* Rows 44px tall, so each row's controls take a full tap without reaching into the other row's. */}
      <div className="flex h-11 max-w-full items-center gap-3">
        {peek.last ? <p className={`display text-chalk ${line}`} style={{ fontSize: compact ? 17 : 19 }}>Last trick: <Name name={nameOf(peek.last.winner!)} /> took it.</p>
          // In the status's own row, not floating over it: a Play button laid over the bar covered "Last trick" and
          // "Claim all" (scripts/overlap.mjs, the armed screen).
          : mine && armed ? <button type="button" data-keep-armed="" data-overlay="play" data-own-card={armed.card} onClick={armed.play} aria-label={`Play ${cardName(armed.card)}`}
            className="hit btn btn-brass whitespace-nowrap" style={{ height: 32, minHeight: 32, padding: "0 16px" }}>
            Play {SUIT_GLYPH[splitCard(armed.card).suit]}{RANK_LABEL[splitCard(armed.card).rank]}
          </button>
          : mine ? <p className={`display ${line}`} style={{ fontSize: compact ? 19 : 22, color: "var(--brass)" }}>Your play.</p>
          : <p className={`text-sm text-chalk ${line}`}><Name name={nameOf(view.turn!)} /> to play.</p>}
        {view.legal.canClaim && <ClaimButton busy={busy} onClaim={claim} />}
      </div>
      <div className="flex h-11 max-w-full flex-wrap content-center items-center justify-center gap-x-3 text-xs leading-5 text-chalk-faint">
        {detail && <span className={typeof detail === "string" ? "max-w-full truncate" : line}>{detail}</span>}
        {(peek.can || peek.last) && <button type="button" onClick={peek.toggle} className={link}>{peek.last ? "Back to the table" : "Last trick"}</button>}
        {stalled && <button type="button" onClick={nudge} className={link}>Nudge the computers</button>}
      </div>
    </div>
  );
}

function Centre({ view, trick, rel, nameOf, stalled, nudge, peek, compact = false, laid, lit, mySeat }: {
  view: PlayerView; trick: PlayerView["currentTrick"]; rel: (s: SeatIndex) => 0 | 1 | 2 | 3; nameOf: (s: SeatIndex) => string;
  stalled: boolean; nudge: () => void; peek: Peek; compact?: boolean;
  /** your own chair, below the cloth */
  mySeat: React.ReactNode;
  /** each seat's meld lying on the cloth in front of them, by position round the table from you */
  laid: Record<0 | 1 | 2 | 3, CardId[]>;
  /** your meld cards lit from the meld readout */
  lit: CardId[] | null;
}) {
  // Sideways on a phone the trick shrinks to fit between your hand and the seat across.
  const { fourColour: four, trumpTint: tint } = useCardPrefs().prefs;
  const trickW = compact ? 42 : 56;
  const done = !!trick && trick.winner !== null;
  const dim = trick !== view.currentTrick && (view.phase === "hand_over" || view.phase === "game_over");
  const took = done && view.sittingOut == null ? countersIn(trick, view.rules) : 0;
  const spots: Record<0 | 1 | 2 | 3, string> = {
    0: "bottom-0 left-1/2 -translate-x-1/2", 1: "left-0 top-1/2 -translate-y-1/2", 2: "top-0 left-1/2 -translate-x-1/2", 3: "right-0 top-1/2 -translate-y-1/2",
  };
  const meldSpots: Record<0 | 1 | 2 | 3, string> = {
    0: "bottom-[4%] left-1/2 -translate-x-1/2", 1: "left-[5%] top-1/2 -translate-y-1/2", 2: "top-[4%] left-1/2 -translate-x-1/2", 3: "right-[5%] top-1/2 -translate-y-1/2",
  };
  const seatFrom = (r: number) => (((view.seat + r) % 4) as SeatIndex);
  const prompt = (() => {
    const who = view.turn !== null ? nameOf(view.turn) : null;
    switch (view.phase) {
      case "bidding": return who === "You" ? "Your bid." : `${who} is bidding.`;
      case "declaring_trump": return who === "You" ? "Name trump." : `${who} is naming trump.`;
      case "passing_to_bidder": return who === "You" ? `Pass ${view.legal.mustPassCount ?? ""} cards to your partner.` : `${who} is passing to the bidder.`;
      case "passing_back": return who === "You" ? `Pass ${view.legal.mustPassCount ?? ""} cards back.` : `${who} is passing back.`;
      case "deciding_shoot": return who === "You" ? "Shoot the moon?" : `Waiting on ${who}.`;
      case "melding": return view.meldConfirmed[view.seat] ? "Meld is in." : "Lay down your meld.";
      case "hand_over": return view.claim ? `${nameOf(view.claim.seat)} ${nameOf(view.claim.seat) === "You" ? "claim" : "claims"} the rest.` : "Hand over.";
      case "game_over": return view.claim ? `${nameOf(view.claim.seat)} ${nameOf(view.claim.seat) === "You" ? "claim" : "claims"} the rest.` : view.winner ? `${view.winner === "red" ? "Red" : "Blue"} team wins.` : "Game over.";
      default: return "";
    }
  })();
  const mine = view.turn === view.seat && view.phase !== "hand_over" && view.phase !== "game_over";
  const inPlay = view.phase === "playing";
  const peeking = !!peek.last;
  const shown = peek.last ?? trick;
  const emptyTap = peek.can && !trick?.plays.length;
  return (
    <div className="board-centre mx-auto w-full max-w-[420px]">
    <div data-felt="" className={`relative mx-auto w-full ${compact ? "max-w-[240px]" : "max-w-[300px]"} ${emptyTap ? "cursor-pointer" : ""}`} style={{ height: compact ? 2 * trickW * 1.4 + 14 : 246 }}
      onClick={emptyTap ? peek.toggle : undefined}>
      <div className="absolute inset-x-[2%] inset-y-[8%] rounded-[46%] border-[5px] border-cloth-edge"
        style={{ background: "radial-gradient(ellipse at 50% 40%, #6b2530, var(--cloth-deep))", boxShadow: "inset 0 10px 30px rgba(0,0,0,.35)" }} />
      {view.trump && inPlay && (
        <span aria-hidden className="pointer-events-none absolute inset-0 flex select-none items-center justify-center leading-none"
          style={{ fontSize: compact ? 84 : 128, color: "#fff", opacity: 0.07 }}>{SUIT_GLYPH[view.trump]}</span>
      )}
      {/* Meld lies on the cloth in front of whoever laid it, until the first lead. */}
      {([0, 1, 2, 3] as const).map((r) => laid[r].length > 0 && (
        <div key={`meld${r}`} className={`absolute ${meldSpots[r]}`}>
          <SmallFan cards={laid[r]} width={compact ? 24 : 30} perRow={r % 2 ? (compact ? 4 : 3) : 9} lit={r === 0 ? lit : null}
            label={`${r === 0 ? "Your" : `${nameOf(seatFrom(r))}'s`} meld: ${laid[r].length} cards`} />
        </div>
      ))}
      {shown?.plays.map((p) => {
        const r = rel(p.seat);
        const sweeping = done && !dim && !peeking;
        return (
          <div key={(peeking ? "p" : "") + p.card} className={`absolute ${spots[r]}`} style={{ opacity: dim ? 0.55 : 1 }}>
            <div className={peeking ? undefined : "trick-card"} data-trick-card={peeking ? undefined : p.card} data-sweep={sweeping ? "" : undefined}
              style={peeking ? undefined : { ...flyFrom(r, p.card), ...(sweeping ? sweepTo(rel(shown.winner!)) : null) } as React.CSSProperties}>
              <PlayingCard card={p.card} width={trickW} fourColour={four} tint={tint} trump={splitCard(p.card).suit === view.trump} selected={shown.winner === p.seat} />
            </div>
          </div>
        );
      })}
    </div>
    {mySeat}
    {/* During trick play the status sits above your hand. Otherwise room for three lines is kept here, so the
        board does not grow and shrink (and rescale) as lines come and go. The chips carry the contract once bidding ends. */}
    {!inPlay && (
      <div className={`flex flex-col items-center gap-0.5 text-center ${compact ? "mt-0.5" : "mt-1 min-h-[4.75rem]"}`}>
        <p className={mine ? "display" : "text-sm text-chalk"} style={mine ? { fontSize: compact ? 19 : 22, color: "var(--brass)" } : undefined}>{prompt}</p>
        {view.phase === "deciding_shoot" && <p className="text-sm text-chalk-faint">{shootStake(view, nameOf)}</p>}
        {view.highBid && view.phase === "bidding" && (
          <p className="text-sm text-chalk-faint">
            {view.highBid.shoot ? shootLine(nameOf(view.highBid.seat)) : <>{nameOf(view.highBid.seat)} holds {view.highBid.amount}</>}
          </p>
        )}
        {done && (
          <p className="text-xs text-chalk-faint" style={{ opacity: dim ? 0.7 : 1 }}>
            {nameOf(trick.winner!)} took it{took > 0 ? `, ${took} ${took === 1 ? "counter" : "counters"}` : view.sittingOut == null ? ", no counters" : ""}.
          </p>
        )}
        {stalled && <button type="button" onClick={nudge} className="text-xs text-chalk-faint underline hover:text-chalk">Nudge the computers</button>}
      </div>
    )}
    </div>
  );
}

/** The rule that dims some cards, or null when any card is fine. */
/** What it is your turn to do, said once when the turn reaches you. */
function yourTurnSentence(view: PlayerView): string | null {
  if (view.phase === "melding") return view.meldConfirmed[view.seat] ? null : "Lay down your meld";
  if (view.turn !== view.seat) return null;
  switch (view.phase) {
    case "bidding": return `Your bid${view.highBid ? `; ${view.highBid.shoot ? "the moon is shot" : `${view.highBid.amount} is high`}` : ""}`;
    case "declaring_trump": return "Name trump";
    case "passing_to_bidder": case "passing_back": return `Choose ${view.legal.mustPassCount ?? ""} cards to pass`;
    case "deciding_shoot": return "Shoot the moon, or play it out";
    case "playing": return ["Your play", constraintSentence(view), view.legal.canClaim ? "You can claim all remaining tricks" : null].filter(Boolean).join(". ");
    default: return null;
  }
}

/** Whether focus sits in the hand, the action bar, the Play button or the result sheet. */
function inFocusZone(el: EventTarget | null): boolean {
  return el instanceof Element && !!el.closest("[data-focus-zone]");
}

type Paused = Snapshot["paused"];

/**
 * Bids, plays, trick winners and your turn, spoken by screen readers without moving focus.
 * Built from the public log, so it says only what everyone at the table can see; the table's own
 * changes (a pause, a player leaving) and the last trick shown again are added to it.
 */
function Announcer({ view, nameOf, seats, paused, myId, peek }: {
  view: PlayerView; nameOf: (seat: SeatIndex) => string; seats: Snapshot["seats"]; paused: Paused | null; myId: string;
  /** the last trick, while it is shown again */
  peek: string | null;
}) {
  const prev = useRef<{ log: string[]; turn: string | null; paused: Paused | null; people: Map<SeatIndex, string>; peek: string | null } | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const before = prev.current;
    const turn = yourTurnSentence(view);
    // Who sits where, people only: a chair handed to a computer drops out.
    const people = new Map(seats.filter((x) => x.user_id && x.user_id !== myId).map((x) => [x.seat, x.profile?.display_name ?? SEAT_LABEL[x.seat]]));
    prev.current = { log: view.log, turn, paused, people, peek };
    if (!before) return; // arriving at the table: the visible board says where things stand
    const spoken = newLogLines(before.log, view.log).filter((l) => !l.endsWith("confirms meld")).map((l) => speakLine(l, nameOf));
    for (const [seat, name] of before.people) if (!people.has(seat)) spoken.push(`${name} left; a computer plays their cards`);
    if (paused && !before.paused) spoken.push(`Paused by ${paused.by === myId ? "you" : paused.name}${paused.reason ? `: ${paused.reason}` : ""}`);
    if (!paused && before.paused) spoken.push("Play resumes");
    if (peek && peek !== before.peek) spoken.push(peek);
    if (turn && turn !== before.turn) spoken.push(turn);
    // A trailing space alternates so the same words twice in a row are still announced.
    const sentence = spoken.map((part) => part.replace(/\.$/, "")).join(". ");
    if (spoken.length) setText((t) => `${sentence}.${t.endsWith(" ") ? "" : " "}`);
  }, [view, nameOf, seats, paused, myId, peek]);
  return <p data-announcer="" className="sr-only" aria-live="polite" aria-atomic="true">{text}</p>;
}

function constraintSentence(view: PlayerView): string | null {
  const c = view.legal.playConstraint;
  if (!c || c.reason === "lead_any" || c.reason === "any") return null;
  return describeConstraint(c, SUIT_NAME);
}

function ActionBar({ view, selected, busy, act, nameOf, autoMeld }: {
  view: PlayerView; selected: CardId[]; busy: boolean;
  act: (a: ClientAction) => Promise<unknown>; nameOf: (s: SeatIndex) => string; autoMeld: boolean;
}) {
  const L = view.legal;
  const four = useCardPrefs().prefs.fourColour;
  const trumpLabel = useId();
  const misdeal = L.canMisdeal ? () => void act({ type: "misdeal" }) : null;
  // Right after a throw-in, the other seats see the hand that scrapped the deal while the new one is bid.
  // The player who threw it in already knows it and does not need the reminder.
  const thrown = view.phase === "bidding" && view.misdeal && view.misdeal.seat !== view.seat ? (
    <p className="px-3 text-center text-xs text-chalk-faint">
      {nameOf(view.misdeal.seat)} threw in {view.misdeal.hand.filter((c) => c[0] === "9").length} nines and no meld:{" "}
      <span className="text-chalk">{sortHand(view.misdeal.hand, null).map(cardLabel).join(" ")}</span>
    </p>
  ) : null;

  if (view.phase === "bidding" && !L.canBid && L.canPassBid) {
    const shooter = view.highBid?.shoot ? nameOf(view.highBid.seat) : null;
    const stuck = view.rules.dealerStuck && view.dealer === view.seat && !view.highBid;
    return (<>
      {thrown}
      <Bar>
        {!stuck && <span className="text-chalk-faint">{shooter ? `${shootLine(shooter)}.` : "If everyone passes, redeal."}</span>}
        <button className="btn btn-ghost btn-compact" style={{ color: "var(--chalk-faint)" }} onClick={() => act({ type: "pass_bid" })} disabled={busy}>
          {stuck ? `Take it at ${view.rules.minBid}` : "Pass"}
        </button>
        {misdeal && <MisdealButton busy={busy} run={misdeal} />}
      </Bar>
    </>);
  }
  if (view.phase === "bidding" && L.canBid) {
    return (<>
      {thrown}
      <BidPicker
        key={`${L.minBid ?? view.rules.minBid}:${view.rules.bidStep}`}
        min={L.minBid ?? view.rules.minBid} step={view.rules.bidStep} busy={busy}
        onBid={(amount) => act({ type: "bid", amount })}
        pass={L.canPassBid ? { label: "Pass", run: () => act({ type: "pass_bid" }) } : null}
        misdeal={misdeal}
      />
    </>);
  }
  if (thrown) return <Bar>{thrown}</Bar>;
  if (view.phase === "declaring_trump" && L.canDeclareTrump) {
    return (
      <Bar>
        <span id={trumpLabel} className="text-chalk-faint mr-2">Trump is</span>
        {/* The four suits stay on one row; on narrow phones the label wraps above them instead. */}
        <span role="group" aria-labelledby={trumpLabel} className="flex gap-2">
          {(["S", "H", "C", "D"] as Suit[]).map((s) => (
            <button key={s} className="btn btn-chalk" style={{ width: 48, padding: 0 }} onClick={() => act({ type: "declare_trump", suit: s })} disabled={busy} aria-label={SUIT_NAME[s]}>
              <span style={{ fontSize: 22, color: suitInk(s, four) }}>{SUIT_GLYPH[s]}</span>
            </button>
          ))}
        </span>
      </Bar>
    );
  }
  if (view.phase === "deciding_shoot") {
    // Everyone else reads "Waiting on ..." by the board.
    if (!L.canDeclineShoot) return null;
    return (
      <Bar>
        <button className="btn btn-ghost btn-compact" style={{ color: "var(--brass)", boxShadow: "inset 0 0 0 1.5px var(--brass)" }} disabled={busy || !L.canShoot} aria-label="Shoot the moon"
          onClick={() => { void act({ type: "shoot" }); }}>
          Shoot
        </button>
        <button className="btn btn-brass" disabled={busy} onClick={() => act({ type: "decline_shoot" })}>Play it out</button>
      </Bar>
    );
  }
  if (L.mustPassCount !== null) {
    const n = L.mustPassCount;
    return (
      <Bar>
        <span className="text-chalk-faint">{selected.length} of {n} chosen</span>
        <button className="btn btn-brass" disabled={busy || selected.length !== n} onClick={() => act({ type: "pass_cards", cards: selected })}>
          Pass {n} cards
        </button>
      </Bar>
    );
  }
  if (view.phase === "melding") {
    const mine = view.melds[view.seat] ?? [];
    const pts = mine.reduce((s, m) => s + m.points, 0);
    const autoCards = view.trump ? autoMeldSelection(view.hand, view.trump) : [];
    if (!L.canConfirmMeld && !L.canDeclareMeld) {
      const waiting = ([0, 1, 2, 3] as SeatIndex[]).filter((s) => !view.meldConfirmed[s]).map(nameOf);
      return <Bar><span className="text-chalk-faint">Waiting for {waiting.join(", ")} to finish melding.</span></Bar>;
    }
    if (autoMeld) return <Bar><span className="text-chalk-faint">{autoCards.length ? "Laying down your meld." : "No meld this hand."}</span></Bar>;
    // Picking your own: outlined cards in the hand are the ones that score.
    return (
      <Bar>
        <button className="btn btn-chalk" disabled={busy || selected.length === 0 || !L.canDeclareMeld} onClick={() => act({ type: "declare_meld", cards: selected })}>Lay down</button>
        <button className="btn btn-brass" disabled={busy || !L.canConfirmMeld} onClick={() => act({ type: "confirm_meld" })}>{pts ? `Done, ${pts} meld` : "No meld"}</button>
      </Bar>
    );
  }
  // Trick play's status is PlayStatus, above the hand.
  return null;
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-2 rounded-full px-3 py-2 short:px-1 short:py-1">{children}</div>;
}

export type { Team };
