import { notFound } from "next/navigation";
import { FrontDoor, Welcome } from "@/components/site/FrontDoor";

/** Local-only preview of the signed-out front door. The signed-in lobby is at /dev/home. */
export default function DevWelcomePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FrontDoor><Welcome /></FrontDoor>;
}
