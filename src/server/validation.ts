import { z } from "zod";
import { resolveRules } from "@/engine/scoring";
import { normalizeCode } from "@/lib/codes";

export const codeSchema = z.string().transform(normalizeCode).pipe(z.string().regex(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/, "Invalid table code"));
export const idSchema = z.uuid();
export const seatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const rulesSchema = z.object({
  scoring: z.enum(["modern", "classic"]).optional(),
  pace: z.enum(["live", "leisurely"]).optional(),
  target: z.number().int().min(30).max(5000).optional(),
  minBid: z.number().int().min(10).max(1000).optional(),
  bidStep: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10), z.literal(20), z.literal(25), z.literal(50)]).optional(),
  passCount: z.number().int().min(0).max(5).optional(),
  lastTrickBonus: z.number().int().min(0).max(50).optional(),
  counterValue: z.union([z.literal(1), z.literal(10)]).optional(),
  counting: z.enum(["tens", "classic"]).optional(),
  shoot: z.enum(["off", "game", "points"]).optional(),
  shootPoints: z.number().int().min(10).max(5000).optional(),
  setPenaltyIsBid: z.literal(true).optional(),
  mustTakeTrickToSaveMeld: z.boolean().optional(),
  dealerStuck: z.boolean().optional(),
  revealHands: z.boolean().optional(),
  ninesMisdeal: z.boolean().optional(),
}).strict().superRefine((patch, ctx) => {
  const rules = resolveRules(patch);
  const modern = rules.scoring === "modern";
  const factor = modern ? 0.1 : 1;
  const check = (ok: boolean, path: string, message: string) => {
    if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
  };
  for (const [key, min, max] of [["target", 300, 5000], ["minBid", 100, 1000], ["shootPoints", 100, 5000]] as const) {
    check(rules[key] >= min * factor && rules[key] <= max * factor
      && (modern || rules[key] % 10 === 0), key, `Invalid ${key} for ${rules.scoring} scoring`);
  }
  check((modern ? [1, 2, 5] : [10, 20, 25, 50]).includes(rules.bidStep), "bidStep", "Invalid bid step for scoring scale");
  check(rules.counterValue === (modern ? 1 : 10), "counterValue", "Counter value must match scoring scale");
  check(rules.lastTrickBonus <= 50 * factor, "lastTrickBonus", "Last trick bonus exceeds scoring scale maximum");
  check(!modern || rules.counting !== "classic", "counting", "Old-style counting requires classic scoring");
});
const card = z.templateLiteral([z.enum(["A","T","K","Q","J","9"]), z.enum(["S","H","D","C"]), z.union([z.literal(0),z.literal(1)])]);
const cards = z.array(card).max(12).refine(v => new Set(v).size === v.length, "Duplicate cards");
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bid"), seat: seatSchema, amount: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("pass_bid"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("shoot"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("misdeal"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("declare_trump"), seat: seatSchema, suit: z.enum(["S","H","D","C"]) }).strict(),
  z.object({ type: z.literal("pass_cards"), seat: seatSchema, cards }).strict(),
  z.object({ type: z.literal("declare_meld"), seat: seatSchema, cards }).strict(),
  z.object({ type: z.literal("confirm_meld"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("play_card"), seat: seatSchema, card }).strict(),
  z.object({ type: z.literal("next_hand"), seat: seatSchema }).strict(),
]);
export const handleSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/);
