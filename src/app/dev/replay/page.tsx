import { notFound } from "next/navigation";
import { DevReplay } from "@/components/dev/DevReplay";

/** Local-only: a replay of a game the bots play on the spot, for checking the viewer without a database. */
export default function DevReplayPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevReplay />;
}
