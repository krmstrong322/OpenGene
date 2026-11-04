import { useMemo } from "react";
import type { CutSite, Feature, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";
import { TYPE_COLORS } from "../lib/types";
import {
  arcPath,
  baseToAngle,
  directedArcPath,
  polar,
  tick,
} from "../lib/geometry";

interface Props {
  record: PlasmidRecord;
  cutSites: CutSite[];
  selection: Selection | null;
  onSelectFeature: (f: Feature) => void;
  onHover: (featureId: string | null) => void;
  hoveredId: string | null;
  primers?: Primer[];
  orfs?: ORF[];
  onSelectRange?: (sel: Selection) => void;
}

const SIZE = 560;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_BACKBONE = 190;
const RING_W = 22;
// Overlay tracks: ORFs sit on two thin rings (one per strand) inside the
// feature band; primers hug the backbone just inside it.
const R_PRIMER = R_BACKBONE - 1;
const R_ORF_FWD = 86;
const R_ORF_REV = 72;
const THIN_W = 7;

// Assign features to stacked rings so overlapping features don't collide.
function assignRings(features: Feature[], length: number): Map<string, number> {
  const rings: { end: number }[][] = [];
  const out = new Map<string, number>();
  const sorted = [...features].sort((a, b) => a.start - b.start);
  for (const f of sorted) {
    const span = f.end >= f.start ? [f.start, f.end] : [f.start, f.end + length];
    let placed = false;
    for (let r = 0; r < rings.length; r++) {
      // Greedy interval partition (features are start-sorted): a feature fits
      // on a ring if it starts at or after everything already placed there.
      const conflict = rings[r].some((s) => span[0] < s.end);
      if (!conflict) {
        rings[r].push({ end: span[1] });
        out.set(f.id, r);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rings.push([{ end: span[1] }]);
      out.set(f.id, rings.length - 1);
    }
  }
  return out;
}

export function CircularMap({
  record,
  cutSites,
  selection,
  onSelectFeature,
  onHover,
  hoveredId,
  primers = [],
  orfs = [],
  onSelectRange,
}: Props) {
  const length = record.length || 1;
  const ringOf = useMemo(
    () => assignRings(record.features, length),
    [record.features, length],
  );

  const tickBases = useMemo(() => {
    const step = niceStep(length);
    const out: number[] = [];
    for (let b = 0; b < length; b += step) out.push(b);
    return out;
  }, [length]);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width="100%"
      style={{ maxHeight: "72vh", userSelect: "none" }}
      role="img"
      aria-label={`Circular map of ${record.name}`}
    >
      {/* backbone */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BACKBONE}
        fill="none"
        stroke="#cfd8dc"
        strokeWidth={record.isCircular ? 3 : 0}
      />
      {!record.isCircular && (
        <path
          d={linearBackbone()}
          fill="none"
          stroke="#cfd8dc"
          strokeWidth={3}
          strokeDasharray="4 4"
        />
      )}

      {/* position ticks */}
      {tickBases.map((b) => {
        const t = tick(CX, CY, R_BACKBONE, R_BACKBONE + 6, b, length);
        return (
          <g key={`tick-${b}`}>
            <line
              x1={t.from.x}
              y1={t.from.y}
              x2={t.to.x}
              y2={t.to.y}
              stroke="#90a4ae"
              strokeWidth={1}
            />
            <text
              x={t.labelPoint.x}
              y={t.labelPoint.y}
              fontSize={9}
              fill="#607d8b"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {b}
            </text>
          </g>
        );
      })}

      {/* selection highlight */}
      {selection && selection.end !== selection.start && (
        <path
          d={arcPath(
            CX,
            CY,
            R_BACKBONE - 4,
            R_BACKBONE + 4,
            selection.start,
            selection.end,
            length,
          )}
          fill="#ffca28"
          opacity={0.7}
        />
      )}

      {/* ORFs (overlay, behind features) */}
      {orfs.map((o, i) => {
        const r = o.strand >= 0 ? R_ORF_FWD : R_ORF_REV;
        return (
          <path
            key={`orf-${i}`}
            d={directedArcPath(CX, CY, r - THIN_W / 2, r + THIN_W / 2, o.start, o.end, length, o.strand)}
            fill="#78909c"
            opacity={0.5}
            style={{ cursor: onSelectRange ? "pointer" : "default" }}
            onClick={() => onSelectRange?.({ start: o.start, end: o.end })}
          >
            <title>
              ORF {o.start}–{o.end} ({o.strand === 1 ? "+" : "−"}) · {o.protein.length} aa
            </title>
          </path>
        );
      })}

      {/* primers (overlay, just inside the backbone) */}
      {primers.map((p) => (
        <path
          key={`primer-${p.id}`}
          d={directedArcPath(
            CX,
            CY,
            R_PRIMER - THIN_W / 2,
            R_PRIMER + THIN_W / 2,
            p.bindStart,
            p.bindEnd,
            length,
            p.strand,
          )}
          fill={TYPE_COLORS.primer}
          opacity={0.95}
          style={{ cursor: onSelectRange ? "pointer" : "default" }}
          onClick={() => onSelectRange?.({ start: p.bindStart, end: p.bindEnd })}
        >
          <title>
            {p.name} · Tm {p.tm}°C · {p.strand === 1 ? "+" : "−"}
          </title>
        </path>
      ))}

      {/* features */}
      {record.features.map((f) => {
        const ring = ringOf.get(f.id) ?? 0;
        const rOuter = R_BACKBONE - 6 - ring * (RING_W + 4);
        const rInner = rOuter - RING_W;
        const color = f.color || TYPE_COLORS[f.type] || "#9E9E9E";
        const isActive = hoveredId === f.id || selection?.featureId === f.id;
        return (
          <path
            key={f.id}
            d={directedArcPath(CX, CY, rInner, rOuter, f.start, f.end, length, f.strand)}
            fill={color}
            stroke={isActive ? "#212121" : "white"}
            strokeWidth={isActive ? 2 : 0.75}
            opacity={hoveredId && !isActive ? 0.55 : 0.92}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectFeature(f)}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
          >
            <title>
              {f.name} ({labelCoords(f, length)} bp, {f.strand === 1 ? "+" : "−"})
            </title>
          </path>
        );
      })}

      {/* feature labels (outside the backbone) */}
      {record.features.map((f) => {
        const mid = midBase(f, length);
        const a = baseToAngle(mid, length);
        const p = polar(CX, CY, R_BACKBONE + 24, a);
        const anchor = p.x < CX - 10 ? "end" : p.x > CX + 10 ? "start" : "middle";
        const active = hoveredId === f.id || selection?.featureId === f.id;
        if (!active) return null;
        return (
          <text
            key={`lbl-${f.id}`}
            x={p.x}
            y={p.y}
            fontSize={11}
            fontWeight={600}
            fill="#263238"
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {f.name}
          </text>
        );
      })}

      {/* restriction cut sites */}
      {cutSites.map((c, i) => {
        const t = tick(CX, CY, R_BACKBONE + 6, R_BACKBONE + 16, c.position, length);
        return (
          <g key={`cut-${c.enzyme}-${i}`}>
            <line
              x1={t.from.x}
              y1={t.from.y}
              x2={t.to.x}
              y2={t.to.y}
              stroke="#d32f2f"
              strokeWidth={1.5}
            />
            <text
              x={t.labelPoint.x}
              y={t.labelPoint.y}
              fontSize={9}
              fill="#d32f2f"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {c.enzyme}
            </text>
          </g>
        );
      })}

      {/* center label */}
      <text x={CX} y={CY - 8} fontSize={15} fontWeight={700} fill="#263238" textAnchor="middle">
        {record.name}
      </text>
      <text x={CX} y={CY + 12} fontSize={12} fill="#607d8b" textAnchor="middle">
        {length.toLocaleString()} bp
      </text>
      <text x={CX} y={CY + 28} fontSize={10} fill="#90a4ae" textAnchor="middle">
        {record.isCircular ? "circular" : "linear"}
      </text>
    </svg>
  );
}

function niceStep(length: number): number {
  const target = length / 12;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= target) return m * pow;
  }
  return 10 * pow;
}

function midBase(f: Feature, length: number): number {
  if (f.end >= f.start) return (f.start + f.end) / 2;
  return ((f.start + f.end + length) / 2) % length;
}

function labelCoords(f: Feature, length: number): string {
  const span = f.end >= f.start ? f.end - f.start : length - f.start + f.end;
  return `${f.start}–${f.end}, ${span}`;
}

function linearBackbone(): string {
  // A faint reference ring for linear constructs.
  return `M ${CX - R_BACKBONE} ${CY} A ${R_BACKBONE} ${R_BACKBONE} 0 1 1 ${
    CX - R_BACKBONE
  } ${CY - 0.01}`;
}
