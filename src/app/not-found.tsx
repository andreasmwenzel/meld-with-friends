import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { DeadEnd, StrayCard } from "@/components/site/TableScene";

export default function NotFound() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center px-6 py-6"><Wordmark size={30} /></header>
      <DeadEnd art={<StrayCard />} title="Not in this deck."
        actions={<Link href="/" className="btn btn-chalk">Back to the front</Link>}>
        A pinochle deck starts at nine, and Meld has no page at this address. Check the link, or head back.
      </DeadEnd>
    </main>
  );
}
