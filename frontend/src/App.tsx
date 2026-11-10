import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { CircularMap } from "./components/CircularMap";
import { EditPanel } from "./components/EditPanel";
import { ImageMenu } from "./components/ImageMenu";
import { LinearMap } from "./components/LinearMap";
import { NewRecordDialog } from "./components/NewRecordDialog";
import { RecordLibrary } from "./components/RecordLibrary";
import { SequencePane } from "./components/SequenceViewer";
import { Toolbar } from "./components/Toolbar";
import { api } from "./lib/api";
import { normalizeSpan, selectionLength } from "./lib/selection";
import { useTheme } from "./lib/theme";
import type { CutSite, Feature, FramePolicy, ORF, PlasmidRecord, Selection } from "./lib/types";
import { TYPE_COLORS } from "./lib/types";

export default function App() {
  const [record, setRecord] = useState<PlasmidRecord | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cutSites, setCutSites] = useState<CutSite[]>([]);
  const [enzymeInput, setEnzymeInput] = useState("EcoRI, HindIII, BamHI, XhoI, NdeI");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("connecting…");
  // Map overlay tracks shared across the circular and linear views.
  const [orfs, setOrfs] = useState<ORF[]>([]);
  const [minOrfAa, setMinOrfAa] = useState(50);
  const [showOrfs, setShowOrfs] = useState(false);
  const [showPrimers, setShowPrimers] = useState(true);
  const [showNew, setShowNew] = useState(false);
  // How edits that would break a CDS reading frame are handled; shared by the
  // Edit tab and by paste/delete in the sequence view.
  const [framePolicy, setFramePolicy] = useState<FramePolicy>("reject");
  const [theme, setTheme] = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const circularRef = useRef<HTMLDivElement>(null);
  const linearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setStatus(`backend ${h.version}`))
      .catch(() => setStatus("backend offline"));
  }, []);

  // Keep ORF overlay in sync with the sequence while it's shown. Clear the old
  // list immediately on any change so stale coordinates can't be clicked while
  // the refetch is in flight; the normalized results replace it when they land.
  useEffect(() => {
    setOrfs([]);
    if (!record || !showOrfs) return;
    let cancelled = false;
    const n = record.length;
    const circular = record.isCircular;
    api
      .orfs(record.id, minOrfAa)
      .then((list) => {
        if (cancelled) return;
        // Endpoints come back modulo n; normalize full-record and terminal
        // linear spans so each track draws and selects the right bases.
        setOrfs(
          list.map((o) => ({ ...o, ...normalizeSpan(o.start, o.end, n, circular, o.length_bp) })),
        );
      })
      .catch(() => !cancelled && setOrfs([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.sequence, showOrfs, minOrfAa]);

  // Primer overlay spans, with terminal linear endpoints normalized the same
  // way (the record's primers are the source of truth; the backend drops any
  // that a sequence edit would make stale).
  const displayPrimers = useMemo(() => {
    if (!record) return [];
    return record.primers.map((p) => {
      const s = normalizeSpan(p.bindStart, p.bindEnd, record.length, record.isCircular);
      return { ...p, bindStart: s.start, bindEnd: s.end };
    });
  }, [record]);

  const undo = useCallback(async () => {
    if (!record?.canUndo) return;
    try {
      setRecord(await api.undo(record.id));
      setSelection(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [record]);

  const redo = useCallback(async () => {
    if (!record?.canRedo) return;
    try {
      setRecord(await api.redo(record.id));
      setSelection(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [record]);

  // Cmd/Ctrl+Z to undo, Cmd/Ctrl+Shift+Z or Ctrl+Y to redo — but not while a
  // text field is focused, where the browser's own undo should win.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const selectFeature = useCallback(
    (f: Feature) => {
      setSelection({
        start: f.start,
        end: f.end,
        featureId: f.id,
        wrap: record?.isCircular ? f.end < f.start : false,
      });
    },
    [record?.isCircular],
  );

  // Select a span from a map overlay (primer / ORF), flagging an
  // origin-wrapping span so edits and highlights treat it correctly.
  const selectRange = useCallback(
    (sel: Selection) => {
      setSelection({
        ...sel,
        wrap: record?.isCircular ? sel.end < sel.start : false,
      });
    },
    [record?.isCircular],
  );

  // Keep a feature-anchored selection in sync with its feature. When the record
  // changes (an edit to the feature's coordinates, or undo/redo) the selection
  // follows the feature's new span, or clears if the feature was removed — so
  // the highlight and Delete/Replace never target the feature's old range.
  useEffect(() => {
    if (!record || !selection?.featureId) return;
    const f = record.features.find((x) => x.id === selection.featureId);
    if (!f) {
      setSelection(null);
    } else if (f.start !== selection.start || f.end !== selection.end) {
      setSelection({
        start: f.start,
        end: f.end,
        featureId: f.id,
        wrap: record.isCircular ? f.end < f.start : false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  const selectFeatureById = useCallback(
    (id: string) => {
      const f = record?.features.find((x) => x.id === id);
      if (f) selectFeature(f);
    },
    [record, selectFeature],
  );

  const reloadCutSites = useCallback(
    async (enzymes: string[]) => {
      if (!record) return;
      try {
        setCutSites(await api.cutSites(record.id, enzymes));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [record],
  );

  // Recompute cut sites whenever the sequence changes.
  useEffect(() => {
    if (!record) {
      setCutSites([]);
      return;
    }
    const enzymes = enzymeInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    api.cutSites(record.id, enzymes).then(setCutSites).catch(() => setCutSites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.sequence, enzymeInput]);

  const openFilePicker = () => fileRef.current?.click();

  const handleImport = async (file: File) => {
    try {
      const r = await api.importFile(file);
      setSelection(null);
      setRecord(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const showLibrary = () => {
    setRecord(null);
    setSelection(null);
  };

  // Feature types present in the record, for the map legend.
  const legend = useMemo(() => {
    if (!record) return [];
    const seen = new Map<string, string>();
    for (const f of record.features) {
      if (!seen.has(f.type)) seen.set(f.type, TYPE_COLORS[f.type] || "#8E949C");
    }
    return Array.from(seen, ([type, color]) => ({ type, color }));
  }, [record]);

  return (
    <div className="app">
      <Toolbar
        record={record}
        onShowLibrary={showLibrary}
        onUndo={undo}
        onRedo={redo}
        onNew={() => setShowNew(true)}
        onImport={openFilePicker}
        theme={theme}
        onThemeChange={setTheme}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".gb,.gbk,.genbank,.fasta,.fa,.fna,.embl,.dna"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImport(f);
          e.target.value = "";
        }}
      />

      {!record ? (
        <RecordLibrary
          onOpen={(r) => {
            setSelection(null);
            setRecord(r);
          }}
          onNew={() => setShowNew(true)}
          onImport={openFilePicker}
          onError={setError}
        />
      ) : (
        <main className="workspace">
          <div className="main-pane">
            <section className="pane">
              <div className="pane-head">
                <h3 className="pane-title">Map</h3>
                <div className="map-controls">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showPrimers}
                      onChange={(e) => setShowPrimers(e.target.checked)}
                    />
                    Primers <span className="muted num">{record.primers.length}</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showOrfs}
                      onChange={(e) => setShowOrfs(e.target.checked)}
                    />
                    ORFs {showOrfs && <span className="muted num">{orfs.length}</span>}
                  </label>
                  {showOrfs && (
                    <label className="check">
                      min aa
                      <input
                        type="number"
                        className="input narrow"
                        value={minOrfAa}
                        min={1}
                        onChange={(e) => setMinOrfAa(Math.max(1, Number(e.target.value)))}
                      />
                    </label>
                  )}
                </div>
                <span className="spacer" />
                <ImageMenu
                  getSvg={() => circularRef.current?.querySelector("svg.map-svg") ?? null}
                  fileBase={`${record.name} map`}
                  title={record.name}
                  subtitle={`${record.length.toLocaleString()} bp · ${record.isCircular ? "circular" : "linear"}`}
                  onError={setError}
                />
              </div>
              <div className="pane-body" ref={circularRef}>
                <CircularMap
                  record={record}
                  cutSites={cutSites}
                  selection={selection}
                  onSelectFeature={selectFeature}
                  onHover={setHoveredId}
                  hoveredId={hoveredId}
                  primers={showPrimers ? displayPrimers : []}
                  orfs={showOrfs ? orfs : []}
                  onSelectRange={selectRange}
                />
              </div>
              {(legend.length > 0 || cutSites.length > 0) && (
                <div className="legend">
                  {legend.map((l) => (
                    <span key={l.type}>
                      <i className="swatch" style={{ background: l.color }} />
                      {l.type}
                    </span>
                  ))}
                  {cutSites.length > 0 && (
                    <span>
                      <i className="cut-mark" /> cut site
                    </span>
                  )}
                </div>
              )}
            </section>

            <section className="pane">
              <div className="pane-head">
                <h3 className="pane-title">Linear view</h3>
                <span className="spacer" />
                <ImageMenu
                  getSvg={() => linearRef.current?.querySelector("svg.map-svg") ?? null}
                  fileBase={`${record.name} linear map`}
                  title={record.name}
                  subtitle={`${record.length.toLocaleString()} bp · ${record.isCircular ? "circular" : "linear"} · linear view`}
                  onError={setError}
                />
              </div>
              <div className="pane-body" ref={linearRef}>
                <LinearMap
                  record={record}
                  cutSites={cutSites}
                  selection={selection}
                  onSelectFeature={selectFeature}
                  onHover={setHoveredId}
                  hoveredId={hoveredId}
                  primers={showPrimers ? displayPrimers : []}
                  orfs={showOrfs ? orfs : []}
                  onSelectRange={selectRange}
                />
              </div>
            </section>

            <SequencePane
              record={record}
              selection={selection}
              onSelect={setSelection}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onSelectFeature={selectFeature}
              cutSites={cutSites}
              framePolicy={framePolicy}
              onRecordChange={setRecord}
              onError={setError}
            />
          </div>

          <EditPanel
            record={record}
            selection={selection}
            cutSites={cutSites}
            onRecordChange={setRecord}
            onSelectFeature={selectFeatureById}
            onError={setError}
            onReloadCutSites={reloadCutSites}
            enzymeInput={enzymeInput}
            setEnzymeInput={setEnzymeInput}
            framePolicy={framePolicy}
            setFramePolicy={setFramePolicy}
          />
        </main>
      )}

      <StatusBar record={record} selection={selection} status={status} />

      {showNew && (
        <NewRecordDialog
          onClose={() => setShowNew(false)}
          onCreated={(r) => {
            setShowNew(false);
            setSelection(null);
            setRecord(r);
          }}
          onError={setError}
        />
      )}

      {error && (
        <div className="toast" role="alert">
          <div className="toast-body">{error}</div>
          <button className="icon-btn sm" onClick={() => setError(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBar({
  record,
  selection,
  status,
}: {
  record: PlasmidRecord | null;
  selection: Selection | null;
  status: string;
}) {
  const gc = useMemo(() => {
    if (!record?.sequence.length) return null;
    let n = 0;
    for (const c of record.sequence) if (c === "G" || c === "C" || c === "g" || c === "c") n++;
    return (100 * n) / record.sequence.length;
  }, [record?.sequence]);
  const online = status.startsWith("backend ") && status !== "backend offline";

  return (
    <footer className="statusbar">
      <span className="item">
        <span className={online ? "dot ok" : status === "connecting…" ? "dot" : "dot bad"} />
        {online
          ? `Engine ${status.replace("backend ", "")}`
          : status === "connecting…"
            ? "Connecting…"
            : "Engine offline"}
      </span>
      {record && (
        <>
          <span className="item hide-sm">{record.length.toLocaleString()} bp</span>
          <span className="item hide-sm">
            {record.features.length} feature{record.features.length === 1 ? "" : "s"}
          </span>
          {gc !== null && <span className="item hide-sm">GC {gc.toFixed(1)}%</span>}
          <span className="spacer" />
          {selection && (
            <span className="item sel">
              <i className="swatch" />
              {describeSelection(selection, record.length)}
            </span>
          )}
        </>
      )}
    </footer>
  );
}

function describeSelection(sel: Selection, length: number): string {
  const bp = selectionLength(sel, length);
  if (bp === 0) return `Cursor ${sel.start}`;
  if (bp === 1) return `Position ${Math.min(sel.start, sel.end)}`;
  const lo = sel.wrap ? sel.start : Math.min(sel.start, sel.end);
  const hi = sel.wrap ? sel.end : Math.max(sel.start, sel.end);
  return `${lo}–${hi}${sel.wrap ? " (wraps origin)" : ""} · ${bp.toLocaleString()} bp`;
}
