import { describe, expect, it } from "vitest";
import { basePos, boundaryLabel, fromSpan, rangeLabel, selectionRange, tickLabel, toSpan } from "./coords";

describe("coordinates shown to the user are 1-based and inclusive", () => {
  it("numbers the first base 1", () => {
    expect(basePos(0)).toBe("1");
    expect(basePos(999)).toBe("1,000");
  });

  it("shows a half-open span as an inclusive range", () => {
    expect(rangeLabel(182, 211, 4969)).toBe("183–211");
    expect(rangeLabel(0, 4969, 4969)).toBe("1–4,969");
  });

  it("treats an end of 0 as the last base (a span that runs to the origin)", () => {
    expect(rangeLabel(871, 0, 919)).toBe("872–919");
  });

  it("keeps the order of a selection that wraps the origin", () => {
    expect(selectionRange({ start: 900, end: 10, wrap: true }, 919)).toBe("901–10 (wraps origin)");
    expect(selectionRange({ start: 20, end: 5 }, 919)).toBe("6–20");
  });

  it("names a cursor by the two bases it sits between", () => {
    expect(boundaryLabel(182, 919, true)).toBe("182 | 183");
    expect(boundaryLabel(0, 919, true)).toBe("919 | 1");
    expect(boundaryLabel(919, 919, true)).toBe("919 | 1");
    expect(boundaryLabel(0, 919, false)).toBe("start");
    expect(boundaryLabel(919, 919, false)).toBe("end");
  });

  it("labels the ruler's origin 1", () => {
    expect(tickLabel(0)).toBe("1");
    expect(tickLabel(500)).toBe("500");
  });

  it("round-trips what the user types in Start/End fields", () => {
    expect(toSpan(11, 20)).toEqual({ start: 10, end: 20 });
    expect(fromSpan(10, 20, 100)).toEqual({ first: 11, last: 20 });
    for (const [s, e] of [[0, 1], [10, 20], [99, 100]]) {
      const ui = fromSpan(s, e, 100);
      expect(toSpan(ui.first, ui.last)).toEqual({ start: s, end: e });
    }
  });

  it("shows a feature that ends at the origin as ending on the last base", () => {
    expect(fromSpan(871, 0, 919)).toEqual({ first: 872, last: 919 });
  });
});
