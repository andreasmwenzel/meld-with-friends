import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getPublicEnv } from "@/lib/env";

export async function createClient() {
  const env = getPublicEnv();
  const store = await cookies();
  // A bearer token (native clients, scripts) takes precedence over the cookie session.
  const bearer = (await headers()).get("authorization");
  const global = bearer?.toLowerCase().startsWith("bearer ") ? { headers: { Authorization: bearer } } : undefined;
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global,
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Proxy handles refresh there.
        }
      },
    },
  });
}
