import { describe, expect, it } from "vitest";
import { botTag, botTags } from "@/lib/bots/profiles";
import { botVoices } from "@/lib/bots/tableTalkLines";

describe("bot tags", () => {
  it("gives every voiced bot a two-word tag shaped like a player handle", () => {
    expect(Object.keys(botTags).sort()).toEqual(Object.keys(botVoices).sort());
    const tags = Object.values(botTags);
    for (const tag of tags) expect(tag).toMatch(/^[a-z]+_[a-z]+$/);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("knows only the bots' own names", () => {
    expect(botTag("Mabel")).toBe("honey_scone");
    expect(botTag("North bot")).toBeNull();
    expect(botTag("toString")).toBeNull();
  });
});
