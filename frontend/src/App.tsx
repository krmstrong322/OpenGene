import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ChromatogramPane } from "./components/ChromatogramPane";
import { CircularMap } from "./components/CircularMap";
import { ContextMenu, type MenuEntry } from "./components/ContextMenu";
import { EditPanel, type InspectorCommand } from "./components/EditPanel";
import { ImageMenu } from "./components/ImageMenu";
import { LinearMap } from "./components/LinearMap";
import { NewRecordDialog } from "./components/NewRecordDialog";
import { RecordLibrary } from "./components/RecordLibrary";
import { SequencePane } from "./components/SequencePane";
import { Splitter } from "./components/Splitter";
import { Toolbar } from "./components/Toolbar";
import { api } from "./lib/api";
import { basePos, boundaryLabel, selectionRange } from "./lib/coords";
import { desktop, textFieldFocused } from "./lib/desktop";
import { cleanPaste, copiedMessage, copyText, editAtSelection, editErrorMessage, pasteProblem } from "./lib/edits";
import { exportRecord } from "./lib/exports";
import { useLayout } from "./lib/layout";
import { readPref, writePref } from "./lib/prefs";
import { normalizeSpan, selectionLength, selectionSegments } from "./lib/selection";
import { reverseComplement } from "./lib/translate";
import { useTheme } from "./lib/theme";
import type { CutSite, Feature, FramePolicy, ORF, PlasmidRecord, Selection } from "./lib/types";
import { TYPE_COLORS } from "./lib/types";

// Where the cursor goes after undo/redo. If the step changed the sequence,
// the cursor lands at the end of what changed (so typing, undoing and typing
// again continues in the same place). If it didn't — a feature edit, say —
// the cursor stays where the selection started.
function cursorAfterStep(sel: Selection | null, before: string, after: string): Selection | null {
  if (before !== after) {
    const max = Math.min(before.length, after.length);
    let prefix = 0;
    while (prefix < max && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < max - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix++;
    }
    const at = after.length - suffix;
    return { start: at, end: at };
  }
  if (!sel) return null;
  const at = Math.min(sel.wrap ? sel.start : Math.min(sel.start, sel.end), after.length);
  return { start: at, end: at };
}

interface Toast {
  kind: "error" | "warning" | "info";
  text: string;
}

const LAST_RECORD_KEY = "opengene.lastRecord";
const FRAME_POLICY_KEY = "opengene.framePolicy";

// The engine's parser errors, in words a user can act on.
function importProblem(detail: string): string {
  const d = detail.replace(/^parse failed:\s*/i, "");
  if (/no records found/i.test(d)) return "no sequence found — is this a GenBank, FASTA, EMBL or SnapGene file?";
  return d;
}

const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

// Narrowest workspace (px) that still fits a map and the sequence side by side.
const SIDE_BY_SIDE_MIN = 720;

export default function App() {
  const [record, setRecord] = useState<PlasmidRecord | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cutSites, setCutSites] = useState<CutSite[]>([]);
  const [enzymeInput, setEnzymeInput] = useState("EcoRI, HindIII, BamHI, XhoI, NdeI");
  // One message at a time, bottom right. Errors stay until dismissed;
  // warnings and confirmations clear themselves.
  const [toast, setToast] = useState<Toast | null>(null);
  const setError = useCallback((text: string) => setToast({ kind: "error", text }), []);
  const warn = useCallback((text: string) => setToast({ kind: "warning", text }), []);
  const inform = useCallback((text: string) => setToast({ kind: "info", text }), []);
  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const t = window.setTimeout(() => setToast(null), toast.kind === "warning" ? 8000 : 4000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [status, setStatus] = useState<string>("connecting…");
  // Map overlay tracks shared across the circular and linear views.
  const [orfs, setOrfs] = useState<ORF[]>([]);
  const [minOrfAa, setMinOrfAa] = useState(50);
  const [showOrfs, setShowOrfs] = useState(false);
  const [showPrimers, setShowPrimers] = useState(true);
  const [showNew, setShowNew] = useState(false);
  // How edits that would break a CDS reading frame are handled; shared by the
  // Edit tab and by paste/delete in the sequence view.
  const [framePolicy, setFramePolicyState] = useState<FramePolicy>(() => {
    const saved = readPref(FRAME_POLICY_KEY);
    return saved === "reject" || saved === "pad" || saved === "allow" ? saved : "allow";
  });
  const setFramePolicy = useCallback((p: FramePolicy) => {
    setFramePolicyState(p);
    writePref(FRAME_POLICY_KEY, p);
  }, []);
  const [theme, setTheme] = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const circularRef = useRef<HTMLDivElement>(null);
  const linearRef = useRef<HTMLDivElement>(null);

  // Workspace layout: which views are open, and the maps/sequence divider.
  // The two sit side by side once the workspace is wide enough for both.
  const { layout, toggleView, setSplit, defaultSplit } = useLayout();
  const views = layout.views;
  const showMaps = views.map || views.linear;
  const mainRef = useRef<HTMLDivElement>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const hasRecord = !!record;
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => setSideBySide(el.clientWidth >= SIDE_BY_SIDE_MIN);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRecord]);

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
      const r = await api.undo(record.id);
      setRecord(r);
      setSelection((s) => cursorAfterStep(s, record.sequence, r.sequence));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [record, setError]);

  const redo = useCallback(async () => {
    if (!record?.canRedo) return;
    try {
      const r = await api.redo(record.id);
      setRecord(r);
      setSelection((s) => cursorAfterStep(s, record.sequence, r.sequence));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [record, setError]);

  // One undo/redo request can arrive twice in the desktop app: from this
  // window's own shortcut handling and from the Edit menu's key equivalent
  // (always on macOS). Whichever comes second, from the other source, within a
  // moment of the first is the same key press and is dropped.
  const lastStep = useRef({ at: 0, source: "" });
  const historyStep = useCallback(
    (direction: "undo" | "redo", source: "key" | "menu") => {
      const now = performance.now();
      const echo = lastStep.current.source !== source && now - lastStep.current.at < 250;
      if (echo) return;
      lastStep.current = { at: now, source };
      void (direction === "undo" ? undo() : redo());
    },
    [undo, redo],
  );

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
        historyStep("undo", "key");
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        historyStep("redo", "key");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyStep]);

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
    [record, setError],
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

  // ----- right-click menu (sequence view and both maps) -----
  const [menu, setMenu] = useState<{ x: number; y: number; featureId?: string } | null>(null);
  const [command, setCommand] = useState<InspectorCommand | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback(
    (x: number, y: number, f?: Feature) => {
      if (f) selectFeature(f);
      setMenu({ x, y, featureId: f?.id });
    },
    [selectFeature],
  );

  // Replace the selection with `bases` (insert at a cursor; "" deletes).
  const editSelection = async (bases: string) => {
    if (!record || !selection) return;
    try {
      const res = await editAtSelection(record, selection, bases, framePolicy);
      setRecord(res.record);
      setSelection({
        start: res.at,
        end: bases ? Math.min(res.record.length, res.at + res.inserted) : res.at,
      });
      if (res.warnings.length) warn(res.warnings.join("\n"));
    } catch (e) {
      setError(editErrorMessage(e));
    }
  };

  const pasteFromClipboard = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setError("The clipboard can't be read from this menu. Press Ctrl/⌘+V in the sequence instead.");
      return;
    }
    const bases = cleanPaste(text);
    if (!bases) return;
    const problem = pasteProblem(bases);
    if (problem) setError(problem);
    else await editSelection(bases);
  };

  const menuEntries = (): MenuEntry[] => {
    if (!record || !menu) return [];
    const n = record.length;
    const feature = menu.featureId ? record.features.find((f) => f.id === menu.featureId) : undefined;
    const bases = selectionSegments(selection, n)
      .map(([a, b]) => record.sequence.slice(a, b))
      .join("");
    const hasRange = bases.length > 0;
    const out: MenuEntry[] = [];
    if (feature) {
      out.push(
        { kind: "heading", label: feature.name },
        { label: "Edit feature…", run: () => setCommand({ kind: "edit-feature", featureId: feature.id }) },
        {
          label: "Remove feature",
          run: () =>
            void api
              .deleteFeature(record.id, feature.id)
              .then(setRecord)
              .catch((e) => setError((e as Error).message)),
        },
        { kind: "sep" },
      );
    }
    out.push(
      {
        label: "Copy",
        hint: `${MOD}C`,
        disabled: !hasRange,
        run: () => void copyText(bases).then(() => inform(copiedMessage(bases.length))),
      },
      {
        label: "Copy reverse complement",
        disabled: !hasRange,
        run: () =>
          void copyText(reverseComplement(bases)).then(() =>
            inform(copiedMessage(bases.length, "reverse complement")),
          ),
      },
      {
        label: hasRange ? "Paste over selection" : "Paste",
        hint: `${MOD}V`,
        disabled: !selection,
        run: () => void pasteFromClipboard(),
      },
      {
        label: "Delete bases",
        hint: "Del",
        danger: true,
        disabled: !hasRange,
        run: () => void editSelection(""),
      },
      { kind: "sep" },
    );
    if (!feature) {
      out.push({
        label: "New feature from selection…",
        disabled: !hasRange,
        run: () => setCommand({ kind: "new-feature" }),
      });
    }
    out.push(
      {
        label: "Design primers for selection",
        disabled: !hasRange,
        run: () => setCommand({ kind: "design-primers" }),
      },
      { kind: "sep" },
      { label: "Select all", hint: `${MOD}A`, run: () => setSelection({ start: 0, end: n }) },
    );
    return out;
  };

  // ----- opening, closing and managing records -----
  const openRecord = useCallback((r: PlasmidRecord) => {
    setSelection(null);
    setRecord(r);
    writePref(LAST_RECORD_KEY, r.id);
  }, []);

  const showLibrary = useCallback(() => {
    setRecord(null);
    setSelection(null);
    writePref(LAST_RECORD_KEY, null);
  }, []);

  // Reopen the record that was open last time, if it still exists.
  const [booting, setBooting] = useState(() => readPref(LAST_RECORD_KEY) !== null);
  useEffect(() => {
    const last = readPref(LAST_RECORD_KEY);
    if (!last) return;
    let cancelled = false;
    api
      .getRecord(last)
      .then((r) => !cancelled && openRecord(r))
      .catch(() => writePref(LAST_RECORD_KEY, null))
      .finally(() => !cancelled && setBooting(false));
    return () => {
      cancelled = true;
    };
  }, [openRecord]);

  useEffect(() => {
    document.title = record ? `${record.name} — OpenGene` : "OpenGene — Plasmid Editor";
  }, [record?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Import one or many files. A single file opens straight away; several are
  // added to the library, which is then shown.
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [importing, setImporting] = useState(false);
  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setImporting(true);
      const imported: PlasmidRecord[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          imported.push(await api.importFile(file));
        } catch (e) {
          failed.push(`${file.name}: ${importProblem((e as Error).message)}`);
        }
      }
      setImporting(false);
      if (files.length === 1 && imported.length === 1) {
        openRecord(imported[0]);
      } else if (imported.length) {
        showLibrary();
        setLibraryVersion((v) => v + 1);
      }
      if (failed.length) {
        const ok = imported.length
          ? `Imported ${imported.length} of ${files.length} files. `
          : "";
        setError(`${ok}Couldn't import:\n${failed.join("\n")}`);
      } else if (imported.length > 1) {
        inform(`Imported ${imported.length} files.`);
      }
    },
    [openRecord, showLibrary, setError, inform],
  );

  // Files dropped anywhere on the window are imported.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDropping(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      void importFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [importFiles]);

  // Rename the open record or change its topology (both undoable).
  const updateRecord = async (changes: { name?: string; isCircular?: boolean }) => {
    if (!record) return;
    try {
      const updated = await api.updateRecord(record.id, changes);
      if (changes.isCircular !== undefined) setSelection(null);
      setRecord(updated);
      const warnings = updated.history[updated.history.length - 1]?.warnings ?? [];
      if (changes.isCircular !== undefined && warnings.length) warn(warnings.join("\n"));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportAs = (format: string) => {
    if (record) exportRecord(record, format).catch((e) => setError((e as Error).message));
  };

  const duplicateOpenRecord = async () => {
    if (!record) return;
    try {
      const copy = await api.duplicateRecord(record.id);
      openRecord(copy);
      inform(`Now working on “${copy.name}”.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ----- desktop app: native menu commands and files handed to the app -----
  const runCommand = (command: string) => {
    const [name, arg] = command.split(":");
    switch (name) {
      case "new":
        setShowNew(true);
        break;
      case "library":
        showLibrary();
        break;
      case "export":
        exportAs(arg);
        break;
      case "undo":
      case "redo":
        if (textFieldFocused()) desktop?.textRole(name);
        else historyStep(name, "menu");
        break;
      case "select-all":
        if (textFieldFocused()) desktop?.textRole("selectAll");
        else if (record) setSelection({ start: 0, end: record.length });
        break;
      case "find":
        // The find bar listens for its shortcut; a menu click is the same request.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
        break;
      case "view":
        if (arg === "map" || arg === "linear" || arg === "sequence") toggleView(arg);
        break;
      case "theme":
        if (arg === "system" || arg === "light" || arg === "dark") setTheme(arg);
        break;
    }
  };
  // The subscription is made once; it always calls the latest handlers.
  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;
  const importRef = useRef(importFiles);
  importRef.current = importFiles;
  useEffect(() => {
    if (!desktop) return;
    const offCommand = desktop.onCommand((c) => commandRef.current(c));
    const offFiles = desktop.onOpenFiles((files) => {
      // Copy into a fresh buffer: what crosses the bridge may be a view.
      void importRef.current(files.map((f) => new File([new Uint8Array(f.data)], f.name)));
    });
    desktop.ready();
    return () => {
      offCommand();
      offFiles();
    };
  }, []);
  useEffect(() => {
    desktop?.setMenuState({ hasRecord });
  }, [hasRecord]);

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
        onExport={exportAs}
        onRename={(name) => void updateRecord({ name })}
        onSetCircular={(isCircular) => void updateRecord({ isCircular })}
        onDuplicate={() => void duplicateOpenRecord()}
        views={views}
        onToggleView={toggleView}
        theme={theme}
        onThemeChange={setTheme}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".gb,.gbk,.genbank,.fasta,.fa,.fna,.embl,.dna,.ab1,.abi,.scf"
        hidden
        multiple
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {booting ? (
        <main className="library" aria-busy="true" />
      ) : !record ? (
        <RecordLibrary
          key={libraryVersion}
          onOpen={openRecord}
          onNew={() => setShowNew(true)}
          onImport={openFilePicker}
          onError={setError}
        />
      ) : (
        <main className="workspace">
          <div
            className="main-pane"
            ref={mainRef}
            data-layout={sideBySide ? "columns" : "rows"}
          >
            {/* For a sequencing read the trace is the main view, so it leads. */}
            {record.hasTrace && (
              <ChromatogramPane
                record={record}
                selection={selection}
                onSelect={setSelection}
                onError={setError}
              />
            )}
            {/* Maps and sequence share the workspace: side by side when there's
                room, stacked otherwise, with a draggable divider between them. */}
            <div className="split" style={{ "--split": layout.split } as React.CSSProperties}>
              {showMaps && (
                <div className={views.sequence ? "split-maps" : "split-maps solo"}>
                  {views.map && (
                    <section className="pane map-pane">
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
                      <div className="pane-body map-fit" ref={circularRef}>
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
                          onFeatureMenu={openMenu}
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
                  )}
                  {views.linear && (
                    <section className="pane linear-pane">
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
                          onFeatureMenu={openMenu}
                        />
                      </div>
                    </section>
                  )}
                </div>
              )}
              {showMaps && views.sequence && (
                <Splitter
                  vertical={sideBySide}
                  value={layout.split}
                  onChange={setSplit}
                  onReset={() => setSplit(defaultSplit)}
                />
              )}
              {views.sequence && (
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
                    onWarning={warn}
                    onInfo={inform}
                    onMenu={openMenu}
                  />
              )}
            </div>
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
            command={command}
            onCommandDone={() => setCommand(null)}
            onInfo={inform}
            onUndo={undo}
            onRedo={redo}
          />
        </main>
      )}

      <StatusBar record={record} selection={selection} status={status} />

      {showNew && (
        <NewRecordDialog
          onClose={() => setShowNew(false)}
          onCreated={(r) => {
            setShowNew(false);
            openRecord(r);
          }}
          onError={setError}
        />
      )}

      {menu && record && (
        <ContextMenu x={menu.x} y={menu.y} entries={menuEntries()} onClose={closeMenu} />
      )}

      {(dropping || importing) && (
        <div className="drop-overlay" aria-live="polite">
          <div className="drop-card">
            <strong>{importing ? "Importing…" : "Drop files to import"}</strong>
            {!importing && <span>GenBank, FASTA, EMBL, SnapGene .dna, or Sanger traces (.ab1, .scf)</span>}
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <div className="toast-body">{toast.text}</div>
          <button className="icon-btn sm" onClick={() => setToast(null)} aria-label="Dismiss">
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
  const selectedFeature = selection?.featureId
    ? record?.features.find((f) => f.id === selection.featureId)
    : undefined;
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
          {/* Always present, so screen readers announce each new selection. */}
          <span className="item sel" aria-live="polite" aria-atomic="true">
            {selection && (
              <>
                <i className="swatch" />
                {selectedFeature ? `${selectedFeature.name} · ` : ""}
                {describeSelection(selection, record.length, record.isCircular)}
              </>
            )}
          </span>
        </>
      )}
    </footer>
  );
}

function describeSelection(sel: Selection, length: number, circular: boolean): string {
  const bp = selectionLength(sel, length);
  if (bp === 0) return `Cursor ${boundaryLabel(sel.start, length, circular)}`;
  if (bp === 1) return `Base ${basePos(Math.min(sel.start, sel.end))}`;
  return `${selectionRange(sel, length)} · ${bp.toLocaleString()} bp`;
}
