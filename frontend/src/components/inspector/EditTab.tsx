import { basePos, boundaryLabel, selectionRange } from "../../lib/coords";
import { useState } from "react";
import { api } from "../../lib/api";
import { selectionLength } from "../../lib/selection";
import type { FramePolicy, PlasmidRecord } from "../../lib/types";
import { BASE_OPTIONS } from "./shared";
import type { Props } from "./shared";

export function EditTab({ record, selection, onRecordChange, onError, framePolicy, setFramePolicy }: Props) {
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
      {warnings.length > 0 && (
        <section className="section">
          <div className="notice" role="status">
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h4 className="section-title">Insert</h4>
        <div className="row">
          <label className="field" style={{ flex: "0 0 96px" }}>
            <span>After base</span>
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
            {insertPos <= 0 ? "Insert at start" : `Insert after base ${insertPos.toLocaleString()}`}
          </button>
          {selection && (
            <button
              className="btn"
              disabled={!insertSeq}
              onClick={() => run(() => api.insert(record.id, spanStart, insertSeq, framePolicy))}
            >
              {hasRange
                ? "At selection start"
                : `At cursor (${boundaryLabel(spanStart, record.length, record.isCircular)})`}
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
              {selection ? selectionRange(selection, record.length) : ""}
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
              base {basePos(selection.start)} ({record.sequence[selection.start]}) →
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
      </section>
    </div>
  );
}
