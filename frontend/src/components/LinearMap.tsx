import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ZoomControls, wheelZoomFactor } from "./ZoomControls";
import type { CutSite, Feature, ORF, PlasmidRecord, Selection } from "../lib/types";
import type { BoundPrimer } from "../lib/primers";
import { METHYL_LABELS, TYPE_COLORS, featureCoords, featureSpans } from "../lib/types";
import { boundaryLabel, rangeLabel, tickLabel } from "../lib/coords";
import { MAP_KEYS_HINT, mapKeyHandler } from "../lib/mapKeys";
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
  primers?: BoundPrimer[];
  orfs?: ORF[];
  onSelectRange?: (sel: Selection) => void;
}

const PAD = 40;
const CUT_ROW_H = 9; // one row of enzyme labels above the axis
const CUT_ROWS_MAX = 8; // beyond this a site keeps its mark but not its label
const RULER_H = 22; // tick marks and numbers, below the axis
const BOTTOM = 30; // clear of the zoom buttons
const MAX_PX_PER_BASE = 12; // fully zoomed in, a base is this wide
const MAX_WIDTH = 30000; // px; keeps the drawing a sane size for long records
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
  // however the workspace is divided; 900 until the first measurement. Zoomed
  // in, the drawing is `zoom` times wider and scrolls sideways in its pane.
  const [scrollRef, size] = useSize<HTMLDivElement>();
  const viewW = Math.max(420, Math.round(size?.width || 900));
  const maxZoom = Math.max(
    1,
    Math.min((length * MAX_PX_PER_BASE) / (viewW - PAD * 2), MAX_WIDTH / viewW),
  );
  const [zoomWanted, setZoom] = useState(1);
  useEffect(() => setZoom(1), [record.id]);
  const zoom = Math.min(maxZoom, Math.max(1, zoomWanted));
  const width = Math.round(viewW * zoom);
  const usable = width - PAD * 2;
  const x = (base: number) => PAD + (base / length) * usable;
  const laneOf = useMemo(() => assignLanes(record.features, length), [record.features, length]);
  const laneCount = Math.max(1, ...Array.from(laneOf.values()).map((l) => l + 1));

  // Row (0 = lowest) for each cut-site label: the first row where it doesn't
  // overlap a label already placed (≈4.8px per character at 8px); -1 when
  // every row is taken there, and the site is drawn without a label.
  const cutRows = useMemo(() => {
    const rows: [number, number][][] = []; // occupied [left, right] spans per row
    return cutSites.map((c) => {
      const cx = PAD + (c.position / length) * usable;
      const half = (c.enzyme.length * 4.8 + 6) / 2;
      for (let row = 0; row < CUT_ROWS_MAX; row++) {
        const taken = rows[row] ?? (rows[row] = []);
        if (!taken.some(([a, b]) => cx + half > a && cx - half < b)) {
          taken.push([cx - half, cx + half]);
          return row;
        }
      }
      return -1;
    });
  }, [cutSites, length, usable]);
  const cutRowCount = Math.max(-1, ...cutRows) + 1;

  // Vertical layout, top to bottom: enzyme labels (as many rows as they
  // need), the axis, the ruler's ticks and numbers, then the feature lanes.
  // Enzyme marks stay above the axis and numbers below it, so the two can
  // never run into each other.
  const trackY = 14 + cutRowCount * CUT_ROW_H + (cutSites.length ? 12 : 0);
  const lanesY = trackY + RULER_H + 6;

  // Overlay bands sit below the feature lanes.
  const featuresBottom = lanesY + laneCount * (TRACK_H + 6);
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
  const totalH = orfBandY + orfRows * (THIN_H + 3) + BOTTOM;

  // Numbered ticks about every 70 px, whatever the zoom.
  const ticks = useMemo(() => {
    const step = niceStep((length * 70) / usable);
    const out: number[] = [];
    for (let b = 0; b <= length; b += step) out.push(b);
    return out;
  }, [length, usable]);

  // ----- zoom and pan -----
  // Zooming keeps one base where it is on screen: the one under the pointer,
  // or the one in the middle of the view. The scroll position that achieves
  // that is applied once the wider drawing has been laid out.
  const anchor = useRef<{ base: number; offset: number } | null>(null);
  const zoomBy = (factor: number, clientX?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.min(maxZoom, Math.max(1, zoom * factor));
    if (next === zoom) return;
    const rect = el.getBoundingClientRect();
    const offset = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    anchor.current = { base: ((el.scrollLeft + offset - PAD) / usable) * length, offset };
    setZoom(next);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = PAD + (a.base / length) * usable - a.offset;
  }, [usable, length, scrollRef]);

  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  // Ctrl/⌘ + wheel (also a trackpad pinch). Native listener: React's is passive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomRef.current(wheelZoomFactor(e), e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollRef]);

  // Drag to pan when zoomed in; a drag doesn't count as a click on a feature.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || zoom <= 1) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.currentTarget.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const d = drag.current;
    if (d?.moved) window.setTimeout(() => (drag.current = null), 0);
    else drag.current = null;
    setPanning(false);
  };

  // When zoomed in, a selection made anywhere is brought into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || zoom <= 1 || !selection) return;
    const segs = selectionSegments(selection, length);
    const [lo, hi] = segs.length ? segs[0] : [selection.start, selection.start];
    const left = PAD + (lo / length) * usable;
    const right = PAD + (hi / length) * usable;
    const visible = right > el.scrollLeft + 20 && left < el.scrollLeft + el.clientWidth - 20;
    if (!visible) {
      const span = Math.min(right - left, el.clientWidth - 80);
      el.scrollLeft = Math.max(0, left + span / 2 - el.clientWidth / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  return (
    <div className="map-wrap">
    <div
      ref={scrollRef}
      className="map-scroll"
      style={{ cursor: panning ? "grabbing" : zoom > 1 ? "grab" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(e) => {
        if (drag.current?.moved) e.stopPropagation();
      }}
    >
    <svg
      className="map-svg"
      viewBox={`0 0 ${width} ${totalH}`}
      width={width}
      height={totalH}
      style={{ userSelect: "none" }}
      role="application"
      aria-roledescription="map"
      aria-label={`Linear map of ${record.name}. ${MAP_KEYS_HINT}`}
      tabIndex={0}
      onKeyDown={mapKeyHandler({
        features: record.features,
        selection,
        onSelectFeature,
        onFeatureMenu,
        zoomBy: (f) => zoomBy(f),
        resetZoom: () => setZoom(1),
      })}
    >
      {/* axis */}
      <line className="backbone" x1={PAD} y1={trackY} x2={width - PAD} y2={trackY} strokeWidth={2} />
      {!record.isCircular && (
        <>
          <line className="tick" x1={PAD} y1={trackY - 6} x2={PAD} y2={trackY + 6} strokeWidth={2} />
          <line
            x1={width - PAD}
            y1={trackY - 6}
            x2={width - PAD}
            y2={trackY + 6}
            className="tick"
            strokeWidth={2}
          />
        </>
      )}

      {ticks.map((b) => (
        <g key={`t-${b}`}>
          <line className="tick" x1={x(b)} y1={trackY + 2} x2={x(b)} y2={trackY + 7} />
          <text className="tick-label" x={x(b)} y={trackY + 17} fontSize={9} textAnchor="middle">
            {tickLabel(b)}
          </text>
        </g>
      ))}

      {/* selection (one rect per segment, so a wrapping span shows both parts) */}
      {selectionSegments(selection, length).map(([lo, hi], i) => (
        <rect
          key={`sel-${i}`}
          x={x(lo)}
          y={trackY - 3}
          width={Math.max(2, x(hi) - x(lo))}
          height={6}
          className="sel"
          rx={2}
          opacity={0.9}
        />
      ))}

      {/* cut sites, above the axis: stems first, then labels stacked upward
          in as many rows as they need, so no stem runs through a label */}
      {cutSites.map((c, i) => (
        <line
          key={`cs-${i}`}
          x1={x(c.position)}
          y1={trackY - 9 - Math.max(0, cutRows[i]) * CUT_ROW_H}
          x2={x(c.position)}
          y2={trackY + 1}
          className={c.methylation.some((m) => m === "dam" || m === "dcm") ? "cut methyl" : "cut"}
          strokeWidth={1}
        >
          <title>{cutTitle(c, length, record.isCircular)}</title>
        </line>
      ))}
      {cutSites.map((c, i) =>
        cutRows[i] < 0 ? null : (
        <text
          key={`cl-${i}`}
          x={x(c.position)}
          y={trackY - 11 - cutRows[i] * CUT_ROW_H}
          fontSize={8}
          className="cut-label label-halo"
          textAnchor="middle"
        >
          {c.enzyme}
        </text>
        ),
      )}

      {/* features as lanes below the axis */}
      {record.features.map((f) => {
        const lane = laneOf.get(f.id) ?? 0;
        const y = lanesY + lane * (TRACK_H + 6);
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
            data-feature-id={f.id}
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
    </div>
    <ZoomControls
      zoom={zoom}
      min={1}
      max={maxZoom}
      onZoom={(f) => zoomBy(f)}
      onReset={() => setZoom(1)}
      label="linear map"
    />
    </div>
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

// The smallest round number (1, 2 or 5 × a power of ten) that is at least `target`.
function niceStep(target: number): number {
  target = Math.max(1, target);
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
