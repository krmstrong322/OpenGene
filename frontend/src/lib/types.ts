// Mirrors the backend Pydantic models (camelCase on the wire).

export type Strand = 1 | -1;

export type FeatureType =
  | "promoter"
  | "CDS"
  | "terminator"
  | "origin"
  | "primer"
  | "tag"
  | "RBS"
  | "misc_feature";

export interface Feature {
  id: string;
  name: string;
  type: FeatureType;
  start: number; // 0-indexed, inclusive
  end: number; // 0-indexed, exclusive (end < start means it wraps the origin)
  strand: Strand;
  color?: string | null;
  notes: Record<string, string>;
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
}

// A saved plasmid in the library listing (no sequence).
export interface RecordSummary {
  id: string;
  name: string;
  length: number;
  isCircular: boolean;
  featureCount: number;
  createdAt: number; // unix seconds
  updatedAt: number; // unix seconds
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

export const TYPE_COLORS: Record<FeatureType, string> = {
  promoter: "#4CAF50",
  CDS: "#2196F3",
  terminator: "#F44336",
  origin: "#FF9800",
  primer: "#9C27B0",
  tag: "#00BCD4",
  RBS: "#8BC34A",
  misc_feature: "#9E9E9E",
};
