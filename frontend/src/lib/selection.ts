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

/**
 * Normalize an overlay span (ORF or primer) coming off the API for display and
 * selection. The backend reports endpoints modulo the record length, so:
 *   - a full-record span (start === end, with a positive length) becomes
 *     [0, length);
 *   - on a LINEAR record a terminal endpoint of 0 (an end that is really the
 *     record length) becomes [start, length) rather than an empty/wrong span.
 * Circular spans are left untouched, since end === 0 there legitimately means
 * the origin.
 */
export function normalizeSpan(
  start: number,
  end: number,
  length: number,
  circular: boolean,
  lengthBp?: number,
): { start: number; end: number } {
  if (start === end && (lengthBp ?? 0) > 0) return { start: 0, end: length };
  if (!circular && end === 0 && start !== 0) return { start, end: length };
  return { start, end };
}
