"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeCode } from "@/lib/codes";

export type TableEvent = { type: "seats" | "trade" | "resync" } | { type: "game"; rev: number; move?: string; sig?: string } | { type: "chat"; [key: string]: unknown };

export function useTableChannel(code: string | null | undefined, onEvent: (event: TableEvent) => void) {
  const [subscription, setSubscription] = useState<{ code: string; status: "connecting" | "subscribed" | "closed" } | null>(null);
  const notify = useEffectEvent(onEvent);
  const normalized = code ? normalizeCode(code) : null;
  useEffect(() => {
    if (!normalized) return;
    let active = true;
    const resync = () => notify({ type: "resync" });
    const visible = () => { if (document.visibilityState === "visible") resync(); };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", visible);
    const db = createClient();
    const channel = db.channel(`table:${normalized}`, { config: { private: false } });
    for (const event of ["game", "seats", "trade", "chat"] as const) {
      channel.on("broadcast", { event }, ({ payload }) => {
        if (!payload || typeof payload !== "object" || payload.type !== event) return;
        if (event !== "game" || typeof payload.rev === "number") notify(payload as TableEvent);
      });
    }
    channel.subscribe((next) => {
      if (!active) return;
      setSubscription({ code: normalized, status: next === "SUBSCRIBED" ? "subscribed" : next === "CLOSED" || next === "CHANNEL_ERROR" || next === "TIMED_OUT" ? "closed" : "connecting" });
      if (next === "SUBSCRIBED") resync();
    });
    return () => {
      active = false;
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", visible);
      void db.removeChannel(channel);
    };
  }, [normalized]);
  return { status: !normalized ? "closed" as const : subscription?.code === normalized ? subscription.status : "connecting" as const };
}

/** Poll only while broadcasts are unavailable and this tab is visible. */
export function useDisconnectedPolling(status: string, refresh: () => Promise<void>) {
  const poll = useEffectEvent(refresh);
  useEffect(() => {
    if (status === "subscribed") return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const schedule = () => {
      clearTimeout(timer);
      if (active && document.visibilityState === "visible") {
        timer = setTimeout(async () => { await poll(); schedule(); }, 8000 * (0.9 + Math.random() * 0.2));
      }
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [status]);
}
