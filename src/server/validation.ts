import { z } from "zod";
import { normalizeCode } from "@/lib/codes";

export const codeSchema = z.string().transform(normalizeCode).pipe(z.string().regex(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/, "Invalid table code"));
export const idSchema = z.uuid();
export const seatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const rulesSchema = z.object({
  pace: z.enum(["live", "leisurely"]).optional(),
  target: z.number().int().min(300).max(5000).multipleOf(10).optional(),
  minBid: z.number().int().min(100).max(1000).multipleOf(10).optional(),
  bidStep: z.union([z.literal(10), z.literal(20), z.literal(25), z.literal(50)]).optional(),
  passCount: z.number().int().min(0).max(5).optional(),
  lastTrickBonus: z.number().int().min(0).max(50).optional(),
  counterValue: z.literal(10).optional(),
  counting: z.enum(["tens", "classic"]).optional(),
  shoot: z.enum(["off", "game", "points"]).optional(),
  shootPoints: z.number().int().min(100).max(5000).multipleOf(10).optional(),
  setPenaltyIsBid: z.literal(true).optional(),
  mustTakeTrickToSaveMeld: z.boolean().optional(),
  dealerStuck: z.boolean().optional(),
  revealHands: z.boolean().optional(),
}).strict();
const card = z.templateLiteral([z.enum(["A","T","K","Q","J","9"]), z.enum(["S","H","D","C"]), z.union([z.literal(0),z.literal(1)])]);
const cards = z.array(card).max(12).refine(v => new Set(v).size === v.length, "Duplicate cards");
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bid"), seat: seatSchema, amount: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("pass_bid"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("shoot"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("declare_trump"), seat: seatSchema, suit: z.enum(["S","H","D","C"]) }).strict(),
  z.object({ type: z.literal("pass_cards"), seat: seatSchema, cards }).strict(),
  z.object({ type: z.literal("declare_meld"), seat: seatSchema, cards }).strict(),
  z.object({ type: z.literal("confirm_meld"), seat: seatSchema }).strict(),
  z.object({ type: z.literal("play_card"), seat: seatSchema, card }).strict(),
  z.object({ type: z.literal("next_hand"), seat: seatSchema }).strict(),
]);
export const handleSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/);
