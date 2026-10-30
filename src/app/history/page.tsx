import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LobbyFrame } from "@/components/lobby/Lobby";
import { History } from "@/components/lobby/History";
import { PastGames } from "@/components/lobby/PastGames";
import { getSessionUser } from "@/lib/auth";
import { SessionAccount } from "@/components/site/SessionAccount";

export const metadata: Metadata = { title: "Past games · Meld" };

/** Your finished games, newest first, each opening its replay. Signed-out visitors go to the front door. */
export default function HistoryPage() {
  return (
    <LobbyFrame account={<Suspense><SessionAccount /></Suspense>}>
      <PastGames>
        <Suspense fallback={<p className="mt-3 text-chalk-faint">Looking through the score sheets.</p>}>
          <SignedIn />
        </Suspense>
      </PastGames>
    </LobbyFrame>
  );
}

async function SignedIn() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return <History />;
}
