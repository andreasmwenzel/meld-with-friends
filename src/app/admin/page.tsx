import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/site/Wordmark";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { Arena } from "@/components/admin/Arena";
import { Tables } from "@/components/admin/Tables";
import { Bans } from "@/components/admin/Bans";
import { Usage } from "@/components/admin/Usage";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/server/admin";
import { getSettings, getUsageStats } from "@/server/settings";

export default function AdminPage() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:py-6">
        <Wordmark size={30} />
        <span className="text-sm text-chalk-faint">Admin</span>
      </header>
      <Suspense fallback={<p className="px-6 text-chalk-faint">Loading settings.</p>}>
        <AdminBody />
      </Suspense>
    </main>
  );
}

async function AdminBody() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) notFound();
  const [settings, stats] = await Promise.all([getSettings(), getUsageStats()]);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6 pb-20">
      <Usage stats={stats} />
      <Tables />
      <SettingsPanel initial={settings} />
      <Arena />
      <Bans />
    </div>
  );
}
