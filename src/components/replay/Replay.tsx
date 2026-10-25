"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SeatIndex, Team } from "@/engine/types";
import type { ReplayPayload } from "@/engine/replay";
import { api } from "@/lib/api";
import { teamOf } from "@/components/table/types";
import { ReplayBoard } from "./ReplayBoard";
import { moveAtFrame, walk, type Move } from "./model";

const teamClass = (t: Team) => (t === "red" ? "text-deck-red-soft" : "text-deck-blue-soft");
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Fetches a game by its link and hands it to the viewer. */
export function ReplayLoader({ id }: { id: string }) {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPayload(null); setError(null); // eslint-disable-line react-hooks/set-state-in-effect -- a new link starts over
    api<ReplayPayload>(`/api/replay/${id}`)
      .then((r) => { if (live) setPayload(r); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id]);
  if (error) {
    return (
      <section className="mx-auto max-w-md px-6 py-16">
        <h1 className="display" style={{ fontSize: 40 }}>Nothing to replay here.</h1>
        <p className="mt-3 text-chalk-faint">{error}</p>
        <Link href="/home" className="btn btn-chalk mt-6">Back to your tables</Link>
      </section>
    );
  }
  if (!payload) return <p className="px-6 py-10 text-chalk-faint">Dealing the hands back out.</p>;
  return <ReplayView key={payload.gameId} payload={payload} />;
}

/** Steps through every move of a game, with the board face up. */
export function ReplayView({ payload }: { payload: ReplayPayload }) {
  const seats = useMemo(() => Object.fromEntries(payload.seats.map(s => [s.seat, { name: s.name, bot: s.bot }])) as Record<SeatIndex, { name: string; bot: boolean }>, [payload.seats]);
  const nameOf = useCallback((seat: SeatIndex) => seats[seat].name, [seats]);
  const game = useMemo(() => {
    try { return { walk: walk(payload, nameOf), error: null }; }
    catch (e) { return { walk: null, error: (e as Error).message }; }
  }, [payload, nameOf]);
  const moves = useMemo(() => game.walk?.moves ?? [], [game.walk]);
  const chapters = useMemo(() => game.walk?.chapters ?? [], [game.walk]);
  const [cursor, setCursor] = useState(() => {
    if (typeof window === "undefined" || !moves.length) return 0;
    const m = Number(new URLSearchParams(window.location.search).get("m"));
    return Number.isInteger(m) && m > 0 ? moveAtFrame(moves, m) : 0;
  });
  const [bottom, setBottom] = useState<SeatIndex>(payload.viewerSeat ?? 0);
  // Cards travel only when the reader steps forward one move; jumps, steps back and turning the table land at once.
  const [stepped, setStepped] = useState({ cursor, bottom, forward: false });
  if (stepped.cursor !== cursor || stepped.bottom !== bottom) {
    setStepped({ cursor, bottom, forward: cursor === stepped.cursor + 1 && bottom === stepped.bottom });
  }
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback((to: number) => setCursor(Math.max(0, Math.min(to, moves.length - 1))), [moves.length]);
  const chapterOf = (i: number) => chapters.findIndex(c => i >= c.first && i <= c.last);
  const prevHand = () => { const c = chapterOf(cursor); go(cursor > chapters[c].first ? chapters[c].first : (chapters[c - 1]?.first ?? 0)); };
  const nextHand = () => { const c = chapterOf(cursor); go(chapters[c + 1]?.first ?? moves.length - 1); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Buttons keep focus after a click; the arrows should still step. Text fields and the slider handle their own keys.
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") { if (e.shiftKey) nextHand(); else go(cursor + 1); }
      else if (e.key === "ArrowLeft") { if (e.shiftKey) prevHand(); else go(cursor - 1); }
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(moves.length - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // The address always names the position, so copying it shares this exact moment.
  useEffect(() => {
    if (!moves.length) return;
    const url = new URL(window.location.href);
    if (cursor === 0) url.searchParams.delete("m"); else url.searchParams.set("m", String(moves[cursor].frame));
    window.history.replaceState(null, "", url);
  }, [cursor, moves]);
  // Scroll the list only, never the page: the board must stay where the reader left it.
  useEffect(() => {
    const list = listRef.current, row = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop + 32) list.scrollTop = Math.max(0, top - 32);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
  }, [cursor]);

  if (!game.walk) {
    return (
      <section className="mx-auto max-w-md px-6 py-16">
        <h1 className="display" style={{ fontSize: 40 }}>This game will not replay.</h1>
        <p className="mt-3 text-chalk-faint">The rules have changed since it was played, so its moves no longer line up. {game.error}</p>
      </section>
    );
  }
  const { frames } = game.walk;
  const move = moves[cursor];
  const frame = frames[move.frame];
  const final = frames[frames.length - 1];
  const chapter = chapters[chapterOf(cursor)];
  const pairs = (t: Team) => payload.seats.filter(s => teamOf(s.seat) === t).map(s => s.name).join(" and ");
  const title = payload.finished && final.winner
    ? `${final.winner === "red" ? "Red" : "Blue"} team won, ${final.score[final.winner]} to ${final.score[final.winner === "red" ? "blue" : "red"]}.`
    : `${payload.hands} ${payload.hands === 1 ? "hand" : "hands"} so far. The game is still going.`;

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: "Meld game replay", url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* the reader cancelled, or the clipboard is blocked; the address bar still has it */ }
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 pb-28 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-6 lg:pb-8">
      <section className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h1 className="display" style={{ fontSize: "clamp(28px, 5vw, 40px)" }}>{title}</h1>
            <p className="mt-1.5 text-sm text-chalk-faint">
              <span className={teamClass("red")}>{pairs("red")}</span> against <span className={teamClass("blue")}>{pairs("blue")}</span>
              {payload.finishedAt && <>, <time dateTime={payload.finishedAt}>{dateFmt.format(new Date(payload.finishedAt))}</time></>}
              . Table {payload.code}.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button type="button" onClick={share} className="btn btn-ghost btn-compact">{copied ? "Link copied" : "Share this replay"}</button>
            {!payload.finished && <span className="text-xs text-chalk-faint">Others can open it once the game is over.</span>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm tabular-nums">
          <p><span className="font-semibold">Hand {frame.handNumber}</span> of {chapters[chapters.length - 1].hand}</p>
          <p><span className={teamClass("red")}>Red</span> {frame.score.red} <span className="px-1 text-chalk-faint">·</span> <span className={teamClass("blue")}>Blue</span> {frame.score.blue}</p>
        </div>

        <div className="mt-2">
          <ReplayBoard frame={frame} move={move} bottom={bottom} seats={seats} viewerSeat={payload.viewerSeat} onSit={setBottom} animate={stepped.forward && stepped.cursor === cursor && stepped.bottom === bottom} />
        </div>

        <p role="status" aria-live="polite" className="display mt-3 min-h-[2.6em] text-center" style={{ fontSize: "clamp(18px, 3.4vw, 24px)", lineHeight: 1.3 }}>
          {move.label}.
        </p>

        <Controls cursor={cursor} count={moves.length} chapterHand={chapter.hand} go={go} prevHand={prevHand} nextHand={nextHand} />
      </section>

      <aside aria-label="Moves" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <h2 className="display" style={{ fontSize: 26 }}>Every move</h2>
        <p className="mt-1 text-xs text-chalk-faint">Arrow keys step, Shift and an arrow jumps a hand. Tap a player to see the table from their seat.</p>
        <div ref={listRef} className="mt-3 max-h-[60vh] overflow-y-auto pr-1 lg:max-h-[calc(100vh-9rem)]">
          {chapters.map((c) => (
            <section key={c.hand} className="mb-4">
              <h3 className="sticky top-0 z-[1] bg-cloth/95 py-1 text-sm backdrop-blur-sm">
                <span className="font-semibold">Hand {c.hand}</span> <span className="text-chalk-faint">{c.title}</span>
              </h3>
              <ol className="mt-1">
                {moves.slice(c.first, c.last + 1).map((m, j) => {
                  const i = c.first + j;
                  return <MoveRow key={m.frame} move={m} current={i === cursor} onClick={() => go(i)} />;
                })}
              </ol>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

function MoveRow({ move, current, onClick }: { move: Move; current: boolean; onClick: () => void }) {
  const indent = move.kind === "play" ? "pl-4" : move.kind === "deal" ? "" : "pl-2";
  const tone = move.kind === "deal" ? "text-chalk" : move.trick || move.record ? "text-chalk" : "text-chalk-faint";
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={current ? "step" : undefined}
        className={`block w-full rounded-md py-1 pr-2 text-left text-sm leading-snug ${indent} ${current ? "bg-chalk text-ink" : `${tone} hover:bg-chalk-ghost hover:text-chalk`}`}>
        {move.label}
      </button>
    </li>
  );
}

/** Prev and next, by move and by hand, with a slider across the whole game. Pinned to the bottom on phones. */
function Controls({ cursor, count, chapterHand, go, prevHand, nextHand }: {
  cursor: number; count: number; chapterHand: number; go: (to: number) => void; prevHand: () => void; nextHand: () => void;
}) {
  const btn = "btn btn-ink btn-compact min-w-[3.25rem] px-0";
  return (
    <div className="panel fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-20 px-3 pb-2 pt-2 lg:static lg:mt-4 lg:px-4 lg:pb-3 lg:pt-3" role="group" aria-label="Step through the game">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={btn} aria-label="Previous hand" onClick={prevHand} disabled={cursor === 0}>⏮</button>
        <button type="button" className={btn} aria-label="Previous move" onClick={() => go(cursor - 1)} disabled={cursor === 0}>◀</button>
        <p className="text-center text-xs tabular-nums text-ink-soft">Hand {chapterHand} · move {cursor + 1} of {count}</p>
        <button type="button" className={btn} aria-label="Next move" onClick={() => go(cursor + 1)} disabled={cursor === count - 1}>▶</button>
        <button type="button" className={btn} aria-label="Next hand" onClick={nextHand} disabled={cursor === count - 1}>⏭</button>
      </div>
      <input type="range" min={0} max={count - 1} value={cursor} onChange={(e) => go(Number(e.target.value))}
        aria-label="Position in the game" className="mt-2 w-full accent-[var(--brass-deep)]" />
    </div>
  );
}
