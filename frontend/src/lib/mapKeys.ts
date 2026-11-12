import type { KeyboardEvent } from "react";
import type { Feature, Selection } from "./types";

// Keyboard control shared by the two maps. A map is one tab stop; with it
// focused the arrow keys step through the features (in sequence order), Enter
// or the menu key opens the selected feature's menu, and + / − / 0 zoom.
export function mapKeyHandler(opts: {
  features: Feature[];
  selection: Selection | null;
  onSelectFeature: (f: Feature) => void;
  onFeatureMenu?: (x: number, y: number, f: Feature) => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}) {
  return (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { features, selection } = opts;
    const ordered = [...features].sort((a, b) => a.start - b.start || a.end - b.end);
    const at = ordered.findIndex((f) => f.id === selection?.featureId);
    const go = (i: number) => {
      if (!ordered.length) return;
      e.preventDefault();
      opts.onSelectFeature(ordered[(i + ordered.length) % ordered.length]);
    };
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        return go(at + 1);
      case "ArrowLeft":
      case "ArrowUp":
        return go(at < 0 ? -1 : at - 1);
      case "Home":
        return go(0);
      case "End":
        return go(-1);
      case "Enter":
      case " ":
      case "ContextMenu":
      case "F10": {
        if (e.key === "F10" && !e.shiftKey) return;
        const f = ordered[at];
        if (!f || !opts.onFeatureMenu) return;
        e.preventDefault();
        // Open the menu on the feature itself, or mid-map if it is off screen.
        const el = e.currentTarget.querySelector(`[data-feature-id="${CSS.escape(f.id)}"]`);
        const r = (el ?? e.currentTarget).getBoundingClientRect();
        const box = e.currentTarget.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, box.left + 8), box.right - 8);
        const y = Math.min(Math.max(r.top + r.height / 2, box.top + 8), box.bottom - 8);
        opts.onFeatureMenu(x, y, f);
        return;
      }
      case "+":
      case "=":
        e.preventDefault();
        return opts.zoomBy(1.5);
      case "-":
      case "_":
        e.preventDefault();
        return opts.zoomBy(1 / 1.5);
      case "0":
        e.preventDefault();
        return opts.resetZoom();
    }
  };
}

export const MAP_KEYS_HINT =
  "Arrow keys step through features, Enter opens a feature's menu, plus and minus zoom.";
