import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Lobby } from "@/components/lobby/Lobby";
import { sortTables, summarizeTable } from "@/lib/tableStatus";
import { ME, SAMPLE_TABLES } from "../sampleTables";

const PROFILE = { id: ME, handle: "copper_heron", display_name: "Andreas", avatar_seed: "andreas" };

/**
 * Local-only preview of the lobby at /home with sample tables. `?tables=N` shows the first N
 * (`?tables=0` is the empty lobby), `?as=guest` a guest's lobby, `?new=1` the open deal panel.
 * Friends and history fetch from the API, so without a session they show their error notes.
 */
export default function DevHomePage({ searchParams }: PageProps<"/dev/home">) {
  if (process.env.NODE_ENV === "production") notFound();
  return <main className="flex-1"><Suspense><Preview searchParams={searchParams} /></Suspense></main>;
}

async function Preview({ searchParams }: { searchParams: PageProps<"/dev/home">["searchParams"] }) {
  const sp = await searchParams;
  const count = sp.tables === undefined ? SAMPLE_TABLES.length : Number(sp.tables);
  const tables = sortTables(SAMPLE_TABLES.slice(0, count).flatMap((t) => summarizeTable(t, ME) ?? []));
  return <Lobby profile={PROFILE} guest={sp.as === "guest"} tables={tables} invites={[]} autoDeal={sp.new === "1"} defaults={null} />;
}
