import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TableRoom } from "@/components/table/TableRoom";
import { GuestStart } from "@/components/site/GuestStart";
import { Wordmark } from "@/components/site/Wordmark";
import { Dealing } from "@/components/site/TableScene";

export default function TablePage({ params }: PageProps<"/t/[code]">) {
  return (
    <Suspense fallback={<main className="flex flex-1 flex-col"><Dealing label="Finding the table." /></main>}>
      <Room params={params} />
    </Suspense>
  );
}

async function Room({ params }: { params: PageProps<"/t/[code]">["params"] }) {
  const { code } = await params;
  const normalized = code.toUpperCase();
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="flex-1">
        <header className="mx-auto flex w-full max-w-6xl items-center px-6 py-4"><Wordmark size={26} /></header>
        <section className="mx-auto max-w-md px-6 py-12">
          <h1 className="display" style={{ fontSize: 48 }}>Pull up a chair.</h1>
          <p className="mt-3 text-chalk-faint">You have been invited to table <span className="code text-chalk" style={{ fontSize: 22, letterSpacing: ".14em" }}>{normalized}</span>.</p>
          <div className="mt-6"><GuestStart mode="join" code={normalized} /></div>
        </section>
      </main>
    );
  }
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return <TableRoom code={normalized} me={{ id: user.id, handle: profile?.handle ?? "you", display_name: profile?.display_name ?? "You", avatar_seed: profile?.avatar_seed ?? "" }} guest={!!user.is_anonymous} />;
}
