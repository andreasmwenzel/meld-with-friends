import { notFound } from "next/navigation";
import { Lab } from "@/components/dev/Lab";

/** Local-only game lab: load any position, play any seat, rewind. Not reachable in production. See docs/DEV_TOOLS.md. */
export default function DevLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Lab />;
}
