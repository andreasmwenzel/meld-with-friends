"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { KeepAccount } from "./KeepAccount";

/**
 * A guest's two ways forward: keep this account by adding an email, or switch to an account they already have.
 * Switching says plainly what is lost first: a guest account lives in one browser and cannot be opened again.
 */
export function GuestKeep({ leaving, onLeaving }: { leaving: boolean; onLeaving: (leaving: boolean) => void }) {
  const router = useRouter();
  async function leave(to: string) {
    await createClient().auth.signOut();
    router.push(to);
    router.refresh();
  }
  return (
    <div>
      <KeepAccount onSignIn={() => onLeaving(true)} />
      {leaving ? (
        <div className="mt-3 rounded-[10px] p-3" style={{ background: "var(--chalk-ghost)" }}>
          <p className="text-sm leading-relaxed">
            A guest account lives only in this browser. Once you leave it, its tables and name can&rsquo;t be opened again.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-chalk btn-compact" onClick={() => leave("/?signin=1")}>Sign in to my account</button>
            <button className="btn btn-ghost btn-compact" onClick={() => leave("/")}>Just sign out</button>
            <button className="tap px-2 text-sm text-chalk-faint hover:text-chalk" onClick={() => onLeaving(false)}>Stay</button>
          </div>
        </div>
      ) : (
        <button className="tap mt-1 text-sm text-chalk underline decoration-chalk-ghost underline-offset-4 hover:decoration-chalk" onClick={() => onLeaving(true)}>
          Already have an account? Sign in
        </button>
      )}
    </div>
  );
}
