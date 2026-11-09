// Read-only sequence helpers for display: complements and the per-codon
// translation of CDS features. Nothing here edits a sequence; edits go through
// the backend engine.

import type { Feature, PlasmidRecord } from "./types";
import { TYPE_COLORS, featureSpans } from "./types";

const COMPLEMENT: Record<string, string> = {
  A: "T", C: "G", G: "C", T: "A",
  R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
  B: "V", D: "H", H: "D", V: "B", N: "N",
};

export function complement(seq: string): string {
  let out = "";
  for (const b of seq) out += COMPLEMENT[b] ?? "N";
  return out;
}

export function reverseComplement(seq: string): string {
  return complement(seq).split("").reverse().join("");
}

// Standard genetic code (NCBI table 1; table 11 differs only in start codons).
const BASES = "TCAG";
const AMINO = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const CODON_TABLE: Record<string, string> = {};
for (let i = 0; i < 64; i++) {
  CODON_TABLE[BASES[i >> 4] + BASES[(i >> 2) & 3] + BASES[i & 3]] = AMINO[i];
}

/** One-letter amino acid for a codon; "X" when it holds an ambiguous base. */
export function translateCodon(codon: string): string {
  return CODON_TABLE[codon] ?? "X";
}

export interface CdsTranslation {
  feature: Feature;
  color: string;
  // Amino acid keyed by the forward-strand index of its codon's middle base.
  aa: Map<number, string>;
}

/** The forward-strand base indices of a feature in reading order: 5'→3' on
 *  its own strand, skipping the gaps between parts. */
export function readingOrder(f: Feature, length: number): number[] {
  const out: number[] = [];
  for (const [s, e] of featureSpans(f)) {
    if (e > s) {
      for (let i = s; i < e; i++) out.push(i);
    } else if (s > e) {
      // Wraps the origin.
      for (let i = s; i < length; i++) out.push(i);
      for (let i = 0; i < e; i++) out.push(i);
    }
  }
  if (f.strand === -1) out.reverse();
  return out;
}

function codonStart(f: Feature): number {
  const raw = f.notes?.codon_start;
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return v === 2 || v === 3 ? v - 1 : 0;
}

/** Codon-by-codon translations of every CDS, honoring strand, parts (exons)
 *  and /codon_start. An incomplete final codon is left untranslated. */
export function cdsTranslations(record: PlasmidRecord): CdsTranslation[] {
  const seq = record.sequence;
  const n = record.length;
  const out: CdsTranslation[] = [];
  for (const f of record.features) {
    if (f.type !== "CDS") continue;
    const order = readingOrder(f, n);
    const aa = new Map<number, string>();
    for (let k = codonStart(f); k + 2 < order.length; k += 3) {
      let codon = seq[order[k]] + seq[order[k + 1]] + seq[order[k + 2]];
      if (f.strand === -1) codon = complement(codon);
      aa.set(order[k + 1], translateCodon(codon));
    }
    out.push({ feature: f, color: f.color || TYPE_COLORS.CDS, aa });
  }
  return out;
}
