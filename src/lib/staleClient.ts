// A page left open across a deploy keeps running the build it loaded. The server stamps every table
// view with its build, and a board that sees a newer one reloads once so it can show new phases.

/** This bundle's build: the commit Vercel built, or "dev" anywhere else. Set in next.config.ts. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
const RELOADED_FOR = "meld.reloadedFor";

/**
 * Whether a response stamped with `marker` comes from a different build than this page, and the page
 * has not already reloaded for that build in this tab. Records the reload, so it happens at most once
 * per build: if the reload still brings back the old bundle, the page carries on instead of looping.
 * A response without a marker (a server from before stamping, the lab, practice) never counts.
 */
export function staleBuild(marker: unknown, own: string = BUILD_ID): boolean {
  if (typeof marker !== "string" || !marker || marker === own) return false;
  try {
    // One key per target keeps all attempts, even when deploys answer A, B, A, B.
    const key = `${RELOADED_FOR}:${marker}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch { return false; }
  return true;
}

export function reloadPage() { window.location.reload(); }
