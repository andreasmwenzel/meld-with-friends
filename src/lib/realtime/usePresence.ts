"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeCode } from "@/lib/codes";

export interface PresenceUser { userId: string; handle: string; tableCode: string | null }
export type PresenceMap = Record<string, PresenceUser[]>;

export function usePresence(user: PresenceUser | null): PresenceMap {
  const userId = user?.userId;
  const handle = user?.handle;
  const tableCode = user?.tableCode ? normalizeCode(user.tableCode) : null;
  const [presence, setPresence] = useState<PresenceMap>({});
  useEffect(() => {
    if (!userId || !handle) return;
    let active = true;
    const db = createClient();
    const channel = db.channel("presence:lobby", { config: { presence: { key: userId } } });
    const sync = () => {
      if (active) setPresence(channel.presenceState<PresenceUser>());
    };
    channel.on("presence", { event: "sync" }, sync).subscribe(async status => {
      if (status === "SUBSCRIBED" && active) await channel.track({ userId, handle, tableCode });
    });
    return () => { active = false; void db.removeChannel(channel); };
  }, [userId, handle, tableCode]);
  return userId ? presence : {};
}
