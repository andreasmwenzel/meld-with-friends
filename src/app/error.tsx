"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { DeadEnd, TrickPiles } from "@/components/site/TableScene";

/** Anything that throws while a page draws: the piles knocked over, a retry and a way home. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center px-6 py-6"><Wordmark size={30} /></header>
      <DeadEnd art={<TrickPiles askew />} title="This page hit a snag."
        actions={<>
          <button type="button" className="btn btn-chalk" onClick={() => retry()}>Try again</button>
          <Link href="/" className="tap-link text-chalk-faint underline underline-offset-4 hover:text-chalk">Back to your tables</Link>
        </>}>
        Something went wrong while drawing it. Try again, and if it keeps happening, start over from your tables.
      </DeadEnd>
    </main>
  );
}
