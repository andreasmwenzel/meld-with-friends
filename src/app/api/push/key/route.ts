import { json } from "@/server/http";

export async function GET() {
  return json(async () => ({ publicKey: process.env.VAPID_PUBLIC_KEY || null }));
}
