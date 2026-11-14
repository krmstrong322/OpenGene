import { useRef, useState } from "react";
import { ChevronDown, Copy, Download, Pencil, Trash2, Upload } from "lucide-react";
import { api } from "../../lib/api";
import { rangeLabel } from "../../lib/coords";
import { copyText } from "../../lib/edits";
import { saveBlob } from "../../lib/exports";
import { primerBinding } from "../../lib/primers";
import type { PlasmidRecord, Primer, PrimerAnalysis, Selection } from "../../lib/types";
import { Menu } from "../Menu";
import { useCommand } from "./shared";
import type { InspectorCommand } from "./shared";

// The record's saved primers: oligos that stay with the sequence. Where each
// one binds is looked up by the engine after every edit, so the list shows
// current positions — or says when a primer no longer binds.
export function PrimersTab({
  record,
  selection,
  onError,
  onInfo,
  onRecordChange,
  onSelectRange,
  command,
  onCommandDone,
}: {
  record: PlasmidRecord;
  selection: Selection | null;
  onError: (m: string) => void;
  onInfo: (m: string) => void;
  onRecordChange: (r: PlasmidRecord) => void;
  onSelectRange: (sel: Selection) => void;
  command: InspectorCommand | null;
  onCommandDone: () => void;
}) {
  const [name, setName] = useState("");
  const [sequence, setSequence] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [analysis, setAnalysis] = useState<PrimerAnalysis | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selLo = selection ? Math.min(selection.start, selection.end) : 0;
  const selHi = selection ? Math.max(selection.start, selection.end) : 0;
  const hasRange = selHi > selLo && !selection?.wrap;

  const run = async (work: () => Promise<PlasmidRecord>, done?: string) => {
    try {
      onRecordChange(await work());
      if (done) onInfo(done);
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  };

  const show = (p: Primer) => {
    if (p.bindStart === null || p.bindEnd === null) return;
    onSelectRange({ start: p.bindStart, end: p.bindEnd });
  };

  const design = (mode: "exact" | "flank" = "exact") =>
    run(async () => {
      const res = await api.designPrimers(record.id, selLo, selHi, mode);
      if (res.warnings.length) {
        onError(`Designed a pair (${res.productSize} bp), but:\n${res.warnings.join("\n")}`);
      } else {
        onInfo(`Designed and saved a primer pair (${res.productSize} bp product).`);
      }
      return res.record;
    });

  useCommand(command, onCommandDone, (c) => {
    if (c.kind === "design-primers") {
      if (hasRange) void design();
      return true;
    }
    if (c.kind === "show-primer") {
      window.setTimeout(() => {
        listRef.current
          ?.querySelector(`[data-primer-id="${CSS.escape(c.primerId)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }, 0);
      return true;
    }
    return false;
  });

  const add = async () => {
    const saved = name.trim();
    if (await run(() => api.addPrimer(record.id, saved, sequence), `Saved primer “${saved}”.`)) {
      setName("");
      setSequence("");
      setAnalysis(null);
    }
  };

  const analyze = async () => {
    try {
      setAnalysis(await api.analyzePrimer(sequence));
    } catch (e) {
      setAnalysis(null);
      onError((e as Error).message);
    }
  };

  const exportAs = (fmt: "csv" | "fasta") =>
    api
      .exportPrimers(fmt, record.id)
      .then((blob) => saveBlob(blob, `${record.name} primers.${fmt}`))
      .catch((e) => onError((e as Error).message));

  const selectedId = record.primers.find(
    (p) => selection && p.bindStart === selection.start && p.bindEnd === selection.end,
  )?.id;

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">
          Primers <span className="count">{record.primers.length}</span>
          <span className="aside">
            <button
              className={importing ? "btn btn-ghost btn-sm active" : "btn btn-ghost btn-sm"}
              onClick={() => setImporting((v) => !v)}
              aria-expanded={importing}
              title="Add primers from a file or pasted text"
            >
              <Upload size={12} /> Import
            </button>
            <Menu
              label={
                <>
                  <Download size={12} /> Export <ChevronDown size={11} />
                </>
              }
              buttonClass="btn btn-ghost btn-sm"
              title="Save this record's primers to a file"
              disabled={record.primers.length === 0}
            >
              <button className="menu-item" onClick={() => exportAs("csv")}>
                Spreadsheet <span className="menu-sub">.csv</span>
              </button>
              <button className="menu-item" onClick={() => exportAs("fasta")}>
                FASTA <span className="menu-sub">.fasta</span>
              </button>
            </Menu>
          </span>
        </h4>

        {importing && (
          <ImportPrimers
            onCancel={() => setImporting(false)}
            onImport={async (text) => {
              try {
                const res = await api.importPrimers(record.id, text);
                onRecordChange(res.record);
                const n = res.added.length;
                const added = `Imported ${n} primer${n === 1 ? "" : "s"}.`;
                if (res.skipped.length) onError(`${added} Skipped:\n${res.skipped.join("\n")}`);
                else onInfo(added);
                setImporting(false);
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          />
        )}

        {record.primers.length === 0 ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            No primers saved with this sequence yet. Add one below, import a list, or select a
            region and design a pair. Saved primers stay with the sequence and follow it through
            edits.
          </p>
        ) : (
          <ul className="list" ref={listRef}>
            {record.primers.map((p) => {
              const binding = primerBinding(p, record.length);
              return (
                <li
                  key={p.id}
                  data-primer-id={p.id}
                  className={
                    editingId === p.id ? "editing" : selectedId === p.id ? "selected" : undefined
                  }
                >
                  <div className="list-row">
                    <button
                      className="feature-name"
                      onClick={() => show(p)}
                      disabled={!binding.bound}
                      title={binding.bound ? "Show where this primer binds" : "This primer does not bind this sequence"}
                    >
                      <span className={`primer-arrow${p.strand === -1 ? " rev" : ""}`} aria-hidden="true" />
                      <span className="feature-label">{p.name}</span>
                    </button>
                    <span className={binding.warn ? "list-sub warn-text" : "list-sub"} title={binding.detail}>
                      {binding.text}
                    </span>
                    <span className="actions">
                      <button
                        className="icon-btn sm"
                        title="Copy sequence"
                        aria-label={`Copy the sequence of ${p.name}`}
                        onClick={() => void copyText(p.sequence).then(() => onInfo(`Copied ${p.name}.`))}
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        className={editingId === p.id ? "icon-btn sm active" : "icon-btn sm"}
                        title={editingId === p.id ? "Close editor" : "Edit"}
                        aria-label={editingId === p.id ? "Close editor" : `Edit ${p.name}`}
                        onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="icon-btn sm danger"
                        title="Delete"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => void run(() => api.deletePrimer(record.id, p.id))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                  {editingId === p.id ? (
                    <PrimerEditor
                      key={`${p.id}:${p.name}:${p.sequence}`}
                      primer={p}
                      onCancel={() => setEditingId(null)}
                      onSave={async (changes) => {
                        if (await run(() => api.updatePrimer(record.id, p.id, changes))) {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <>
                      <code className="primer-seq">{p.sequence}</code>
                      <span className="list-sub">
                        {p.sequence.length} nt · Tm {p.tm.toFixed(1)} °C
                        {binding.bound && p.annealTm != null && Math.abs(p.annealTm - p.tm) >= 0.5 &&
                          ` (anneal ${p.annealTm.toFixed(1)} °C)`}{" "}
                        · GC {Math.round(p.gcContent)}%
                      </span>
                      {p.warnings && p.warnings.length > 0 && (
                        <span className="list-sub warn-text" title="Flagged by primer analysis">
                          ⚠ {p.warnings.join(" · ")}
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section">
        <h4 className="section-title">Add a primer</h4>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            placeholder="e.g. pUC19-seq-F"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Sequence, 5′ → 3′</span>
          <input
            className="input mono"
            value={sequence}
            placeholder="ACGT…"
            spellCheck={false}
            onChange={(e) => {
              setSequence(e.target.value);
              setAnalysis(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && sequence.trim()) void add();
            }}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" disabled={!name.trim() || !sequence.trim()} onClick={add}>
            Save primer
          </button>
          <button
            className="btn"
            disabled={!sequence.trim()}
            onClick={analyze}
            title="Tm, GC and structure warnings for this sequence, without saving it"
          >
            Check
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

      <section className="section">
        <h4 className="section-title">Design a pair</h4>
        {hasRange ? (
          <>
            <p className="hint">
              primer3 scores Tm, GC, 3′ stability, hairpins and dimers over{" "}
              {rangeLabel(selLo, selHi, record.length)} and saves the best pair.
            </p>
            <div className="row">
              <button
                className="btn"
                onClick={() => design("exact")}
                title="The product is exactly the selected region (primers sit at its ends)"
              >
                Amplify exactly
              </button>
              <button
                className="btn"
                onClick={() => design("flank")}
                title="The product contains the region; primers may sit outside it for a better pair"
              >
                Amplify across
              </button>
            </div>
          </>
        ) : (
          <p className="hint" style={{ marginBottom: 0 }}>
            Select the region to amplify in the sequence or on a map; the pair is saved with this
            sequence.
          </p>
        )}
      </section>
    </div>
  );
}

function PrimerEditor({
  primer,
  onSave,
  onCancel,
}: {
  primer: Primer;
  onSave: (changes: { name?: string; sequence?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(primer.name);
  const [sequence, setSequence] = useState(primer.sequence);
  const changes = {
    ...(name.trim() !== primer.name ? { name: name.trim() } : {}),
    ...(sequence.trim().toUpperCase() !== primer.sequence ? { sequence } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  return (
    <div className="feature-editor">
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Sequence, 5′ → 3′</span>
        <textarea
          className="textarea mono"
          rows={2}
          value={sequence}
          spellCheck={false}
          onChange={(e) => setSequence(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={!dirty || !name.trim() || !sequence.trim()}
          onClick={() => onSave(changes)}
        >
          Save changes
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ImportPrimers({
  onImport,
  onCancel,
}: {
  onImport: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="import-box">
      <label className="field">
        <span>One primer per line as name, sequence — or FASTA</span>
        <textarea
          className="textarea mono"
          rows={4}
          value={text}
          autoFocus
          spellCheck={false}
          placeholder={"M13-F, GTAAAACGACGGCCAGT\nM13-R, CAGGAAACAGCTATGAC"}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,.fasta,.fa"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setText(await f.text());
        }}
      />
      <div className="row">
        <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onImport(text)}>
          Import
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Choose file…
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
