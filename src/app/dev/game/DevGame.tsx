"use client";

import { useSyncExternalStore } from "react";
import { applyAction, newGame, viewFor, type Action, type GameState, type SeatIndex } from "@/engine";
import { Game } from "@/components/table/Game";
import type { Snapshot } from "@/components/table/types";

const names = ["You", "Margaret", "Walt", "June"];
const snap: Snapshot = {
  table: { id: "t", code: "KQJ9TA", host: "u0", status: "playing", rules: {} },
  seats: ([0, 1, 2, 3] as SeatIndex[]).map((seat) => ({ seat, user_id: `u${seat}`, profile: { id: `u${seat}`, handle: names[seat].toLowerCase(), display_name: names[seat], avatar_seed: "" }, bot: null })),
  offers: [], mySeat: 0,
};

/** Module-level store so the fetch patch below can see the latest state. Dev page only. */
const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
/** ?ready lets the host exercise the optional countdown with everyone ready. */
const ready: SeatIndex[] = qs.has("ready") ? [0, 1, 2, 3] : [];
/** All-pass bidding variants: ?shoot=on, optionally &redeal. */
const shoot = qs.get("shoot");
const previewRules = { dealerStuck: !qs.has("redeal"), shoot: shoot && shoot !== "off" ? "on" : "off" } as const;
const fastForward = qs.has("end");
/** ?play jumps to the play phase mid-trick (others have led, it is your turn); ?meld jumps to melding;
 *  ?return makes you the bidder holding 16 cards after your partner's four-card pass. */
const jumpTo = qs.has("play") ? "playing" : qs.has("meld") ? "melding" : qs.has("return") ? "passing_back" : null;
const store = {
  state: fastForward ? autoplay(newGame("preview-1", { ...previewRules, revealHands: true }), true) : jumpTo ? jump(newGame("preview-1", previewRules), jumpTo) : autoplay(newGame("preview-1", previewRules)),
  listeners: new Set<() => void>(),
  set(s: GameState) { store.state = s; store.listeners.forEach((l) => l()); },
  subscribe(l: () => void) { store.listeners.add(l); return () => { store.listeners.delete(l); }; },
};

// Route the board's /view and /act calls to the local engine instead of the API.
if (typeof window !== "undefined" && !(window as unknown as { __meldDev?: boolean }).__meldDev) {
  (window as unknown as { __meldDev?: boolean }).__meldDev = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/tables/KQJ9TA")) return Response.json({ ...snap, ready });
    if (url.endsWith("/view")) return Response.json({ ...viewFor(store.state, 0), ready });
    if (url.endsWith("/act")) {
      try {
        const { action } = JSON.parse(String(init?.body)) as { action: Action };
        store.set(autoplay(applyAction(store.state, action)));
        return Response.json(viewFor(store.state, 0));
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 422 }); }
    }
    return real(input, init);
  };
}

/** Drives the real engine locally; other seats auto-play a simple legal move. */
export function DevGame() {
  const state = useSyncExternalStore(store.subscribe, () => store.state, () => store.state);
  return <div className="flex h-dvh flex-col overflow-hidden"><Game code="KQJ9TA" me={snap.seats[0].profile!} snap={snap} rev={state.rev} onTableChange={() => {}} /></div>;
}

function jump(s: GameState, phase: "playing" | "melding" | "passing_back"): GameState {
  const bidder = phase === "passing_back" ? 0 : 1;
  for (let guard = 0; guard < 200 && s.phase !== phase; guard++) {
    const seat = s.turn;
    if (s.phase === "melding") {
      for (const p of s.players) if (!p.meldConfirmed) {
        const v = viewFor(s, p.seat);
        if (v.legal.canDeclareMeld) s = applyAction(s, { type: "declare_meld", seat: p.seat, cards: v.hand });
        s = applyAction(s, { type: "confirm_meld", seat: p.seat });
      }
      continue;
    }
    if (seat === null) return s;
    const v = viewFor(s, seat);
    const L = v.legal;
    // Non-bidders pass; the bidder bids, or passes when stuck as dealer (which awards it the bid).
    if ((seat !== bidder || !L.canBid) && L.canPassBid) s = applyAction(s, { type: "pass_bid", seat });
    else if (L.canBid && L.minBid) s = applyAction(s, { type: "bid", seat, amount: L.minBid });
    else if (L.canDeclareTrump) s = applyAction(s, { type: "declare_trump", seat, suit: "S" });
    else if (L.mustPassCount) s = applyAction(s, { type: "pass_cards", seat, cards: v.hand.slice(0, L.mustPassCount) });
    else if (L.canDeclineShoot) s = applyAction(s, { type: "decline_shoot", seat });
    else return s;
  }
  if (phase === "playing") {
    // bidder (seat 1) leads, seats 2 and 3 follow, so seat 0 faces a constrained choice
    for (let i = 0; i < 3 && s.turn !== 0 && s.turn !== null; i++) {
      const L = viewFor(s, s.turn).legal;
      if (!L.playableCards.length) break;
      s = applyAction(s, { type: "play_card", seat: s.turn, card: L.playableCards[0] });
    }
  }
  return s;
}

function autoplay(s: GameState, all = false): GameState {
  for (let guard = 0; guard < 200; guard++) {
    const seat = s.turn;
    if (s.phase === "melding") {
      let changed = false;
      for (const p of s.players) if ((all || p.seat !== 0) && !p.meldConfirmed) {
        const v = viewFor(s, p.seat);
        if (v.legal.canDeclareMeld) s = applyAction(s, { type: "declare_meld", seat: p.seat, cards: v.hand });
        s = applyAction(s, { type: "confirm_meld", seat: p.seat }); changed = true;
      }
      if (!changed) return s;
      continue;
    }
    if (seat === null || (seat === 0 && !all)) return s;
    const v = viewFor(s, seat);
    const L = v.legal;
    if (L.canPassBid) s = applyAction(s, { type: "pass_bid", seat });
    else if (L.canBid && L.minBid) s = applyAction(s, { type: "bid", seat, amount: L.minBid });
    else if (L.canDeclareTrump) s = applyAction(s, { type: "declare_trump", seat, suit: "S" });
    else if (L.mustPassCount) s = applyAction(s, { type: "pass_cards", seat, cards: v.hand.slice(0, L.mustPassCount) });
    else if (L.canDeclineShoot) s = applyAction(s, { type: "decline_shoot", seat });
    else if (L.playableCards.length) s = applyAction(s, { type: "play_card", seat, card: L.playableCards[0] });
    else return s;
  }
  return s;
}
