"use client";

import { notFound } from "next/navigation";
import { Seating } from "@/components/table/Seating";
import type { Snapshot } from "@/components/table/types";

/** Local-only preview of the seating screen. */
export default function DevSeatingPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const snap: Snapshot = {
    table: { id: "t", code: "KQJ9TA", host: "u0", status: "open", rules: { target: 1500, passCount: 4 } },
    seats: [
      { seat: 0, user_id: "u0", profile: { id: "u0", handle: "andreas", display_name: "Andreas", avatar_seed: "" }, bot: null },
      { seat: 1, user_id: "u1", profile: { id: "u1", handle: "margaret", display_name: "Margaret", avatar_seed: "" }, bot: null },
      { seat: 2, user_id: null, profile: null, bot: "Otto" },
      { seat: 3, user_id: "u3", profile: { id: "u3", handle: "june", display_name: "June", avatar_seed: "" }, bot: null },
    ],
    offers: [{ id: "o1", from_user: "u1", to_user: "u0", from_seat: 1, to_seat: 0, status: "pending" }],
    mySeat: 0,
  };
  return <Seating code="KQJ9TA" me={{ id: "u0", handle: "andreas", display_name: "Andreas", avatar_seed: "" }} snap={snap} onChange={() => {}} />;
}
