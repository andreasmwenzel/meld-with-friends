import type { SeatIndex, Team } from "@/engine/types";
import type { Profile } from "@/lib/api";

export interface Seat { seat: SeatIndex; user_id: string | null; profile: Profile | null; /** computer player name when this chair holds a bot */ bot: string | null }
export interface TradeOffer { id: string; from_user: string; to_user: string; from_seat: SeatIndex; to_seat: SeatIndex; status: string }
export interface TableRow { id: string; code: string; host: string; status: "open" | "playing" | "finished"; rules: Record<string, unknown> }
export interface PausedTable { by: string; name: string; reason: string | null; at: string }
export interface Snapshot { table: TableRow; seats: Seat[]; offers: TradeOffer[]; mySeat: SeatIndex | null; ready?: SeatIndex[]; paused?: PausedTable | null }

export const SEAT_LABEL: Record<SeatIndex, string> = { 0: "South", 1: "West", 2: "North", 3: "East" };
export const teamOf = (seat: SeatIndex): Team => (seat % 2 === 0 ? "red" : "blue");
