import { notFound } from "next/navigation";
import { DevGame } from "./DevGame";

/** Local-only preview of the game board with a scripted hand. Not reachable in production. */
export default function DevGamePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevGame />;
}
