import { Suspense } from "react";
import { FrontDoor, Returning, Welcome } from "@/components/site/FrontDoor";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyTables } from "@/server/myTables";
import type { TableSummary } from "@/lib/tableStatus";
import type { RulesPatch } from "@/components/rules/rules";

/**
 * The front door, one screen tall on a phone. New players get a name field and a code box;
 * anyone with a session sees their tables first, with whose move it is, then deal and join.
 */
export default function Landing() {
  return (
    <FrontDoor>
      <Suspense fallback={<div className="flex-1" />}>
        <Front />
      </Suspense>
    </FrontDoor>
  );
}

async function Front() {
  const user = await getSessionUser();
  if (!user) return <Welcome />;
  const supabase = await createClient();
  const [{ data: profile }, tables] = await Promise.all([
    supabase.from("profiles").select("display_name, default_rules").eq("id", user.id).maybeSingle(),
    listMyTables(user.id).catch((error: unknown) => { console.error("listMyTables", error); return [] as TableSummary[]; }),
  ]);
  return (
    <Returning
      name={profile?.display_name?.split(" ")[0] ?? null}
      guest={!!user.is_anonymous}
      tables={tables}
      defaults={(profile?.default_rules as RulesPatch | null) ?? null}
    />
  );
}
