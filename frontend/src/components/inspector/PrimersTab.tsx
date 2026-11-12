import { rangeLabel } from "../../lib/coords";
import { useState } from "react";
import { api } from "../../lib/api";
import type { PlasmidRecord, Primer, PrimerAnalysis, Selection } from "../../lib/types";
import { useCommand } from "./shared";
import type { InspectorCommand } from "./shared";

export function PrimersTab({
  record,
  selection,
  onError,
  onRecordChange,
  command,
  onCommandDone,
}: {
  record: PlasmidRecord;
  selection: Selection | null;
  onError: (m: string) => void;
  onRecordChange: (r: PlasmidRecord) => void;
  command: InspectorCommand | null;
  onCommandDone: () => void;
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

  useCommand(command, onCommandDone, (c) => {
    if (c.kind !== "design-primers") return false;
    if (selHi > selLo) void design();
    return true;
  });

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
            Design primers for {rangeLabel(selLo, selHi, record.length)}
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
