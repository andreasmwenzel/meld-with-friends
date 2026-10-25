import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDb } from "./errors";

// Restrict outbound requests to browser push providers, avoiding arbitrary server-side URLs.
export const endpointSchema = z.url().max(4096).refine(value => {
  const url = new URL(value);
  const host = url.hostname;
  return url.protocol === "https:" && !url.username && !url.password && !url.port && (
    host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") || host === "web.push.apple.com" ||
    host.endsWith(".notify.windows.com")
  );
}, "Unsupported push endpoint");
export const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }).strict(),
}).strict();

export async function subscribe(userId: string, subscription: z.infer<typeof subscriptionSchema>) {
  const { error } = await createAdminClient().from("push_subscriptions").upsert({
    user_id: userId, endpoint: subscription.endpoint, keys: subscription.keys,
  }, { onConflict: "endpoint" });
  checkDb(error);
  return { ok: true };
}
export async function unsubscribe(userId: string, endpoint: string) {
  const { error } = await createAdminClient().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", userId);
  checkDb(error);
  return { ok: true };
}
