import Link from "next/link";
import type { ReactNode } from "react";

/** The past games page under the lobby header: a way back to the tables, the heading, then the list. */
export function PastGames({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-16 sm:pb-20"><div className="max-w-2xl">
      <Link href="/" className="tap-link text-sm text-chalk-faint underline-offset-4 hover:text-chalk hover:underline">
        <span aria-hidden className="mr-1.5">&lsaquo;</span>Back to your tables
      </Link>
      <h1 className="display mt-1" style={{ fontSize: "clamp(40px, 6vw, 56px)" }}>Past games</h1>
      {children}
    </div></section>
  );
}
