import type { ReactNode } from "react";

export interface UsageStats {
  tablesToday: number; actionsToday: number; ticksToday: number; openTables: number; playingTables: number;
  profiles: number; guests: number; gamesStored: number; actionsStored: number;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div><dt className="text-chalk-faint text-sm">{label}</dt><dd className="display text-chalk" style={{ fontSize: 28 }}>{children}</dd></div>
  );
}

/** Today's activity and what is sitting in the database, for keeping an eye on free-tier quotas. */
export function Usage({ stats }: { stats: UsageStats }) {
  return (
    <section>
      <h2 className="display" style={{ fontSize: 30 }}>Usage</h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Tables dealt today">{stats.tablesToday}</Stat>
        <Stat label="Game actions today">{stats.actionsToday}</Stat>
        <Stat label="Bot moves today">{stats.ticksToday}</Stat>
        <Stat label="Open / playing">{stats.openTables} / {stats.playingTables}</Stat>
        <Stat label="Players / guests">{stats.profiles} / {stats.guests}</Stat>
        <Stat label="Games stored">{stats.gamesStored}</Stat>
        <Stat label="Action log rows">{stats.actionsStored}</Stat>
      </dl>
    </section>
  );
}
