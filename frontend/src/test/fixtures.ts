// Small records for tests.
import type { Feature, PlasmidRecord } from "../lib/types";

export function feature(over: Partial<Feature> & Pick<Feature, "start" | "end">): Feature {
  return {
    id: `f${over.start}-${over.end}`,
    name: "feature",
    type: "misc_feature",
    strand: 1,
    notes: {},
    ...over,
  } as Feature;
}

export function record(sequence: string, over: Partial<PlasmidRecord> = {}): PlasmidRecord {
  return {
    id: "rec1",
    name: "test",
    isCircular: true,
    sequence,
    length: sequence.length,
    features: [],
    primers: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    hasTrace: false,
    ...over,
  } as PlasmidRecord;
}
