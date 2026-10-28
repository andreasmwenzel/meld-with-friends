"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type FriendsPayload } from "@/lib/api";

export type TablemateStatus = "friend" | "pending_out" | "pending_in" | "none" | "guest";

/**
 * Where you stand with each person seated here. Fetched when the table or the people seated at it change (`seated`
 * is any string that changes with them), and again on `refresh` (opening a player's menu), since a friend request
 * can arrive mid-game. `null` while loading, and for good when the board has no server or the viewer is a guest
 * (`off`): guests cannot add friends.
 */
export function useTablemates(code: string, off = false, seated = "") {
  const [mates, setMates] = useState<Record<string, TablemateStatus> | null>(null);
  // Only the latest request may write: a slow answer must not overwrite a newer one, or a request just sent.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const list = await api<{ userId: string; status: TablemateStatus }[]>(`/api/tables/${code}/tablemates`);
      if (ticket === latest.current) setMates(Object.fromEntries(list.map((m) => [m.userId, m.status])));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) console.warn("tablemates", e);
    }
  }, [code]);
  useEffect(() => {
    if (off) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state is set after await
    void load();
    // A counter, not a node: bumping it on cleanup drops the answer to a request this effect started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { latest.current++; };
  }, [load, off, seated]);
  const refresh = useCallback(() => { if (!off) void load(); }, [load, off]);
  const set = (userId: string, status: TablemateStatus) => {
    latest.current++;
    setMates((m) => (m ? { ...m, [userId]: status } : m));
  };
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
  return { mates: off ? null : mates, refresh, addFriend, acceptFriend };
}
