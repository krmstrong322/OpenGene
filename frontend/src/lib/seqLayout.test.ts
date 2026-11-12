import { describe, expect, it } from "vitest";
import { feature, record } from "../test/fixtures";
import { buildLines, colOf, groupBases, lineAt, linearize, pack, type Options } from "./seqLayout";
import type { CutSite } from "./types";

const ALL: Options = { complement: true, translations: true, features: true, enzymes: true };
const NONE: Options = { complement: false, translations: false, features: false, enzymes: false };
const seq = (n: number) => "ACGT".repeat(Math.ceil(n / 4)).slice(0, n);

describe("sequence view layout", () => {
  it("breaks the sequence into lines that cover every base once", () => {
    const lines = buildLines(record(seq(95)), 30, [], [], NONE, 7);
    expect(lines.map((l) => [l.start, l.end])).toEqual([[0, 30], [30, 60], [60, 90], [90, 95]]);
    // Lines stack without gaps or overlap.
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].top).toBeGreaterThanOrEqual(lines[i - 1].top + lines[i - 1].height);
    }
  });

  it("gives an empty record one empty line", () => {
    expect(buildLines(record(""), 30, [], [], ALL, 7)).toHaveLength(1);
  });

  it("makes lines taller for the second strand", () => {
    const rec = record(seq(60));
    const one = buildLines(rec, 30, [], [], NONE, 7)[0].height;
    const two = buildLines(rec, 30, [], [], { ...NONE, complement: true }, 7)[0].height;
    expect(two).toBeGreaterThan(one);
  });

  it("splits a feature across the lines it spans, and leaves other lines alone", () => {
    const rec = record(seq(90), { features: [feature({ start: 20, end: 70, name: "long" })] });
    const lines = buildLines(rec, 30, [], [], { ...NONE, features: true }, 7);
    const pieces = lines.map((l) => l.feats.flatMap((f) => f.pieces.map((p) => [p.a, p.b])));
    expect(pieces).toEqual([[[20, 30]], [[30, 60]], [[60, 70]]]);
  });

  it("draws a feature that wraps the origin at both ends of the record", () => {
    const rec = record(seq(90), { features: [feature({ start: 80, end: 10, name: "wrap" })] });
    const lines = buildLines(rec, 30, [], [], { ...NONE, features: true }, 7);
    expect(lines[0].feats).toHaveLength(1);
    expect(lines[1].feats).toHaveLength(0);
    expect(lines[2].feats).toHaveLength(1);
  });

  it("hides feature bars and enzyme labels when they are switched off", () => {
    const rec = record(seq(60), { features: [feature({ start: 5, end: 25 })] });
    const cut = { position: 12, enzyme: "EcoRI" } as CutSite;
    const lines = buildLines(rec, 30, [cut], [], NONE, 7);
    expect(lines[0].feats).toHaveLength(0);
    expect(lines[0].cuts).toHaveLength(0);
    const shown = buildLines(rec, 30, [cut], [], ALL, 7);
    expect(shown[0].cuts.map((c) => c.enzyme)).toEqual(["EcoRI"]);
    expect(shown[1].cuts).toHaveLength(0);
  });

  it("finds the line at a vertical offset", () => {
    const lines = buildLines(record(seq(95)), 30, [], [], NONE, 7);
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, lines[2].top + 1)).toBe(2);
    expect(lineAt(lines, 1e6)).toBe(3);
  });
});

describe("layout helpers", () => {
  it("leaves a blank column after every ten bases", () => {
    expect(colOf(9)).toBe(9);
    expect(colOf(10)).toBe(11);
    expect(groupBases("ACGTACGTACGTACGTACGTAC")).toBe("ACGTACGTAC GTACGTACGT AC");
  });

  it("splits a span that wraps the origin", () => {
    expect(linearize(10, 20, 100)).toEqual([[10, 20]]);
    expect(linearize(90, 10, 100)).toEqual([[90, 100], [0, 10]]);
    expect(linearize(90, 0, 100)).toEqual([[90, 100]]);
  });

  it("packs overlapping extents into separate rows", () => {
    const { rows, count } = pack([[0, 10], [5, 15], [10, 20]]);
    expect(count).toBe(2);
    expect(rows[0]).toBe(rows[2]);
    expect(rows[1]).not.toBe(rows[0]);
  });
});
