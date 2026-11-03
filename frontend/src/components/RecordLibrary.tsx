import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PlasmidRecord, RecordSummary } from "../lib/types";

interface Props {
  onOpen: (r: PlasmidRecord) => void;
  onDemo: () => void;
  onError: (msg: string) => void;
  status: string;
}

// The start screen: every plasmid saved on this computer, newest first.
export function RecordLibrary({ onOpen, onDemo, onError, status }: Props) {
  const [rows, setRows] = useState<RecordSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = () =>
    api
      .listRecords()
      .then(setRows)
      .catch((e) => {
        setRows([]);
        onError((e as Error).message);
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (id: string) => {
    try {
      onOpen(await api.getRecord(id));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteRecord(id);
      setConfirmId(null);
      load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="library">
      <div className="library-head">
        <h2>Your plasmids</h2>
        <button className="primary" onClick={onDemo}>
          Load demo construct
        </button>
      </div>

      {rows === null && <p className="muted">Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="library-empty">
          <p>No plasmids saved on this computer yet.</p>
          <p className="muted">
            Use <b>Import…</b> to open a GenBank, FASTA, EMBL or SnapGene file, <b>New</b> to paste a
            sequence, or load the demo. Everything you open is saved here automatically.
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="library-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button className="library-open" onClick={() => open(r.id)}>
                <span className="library-name">{r.name}</span>
                <span className="muted small">
                  {r.length.toLocaleString()} bp · {r.isCircular ? "circular" : "linear"} ·{" "}
                  {r.featureCount} feature{r.featureCount === 1 ? "" : "s"} · edited{" "}
                  {timeAgo(r.updatedAt)}
                </span>
              </button>
              {confirmId === r.id ? (
                <span className="library-confirm">
                  Delete?
                  <button className="danger" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                  <button onClick={() => setConfirmId(null)}>Keep</button>
                </span>
              ) : (
                <button className="x" title={`Delete ${r.name}`} onClick={() => setConfirmId(r.id)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="status muted small">{status}</p>
    </div>
  );
}

function timeAgo(seconds: number): string {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}
