import type { TableEvent } from "@/lib/realtime/useTableChannel";

/**
 * Keeps one client's game view in step with the server with as few GETs as possible.
 *
 * - A `game` event fetches the view at most once. Events the client already has (its own move, a
 *   duplicate) fetch nothing; events that land while a fetch is running share one follow-up fetch.
 * - While this client's own action is in flight, events wait for its response, which carries the view.
 * - Responses are applied in request order, and never move the view back to an older revision.
 */
export interface ViewSyncOptions<V extends { rev: number }> {
  fetchView: () => Promise<V>;
  apply: (view: V) => void;
  /** A fetch failed and no newer request has answered since. */
  onError: (error: unknown) => void;
}

export class ViewSync<V extends { rev: number }> {
  private issued = 0;
  private applied = 0;
  private loading = 0;
  private acting = 0;
  /** A game event arrived that no running request is known to cover. */
  private stale = false;
  /** Highest revision the server has announced. */
  private announced = -1;
  rev = -1;

  constructor(private readonly options: ViewSyncOptions<V>) {}

  /** Number a request so its answer can be ordered against the others. */
  begin(): number { return ++this.issued; }

  /** Apply a view a request brought back, unless a later request already answered or it is older. */
  accept(view: V, request: number): boolean {
    if (request < this.applied || view.rev < this.rev) return false;
    this.applied = request;
    this.rev = view.rev;
    this.options.apply(view);
    return true;
  }

  /** Whether a failure of this request should still be shown. */
  current(request: number): boolean {
    if (request < this.applied) return false;
    this.applied = request;
    return true;
  }

  /** Fetch the view now (mount, resync, polling, after a table change). */
  async load(): Promise<void> {
    const request = this.begin();
    this.loading++;
    try {
      const view = await this.options.fetchView();
      this.accept(view, request);
    } catch (e) {
      if (this.current(request)) this.options.onError(e);
    } finally {
      this.loading--;
      this.settle();
    }
  }

  /** A `game` broadcast announced revision `rev`. */
  event(rev: number): void {
    this.announced = Math.max(this.announced, rev);
    if (rev <= this.rev) return;
    if (this.loading || this.acting) { this.stale = true; return; }
    void this.load();
  }

  /** Track this client's own action; events arriving meanwhile wait for its response. */
  async act<T>(send: () => Promise<T>): Promise<T> {
    this.acting++;
    try { return await send(); }
    finally { this.acting--; this.settle(); }
  }

  /**
   * The server reported revision `rev` outside a broadcast (the bot worker's answer). With a live
   * channel the broadcast normally brings it; fetch only if it has not after `graceMs`.
   */
  expect(rev: number, graceMs: number): ReturnType<typeof setTimeout> | null {
    this.announced = Math.max(this.announced, rev);
    if (rev <= this.rev) return null;
    if (graceMs <= 0) { void this.load(); return null; }
    return setTimeout(() => { if (rev > this.rev && !this.loading) void this.load(); }, graceMs);
  }

  /** Once nothing is running, fetch if an event is still not covered by what came back. */
  private settle(): void {
    if (!this.stale || this.loading || this.acting) return;
    this.stale = false;
    if (this.announced > this.rev) void this.load();
  }
}

/** What the table's one channel subscription passes down to the board. */
export type GameFeedEvent = { type: "game"; rev: number } | { type: "resync" };

export interface GameFeed {
  subscribe: (listener: (event: GameFeedEvent) => void) => () => void;
}

/** A tiny fan-out from the table room to whichever board is mounted. */
export function createGameFeed(): GameFeed & { emit: (event: GameFeedEvent) => boolean } {
  const listeners = new Set<(event: GameFeedEvent) => void>();
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Deliver to the mounted board; false when none is listening. */
    emit(event) { for (const listener of listeners) listener(event); return listeners.size > 0; },
  };
}

/**
 * Route one channel event. A mounted board takes game events and fetches its own view once; the
 * table snapshot is refetched for seat, trade and control changes, on resync, and for game events
 * when no board is mounted yet (a game starting from the seating screen). Chat events fetch nothing.
 */
export function routeTableEvent(event: TableEvent, feed: { emit: (event: GameFeedEvent) => boolean }, refresh: () => void): void {
  if (event.type === "game") { if (!feed.emit(event)) refresh(); }
  else if (event.type === "resync") { refresh(); feed.emit({ type: "resync" }); }
  // Talk has its own channel; nothing in the snapshot changes with a message.
  else if (event.type !== "chat") refresh();
}
