import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { PlayingCard } from "@/components/cards/PlayingCard";

export default function NotFound() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center px-6 py-6"><Wordmark size={30} /></header>
      <section className="mx-auto flex max-w-3xl flex-col items-start gap-8 px-6 py-16 sm:flex-row sm:items-center">
        <div className="flex -space-x-8">
          <PlayingCard card="9S0" width={96} style={{ transform: "rotate(-8deg)" }} />
          <PlayingCard card="9H0" width={96} style={{ transform: "rotate(6deg)" }} />
        </div>
        <div>
          <h1 className="display" style={{ fontSize: 56 }}>Nothing here.</h1>
          <p className="mt-3 text-chalk-faint">This page is not on the table. Check the link, or head back.</p>
          <Link href="/" className="btn btn-chalk mt-6">Back to the front</Link>
        </div>
      </section>
    </main>
  );
}
