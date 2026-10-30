"use client";

import { useState } from "react";
import type { Profile } from "@/lib/api";
import { Popover } from "@/components/site/Popover";
import { GuestKeep } from "@/components/site/GuestKeep";
import { Friends, type FriendsSummary } from "./Friends";
import { Groups } from "./Groups";

const chip = "tap flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-chalk ring-[1.5px] ring-inset ring-chalk-ghost hover:bg-chalk-ghost aria-expanded:bg-chalk-ghost";
/** Popovers rise from the dock, centred on the screen rather than the button, and stop short of the header. */
const above = "bottom-full left-1/2 mb-2 w-[min(26rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-9rem)] -translate-x-1/2";

/**
 * The foot of the lobby: friends and groups, each in a popover so the tables keep the middle of the screen.
 * Friends stay loaded while the popover is shut, so the button can say who is online and who is asking.
 * A guest has no friends list yet; their button explains why and offers to keep the account.
 */
export function Dock({ me, guest }: { me: Profile; guest: boolean }) {
  const [summary, setSummary] = useState<FriendsSummary | null>(null);
  const [leaving, setLeaving] = useState(false);
  if (guest) {
    return (
      <div className="relative flex justify-center">
        <Popover label="Friends" place={above} buttonClassName={chip} button="Friends">
          <h2 className="display" style={{ fontSize: 28 }}>Friends</h2>
          <p className="mb-3 mt-2 text-sm leading-relaxed text-chalk-faint">
            Friends and groups come with a saved account, so they follow you to any device.
          </p>
          <GuestKeep leaving={leaving} onLeaving={setLeaving} />
        </Popover>
      </div>
    );
  }
  return (
    <div className="relative flex justify-center gap-2">
      <Popover label="Friends" place={above} buttonClassName={chip}
        button={<>
          Friends
          {summary && summary.online > 0 && (
            <span className="flex items-center gap-1 font-normal text-chalk-faint">
              <span aria-hidden className="h-2 w-2 rounded-full bg-brass" />{summary.online} online
            </span>
          )}
          {summary && summary.incoming > 0 && (
            <span className="rounded-full bg-brass px-1.5 text-xs leading-5 text-ink" aria-label={`${summary.incoming} asking`}>{summary.incoming}</span>
          )}
        </>}>
        <Friends me={me} groups={false} onSummary={setSummary} />
      </Popover>
      <Popover label="Groups" place={above} buttonClassName={chip} button="Groups">
        <Groups friends={summary?.friends ?? []} className="" />
      </Popover>
    </div>
  );
}
