import Link from "next/link";
import type { SeatIndex } from "@/engine/types";
import type { TableChair, TableSummary } from "@/lib/tableStatus";

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? "";

/** "With Sam vs Lee and Jo", from where you sit. */
function company(chairs: TableChair[], mySeat: SeatIndex) {
  const at = (offset: number) => chairs[(mySeat + offset) % 4];
  const partner = at(2).name ? `With ${firstName(at(2).name)}` : "No partner yet";
  const them = [at(1), at(3)].map((c) => c.name && firstName(c.name)).filter(Boolean);
  return them.length ? `${partner} vs ${them.join(" and ")}` : partner;
}

/**
 * The table seen from above with you in the near chair, partner across, opponents either side.
 * The chair the table is waiting on is lit.
 */
export function MiniTable({ chairs, mySeat, size = 36 }: { chairs: TableChair[]; mySeat: SeatIndex; size?: number }) {
  const dot = Math.round(size * 0.46);
  const box = size + dot;
  // Chair centres on the felt's edges: bottom, left, top, right. The next seat sits on your left, as at the real table.
  const spots = [[box / 2, box - dot / 2], [dot / 2, box / 2], [box / 2, dot / 2], [box - dot / 2, box / 2]];
  return (
    <div aria-hidden className="relative shrink-0" style={{ width: box, height: box }}>
      <div className="absolute rounded-[5px]" style={{ inset: dot / 2, background: "var(--cloth-deep)", boxShadow: "inset 0 0 0 1.5px var(--cloth-edge)" }} />
      {chairs.map((c) => {
        const [x, y] = spots[(c.seat - mySeat + 4) % 4];
        const team = c.seat % 2 === 0 ? "var(--deck-red-soft)" : "var(--deck-blue-soft)";
        const look = c.up
          ? { background: "var(--brass)", color: "var(--ink)", boxShadow: "0 0 0 2px var(--cloth), 0 0 10px 1px rgba(214,166,74,.55)" }
          : c.name
            ? { background: c.me ? "var(--chalk)" : "var(--cloth)", color: c.me ? "var(--ink)" : "var(--chalk)", boxShadow: `inset 0 0 0 1.5px ${team}` }
            : { background: "var(--cloth)", color: "var(--chalk-faint)", boxShadow: "inset 0 0 0 1.5px var(--chalk-ghost)" };
        return (
          <span key={c.seat} className="absolute flex items-center justify-center rounded-full font-semibold"
            style={{ left: x, top: y, width: dot, height: dot, fontSize: dot * 0.55, transform: "translate(-50%, -50%)", ...look }}>
            {c.name ? firstName(c.name).charAt(0).toUpperCase() : ""}
          </span>
        );
      })}
    </div>
  );
}

export function TableList({ tables }: { tables: TableSummary[] }) {
  return (
    <ul className="flex flex-col divide-y divide-chalk-ghost">
      {tables.map((t) => (
        <li key={t.code}>
          <Link href={`/t/${t.code}`} className="group flex items-center gap-3.5 py-3 no-underline">
            <MiniTable chairs={t.chairs} mySeat={t.mySeat} />
            <div className="min-w-0 flex-1">
              <p className={`flex items-baseline gap-2 leading-snug ${t.yours ? "font-semibold text-brass" : "text-chalk"}`}>
                {t.fresh && <span className="inline-block h-2 w-2 shrink-0 -translate-y-px rounded-full bg-brass" title="New moves since your last visit" />}
                <span>{t.line}</span>
                {t.fresh && <span className="sr-only">(new moves since your last visit)</span>}
              </p>
              <p className="mt-0.5 truncate text-sm text-chalk-faint">{company(t.chairs, t.mySeat)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="code text-chalk group-hover:text-brass" style={{ fontSize: 15, letterSpacing: ".08em" }}>{t.code}</p>
              {t.score && (
                <p className="mt-1 text-sm tabular-nums text-chalk-faint">
                  <span className="sr-only">Score, you </span>{t.score.us}<span aria-hidden> to </span><span className="sr-only">, them </span>{t.score.them}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
