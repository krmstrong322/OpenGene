import type {
  CutSite,
  Feature,
  FramePolicy,
  ORF,
  PlasmidRecord,
  Primer,
  PrimerAnalysis,
  RecordSummary,
  SelectionInfo,
} from "./types";

// In the browser / dev server the Vite proxy serves the API under /api.
// In the Electron desktop shell there is no proxy, so the preload script
// injects the backend's absolute origin (http://127.0.0.1:<port>) as
// window.__OPENGENE_API_BASE__.
declare global {
  interface Window {
    __OPENGENE_API_BASE__?: string;
  }
}

const BASE =
  (typeof window !== "undefined" && window.__OPENGENE_API_BASE__) || "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  health: () => req<{ status: string; version: string }>("/health"),

  createRecord: (name: string, sequence: string, isCircular: boolean) =>
    req<PlasmidRecord>("/records", {
      method: "POST",
      body: JSON.stringify({ name, sequence, isCircular }),
    }),

  listRecords: () => req<RecordSummary[]>("/records"),
  // Add back any bundled sample plasmid that isn't in the library.
  restoreSamples: () =>
    req<{ added: RecordSummary[] }>("/samples/restore", { method: "POST" }),
  getRecord: (id: string) => req<PlasmidRecord>(`/records/${id}`),
  deleteRecord: (id: string) =>
    req<{ deleted: string }>(`/records/${id}`, { method: "DELETE" }),

  importFile: async (file: File): Promise<PlasmidRecord> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/records/import`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(body.detail ?? "import failed");
    }
    return res.json();
  },

  exportUrl: (id: string, fmt: string) => `${BASE}/records/${id}/export?fmt=${fmt}`,

  insert: (id: string, position: number, sequence: string, framePolicy: FramePolicy = "reject") =>
    req<PlasmidRecord>(`/records/${id}/insert`, {
      method: "POST",
      body: JSON.stringify({ position, sequence, frame_policy: framePolicy }),
    }),

  del: (id: string, start: number, end: number, framePolicy: FramePolicy = "reject") =>
    req<PlasmidRecord>(`/records/${id}/delete`, {
      method: "POST",
      body: JSON.stringify({ start, end, frame_policy: framePolicy }),
    }),

  mutate: (id: string, position: number, base: string) =>
    req<PlasmidRecord>(`/records/${id}/mutate`, {
      method: "POST",
      body: JSON.stringify({ position, base }),
    }),

  replace: (
    id: string,
    start: number,
    end: number,
    sequence: string,
    framePolicy: FramePolicy = "reject",
  ) =>
    req<PlasmidRecord>(`/records/${id}/replace`, {
      method: "POST",
      body: JSON.stringify({ start, end, sequence, frame_policy: framePolicy }),
    }),

  reverseComplement: (id: string) =>
    req<PlasmidRecord>(`/records/${id}/reverse_complement`, { method: "POST" }),

  undo: (id: string) => req<PlasmidRecord>(`/records/${id}/undo`, { method: "POST" }),
  redo: (id: string) => req<PlasmidRecord>(`/records/${id}/redo`, { method: "POST" }),

  selectionInfo: (id: string, start: number, end: number, featureId?: string) =>
    req<SelectionInfo>(
      `/records/${id}/selection?start=${start}&end=${end}` +
        (featureId ? `&feature_id=${encodeURIComponent(featureId)}` : ""),
    ),

  orfs: (id: string, minAa = 30) => req<ORF[]>(`/records/${id}/orfs?min_aa=${minAa}`),

  cutSites: (id: string, enzymes?: string[]) =>
    req<CutSite[]>(
      `/records/${id}/cut_sites${enzymes?.length ? `?enzymes=${enzymes.join(",")}` : ""}`,
    ),

  digest: (id: string, enzymes: string[]) =>
    req<{ enzyme: string; cut_positions: number[]; fragment_sizes: number[] }[]>(
      `/records/${id}/digest`,
      { method: "POST", body: JSON.stringify({ enzymes }) },
    ),

  uniqueCutters: (id: string) => req<string[]>(`/records/${id}/unique_cutters`),

  analyzePrimer: (sequence: string, targetTm = 60) =>
    req<PrimerAnalysis>("/primers/analyze", {
      method: "POST",
      body: JSON.stringify({ sequence, target_tm: targetTm }),
    }),

  designPrimers: (id: string, regionStart: number, regionEnd: number, targetTm = 60) =>
    req<{ forward: Primer; reverse: Primer }>(`/records/${id}/design_primers`, {
      method: "POST",
      body: JSON.stringify({
        region_start: regionStart,
        region_end: regionEnd,
        target_tm: targetTm,
      }),
    }),

  annotate: (
    id: string,
    opts: { replaceExisting?: boolean; minIdentity?: number; minCoverage?: number } = {},
  ) =>
    req<{ added: Feature[]; record: PlasmidRecord }>(`/records/${id}/annotate`, {
      method: "POST",
      // Only send thresholds the caller set, so the backend defaults apply
      // otherwise (and don't drift from a hardcoded number here).
      body: JSON.stringify({
        replace_existing: opts.replaceExisting ?? false,
        ...(opts.minIdentity !== undefined ? { min_identity: opts.minIdentity } : {}),
        ...(opts.minCoverage !== undefined ? { min_coverage: opts.minCoverage } : {}),
      }),
    }),

  addFeature: (id: string, feature: Omit<Feature, "id" | "notes"> & { notes?: Record<string, string> }) =>
    req<PlasmidRecord>(`/records/${id}/features`, {
      method: "POST",
      body: JSON.stringify(feature),
    }),

  updateFeature: (
    id: string,
    featureId: string,
    patch: Partial<Pick<Feature, "name" | "type" | "start" | "end" | "strand" | "color">>,
  ) =>
    req<PlasmidRecord>(`/records/${id}/features/${featureId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteFeature: (id: string, featureId: string) =>
    req<PlasmidRecord>(`/records/${id}/features/${featureId}`, { method: "DELETE" }),

  featureLibrary: () =>
    req<{ name: string; type: string; length: number; source: string }[]>("/feature_library"),
};
