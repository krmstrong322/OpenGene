// Types and small helpers shared by the inspector's tabs.
import { useEffect, useRef } from "react";
import { COMMON_FEATURE_TYPES } from "../../lib/types";
import type { CutSite, FeatureType, FramePolicy, PlasmidRecord, Selection } from "../../lib/types";

// Bases offered for a point mutation: the four bases, then the IUPAC
// ambiguity codes with what each stands for.
export const BASE_OPTIONS: [string, string][] = [
  ["A", ""],
  ["C", ""],
  ["G", ""],
  ["T", ""],
  ["R", "A/G"],
  ["Y", "C/T"],
  ["S", "G/C"],
  ["W", "A/T"],
  ["K", "G/T"],
  ["M", "A/C"],
  ["B", "not A"],
  ["D", "not C"],
  ["H", "not G"],
  ["V", "not T"],
  ["N", "any"],
];

// The common types, plus the current one if it's something else the file
// used, so an unusual GenBank key is never silently changed by the editor.
export function typeOptions(current?: FeatureType): FeatureType[] {
  return current && !COMMON_FEATURE_TYPES.includes(current)
    ? [current, ...COMMON_FEATURE_TYPES]
    : COMMON_FEATURE_TYPES;
}

export interface Props {
  record: PlasmidRecord;
  selection: Selection | null;
  cutSites: CutSite[];
  onRecordChange: (r: PlasmidRecord) => void;
  onSelectFeature: (id: string) => void;
  onError: (msg: string) => void;
  onReloadCutSites: (enzymes: string[]) => void;
  enzymeInput: string;
  setEnzymeInput: (s: string) => void;
  framePolicy: FramePolicy;
  setFramePolicy: (p: FramePolicy) => void;
  /** A request from elsewhere in the app (the right-click menu) to act here. */
  command: InspectorCommand | null;
  onCommandDone: () => void;
  /** Confirm that something worked. */
  onInfo: (msg: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export type InspectorCommand =
  | { kind: "new-feature" }
  | { kind: "edit-feature"; featureId: string }
  | { kind: "design-primers" };

// Run `handle` once for each new command. The ref survives StrictMode's
// double-invoked effects, so a command is never acted on twice.
export function useCommand(
  command: InspectorCommand | null,
  onDone: () => void,
  handle: (c: InspectorCommand) => boolean,
) {
  const seen = useRef<InspectorCommand | null>(null);
  useEffect(() => {
    if (!command || seen.current === command) return;
    if (handle(command)) {
      seen.current = command;
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);
}

// An engine message with a leading capital.
export function sentence(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
