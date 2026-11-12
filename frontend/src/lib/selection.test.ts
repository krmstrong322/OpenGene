import { describe, expect, it } from "vitest";
import { inSelection, normalizeSpan, selectionLength, selectionSegments } from "./selection";

describe("selection geometry", () => {
  it("has no segments for a cursor or no selection", () => {
    expect(selectionSegments(null, 100)).toEqual([]);
    expect(selectionSegments({ start: 5, end: 5 }, 100)).toEqual([]);
  });

  it("orders a backwards drag", () => {
    expect(selectionSegments({ start: 30, end: 10 }, 100)).toEqual([[10, 30]]);
  });

  it("splits a selection that wraps the origin into its two parts", () => {
    const sel = { start: 90, end: 10, wrap: true };
    expect(selectionSegments(sel, 100)).toEqual([[90, 100], [0, 10]]);
    expect(selectionLength(sel, 100)).toBe(20);
    expect(inSelection(sel, 100, 95)).toBe(true);
    expect(inSelection(sel, 100, 5)).toBe(true);
    expect(inSelection(sel, 100, 50)).toBe(false);
  });

  it("normalizes spans the engine reports modulo the record length", () => {
    expect(normalizeSpan(0, 0, 100, true, 100)).toEqual({ start: 0, end: 100 });
    expect(normalizeSpan(40, 0, 100, false)).toEqual({ start: 40, end: 100 });
    expect(normalizeSpan(40, 0, 100, true)).toEqual({ start: 40, end: 0 });
  });
});
