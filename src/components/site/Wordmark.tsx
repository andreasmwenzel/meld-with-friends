import Link from "next/link";

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Link href="/" className="inline-flex items-baseline gap-2 text-chalk no-underline">
      <span className="display" style={{ fontSize: size, lineHeight: 1 }}>Meld</span>
      <span aria-hidden className="inline-flex gap-0.5" style={{ fontSize: size * 0.55, transform: "translateY(-1px)" }}>
        <span className="text-chalk">♠</span><span className="text-deck-red-soft">♦</span>
      </span>
    </Link>
  );
}
