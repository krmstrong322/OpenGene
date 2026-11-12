// How the sequence view is laid out: which bases, feature bars, enzyme labels
// and translations go on each line, and how tall each line is. Pure functions
// of the record and the display options — no React, no DOM.
import type { CdsTranslation } from "./translate";
import type { CutSite, Feature, PlasmidRecord } from "./types";
import { TYPE_COLORS, featureSpans } from "./types";

// Vertical layout of one sequence line, in px.
export const ROW = 18; // a strand or translation row
export const CUT_ROW = 13; // an enzyme label row
export const FEAT_ROW = 16; // a feature lane (bar + spacing)
export const BAR_H = 12;
export const LINE_GAP = 12;
export const PAD_X = 14;
export const OVERSCAN = 400; // px rendered above/below the viewport
export const CUT_FONT_RATIO = 10 / 12; // enzyme labels are 10px in a 12px-mono grid


// Column of base `k` within a line: one blank column after every 10 bases.
export const colOf = (k: number) => k + Math.floor(k / 10);

export interface Piece {
  a: number; // absolute base range [a, b) within one line
  b: number;
  gap: boolean; // the gap (intron) between two parts
  tip: "start" | "end" | null; // the feature's 3' end is here
}

export interface LineFeature {
  f: Feature;
  color: string;
  lane: number;
  pieces: Piece[];
}

export interface LineCut {
  pos: number;
  enzyme: string;
  row: number;
}

export interface Line {
  start: number;
  end: number;
  top: number;
  height: number;
  cutRows: number;
  cuts: LineCut[];
  cds: { t: CdsTranslation; row: number }[];
  cdsRows: number;
  feats: LineFeature[];
  featLanes: number;
}

export interface Options {
  complement: boolean;
  translations: boolean;
  features: boolean;
  enzymes: boolean;
}

// Linear pieces of a [s, e) span that may wrap the origin.
export function linearize(s: number, e: number, n: number): [number, number][] {
  if (e > s) return [[s, e]];
  if (s > e) return ([[s, n], [0, e]] as [number, number][]).filter(([a, b]) => b > a);
  return [];
}

// Greedy packing of [lo, hi) extents into rows; returns each item's row.
export function pack(extents: [number, number][]): { rows: number[]; count: number } {
  const order = extents.map((_, i) => i).sort((i, j) => extents[i][0] - extents[j][0]);
  const ends: number[] = [];
  const rows = new Array<number>(extents.length);
  for (const i of order) {
    const [lo, hi] = extents[i];
    let r = ends.findIndex((e) => lo >= e);
    if (r === -1) {
      ends.push(hi);
      r = ends.length - 1;
    } else ends[r] = hi;
    rows[i] = r;
  }
  return { rows, count: ends.length };
}

export function buildLines(
  record: PlasmidRecord,
  perLine: number,
  cutSites: CutSite[],
  translations: CdsTranslation[],
  opts: Options,
  cw: number,
): Line[] {
  const n = record.length;
  const count = Math.max(1, Math.ceil(n / perLine));
  const featBuckets: Map<string, LineFeature>[] = Array.from({ length: count }, () => new Map());

  const addPiece = (f: Feature, color: string, a: number, b: number, gap: boolean, tip: Piece["tip"]) => {
    const first = Math.floor(a / perLine);
    const last = Math.floor((b - 1) / perLine);
    for (let li = first; li <= last; li++) {
      const pa = Math.max(a, li * perLine);
      const pb = Math.min(b, (li + 1) * perLine);
      const t = tip === "end" && li === last ? "end" : tip === "start" && li === first ? "start" : null;
      let lf = featBuckets[li].get(f.id);
      if (!lf) {
        lf = { f, color, lane: 0, pieces: [] };
        featBuckets[li].set(f.id, lf);
      }
      lf.pieces.push({ a: pa, b: pb, gap, tip: t });
    }
  };

  if (opts.features || opts.translations) {
    for (const f of record.features) {
      const color = f.color || TYPE_COLORS[f.type] || "#8E949C";
      const spans = featureSpans(f);
      spans.forEach(([s, e], i) => {
        if (i > 0) {
          for (const [a, b] of linearize(spans[i - 1][1], s, n)) addPiece(f, color, a, b, true, null);
        }
        const chunks = linearize(s, e, n);
        chunks.forEach(([a, b], ci) => {
          let tip: Piece["tip"] = null;
          if (f.strand === 1 && i === spans.length - 1 && ci === chunks.length - 1) tip = "end";
          if (f.strand === -1 && i === 0 && ci === 0) tip = "start";
          addPiece(f, color, a, b, false, tip);
        });
      });
    }
  }

  const transById = new Map(translations.map((t) => [t.feature.id, t]));
  const cutBuckets: { pos: number; enzyme: string }[][] = Array.from({ length: count }, () => []);
  if (opts.enzymes) {
    for (const c of cutSites) {
      const li = Math.min(Math.floor(c.position / perLine), count - 1);
      if (li >= 0) cutBuckets[li].push({ pos: c.position, enzyme: c.enzyme });
    }
  }

  const lines: Line[] = [];
  let top = 0;
  for (let li = 0; li < count; li++) {
    const start = li * perLine;
    const end = Math.min(n, start + perLine);
    const all = Array.from(featBuckets[li].values());

    const feats = opts.features ? all : [];
    const extent = (lf: LineFeature): [number, number] => [
      Math.min(...lf.pieces.map((p) => p.a)),
      Math.max(...lf.pieces.map((p) => p.b)),
    ];
    const fp = pack(feats.map(extent));
    feats.forEach((lf, i) => (lf.lane = fp.rows[i]));

    const cdsHere = opts.translations
      ? all
          .filter((lf) => lf.f.type === "CDS" && lf.pieces.some((p) => !p.gap) && transById.has(lf.f.id))
          .map((lf) => ({ t: transById.get(lf.f.id)!, ext: extent(lf) }))
      : [];
    const cp = pack(cdsHere.map((c) => c.ext));
    const cds = cdsHere.map((c, i) => ({ t: c.t, row: cp.rows[i] }));

    // Enzyme labels: stack any that would overlap.
    const cutsRaw = cutBuckets[li].sort((x, y) => x.pos - y.pos);
    const cutCw = cw * CUT_FONT_RATIO;
    const cutExt = cutsRaw.map((c): [number, number] => {
      const x = colOf(Math.max(0, c.pos - start)) * cw;
      return [x, x + (c.enzyme.length + 1) * cutCw];
    });
    const kp = pack(cutExt);
    const cuts = cutsRaw.map((c, i) => ({ ...c, row: kp.rows[i] }));

    const height =
      kp.count * CUT_ROW +
      ROW * (opts.complement ? 2 : 1) +
      cp.count * ROW +
      fp.count * FEAT_ROW +
      LINE_GAP;
    lines.push({
      start,
      end,
      top,
      height,
      cutRows: kp.count,
      cuts,
      cds,
      cdsRows: cp.count,
      feats,
      featLanes: fp.count,
    });
    top += height;
  }
  return lines;
}

// The line holding vertical offset `y` (binary search over line tops).
export function lineAt(lines: Line[], y: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function groupBases(s: string): string {
  return s.replace(/(.{10})(?=.)/g, "$1 ");
}
