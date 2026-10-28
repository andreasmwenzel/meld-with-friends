import type { BotName } from "./tableTalkLines";

/**
 * A bot's tag in its player menu: two words in the same adjective_noun form as players' handles, each
 * following the bot's table-talk voice. Bots have no account, so the tag is only shown, never looked up.
 */
export const botTags: Readonly<Record<BotName, string>> = {
  Mabel: "honey_scone",
  Otto: "level_ledger",
  Pearl: "velvet_starlet",
  Gus: "roaring_bleacher",
  Hazel: "sly_shark",
  Walt: "lazy_angler",
};

export function botTag(name: string): string | null {
  return Object.hasOwn(botTags, name) ? botTags[name as BotName] : null;
}
