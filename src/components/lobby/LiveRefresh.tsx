"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the server-rendered page when the tab comes back into view, and now and then while it is open. */
export function LiveRefresh({ everyMs = 45_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router, everyMs]);
  return null;
}
