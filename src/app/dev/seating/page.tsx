"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { Seating } from "@/components/table/Seating";
import type { Snapshot } from "@/components/table/types";
import type { SeatIndex } from "@/engine/types";

const ME = { id: "u0", handle: "andreas", display_name: "Andreas", avatar_seed: "" };
const OTHERS = {
  1: { id: "u1", handle: "margaret", display_name: "Margaret", avatar_seed: "" },
  3: { id: "u3", handle: "june", display_name: "June", avatar_seed: "" },
};

/** Local-only preview of the seating screen. `?seat=` picks your chair; the row above moves you so the table turns. */
export default function DevSeatingPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [mySeat, setMySeat] = useState<SeatIndex | null>(0);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("seat");
    if (raw !== null) setMySeat(raw === "none" ? null : (Number(raw) as SeatIndex)); // eslint-disable-line react-hooks/set-state-in-effect -- read once from the URL on mount
  }, []);
  // Margaret and June keep their chairs unless you take one; Otto the computer sits across from South.
  const snap: Snapshot = {
    table: { id: "t", code: "KQJ9TA", host: "u0", status: "open", rules: { scoring: "modern", target: 150, passCount: 4 } },
    seats: ([0, 1, 2, 3] as SeatIndex[]).map(seat => seat === mySeat
      ? { seat, user_id: ME.id, profile: ME, bot: null }
      : seat === 2 ? { seat, user_id: null, profile: null, bot: "Otto" }
      : seat === 1 || seat === 3 ? { seat, user_id: OTHERS[seat].id, profile: OTHERS[seat], bot: null }
      : { seat, user_id: null, profile: null, bot: null }),
    offers: mySeat === 0 ? [{ id: "o1", from_user: "u1", to_user: "u0", from_seat: 1, to_seat: 0, status: "pending" }] : [],
    mySeat,
  };
  return (
    <>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 pt-4 text-xs text-chalk-faint" aria-label="Dev: move yourself">
        <span>Dev: sit at</span>
        {(["none", 0, 1, 2, 3] as const).map(s => (
          <button key={s} type="button" className="tap-link underline" aria-pressed={(s === "none" ? null : s) === mySeat}
            onClick={() => setMySeat(s === "none" ? null : s)}>{s === "none" ? "standing" : ["South", "West", "North", "East"][s]}</button>
        ))}
      </div>
      <Seating code="KQJ9TA" me={ME} snap={snap} onChange={() => {}} />
    </>
  );
}
