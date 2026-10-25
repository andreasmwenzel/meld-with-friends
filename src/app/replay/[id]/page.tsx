import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { ReplayLoader } from "@/components/replay/Replay";

export const metadata: Metadata = {
  title: "Game replay · Meld",
  description: "Step through every bid, pass, meld and trick of a pinochle game played on Meld.",
};

/** Public: anyone holding a game's link can step through its completed hands. */
export default function ReplayPage({ params }: PageProps<"/replay/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
        <Wordmark size={26} />
        <Link href="/home" className="tap text-sm text-chalk-faint hover:text-chalk">Your tables</Link>
      </header>
      <Suspense fallback={<p className="px-6 py-10 text-chalk-faint">Dealing the hands back out.</p>}>
        <Viewer params={params} />
      </Suspense>
    </main>
  );
}

async function Viewer({ params }: { params: PageProps<"/replay/[id]">["params"] }) {
  const { id } = await params;
  return <ReplayLoader id={id} />;
}
