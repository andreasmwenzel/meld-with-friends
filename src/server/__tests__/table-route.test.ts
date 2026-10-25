vi.mock("@/server/bans", () => ({ isBanned: async () => false }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/tables/[code]/route";

const mocks = vi.hoisted(() => ({ update: vi.fn(), getUser: vi.fn() }));
vi.mock("@/server/tables", () => ({ updateTableRules: mocks.update, getTableSnapshot: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

const context = { params: Promise.resolve({ code: "BCDFGH" }) };
const request = (input: unknown) => new Request("http://localhost/api/tables/BCDFGH", {
  method: "PATCH", body: JSON.stringify(input), headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "host" } }, error: null });
});

describe("PATCH table rules", () => {
  it("returns the updated snapshot", async () => {
    const snapshot = { table: { code: "BCDFGH", rules: { counting: "classic" } }, seats: [], offers: [], mySeat: null };
    mocks.update.mockResolvedValue(snapshot);
    const response = await PATCH(request({ rules: { counting: "classic" } }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
    expect(mocks.update).toHaveBeenCalledWith("BCDFGH", { counting: "classic" }, "host");
  });

  it.each([{}, { rules: { target: 501 } }, { rules: { extra: true } }, { rules: {}, extra: true }])(
    "rejects invalid bodies %j", async input => {
      const response = await PATCH(request(input), context);
      expect(response.status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await PATCH(request({ rules: {} }), context);
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
