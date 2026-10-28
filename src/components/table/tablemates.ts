"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type FriendsPayload } from "@/lib/api";

export type TablemateStatus = "friend" | "pending_out" | "pending_in" | "none" | "guest";

/**
 * Where you stand with each person seated here, fetched once per table. `null` while loading, and for good when
 * the viewer may not use friends (a guest gets a 403) or the board has no server (`off`, the lab and practice).
 */
export function useTablemates(code: string, off = false) {
  const [mates, setMates] = useState<Record<string, TablemateStatus> | null>(null);
  useEffect(() => {
    if (off) return;
    let active = true;
    api<{ userId: string; status: TablemateStatus }[]>(`/api/tables/${code}/tablemates`)
      .then((list) => { if (active) setMates(Object.fromEntries(list.map((m) => [m.userId, m.status]))); })
      .catch((e) => { if (!(e instanceof ApiError && e.status === 403)) console.warn("tablemates", e); });
    return () => { active = false; };
  }, [code, off]);
  const set = (userId: string, status: TablemateStatus) => setMates((m) => (m ? { ...m, [userId]: status } : m));
  const addFriend = useCallback(async (userId: string) => {
    await api("/api/friends", { body: { userId } });
    set(userId, "pending_out");
  }, []);
  /** Accepting needs the request's id, which the tablemates list leaves out: find it among your incoming requests. */
  const acceptFriend = useCallback(async (userId: string) => {
    const { incoming } = await api<FriendsPayload>("/api/friends");
    const request = incoming.find((f) => f.requester === userId);
    if (!request) { set(userId, "none"); throw new Error("That request was withdrawn."); }
    await api(`/api/friends/${request.id}`, { body: { accept: true } });
    set(userId, "friend");
  }, []);
  return { mates, addFriend, acceptFriend };
}
