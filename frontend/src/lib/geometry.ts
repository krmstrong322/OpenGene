// SVG geometry helpers for the circular plasmid map.

export interface Point {
  x: number;
  y: number;
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

/**
 * Arc path for a directional feature: a ring segment with an arrowhead on the
 * 3' end (pointing clockwise for + strand, counter-clockwise for −).
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
  // arrowhead occupies up to ~3% of the circle or the whole feature if short
  const headSpan = Math.min(span, (length * 0.03) | 0 || 1);

  if (strand >= 0) {
    const bodyEnd = startBase + span - headSpan;
    const a0 = baseToAngle(startBase, length);
    const aBody = baseToAngle(bodyEnd, length);
    const aTip = baseToAngle(startBase + span, length);
    const largeArc = (span - headSpan) / length > 0.5 ? 1 : 0;
    const pO0 = polar(cx, cy, rOuter, a0);
    const pOb = polar(cx, cy, rOuter, aBody);
    const tip = polar(cx, cy, rMid, aTip);
    const pIb = polar(cx, cy, rInner, aBody);
    const pI0 = polar(cx, cy, rInner, a0);
    return [
      `M ${pO0.x} ${pO0.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${pOb.x} ${pOb.y}`,
      `L ${tip.x} ${tip.y}`,
      `L ${pIb.x} ${pIb.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${pI0.x} ${pI0.y}`,
      "Z",
    ].join(" ");
  } else {
    const bodyStart = startBase + headSpan;
    const aTip = baseToAngle(startBase, length);
    const aBody = baseToAngle(bodyStart, length);
    const aEnd = baseToAngle(startBase + span, length);
    const largeArc = (span - headSpan) / length > 0.5 ? 1 : 0;
    const tip = polar(cx, cy, rMid, aTip);
    const pOb = polar(cx, cy, rOuter, aBody);
    const pOe = polar(cx, cy, rOuter, aEnd);
    const pIe = polar(cx, cy, rInner, aEnd);
    const pIb = polar(cx, cy, rInner, aBody);
    return [
      `M ${tip.x} ${tip.y}`,
      `L ${pOb.x} ${pOb.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${pOe.x} ${pOe.y}`,
      `L ${pIe.x} ${pIe.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${pIb.x} ${pIb.y}`,
      "Z",
    ].join(" ");
  }
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
