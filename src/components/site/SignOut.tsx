"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOut() {
  const router = useRouter();
  return (
    <button className="tap text-sm text-chalk-faint hover:text-chalk px-2" onClick={async () => { await createClient().auth.signOut(); router.push("/"); router.refresh(); }}>
      Sign out
    </button>
  );
}
