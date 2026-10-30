"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { ProfileEditor } from "@/components/lobby/ProfileEditor";
import { Avatar } from "./Avatar";
import { GuestKeep } from "./GuestKeep";
import { Popover } from "./Popover";
import { REPO_URL } from "./GitHubLink";

const row = "tap w-full rounded-lg px-2 text-left text-sm text-chalk-faint hover:bg-chalk-ghost hover:text-chalk";

/**
 * Who you are, behind your initial in the top right of every page: your name and handle, where to change them,
 * and the way out. A guest also finds how to keep the account, and how to switch to one they already have, with
 * a plain warning that a guest account cannot be come back to once left.
 */
export function AccountMenu({ me, guest }: { me: Profile; guest: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The table's own seat menu links to "/#profile" to change your name: open straight onto the editor.
  useEffect(() => {
    if (window.location.hash !== "#profile") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the hash is only readable after mount
    setOpen(true); setEditing(true);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function leave(to: string) {
    await createClient().auth.signOut();
    router.push(to);
    router.refresh();
  }

  const first = me.display_name.trim().split(/\s+/)[0] || me.display_name;
  return (
    <div className="relative">
      <Popover label="Your account" open={open} onOpenChange={(o) => { setOpen(o); if (!o) setLeaving(false); }}
        place="right-0 top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-5rem)]"
        buttonClassName="tap flex items-center gap-2 rounded-full pl-1 pr-1 hover:bg-chalk-ghost aria-expanded:bg-chalk-ghost"
        button={<>
          {guest && <span className="pl-2 text-sm text-chalk-faint">Guest</span>}
          <span className="sr-only">Your account, {first}</span>
          <span className="rounded-full" style={{ boxShadow: "0 0 0 1.5px var(--chalk-faint)" }}>
            <Avatar name={me.display_name} seed={me.avatar_seed} size={34} />
          </span>
        </>}>
        <div className="flex items-center gap-3">
          <Avatar name={me.display_name} seed={me.avatar_seed} size={44} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{me.display_name}</p>
            <p className="truncate text-sm text-chalk-faint">@{me.handle}{guest && ", a guest on this browser"}</p>
          </div>
        </div>
        <div className="mt-2">
          {editing ? <ProfileEditor me={me} onDone={() => setEditing(false)} />
            : <button className={row} onClick={() => setEditing(true)}>Change your name or handle</button>}
        </div>

        {guest && <div className="mt-3"><GuestKeep leaving={leaving} onLeaving={setLeaving} /></div>}

        <div className="mt-3 flex flex-col border-t border-chalk-ghost pt-2">
          <Link href="/history" className={row}>Past games</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={row}>Meld on GitHub</a>
          {/* A guest is shown what leaving costs first, beside the way to keep the account. */}
          <button className={row} onClick={() => guest ? setLeaving(true) : void leave("/")}>Sign out</button>
        </div>
      </Popover>
    </div>
  );
}
