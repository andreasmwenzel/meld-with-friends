import type { ReactNode } from "react";
import { Wordmark } from "./Wordmark";

/**
 * The strip across the top of every page off the board: the wordmark, then whatever the page adds (a table code,
 * a way back), then your account. `wide` matches the practice board's width.
 */
export function SiteHeader({ children, account, wide = false, className = "" }: {
  children?: ReactNode; account?: ReactNode; wide?: boolean; className?: string;
}) {
  return (
    <header className={`mx-auto flex w-full shrink-0 items-center justify-between gap-3 px-5 py-3 sm:px-6 sm:py-4 ${wide ? "max-w-[1500px]" : "max-w-6xl"} ${className}`}>
      <Wordmark size={28} />
      <nav className="flex min-w-0 items-center gap-2 sm:gap-3">
        {children}
        {account}
      </nav>
    </header>
  );
}
