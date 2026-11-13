import { describe, expect, it } from "vitest";
import { isBound, primerBinding } from "./primers";
import type { Primer } from "./types";

const primer = (over: Partial<Primer>): Primer => ({
  id: "p1",
  name: "M13-F",
  sequence: "GTAAAACGACGGCCAGT",
  bindStart: 378,
  bindEnd: 395,
  strand: 1,
  bindingSites: 1,
  tm: 54.7,
  gcContent: 52.9,
  ...over,
});

describe("how a saved primer's binding is described", () => {
  it("shows the site 1-based and inclusive, with its strand", () => {
    const b = primerBinding(primer({}), 2686);
    expect(b).toMatchObject({ bound: true, text: "379–395 +", warn: false });
    expect(b.detail).toContain("top strand");
  });

  it("marks a reverse primer with a minus", () => {
    expect(primerBinding(primer({ strand: -1 }), 2686).text).toBe("379–395 −");
  });

  it("says when a primer doesn't bind, and flags it", () => {
    const p = primer({ bindStart: null, bindEnd: null, bindingSites: 0 });
    expect(isBound(p)).toBe(false);
    expect(primerBinding(p, 2686)).toMatchObject({ bound: false, text: "doesn’t bind", warn: true });
  });

  it("flags a primer whose site occurs more than once", () => {
    const b = primerBinding(primer({ bindingSites: 3 }), 2686);
    expect(b.text).toBe("379–395 + · 3 sites");
    expect(b.warn).toBe(true);
  });

  it("explains a 5′ tail that doesn't anneal", () => {
    const tailed = primer({ sequence: "GAATTCGGATCC" + "GTAAAACGACGGCCAGT" });
    const b = primerBinding(tailed, 2686);
    expect(b.warn).toBe(false);
    expect(b.detail).toContain("17 of its 29 nt anneal");
  });

  it("handles a site that wraps the origin", () => {
    const b = primerBinding(primer({ bindStart: 2680, bindEnd: 11 }), 2686);
    expect(b.text).toBe("2,681–11 +");
    expect(b.detail).not.toContain("don’t match");
  });
});
