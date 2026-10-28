import type { BotName } from "./tableTalkLines";

/**
 * What a bot's player menu shows: a two-word tag in the same adjective_noun form as players'
 * handles, and one line on who they are. Each follows the bot's table-talk voice.
 * Bots have no account, so the tag is only shown, never looked up.
 */
export interface BotProfile { tag: string; about: string }

export const botProfiles: Readonly<Record<BotName, BotProfile>> = {
  Mabel: { tag: "honey_scone", about: "Bakes for the whole table and calls everyone dear." },
  Otto: { tag: "level_ledger", about: "Counts every point twice and says little." },
  Pearl: { tag: "velvet_starlet", about: "Plays every hand like a premiere, darling." },
  Gus: { tag: "roaring_bleacher", about: "Calls each trick like the last minute of a final." },
  Hazel: { tag: "sly_shark", about: "Talks a big game and shakes your hand after." },
  Walt: { tag: "lazy_angler", about: "Takes his time and has a story from back in '62." },
};

export function botProfile(name: string): BotProfile | null {
  return Object.hasOwn(botProfiles, name) ? botProfiles[name as BotName] : null;
}
