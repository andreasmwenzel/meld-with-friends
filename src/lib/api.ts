"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) { super(message); }
}

export function isTransientError(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 429 || error.status >= 500;
}

/** Tiny JSON fetch helper for the app's own route handlers. Throws Error(message) on non-2xx. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data);
  }
  return (await res.json()) as T;
}

export interface Profile { id: string; handle: string; display_name: string; avatar_seed: string }
export interface Friendship {
  id: string; requester: string; addressee: string; status: "pending" | "accepted" | "blocked";
  requester_profile: Profile; addressee_profile: Profile;
}
export interface FriendsPayload { accepted: Friendship[]; incoming: Friendship[]; outgoing: Friendship[] }
