import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SessionAccount } from "@/components/site/SessionAccount";
import { PracticeBoard } from "@/components/practice/PracticeBoard";

export const metadata: Metadata = { title: "Practice hand · Meld" };

export default function PracticePage() {
  return (
    <main className="flex flex-1 flex-col has-[.board]:h-dvh has-[.board]:flex-none has-[.board]:overflow-hidden short:has-[.board]:h-auto short:has-[.board]:overflow-visible">
      {/* Upright, header, coach and board share one screen. Sideways on a phone the board takes the whole screen and the header follows it below the fold. */}
      <SiteHeader wide className="short:order-last short:py-2" account={<Suspense><SessionAccount /></Suspense>}>
        <Link href="/" className="tap text-sm text-chalk-faint hover:text-chalk">Leave practice</Link>
      </SiteHeader>
      <PracticeBoard />
    </main>
  );
}
