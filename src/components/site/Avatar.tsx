/** A chalk chip with the player's initial. The hue comes from the avatar seed so each friend is recognisable. */
export function Avatar({ name, seed, size = 40, team, bot = false }: { name: string; seed?: string; size?: number; team?: "red" | "blue" | null; bot?: boolean }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const bg = team === "red" ? "var(--deck-red)" : team === "blue" ? "var(--deck-blue)" : "var(--chalk-dim)";
  const fg = team ? "var(--chalk)" : "var(--ink)";
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.45, boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,.08)" }}
      data-seed={seed}
    >
      {bot ? <span style={{ fontSize: size * 0.5, lineHeight: 1 }} title="Computer player">⌁</span> : initial}
    </span>
  );
}
