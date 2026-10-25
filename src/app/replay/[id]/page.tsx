import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { ReplayLoader } from "@/components/replay/Replay";

export const metadata: Metadata = {
  title: "Game replay · Meld",
  description: "Step through every bid, pass, meld and trick of a pinochle game played on Meld.",
};

/** Public: anyone holding a game's link can step through its completed hands. */
export default async function ReplayPage({ params }: PageProps<"/replay/[id]">) {
  const { id } = await params;
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
        <Wordmark size={26} />
        <Link href="/home" className="tap text-sm text-chalk-faint hover:text-chalk">Your tables</Link>
      </header>
      <ReplayLoader id={id} />
    </main>
  );
}
