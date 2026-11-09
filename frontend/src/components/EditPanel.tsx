import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { selectionLength } from "../lib/selection";
import { COMMON_FEATURE_TYPES, TYPE_COLORS, featureCoords } from "../lib/types";
import type {
  CutSite,
  Feature,
  FeatureType,
  FramePolicy,
  ORF,
  PlasmidRecord,
  Primer,
  PrimerAnalysis,
  Selection,
} from "../lib/types";

// Bases offered for a point mutation: the four bases, then the IUPAC
// ambiguity codes with what each stands for.
const BASE_OPTIONS: [string, string][] = [
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
function typeOptions(current?: FeatureType): FeatureType[] {
  return current && !COMMON_FEATURE_TYPES.includes(current)
    ? [current, ...COMMON_FEATURE_TYPES]
    : COMMON_FEATURE_TYPES;
}

interface Props {
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
}

type Tab = "edit" | "features" | "orfs" | "enzymes" | "primers";

const TABS: { id: Tab; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "features", label: "Features" },
  { id: "orfs", label: "ORFs" },
  { id: "enzymes", label: "Enzymes" },
  { id: "primers", label: "Primers" },
];

export function EditPanel(props: Props) {
  const { record, selection, onRecordChange, onError } = props;
  const [tab, setTab] = useState<Tab>("edit");

  return (
    <aside className="panel">
      <div className="tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === "edit" && <EditTab {...props} />}
        {tab === "features" && <FeaturesTab {...props} />}
        {tab === "orfs" && <OrfsTab record={record} onError={onError} />}
        {tab === "enzymes" && <EnzymesTab {...props} />}
        {tab === "primers" && (
          <PrimersTab record={record} selection={selection} onError={onError} onRecordChange={onRecordChange} />
        )}
      </div>
    </aside>
  );
}

function EditTab({ record, selection, onRecordChange, onError, framePolicy, setFramePolicy }: Props) {
  const [insertSeq, setInsertSeq] = useState("");
  const [insertPos, setInsertPos] = useState(0);
  const [mutBase, setMutBase] = useState("A");
  const [warnings, setWarnings] = useState<string[]>([]);

  const run = async (fn: () => Promise<PlasmidRecord>) => {
    try {
      const updated = await fn();
      setWarnings(updated.history[updated.history.length - 1]?.warnings ?? []);
      onRecordChange(updated);
    } catch (e) {
      setWarnings([]);
      onError((e as Error).message);
    }
  };

  // A wrapping selection keeps its order (start > end); the backend delete/
  // replace accept that and act on the wrapping span. Any other selection is
  // collapsed to [min, max).
  const wrapping = !!selection?.wrap;
  const spanStart = selection ? (wrapping ? selection.start : Math.min(selection.start, selection.end)) : 0;
  const spanEnd = selection ? (wrapping ? selection.end : Math.max(selection.start, selection.end)) : 0;
  const hasRange = !!selection && selection.start !== selection.end;
  const spanBp = selectionLength(selection, record.length);

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">Reading frame</h4>
        <label className="field" htmlFor="frame-policy">
          <span>Edits inside a CDS that aren’t a multiple of 3 bp</span>
          <select
            id="frame-policy"
            className="select"
            value={framePolicy}
            onChange={(e) => setFramePolicy(e.target.value as FramePolicy)}
          >
            <option value="reject">Block them (protect coding sequences)</option>
            <option value="pad">Pad inserts with N to a whole codon</option>
            <option value="allow">Allow the frameshift and log a warning</option>
          </select>
        </label>
        {warnings.length > 0 && (
          <div className="notice" role="status">
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h4 className="section-title">Insert</h4>
        <div className="row">
          <label className="field" style={{ flex: "0 0 96px" }}>
            <span>Position</span>
            <input
              className="input"
              type="number"
              value={insertPos}
              min={0}
              max={record.length}
              onChange={(e) => setInsertPos(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Sequence</span>
            <input
              className="input mono"
              value={insertSeq}
              placeholder="ACGT…"
              spellCheck={false}
              onChange={(e) => setInsertSeq(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={!insertSeq}
            onClick={() => run(() => api.insert(record.id, insertPos, insertSeq, framePolicy))}
          >
            Insert at {insertPos}
          </button>
          {selection && (
            <button
              className="btn"
              disabled={!insertSeq}
              onClick={() => run(() => api.insert(record.id, spanStart, insertSeq, framePolicy))}
            >
              {hasRange ? "At selection start" : `At cursor (${spanStart})`}
            </button>
          )}
        </div>
      </section>

      <section className="section">
        <h4 className="section-title">
          Delete / replace selection
          {hasRange && <span className="aside muted num">{spanBp} bp</span>}
        </h4>
        {hasRange ? (
          <>
            <span className="sel-chip">
              <i className="swatch" />
              {spanStart}–{spanEnd}
              {wrapping ? " (wraps origin)" : ""}
            </span>
            <div className="row">
              <button
                className="btn btn-danger"
                onClick={() => run(() => api.del(record.id, spanStart, spanEnd, framePolicy))}
              >
                Delete
              </button>
              <button
                className="btn"
                disabled={!insertSeq}
                title={insertSeq ? undefined : "Type a sequence in Insert first"}
                onClick={() => run(() => api.replace(record.id, spanStart, spanEnd, insertSeq, framePolicy))}
              >
                Replace with insert sequence
              </button>
            </div>
          </>
        ) : (
          <p className="hint">Select a range in the sequence (click, then shift-click) or click a
            feature.
          </p>
        )}
      </section>

      <section className="section">
        <h4 className="section-title">Mutate</h4>
        {selection && selection.start < record.length ? (
          <div className="row" style={{ alignItems: "center" }}>
            <span className="sel-chip">
              <i className="swatch" />
              base {selection.start} ({record.sequence[selection.start]}) →
            </span>
            <select
              className="select"
              style={{ width: 104 }}
              value={mutBase}
              onChange={(e) => setMutBase(e.target.value)}
              aria-label="New base"
            >
              {BASE_OPTIONS.map(([b, meaning]) => (
                <option key={b} value={b}>
                  {meaning ? `${b} (${meaning})` : b}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => run(() => api.mutate(record.id, selection.start, mutBase))}>
              Mutate
            </button>
          </div>
        ) : (
          <p className="hint">Click a base in the sequence to pick a position.
          </p>
        )}
      </section>

      <section className="section">
        <h4 className="section-title">Whole record</h4>
        <button className="btn" onClick={() => run(() => api.reverseComplement(record.id))}>
          Reverse-complement
        </button>
      </section>
    </div>
  );
}

function FeaturesTab({ record, selection, onRecordChange, onSelectFeature, onError }: Props) {
  const [annotating, setAnnotating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("misc_feature");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const annotate = async () => {
    setAnnotating(true);
    try {
      const res = await api.annotate(record.id);
      onRecordChange(res.record);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setAnnotating(false);
    }
  };

  const addManual = async () => {
    try {
      const r = await api.addFeature(record.id, {
        name,
        type: type as any,
        start: selStart,
        end: selEnd,
        strand: 1,
      });
      onRecordChange(r);
      setName("");
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">Annotate</h4>
        <p className="hint">Detect known parts (promoters, CDSs, origins, tags…) from the feature library.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={annotate} disabled={annotating}>
            {annotating ? "Annotating…" : "Auto-annotate"}
          </button>
        </div>
      </section>

      <section className="section">
        <h4 className="section-title">
          Features <span className="count">{record.features.length}</span>
        </h4>
        <ul className="list">
          {record.features.map((f) => (
            <li
              key={f.id}
              className={
                editingId === f.id ? "editing" : selection?.featureId === f.id ? "selected" : undefined
              }
            >
              <div className="list-row">
                <button className="feature-name" onClick={() => onSelectFeature(f.id)} title={f.name}>
                  <span className="swatch" style={{ background: f.color || TYPE_COLORS[f.type] || "#8E949C" }} />
                  <span className="feature-label">{f.name}</span>
                </button>
                {f.notes?.auto === "true" && f.notes?.identity && (
                  <span
                    className="list-sub"
                    title={`Auto-annotated · ${f.notes.identity} identity · ${f.notes.coverage} coverage`}
                  >
                    {f.notes.exact === "true" ? "exact" : `${f.notes.identity} · ${f.notes.coverage}`}
                  </span>
                )}
                <span
                  className="feature-coords"
                  title={f.segments && f.segments.length > 1 ? `${f.segments.length} parts: ${featureCoords(f)}` : undefined}
                >
                  {f.start}–{f.end} {f.strand === 1 ? "+" : "−"}
                  {f.segments && f.segments.length > 1 && ` · ${f.segments.length} parts`}
                </span>
                <span className="actions">
                  <button
                    className={editingId === f.id ? "icon-btn sm active" : "icon-btn sm"}
                    title={editingId === f.id ? "Close editor" : "Edit"}
                    aria-label={editingId === f.id ? "Close editor" : `Edit ${f.name}`}
                    onClick={() => setEditingId(editingId === f.id ? null : f.id)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-btn sm danger"
                    title="Delete"
                    aria-label={`Delete ${f.name}`}
                    onClick={async () => {
                      try {
                        onRecordChange(await api.deleteFeature(record.id, f.id));
                      } catch (e) {
                        onError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {editingId === f.id && (
                <FeatureEditor
                  // Keyed on the feature's own fields: if undo/redo (or any
                  // edit) changes this feature underneath the open editor, the
                  // key changes and the form remounts with the restored values,
                  // so a later Save can't write stale values back.
                  key={`${f.id}:${f.start}:${f.end}:${f.strand}:${f.name}:${f.type}:${f.color ?? ""}`}
                  record={record}
                  feature={f}
                  onDone={() => setEditingId(null)}
                  onRecordChange={onRecordChange}
                  onError={onError}
                />
              )}
            </li>
          ))}
          {!record.features.length && (
            <li className="empty">No features yet — try auto-annotate.</li>
          )}
        </ul>
      </section>

      <section className="section">
        <h4 className="section-title">Add feature</h4>
        <div className="row">
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Type</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {typeOptions().map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Start</span>
            <input
              className="input"
              type="number"
              value={selStart}
              onChange={(e) => setSelStart(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>End</span>
            <input
              className="input"
              type="number"
              value={selEnd}
              onChange={(e) => setSelEnd(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={!name} onClick={addManual}>
            Add feature
          </button>
          {selection && selection.start !== selection.end && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setSelStart(selection.wrap ? selection.start : Math.min(selection.start, selection.end));
                setSelEnd(selection.wrap ? selection.end : Math.max(selection.start, selection.end));
              }}
            >
              Use selection
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function FeatureEditor({
  record,
  feature,
  onDone,
  onRecordChange,
  onError,
}: {
  record: PlasmidRecord;
  feature: Feature;
  onDone: () => void;
  onRecordChange: (r: PlasmidRecord) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(feature.name);
  const [type, setType] = useState<FeatureType>(feature.type);
  const [strand, setStrand] = useState<number>(feature.strand);
  const [start, setStart] = useState(feature.start);
  const [end, setEnd] = useState(feature.end);
  // The color input needs a concrete value, so fall back to the feature's
  // effective (type) color for display. But a feature with no explicit color
  // takes its color from its type on the maps, so only send `color` when the
  // user actually picks one — otherwise renaming a CDS would pin it to the
  // fallback and override its type color.
  const [color, setColor] = useState(feature.color || TYPE_COLORS[feature.type] || "#8E949C");
  const [colorTouched, setColorTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // A multi-part feature's pieces can't be moved as one span, so its
  // coordinates are shown but not editable (the API rejects such a change).
  const multiPart = (feature.segments?.length ?? 0) > 1;

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateFeature(record.id, feature.id, {
        name,
        type,
        strand: strand as 1 | -1,
        ...(multiPart ? {} : { start, end }),
        ...(colorTouched ? { color } : {}),
      });
      onRecordChange(updated);
      onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feature-editor">
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <label className="field">
          <span>Type</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as FeatureType)}>
            {typeOptions(feature.type).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "0 0 72px" }}>
          <span>Strand</span>
          <select className="select" value={strand} onChange={(e) => setStrand(Number(e.target.value))}>
            <option value={1}>+</option>
            <option value={-1}>−</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>Start</span>
          <input
            className="input"
            type="number"
            value={start}
            min={0}
            max={record.length}
            disabled={multiPart}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>End</span>
          <input
            className="input"
            type="number"
            value={end}
            min={0}
            max={record.length}
            disabled={multiPart}
            onChange={(e) => setEnd(Number(e.target.value))}
          />
        </label>
        <label className="field" style={{ flex: "none" }}>
          <span>Color</span>
          <input
            className="input"
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setColorTouched(true);
            }}
          />
        </label>
      </div>
      {multiPart && (
        <p className="hint">
          {feature.segments!.length} parts: {featureCoords(feature)}. Edits to the sequence move each
          part; its coordinates can't be set as one span.
        </p>
      )}
      {!multiPart && record.isCircular && end < start && (
        <p className="hint">End &lt; start: this feature wraps the origin.
        </p>
      )}
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !name}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function OrfsTab({ record, onError }: { record: PlasmidRecord; onError: (m: string) => void }) {
  const [orfs, setOrfs] = useState<ORF[]>([]);
  const [minAa, setMinAa] = useState(50);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setOrfs(await api.orfs(record.id, minAa));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">Six-frame ORF search</h4>
        <div className="row">
          <label className="field">
            <span>Minimum length (aa)</span>
            <input
              className="input"
              type="number"
              value={minAa}
              onChange={(e) => setMinAa(Number(e.target.value))}
            />
          </label>
          <button className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? "Searching…" : "Find ORFs"}
          </button>
        </div>
      </section>
      <ul className="list">
        {orfs.map((o, i) => (
          <li key={i}>
            <div className="list-row">
              <span className="grow mono">
                {o.start}–{o.end}
              </span>
              <span className="list-sub">
                {o.strand === 1 ? "+" : "−"} strand · frame {o.frame}
              </span>
            </div>
            <span className="list-sub">
              {o.length_bp.toLocaleString()} bp · {o.protein.length} aa
            </span>
          </li>
        ))}
        {!orfs.length && <li className="empty">No ORFs loaded yet.</li>}
      </ul>
    </div>
  );
}

function EnzymesTab(props: Props) {
  const { record, onReloadCutSites, enzymeInput, setEnzymeInput, onError } = props;
  const [unique, setUnique] = useState<string[]>([]);
  const [digest, setDigest] = useState<{ enzyme: string; fragment_sizes: number[] }[]>([]);

  const enzymes = enzymeInput
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const loadUnique = async () => {
    try {
      setUnique(await api.uniqueCutters(record.id));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const runDigest = async () => {
    try {
      onReloadCutSites(enzymes);
      setDigest(await api.digest(record.id, enzymes));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">Restriction map</h4>
        <label className="field">
          <span>Enzymes (comma-separated)</span>
          <input
            className="input mono"
            value={enzymeInput}
            spellCheck={false}
            onChange={(e) => setEnzymeInput(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={runDigest} disabled={!enzymes.length}>
            Map &amp; digest
          </button>
          <button className="btn" onClick={loadUnique}>
            Unique cutters
          </button>
        </div>
      </section>
      {digest.length > 0 && (
        <section className="section">
          <h4 className="section-title">
            Fragments <span className="count">{digest.length}</span>
          </h4>
          <ul className="list">
            {digest.map((d) => (
              <li key={d.enzyme}>
                <div className="list-row">
                  <span className="grow">{d.enzyme}</span>
                  <span className="list-sub" title={`${d.fragment_sizes.length} fragment(s)`}>
                    {d.fragment_sizes.map((n) => n.toLocaleString()).join(" + ")} bp
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {unique.length > 0 && (
        <section className="section">
          <h4 className="section-title">
            Unique cutters <span className="count">{unique.length}</span>
          </h4>
          <div className="kv">
            {unique.map((u) => (
              <button
                key={u}
                className="tag"
                title={`Add ${u} to the map`}
                onClick={() => {
                  if (!enzymes.includes(u)) setEnzymeInput([...enzymes, u].join(", "));
                }}
              >
                {u}
              </button>
            ))}
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            Click an enzyme to add it to the map.
          </p>
        </section>
      )}
    </div>
  );
}

function PrimersTab({
  record,
  selection,
  onError,
  onRecordChange,
}: {
  record: PlasmidRecord;
  selection: Selection | null;
  onError: (m: string) => void;
  onRecordChange: (r: PlasmidRecord) => void;
}) {
  const [pair, setPair] = useState<{ forward: Primer; reverse: Primer } | null>(null);
  const [analysis, setAnalysis] = useState<PrimerAnalysis | null>(null);
  const [oligo, setOligo] = useState("");

  const selLo = selection ? Math.min(selection.start, selection.end) : 0;
  const selHi = selection ? Math.max(selection.start, selection.end) : 0;

  const design = async () => {
    try {
      const res = await api.designPrimers(record.id, selLo, selHi);
      setPair(res);
      onRecordChange(await api.getRecord(record.id));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const analyze = async () => {
    try {
      setAnalysis(await api.analyzePrimer(oligo));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">Design a pair over the selection</h4>
        {selHi > selLo ? (
          <button className="btn btn-primary" onClick={design}>
            Design primers for {selLo}–{selHi}
          </button>
        ) : (
          <p className="hint">Select a target region first.
          </p>
        )}
        {pair && (
          <ul className="list">
            {[pair.forward, pair.reverse].map((p) => (
              <li key={p.id}>
                <div className="list-row">
                  <span className="grow" style={{ fontWeight: 600 }}>
                    {p.name}
                  </span>
                  <span className="list-sub">
                    Tm {p.tm}°C · GC {p.gcContent}%
                  </span>
                </div>
                <code className="primer-seq">{p.sequence}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section">
        <h4 className="section-title">Analyze an oligo</h4>
        <div className="row">
          <label className="field">
            <span>Sequence</span>
            <input
              className="input mono"
              value={oligo}
              placeholder="ACGT…"
              spellCheck={false}
              onChange={(e) => setOligo(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={!oligo} onClick={analyze}>
            Analyze
          </button>
        </div>
        {analysis && (
          <>
            <div className="stats">
              <div className="stat">
                <b>{analysis.tm}°C</b>
                <span>Melting temp</span>
              </div>
              <div className="stat">
                <b>{analysis.gc_content}%</b>
                <span>GC content</span>
              </div>
              <div className="stat">
                <b>{analysis.length} nt</b>
                <span>Length</span>
              </div>
            </div>
            {analysis.warnings.length ? (
              <div className="notice">
                {analysis.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            ) : (
              <span className="ok-text">No hairpin or dimer issues found.</span>
            )}
          </>
        )}
      </section>
    </div>
  );
}
