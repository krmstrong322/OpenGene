import { useState } from "react";
import { api } from "../lib/api";
import type { CutSite, ORF, PlasmidRecord, Primer, Selection } from "../lib/types";

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
}

type Tab = "edit" | "features" | "orfs" | "enzymes" | "primers";

export function EditPanel(props: Props) {
  const { record, selection, onRecordChange, onError } = props;
  const [tab, setTab] = useState<Tab>("edit");

  return (
    <div className="panel">
      <div className="tabs">
        {(["edit", "features", "orfs", "enzymes", "primers"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "tab active" : "tab"}
            onClick={() => setTab(t)}
          >
            {t}
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
    </div>
  );
}

function EditTab({ record, selection, onRecordChange, onError }: Props) {
  const [insertSeq, setInsertSeq] = useState("");
  const [insertPos, setInsertPos] = useState(0);
  const [mutBase, setMutBase] = useState("A");

  const run = async (fn: () => Promise<PlasmidRecord>) => {
    try {
      onRecordChange(await fn());
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const selLo = selection ? Math.min(selection.start, selection.end) : 0;
  const selHi = selection ? Math.max(selection.start, selection.end) : 0;
  const hasRange = selection && selHi > selLo;

  return (
    <div className="stack">
      <section>
        <h4>Insert</h4>
        <label>
          position
          <input
            type="number"
            value={insertPos}
            min={0}
            max={record.length}
            onChange={(e) => setInsertPos(Number(e.target.value))}
          />
        </label>
        <label>
          sequence
          <input
            value={insertSeq}
            placeholder="ACGT…"
            onChange={(e) => setInsertSeq(e.target.value)}
          />
        </label>
        <div className="row">
          <button
            disabled={!insertSeq}
            onClick={() => run(() => api.insert(record.id, insertPos, insertSeq))}
          >
            Insert at {insertPos}
          </button>
          {hasRange && (
            <button
              disabled={!insertSeq}
              onClick={() => run(() => api.insert(record.id, selLo, insertSeq))}
            >
              Insert at selection start
            </button>
          )}
        </div>
      </section>

      <section>
        <h4>Delete / Replace selection</h4>
        {hasRange ? (
          <>
            <p className="muted">
              {selLo}–{selHi} ({selHi - selLo} bp)
            </p>
            <div className="row">
              <button onClick={() => run(() => api.del(record.id, selLo, selHi))}>
                Delete
              </button>
              <button
                disabled={!insertSeq}
                onClick={() => run(() => api.replace(record.id, selLo, selHi, insertSeq))}
              >
                Replace with insert seq
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Select a range in the sequence view (click, then shift-click).</p>
        )}
      </section>

      <section>
        <h4>Mutate</h4>
        {selection ? (
          <div className="row">
            <span className="muted">base at {selection.start} →</span>
            <select value={mutBase} onChange={(e) => setMutBase(e.target.value)}>
              {["A", "C", "G", "T", "N"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <button onClick={() => run(() => api.mutate(record.id, selection.start, mutBase))}>
              Mutate
            </button>
          </div>
        ) : (
          <p className="muted">Click a base to pick a position.</p>
        )}
      </section>

      <section>
        <h4>Whole record</h4>
        <button onClick={() => run(() => api.reverseComplement(record.id))}>
          Reverse-complement
        </button>
      </section>
    </div>
  );
}

function FeaturesTab({ record, onRecordChange, onSelectFeature, onError }: Props) {
  const [annotating, setAnnotating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("misc_feature");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);

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
      <button onClick={annotate} disabled={annotating}>
        {annotating ? "Annotating…" : "Auto-annotate from library"}
      </button>

      <section>
        <h4>Add feature</h4>
        <label>
          name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {["promoter", "CDS", "terminator", "origin", "tag", "RBS", "misc_feature"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            start
            <input type="number" value={selStart} onChange={(e) => setSelStart(Number(e.target.value))} />
          </label>
          <label>
            end
            <input type="number" value={selEnd} onChange={(e) => setSelEnd(Number(e.target.value))} />
          </label>
        </div>
        <button disabled={!name} onClick={addManual}>
          Add
        </button>
      </section>

      <section>
        <h4>Features ({record.features.length})</h4>
        <ul className="feature-list">
          {record.features.map((f) => (
            <li key={f.id}>
              <button className="link" onClick={() => onSelectFeature(f.id)}>
                <span className="swatch" style={{ background: f.color || "#9E9E9E" }} />
                {f.name}
              </button>
              <span className="muted">
                {f.start}–{f.end} {f.strand === 1 ? "+" : "−"}
              </span>
              <button
                className="x"
                title="delete"
                onClick={async () => {
                  try {
                    onRecordChange(await api.deleteFeature(record.id, f.id));
                  } catch (e) {
                    onError((e as Error).message);
                  }
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>
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
      <div className="row">
        <label>
          min aa
          <input type="number" value={minAa} onChange={(e) => setMinAa(Number(e.target.value))} />
        </label>
        <button onClick={load} disabled={loading}>
          {loading ? "…" : "Find ORFs"}
        </button>
      </div>
      <ul className="feature-list">
        {orfs.map((o, i) => (
          <li key={i}>
            <span>
              {o.start}–{o.end} {o.strand === 1 ? "+" : "−"} f{o.frame}
            </span>
            <span className="muted">
              {o.length_bp} bp / {o.protein.length} aa
            </span>
          </li>
        ))}
        {!orfs.length && <li className="muted">No ORFs loaded.</li>}
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
      <label>
        enzymes (comma-separated)
        <input value={enzymeInput} onChange={(e) => setEnzymeInput(e.target.value)} />
      </label>
      <div className="row">
        <button onClick={runDigest} disabled={!enzymes.length}>
          Map &amp; digest
        </button>
        <button onClick={loadUnique}>Unique cutters</button>
      </div>
      {digest.length > 0 && (
        <section>
          <h4>Fragments</h4>
          <ul className="feature-list">
            {digest.map((d) => (
              <li key={d.enzyme}>
                <span>{d.enzyme}</span>
                <span className="muted">{d.fragment_sizes.join(", ")} bp</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {unique.length > 0 && (
        <section>
          <h4>Unique cutters ({unique.length})</h4>
          <p className="muted small">{unique.join(", ")}</p>
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
  const [analysis, setAnalysis] = useState<string>("");
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
      const a = await api.analyzePrimer(oligo);
      setAnalysis(
        `Tm ${a.tm}°C · GC ${a.gc_content}% · ${a.length} nt` +
          (a.warnings.length ? ` · ⚠ ${a.warnings.join("; ")}` : " · ✓"),
      );
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <section>
        <h4>Design pair over selection</h4>
        {selHi > selLo ? (
          <button onClick={design}>
            Design primers for {selLo}–{selHi}
          </button>
        ) : (
          <p className="muted">Select a target region first.</p>
        )}
        {pair && (
          <ul className="feature-list">
            {[pair.forward, pair.reverse].map((p) => (
              <li key={p.id}>
                <span>
                  {p.name}: <code>{p.sequence}</code>
                </span>
                <span className="muted">
                  Tm {p.tm}°C · GC {p.gcContent}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>Analyze oligo</h4>
        <input value={oligo} placeholder="ACGT…" onChange={(e) => setOligo(e.target.value)} />
        <button disabled={!oligo} onClick={analyze}>
          Analyze
        </button>
        {analysis && <p className="muted small">{analysis}</p>}
      </section>
    </div>
  );
}
