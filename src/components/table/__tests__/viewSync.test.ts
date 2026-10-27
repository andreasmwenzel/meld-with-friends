import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableEvent } from "@/lib/realtime/useTableChannel";
import { createGameFeed, routeTableEvent, ViewSync } from "../viewSync";

type View = { rev: number };

/** A server whose GETs answer when the test says so, so requests can overlap and reorder. */
function server(startRev = 0) {
  let rev = startRev;
  const pending: { resolve: (v: View) => void; reject: (e: unknown) => void }[] = [];
  return {
    get rev() { return rev; },
    set rev(next: number) { rev = next; },
    fetches: 0,
    pending,
    fetchView() {
      this.fetches++;
      return new Promise<View>((resolve, reject) => pending.push({ resolve, reject }));
    },
    /** Answer the oldest open request with the current revision. */
    async answer(index = 0) {
      await flush(); // fetches queued this tick go out first
      const [request] = pending.splice(index, 1);
      request.resolve({ rev });
      await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** One open tab: the table room's channel handler, its feed, and the board's sync. */
function client(srv: ReturnType<typeof server>, { board = true } = {}) {
  const applied: number[] = [];
  const errors: unknown[] = [];
  const sync = new ViewSync<View>({ fetchView: () => srv.fetchView(), apply: v => applied.push(v.rev), onError: e => errors.push(e) });
  const feed = createGameFeed();
  if (board) feed.subscribe(event => sync.handle(event));
  const refresh = vi.fn();
  /** What the realtime channel would deliver. */
  const channel = (event: TableEvent) => routeTableEvent(event, feed, refresh);
  return { sync, feed, refresh, channel, applied, errors };
}

afterEach(() => { vi.useRealTimers(); });

describe("one fetch per game event", () => {
  it("fetches the view once per event, and not the table snapshot", async () => {
    const srv = server(4);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;

    for (const rev of [5, 6, 7]) {
      srv.rev = rev;
      tab.channel({ type: "game", rev });
      await srv.answer();
    }
    expect(srv.fetches).toBe(3);
    expect(tab.refresh).not.toHaveBeenCalled();
    expect(tab.applied.at(-1)).toBe(7);
  });

  it("costs one GET per open tab for one move at a four-player table", async () => {
    const srv = server(10);
    const tabs = [client(srv), client(srv), client(srv), client(srv)];
    for (const tab of tabs) { void tab.sync.load(); }
    while (srv.pending.length) await srv.answer();
    srv.fetches = 0;

    srv.rev = 11;
    for (const tab of tabs) tab.channel({ type: "game", rev: 11 });
    await flush();
    while (srv.pending.length) await srv.answer();
    expect(srv.fetches).toBe(4);
    for (const tab of tabs) expect(tab.applied.at(-1)).toBe(11);
  });

  it("skips events for revisions it already has (duplicates, its own move)", async () => {
    const srv = server(3);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    tab.channel({ type: "game", rev: 3 });
    tab.channel({ type: "game", rev: 2 });
    expect(srv.fetches).toBe(0);
  });

  it("lets its own action's response stand in for the broadcast of that move", async () => {
    const srv = server(8);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;

    let respond!: (v: View) => void;
    const request = tab.sync.begin();
    const acting = tab.sync.act(() => new Promise<View>(r => { respond = r; }).then(v => { tab.sync.accept(v, request); return v; }));
    tab.channel({ type: "game", rev: 9 }); // the broadcast beats the POST response home
    respond({ rev: 9 });
    await acting; await flush();
    expect(srv.fetches).toBe(0);
    expect(tab.applied.at(-1)).toBe(9);
  });

  it("fetches after its own action fails if a broadcast arrived meanwhile", async () => {
    const srv = server(8);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    const acting = tab.sync.act(() => Promise.reject(new Error("offline")));
    srv.rev = 9;
    tab.channel({ type: "game", rev: 9 });
    await acting.catch(() => {});
    expect(srv.fetches).toBe(1);
    await srv.answer();
    expect(tab.applied.at(-1)).toBe(9);
  });

  it("fetches once when its own action fails while an event's fetch is still queued", async () => {
    const srv = server(8);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    srv.rev = 9;
    tab.channel({ type: "game", rev: 9 }); // queues a fetch for the end of the tick
    tab.sync.begin(); // this client's own move goes out before it
    await tab.sync.act(() => Promise.reject(new Error("rejected"))).catch(() => {}); // no view comes back
    await flush();
    expect(srv.fetches).toBe(1);
    await srv.answer();
    expect(tab.applied.at(-1)).toBe(9);
    expect(srv.pending).toHaveLength(0);
  });

  it("fetches nothing more when its own action answers with a view while an event's fetch is queued", async () => {
    const srv = server(8);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    tab.channel({ type: "game", rev: 9 });
    const request = tab.sync.begin();
    await tab.sync.act(async () => { tab.sync.accept({ rev: 9 }, request); });
    await flush();
    expect(srv.fetches).toBe(0);
    expect(tab.applied.at(-1)).toBe(9);
  });

  it("shares one follow-up fetch among events that land while a fetch is running", async () => {
    const srv = server(0);
    const tab = client(srv);
    srv.rev = 1;
    tab.channel({ type: "game", rev: 1 });
    await flush();
    expect(srv.fetches).toBe(1);
    tab.channel({ type: "game", rev: 2 });
    tab.channel({ type: "game", rev: 3 });
    expect(srv.fetches).toBe(1);
    await srv.answer(); // answers with rev 1, older than announced
    expect(srv.fetches).toBe(2);
    srv.rev = 3;
    await srv.answer();
    expect(tab.applied).toEqual([1, 3]);
    expect(srv.fetches).toBe(2);
  });

  it("needs no follow-up when the running fetch already covers the later events", async () => {
    const srv = server(0);
    const tab = client(srv);
    srv.rev = 1;
    tab.channel({ type: "game", rev: 1 });
    tab.channel({ type: "game", rev: 2 });
    srv.rev = 2;
    await srv.answer();
    expect(srv.fetches).toBe(1);
    expect(tab.applied).toEqual([2]);
  });

  it("ignores an older response that arrives after a newer one", async () => {
    const srv = server(5);
    const tab = client(srv);
    void tab.sync.load(); // request 1
    void tab.sync.load(); // request 2
    srv.rev = 6;
    await srv.answer(1); // request 2 answers first with rev 6
    srv.rev = 5;
    await srv.answer(0); // request 1 answers late with rev 5
    expect(tab.applied).toEqual([6]);
  });

  it("always fetches on resync, and refreshes the table too", async () => {
    const srv = server(2);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    tab.channel({ type: "resync" });
    expect(srv.fetches).toBe(1);
    expect(tab.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes only the table for trade events", () => {
    const srv = server();
    const tab = client(srv);
    tab.channel({ type: "trade" });
    expect(tab.refresh).toHaveBeenCalledTimes(1);
    expect(srv.fetches).toBe(0);
  });

  it("refreshes the table and fetches the view once for a seat event (a ready check)", async () => {
    const srv = server(2);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    tab.channel({ type: "seats" });
    expect(tab.refresh).toHaveBeenCalledTimes(1);
    await flush();
    expect(srv.fetches).toBe(1);
  });

  it("fetches nothing for a chat event on the table channel", () => {
    const srv = server();
    const tab = client(srv);
    tab.channel({ type: "chat", text: "hi" });
    expect(tab.refresh).not.toHaveBeenCalled();
    expect(srv.fetches).toBe(0);
  });

  it("refreshes the table for a game event when no board is mounted (game starting)", () => {
    const srv = server();
    const tab = client(srv, { board: false });
    tab.channel({ type: "game", rev: 0 });
    expect(tab.refresh).toHaveBeenCalledTimes(1);
    expect(srv.fetches).toBe(0);
  });

  it("reports a failed fetch unless a newer request has answered", async () => {
    const srv = server(1);
    const tab = client(srv);
    void tab.sync.load(); void tab.sync.load();
    await srv.answer(1);
    srv.pending.shift()!.reject(new Error("late failure")); await flush();
    expect(tab.errors).toEqual([]);
    void tab.sync.load();
    srv.pending.shift()!.reject(new Error("offline")); await flush();
    expect(tab.errors).toHaveLength(1);
  });
});

describe("revisions reported by the bot worker", () => {
  it("waits for the broadcast and fetches only if it never comes", async () => {
    vi.useFakeTimers();
    const srv = server(4);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;

    srv.rev = 5;
    tab.sync.expect(5, 2000);
    tab.channel({ type: "game", rev: 5 }); // broadcast arrives
    await srv.answer();
    await vi.advanceTimersByTimeAsync(2500);
    expect(srv.fetches).toBe(1);

    srv.rev = 6;
    tab.sync.expect(6, 2000); // broadcast lost
    await vi.advanceTimersByTimeAsync(2500);
    expect(srv.fetches).toBe(2);
  });

  it("fetches the announced revision when its grace runs out during an older fetch", async () => {
    vi.useFakeTimers();
    const srv = server(3);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;

    srv.rev = 4;
    void tab.sync.load(); // an older GET is running (rev 4)
    tab.sync.expect(5, 2000); // the worker reports rev 5; its broadcast is lost
    await vi.advanceTimersByTimeAsync(2500);
    expect(srv.fetches).toBe(1);
    await srv.answer(); // comes back with rev 4
    expect(srv.fetches).toBe(2);
    srv.rev = 5;
    await srv.answer();
    expect(tab.applied.at(-1)).toBe(5);
  });

  it("fetches at once without a live channel", async () => {
    const srv = server(4);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    tab.sync.expect(5, 0);
    expect(srv.fetches).toBe(1);
  });
});

describe("ready checks", () => {
  /** A server whose view carries a ready list, like the table's. */
  type ReadyView = { rev: number; ready: number[] };
  function readyTab() {
    const pending: ((v: ReadyView) => void)[] = [];
    let fetches = 0;
    const applied: ReadyView[] = [];
    const sync = new ViewSync<ReadyView>({
      fetchView: () => { fetches++; return new Promise<ReadyView>(r => pending.push(r)); },
      apply: v => applied.push(v), onError: () => {},
    });
    const feed = createGameFeed();
    feed.subscribe(event => sync.handle(event));
    const channel = (event: TableEvent) => routeTableEvent(event, feed, () => {});
    const answer = async (v: ReadyView) => { await flush(); pending.shift()!(v); await flush(); };
    return { sync, channel, answer, applied, get fetches() { return fetches; }, get open() { return pending.length; } };
  }

  it("fetches each ready check even when the same players ready again next hand", async () => {
    const tab = readyTab();
    void tab.sync.load(); await tab.answer({ rev: 10, ready: [] });
    tab.channel({ type: "seats" }); await tab.answer({ rev: 10, ready: [1] });
    // next hand, played out, then the same player readies again
    tab.channel({ type: "game", rev: 20 }); await tab.answer({ rev: 20, ready: [] });
    tab.channel({ type: "seats" });
    await flush();
    expect(tab.fetches).toBe(4);
    await tab.answer({ rev: 20, ready: [1] });
    expect(tab.applied.at(-1)).toEqual({ rev: 20, ready: [1] });
  });

  it("fetches again when a ready check lands while the hand-over view is still on its way", async () => {
    const tab = readyTab();
    void tab.sync.load(); await tab.answer({ rev: 10, ready: [] });
    tab.channel({ type: "game", rev: 11 }); // the hand ends
    await flush(); // its view is requested
    tab.channel({ type: "seats" }); // a player readies before that view comes back
    expect(tab.fetches).toBe(2);
    await tab.answer({ rev: 11, ready: [] }); // the slow hand-over view, from before the ready check
    expect(tab.fetches).toBe(3);
    await tab.answer({ rev: 11, ready: [2] });
    expect(tab.applied.at(-1)).toEqual({ rev: 11, ready: [2] });
    expect(tab.open).toBe(0);
  });

  it("fetches once for a game event and a ready check arriving together, in either order", async () => {
    for (const order of [["game", "seats"], ["seats", "game"]] as const) {
      const tab = readyTab();
      void tab.sync.load(); await tab.answer({ rev: 10, ready: [] });
      for (const type of order) tab.channel(type === "game" ? { type, rev: 11 } : { type });
      await tab.answer({ rev: 11, ready: [2] }); // goes out after both, so it carries both
      expect(tab.fetches).toBe(2);
      expect(tab.open).toBe(0);
      expect(tab.applied.at(-1)).toEqual({ rev: 11, ready: [2] });
    }
  });

  it("fetches once for its own ready check when the broadcast comes back before the answer", async () => {
    const tab = readyTab();
    void tab.sync.load(); await tab.answer({ rev: 10, ready: [] });
    let answerPost!: () => void;
    const posted = tab.sync.act(() => new Promise<void>((r) => { answerPost = r; }).then(() => tab.sync.invalidate()));
    tab.channel({ type: "seats" }); // the server broadcasts before it answers
    await flush();
    expect(tab.fetches).toBe(1); // nothing while the POST is out
    answerPost(); await posted;
    await tab.answer({ rev: 10, ready: [0] });
    expect(tab.fetches).toBe(2);
    expect(tab.open).toBe(0);
    expect(tab.applied.at(-1)).toEqual({ rev: 10, ready: [0] });
  });

  it("fetches once for its own ready check when the POST answers without a broadcast reaching it", async () => {
    const tab = readyTab();
    void tab.sync.load(); await tab.answer({ rev: 10, ready: [] });
    await tab.sync.act(async () => { tab.sync.invalidate(); });
    await tab.answer({ rev: 10, ready: [0] });
    expect(tab.fetches).toBe(2);
    expect(tab.open).toBe(0);
  });
});

describe("disposal", () => {
  it("cancels the bot grace timer when the board unmounts", async () => {
    vi.useFakeTimers();
    const srv = server(4);
    const tab = client(srv);
    void tab.sync.load(); await srv.answer();
    srv.fetches = 0;
    tab.sync.expect(5, 2000);
    tab.sync.dispose();
    await vi.advanceTimersByTimeAsync(2500);
    expect(srv.fetches).toBe(0);
  });

  it("ignores answers and events that arrive after it is disposed", async () => {
    const srv = server(4);
    const tab = client(srv);
    void tab.sync.load();
    tab.sync.dispose();
    await srv.answer();
    tab.channel({ type: "game", rev: 6 });
    expect(tab.applied).toEqual([]);
    expect(srv.fetches).toBe(1);
  });
});

describe("public moves from the broadcast", () => {
  /** A move here is just the revision it produces; applying it needs the view to be one behind. */
  function mover(srv: ReturnType<typeof server>) {
    const applied: number[] = [];
    const sync = new ViewSync<View, number>({
      fetchView: () => srv.fetchView(),
      applyMove: (view, rev) => (rev === view.rev + 1 ? { rev } : null),
      apply: v => applied.push(v.rev),
      onError: () => {},
    });
    return { sync, applied };
  }

  it("applies the next revision without a fetch", async () => {
    const srv = server(4);
    const { sync, applied } = mover(srv);
    void sync.load(); await srv.answer();
    srv.fetches = 0;
    for (const rev of [5, 6, 7]) sync.event(rev, rev);
    expect(srv.fetches).toBe(0);
    expect(applied).toEqual([4, 5, 6, 7]);
  });

  it("fetches after a dropped event, then applies moves again", async () => {
    const srv = server(4);
    const { sync, applied } = mover(srv);
    void sync.load(); await srv.answer();
    srv.fetches = 0;
    sync.event(5, 5);
    srv.rev = 7;
    sync.event(7, 7); // 6 never arrived
    await flush();
    expect(srv.fetches).toBe(1);
    await srv.answer();
    sync.event(8, 8);
    expect(srv.fetches).toBe(1);
    expect(applied).toEqual([4, 5, 7, 8]);
  });

  it("fetches when events arrive out of order, and ends on the newest", async () => {
    const srv = server(4);
    const { sync, applied } = mover(srv);
    void sync.load(); await srv.answer();
    srv.fetches = 0;
    srv.rev = 6;
    sync.event(6, 6); // ahead of 5
    sync.event(5, 5); // late, but it still follows the view; the running fetch brings 6
    await srv.answer();
    expect(applied.at(-1)).toBe(6);
    sync.event(6, 6); // the duplicate of what the fetch brought changes nothing
    expect(applied.at(-1)).toBe(6);
    expect(srv.fetches).toBe(1);
  });

  it("fetches when a move cannot be applied", async () => {
    const srv = server(4);
    const sync = new ViewSync<View, number>({
      fetchView: () => srv.fetchView(), apply: () => {}, onError: () => {},
      applyMove: () => { throw new Error("bad move"); },
    });
    void sync.load(); await srv.answer();
    srv.fetches = 0;
    expect(() => sync.event(5, 5)).not.toThrow();
    await flush();
    expect(srv.fetches).toBe(1);
  });

  it("fetches for an event without a move (a deal, a new hand)", async () => {
    const srv = server(4);
    const { sync, applied } = mover(srv);
    void sync.load(); await srv.answer();
    srv.fetches = 0;
    srv.rev = 5;
    sync.event(5);
    await srv.answer();
    expect(srv.fetches).toBe(1);
    expect(applied).toEqual([4, 5]);
  });
});
