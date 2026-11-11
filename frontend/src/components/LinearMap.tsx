import { useMemo } from "react";
import type { CutSite, Feature, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";
import { METHYL_LABELS, TYPE_COLORS, featureCoords, featureSpans } from "../lib/types";
import { boundaryLabel, rangeLabel, tickLabel } from "../lib/coords";
import { useSize } from "../lib/useSize";
import { selectionSegments } from "../lib/selection";
import { spanSegments, stackSpans } from "../lib/geometry";

interface Props {
  record: PlasmidRecord;
  cutSites: CutSite[];
  selection: Selection | null;
  onSelectFeature: (f: Feature) => void;
  /** Open the right-click menu for a feature. */
  onFeatureMenu?: (x: number, y: number, f: Feature) => void;
  onHover: (featureId: string | null) => void;
  hoveredId: string | null;
  primers?: Primer[];
  orfs?: ORF[];
  onSelectRange?: (sel: Selection) => void;
}

const H = 150;
const PAD = 40;
const TRACK_Y = 60;
const TRACK_H = 14;
const THIN_H = 9; // overlay (primer / ORF) track height

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

function cutTitle(c: CutSite, length: number, circular: boolean): string {
  const ends =
    c.overhang_type === "blunt" ? "blunt ends" : `${c.overhang_type} overhang ${c.overhang}`;
  const meth = c.methylation.length
    ? ` · overlaps ${c.methylation.map((m) => METHYL_LABELS[m]).join(", ")}`
    : "";
  return `${c.enzyme} · cuts ${boundaryLabel(c.position, length, circular)} · ${ends}${meth}`;
}

export function LinearMap({
  record,
  cutSites,
  selection,
  onSelectFeature,
  onFeatureMenu,
  onHover,
  hoveredId,
  primers = [],
  orfs = [],
  onSelectRange,
}: Props) {
  const length = record.length || 1;
  // Draw at the pane's own width (1 unit = 1 px) so text stays the same size
  // however the workspace is divided; 900 until the first measurement.
  const [svgRef, size] = useSize<SVGSVGElement>();
  const width = Math.max(420, Math.round(size?.width || 900));
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

  // Row (0 = lowest) for each cut-site label: the first row where it doesn't
  // overlap a label already placed (≈4.8px per character at 8px).
  const cutRows = useMemo(() => {
    const rows: [number, number][][] = []; // occupied [left, right] spans per row
    return cutSites.map((c) => {
      const cx = PAD + (c.position / length) * usable;
      const half = (c.enzyme.length * 4.8 + 4) / 2;
      let row = 0;
      while (row < 3 && (rows[row] ?? []).some(([a, b]) => cx + half > a && cx - half < b)) row++;
      rows[row] = rows[row] ?? [];
      rows[row].push([cx - half, cx + half]);
      return row;
    });
  }, [cutSites, length, usable]);

  const ticks = useMemo(() => {
    const step = niceStep(length);
    const out: number[] = [];
    for (let b = 0; b <= length; b += step) out.push(b);
    return out;
  }, [length]);

  return (
    <svg
      ref={svgRef}
      className="map-svg"
      viewBox={`0 0 ${width} ${Math.max(H, totalH)}`}
      width="100%"
      style={{ userSelect: "none" }}
      role="img"
      aria-label={`Linear map of ${record.name}`}
    >
      {/* axis */}
      <line className="backbone" x1={PAD} y1={TRACK_Y} x2={width - PAD} y2={TRACK_Y} strokeWidth={2} />
      {!record.isCircular && (
        <>
          <line className="tick" x1={PAD} y1={TRACK_Y - 6} x2={PAD} y2={TRACK_Y + 6} strokeWidth={2} />
          <line
            x1={width - PAD}
            y1={TRACK_Y - 6}
            x2={width - PAD}
            y2={TRACK_Y + 6}
            className="tick"
            strokeWidth={2}
          />
        </>
      )}

      {ticks.map((b) => (
        <g key={`t-${b}`}>
          <line className="tick" x1={x(b)} y1={TRACK_Y - 2} x2={x(b)} y2={TRACK_Y - 7} />
          <text className="tick-label" x={x(b)} y={TRACK_Y - 11} fontSize={9} textAnchor="middle">
            {tickLabel(b)}
          </text>
        </g>
      ))}

      {/* selection (one rect per segment, so a wrapping span shows both parts) */}
      {selectionSegments(selection, length).map(([lo, hi], i) => (
        <rect
          key={`sel-${i}`}
          x={x(lo)}
          y={TRACK_Y - 3}
          width={Math.max(2, x(hi) - x(lo))}
          height={6}
          className="sel"
          rx={2}
          opacity={0.9}
        />
      ))}

      {/* cut sites: stems first, then labels (stacked upward above the tick
          labels so none overlap), so no stem can run through a label */}
      {cutSites.map((c, i) => (
        <line
          key={`cs-${i}`}
          x1={x(c.position)}
          y1={TRACK_Y - 20 - cutRows[i] * 9}
          x2={x(c.position)}
          y2={TRACK_Y + 4}
          className={c.methylation.some((m) => m === "dam" || m === "dcm") ? "cut methyl" : "cut"}
          strokeWidth={1}
        >
          <title>{cutTitle(c, length, record.isCircular)}</title>
        </line>
      ))}
      {cutSites.map((c, i) => (
        <text
          key={`cl-${i}`}
          x={x(c.position)}
          y={TRACK_Y - 22 - cutRows[i] * 9}
          fontSize={8}
          className="cut-label label-halo"
          textAnchor="middle"
        >
          {c.enzyme}
        </text>
      ))}

      {/* features as lanes below the axis */}
      {record.features.map((f) => {
        const lane = laneOf.get(f.id) ?? 0;
        const y = TRACK_Y + 20 + lane * (TRACK_H + 6);
        const color = f.color || TYPE_COLORS[f.type] || "#8E949C";
        const active = hoveredId === f.id || selection?.featureId === f.id;
        // Each part of the feature, split at the origin when it wraps. Drop
        // an empty tail (a part ending exactly at the origin, e.g. 871–0), but
        // keep a zero-length feature's single segment.
        const parts = featureSpans(f).map(([s, e]) => {
          const all = spanSegments(s, e, length);
          const nonEmpty = all.filter(([a, b]) => b > a);
          return nonEmpty.length ? nonEmpty : all;
        });
        const segments = parts.flat();
        // The arrowhead goes on the 3' end only: the right-most drawn piece of
        // the last part on +, the left-most of the first part on −.
        const tipPart = f.strand === -1 ? parts[0] : parts[parts.length - 1];
        const tipSeg = f.strand === -1 ? tipPart[tipPart.length - 1] : tipPart[0];
        // Gaps between consecutive parts (introns), drawn as a thin line;
        // a gap across the origin is drawn in two pieces.
        const gaps = parts.slice(1).flatMap((p, i) => {
          const prev = parts[i];
          return spanSegments(prev[prev.length - 1][1], p[0][0], length).filter(([a, b]) => b > a);
        });
        return (
          <g
            key={f.id}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectFeature(f)}
            onContextMenu={(e) => {
              if (!onFeatureMenu) return;
              e.preventDefault();
              onFeatureMenu(e.clientX, e.clientY, f);
            }}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
            opacity={hoveredId && !active ? 0.6 : 1}
          >
            {gaps.map(([s, e], gi) => (
              <rect
                key={`gap-${gi}`}
                className="feature-gap"
                x={x(s)}
                y={y + TRACK_H / 2 - 0.75}
                width={Math.max(0, x(e) - x(s))}
                height={1.5}
                fill={color}
              />
            ))}
            {segments.map((seg, si) => (
              <path
                key={si}
                className={active ? "feature active" : "feature"}
                d={arrowRect(x(seg[0]), x(seg[1]), y, TRACK_H, f.strand, parts.length < 2 || seg === tipSeg)}
                fill={color}
                strokeWidth={0.75}
              />
            ))}
            {(() => {
              // Label inside the widest segment, truncated to what fits.
              const [s0, e0] = segments.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
              const room = x(e0) - x(s0) - 14;
              const text = fitLabel(f.name, room);
              if (!text) return null;
              const lx = f.strand >= 0 ? x(s0) + 5 : x(s0) + 11;
              return (
                <text
                  x={lx}
                  y={y + TRACK_H / 2 + 0.5}
                  fontSize={9.5}
                  fill="#fff"
                  fontWeight={500}
                  dominantBaseline="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {text}
                </text>
              );
            })()}
            <title>
              {f.name} ({featureCoords(f, length)}, {f.strand === 1 ? "+" : "−"})
            </title>
          </g>
        );
      })}

      {/* primer overlay band */}
      {primers.length > 0 && (
        <text className="band-label" x={PAD} y={primerBandY - 3} fontSize={9}>
          primers
        </text>
      )}
      {primers.map((p, i) => {
        const y = primerBandY + primerLanes[i] * (THIN_H + 3);
        const segs = spanSegments(p.bindStart, p.bindEnd, length);
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
                className="feature"
                fill={TYPE_COLORS.primer}
                strokeWidth={0.5}
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
        <text className="band-label" x={PAD} y={orfBandY - 3} fontSize={9}>
          ORFs
        </text>
      )}
      {orfs.map((o, i) => {
        const y = orfBandY + orfLanes[i] * (THIN_H + 3);
        const segs = spanSegments(o.start, o.end, length);
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
                className="orf"
                opacity={0.6}
              />
            ))}
            <title>
              ORF {rangeLabel(o.start, o.end, length)} ({o.strand === 1 ? "+" : "−"}) · {o.protein.length} aa
            </title>
          </g>
        );
      })}
    </svg>
  );
}

// A bar with an arrowhead on its 3' end. Like the circular map, the head has
// a fixed length tied to the bar height (so all tips share one shape), but
// never takes more than 60% of the bar; very short bars are widened about
// their middle to stay visible.
// A feature block, pointed at its 3' end unless `arrow` is false (inner parts
// of a multi-part feature are plain blocks).
function arrowRect(
  x0: number,
  x1: number,
  y: number,
  h: number,
  strand: number,
  arrow = true,
): string {
  let w = x1 - x0;
  if (w < 3) {
    x0 = (x0 + x1) / 2 - 1.5;
    w = 3;
  }
  const head = arrow ? Math.min(h * 0.6, w * 0.6) : 0;
  const xe = x0 + w;
  const ym = y + h / 2;
  if (strand >= 0) {
    return `M ${x0} ${y} L ${xe - head} ${y} L ${xe} ${ym} L ${xe - head} ${y + h} L ${x0} ${y + h} Z`;
  }
  return `M ${xe} ${y} L ${x0 + head} ${y} L ${x0} ${ym} L ${x0 + head} ${y + h} L ${xe} ${y + h} Z`;
}

function niceStep(length: number): number {
  const target = length / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(target || 1)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= target) return m * pow;
  }
  return 10 * pow;
}

// The longest prefix of `name` that fits in `room` px at the 10px label size
// (≈6px per character), with an ellipsis when cut; null if not even a couple
// of characters fit.
function fitLabel(name: string, room: number): string | null {
  const max = Math.floor(room / 6);
  if (name.length <= max) return name;
  if (max < 3) return null;
  return name.slice(0, max - 1) + "…";
}
