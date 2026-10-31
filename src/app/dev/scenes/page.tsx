import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/site/Wordmark";
import { CodeHand, Dealing, DeadEnd, EmptySeat, StrayCard, TrickPiles } from "@/components/site/TableScene";

/** Local-only preview of the pages between games (TableScene): `?s=seat|code|stray|piles|askew|dealing`;
 * `&t=1.5` holds the deal at that second, for screenshots. */
export default function DevScenesPage({ searchParams }: PageProps<"/dev/scenes">) {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense><Scenes searchParams={searchParams} /></Suspense>;
}

async function Scenes({ searchParams }: { searchParams: PageProps<"/dev/scenes">["searchParams"] }) {
  const { s = "seat", t } = await searchParams;
  const home = <Link href="/" className="btn btn-chalk">Back to your tables</Link>;
  const scenes: Record<string, React.ReactNode> = {
    seat: <DeadEnd art={<EmptySeat />} title="This table is full." actions={<>{home}<Link href="/join" className="tap-link text-chalk-faint underline underline-offset-4 hover:text-chalk">Join another table</Link></>}>
      Four players are already in this game, and only they can see its cards. Once it is over, any of them can send you a link to replay it.</DeadEnd>,
    code: <DeadEnd art={<CodeHand code="KQJ9TA" />} title="No table has this code." actions={<Link href="/join" className="btn btn-chalk">Try another code</Link>}>Check the code with whoever dealt the table.</DeadEnd>,
    stray: <DeadEnd art={<StrayCard />} title="Not in this deck." actions={<Link href="/" className="btn btn-chalk">Back to the front</Link>}>A pinochle deck starts at nine, and Meld has no page at this address. Check the link, or head back.</DeadEnd>,
    piles: <DeadEnd art={<TrickPiles />} title="Nothing to replay here." actions={home}>While the game is going, only its players can review it. Share the link once it is over.</DeadEnd>,
    askew: <DeadEnd art={<TrickPiles askew />} title="This game will not replay." actions={home}>The rules have changed since it was played, so its moves no longer line up.</DeadEnd>,
    dealing: <Dealing label="Dealing." />,
  };
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center px-6 py-6"><Wordmark size={30} /></header>
      {t && <style>{`.deal-card { animation-play-state: paused; animation-delay: -${Number(t)}s; }`}</style>}
      {scenes[String(s)] ?? scenes.seat}
    </main>
  );
}
