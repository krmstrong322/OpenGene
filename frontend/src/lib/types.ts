// Mirrors the backend Pydantic models (camelCase on the wire).

export type Strand = 1 | -1;

// OpenGene's own categories plus any GenBank feature key ("gene", "exon",
// "polyA_signal", ...), which is kept verbatim from imported files.
export type FeatureType = string;

// Types offered when adding or editing a feature, most common first.
export const COMMON_FEATURE_TYPES: FeatureType[] = [
  "CDS",
  "promoter",
  "terminator",
  "origin",
  "RBS",
  "tag",
  "primer",
  "misc_feature",
  "gene",
  "mRNA",
  "exon",
  "intron",
  "5'UTR",
  "3'UTR",
  "polyA_signal",
  "enhancer",
  "LTR",
  "protein_bind",
  "misc_binding",
  "misc_recomb",
  "sig_peptide",
  "mat_peptide",
  "repeat_region",
  "mobile_element",
  "ncRNA",
  "regulatory",
];

// One piece of a multi-part (GenBank join) feature.
export interface Segment {
  start: number;
  end: number; // end < start means this piece wraps the origin
}

export interface Feature {
  id: string;
  name: string;
  type: FeatureType;
  start: number; // 0-indexed, inclusive
  end: number; // 0-indexed, exclusive (end < start means it wraps the origin)
  strand: Strand;
  color?: string | null;
  // Qualifiers from the file (and OpenGene's own, e.g. auto-annotation
  // identity). A key the file repeats has a list of values.
  notes: Record<string, string | string[]>;
  // Pieces of a multi-part feature in forward order, start..end; the gaps
  // between them (introns) are not part of it. Empty for a simple feature.
  segments?: Segment[];
}

export interface Primer {
  id: string;
  name: string;
  sequence: string;
  bindStart: number;
  bindEnd: number;
  strand: Strand;
  tm: number;
  gcContent: number;
}

export interface HistoryEvent {
  id: string;
  op: string;
  description: string;
  timestamp: number;
  warnings: string[];
}

// How an edit inside a CDS that would break its reading frame is handled.
export type FramePolicy = "reject" | "pad" | "allow";

export interface PlasmidRecord {
  id: string;
  name: string;
  isCircular: boolean;
  length: number;
  sequence: string;
  features: Feature[];
  primers: Primer[];
  history: HistoryEvent[];
  createdAt: number; // unix seconds
  updatedAt: number; // unix seconds, last saved change of any kind
  canUndo?: boolean; // server-reported: an undo step is available
  canRedo?: boolean;
  hasTrace?: boolean; // opened from a sequencing trace (.ab1 / .scf)
}

// A saved plasmid in the library listing (no sequence).
export interface RecordSummary {
  id: string;
  name: string;
  length: number;
  isCircular: boolean;
  featureCount: number;
  hasTrace?: boolean;
  createdAt: number; // unix seconds
  updatedAt: number; // unix seconds
}

// A Sanger chromatogram: four channels of samples, and per base of the
// record's sequence its peak (sample index) and Phred quality.
export interface TraceData {
  samples: Record<"A" | "C" | "G" | "T", number[]>;
  peaks: number[];
  quality: number[];
  meta: Record<string, string>;
}

export interface ORF {
  start: number;
  end: number;
  strand: number;
  frame: number;
  length_bp: number;
  protein: string;
}

export interface CutSite {
  enzyme: string;
  position: number;
  recognition_site: string;
  strand: number;
}

// Facts about a selected stretch, computed by the backend.
export interface SelectionInfo {
  start: number;
  end: number;
  length: number;
  gc_content: number;
  tm: number | null; // null: ambiguous bases, under 8 bp, or very long
  mw_single: number | null; // g/mol
  mw_double: number | null;
  translation: string; // "*" = stop
  protein_mw: number | null;
  // "selection" (top strand from its first base) or the selected feature's
  // name (its own strand, parts only).
  translation_of: string;
  translation_strand: number;
}

// A search match. Sequence searches come from the backend; feature-name
// matches carry the feature (or primer) they point at.
export interface SearchHit {
  start: number;
  end: number; // end < start: wraps the origin
  strand: number;
  mismatches: number;
  frame?: number | null; // protein hits: reading frame on its strand
  feature?: string | null; // protein hits inside a spliced CDS
  featureId?: string;
  label?: string;
}

export interface PrimerAnalysis {
  sequence: string;
  tm: number;
  gc_content: number;
  length: number;
  hairpin_tm: number;
  homodimer_tm: number;
  warnings: string[];
}

// A shared selection range used to synchronize all three views.
// `wrap` marks an intentional origin-wrapping span (start > end on a circular
// record), as produced by clicking a wrapping feature or overlay track. It
// distinguishes that from an ordinary backwards drag, which consumers collapse
// with min/max. When `wrap` is set the selected bases are [start, length) ∪
// [0, end); otherwise they are [min, max).
export interface Selection {
  start: number;
  end: number;
  featureId?: string;
  wrap?: boolean;
}

export const TYPE_COLORS: Record<string, string> = {
  promoter: "#4C9A6A",
  CDS: "#4A78B5",
  terminator: "#C0533F",
  origin: "#D08C2E",
  primer: "#7E5BB0",
  tag: "#2D9396",
  RBS: "#8AA84B",
  misc_feature: "#8E949C",
  gene: "#6C8EBF",
  mRNA: "#5B9BD5",
  exon: "#3F6FA8",
  intron: "#A9B4C2",
  "5'UTR": "#9DB7D6",
  "3'UTR": "#9DB7D6",
  polyA_signal: "#B5524A",
  enhancer: "#5E9E57",
  LTR: "#A07A3C",
  protein_bind: "#B0773F",
  misc_binding: "#B0773F",
  misc_recomb: "#9C6AB0",
  sig_peptide: "#3E9AA0",
  mat_peptide: "#4A8FC0",
  repeat_region: "#9A8F6E",
  mobile_element: "#8C6D9E",
  ncRNA: "#C27BA0",
  regulatory: "#5C9A72",
};

// The [start, end) pieces of a feature: its parts, or its whole span.
export function featureSpans(f: Feature): [number, number][] {
  return f.segments && f.segments.length > 1
    ? f.segments.map((s) => [s.start, s.end] as [number, number])
    : [[f.start, f.end]];
}

// "100–200, 400–450" for a multi-part feature, "100–450" otherwise.
export function featureCoords(f: Feature): string {
  return featureSpans(f)
    .map(([s, e]) => `${s}–${e}`)
    .join(", ");
}
