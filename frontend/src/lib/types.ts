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
export interface Selection {
  start: number;
  end: number;
  featureId?: string;
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
