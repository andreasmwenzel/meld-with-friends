"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api, type Group } from "@/lib/api";

/**
 * The lobby's groups, shared by the editor (Groups) and the deal panel's picker (DealTable), which sit
 * in different columns. Any change reloads it for both, so the picker sees a new first group and
 * drops a deleted one.
 */
interface GroupsState { groups: Group[] | null; error: string | null }

const initial: GroupsState = { groups: null, error: null };
let state = initial;
let latest = 0;
const listeners = new Set<() => void>();
const set = (next: GroupsState) => { state = next; for (const l of listeners) l(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Fetches the groups again. Only the newest request's answer is kept, so a slow older read never wins. */
export async function reloadGroups() {
  const request = ++latest;
  try {
    const groups = await api<Group[]>("/api/groups");
    if (request === latest) set({ groups, error: null });
  } catch (e) {
    if (request === latest) set({ ...state, error: (e as Error).message });
  }
}

/** Reads the shared groups, loading them once when `enabled` turns on. */
export function useGroups(enabled = true): GroupsState {
  const current = useSyncExternalStore(subscribe, () => state, () => initial);
  useEffect(() => { if (enabled) void reloadGroups(); }, [enabled]);
  return current;
}

/** Test hook: forget everything between renders of separate tests. */
export function resetGroups() { latest++; set(initial); }
