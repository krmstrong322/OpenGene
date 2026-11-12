import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { fromSpan, rangeLabel, toSpan } from "../../lib/coords";
import { TYPE_COLORS, featureCoords } from "../../lib/types";
import type { Feature, FeatureType, PlasmidRecord } from "../../lib/types";
import { typeOptions, useCommand } from "./shared";
import type { Props } from "./shared";

export function FeaturesTab({
  record,
  selection,
  onRecordChange,
  onSelectFeature,
  onError,
  onInfo,
  command,
  onCommandDone,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [annotating, setAnnotating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FeatureType>("misc_feature");
  // The Start/End fields hold what the user reads: 1-based, inclusive. They
  // follow the selection, so "select a range, name it, add" needs no typing.
  const [selStart, setSelStart] = useState(1);
  const [selEnd, setSelEnd] = useState(1);
  useEffect(() => {
    if (!selection || selection.start === selection.end) return;
    const lo = selection.wrap ? selection.start : Math.min(selection.start, selection.end);
    const hi = selection.wrap ? selection.end : Math.max(selection.start, selection.end);
    const ui = fromSpan(lo, hi, record.length);
    setSelStart(ui.first);
    setSelEnd(ui.last);
  }, [selection, record.length]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useCommand(command, onCommandDone, (c) => {
    if (c.kind === "new-feature") {
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (c.kind === "edit-feature") {
      setEditingId(c.featureId);
      window.setTimeout(() => {
        listRef.current
          ?.querySelector(`[data-feature-id="${CSS.escape(c.featureId)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }, 0);
      return true;
    }
    return false;
  });

  const annotate = async () => {
    setAnnotating(true);
    try {
      const res = await api.annotate(record.id);
      onRecordChange(res.record);
      const n = res.added.length;
      onInfo(
        n
          ? `Added ${n} feature${n === 1 ? "" : "s"} from the feature library.`
          : "No new features found in the feature library.",
      );
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
        type,
        ...toSpan(selStart, selEnd),
        strand: 1,
      });
      onRecordChange(r);
      onInfo(`Added “${name}”.`);
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
        <ul className="list" ref={listRef}>
          {record.features.map((f) => (
            <li
              key={f.id}
              data-feature-id={f.id}
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
                  title={f.segments && f.segments.length > 1 ? `${f.segments.length} parts: ${featureCoords(f, record.length)}` : undefined}
                >
                  {rangeLabel(f.start, f.end, record.length)} {f.strand === 1 ? "+" : "−"}
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
            <input
              ref={nameRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name) void addManual();
              }}
            />
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
              min={1}
              max={record.length}
              onChange={(e) => setSelStart(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>End</span>
            <input
              className="input"
              type="number"
              value={selEnd}
              min={1}
              max={record.length}
              onChange={(e) => setSelEnd(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={!name} onClick={addManual}>
            Add feature
          </button>
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
  // Shown and typed 1-based, inclusive; converted back on save.
  const initial = fromSpan(feature.start, feature.end, record.length);
  const [start, setStart] = useState(initial.first);
  const [end, setEnd] = useState(initial.last);
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
        ...(multiPart ? {} : toSpan(start, end)),
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
            min={1}
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
            min={1}
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
          {feature.segments!.length} parts: {featureCoords(feature, record.length)}. Edits to the sequence move each
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
