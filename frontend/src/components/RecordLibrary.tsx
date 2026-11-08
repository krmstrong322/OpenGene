import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Clock, FlaskConical, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { api } from "../lib/api";
import type { PlasmidRecord, RecordSummary } from "../lib/types";
import { PlasmidGlyph } from "./PlasmidGlyph";

interface Props {
  onOpen: (r: PlasmidRecord) => void;
  onDemo: () => void;
  onNew: () => void;
  onImport: () => void;
  onError: (msg: string) => void;
}

// The start screen: quick actions, then every plasmid saved on this computer,
// newest first.
export function RecordLibrary({ onOpen, onDemo, onNew, onImport, onError }: Props) {
  const [rows, setRows] = useState<RecordSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows && q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  return (
    <main className="library">
      <div className="hero">
        <div>
          <div className="eyebrow">
            <FlaskConical size={14} /> Plasmid workspace
          </div>
          <h1>Your plasmids</h1>
          <p>
            Design, annotate and edit constructs. Everything you open is saved on this computer
            automatically.
          </p>
        </div>
      </div>

      <div className="quick-actions">
        <button className="quick" onClick={onImport}>
          <span className="quick-icon">
            <Upload size={18} />
          </span>
          <span>
            <span className="quick-title">Import a file</span>
            <span className="quick-desc">GenBank, FASTA, EMBL or SnapGene .dna</span>
          </span>
        </button>
        <button className="quick" onClick={onNew}>
          <span className="quick-icon green">
            <ClipboardPaste size={18} />
          </span>
          <span>
            <span className="quick-title">Paste a sequence</span>
            <span className="quick-desc">Start a new construct from raw DNA</span>
          </span>
        </button>
        <button className="quick" onClick={onDemo}>
          <span className="quick-icon amber">
            <Sparkles size={18} />
          </span>
          <span>
            <span className="quick-title">Load the demo</span>
            <span className="quick-desc">T7 · 6×His · TEV · EGFP, auto-annotated</span>
          </span>
        </button>
      </div>

      <div className="section-head">
        <h2>Saved</h2>
        {rows && rows.length > 0 && <span className="count">{rows.length}</span>}
        <span className="spacer" />
        {rows && rows.length > 0 && (
          <div className="search">
            <Search size={15} />
            <input
              className="input"
              placeholder="Search plasmids"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search plasmids"
            />
          </div>
        )}
      </div>

      {rows === null && (
        <div className="record-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="empty-state">
          <PlasmidGlyph seed="opengene" circular size={56} />
          <h3>No plasmids yet</h3>
          <p>Import a file, paste a sequence, or load the demo construct to get started.</p>
        </div>
      )}

      {shown && rows && rows.length > 0 && shown.length === 0 && (
        <div className="empty-state">
          <h3>No matches</h3>
          <p>Nothing in your library matches “{query}”.</p>
        </div>
      )}

      {shown && shown.length > 0 && (
        <ul className="record-grid">
          {shown.map((r, i) => (
            <li key={r.id} className="record-card" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button className="record-open" onClick={() => open(r.id)}>
                <span className="record-glyph">
                  <PlasmidGlyph seed={r.id} circular={r.isCircular} />
                </span>
                <span className="record-meta">
                  <span className="record-name" title={r.name}>
                    {r.name}
                  </span>
                  <span className="record-tags">
                    <span className="badge mono">{r.length.toLocaleString()} bp</span>
                    <span className="badge">{r.isCircular ? "circular" : "linear"}</span>
                    <span className="badge">
                      {r.featureCount} feature{r.featureCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="record-time">
                    <Clock size={11} /> Edited {timeAgo(r.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                className="icon-btn sm danger record-del"
                title={`Delete ${r.name}`}
                aria-label={`Delete ${r.name}`}
                onClick={() => setConfirmId(r.id)}
              >
                <Trash2 size={14} />
              </button>
              {confirmId === r.id && (
                <div className="record-confirm">
                  Delete this plasmid?
                  <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                  <button className="btn btn-sm" onClick={() => setConfirmId(null)} autoFocus>
                    Keep
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
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
