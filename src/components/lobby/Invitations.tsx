"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Avatar } from "@/components/site/Avatar";

export interface Invitation { code: string; hostName: string; hostSeed: string; seated: number; invitedAt: string }

/** Tables a friend dealt for one of their groups, as cards on the cloth. Sitting down or saying no clears one. */
export function Invitations({ invites }: { invites: Invitation[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const shown = invites.filter((i) => !gone.includes(i.code));
  if (!shown.length && !note) return null;

  async function dismiss(code: string) {
    setNote(null);
    setGone((g) => [...g, code]);
    try { await api(`/api/invites/${code}`, { method: "DELETE" }); router.refresh(); }
    catch (e) { setGone((g) => g.filter((c) => c !== code)); setNote((e as Error).message); }
  }

  return (
    <section aria-label="Invitations" className="mt-8">
      <ul className="flex max-w-xl flex-col gap-3">
        {shown.map((i) => (
          <li key={i.code} className="panel flex flex-wrap items-center gap-x-3 gap-y-3 p-3 pl-4">
            <Avatar name={i.hostName} seed={i.hostSeed} />
            <div className="min-w-0 flex-1 basis-40">
              <p className="font-semibold [overflow-wrap:anywhere]">{i.hostName} dealt you in</p>
              <p className="text-sm text-ink-soft">
                <span className="code text-ink" style={{ fontSize: 15, letterSpacing: ".1em" }}>{i.code}</span>
                <span className="ml-2 tabular-nums">{i.seated} of 4 chairs taken</span>
              </p>
            </div>
            <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
              <button className="btn" style={{ height: "2.75rem", color: "var(--ink-soft)" }} onClick={() => dismiss(i.code)}>Not this time</button>
              <Link href={`/t/${i.code}`} className="btn btn-ink" style={{ height: "2.75rem" }}>Pull up a chair</Link>
            </div>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-sm text-chalk-faint">{note}</p>}
    </section>
  );
}
