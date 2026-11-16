import type {
  CutSite,
  EnzymeInfo,
  Feature,
  FramePolicy,
  ORF,
  PlasmidRecord,
  Primer,
  PrimerAnalysis,
  RecordSummary,
  SearchHit,
  SelectionInfo,
  TraceData,
} from "./types";

// In the browser / dev server the Vite proxy serves the API under /api.
// In the Electron desktop shell there is no proxy, so the preload script
// injects the backend's absolute origin (http://127.0.0.1:<port>) as
// window.__OPENGENE_API_BASE__, together with the access token the engine was
// started with for this launch (window.__OPENGENE_API_TOKEN__). The engine
// refuses requests without it, so nothing else on the computer — a web page
// in the user's browser, say — can reach the library.
declare global {
  interface Window {
    __OPENGENE_API_BASE__?: string;
    __OPENGENE_API_TOKEN__?: string;
  }
}

const BASE =
  (typeof window !== "undefined" && window.__OPENGENE_API_BASE__) || "/api";
const TOKEN = (typeof window !== "undefined" && window.__OPENGENE_API_TOKEN__) || "";

// Headers every request carries.
function auth(extra: Record<string, string> = {}): Record<string, string> {
  return TOKEN ? { ...extra, "X-OpenGene-Token": TOKEN } : extra;
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.detail ?? (res.statusText || fallback));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: auth({ "Content-Type": "application/json" }),
    ...init,
  });
  if (!res.ok) throw await failure(res, "request failed");
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
  // Rename a record and/or change its topology (undoable).
  updateRecord: (id: string, changes: { name?: string; isCircular?: boolean }) =>
    req<PlasmidRecord>(`/records/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  duplicateRecord: (id: string) =>
    req<PlasmidRecord>(`/records/${id}/duplicate`, { method: "POST" }),
  deleteRecord: (id: string) =>
    req<{ deleted: string }>(`/records/${id}`, { method: "DELETE" }),

  importFile: async (file: File): Promise<PlasmidRecord> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/records/import`, {
      method: "POST",
      headers: auth(),
      body: form,
    });
    if (!res.ok) throw await failure(res, "import failed");
    return res.json();
  },

  // The record written out in `fmt` (see lib/exports.ts for saving it).
  exportFile: async (id: string, fmt: string): Promise<Blob> => {
    const res = await fetch(`${BASE}/records/${id}/export?fmt=${encodeURIComponent(fmt)}`, {
      headers: auth(),
    });
    if (!res.ok) throw await failure(res, "export failed");
    return res.blob();
  },

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

  search: (id: string, query: string, kind: "dna" | "protein", mismatches = 0) =>
    req<{ hits: SearchHit[]; truncated: boolean }>(
      `/records/${id}/search?query=${encodeURIComponent(query)}&kind=${kind}&mismatches=${mismatches}`,
    ),

  trace: (id: string) => req<TraceData>(`/records/${id}/trace`),

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

  enzymes: (id: string) => req<EnzymeInfo[]>(`/records/${id}/enzymes`),

  analyzePrimer: (sequence: string, targetTm = 60) =>
    req<PrimerAnalysis>("/primers/analyze", {
      method: "POST",
      body: JSON.stringify({ sequence, target_tm: targetTm }),
    }),

  designPrimers: (
    id: string,
    regionStart: number,
    regionEnd: number,
    mode: "exact" | "flank" = "exact",
    targetTm = 60,
  ) =>
    req<{
      forward: Primer;
      reverse: Primer;
      productSize: number;
      warnings: string[];
      record: PlasmidRecord;
    }>(`/records/${id}/design_primers`, {
      method: "POST",
      body: JSON.stringify({
        region_start: regionStart,
        region_end: regionEnd,
        target_tm: targetTm,
        mode,
      }),
    }),

  // Saved primers: oligos kept with a record.
  addPrimer: (id: string, name: string, sequence: string) =>
    req<PlasmidRecord>(`/records/${id}/primers`, {
      method: "POST",
      body: JSON.stringify({ name, sequence }),
    }),
  updatePrimer: (id: string, primerId: string, changes: { name?: string; sequence?: string }) =>
    req<PlasmidRecord>(`/records/${id}/primers/${primerId}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  deletePrimer: (id: string, primerId: string) =>
    req<PlasmidRecord>(`/records/${id}/primers/${primerId}`, { method: "DELETE" }),
  // `text` is FASTA or one "name, sequence" per line.
  importPrimers: (id: string, text: string) =>
    req<{ added: string[]; skipped: string[]; record: PlasmidRecord }>(
      `/records/${id}/primers/import`,
      { method: "POST", body: JSON.stringify({ text }) },
    ),
  // One record's primers, or (without an id) every primer in the library.
  exportPrimers: async (fmt: "csv" | "fasta", id?: string): Promise<Blob> => {
    const path = id ? `/records/${id}/primers/export` : "/primers/export";
    const res = await fetch(`${BASE}${path}?fmt=${fmt}`, { headers: auth() });
    if (!res.ok) throw await failure(res, "export failed");
    return res.blob();
  },

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
