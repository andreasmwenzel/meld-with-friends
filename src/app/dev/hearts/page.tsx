import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DevHearts } from "./DevHearts";

/** A hearts table played in the browser against the engine's computer players; local only (see docs/DEV_TOOLS.md). */
export default function DevHeartsPage({ searchParams }: PageProps<"/dev/hearts">) {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense><Board searchParams={searchParams} /></Suspense>;
}

async function Board({ searchParams }: { searchParams: PageProps<"/dev/hearts">["searchParams"] }) {
  const sp = await searchParams;
  const state = typeof sp.state === "string" ? sp.state : "passing";
  const seed = typeof sp.seed === "string" ? sp.seed : "lab";
  return <DevHearts state={state} seed={seed} run={sp.run !== "0"} />;
}
