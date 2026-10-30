"use client";

import { useState } from "react";
import Link from "next/link";
import { api, type Profile } from "@/lib/api";
import type { SeatIndex } from "@/engine/types";
import { Avatar } from "@/components/site/Avatar";
import { SEAT_LABEL, teamOf, type Snapshot } from "./types";
import { RulesForm } from "@/components/rules/RulesForm";
import { usePushNotifications } from "@/lib/push";
import { resolveRules, type RulesPatch } from "@/components/rules/rules";
import { useTableTurn } from "./turn";
import { useTablemates } from "./tablemates";

// The chairs sit around the oval, your own chair at the bottom. Keyed by position relative to your seat:
// 0 bottom, 1 left, 2 across, 3 right. From sm up the code sits on the cloth and the chairs hang half
// outside the oval; on phones the code goes above the table and the oval is inset so the chairs stay on screen.
const POS: Record<SeatIndex, string> = {
  0: "bottom-0 left-1/2 -translate-x-1/2 sm:translate-y-1/2",
  1: "left-0 top-1/2 -translate-y-1/2 sm:-translate-x-1/2",
  2: "top-0 left-1/2 -translate-x-1/2 sm:-translate-y-1/2",
  3: "right-0 top-1/2 -translate-y-1/2 sm:translate-x-1/2",
};

export function Seating({ code, me, snap, onChange, guest = false }: { code: string; me: Profile; snap: Snapshot; onChange: () => void; guest?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<RulesPatch>(snap.table.rules as RulesPatch);
  const push = usePushNotifications();
  const leisurely = resolveRules(snap.table.rules).pace === "leisurely";
  // A guest viewer gets no friend status, so the friend buttons stay hidden.
  const { mates, addFriend: befriend, acceptFriend: accept } = useTablemates(code, guest, snap.seats.map((s) => s.user_id ?? "").join(","));
  const addFriend = (userId: string) => befriend(userId).catch((e) => setNote((e as Error).message));
  const acceptFriend = (userId: string) => accept(userId).catch((e) => setNote((e as Error).message));
  const isHost = snap.table.host === me.id;
  const seated = snap.seats.filter((s) => s.user_id || s.bot).length;
  const humans = snap.seats.filter((s) => s.user_id).length;
  const incoming = snap.offers.find((o) => o.to_user === me.id);
  const outgoing = snap.offers.find((o) => o.from_user === me.id);
  // Standing, you look at the table from South.
  const bottom: SeatIndex = snap.mySeat ?? 0;
  const turn = useTableTurn(bottom);
  const rel = (seat: SeatIndex): SeatIndex => (((seat - bottom + 4) % 4) as SeatIndex);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setNote(null);
    try { await fn(); onChange(); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }
  const sit = (seat: SeatIndex) => run(() => api(`/api/tables/${code}/seat`, { body: { seat } }));
  const stand = () => run(() => api(`/api/tables/${code}/seat`, { method: "DELETE" }));
  const offer = (toUserId: string) => run(() => api(`/api/tables/${code}/trade`, { body: { toUserId } }));
  const answer = (id: string, accept: boolean) => run(() => api(`/api/trades/${id}`, { body: { accept } }));
  const makeHost = (toUserId: string, name: string) => {
    if (!window.confirm(`Make ${name} the host? They will deal and run the table from here.`)) return;
    void run(() => api(`/api/tables/${code}/host`, { body: { toUserId } }));
  };
  const start = () => run(() => api(`/api/tables/${code}/start`, { body: {} }));
  const addBot = (seat: SeatIndex) => run(() => api(`/api/tables/${code}/bots`, { body: { seat } }));
  const removeBot = (seat: SeatIndex) => run(() => api(`/api/tables/${code}/bots`, { method: "DELETE", body: { seat } }));
  const fillBots = () => run(() => api(`/api/tables/${code}/bots/fill`, { body: {} }));
  const saveRules = () => run(async () => { await api(`/api/tables/${code}`, { method: "PATCH", body: { rules: rulesDraft } }); setEditingRules(false); });

  async function copy() {
    const url = `${window.location.origin}/join?code=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Pull up a chair", text: `Join my pinochle table on Meld. Code ${code}`, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch {}
  }

  const codeBlock = (
    <>
      <p className="text-chalk-faint text-sm">Table code</p>
      <p className="code mt-1 text-chalk" style={{ fontSize: "clamp(40px, 8vw, 64px)" }}>{code}</p>
      <button className="btn btn-ghost mt-3" style={{ height: "2.25rem" }} onClick={copy}>{copied ? "Link copied" : "Share invite link"}</button>
    </>
  );

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-6 pb-16 pt-2 sm:gap-12 sm:pt-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
      <section className="flex min-w-0 flex-col items-center justify-center overflow-x-clip py-4 sm:py-10">
        <div className="mb-4 flex flex-col items-center text-center sm:hidden">{codeBlock}</div>
        {/* the table */}
        {/* From sm up the chair cards hang half outside the oval, so the oval keeps room above and below for them. */}
        <div className={`relative aspect-[0.72] w-full max-w-[380px] sm:my-24 sm:aspect-[1.35] sm:w-[min(560px,86vw)] sm:max-w-none ${turn.className}`} style={turn.style}>
          <div className="absolute inset-x-[54px] inset-y-[72px] rounded-[48%] border-[6px] border-cloth-edge sm:inset-0"
            style={{ background: "radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--cloth), var(--cloth-edge)), var(--cloth-deep))", boxShadow: "inset 0 12px 40px rgba(0,0,0,.35), 0 20px 50px -20px rgba(0,0,0,.7)" }} />
          <div className={`absolute inset-0 hidden flex-col items-center justify-center text-center sm:flex ${turn.still.className}`} style={turn.still.style}>{codeBlock}</div>
          {([0, 1, 2, 3] as SeatIndex[]).map((i) => {
            const s = snap.seats.find((x) => x.seat === i);
            const p = s?.profile ?? null;
            const mine = s?.user_id === me.id;
            const team = teamOf(i);
            const bot = s?.bot ?? null;
            return (
              <div key={i} className={`absolute ${POS[rel(i)]} flex w-[96px] min-w-0 flex-col items-center gap-1 sm:w-[132px] sm:gap-1.5`}>
                {bot ? (
                  <div className="panel flex w-full flex-col items-center gap-1 px-2 py-2.5 sm:px-3 sm:py-3" style={{ background: "var(--chalk-dim)" }}>
                    <Avatar name={bot} team={team} size={44} bot />
                    <p className="w-full truncate text-center text-sm font-semibold">{bot}</p>
                    <p className="text-center text-xs text-ink-soft">{SEAT_LABEL[i]}<span className="hidden sm:inline"> · </span><br className="sm:hidden" />computer</p>
                    {isHost && <button className="tap text-xs text-deck-blue underline" onClick={() => removeBot(i)} disabled={busy}>Remove</button>}
                  </div>
                ) : p ? (
                  <div className="panel flex w-full flex-col items-center gap-1 px-2 py-2.5 sm:px-3 sm:py-3" style={mine ? { boxShadow: "0 0 0 3px var(--brass), var(--shadow-card)" } : undefined}>
                    <Avatar name={p.display_name} seed={p.avatar_seed} team={team} size={44} />
                    <p className="w-full truncate text-center text-sm font-semibold">{mine ? "You" : p.display_name}</p>
                    <p className="text-xs text-ink-soft">{SEAT_LABEL[i]}</p>
                    {mine ? (
                      <button className="tap text-xs text-deck-blue underline" onClick={stand} disabled={busy}>Stand up</button>
                    ) : snap.mySeat !== null && !outgoing ? (
                      <button className="tap text-xs text-deck-blue underline" onClick={() => offer(p.id)} disabled={busy}>Offer to swap</button>
                    ) : null}
                    {!mine && p.id && mates?.[p.id] === "none" && (
                      <button className="tap text-xs text-deck-blue underline" onClick={() => addFriend(p.id)}>Add friend</button>
                    )}
                    {!mine && mates?.[p.id] === "pending_out" && <span className="text-xs text-ink-soft">Request sent</span>}
                    {!mine && mates?.[p.id] === "pending_in" && <button className="tap text-xs text-deck-blue underline" onClick={() => acceptFriend(p.id)}>Accept friend request</button>}
                    {!mine && mates?.[p.id] === "guest" && <span className="text-xs text-ink-soft" title="Guests can be added once they save an account">guest</span>}
                    {isHost && !mine && (
                      <button className="tap text-xs text-deck-blue underline" onClick={() => makeHost(p.id, p.display_name)} disabled={busy}>Make host</button>
                    )}
                  </div>
                ) : (
                  <button
                    className="flex w-full flex-col items-center gap-1 rounded-[14px] px-2 py-3 sm:px-3 sm:py-4 text-chalk-faint hover:text-chalk disabled:opacity-50"
                    style={{ border: `2px dashed ${team === "red" ? "var(--deck-red-soft)" : "var(--deck-blue-soft)"}`, background: "rgba(0,0,0,.12)" }}
                    onClick={() => sit(i)} disabled={busy}
                    aria-label={`Sit at ${SEAT_LABEL[i]}`}
                  >
                    <span className="text-2xl leading-none" aria-hidden>+</span>
                    <span className="text-sm">{snap.mySeat === null ? "Sit here" : "Move here"}</span>
                    <span className="text-xs opacity-70">{SEAT_LABEL[i]}</span>
                  </button>
                )}
                {!bot && !p && isHost && !guest && (
                  <button className="tap text-xs text-chalk-faint underline hover:text-chalk" onClick={() => addBot(i)} disabled={busy}>Seat a computer</button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-6 max-w-md text-center text-chalk-faint sm:mt-2">
          Partners sit across from each other. <span className="text-deck-red-soft">South and North</span> are one team,{" "}
          <span className="text-deck-blue-soft">West and East</span> the other.
        </p>
      </section>

      <aside className="flex flex-col gap-5">
        {incoming && (
          <div className="panel p-5" style={{ boxShadow: "0 0 0 3px var(--brass), var(--shadow-card)" }}>
            <p className="display" style={{ fontSize: 24 }}>Swap seats?</p>
            <p className="mt-1 text-ink-soft">
              {snap.seats.find((s) => s.user_id === incoming.from_user)?.profile?.display_name ?? "A player"} wants to trade{" "}
              {SEAT_LABEL[incoming.from_seat]} for your {SEAT_LABEL[incoming.to_seat]}.
            </p>
            <div className="mt-3 flex gap-2">
              <button className="btn btn-ink" onClick={() => answer(incoming.id, true)} disabled={busy}>Swap</button>
              <button className="btn" style={{ color: "var(--ink-soft)" }} onClick={() => answer(incoming.id, false)} disabled={busy}>Keep my seat</button>
            </div>
          </div>
        )}
        {outgoing && (
          <div className="panel p-5">
            <p className="font-semibold">Swap offered</p>
            <p className="mt-1 text-ink-soft text-sm">Waiting for {snap.seats.find((s) => s.user_id === outgoing.to_user)?.profile?.display_name ?? "them"} to answer.</p>
            <button className="tap mt-2 text-sm text-deck-blue underline" onClick={() => answer(outgoing.id, false)} disabled={busy}>Withdraw</button>
          </div>
        )}

        <div className="panel p-5">
          <p className="text-xl font-semibold">{seated} of 4 seated</p>
          <p className="mt-1 text-sm text-ink-soft">
            {seated < 4 ? "Share the code, or let a computer take a chair. The deal starts when all four are full." : isHost ? "Everyone is here. Deal when you are ready." : "Everyone is here. Waiting for the host to deal."}
          </p>
          {isHost && (
            <>
              {seated < 4 && !guest && (
                <button className="btn btn-ghost mt-4 w-full" style={{ color: "var(--ink)", boxShadow: "inset 0 0 0 1.5px var(--chalk-dim)" }} onClick={fillBots} disabled={busy}>
                  Fill empty chairs with computers
                </button>
              )}
              {seated < 4 && guest && (
                <p className="mt-4 text-xs text-ink-soft">Computer players are for saved accounts. <Link href="/" className="text-deck-blue underline">Add an email</Link> to seat one.</p>
              )}
              <button className="btn btn-brass mt-2 w-full" onClick={start} disabled={busy || seated < 4 || humans < 1}>Deal the first hand</button>
            </>
          )}
          {note && <p className="mt-3 text-sm text-pip-red">{note}</p>}
        </div>

        <div className="text-sm text-chalk-faint">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold text-chalk">House rules</p>
            {isHost && !editingRules && <button className="tap underline hover:text-chalk" onClick={() => { setRulesDraft(snap.table.rules as RulesPatch); setEditingRules(true); }}>Change</button>}
          </div>
          {editingRules ? (
            <div className="panel mt-2 p-4">
              <RulesForm value={rulesDraft} onChange={setRulesDraft} compact />
              <div className="mt-3 flex gap-2">
                <button className="btn btn-ink" style={{ height: "2.25rem" }} onClick={saveRules} disabled={busy}>Save rules</button>
                <button className="btn" style={{ height: "2.25rem", color: "var(--ink-soft)" }} onClick={() => setEditingRules(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            // The same grid the host set them in, read-only: Change swaps each value for its select in place.
            <div className="panel mt-2 p-4"><RulesForm value={snap.table.rules} compact /></div>
          )}
          {push.supported && leisurely && (
            <div className="mt-3">
              <p>Get a nudge when it is your turn, even days later.</p>
              <button type="button" className="tap mt-1 underline hover:text-chalk disabled:opacity-60" onClick={() => void (push.enabled ? push.disable() : push.enable())} disabled={push.busy} aria-pressed={push.enabled}>
                {push.busy ? "Turning on…" : push.enabled ? "Notifications on" : "Notify me"}
              </button>
              {push.error && <p role="status" className="mt-1 text-xs">{push.error}</p>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
