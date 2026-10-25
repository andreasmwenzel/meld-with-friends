import { Wordmark } from "@/components/site/Wordmark";
import { GuestStart } from "@/components/site/GuestStart";
import { getSessionUser } from "@/lib/auth";
import { Suspense } from "react";

export default function JoinPage({ searchParams }: PageProps<"/join">) {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:py-6">
        <Wordmark size={30} />
      </header>
      <section className="mx-auto max-w-md px-6 py-8 sm:py-16">
        <h1 className="display" style={{ fontSize: "clamp(44px, 14vw, 56px)" }}>Find your table</h1>
        <p className="mt-4 text-chalk-faint">Type the six-letter code your friend sent you.</p>
        <Suspense><JoinSlot searchParams={searchParams} /></Suspense>
      </section>
    </main>
  );
}

async function JoinSlot({ searchParams }: { searchParams: PageProps<"/join">["searchParams"] }) {
  const sp = await searchParams;
  const initial = typeof sp.code === "string" ? sp.code : "";
  const user = await getSessionUser();
  return <div className="mt-8"><GuestStart mode="join" code={initial} signedIn={!!user} /></div>;
}
