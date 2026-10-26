import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { PracticeBoard } from "@/components/practice/PracticeBoard";

export const metadata: Metadata = { title: "Practice hand · Meld" };

export default function PracticePage() {
  return (
    <main className="flex flex-1 flex-col has-[.board]:h-dvh has-[.board]:flex-none has-[.board]:overflow-hidden short:has-[.board]:h-auto short:has-[.board]:overflow-visible">
      {/* Upright, header, coach and board share one screen. Sideways on a phone the board takes the whole screen and the header follows it below the fold. */}
      <header className="mx-auto flex w-full max-w-[1500px] shrink-0 items-center justify-between px-6 py-3 sm:py-4 short:order-last short:py-2">
        <Wordmark size={26} />
        <Link href="/" className="tap text-sm text-chalk-faint hover:text-chalk">Leave practice</Link>
      </header>
      <PracticeBoard />
    </main>
  );
}
