import type { Selection } from "./types";

/**
 * The half-open base ranges a selection covers, as linear [lo, hi) segments.
 * A wrapping selection (`wrap` set) yields its two segments [start, length)
 * and [0, end); any other selection yields a single [min, max) segment. An
 * empty selection yields no segments.
 */
export function selectionSegments(
  sel: Selection | null,
  length: number,
): [number, number][] {
  if (!sel || sel.start === sel.end) return [];
  if (sel.wrap) {
    const segs: [number, number][] = [];
    if (sel.start < length) segs.push([sel.start, length]);
    if (sel.end > 0) segs.push([0, sel.end]);
    return segs;
  }
  return [[Math.min(sel.start, sel.end), Math.max(sel.start, sel.end)]];
}

/** Total number of selected bases. */
export function selectionLength(sel: Selection | null, length: number): number {
  return selectionSegments(sel, length).reduce((n, [lo, hi]) => n + (hi - lo), 0);
}

/** True if base index `i` falls inside the selection. */
export function inSelection(sel: Selection | null, length: number, i: number): boolean {
  return selectionSegments(sel, length).some(([lo, hi]) => i >= lo && i < hi);
}
