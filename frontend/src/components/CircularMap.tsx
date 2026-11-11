import { useEffect, useMemo, useRef, useState } from "react";
import { ZoomControls, wheelZoomFactor } from "./ZoomControls";
import type { CutSite, Feature, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";
import { METHYL_LABELS, TYPE_COLORS, featureCoords, featureSpans } from "../lib/types";
import { boundaryLabel, rangeLabel, tickLabel } from "../lib/coords";
import { useSize } from "../lib/useSize";
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
  /** Open the right-click menu for a feature. */
  onFeatureMenu?: (x: number, y: number, f: Feature) => void;
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
const TEXT_BOOST_MAX = 1.45;
const ZOOM_MAX = 8;
const MAX_CUT_LABELS = 40;
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
  onFeatureMenu,
  onHover,
  hoveredId,
  primers = [],
  orfs = [],
  onSelectRange,
}: Props) {
  const length = record.length || 1;
  // The drawing scales to fit its pane. When the pane is small, text is
  // enlarged (up to TEXT_BOOST_MAX) to stay readable, and labels are spaced
  // and truncated to match.
  const [svgRef, size] = useSize<SVGSVGElement>();

  // Zoom and pan: the view is a window onto the drawing, `zoom` times
  // magnified and centred on (cx, cy) in drawing units.
  const [view, setView] = useState({ zoom: 1, cx: CX, cy: CY });
  useEffect(() => setView({ zoom: 1, cx: CX, cy: CY }), [record.id]);
  const vbW = W / view.zoom;
  const vbH = H / view.zoom;
  const vbX = view.cx - vbW / 2;
  const vbY = view.cy - vbH / 2;

  const fit = size ? Math.min(size.width / W, size.height / H) : 1;
  const drawn = fit * view.zoom;
  // Text is drawn at a readable size whatever the scale: enlarged when the
  // pane is small, and held at its unzoomed size on screen when zoomed in, so
  // zooming spreads labels apart instead of just magnifying them.
  const k = drawn > 0 ? Math.min(TEXT_BOOST_MAX, Math.max(1 / view.zoom, 1 / drawn)) : 1;

  // Zoom by `factor`, keeping the drawing point under (clientX, clientY) —
  // or the middle of the view — where it is.
  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    setView((v) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(1, v.zoom * factor));
      if (zoom === v.zoom) return v;
      let px = v.cx;
      let py = v.cy;
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect && clientX !== undefined && clientY !== undefined && rect.width && rect.height) {
        const s = Math.min(rect.width / (W / v.zoom), rect.height / (H / v.zoom));
        px = v.cx + (clientX - (rect.left + rect.width / 2)) / s;
        py = v.cy + (clientY - (rect.top + rect.height / 2)) / s;
      }
      // The point stays put: its offset from the centre shrinks by the zoom ratio.
      const r = v.zoom / zoom;
      return clampView({ zoom, cx: px - (px - v.cx) * r, cy: py - (py - v.cy) * r });
    });
  };
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  // Ctrl/⌘ + wheel, which is also how a trackpad pinch arrives. Registered
  // natively: React's wheel listener is passive and can't stop the page zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomRef.current(wheelZoomFactor(e), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef]);

  // Drag to pan when zoomed in. A drag must not also count as a click on
  // whatever feature it started or ended on.
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || view.zoom <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setView((v) => clampView({ zoom: v.zoom, cx: d.cx - dx / drawn, cy: d.cy - dy / drawn }));
  };
  const endDrag = () => {
    // Keep `moved` until the click that follows the release has been swallowed.
    const d = drag.current;
    if (d?.moved) window.setTimeout(() => (drag.current = null), 0);
    else drag.current = null;
    setPanning(false);
  };
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
      layoutLabels(LABEL_GAP * k, [
        ...labelled.map((f) => ({
          key: f.id,
          feature: f,
          text: truncate(f.name, Math.min(48, Math.floor(LABEL_MAX / k))),
          angle: baseToAngle(midBase(f, length), length),
          anchorR: R_MARK,
        })),
        // A big enzyme set would bury the map in names; past the limit the
        // sites keep their marks (and tooltips) and the linear view names them.
        ...(cutSites.length > MAX_CUT_LABELS ? [] : cutSites).map((c, i) => ({
          key: `cut-${i}`,
          text: c.enzyme,
          angle: baseToAngle(c.position, length),
          anchorR: R_MARK + 11,
        })),
      ]),
    [labelled, cutSites, length, k],
  );

  return (
    <div className="map-wrap">
    <svg
      ref={svgRef}
      className="map-svg"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width="100%"
      style={{
        userSelect: "none",
        cursor: panning ? "grabbing" : view.zoom > 1 ? "grab" : undefined,
        touchAction: view.zoom > 1 ? "none" : undefined,
      }}
      role="img"
      aria-label={`Circular map of ${record.name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(e) => {
        if (drag.current?.moved) e.stopPropagation();
      }}
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
              fontSize={9 * k}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {tickLabel(b)}
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
              ORF {rangeLabel(o.start, o.end, length)} ({o.strand === 1 ? "+" : "−"}) · {o.protein.length} aa
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
            onContextMenu={(e) => {
              if (!onFeatureMenu) return;
              e.preventDefault();
              onFeatureMenu(e.clientX, e.clientY, f);
            }}
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
            className={c.methylation.some((m) => m === "dam" || m === "dcm") ? "cut methyl" : "cut"}
            x1={t.from.x}
            y1={t.from.y}
            x2={t.to.x}
            y2={t.to.y}
            strokeWidth={1.5}
          >
            <title>{cutTitle(c, length, record.isCircular)}</title>
          </line>
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
            fontSize={(f ? 11 : 10) * k}
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
            onContextMenu={(e) => {
              if (!onFeatureMenu) return;
              e.preventDefault();
              onFeatureMenu(e.clientX, e.clientY, f);
            }}
            onMouseEnter={() => onHover(f.id)}
            onMouseLeave={() => onHover(null)}
          >
            {leader}
            {text}
          </g>
        );
      })}

      {/* center label */}
      <text className="center-name" x={CX} y={CY - 4} fontSize={14 * k} textAnchor="middle">
        {truncate(record.name, 30)}
      </text>
      <text className="center-sub" x={CX} y={CY + 15 * k} fontSize={11.5 * k} textAnchor="middle">
        {length.toLocaleString()} bp
      </text>
    </svg>
    <ZoomControls
      zoom={view.zoom}
      min={1}
      max={ZOOM_MAX}
      onZoom={(f) => zoomBy(f)}
      onReset={() => setView({ zoom: 1, cx: CX, cy: CY })}
      label="circular map"
    />
    </div>
  );
}

// Keep the view inside the drawing.
function clampView(v: { zoom: number; cx: number; cy: number }) {
  const hw = W / v.zoom / 2;
  const hh = H / v.zoom / 2;
  return {
    zoom: v.zoom,
    cx: Math.min(W - hw, Math.max(hw, v.cx)),
    cy: Math.min(H - hh, Math.max(hh, v.cy)),
  };
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
function layoutLabels(gap: number, labelItems: LabelItem[]): PlacedLabel[] {
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
      group[i].y = Math.max(group[i].y, group[i - 1].y + gap);
    }
    // if the stack overflows the bottom, pull it back up
    const overflow = group.length ? group[group.length - 1].y - bottom : 0;
    if (overflow > 0) {
      for (let i = group.length - 1; i >= 0; i--) {
        const limit = i === group.length - 1 ? bottom : group[i + 1].y - gap;
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

function cutTitle(c: CutSite, length: number, circular: boolean): string {
  const ends =
    c.overhang_type === "blunt" ? "blunt ends" : `${c.overhang_type} overhang ${c.overhang}`;
  const meth = c.methylation.length
    ? ` · overlaps ${c.methylation.map((m) => METHYL_LABELS[m]).join(", ")}`
    : "";
  return `${c.enzyme} · cuts ${boundaryLabel(c.position, length, circular)} · ${ends}${meth}`;
}

function labelCoords(f: Feature, length: number): string {
  const bases = featureSpans(f).reduce(
    (sum, [s, e]) => sum + (e >= s ? e - s : length - s + e),
    0,
  );
  return `${featureCoords(f, length)}, ${bases.toLocaleString()}`;
}
