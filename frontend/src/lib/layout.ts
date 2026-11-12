import { useCallback, useEffect, useState } from "react";

// Which views are open and how the workspace is divided. Like the theme this
// is a per-machine convenience kept in localStorage; every access is guarded
// because storage can be unavailable.
export type ViewId = "map" | "linear" | "sequence";

export interface Layout {
  views: Record<ViewId, boolean>;
  /** Share of the workspace given to the maps (the rest goes to the sequence). */
  split: number;
}

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
const DEFAULT: Layout = { views: { map: true, linear: true, sequence: true }, split: 0.5 };
const KEY = "opengene.layout";

function read(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") {
      const views = { ...DEFAULT.views };
      for (const k of Object.keys(views) as ViewId[]) {
        if (typeof v.views?.[k] === "boolean") views[k] = v.views[k];
      }
      if (!Object.values(views).some(Boolean)) return DEFAULT;
      const split =
        typeof v.split === "number" && Number.isFinite(v.split)
          ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v.split))
          : DEFAULT.split;
      return { views, split };
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return DEFAULT;
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable */
    }
  }, [layout]);

  // Show or hide a view; the last open view stays open.
  const toggleView = useCallback((id: ViewId) => {
    setLayout((l) => {
      const views = { ...l.views, [id]: !l.views[id] };
      return Object.values(views).some(Boolean) ? { ...l, views } : l;
    });
  }, []);

  const setSplit = useCallback((split: number) => {
    setLayout((l) => ({ ...l, split: Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split)) }));
  }, []);

  return { layout, toggleView, setSplit, defaultSplit: DEFAULT.split };
}
