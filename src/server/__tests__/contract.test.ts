import * as seen from "@/app/api/tables/[code]/seen/route";
import * as tablemates from "@/app/api/tables/[code]/tablemates/route";
import * as host from "@/app/api/tables/[code]/host/route";
import * as resume from "@/app/api/tables/[code]/resume/route";
import * as pause from "@/app/api/tables/[code]/pause/route";
import * as ready from "@/app/api/tables/[code]/ready/route";
import * as history from "@/app/api/history/route";
import * as adminTables from "@/app/api/admin/tables/route";
import * as finishTable from "@/app/api/admin/tables/[code]/finish/route";
import * as bans from "@/app/api/admin/bans/route";
import * as rematch from "@/app/api/tables/[code]/rematch/route";
import * as standin from "@/app/api/tables/[code]/standin/route";
import * as adminSettings from "@/app/api/admin/settings/route";
import * as adminStats from "@/app/api/admin/stats/route";
import * as adminArena from "@/app/api/admin/arena/route";
import * as bots from "@/app/api/tables/[code]/bots/route";
import * as fill from "@/app/api/tables/[code]/bots/fill/route";
import * as tick from "@/app/api/tables/[code]/tick/route";
import { describe, expect, it } from "vitest";
import * as me from "@/app/api/me/route";
import * as friends from "@/app/api/friends/route";
import * as friend from "@/app/api/friends/[id]/route";
import * as groups from "@/app/api/groups/route";
import * as group from "@/app/api/groups/[id]/route";
import * as invites from "@/app/api/invites/route";
import * as invite from "@/app/api/invites/[code]/route";
import * as tables from "@/app/api/tables/route";
import * as table from "@/app/api/tables/[code]/route";
import * as join from "@/app/api/tables/[code]/join/route";
import * as seat from "@/app/api/tables/[code]/seat/route";
import * as trade from "@/app/api/tables/[code]/trade/route";
import * as answerTrade from "@/app/api/trades/[id]/route";
import * as start from "@/app/api/tables/[code]/start/route";
import * as view from "@/app/api/tables/[code]/view/route";
import * as act from "@/app/api/tables/[code]/act/route";
import * as keepalive from "@/app/api/cron/keepalive/route";
import * as callback from "@/app/auth/callback/route";

const contracts: [string, object, string[]][] = [
  ["/api/tables/[code]/seen", seen, ["POST"]],
  ["/api/tables/[code]/tablemates", tablemates, ["GET"]],
  ["/api/tables/[code]/host", host, ["POST"]],
  ["/api/tables/[code]/resume", resume, ["POST"]],
  ["/api/tables/[code]/pause", pause, ["POST"]],
  ["/api/tables/[code]/ready", ready, ["POST"]],
  ["/api/history", history, ["GET"]],
  ["/api/admin/tables", adminTables, ["GET"]],
  ["/api/admin/tables/[code]/finish", finishTable, ["POST"]],
  ["/api/admin/bans", bans, ["GET", "POST", "DELETE"]],
  ["/api/tables/[code]/rematch", rematch, ["POST"]],
  ["/api/tables/[code]/standin", standin, ["POST"]],
  ["/api/admin/settings", adminSettings, ["GET", "PATCH"]],
  ["/api/admin/stats", adminStats, ["GET"]],
  ["/api/admin/arena", adminArena, ["POST"]],
  ["/api/tables/[code]/bots", bots, ["POST", "DELETE"]],
  ["/api/tables/[code]/bots/fill", fill, ["POST"]],
  ["/api/tables/[code]/tick", tick, ["POST"]],
  ["/api/me", me, ["GET", "PATCH"]],
  ["/api/friends", friends, ["GET", "POST"]],
  ["/api/friends/[id]", friend, ["POST", "DELETE"]],
  ["/api/groups", groups, ["GET", "POST"]],
  ["/api/groups/[id]", group, ["PATCH", "DELETE"]],
  ["/api/invites", invites, ["GET"]],
  ["/api/invites/[code]", invite, ["DELETE"]],
  ["/api/tables", tables, ["POST"]],
  ["/api/tables/[code]", table, ["GET", "PATCH"]],
  ["/api/tables/[code]/join", join, ["POST"]],
  ["/api/tables/[code]/seat", seat, ["POST", "DELETE"]],
  ["/api/tables/[code]/trade", trade, ["POST"]],
  ["/api/trades/[id]", answerTrade, ["POST"]],
  ["/api/tables/[code]/start", start, ["POST"]],
  ["/api/tables/[code]/view", view, ["GET"]],
  ["/api/tables/[code]/act", act, ["POST"]],
  ["/api/cron/keepalive", keepalive, ["GET"]],
  ["/auth/callback", callback, ["GET"]],
];

describe("client route contracts without a database", () => {
  it.each(contracts)("%s exports its expected handlers", (_path, route, methods) => {
    for (const method of methods) {
      expect((route as Record<string, unknown>)[method]).toBeTypeOf("function");
    }
  });
});
