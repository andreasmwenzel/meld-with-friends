"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Team } from "@/engine/types";
import { Avatar } from "@/components/site/Avatar";
import { botTag } from "@/lib/bots/profiles";
import { usePopover } from "./popover";
import type { TablemateStatus } from "./tablemates";

/** Who sits in a chair, as their menu shows them. */
export interface SeatPerson {
  name: string;
  /** a player's handle, or a bot's tag; null when unknown */
  handle: string | null;
  userId: string | null;
  bot: boolean;
  /** "Your partner, North" */
  place: string;
}

/** What the viewer can do from a player's menu. Each is left out when it does not apply. */
export interface SeatActions {
  friend?: { status: TablemateStatus; add: () => Promise<void>; accept: () => Promise<void> };
  makeHost?: () => void;
  standIn?: { run: () => void };
  /** your own chip: where you change your name and handle, opened in a new tab so the game stays put */
  profileHref?: string;
}

/**
 * A player's name chip, which opens their menu: who they are, their handle, and what you can do with them
 * (add a friend, hand the table over). `children` is the chip's own content; the button takes its place in the row.
 */
export function PlayerMenu({ person, team, actions, align, placement = "below", className, style, plate, children }: {
  person: SeatPerson; team: Team; actions: SeatActions; align: "left" | "center" | "right";
  /** your own seat sits at the bottom of the board, so its menu opens upwards */
  placement?: "above" | "below";
  className: string; style?: CSSProperties; plate: string; children: ReactNode;
}) {
  const { open, setOpen, root, pop, id, style: nudged } = usePopover();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const handle = (person.bot ? botTag(person.name) : null) ?? person.handle;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setNote(null);
    try { await fn(); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  // Host actions close the menu: each one asks to confirm, and the table changes underneath it.
  const close = (fn: () => void) => () => { setOpen(false); fn(); };
  const side = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  const row = "flex min-h-11 w-full items-center rounded-lg px-2 text-left text-sm hover:bg-ink/5 focus-visible:bg-ink/5 disabled:opacity-60";
  const friend = actions.friend;
  return (
    <div ref={root} className="relative max-w-full">
      <button type="button" data-seat-plate={plate} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
        onClick={() => { setNote(null); setOpen((o) => !o); }} style={style}
        className={`${className} hover:bg-chalk-ghost focus-visible:bg-chalk-ghost`}>
        {children}
      </button>
      {open && (
        <div ref={pop} id={id} role="dialog" aria-label={person.name} style={nudged}
          className={`panel absolute ${placement === "above" ? "bottom-full mb-1" : "top-full mt-1"} z-30 w-60 max-w-[calc(100vw-16px)] p-2 text-left ${side}`}>
          <div className="flex items-center gap-2.5 px-1 pt-1">
            <Avatar name={person.name} team={team} size={36} bot={person.bot} />
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{person.name}</p>
              {handle && <p className="truncate text-xs text-ink-soft">@{handle}</p>}
            </div>
          </div>
          <p className="mt-2 px-1 text-xs font-semibold text-ink-soft">{person.bot ? `Computer player, ${person.place.charAt(0).toLowerCase()}${person.place.slice(1)}` : person.place}</p>
          {friend?.status === "guest" && <p className="mt-0.5 px-1 text-xs text-ink-soft">Playing as a guest. Guests can be added once they save an account.</p>}
          {(friend || actions.makeHost || actions.standIn || actions.profileHref) && (
            <div className="mt-2 flex flex-col border-t border-ink/10 pt-1">
              {friend?.status === "none" && <button type="button" className={row} disabled={busy} onClick={() => run(friend.add)}>Add friend</button>}
              {friend?.status === "pending_in" && <button type="button" className={row} disabled={busy} onClick={() => run(friend.accept)}>Accept friend request</button>}
              {friend?.status === "pending_out" && <p className="flex min-h-11 items-center px-2 text-sm text-ink-soft">Friend request sent</p>}
              {friend?.status === "friend" && <p className="flex min-h-11 items-center px-2 text-sm text-ink-soft">Friends</p>}
              {actions.makeHost && <button type="button" className={row} onClick={close(actions.makeHost)}>Make host</button>}
              {actions.standIn && <button type="button" className={row} onClick={close(actions.standIn.run)}>Hand to a computer</button>}
              {actions.profileHref && (
                <a href={actions.profileHref} target="_blank" rel="noopener" className={row} onClick={() => setOpen(false)}>
                  Change name or handle<span className="sr-only"> (opens in a new tab)</span>
                  <span aria-hidden className="ml-auto pl-2 text-ink-soft">↗</span>
                </a>
              )}
            </div>
          )}
          {note && <p role="status" className="mt-1 px-2 text-xs text-pip-red">{note}</p>}
        </div>
      )}
    </div>
  );
}
