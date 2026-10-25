import "server-only";
import { requireUser } from "./http";
import { ApiError } from "./errors";

export function isAdmin(user: { email?: string | null }) {
  return !!user.email && (process.env.ADMIN_EMAILS ?? "").split(",").some(email => email.trim().toLowerCase() === user.email!.trim().toLowerCase());
}
export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.is_anonymous || !isAdmin(session.user)) throw new ApiError(403, "Admin access required");
  return session;
}
export function requireSavedAccount(user: { is_anonymous?: boolean }) {
  if (user.is_anonymous !== false) throw new ApiError(403, "Computer players need a saved account");
}
