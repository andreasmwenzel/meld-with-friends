"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, type Profile } from "@/lib/api";
import { useTableChannel, useDisconnectedPolling, type TableEvent } from "@/lib/realtime/useTableChannel";
import { usePresence } from "@/lib/realtime/usePresence";
import { Wordmark } from "@/components/site/Wordmark";
import { Seating } from "./Seating";
import { Game } from "./Game";
import { Chat, useTableChat } from "./Chat";
import { createGameFeed, routeTableEvent } from "./viewSync";
import type { Snapshot } from "./types";

export function TableRoom({ code, me, guest = false }: { code: string; me: Profile; guest?: boolean }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const requests = useRef({ issued: 0, applied: 0 });
  const [feed] = useState(createGameFeed);
  usePresence({ userId: me.id, handle: me.handle, tableCode: code });
  const [seated, setSeated] = useState(false);
  const chat = useTableChat(code, me, seated);

  const refresh = useCallback(async () => {
    const request = ++requests.current.issued;
    try {
      const next = await api<Snapshot>(`/api/tables/${code}`);
      if (request < requests.current.applied) return;
      requests.current.applied = request;
      setSnap(next); setError(null); setDegraded(false); setSeated(next.mySeat !== null);
    } catch (e) {
      if (request < requests.current.applied) return;
      requests.current.applied = request;
      if (e instanceof ApiError && e.status === 404) setError("No table has this code.");
      else setDegraded(true);
    }
  }, [code]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state is set after await
  useEffect(() => { void refresh(); }, [refresh]);

  // The tab's one subscription to the table; see routeTableEvent for who fetches what.
  const onEvent = useCallback((ev: TableEvent) => routeTableEvent(ev, feed, () => void refresh()), [refresh, feed]);
  const { status } = useTableChannel(code, onEvent);
  const poll = useCallback(async () => { feed.emit({ type: "resync" }); await refresh(); }, [refresh, feed]);
  useDisconnectedPolling(status, poll);
  const connection = degraded || status !== "subscribed" ? "reconnecting" : "ok";

  if (error) {
    return (
      <main className="flex-1">
        <Header code={code} />
        <div className="mx-auto max-w-md px-6 py-16">
          <h1 className="display" style={{ fontSize: 44 }}>{error}</h1>
          <p className="mt-3 text-chalk-faint">Check the code with whoever dealt the table.</p>
          <Link href="/join" className="btn btn-chalk mt-6">Try another code</Link>
        </div>
      </main>
    );
  }
  if (!snap) return <main className="flex-1"><Header code={code} /><p className="px-6 text-chalk-faint">Finding the table.</p></main>;

  const atBoard = snap.table.status === "playing" || snap.table.status === "finished";
  // At the board the table is the whole screen: the table code, chat and the way out live in its menu.
  if (atBoard) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden">
        <Game key={snap.table.current_game_id ?? ""} connection={connection} code={code} me={me} snap={snap} feed={feed} onTableChange={refresh}
          chat={snap.mySeat !== null ? { unread: chat.unread, render: (visible) => <Chat chat={chat} embedded={{ visible }} /> } : undefined} />
      </main>
    );
  }
  return (
    <main className={`flex-1 flex flex-col ${snap.mySeat !== null ? "pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-0" : ""}`}>
      <Header code={code} />
      <Seating code={code} me={me} snap={snap} onChange={refresh} guest={guest} />
      {snap.mySeat !== null && <Chat chat={chat} />}
    </main>
  );
}

function Header({ code }: { code: string }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-3 sm:py-4">
      <Wordmark size={26} />
      <div className="flex items-center gap-2 text-sm sm:gap-3 text-chalk-faint">
        <span className="hidden min-[400px]:inline">Table</span>
        <span className="code text-chalk" style={{ fontSize: 22, letterSpacing: ".14em" }}>{code}</span>
        <Link href="/" className="tap hover:text-chalk">Leave</Link>
      </div>
    </header>
  );
}
