import { useMemo } from "react";
import type { CutSite, Feature, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";
import { TYPE_COLORS } from "../lib/types";
import {
  arcPath,
  baseToAngle,
  directedArcPath,
  polar,
  stackSpans,
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

// Wider than tall so feature labels have room on either side of the ring.
const W = 820;
const H = 600;
const CX = W / 2;
const CY = H / 2;
const R_BACKBONE = 190;
const RING_W = 22;
// Overlay tracks: primers hug the backbone just inside it; ORFs sit on two
// thin rings (one per strand) placed inside whatever feature rings are in use
// (computed per-render), with a floor so they stay on-canvas.
const R_PRIMER = R_BACKBONE - 1;
const THIN_W = 7;
const R_ORF_MIN = 30;
// Feature labels sit on an outer ring, clear of tick and cut-site labels.
const R_LABEL = R_BACKBONE + 62;
const LABEL_GAP = 15; // min vertical spacing between labels on one side
const LABEL_MAX = 24; // characters before a label is truncated
const MAX_LABELS = 64; // above this many features, only the active one is labelled

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

  // Place the ORF rings inside the innermost feature ring actually allocated,
  // so a deeply-stacked feature can't render over (and steal clicks from) an
  // ORF track sitting at a fixed radius.
  const maxRing = record.features.length
    ? Math.max(...Array.from(ringOf.values()))
    : -1;
  const featuresInner =
    R_BACKBONE - 6 - maxRing * (RING_W + 4) - (maxRing >= 0 ? RING_W : 0);
  const rOrfTop = Math.max(R_ORF_MIN, featuresInner - 12);
  // Stack overlapping ORFs onto successive inner rings (segment-aware, so a
  // wrapping ORF can't cover another near the origin), with a floor so deep
  // stacks stay on-canvas.
  const orfLane = useMemo(
    () => stackSpans(orfs.map((o) => [o.start, o.end]), length),
    [orfs, length],
  );

  const tickBases = useMemo(() => {
    const step = niceStep(length);
    const out: number[] = [];
    for (let b = 0; b < length; b += step) out.push(b);
    return out;
  }, [length]);

  // Label every feature while they fit; on very dense records fall back to
  // labelling only the hovered / selected feature.
  const labelAll = record.features.length <= MAX_LABELS;
  const activeId = hoveredId ?? selection?.featureId ?? null;
  const labelled = useMemo(
    () => (labelAll ? record.features : record.features.filter((f) => f.id === activeId)),
    [labelAll, record.features, activeId],
  );
  const labels = useMemo(() => layoutLabels(labelled, length), [labelled, length]);

  return (
    <svg
      className="map-svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ maxHeight: "72vh", userSelect: "none" }}
      role="img"
      aria-label={`Circular map of ${record.name}`}
    >
      {/* plate + backbone */}
      <circle className="plate" cx={CX} cy={CY} r={R_BACKBONE - 2} />
      <circle
        className="backbone"
        cx={CX}
        cy={CY}
        r={R_BACKBONE}
        fill="none"
        strokeWidth={record.isCircular ? 3 : 0}
      />
      {!record.isCircular && (
        <path
          className="backbone"
          d={linearBackbone()}
          fill="none"
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
              className="tick"
              x1={t.from.x}
              y1={t.from.y}
              x2={t.to.x}
              y2={t.to.y}
              strokeWidth={1}
            />
            <text
              className="tick-label"
              x={t.labelPoint.x}
              y={t.labelPoint.y}
              fontSize={9}
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
          className="sel"
          opacity={0.8}
        />
      )}

      {/* ORFs (overlay, behind features) */}
      {orfs.map((o, i) => {
        const r = Math.max(R_ORF_MIN, rOrfTop - orfLane[i] * (THIN_W + 3));
        return (
          <path
            key={`orf-${i}`}
            d={directedArcPath(CX, CY, r - THIN_W / 2, r + THIN_W / 2, o.start, o.end, length, o.strand)}
            className="orf"
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
            className={isActive ? "feature active" : "feature"}
            fill={color}
            strokeWidth={isActive ? 2 : 1}
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

      {/* feature labels with leader lines (outside the backbone) */}
      {labels.map((l) => {
        const f = l.feature;
        const active = hoveredId === f.id || selection?.featureId === f.id;
        const color = f.color || TYPE_COLORS[f.type] || "#9E9E9E";
        const anchor = l.side === "right" ? "start" : "end";
        const elbowX = l.x + (l.side === "right" ? -6 : 6);
        return (
          <g
            key={`lbl-${f.id}`}
            style={{ cursor: "pointer" }}
            opacity={hoveredId && !active ? 0.5 : 1}
            onClick={() => onSelectFeature(f)}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
          >
            <polyline
              points={`${l.anchor.x},${l.anchor.y} ${l.elbow.x},${l.elbow.y} ${elbowX},${l.y}`}
              fill="none"
              stroke={color}
              strokeWidth={active ? 1.5 : 1}
              opacity={active ? 1 : 0.7}
            />
            <circle cx={l.anchor.x} cy={l.anchor.y} r={2} fill={color} />
            <text
              className="label label-halo"
              x={l.x}
              y={l.y}
              fontSize={11.5}
              fontWeight={active ? 700 : 500}
              textAnchor={anchor}
              dominantBaseline="middle"
            >
              {l.text}
            </text>
          </g>
        );
      })}

      {/* restriction cut sites */}
      {cutSites.map((c, i) => {
        const t = tick(CX, CY, R_BACKBONE + 6, R_BACKBONE + 16, c.position, length);
        return (
          <g key={`cut-${c.enzyme}-${i}`}>
            <line
              className="cut"
              x1={t.from.x}
              y1={t.from.y}
              x2={t.to.x}
              y2={t.to.y}
              strokeWidth={1.5}
            />
            <text
              className="cut-label"
              x={t.labelPoint.x}
              y={t.labelPoint.y}
              fontSize={9}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {c.enzyme}
            </text>
          </g>
        );
      })}

      {/* center label */}
      <text className="center-name" x={CX} y={CY - 6} fontSize={16} textAnchor="middle">
        {truncate(record.name, 28)}
      </text>
      <text className="center-sub" x={CX} y={CY + 15} fontSize={12.5} textAnchor="middle">
        {length.toLocaleString()} bp
      </text>
      <text className="center-faint" x={CX} y={CY + 32} fontSize={10.5} textAnchor="middle">
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

interface PlacedLabel {
  feature: Feature;
  text: string;
  side: "left" | "right";
  x: number;
  y: number;
  anchor: { x: number; y: number }; // on the backbone, at the feature's midpoint
  elbow: { x: number; y: number }; // where the leader bends toward the label
}

// Place one label per feature on an outer ring. Labels are split by side of
// the map, sorted top-to-bottom, and pushed apart so none overlap; each keeps
// a leader line back to its feature's midpoint.
function layoutLabels(features: Feature[], length: number): PlacedLabel[] {
  const items = features.map((f) => {
    const a = baseToAngle(midBase(f, length), length);
    const natural = polar(CX, CY, R_LABEL, a);
    return {
      feature: f,
      angle: a,
      side: (natural.x >= CX ? "right" : "left") as "left" | "right",
      y: natural.y,
    };
  });

  const out: PlacedLabel[] = [];
  const top = 14;
  const bottom = H - 14;
  for (const side of ["left", "right"] as const) {
    const group = items.filter((i) => i.side === side).sort((a, b) => a.y - b.y);
    // forward pass: push down to keep spacing
    for (let i = 1; i < group.length; i++) {
      group[i].y = Math.max(group[i].y, group[i - 1].y + LABEL_GAP);
    }
    // if the stack overflows the bottom, pull it back up
    const overflow = group.length ? group[group.length - 1].y - bottom : 0;
    if (overflow > 0) {
      for (let i = group.length - 1; i >= 0; i--) {
        const limit = i === group.length - 1 ? bottom : group[i + 1].y - LABEL_GAP;
        group[i].y = Math.min(group[i].y, limit);
      }
    }
    for (const g of group) {
      const y = Math.max(top, Math.min(bottom, g.y));
      const dy = y - CY;
      const reach = Math.sqrt(Math.max(0, R_LABEL * R_LABEL - dy * dy));
      const x = side === "right" ? CX + Math.max(reach, 24) : CX - Math.max(reach, 24);
      const anchor = polar(CX, CY, R_BACKBONE + 3, g.angle);
      const bend = polar(CX, CY, R_BACKBONE + 40, g.angle);
      // keep the elbow between the anchor and the label horizontally
      const elbowX = side === "right" ? Math.min(bend.x, x - 8) : Math.max(bend.x, x + 8);
      out.push({
        feature: g.feature,
        text: truncate(g.feature.name, LABEL_MAX),
        side,
        x,
        y,
        anchor,
        elbow: { x: elbowX, y: bend.y + (y - bend.y) * 0.35 },
      });
    }
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
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
