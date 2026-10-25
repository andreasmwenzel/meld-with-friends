import "server-only";
import { bump } from "./metrics";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}

export function checkDb(error: { code?: string; message: string } | null) {
  if (!error) return;
  const status = error.code === "P0429" ? 429 : error.code === "42501" ? 403
    : error.code === "P0002" || error.code === "PGRST116" ? 404
    : error.code === "23505" || error.code === "40001" || error.code === "PT409" ? 409
    : error.code?.startsWith("22") || error.code === "23514" || error.code === "23503" ? 400 : 500;
  if (status === 429) bump("rate_limited");
  if (status === 500) { console.error("Database operation failed", error); throw new ApiError(500, "Database operation failed"); }
  throw new ApiError(status, error.message);
}
