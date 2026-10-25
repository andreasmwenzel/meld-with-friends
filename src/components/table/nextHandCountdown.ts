import type { PlayerView, SeatIndex } from "@/engine/types";
import type { Snapshot } from "./types";

/** Automatic dealing deliberately does not use the host's manual readiness override. */
export function canCountdownAdvance(table: Snapshot, latest: PlayerView & { ready?: SeatIndex[] },
  expected: { tableId: string; userId: string; handNumber: number; rev: number }) {
  return table.table.id === expected.tableId && table.table.host === expected.userId &&
    table.table.status === "playing" && !table.paused && latest.phase === "hand_over" &&
    latest.handNumber === expected.handNumber && latest.rev === expected.rev && latest.legal.canAdvanceHand &&
    table.seats.some(s => s.user_id === expected.userId && s.seat === latest.seat) &&
    table.seats.every(s => !s.user_id || s.user_id === expected.userId || (latest.ready ?? []).includes(s.seat));
}

export type CountdownContext = {
  handKey: string;
  allowed: boolean;
  allReady: boolean;
  onNext: (signal: AbortSignal) => void;
};

const OFF = { enabled: false, seconds: null as number | null };

/** One local opt-in. Readiness can start it, but cannot re-arm a cancelled timer. */
export function createNextHandCountdown() {
  let context: CountdownContext | null = null;
  let state = OFF;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: typeof state) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const cancel = () => {
    pending?.abort();
    pending = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (state.enabled) publish(OFF);
  };
  const startIfReady = () => {
    if (!context?.allowed || !context.allReady || !state.enabled || timer !== null) return;
    publish({ enabled: true, seconds: 5 });
    timer = setInterval(() => {
      if (!context?.allowed || !context.allReady) { cancel(); return; }
      const seconds = (state.seconds ?? 5) - 1;
      if (seconds > 0) publish({ enabled: true, seconds });
      else {
        // Disarm before submitting, including when the action fails.
        const onNext = context.onNext;
        cancel();
        pending = new AbortController();
        onNext(pending.signal);
      }
    }, 1000);
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    update(next: CountdownContext) {
      if (context?.handKey !== next.handKey || !next.allowed || ((timer !== null || pending !== null) && !next.allReady)) cancel();
      context = next;
      startIfReady();
    },
    enable() {
      if (!context?.allowed || state.enabled) return;
      cancel();
      publish({ enabled: true, seconds: null });
      startIfReady();
    },
    cancel,
  };
}
