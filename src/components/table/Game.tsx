"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, isTransientError, type Profile } from "@/lib/api";
import { useTableChannel, useDisconnectedPolling } from "@/lib/realtime/useTableChannel";
import type { Action, CardId, PlayerView, SeatIndex, Suit, Team } from "@/engine/types";
import { PlayingCard, CardBack, SUIT_GLYPH, SUIT_NAME, RANK_LABEL, splitCard, cardName } from "@/components/cards/PlayingCard";
import { Avatar } from "@/components/site/Avatar";
import { SEAT_LABEL, teamOf, type Snapshot } from "./types";
import { Scorepad } from "./Scorepad";
import { BidPicker } from "./BidPicker";
import { ResultSheet, type Which } from "./Result";
import { canCountdownAdvance } from "./nextHandCountdown";
import { Recap, useSeenReporting } from "./Recap";
import { MeldReview, itemLabel } from "./MeldReview";
import { CardOptions } from "@/components/cards/CardOptions";
import { useCardPrefs } from "@/lib/cardPrefs";
import { usePushNotifications } from "@/lib/push";
import { autoMeldSelection, meldBySuit, sortHand } from "@/engine/hand";
import { describeConstraint } from "@/engine/rules";
import { motionTimings, flyFrom, sweepTo } from "./motion";
import { newLogLines, speakLine } from "./announce";

type ClientAction = Action extends infer A ? (A extends Action ? Omit<A, "seat"> : never) : never;

const CHIME_KEY = "meld.chime";
const TURN_PREFIX = "Your turn · ";

function countersIn(trick: NonNullable<PlayerView["currentTrick"]>, rules: PlayerView["rules"]): number {
  const classic: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2 };
  return trick.plays.reduce((n, p) => {
    const { rank } = splitCard(p.card);
    return n + (rules.counting === "classic" ? classic[rank] ?? 0 : "ATK".includes(rank) ? rules.counterValue : 0);
  }, 0);
}

export function Game({ code, me, snap, rev, onTableChange, connection = "ok", local = false, suggested }: {
  code: string; me: Profile; snap: Snapshot; rev: number; onTableChange: () => void; connection?: "ok" | "reconnecting"; local?: boolean;
  /** cards a coach suggests, outlined in the hand (practice) */
  suggested?: CardId[];
}) {
  const [view, setView] = useState<PlayerView | null>(null);
  const push = usePushNotifications();
  const [selected, setSelected] = useState<CardId[]>([]);
  /** Cards lit by tapping a suit or meld item in the meld readout; purely a visual aid. */
  const [lit, setLit] = useState<CardId[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Card lifted awaiting a second tap; only valid for the view revision it was lifted in. */
  const [armed, setArmed] = useState<{ card: CardId; rev: number } | null>(null);
  const [cardHint, setCardHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  const [degraded, setDegraded] = useState(false);
  const requests = useRef({ issued: 0, applied: 0, rev: -1 });
  const applyView = useCallback((next: PlayerView, request: number) => {
    if (request < requests.current.applied || next.rev < requests.current.rev) return;
    requests.current.applied = request;
    requests.current.rev = next.rev;
    setView(next); setDegraded(false);
  }, []);
  const reconnecting = connection === "reconnecting" || degraded;
  const { prefs: cardPrefs, width: cardW, phone, short, reducedMotion } = useCardPrefs();
  useEffect(() => {
    if (!armed) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest("[data-keep-armed]")) setArmed(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [armed]);
  const motion = reducedMotion ? "off" : cardPrefs.motion;
  const { slideMs, holdMs, sweepMs } = motionTimings(motion);
  const router = useRouter();

  const load = useCallback(async () => {
    const request = ++requests.current.issued;
    try {
      const next = await api<PlayerView>(`/api/tables/${code}/view`);
      applyView(next, request);
    } catch (e) {
      if (request < requests.current.applied) return;
      requests.current.applied = request;
      if (isTransientError(e)) setDegraded(true);
      else setError(e instanceof ApiError && e.status === 404 ? "No table has this code." : (e as Error).message);
    }
  }, [code, applyView]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state is set after await
  useEffect(() => { void load(); }, [load, rev]);
  const { status } = useTableChannel(code, event => { if (event.type === "resync" || event.type === "game") void load(); });
  useDisconnectedPolling(status, load);

  async function act(action: ClientAction) {
    if (!view || busy) return;
    const request = ++requests.current.issued;
    const body = { action: { ...action, seat: view.seat }, expectedRev: view.rev, requestId: crypto.randomUUID() };
    setBusy(true); setError(null);
    try {
      let next: PlayerView;
      try { next = await api<PlayerView>(`/api/tables/${code}/act`, { body }); }
      catch (e) {
        if (e instanceof ApiError) throw e;
        next = await api<PlayerView>(`/api/tables/${code}/act`, { body });
      }
      applyView(next, request); setSelected([]);
      if (next.phase === "game_over") onTableChange();
    } catch (e) {
      if (request < requests.current.applied) return;
      if (e instanceof ApiError && e.status === 409 && e.data && typeof (e.data as PlayerView).rev === "number") {
        applyView(e.data as PlayerView, request); setSelected([]);
      } else if (isTransientError(e)) setDegraded(true);
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function countdownNext(signal: AbortSignal) {
    if (!view || busy || error || reconnecting || document.hidden) return;
    let submitted = false;
    try {
      const [table, latest] = await Promise.all([
        api<Snapshot>(`/api/tables/${code}`),
        api<PlayerView & { ready?: SeatIndex[] }>(`/api/tables/${code}/view`),
      ]);
      if (signal.aborted || document.hidden || !canCountdownAdvance(table, latest, {
        tableId: snap.table.id, userId: me.id, handNumber: view.handNumber, rev: view.rev,
      })) return;
      const request = ++requests.current.issued;
      submitted = true;
      setBusy(true);
      // One normal action request, with the freshly checked revision and no retry.
      const next = await api<PlayerView>(`/api/tables/${code}/act`, { body: {
        action: { type: "next_hand", seat: latest.seat }, expectedRev: latest.rev, requestId: crypto.randomUUID(),
      } });
      applyView(next, request);
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
    if (!botTurn || !view) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const delay = (view.phase === "playing" ? pace : Math.min(pace, 600)) + (leader ? 0 : 2500);
    const run = async () => {
      let nextDelay = delay;
      try {
        const r = await api<{ acted: boolean; rev: number; delayMs?: number }>(`/api/tables/${code}/tick`, { body: {} });
        if (cancelled) return;
        tickFailures.current = 0;
        if (typeof r.delayMs === "number") setPace(r.delayMs);
        if (r.acted || r.rev > requests.current.rev) await load();
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
  }, [botTurn, view, code, load, leader, pace, nudgeVersion]);

  const [displayedTrick, setDisplayedTrick] = useState<PlayerView["currentTrick"]>(null);
  const trickHold = useRef<{ key: string; until: number }>({ key: "", until: 0 });
  useEffect(() => {
    if (!view) return;
    const last = view.lastTrick;
    const key = `${view.handNumber}:${last?.plays.map(p => p.card).join(",") ?? ""}`;
    if (last?.plays.length === 4 && key !== trickHold.current.key) {
      trickHold.current = { key, until: Date.now() + (holdMs + sweepMs) };
    }
    const live = view.currentTrick?.plays.length ? view.currentTrick
      : view.phase === "hand_over" || view.phase === "game_over" ? last : view.currentTrick;
    const remaining = trickHold.current.until - Date.now();
    setDisplayedTrick(remaining > 0 && last?.plays.length === 4 ? last : live);
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
    setBusy(true); setError(null);
    try {
      await api<{ code: string; rev: number }>(`/api/tables/${code}/rematch`, { body: {} });
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function standIn(seat: SeatIndex, name: string) {
    if (!window.confirm(`Hand ${name}'s chair to a computer? The game continues without them.`)) return;
    setError(null);
    try {
      await api(`/api/tables/${code}/standin`, { body: { seat } });
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function postReady() {
    setError(null);
    try {
      await api(`/api/tables/${code}/ready`, { body: {} });
      await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function pauseTable() {
    const reason = window.prompt("Why the pause? (optional, 80 characters)", "");
    if (reason === null) return;
    setError(null);
    try {
      await api(`/api/tables/${code}/pause`, { body: { reason: reason.trim().slice(0, 80) } });
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function resumeTable() {
    setError(null);
    try {
      await api(`/api/tables/${code}/resume`, { body: {} });
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function makeHost(userId: string, name: string) {
    if (!window.confirm(`Make ${name} the host? They will deal and run the table from here.`)) return;
    setError(null);
    try {
      await api(`/api/tables/${code}/host`, { body: { toUserId: userId } });
      onTableChange(); await load();
    } catch (e) { setError((e as Error).message); }
  }
  async function leave() {
    if (!window.confirm("Leave the game? A computer will take your chair and play on.")) return;
    setError(null);
    try {
      await api(`/api/tables/${code}/seat`, { method: "DELETE" });
      router.push("/home");
    } catch (e) { setError((e as Error).message); }
  }

  const lastSeenRev = (snap as Snapshot & { lastSeenRev?: number | null }).lastSeenRev ?? null;
  const [recapOpen, setRecapOpen] = useState(false);
  const autoRecap = useRef(false);
  useSeenReporting(code, snap.mySeat !== null && view ? view.rev : null);
  useEffect(() => {
    if (!view || autoRecap.current) return;
    autoRecap.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens once, after the first view arrives
    if (view.rules.pace === "leisurely" && lastSeenRev !== null && view.rev > lastSeenRev) setRecapOpen(true);
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
  // Everyone's meld opens by itself when trick play starts and stays up through the first trick,
  // unless dismissed; after that "Review meld" brings it back.
  const [meldHidden, setMeldHidden] = useState<number | null>(null);
  const [meldAsked, setMeldAsked] = useState<number | null>(null);
  // A rematch starts again at hand 1 without remounting, so forget the choice when a game ends.
  const gameOver = view?.phase === "game_over";
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets per-game display choices
  useEffect(() => { if (gameOver) { setMeldHidden(null); setMeldAsked(null); } }, [gameOver]);
  // Hide removes the button that had focus; hand it to the "Review meld" link that replaces the row.
  const reviewLink = useRef<HTMLButtonElement>(null);
  const focusReview = useRef(false);
  useEffect(() => { if (focusReview.current) { focusReview.current = false; reviewLink.current?.focus(); } });
  // A choice made in one phase never carries into the next (an outside move, such as the practice coach, can change it).
  const phaseKey = view ? `${view.handNumber}:${view.phase}` : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drops a stale choice when the phase moves on
  useEffect(() => { setSelected([]); }, [phaseKey]);
  const handRef = useRef<HTMLDivElement>(null);
  /** Keyboard users in the hand or action bar stay there: a played card's button, or the remounted action bar, would drop focus to the page. */
  const handFocused = useRef(false);
  const actionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hand = handRef.current;
    if (!handFocused.current || !hand) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== hand) {
      if (!hand.contains(active) && !actionRef.current?.contains(active)) handFocused.current = false;
      return;
    }
    // Your playable card, else the first live action (a bid or pass button), else the hand itself.
    const card = hand.querySelector<HTMLButtonElement>("button:not(:disabled)");
    const yours = view?.turn === view?.seat || (view?.phase === "melding" && !view.meldConfirmed[view.seat]);
    const action = yours ? actionRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
    // Melding starts at "Lay down all meld"; picking cards is the less common path.
    (view?.phase === "melding" ? action ?? card ?? hand : card ?? action ?? hand).focus({ preventScroll: true });
  }, [view]);
  const keepFocus = {
    onFocus: () => { handFocused.current = true; },
    onBlur: (e: React.FocusEvent) => {
      if (e.relatedTarget && !handRef.current?.contains(e.relatedTarget) && !actionRef.current?.contains(e.relatedTarget)) handFocused.current = false;
    },
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
  const hand = useMemo(() => (view ? sortHand(view.revealed ? view.revealed[which][view.seat] ?? [] : view.hand, view.trump, cardPrefs.sort) : []), [view, cardPrefs.sort, which]);
  const revealedFor = (seat: SeatIndex): CardId[] | undefined => view?.revealed ? sortHand(view.revealed[which][seat] ?? [], view.trump, cardPrefs.sort) : undefined;

  if (!view) return <div className="flex-1 px-6 text-chalk-faint">{error ?? "Dealing."}</div>;

  const myTeam = teamOf(view.seat);
  const rel = (seat: SeatIndex): 0 | 1 | 2 | 3 => (((seat - view.seat + 4) % 4) as 0 | 1 | 2 | 3);
  const seatAt = (r: number): SeatIndex => (((view.seat + r) % 4) as SeatIndex);
  const isMyTurn = view.turn === view.seat;
  const picking = view.legal.mustPassCount !== null || view.legal.canDeclareMeld;
  // Picking your own meld: outline every card that scores, so nothing is missed.
  const meldable = new Set(view.phase === "melding" && !cardPrefs.autoMeld && view.trump && view.legal.canDeclareMeld ? autoMeldSelection(view.hand, view.trump) : []);

  function toggle(card: CardId) {
    if (view!.phase === "playing") {
      if (!view!.legal.playableCards.includes(card)) return;
      if (cardPrefs.confirmPlay && !(armed && armed.card === card && armed.rev === view!.rev)) { setArmed({ card, rev: view!.rev }); return; }
      setArmed(null);
      void act({ type: "play_card", card });
      return;
    }
    if (!picking) return;
    setSelected((s) => (s.includes(card) ? s.filter((c) => c !== card) : [...s, card]));
  }

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
  // On phones, tighten the fan until it fits the row; scroll only once cards would get too thin to tap.
  const baseStep = cardW * (cardW < 60 ? 0.42 : 0.5);
  const fitStep = handW > 0 && hand.length > 1 ? (handW - cardW) / (hand.length - 1) : baseStep;
  const step = phone ? Math.max(Math.max(20, cardW * 0.34), Math.min(baseStep, fitStep)) : baseStep;
  const overlap = cardW - step;
  const scrollHand = phone && handW > 0 && cardW + (hand.length - 1) * step > handW + 0.5;

  return (
    <div className="board mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 pb-3 sm:pb-6 lg:grid-cols-[1fr_280px] lg:px-6"
      data-motion={motion} style={{ "--pm": `${slideMs}ms`, "--sd": `${holdMs}ms`, "--sm": `${sweepMs}ms` } as React.CSSProperties}>
      <section className="board-flat flex min-h-[70vh] min-w-0 flex-col">
        {paused && (
          <div role="status" className="board-banner panel mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <p className="text-sm">
              {canResume
                ? <>Paused by {paused.by === me.id ? "you" : paused.name}{paused.reason ? `: ${paused.reason}` : ""}.</>
                : <>Paused by {paused.name}{paused.reason ? `: ${paused.reason}` : ""}. Waiting for {paused.name} to come back.</>}
            </p>
            {canResume && <button type="button" className="btn btn-ink" style={{ height: "2.25rem" }} onClick={resumeTable}>Resume</button>}
          </div>
        )}
        <div aria-disabled={paused ? true : undefined} inert={paused ? true : undefined} className={`board-flat flex min-w-0 flex-1 flex-col ${paused ? "pointer-events-none opacity-70" : ""}`}>
        {reconnecting && <p role="status" className="board-note mb-1 text-center text-xs text-chalk-faint">Reconnecting to the table.</p>}
        {/* partner across */}
        <OpponentRow className="board-north" compact={short} seat={seatAt(2)} faceUp={revealedFor(seatAt(2))} view={view} name={nameOf(seatAt(2))} align="center" bot={isBot(seatAt(2))} standIn={standInFor(seatAt(2))} makeHost={makeHostFor(seatAt(2))} />
        <div className="board-flat grid flex-1 grid-cols-[minmax(64px,auto)_minmax(0,1fr)_minmax(64px,auto)] items-center gap-2">
          <OpponentRow className="board-west" compact={short} seat={seatAt(1)} faceUp={revealedFor(seatAt(1))} view={view} name={nameOf(seatAt(1))} align="left" bot={isBot(seatAt(1))} standIn={standInFor(seatAt(1))} makeHost={makeHostFor(seatAt(1))} />
          <Centre compact={short} view={view} trick={trickCards} rel={rel} nameOf={nameOf} stalled={stalled && !paused} nudge={nudge} />
          <OpponentRow className="board-east" compact={short} seat={seatAt(3)} faceUp={revealedFor(seatAt(3))} view={view} name={nameOf(seatAt(3))} align="right" bot={isBot(seatAt(3))} standIn={standInFor(seatAt(3))} makeHost={makeHostFor(seatAt(3))} />
        </div>

        {/* action bar */}
        <div ref={actionRef} {...keepFocus} className="board-action mt-2 min-h-[64px] sm:mt-4 sm:min-h-[88px]">
          <ActionBar key={view.rev} view={view} isMyTurn={isMyTurn} selected={selected} busy={busy} act={act} nameOf={nameOf} autoMeld={cardPrefs.autoMeld} />
          {/* One slot of the same height whether the meld row or the "Review meld" link is in it, so the hand never moves. */}
          {view.phase === "playing" && (
            <div className="mt-1 flex min-h-11 items-center justify-center">
              {(view.playedCards.length < 4 && meldHidden !== view.handNumber) || meldAsked === view.handNumber ? (
                <MeldReview key={view.handNumber} melds={view.melds} seat={view.seat} nameOf={nameOf} compact={short}
                  onHide={() => { focusReview.current = true; setMeldHidden(view.handNumber); setMeldAsked(null); }} />
              ) : (
                <button ref={reviewLink} type="button" className="tap-link text-xs text-chalk-faint underline underline-offset-4 hover:text-chalk"
                  onClick={() => setMeldAsked(view.handNumber)}>Review meld</button>
              )}
            </div>
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
        {armedCard && (
          <div className="board-armed relative h-0">
            <button data-keep-armed="" onClick={() => toggle(armedCard)} aria-label={`Play ${cardName(armedCard)}`}
              className="btn btn-brass absolute bottom-6 right-1 z-30 whitespace-nowrap shadow-lg" style={{ minHeight: 36, padding: "0 16px" }}>
              Play {SUIT_GLYPH[splitCard(armedCard).suit]}{RANK_LABEL[splitCard(armedCard).rank]}
            </button>
          </div>
        )}
        <div ref={handRef} tabIndex={-1} {...keepFocus} aria-label="Your hand" className={`board-hand relative mt-2 flex outline-none sm:mt-3 ${scrollHand ? "hand-scroll overflow-x-auto" : "justify-center"}`} style={{ minHeight: (cardW * 7) / 5 + (short ? 8 : 24), paddingTop: scrollHand ? 16 : undefined }}>
          <div className={`flex items-end ${scrollHand ? "mx-auto w-max" : ""}`} style={{ paddingLeft: overlap }}>
            {hand.map((c) => {
              const playable = view.phase === "playing" ? view.legal.playableCards.includes(c) : picking;
              const isArmed = armedCard === c;
              const sel = selected.includes(c) || isArmed;
              return (
                <span key={c} data-keep-armed={isArmed || armedCard ? "" : undefined} className="shrink-0" style={{ marginLeft: -overlap }} onClick={() => { if (view.phase === "playing" && isMyTurn && !playable) showHint(); }}>
                  <button onClick={() => toggle(c)} disabled={busy || !playable} aria-pressed={sel}
                    className="group relative block rounded-[10px] focus-visible:z-20 disabled:pointer-events-none"
                    style={{ transform: sel || lit?.includes(c) ? "translateY(-14px)" : undefined, transition: "transform .14s ease" }}>
                    {suggested?.includes(c) && <SuggestedMark />}
                    <PlayingCard card={c} width={cardW} prefs={cardPrefs} selected={sel || (lit?.includes(c) ?? false)} dimmed={(view.phase === "playing" && isMyTurn && !playable) || (lit !== null && !lit.includes(c))}
                      {...(meldable.has(c) && !sel ? { style: { boxShadow: "0 0 0 2px var(--brass), var(--shadow-card)" }, title: `${cardName(c)}, scores in your meld` } : {})} />
                  </button>
                </span>
              );
            })}
          </div>
          {(armedCard || cardHint) && view.phase === "playing" && isMyTurn && (
            <p role="status" className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-chalk-faint whitespace-nowrap">{armedCard ? cardName(armedCard) : cardHint}</p>
          )}
        </div>
        </div>
        {(view.phase === "hand_over" || view.phase === "game_over") && !recapOpen && (() => {
          const key = `${view.handNumber}-${view.phase}`;
          return <ResultSheet local={local} view={view} nameOf={nameOf} host={isHostNow ? null : snap.seats.find((x) => x.user_id === snap.table.host)?.profile?.display_name ?? "the host"}
            busy={busy} onNext={() => act({ type: "next_hand" })} onRematch={rematch} readyInfo={readyInfo}
            countdown={{ handKey: `${snap.table.id}-${code}-${key}`, blocked: !!paused || !!error || reconnecting || snap.table.status !== "playing",
              onNext: countdownNext }}
            which={which} setWhich={setWhich} peek={peekKey === key} setPeek={(p) => setPeekKey(p ? key : null)} replayHref={replayHref} />;
        })()}
        {recapOpen && <div className="board-recap"><Recap view={view} nameOf={nameOf} lastSeenRev={lastSeenRev} onClose={() => setRecapOpen(false)} /></div>}
        {/* Two deliberate rows on phones, so a wrap never strands a separator: who you are and your settings, then table actions. */}
        <div className="board-foot mt-1 flex flex-col items-center text-xs text-chalk-faint sm:mt-2 sm:flex-row sm:flex-wrap sm:justify-center">
          <Dotted items={[
            <span key="seat">{SEAT_LABEL[view.seat]}</span>,
            <span key="team" className={myTeam === "red" ? "text-deck-red-soft" : "text-deck-blue-soft"}>{myTeam === "red" ? "red" : "blue"} team</span>,
            view.trump && <span key="trump">trump {SUIT_NAME[view.trump]}</span>,
            <button key="sound" type="button" onClick={toggleChime} aria-pressed={chime} className="tap-link underline hover:text-chalk">Sound {chime ? "on" : "off"}</button>,
            <CardOptions key="cards" />,
          ]} />
          <span aria-hidden className="mx-1.5 hidden sm:inline">·</span>
          <Dotted items={[
            push.supported && view.rules.pace === "leisurely" && (
              <button key="push" type="button" onClick={() => void (push.enabled ? push.disable() : push.enable())} disabled={push.busy} aria-pressed={push.enabled} className="tap-link underline hover:text-chalk disabled:opacity-60">
                {push.busy ? "Turning on…" : push.enabled ? "Notifications on" : "Notify me"}
              </button>
            ),
            <button key="hand" type="button" onClick={() => setRecapOpen((o) => !o)} aria-expanded={recapOpen} className="tap-link underline hover:text-chalk">This hand</button>,
            replayHref && <Link key="replay" href={replayHref} className="tap-link underline hover:text-chalk">Review the game</Link>,
            view.phase !== "game_over" && snap.mySeat !== null && !paused && <button key="pause" type="button" onClick={pauseTable} className="tap-link underline hover:text-chalk">Pause the table</button>,
            view.phase === "playing" && snap.mySeat !== null && <button key="leave" type="button" onClick={leave} className="tap-link underline hover:text-chalk">Leave the game</button>,
          ]} />
        </div>
        {push.error && push.supported && view.rules.pace === "leisurely" && <p role="status" className="col-span-full mt-1 text-center text-xs text-chalk-faint">{push.error}</p>}
      </section>

      <Announcer view={view} nameOf={nameOf} />
      <Scorepad view={view} myTeam={myTeam} nameOf={nameOf} />
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

/** "You are shooting the moon", "West is shooting the moon", or "shot" once the hand is over. */
function shootLine(who: string, over: boolean): string {
  return over ? `${who} shot the moon` : `${who} ${who === "You" ? "are" : "is"} shooting the moon`;
}

/** Items on one row with a dot between each, never at either end. */
function Dotted({ items }: { items: React.ReactNode[] }) {
  const shown = items.filter(Boolean);
  return (
    <span className="flex flex-wrap items-center justify-center">
      {shown.map((item, i) => <span key={i} className="inline-flex items-center">{i > 0 && <span aria-hidden className="mx-[0.25em]">·</span>}{item}</span>)}
    </span>
  );
}

const REV_W = 36;
const REV_H = (REV_W * 7) / 5;
const MELD_W = 28;
const MELD_H = (MELD_W * 7) / 5;

function OpponentRow({ seat, view, name, align, bot = false, standIn, makeHost, faceUp, compact = false, className = "" }: { faceUp?: CardId[]; seat: SeatIndex; view: PlayerView; name: string; align: "left" | "center" | "right"; bot?: boolean; standIn?: { away: boolean; run: () => void }; makeHost?: () => void; compact?: boolean; className?: string }) {
  const n = view.handCounts[seat];
  const team = teamOf(seat);
  const active = view.turn === seat;
  const meldCards = faceUp || view.phase === "playing" ? [] : [...new Set((view.melds[seat] ?? []).flatMap((m) => m.cards))];
  const bid = view.bids.filter((b) => b.seat === seat).at(-1);
  const vertical = align !== "center";
  const status = view.dealer === seat && view.phase === "bidding" && !bid ? "dealer"
    : view.phase === "bidding" && bid ? (bid.amount === null ? "passed" : bid.shoot ? "shot the moon" : `bid ${bid.amount}`)
    : view.dealer === seat ? "dealer" : null;
  const items = align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
  if (compact) {
    return <CompactSeat {...{ className, team, active, name, bot, status, n, faceUp, meldCards, standIn }} across={!vertical} />;
  }
  return (
    <div className={`group flex flex-col ${items} gap-1 py-1 sm:gap-1.5 sm:py-2 min-w-0 ${className}`}>
      <div className={`flex ${vertical ? "flex-col" : "flex-row"} items-center gap-1 sm:gap-2 rounded-2xl px-2 py-1 max-w-full`}
        style={active ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
        <Avatar name={name} team={team} size={28} bot={bot} />
        <span className="text-xs sm:text-sm font-semibold truncate max-w-[96px]">{name}</span>
        {status && <span className="text-xs text-chalk-faint whitespace-nowrap">{status}</span>}
      </div>
      <div className={`flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`flex ${vertical ? "flex-col" : "flex-row"}`} style={vertical ? { padding: "0 7px" } : undefined} aria-label={`${n} cards`}>
          {faceUp ? faceUp.map((c, i) => vertical ? (
            <div key={c} className="relative shrink-0" style={{ width: REV_H, height: i === faceUp.length - 1 ? REV_W : 17, zIndex: align === "right" ? faceUp.length - i : i }}>
              <PlayingCard card={c} width={REV_W} style={{ position: "absolute", left: "50%", top: REV_W / 2, transform: `translate(-50%, -50%) rotate(${align === "left" ? 90 : -90}deg)` }} />
            </div>
          ) : <PlayingCard key={c} card={c} width={REV_W} style={{ marginLeft: i ? -REV_W * 0.45 : 0 }} />)
          : Array.from({ length: n }).map((_, i) => (
            <CardBack key={i} width={34} team={team}
              style={vertical ? { marginTop: i ? -40 : 0, transform: align === "left" ? "rotate(90deg)" : "rotate(-90deg)" } : { marginLeft: i ? -24 : 0 }} />
          ))}
        </div>
        {vertical && meldCards.length > 0 && (
          <div className="flex flex-col" title="Meld laid down" aria-label="Meld laid down">
            {meldCards.map((c, i) => (
              <div key={c} className="relative shrink-0"
                style={{ width: MELD_H, height: MELD_W, marginTop: i ? -(MELD_W - 12) : 0, zIndex: align === "right" ? meldCards.length - i : i }}>
                <PlayingCard card={c} width={MELD_W}
                  style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) rotate(${align === "left" ? 90 : -90}deg)` }} />
              </div>
            ))}
          </div>
        )}
      </div>
      {standIn && (
        <button type="button" onClick={standIn.run}
          className={`max-w-[200px] text-xs text-chalk-faint underline hover:text-chalk ${align === "center" ? "text-center" : align === "left" ? "text-left" : "text-right"} ${standIn.away ? "" : "hidden sm:block sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}>
          {standIn.away ? `${name} seems to be away. Hand to a computer` : "Hand to a computer"}
        </button>
      )}
      {makeHost && (
        <button type="button" onClick={makeHost}
          className="hidden sm:block max-w-[200px] text-xs text-chalk-faint underline hover:text-chalk opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
          Make host
        </button>
      )}
      {!vertical && meldCards.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1 max-w-[200px]" title="Meld laid down">
          {meldCards.map((c) => <PlayingCard key={c} card={c} width={MELD_W} />)}
        </div>
      )}
    </div>
  );
}

/**
 * An opponent on a phone held sideways: name, turn ring and a card count in place of the fanned backs.
 * Meld laid down, and hands shown at the end, stay face up in a tight overlapping fan.
 */
function CompactSeat({ className, team, active, name, bot, status, n, faceUp, meldCards, standIn, across }: {
  className: string; team: Team; active: boolean; name: string; bot: boolean; status: string | null; n: number;
  faceUp?: CardId[]; meldCards: CardId[]; standIn?: { away: boolean; run: () => void }; across: boolean;
}) {
  const shown = faceUp ?? meldCards;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${across ? "flex-row justify-center" : "flex-col"} ${className}`}>
      <div className={`flex max-w-full items-center gap-x-2 gap-y-0.5 rounded-2xl px-2 py-1 ${across ? "flex-row" : "flex-col"}`}
        style={active ? { boxShadow: "0 0 0 2px var(--brass)" } : undefined}>
        <Avatar name={name} team={team} size={28} bot={bot} />
        <span className="max-w-[88px] truncate text-xs font-semibold">{name}</span>
        {status && <span className="whitespace-nowrap text-xs text-chalk-faint">{status}</span>}
        {!faceUp && (
          <span className="flex items-center gap-1 text-xs tabular-nums text-chalk-faint" aria-label={`${n} cards`}>
            <CardBack width={12} team={team} />{n}
          </span>
        )}
      </div>
      {shown.length > 0 && <SmallFan cards={shown} perRow={across ? shown.length : 5} label={faceUp ? `${n} cards` : "Meld laid down"} />}
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
function SmallFan({ cards, perRow, label }: { cards: CardId[]; perRow: number; label: string }) {
  const w = MELD_W, peekX = 14, peekY = 20;
  const cols = Math.min(perRow, cards.length);
  return (
    <div className="flex flex-wrap" aria-label={label} title={label}
      style={{ width: w + (cols - 1) * peekX + 0.5, paddingLeft: w - peekX, paddingTop: MELD_H - peekY }}>
      {cards.map((c) => <PlayingCard key={c} card={c} width={w} style={{ marginLeft: peekX - w, marginTop: peekY - MELD_H, flexShrink: 0 }} />)}
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
  const suitColour = (s: Suit) => (s === "H" || s === "D" ? "var(--pip-red)" : "var(--pip-black)");
  if (trump) {
    const mine = all.find((x) => x.suit === trump);
    if (!mine || mine.items.length === 0) return <p className="mt-2 text-center text-xs text-chalk-faint">No meld in {SUIT_NAME[trump]}.</p>;
    return (
      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-chalk-faint">
        <span>Your meld, tap to see it:</span>
        {mine.items.map((it, i) => {
          const key = `${i}`, on = open === key && same(it.cards);
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => pick(key, it.cards)}
              className={`rounded-full px-2.5 py-1 text-chalk ${on ? "bg-chalk text-[color:var(--pip-black)]" : "bg-white/10 hover:bg-white/20"}`}>
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
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span>Your meld, tap a suit:</span>
        {worth.map((x) => {
          const on = open === x.suit;
          return (
            <button key={x.suit} type="button" aria-pressed={on} onClick={() => pick(x.suit, x.cards)}
              className={`rounded-full px-2.5 py-1 ${on ? "bg-chalk" : "bg-white/10 hover:bg-white/20"}`}>
              <span style={{ color: on ? suitColour(x.suit) : undefined }} className={on ? "" : x.suit === "H" || x.suit === "D" ? "text-deck-red-soft" : "text-chalk"}>{SUIT_GLYPH[x.suit]}</span>
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

function Centre({ view, trick, rel, nameOf, stalled, nudge, compact = false }: {
  view: PlayerView; trick: PlayerView["currentTrick"]; rel: (s: SeatIndex) => 0 | 1 | 2 | 3; nameOf: (s: SeatIndex) => string;
  stalled: boolean; nudge: () => void; compact?: boolean;
}) {
  // Sideways on a phone the trick shrinks to fit between your hand and the seat across.
  const trickW = compact ? 42 : 56;
  const done = !!trick && trick.plays.length === 4 && trick.winner !== null;
  const dim = trick !== view.currentTrick && (view.phase === "hand_over" || view.phase === "game_over");
  const took = done ? countersIn(trick, view.rules) : 0;
  const spots: Record<0 | 1 | 2 | 3, string> = {
    0: "bottom-0 left-1/2 -translate-x-1/2", 1: "left-0 top-1/2 -translate-y-1/2", 2: "top-0 left-1/2 -translate-x-1/2", 3: "right-0 top-1/2 -translate-y-1/2",
  };
  const prompt = (() => {
    const who = view.turn !== null ? nameOf(view.turn) : null;
    switch (view.phase) {
      case "bidding": return who === "You" ? "Your bid." : `${who} is bidding.`;
      case "declaring_trump": return who === "You" ? "Name trump." : `${who} is naming trump.`;
      case "passing_to_bidder": return who === "You" ? `Pass ${view.legal.mustPassCount ?? ""} cards to your partner.` : `${who} is passing to the bidder.`;
      case "passing_back": return who === "You" ? `Pass ${view.legal.mustPassCount ?? ""} cards back.` : `${who} is passing back.`;
      case "melding": return view.meldConfirmed[view.seat] ? "Meld is in." : "Lay down your meld.";
      case "playing": return who === "You" ? "Your play." : `${who} to play.`;
      case "hand_over": return "Hand over.";
      case "game_over": return view.winner ? `${view.winner === "red" ? "Red" : "Blue"} team wins.` : "Game over.";
      default: return "";
    }
  })();
  const mine = view.turn === view.seat && view.phase !== "hand_over" && view.phase !== "game_over";
  const last = view.lastTrick && view.lastTrick.plays.length === 4 && view.lastTrick.winner !== null ? view.lastTrick : null;
  const inPlay = view.phase === "playing";
  const [peekRev, setPeekRev] = useState<number | null>(null);
  const peeking = !!last && inPlay && peekRev === view.rev;
  const shown = peeking ? last : trick;
  const showingLast = !!last && shown?.plays.length === 4 && shown.plays.every((p, i) => p.card === last.plays[i].card);
  const canPeek = !!last && inPlay && !showingLast;
  const togglePeek = () => setPeekRev((r) => (r === view.rev ? null : view.rev));
  const emptyTap = canPeek && !trick?.plays.length;
  return (
    <div className="board-centre mx-auto w-full max-w-[420px]">
    <div className={`relative mx-auto w-full ${compact ? "max-w-[240px]" : "max-w-[300px]"} ${emptyTap ? "cursor-pointer" : ""}`} style={{ height: compact ? 2 * trickW * 1.4 + 14 : 246 }}
      onClick={emptyTap ? togglePeek : undefined}>
      <div className="absolute inset-x-[2%] inset-y-[8%] rounded-[46%] border-[5px] border-cloth-edge"
        style={{ background: "radial-gradient(ellipse at 50% 40%, #6b2530, var(--cloth-deep))", boxShadow: "inset 0 10px 30px rgba(0,0,0,.35)" }} />
      {view.trump && inPlay && (
        <span aria-hidden className="pointer-events-none absolute inset-0 flex select-none items-center justify-center leading-none"
          style={{ fontSize: compact ? 84 : 128, color: "#fff", opacity: 0.07 }}>{SUIT_GLYPH[view.trump]}</span>
      )}
      {shown?.plays.map((p) => {
        const r = rel(p.seat);
        const sweeping = done && !dim && !peeking;
        return (
          <div key={(peeking ? "p" : "") + p.card} className={`absolute ${spots[r]}`} style={{ opacity: dim ? 0.55 : 1 }}>
            <div className={peeking ? undefined : "trick-card"} data-sweep={sweeping ? "" : undefined}
              style={peeking ? undefined : { ...flyFrom(r, p.card), ...(sweeping ? sweepTo(rel(shown.winner!)) : null) } as React.CSSProperties}>
              <PlayingCard card={p.card} width={trickW} selected={shown.winner === p.seat} />
            </div>
          </div>
        );
      })}
    </div>
    <div className={`flex flex-col items-center gap-0.5 text-center ${compact ? "mt-0.5" : "mt-1"}`}>
      {peeking && last ? (
        <p className="display text-chalk" style={{ fontSize: 18 }}>Last trick: {nameOf(last.winner!)} took it.</p>
      ) : (
        <p className={mine ? "display" : "text-sm text-chalk"} style={mine ? { fontSize: compact ? 19 : 22, color: "var(--brass)" } : undefined}>{prompt}</p>
      )}
      {!peeking && view.highBid && view.phase !== "game_over" && (
        <p className="text-sm text-chalk-faint">
          {view.highBid.shoot
            ? <>{shootLine(nameOf(view.highBid.seat), view.phase === "hand_over")}</>
            : <>{nameOf(view.highBid.seat)} {view.phase === "bidding" ? "holds" : "took it at"} {view.highBid.amount}</>}
          {view.trump && <> in <span className={view.trump === "H" || view.trump === "D" ? "text-deck-red-soft" : "text-chalk"}>{SUIT_GLYPH[view.trump]}</span></>}
        </p>
      )}
      {!peeking && done && (
        <p className="text-xs text-chalk-faint" style={{ opacity: dim ? 0.7 : 1 }}>
          {nameOf(trick.winner!)} took it{took > 0 ? `, ${took} ${took === 1 ? "counter" : "counters"}` : ", no counters"}.
        </p>
      )}
      {(canPeek || peeking) && (
        <button type="button" onClick={togglePeek} aria-expanded={peeking} className="text-xs text-chalk-faint underline hover:text-chalk">
          {peeking ? "Back to the table" : "Last trick"}
        </button>
      )}
      {stalled && <button type="button" onClick={nudge} className="text-xs text-chalk-faint underline hover:text-chalk">Nudge the computers</button>}
    </div>
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
    case "playing": return ["Your play", constraintSentence(view)].filter(Boolean).join(". ");
    default: return null;
  }
}

/**
 * Bids, plays, trick winners and your turn, spoken by screen readers without moving focus.
 * Built from the public log, so it says only what everyone at the table can see.
 */
function Announcer({ view, nameOf }: { view: PlayerView; nameOf: (seat: SeatIndex) => string }) {
  const prev = useRef<{ log: string[]; turn: string | null } | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const before = prev.current;
    const turn = yourTurnSentence(view);
    prev.current = { log: view.log, turn };
    if (!before) return; // arriving at the table: the visible board says where things stand
    const spoken = newLogLines(before.log, view.log).filter((l) => !l.endsWith("confirms meld")).map((l) => speakLine(l, nameOf));
    if (turn && turn !== before.turn) spoken.push(turn);
    // A trailing space alternates so the same words twice in a row are still announced.
    const sentence = spoken.map((part) => part.replace(/\.$/, "")).join(". ");
    if (spoken.length) setText((t) => `${sentence}.${t.endsWith(" ") ? "" : " "}`);
  }, [view, nameOf]);
  return <p className="sr-only" aria-live="polite" aria-atomic="true">{text}</p>;
}

function constraintSentence(view: PlayerView): string | null {
  const c = view.legal.playConstraint;
  if (!c || c.reason === "lead_any" || c.reason === "any") return null;
  return describeConstraint(c, SUIT_NAME);
}

function ActionBar({ view, isMyTurn, selected, busy, act, nameOf, autoMeld }: {
  view: PlayerView; isMyTurn: boolean; selected: CardId[]; busy: boolean;
  act: (a: ClientAction) => Promise<void>; nameOf: (s: SeatIndex) => string; autoMeld: boolean;
}) {
  const L = view.legal;

  if (view.phase === "bidding" && !L.canBid && L.canPassBid) {
    const shooter = view.highBid?.shoot ? nameOf(view.highBid.seat) : null;
    const stuck = view.rules.dealerStuck && view.dealer === view.seat && !view.highBid;
    return (
      <Bar>
        {!stuck && <span className="text-chalk-faint">{shooter ? `${shootLine(shooter, false)}.` : "If everyone passes, redeal."}</span>}
        <button className="btn btn-ghost btn-compact" style={{ color: "var(--chalk-faint)" }} onClick={() => act({ type: "pass_bid" })} disabled={busy}>
          {stuck ? `Take it at ${view.rules.minBid}` : "Pass"}
        </button>
        {L.canShoot && (
          <button className="btn btn-ghost btn-compact" style={{ color: "var(--brass)", boxShadow: "inset 0 0 0 1.5px var(--brass)" }} disabled={busy}
            onClick={() => { if (window.confirm("Shoot the moon? Your side must take every trick.")) void act({ type: "shoot" }); }}>
            Shoot the moon
          </button>
        )}
      </Bar>
    );
  }
  if (view.phase === "bidding" && L.canBid) {
    return (
      <BidPicker
        key={`${L.minBid ?? view.rules.minBid}:${view.rules.bidStep}`}
        min={L.minBid ?? view.rules.minBid} step={view.rules.bidStep} busy={busy}
        onBid={(amount) => act({ type: "bid", amount })}
        pass={L.canPassBid ? { label: "Pass", run: () => act({ type: "pass_bid" }) } : null}
        shoot={L.canShoot ? () => { if (window.confirm("Shoot the moon? Your side must take every trick.")) void act({ type: "shoot" }); } : null}
      />
    );
  }
  if (view.phase === "declaring_trump" && L.canDeclareTrump) {
    return (
      <Bar>
        <span className="text-chalk-faint mr-2">Trump is</span>
        {/* The four suits stay on one row; on narrow phones the label wraps above them instead. */}
        <span className="flex gap-2">
          {(["S", "H", "C", "D"] as Suit[]).map((s) => (
            <button key={s} className="btn btn-chalk" style={{ width: 48, padding: 0 }} onClick={() => act({ type: "declare_trump", suit: s })} disabled={busy} aria-label={SUIT_NAME[s]}>
              <span style={{ fontSize: 22, color: s === "H" || s === "D" ? "var(--pip-red)" : "var(--pip-black)" }}>{SUIT_GLYPH[s]}</span>
            </button>
          ))}
        </span>
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
  if (view.phase === "playing") {
    return <Bar><span className="text-chalk-faint">{isMyTurn ? (constraintSentence(view) ?? "Tap a card to play it.") : "Waiting on the table."}</span></Bar>;
  }
  if (view.phase === "hand_over" || view.phase === "game_over") return null;
  return null;
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-2 rounded-full px-3 py-2 short:px-1 short:py-1">{children}</div>;
}

export type { Team };
