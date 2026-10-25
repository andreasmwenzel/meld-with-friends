import { expect, it } from "vitest";
import { redirect } from "next/navigation";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";

it("preserves Next.js control errors instead of returning an API 500", async () => {
  await expect(json(async () => redirect("/home"))).rejects.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
});

it("still formats application errors as private JSON responses", async () => {
  const response = await json(async () => { throw new ApiError(409, "Game changed; refresh and retry"); });
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "Game changed; refresh and retry" });
});

it("maps explicit database conflicts to HTTP 409", async () => {
  const { checkDb } = await import("@/server/errors");
  const response = await json(async () => checkDb({ code: "PT409", message: "The hand is not over" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "The hand is not over" });
});
