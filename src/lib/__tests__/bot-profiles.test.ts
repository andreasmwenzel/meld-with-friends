import { describe, expect, it } from "vitest";
import { botProfile, botProfiles } from "@/lib/bots/profiles";
import { botVoices } from "@/lib/bots/tableTalkLines";

describe("bot profiles", () => {
  it("gives every voiced bot a two-word tag shaped like a player handle", () => {
    expect(Object.keys(botProfiles).sort()).toEqual(Object.keys(botVoices).sort());
    const tags = Object.values(botProfiles).map(p => p.tag);
    for (const tag of tags) expect(tag).toMatch(/^[a-z]+_[a-z]+$/);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("knows only the bots' own names", () => {
    expect(botProfile("Mabel")?.tag).toBe("honey_scone");
    expect(botProfile("North bot")).toBeNull();
    expect(botProfile("toString")).toBeNull();
  });
});
