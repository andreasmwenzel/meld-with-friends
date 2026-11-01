import type { Metadata } from "next";
import { Suspense } from "react";
import { ReplayLoader } from "@/components/replay/Replay";
import { Dealing } from "@/components/site/TableScene";

export const metadata: Metadata = {
  title: "Game replay · Meld",
  description: "Step through every bid, pass, meld and trick of a pinochle game played on Meld.",
};

/** Public: anyone holding a game's link can step through its completed hands. */
export default function ReplayPage({ params }: PageProps<"/replay/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<Dealing label="Dealing the hands back out." />}>
        <Viewer params={params} />
      </Suspense>
    </main>
  );
}

async function Viewer({ params }: { params: PageProps<"/replay/[id]">["params"] }) {
  const { id } = await params;
  return <ReplayLoader id={id} />;
}
