// SVG geometry helpers for the circular plasmid map.

export interface Point {
  x: number;
  y: number;
}

// The half-open base segments a [start,end) span occupies, split at the origin
// when it wraps (end < start).
export function spanSegments(start: number, end: number, length: number): [number, number][] {
  return end >= start ? [[start, end]] : [[start, length], [0, end]];
}

function segsOverlap(a: [number, number][], b: [number, number][]): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 && b0 < a1));
}

// Greedy lane packing for [start,end) spans that may wrap the origin. A span is
// placed on the first lane where neither of its segments overlaps anything
// already there, so wrapping spans can't be packed on top of another near the
// origin. Returns the lane index assigned to each input span.
export function stackSpans(spans: [number, number][], length: number): number[] {
  const lanes: [number, number][][] = [];
  return spans.map(([start, end]) => {
    const segs = spanSegments(start, end, length);
    let lane = lanes.findIndex((placed) => !segsOverlap(placed, segs));
    if (lane === -1) {
      lanes.push([...segs]);
      lane = lanes.length - 1;
    } else {
      lanes[lane].push(...segs);
    }
    return lane;
  });
}

/** Convert a base position to an angle in radians (0 = top, clockwise). */
export function baseToAngle(base: number, length: number): number {
  return (base / length) * 2 * Math.PI - Math.PI / 2;
}

export function polar(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/**
 * Build an SVG path for an annular arc (a ring segment) between two base
 * positions, honoring circular wrap-around when start > end.
 */
export function arcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startBase: number,
  endBase: number,
  length: number,
): string {
  // span in bases, accounting for wrap-around
  const span = endBase >= startBase ? endBase - startBase : length - startBase + endBase;
  const a0 = baseToAngle(startBase, length);
  const a1 = baseToAngle(startBase + span, length);
  const largeArc = span / length > 0.5 ? 1 : 0;

  const pO0 = polar(cx, cy, rOuter, a0);
  const pO1 = polar(cx, cy, rOuter, a1);
  const pI1 = polar(cx, cy, rInner, a1);
  const pI0 = polar(cx, cy, rInner, a0);

  return [
    `M ${pO0.x} ${pO0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${pO1.x} ${pO1.y}`,
    `L ${pI1.x} ${pI1.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${pI0.x} ${pI0.y}`,
    "Z",
  ].join(" ");
}

// Arrowhead length as a fraction of the band's width, so every feature gets
// the same tip shape whatever its length or the plasmid's size.
const HEAD_RATIO = 0.7;
// A head never takes more than this share of a feature, so short features
// keep a little body instead of collapsing into a bare triangle.
const HEAD_MAX_SHARE = 0.6;
// Features shorter than this on screen are drawn at this size (about their
// middle) so they stay visible and clickable.
const MIN_ARC_PX = 4;

/**
 * Arc path for a directional feature: a ring segment with an arrowhead on the
 * 3' end (pointing clockwise for + strand, counter-clockwise for −). The head
 * has a fixed on-screen length tied to the band width rather than to the
 * feature or plasmid length.
 */
export function directedArcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startBase: number,
  endBase: number,
  length: number,
  strand: number,
): string {
  const span =
    endBase >= startBase ? endBase - startBase : length - startBase + endBase;
  if (span <= 0) return arcPath(cx, cy, rInner, rOuter, startBase, endBase, length);

  const rMid = (rInner + rOuter) / 2;
  let a0 = baseToAngle(startBase, length);
  let a1 = a0 + (span / length) * 2 * Math.PI;
  const minSweep = MIN_ARC_PX / rMid;
  if (a1 - a0 < minSweep) {
    const mid = (a0 + a1) / 2;
    a0 = mid - minSweep / 2;
    a1 = mid + minSweep / 2;
  }
  const sweep = a1 - a0;
  const head = Math.min(((rOuter - rInner) * HEAD_RATIO) / rMid, sweep * HEAD_MAX_SHARE);
  const largeArc = sweep - head > Math.PI ? 1 : 0;
  const at = (r: number, a: number) => {
    const p = polar(cx, cy, r, a);
    return `${p.x} ${p.y}`;
  };

  if (strand >= 0) {
    const aBody = a1 - head;
    return [
      `M ${at(rOuter, a0)}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${at(rOuter, aBody)}`,
      `L ${at(rMid, a1)}`,
      `L ${at(rInner, aBody)}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${at(rInner, a0)}`,
      "Z",
    ].join(" ");
  }
  const aBody = a0 + head;
  return [
    `M ${at(rMid, a0)}`,
    `L ${at(rOuter, aBody)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${at(rOuter, a1)}`,
    `L ${at(rInner, a1)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${at(rInner, aBody)}`,
    "Z",
  ].join(" ");
}

/** Tick line coordinates from the ring edge outward. */
export function tick(
  cx: number,
  cy: number,
  rFrom: number,
  rTo: number,
  base: number,
  length: number,
): { from: Point; to: Point; labelPoint: Point } {
  const a = baseToAngle(base, length);
  return {
    from: polar(cx, cy, rFrom, a),
    to: polar(cx, cy, rTo, a),
    labelPoint: polar(cx, cy, rTo + 12, a),
  };
}
