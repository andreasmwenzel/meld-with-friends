"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/site/Avatar";

export interface Invitation { code: string; hostName: string; hostSeed: string; seated: number; invitedAt: string }

/** Refocusing the tab refetches at most this often; events refetch whenever they arrive. */
export const FOCUS_REFRESH_MS = 15_000;
/** Events that land together (bots filling three chairs) cost one refetch. */
const SETTLE_MS = 250;

/**
 * Keeps the invitation cards current without polling. The host's deal nudges `invites:{userId}`, so
 * a new invitation appears; each card listens on its table's channel, so chair counts follow and a
 * table that starts drops its card. Anything without an event (an idle table closed overnight) is
 * caught when the tab regains focus.
 */
function useLiveInvites(userId: string | null, initial: Invitation[]) {
  const [invites, setInvites] = useState(initial);
  const last = useRef(0);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchNow = useEffectEvent(async () => {
    const request = ++latest.current;
    last.current = Date.now();
    try {
      const next = await api<Invitation[]>("/api/invites");
      if (request === latest.current) setInvites(next);
    } catch { /* keep what is shown; the next event or focus tries again */ }
  });
  const refetch = useEffectEvent(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void fetchNow(), SETTLE_MS);
  });

  useEffect(() => {
    if (!userId) return;
    const db = createClient();
    const channel = db.channel(`invites:${userId}`, { config: { private: false } });
    channel.on("broadcast", { event: "invites" }, () => refetch());
    // Subscribing (and every reconnect) refetches too: invitations sent while offline still show up.
    channel.subscribe((status) => { if (status === "SUBSCRIBED") refetch(); });
    const focus = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= FOCUS_REFRESH_MS) refetch();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      void db.removeChannel(channel);
    };
  }, [userId]);

  // One channel per shown table, kept by code: a card arriving or leaving joins or leaves only its own
  // channel, so the others never rejoin. Each join and rejoin refetches once (debounced together), which
  // covers a seat taken or a game started between the last fetch and the join.
  const tables = useRef<{ db: ReturnType<typeof createClient>; byCode: Map<string, RealtimeChannel> } | null>(null);
  useEffect(() => {
    if (!userId) return;
    const live = { db: createClient(), byCode: new Map<string, RealtimeChannel>() };
    tables.current = live;
    return () => {
      for (const channel of live.byCode.values()) void live.db.removeChannel(channel);
      live.byCode.clear();
      if (tables.current === live) tables.current = null;
    };
  }, [userId]);
  const codes = invites.map((i) => i.code).join(",");
  useEffect(() => {
    const live = tables.current;
    if (!live) return;
    const wanted = new Set(codes ? codes.split(",") : []);
    for (const [code, channel] of live.byCode) {
      if (!wanted.has(code)) { live.byCode.delete(code); void live.db.removeChannel(channel); }
    }
    for (const code of wanted) {
      if (live.byCode.has(code)) continue;
      const channel = live.db.channel(`table:${code}`, { config: { private: false } });
      for (const event of ["seats", "game"] as const) channel.on("broadcast", { event }, () => refetch());
      channel.subscribe((status) => { if (status === "SUBSCRIBED") refetch(); });
      live.byCode.set(code, channel);
    }
  }, [userId, codes]);

  return [invites, setInvites] as const;
}

/**
 * Tables a friend dealt for one of their groups, as cards on the cloth. Sitting down or saying no clears one.
 * Without a `userId` (the dev preview) the cards are static.
 */
export function Invitations({ invites: initial, userId = null }: { invites: Invitation[]; userId?: string | null }) {
  const [invites, setInvites] = useLiveInvites(userId, initial);
  const [gone, setGone] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const shown = invites.filter((i) => !gone.includes(i.code));
  if (!shown.length && !note) return null;

  async function dismiss(code: string) {
    setNote(null);
    setGone((g) => [...g, code]);
    try {
      await api(`/api/invites/${code}`, { method: "DELETE" });
      setInvites((list) => list.filter((i) => i.code !== code));
    } catch (e) { setGone((g) => g.filter((c) => c !== code)); setNote((e as Error).message); }
  }

  return (
    <section aria-label="Invitations" className="py-3">
      <ul className="flex flex-col gap-3">
        {shown.map((i) => (
          <li key={i.code} className="panel flex flex-wrap items-center gap-x-3 gap-y-3 p-3 pl-4">
            <Avatar name={i.hostName} seed={i.hostSeed} />
            <div className="min-w-0 flex-1 basis-40">
              <p className="font-semibold [overflow-wrap:anywhere]">{i.hostName} dealt you in</p>
              <p className="text-sm text-ink-soft">
                <span className="code text-ink" style={{ fontSize: 15, letterSpacing: ".1em" }}>{i.code}</span>
                <span className="ml-2 tabular-nums">{i.seated} of 4 chairs taken</span>
              </p>
            </div>
            <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
              <button className="btn" style={{ height: "2.75rem", color: "var(--ink-soft)" }} onClick={() => dismiss(i.code)}>Not this time</button>
              <Link href={`/t/${i.code}`} className="btn btn-ink" style={{ height: "2.75rem" }}>Pull up a chair</Link>
            </div>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-sm text-chalk-faint">{note}</p>}
    </section>
  );
}
