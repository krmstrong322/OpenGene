import { rangeLabel } from "../../lib/coords";
import type { ORF, PlasmidRecord } from "../../lib/types";
import { useState } from "react";
import { api } from "../../lib/api";

export function OrfsTab({ record, onError }: { record: PlasmidRecord; onError: (m: string) => void }) {
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
                {rangeLabel(o.start, o.end, record.length)}
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
