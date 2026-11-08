// Small decorative plasmid ring for library cards: a backbone with a few
// colored arcs whose layout is seeded from the record id, so each card looks
// distinct but stable between renders.
const COLORS = ["#3b82f6", "#22c55e", "#f97316", "#ef4444", "#06b6d4", "#a855f7"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function PlasmidGlyph({ seed, circular, size = 30 }: { seed: string; circular: boolean; size?: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  let h = hash(seed);
  const arcs: { len: number; off: number; color: string }[] = [];
  let pos = (h % 100) / 100;
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    const len = 0.1 + ((h % 1000) / 1000) * 0.22;
    arcs.push({ len, off: pos, color: COLORS[(h >>> 8) % COLORS.length] });
    pos += len + 0.06;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <circle
        cx={15}
        cy={15}
        r={r}
        fill="none"
        style={{ stroke: "var(--line-strong)" }}
        strokeWidth={1.5}
        strokeDasharray={circular ? undefined : "2 2.5"}
      />
      {arcs.map((a, i) => (
        <circle
          key={i}
          cx={15}
          cy={15}
          r={r}
          fill="none"
          stroke={a.color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${a.len * c} ${c}`}
          strokeDashoffset={-a.off * c}
          transform="rotate(-90 15 15)"
        />
      ))}
    </svg>
  );
}
