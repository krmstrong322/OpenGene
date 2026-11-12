// Coordinates on screen.
//
// The engine and every piece of state in the UI use 0-based, half-open spans
// [start, end) and cursor positions that sit *between* bases. People read
// sequences the way GenBank writes them: bases numbered from 1, ranges
// inclusive. Everything shown to (or typed by) the user goes through these
// helpers so the two never mix.

const fmt = (n: number) => n.toLocaleString();

/** The 1-based number of the base at 0-based index `i`. */
export function basePos(i: number): string {
  return fmt(i + 1);
}

/**
 * A [start, end) span as a 1-based inclusive range, "183–211". An end of 0 on
 * a span that runs to the origin is the record's last base.
 */
export function rangeLabel(start: number, end: number, length: number): string {
  const last = end === 0 ? length : end;
  return `${fmt(start + 1)}–${fmt(last)}`;
}

/** A selection's range (wrapping selections keep their order). */
export function selectionRange(
  sel: { start: number; end: number; wrap?: boolean },
  length: number,
): string {
  const lo = sel.wrap ? sel.start : Math.min(sel.start, sel.end);
  const hi = sel.wrap ? sel.end : Math.max(sel.start, sel.end);
  return rangeLabel(lo, hi, length) + (sel.wrap ? " (wraps origin)" : "");
}

/**
 * A cursor or cut position `p` (the boundary after `p` bases) as the two
 * bases it sits between, "182 | 183".
 */
export function boundaryLabel(p: number, length: number, circular: boolean): string {
  if (p <= 0 || p >= length) {
    if (circular) return `${fmt(length)} | 1`;
    return p <= 0 ? "start" : "end";
  }
  return `${fmt(p)} | ${fmt(p + 1)}`;
}

/** Tick label for the base index `b` a ruler tick sits at (the origin is base 1). */
export function tickLabel(b: number): string {
  return String(b === 0 ? 1 : b);
}

/** 1-based inclusive [first, last] typed by the user → 0-based [start, end). */
export function toSpan(first: number, last: number): { start: number; end: number } {
  return { start: first - 1, end: last };
}

/** 0-based [start, end) → the 1-based inclusive pair shown in number fields. */
export function fromSpan(start: number, end: number, length: number): { first: number; last: number } {
  return { first: start + 1, last: end === 0 && start > 0 ? length : end };
}
