import { useMemo } from "react";
import type { CutSite, Feature, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";
import { TYPE_COLORS } from "../lib/types";

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

const H = 150;
const PAD = 40;
const TRACK_Y = 60;
const TRACK_H = 16;
const THIN_H = 9; // overlay (primer / ORF) track height

// Greedy lane packing for arbitrary [start,end] spans (wrap clipped to end).
function stackSpans(spans: [number, number][], length: number): number[] {
  const laneEnds: number[] = [];
  return spans.map(([start, rawEnd]) => {
    const end = rawEnd >= start ? rawEnd : length;
    let lane = laneEnds.findIndex((e) => start >= e);
    if (lane === -1) {
      laneEnds.push(end);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = end;
    }
    return lane;
  });
}

// Stack overlapping features into lanes.
function assignLanes(features: Feature[], length: number): Map<string, number> {
  const lanes: number[] = []; // last end per lane
  const out = new Map<string, number>();
  const sorted = [...features].sort((a, b) => a.start - b.start);
  for (const f of sorted) {
    const start = f.start;
    const end = f.end >= f.start ? f.end : length; // clip wrap for lane packing
    let lane = lanes.findIndex((e) => start >= e);
    if (lane === -1) {
      lanes.push(end);
      lane = lanes.length - 1;
    } else {
      lanes[lane] = end;
    }
    out.set(f.id, lane);
  }
  return out;
}

export function LinearMap({
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
  const width = 900;
  const usable = width - PAD * 2;
  const x = (base: number) => PAD + (base / length) * usable;
  const laneOf = useMemo(() => assignLanes(record.features, length), [record.features, length]);
  const laneCount = Math.max(1, ...Array.from(laneOf.values()).map((l) => l + 1));

  // Overlay bands sit below the feature lanes.
  const featuresBottom = TRACK_Y + 20 + laneCount * (TRACK_H + 6);
  const primerLanes = useMemo(
    () => stackSpans(primers.map((p) => [p.bindStart, p.bindEnd]), length),
    [primers, length],
  );
  const orfLanes = useMemo(
    () => stackSpans(orfs.map((o) => [o.start, o.end]), length),
    [orfs, length],
  );
  const primerRows = primers.length ? Math.max(0, ...primerLanes) + 1 : 0;
  const orfRows = orfs.length ? Math.max(0, ...orfLanes) + 1 : 0;
  const primerBandY = featuresBottom + (primerRows ? 10 : 0);
  const orfBandY = primerBandY + primerRows * (THIN_H + 3) + (orfRows ? 10 : 0);
  const totalH = orfBandY + orfRows * (THIN_H + 3) + 20;

  const ticks = useMemo(() => {
    const step = niceStep(length);
    const out: number[] = [];
    for (let b = 0; b <= length; b += step) out.push(b);
    return out;
  }, [length]);

  return (
    <svg
      viewBox={`0 0 ${width} ${Math.max(H, totalH)}`}
      width="100%"
      style={{ userSelect: "none" }}
      role="img"
      aria-label={`Linear map of ${record.name}`}
    >
      {/* axis */}
      <line x1={PAD} y1={TRACK_Y} x2={width - PAD} y2={TRACK_Y} stroke="#607d8b" strokeWidth={2} />
      {!record.isCircular && (
        <>
          <line x1={PAD} y1={TRACK_Y - 6} x2={PAD} y2={TRACK_Y + 6} stroke="#607d8b" strokeWidth={2} />
          <line
            x1={width - PAD}
            y1={TRACK_Y - 6}
            x2={width - PAD}
            y2={TRACK_Y + 6}
            stroke="#607d8b"
            strokeWidth={2}
          />
        </>
      )}

      {ticks.map((b) => (
        <g key={`t-${b}`}>
          <line x1={x(b)} y1={TRACK_Y} x2={x(b)} y2={TRACK_Y - 5} stroke="#90a4ae" />
          <text x={x(b)} y={TRACK_Y - 9} fontSize={9} fill="#607d8b" textAnchor="middle">
            {b}
          </text>
        </g>
      ))}

      {/* selection */}
      {selection && selection.end !== selection.start && (
        <rect
          x={x(Math.min(selection.start, selection.end))}
          y={TRACK_Y - 3}
          width={Math.max(2, Math.abs(x(selection.end) - x(selection.start)))}
          height={6}
          fill="#ffca28"
          opacity={0.8}
        />
      )}

      {/* cut sites */}
      {cutSites.map((c, i) => (
        <g key={`c-${i}`}>
          <line
            x1={x(c.position)}
            y1={TRACK_Y - 14}
            x2={x(c.position)}
            y2={TRACK_Y + 4}
            stroke="#d32f2f"
            strokeWidth={1.2}
          />
          <text
            x={x(c.position)}
            y={TRACK_Y - 16}
            fontSize={8}
            fill="#d32f2f"
            textAnchor="middle"
          >
            {c.enzyme}
          </text>
        </g>
      ))}

      {/* features as lanes below the axis */}
      {record.features.map((f) => {
        const lane = laneOf.get(f.id) ?? 0;
        const y = TRACK_Y + 20 + lane * (TRACK_H + 6);
        const color = f.color || TYPE_COLORS[f.type] || "#9E9E9E";
        const active = hoveredId === f.id || selection?.featureId === f.id;
        const wraps = f.end < f.start;
        const segments = wraps
          ? [
              [f.start, length],
              [0, f.end],
            ]
          : [[f.start, f.end]];
        return (
          <g
            key={f.id}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectFeature(f)}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
            opacity={hoveredId && !active ? 0.55 : 1}
          >
            {segments.map(([s, e], si) => (
              <path
                key={si}
                d={arrowRect(x(s), x(e), y, TRACK_H, f.strand)}
                fill={color}
                stroke={active ? "#212121" : "white"}
                strokeWidth={active ? 1.5 : 0.5}
              />
            ))}
            <text
              x={x(segments[0][0]) + 4}
              y={y + TRACK_H / 2}
              fontSize={10}
              fill="#fff"
              fontWeight={600}
              dominantBaseline="middle"
              style={{ pointerEvents: "none" }}
            >
              {f.name}
            </text>
            <title>
              {f.name} ({f.start}–{f.end}, {f.strand === 1 ? "+" : "−"})
            </title>
          </g>
        );
      })}

      {/* primer overlay band */}
      {primers.length > 0 && (
        <text x={PAD} y={primerBandY - 2} fontSize={9} fill="#9C27B0">
          primers
        </text>
      )}
      {primers.map((p, i) => {
        const y = primerBandY + primerLanes[i] * (THIN_H + 3);
        const wraps = p.bindEnd < p.bindStart;
        const segs: [number, number][] = wraps
          ? [[p.bindStart, length], [0, p.bindEnd]]
          : [[p.bindStart, p.bindEnd]];
        return (
          <g
            key={`primer-${p.id}`}
            style={{ cursor: onSelectRange ? "pointer" : "default" }}
            onClick={() => onSelectRange?.({ start: p.bindStart, end: p.bindEnd })}
          >
            {segs.map(([s, e], si) => (
              <path
                key={si}
                d={arrowRect(x(s), x(e), y, THIN_H, p.strand)}
                fill={TYPE_COLORS.primer}
                stroke="white"
                strokeWidth={0.4}
              />
            ))}
            <title>
              {p.name} · Tm {p.tm}°C · {p.strand === 1 ? "+" : "−"}
            </title>
          </g>
        );
      })}

      {/* ORF overlay band */}
      {orfs.length > 0 && (
        <text x={PAD} y={orfBandY - 2} fontSize={9} fill="#607d8b">
          ORFs
        </text>
      )}
      {orfs.map((o, i) => {
        const y = orfBandY + orfLanes[i] * (THIN_H + 3);
        const wraps = o.end < o.start;
        const segs: [number, number][] = wraps
          ? [[o.start, length], [0, o.end]]
          : [[o.start, o.end]];
        return (
          <g
            key={`orf-${i}`}
            style={{ cursor: onSelectRange ? "pointer" : "default" }}
            onClick={() => onSelectRange?.({ start: o.start, end: o.end })}
          >
            {segs.map(([s, e], si) => (
              <path
                key={si}
                d={arrowRect(x(s), x(e), y, THIN_H, o.strand)}
                fill="#78909c"
                opacity={0.6}
              />
            ))}
            <title>
              ORF {o.start}–{o.end} ({o.strand === 1 ? "+" : "−"}) · {o.protein.length} aa
            </title>
          </g>
        );
      })}
    </svg>
  );
}

// A rectangle with an arrowhead on the appropriate end.
function arrowRect(x0: number, x1: number, y: number, h: number, strand: number): string {
  const w = Math.max(2, x1 - x0);
  const head = Math.min(8, w);
  if (strand >= 0) {
    return `M ${x0} ${y} L ${x0 + w - head} ${y} L ${x0 + w} ${y + h / 2} L ${
      x0 + w - head
    } ${y + h} L ${x0} ${y + h} Z`;
  }
  return `M ${x0 + w} ${y} L ${x0 + head} ${y} L ${x0} ${y + h / 2} L ${x0 + head} ${
    y + h
  } L ${x0 + w} ${y + h} Z`;
}

function niceStep(length: number): number {
  const target = length / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(target || 1)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= target) return m * pow;
  }
  return 10 * pow;
}
