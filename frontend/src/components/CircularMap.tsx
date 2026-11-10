import { useMemo } from "react";
import type { CutSite, Feature, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";
import { TYPE_COLORS, featureCoords, featureSpans } from "../lib/types";
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
// The first feature ring sits centred on the backbone; overlapping features
// stack onto further rings inward.
const RING_W = 14;
const RING_GAP = 3;
const R_OUTER = R_BACKBONE + RING_W / 2; // outer edge of the feature band
// Ticks, cut sites and the selection band sit just outside the feature band.
const R_MARK = R_OUTER + 3;
// Overlay tracks sit inside whatever feature rings are in use (computed
// per-render): primers first, then ORFs, with a floor so they stay on-canvas.
const THIN_W = 7;
const R_ORF_MIN = 30;
// Feature labels sit on an outer ring, clear of tick and cut-site labels.
const R_LABEL = R_BACKBONE + 66;
const LABEL_GAP = 15; // min vertical spacing between labels on one side
const LABEL_MAX = 24; // characters before a label is truncated
const MAX_LABELS = 64; // above this many features, only the active one is labelled

// Outer radius of feature ring `ring` (0 = centred on the backbone).
function ringOuter(ring: number): number {
  return R_OUTER - ring * (RING_W + RING_GAP);
}

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
    maxRing >= 0 ? ringOuter(maxRing) - RING_W : R_BACKBONE - 4;
  const rPrimer = featuresInner - 5 - THIN_W / 2;
  const rOrfTop = Math.max(
    R_ORF_MIN,
    (primers.length ? rPrimer - THIN_W : featuresInner - 5) - 5 - THIN_W / 2,
  );
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
  // Feature and cut-site labels share one layout, so neither can overlap the other.
  const labels = useMemo(
    () =>
      layoutLabels([
        ...labelled.map((f) => ({
          key: f.id,
          feature: f,
          text: truncate(f.name, LABEL_MAX),
          angle: baseToAngle(midBase(f, length), length),
          anchorR: R_MARK,
        })),
        ...cutSites.map((c, i) => ({
          key: `cut-${i}`,
          text: c.enzyme,
          angle: baseToAngle(c.position, length),
          anchorR: R_MARK + 11,
        })),
      ]),
    [labelled, cutSites, length],
  );

  return (
    <svg
      className="map-svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ maxHeight: "62vh", userSelect: "none" }}
      role="img"
      aria-label={`Circular map of ${record.name}`}
    >
      {/* backbone */}
      <circle
        className="backbone"
        cx={CX}
        cy={CY}
        r={R_BACKBONE}
        fill="none"
        strokeWidth={1.5}
        // A linear record still uses the ring as its coordinate axis; dashes
        // mark that its ends don't join.
        strokeDasharray={record.isCircular ? undefined : "4 4"}
      />

      {/* position ticks */}
      {tickBases.map((b) => {
        const t = tick(CX, CY, R_MARK, R_MARK + 5, b, length);
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
            R_MARK - 1,
            R_MARK + 4,
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

      {/* primers (overlay, just inside the feature rings) */}
      {primers.map((p) => (
        <path
          key={`primer-${p.id}`}
          d={directedArcPath(
            CX,
            CY,
            rPrimer - THIN_W / 2,
            rPrimer + THIN_W / 2,
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
        const rOuter = ringOuter(ring);
        const rInner = rOuter - RING_W;
        const color = f.color || TYPE_COLORS[f.type] || "#8E949C";
        const isActive = hoveredId === f.id || selection?.featureId === f.id;
        const spans = featureSpans(f);
        // Only the 3' piece (last walking forward on +, first on −) gets the
        // arrowhead; gaps between pieces (introns) are a thin connecting line.
        const tip = f.strand === -1 ? 0 : spans.length - 1;
        const rMid = (rInner + rOuter) / 2;
        return (
          <g
            key={f.id}
            opacity={hoveredId && !isActive ? 0.6 : 1}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectFeature(f)}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
          >
            {spans.slice(1).map(([gapEnd], i) => (
              <path
                key={`gap-${i}`}
                className="feature-gap"
                d={arcPath(CX, CY, rMid - 1.25, rMid + 1.25, spans[i][1], gapEnd, length)}
                fill={color}
              />
            ))}
            {spans.map(([s, e], i) => (
              <path
                key={i}
                d={
                  i === tip
                    ? directedArcPath(CX, CY, rInner, rOuter, s, e, length, f.strand)
                    : arcPath(CX, CY, rInner, rOuter, s, e, length)
                }
                className={isActive ? "feature active" : "feature"}
                fill={color}
                strokeWidth={1}
              />
            ))}
            <title>
              {f.name} ({labelCoords(f, length)} bp, {f.strand === 1 ? "+" : "−"})
            </title>
          </g>
        );
      })}

      {/* restriction cut sites */}
      {cutSites.map((c, i) => {
        const t = tick(CX, CY, R_MARK, R_MARK + 11, c.position, length);
        return (
          <line
            key={`cut-${c.enzyme}-${i}`}
            className="cut"
            x1={t.from.x}
            y1={t.from.y}
            x2={t.to.x}
            y2={t.to.y}
            strokeWidth={1.5}
          />
        );
      })}

      {/* feature and cut-site labels, with leader lines (outside the backbone) */}
      {labels.map((l) => {
        const f = l.feature;
        const active = !!f && (hoveredId === f.id || selection?.featureId === f.id);
        const elbowX = l.x + (l.side === "right" ? -6 : 6);
        const leader = (
          <polyline
            className={f ? (active ? "leader active" : "leader") : "cut"}
            points={`${l.anchor.x},${l.anchor.y} ${l.elbow.x},${l.elbow.y} ${elbowX},${l.y}`}
            fill="none"
            strokeWidth={0.75}
            opacity={f ? 1 : 0.55}
          />
        );
        const text = (
          <text
            className={
              f ? (active ? "label label-halo active" : "label label-halo") : "cut-label label-halo"
            }
            x={l.x}
            y={l.y}
            fontSize={f ? 11 : 10}
            textAnchor={l.side === "right" ? "start" : "end"}
            dominantBaseline="middle"
          >
            {l.text}
          </text>
        );
        if (!f) {
          return (
            <g key={l.key}>
              {leader}
              {text}
            </g>
          );
        }
        return (
          <g
            key={l.key}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectFeature(f)}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
          >
            {leader}
            {text}
          </g>
        );
      })}

      {/* center label */}
      <text className="center-name" x={CX} y={CY - 4} fontSize={14} textAnchor="middle">
        {truncate(record.name, 30)}
      </text>
      <text className="center-sub" x={CX} y={CY + 15} fontSize={11.5} textAnchor="middle">
        {length.toLocaleString()} bp
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

interface LabelItem {
  key: string;
  text: string;
  angle: number; // where the leader starts on the ring
  anchorR: number; // radius the leader starts from
  feature?: Feature; // absent for a cut-site label
}

interface PlacedLabel extends LabelItem {
  side: "left" | "right";
  x: number;
  y: number;
  anchor: { x: number; y: number }; // leader start, on the ring
  elbow: { x: number; y: number }; // where the leader bends toward the label
}

// Place every label on an outer ring. Labels are split by side of the map,
// sorted top-to-bottom, and pushed apart so none overlap; each keeps a leader
// line back to its anchor on the ring.
function layoutLabels(labelItems: LabelItem[]): PlacedLabel[] {
  const items = labelItems.map((item) => {
    const natural = polar(CX, CY, R_LABEL, item.angle);
    return {
      item,
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
      const anchor = polar(CX, CY, g.item.anchorR, g.item.angle);
      const bend = polar(CX, CY, R_BACKBONE + 44, g.item.angle);
      // keep the elbow between the anchor and the label horizontally
      const elbowX = side === "right" ? Math.min(bend.x, x - 8) : Math.max(bend.x, x + 8);
      out.push({
        ...g.item,
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
  const bases = featureSpans(f).reduce(
    (sum, [s, e]) => sum + (e >= s ? e - s : length - s + e),
    0,
  );
  return `${featureCoords(f)}, ${bases}`;
}
