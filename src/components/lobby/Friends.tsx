"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, type FriendsPayload, type Profile } from "@/lib/api";
import { usePresence } from "@/lib/realtime/usePresence";
import { Avatar } from "@/components/site/Avatar";

export function Friends({ me }: { me: Profile }) {
  const [friends, setFriends] = useState<FriendsPayload | null>(null);
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const presence = usePresence({ userId: me.id, handle: me.handle, tableCode: null });

  const load = useCallback(async () => {
    try { setFriends(await api<FriendsPayload>("/api/friends")); } catch (e) { setNote((e as Error).message); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state is set after await
  useEffect(() => { void load(); }, [load]);

  async function request(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      await api("/api/friends", { body: { handle: handle.replace(/^@/, "") } });
      setHandle("");
      setNote("Request sent.");
      void load();
    } catch (err) { setNote((err as Error).message); }
  }
  async function answer(id: string, accept: boolean) {
    try { await api(`/api/friends/${id}`, { body: { accept } }); void load(); } catch (err) { setNote((err as Error).message); }
  }
  async function remove(id: string) {
    try { await api(`/api/friends/${id}`, { method: "DELETE" }); void load(); } catch (err) { setNote((err as Error).message); }
  }

  const other = (f: { requester: string; requester_profile: Profile; addressee_profile: Profile }) =>
    f.requester === me.id ? f.addressee_profile : f.requester_profile;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="display" style={{ fontSize: 34 }}>Friends</h2>
        <span className="text-chalk-faint text-sm">You are @{me.handle}</span>
      </div>

      <form onSubmit={request} className="mt-4 flex gap-2">
        <label htmlFor="handle" className="sr-only">Friend&rsquo;s handle</label>
        <input id="handle" className="field" placeholder="Add a friend by @handle" value={handle}
          onChange={(e) => setHandle(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <button className="btn btn-chalk shrink-0" disabled={!handle.trim()}>Add</button>
      </form>
      {note && <p className="mt-2 text-sm text-chalk-faint">{note}</p>}

      {friends?.incoming.length ? (
        <ul className="mt-5 flex flex-col gap-2">
          {friends.incoming.map((f) => (
            <li key={f.id} className="panel flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
              <Avatar name={f.requester_profile.display_name} seed={f.requester_profile.avatar_seed} />
              <div className="min-w-0 flex-1 basis-32">
                <p className="font-semibold truncate">{f.requester_profile.display_name}</p>
                <p className="text-sm text-ink-soft">wants to be friends</p>
              </div>
              <button className="btn btn-ink" style={{ height: "2.75rem" }} onClick={() => answer(f.id, true)}>Accept</button>
              <button className="btn" style={{ height: "2.75rem", color: "var(--ink-soft)" }} onClick={() => answer(f.id, false)}>Decline</button>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-5 flex flex-col divide-y divide-chalk-ghost">
        {friends === null && <li className="py-3 text-chalk-faint">Loading your friends.</li>}
        {friends && friends.accepted.length === 0 && (
          <li className="py-3 text-chalk-faint">No friends yet. Add someone by their handle, or send them a table code and they can add you after.</li>
        )}
        {friends?.accepted.map((f) => {
          const p = other(f);
          const live = presence[p.id]?.[0];
          const at = live?.tableCode ?? null;
          return (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <span className="relative">
                <Avatar name={p.display_name} seed={p.avatar_seed} />
                <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full"
                  style={{ background: live ? "var(--brass)" : "var(--chalk-ghost)", boxShadow: "0 0 0 2px var(--cloth)" }} />
              </span>
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-semibold truncate">{p.display_name} <span className="font-normal text-chalk-faint">@{p.handle}</span></p>
                <p className="text-sm text-chalk-faint">
                  {at ? <>At a table now</> : live ? "Online" : "Away"}
                </p>
              </div>
              <div className="flex w-full items-center justify-end gap-3 pl-[3.25rem] sm:w-auto sm:pl-0">
              {at && <Link href={`/t/${at}`} className="btn btn-brass" style={{ height: "2.75rem" }}>Join their table</Link>}
              <button className="tap text-sm text-chalk-faint hover:text-chalk" onClick={() => remove(f.id)} aria-label={`Remove ${p.display_name}`}>Remove</button>
              </div>
            </li>
          );
        })}
        {friends?.outgoing.map((f) => (
          <li key={f.id} className="flex items-center gap-3 py-3 text-chalk-faint">
            <Avatar name={f.addressee_profile.display_name} seed={f.addressee_profile.avatar_seed} />
            <div className="flex-1 min-w-0"><p className="truncate">{f.addressee_profile.display_name}</p><p className="text-sm">Invitation pending</p></div>
            <button className="tap text-sm hover:text-chalk" onClick={() => remove(f.id)}>Cancel</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
