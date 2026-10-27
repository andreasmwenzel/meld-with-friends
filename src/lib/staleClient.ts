// A page left open across a deploy keeps running the build it loaded. The server stamps every table
// view with its build, and a board that sees a newer one reloads once so it can show new phases.

/** This bundle's build: the commit Vercel built, or "dev" anywhere else. Set in next.config.ts. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
const RELOADED_FOR = "meld.reloadedFor";
const MAX_ATTEMPTS = 8;
// Storage can be blocked or full. In that case allow one attempt for the lifetime of this page.
let fallbackAttempted = false;

function attempts(): string[] {
  const stored: unknown = JSON.parse(sessionStorage.getItem(RELOADED_FOR) ?? "[]");
  return Array.isArray(stored) ? stored.filter((build): build is string => typeof build === "string").slice(-MAX_ATTEMPTS) : [];
}

/**
 * Whether a response stamped with `marker` comes from a different build than this page, and the page
 * has not already reloaded for that build in this tab. Detection does not consume an attempt, since
 * the board may unmount before its reload timer fires.
 * A response without a marker (a server from before stamping, the lab, practice) never counts.
 */
export function staleBuild(marker: unknown, own: string = BUILD_ID): boolean {
  if (typeof marker !== "string" || !marker || marker === own || fallbackAttempted) return false;
  try { return !attempts().includes(marker); }
  catch { return true; }
}

/** Claim an attempt immediately before reloading. Retain the eight latest targets to stop A/B loops. */
export function recordBuildReload(marker: string, own: string = BUILD_ID): boolean {
  if (!staleBuild(marker, own)) return false;
  try { sessionStorage.setItem(RELOADED_FOR, JSON.stringify([...attempts(), marker].slice(-MAX_ATTEMPTS))); }
  catch { fallbackAttempted = true; }
  return true;
}

export function reloadPage() { window.location.reload(); }
