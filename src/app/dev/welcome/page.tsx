import { Suspense } from "react";
import { notFound } from "next/navigation";
import { FrontDoor, Returning, Welcome } from "@/components/site/FrontDoor";
import { sortTables, summarizeTable } from "@/lib/tableStatus";
import { ME, SAMPLE_TABLES } from "../sampleTables";

/** Local-only preview of the front door. `?as=new` shows the signed-out welcome, `?tables=0` an empty lobby. */
export default function DevWelcomePage({ searchParams }: PageProps<"/dev/welcome">) {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense><Preview searchParams={searchParams} /></Suspense>;
}

async function Preview({ searchParams }: { searchParams: PageProps<"/dev/welcome">["searchParams"] }) {
  const sp = await searchParams;
  if (sp.as === "new") return <FrontDoor><Welcome /></FrontDoor>;
  const count = sp.tables === undefined ? SAMPLE_TABLES.length : Number(sp.tables);
  const tables = sortTables(SAMPLE_TABLES.slice(0, count).flatMap((t) => summarizeTable(t, ME) ?? []));
  return <FrontDoor><Returning name="Andreas" fullName="Andreas" guest={sp.as === "guest"} tables={tables} defaults={null} live={false} /></FrontDoor>;
}
