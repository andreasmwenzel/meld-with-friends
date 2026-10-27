import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  // URL parsing normalizes backslashes and strips control characters. Check the
  // resolved origin too, so a path such as /\evil.example cannot escape the site.
  let safeNext = new URL("/", url.origin);
  try {
    const destination = new URL(next, url.origin);
    if (next.startsWith("/") && destination.origin === url.origin) safeNext = destination;
  } catch { /* Invalid destinations use the lobby. */ }
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(safeNext);
  }
  return NextResponse.json({ error: "Authentication link is invalid or expired" }, { status: 400 });
}
