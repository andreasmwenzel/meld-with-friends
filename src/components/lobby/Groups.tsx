"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Group, type Profile } from "@/lib/api";
import { Avatar } from "@/components/site/Avatar";

export const MAX_GROUP_MEMBERS = 12;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Faces around the edge of a small table: who a group deals in. */
function Faces({ group }: { group: Group }) {
  const shown = group.members.slice(0, 5);
  return (
    <span aria-hidden className="flex shrink-0 items-center pl-1.5">
      {shown.map((m) => (
        <span key={m.userId} className="-ml-1.5 rounded-full" style={{ boxShadow: "0 0 0 2px var(--cloth)" }}>
          <Avatar name={m.displayName} seed={m.avatarSeed} size={26} />
        </span>
      ))}
      {group.members.length > shown.length && <span className="ml-1.5 text-xs text-chalk-faint">+{group.members.length - shown.length}</span>}
    </span>
  );
}

/**
 * The editor is a card laid on the cloth: a name, then every friend as a chip you tap in or out.
 * One Save writes whichever of name and members changed.
 */
function GroupEditor({ group, friends, onSaved, onClose }: {
  group: Group | null; friends: Profile[]; onSaved: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState<string[]>(() => (group?.members ?? []).map((m) => m.userId).filter((id) => friends.some((f) => f.id === id)));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Only friends can be members; the server drops anyone whose friendship ends.
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_GROUP_MEMBERS ? p : [...p, id]);
  const full = picked.length >= MAX_GROUP_MEMBERS;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNote(null);
    try {
      if (!group) await api("/api/groups", { body: { name: name.trim(), members: picked } });
      else {
        if (name.trim() !== group.name) await api(`/api/groups/${group.id}`, { method: "PATCH", body: { name: name.trim() } });
        const before = group.members.map((m) => m.userId);
        if (before.length !== picked.length || before.some((id) => !picked.includes(id))) {
          await api(`/api/groups/${group.id}`, { method: "PATCH", body: { members: picked } });
        }
      }
      onSaved();
    } catch (err) { setNote((err as Error).message); setBusy(false); }
  }
  async function remove() {
    if (!group || !window.confirm(`Delete the group ${group.name}? Your friends stay your friends.`)) return;
    setBusy(true); setNote(null);
    try { await api(`/api/groups/${group.id}`, { method: "DELETE" }); onSaved(); }
    catch (err) { setNote((err as Error).message); setBusy(false); }
  }

  return (
    <form onSubmit={save} className="panel p-4" aria-label={group ? `Edit ${group.name}` : "New group"}>
      <label className="text-sm text-ink-soft">Group name
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required
          placeholder="Tuesday night" autoFocus={!group} />
      </label>
      <fieldset className="mt-3">
        <legend className="flex w-full items-baseline justify-between text-sm text-ink-soft">
          <span>Who plays</span>
          <span className="tabular-nums">{picked.length} of {MAX_GROUP_MEMBERS}</span>
        </legend>
        {friends.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Groups are made from your friends. Add a friend by handle above, then come back.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {friends.map((f) => {
              const on = picked.includes(f.id);
              return (
                <li key={f.id}>
                  <button type="button" aria-pressed={on} onClick={() => toggle(f.id)} disabled={!on && full}
                    title={`@${f.handle}`}
                    className="flex h-11 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-sm font-semibold transition-colors disabled:opacity-40"
                    style={on
                      ? { background: "var(--ink)", color: "var(--chalk)" }
                      : { background: "transparent", color: "var(--ink)", boxShadow: "inset 0 0 0 1.5px var(--chalk-dim)" }}>
                    <Avatar name={f.display_name} seed={f.avatar_seed} size={34} />
                    {firstName(f.display_name)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      {note && <p className="mt-3 text-sm text-pip-red">{note}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-ink" disabled={busy || !name.trim()}>{group ? "Save" : "Make group"}</button>
        <button type="button" className="btn" style={{ color: "var(--ink-soft)" }} onClick={onClose}>Cancel</button>
        {group && (
          <button type="button" className="tap ml-auto text-sm text-pip-red underline-offset-4 hover:underline" onClick={remove} disabled={busy}>Delete group</button>
        )}
      </div>
    </form>
  );
}

/** Named groups of friends. A group can be invited in one go when dealing a table. */
export function Groups({ friends }: { friends: Profile[] }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setGroups(await api<Group[]>("/api/groups")); } catch (e) { setNote((e as Error).message); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state is set after await
  useEffect(() => { void load(); }, [load]);
  const saved = () => { setEditing(null); void load(); };

  return (
    <div className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="display" style={{ fontSize: 26 }}>Groups</h3>
        {editing !== "new" && groups && groups.length < 20 && (
          <button className="tap-link text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline" onClick={() => setEditing("new")}>New group</button>
        )}
      </div>
      {note && <p className="mt-2 text-sm text-chalk-faint">{note}</p>}
      {editing === "new" && <div className="mt-3"><GroupEditor group={null} friends={friends} onSaved={saved} onClose={() => setEditing(null)} /></div>}
      <ul className="mt-2 flex flex-col divide-y divide-chalk-ghost">
        {groups === null && !note && <li className="py-3 text-chalk-faint">Loading your groups.</li>}
        {groups?.length === 0 && editing !== "new" && (
          <li className="py-3 text-chalk-faint">Play with the same people every week? Make a group and invite them all when you deal.</li>
        )}
        {groups?.map((g) => editing === g.id ? (
          <li key={g.id} className="py-3"><GroupEditor group={g} friends={friends} onSaved={saved} onClose={() => setEditing(null)} /></li>
        ) : (
          <li key={g.id}>
            <button className="group flex w-full items-center gap-3 py-3 text-left" onClick={() => setEditing(g.id)} aria-label={`Edit ${g.name}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold group-hover:text-brass">{g.name}</p>
                <p className="truncate text-sm text-chalk-faint">
                  {g.members.length ? g.members.map((m) => firstName(m.displayName)).join(", ") : "Nobody yet"}
                </p>
              </div>
              <Faces group={g} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
