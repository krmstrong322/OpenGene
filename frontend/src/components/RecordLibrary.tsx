import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { PlasmidRecord, RecordSummary } from "../lib/types";

interface Props {
  onOpen: (r: PlasmidRecord) => void;
  onDemo: () => void;
  onNew: () => void;
  onImport: () => void;
  onError: (msg: string) => void;
}

type SortKey = "name" | "length" | "featureCount" | "updatedAt";

// The start screen: every plasmid saved on this computer, as a sortable table
// (most recently edited first by default).
export function RecordLibrary({ onOpen, onDemo, onNew, onImport, onError }: Props) {
  const [rows, setRows] = useState<RecordSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "updatedAt", desc: true });

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
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows];
    const dir = sort.desc ? -1 : 1;
    list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c * dir;
    });
    return list;
  }, [rows, query, sort]);

  const header = (key: SortKey, label: string, className = "") => (
    <th
      className={`sortable ${className}`}
      onClick={() =>
        setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }))
      }
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}
    >
      {label}
      <span className="arrow">{sort.key === key ? (sort.desc ? "↓" : "↑") : ""}</span>
    </th>
  );

  return (
    <main className="library">
      <div className="library-inner">
        <div className="library-bar">
          <h1>Library</h1>
          {rows && rows.length > 0 && <span className="muted">{rows.length}</span>}
          <span className="spacer" />
          <div className="search">
            <Search size={13} />
            <input
              className="input"
              placeholder="Filter by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter plasmids by name"
            />
          </div>
          <button className="btn" onClick={onDemo}>
            Open demo
          </button>
          <button className="btn" onClick={onNew}>
            New sequence
          </button>
          <button className="btn btn-primary" onClick={onImport}>
            Import…
          </button>
        </div>

        <table className="table">
          <thead>
            <tr>
              {header("name", "Name")}
              {header("length", "Length", "right")}
              <th className="hide-sm">Topology</th>
              {header("featureCount", "Features", "right hide-md")}
              {header("updatedAt", "Modified", "hide-sm")}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown?.map((r) => (
              <tr key={r.id} onClick={() => confirmId !== r.id && open(r.id)}>
                <td>
                  <span className="name-cell" title={r.name}>
                    <TopologyIcon circular={r.isCircular} />
                    {r.name}
                  </span>
                </td>
                <td className="right">{r.length.toLocaleString()} bp</td>
                <td className="muted hide-sm">{r.isCircular ? "Circular" : "Linear"}</td>
                <td className="right hide-md">{r.featureCount}</td>
                <td className="muted hide-sm" title={new Date(r.updatedAt * 1000).toLocaleString()}>
                  {formatDate(r.updatedAt)}
                </td>
                <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                  {confirmId === r.id ? (
                    <span className="confirm">
                      Delete?
                      <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>
                        Delete
                      </button>
                      <button className="btn btn-sm" onClick={() => setConfirmId(null)} autoFocus>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      className="icon-btn sm danger"
                      title={`Delete ${r.name}`}
                      aria-label={`Delete ${r.name}`}
                      onClick={() => setConfirmId(r.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows === null && <div className="table-empty">Loading…</div>}
        {rows !== null && rows.length === 0 && (
          <div className="table-empty">
            <strong>No plasmids saved yet</strong>
            Import a GenBank, FASTA, EMBL or SnapGene file, paste a sequence, or open the demo
            construct.
          </div>
        )}
        {rows !== null && rows.length > 0 && shown?.length === 0 && (
          <div className="table-empty">No plasmids match “{query}”.</div>
        )}

        <p className="library-foot">Plasmids are saved on this computer automatically.</p>
      </div>
    </main>
  );
}

function TopologyIcon({ circular }: { circular: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      {circular ? (
        <circle cx={7} cy={7} r={5} fill="none" stroke="currentColor" strokeWidth={1.4} />
      ) : (
        <path d="M2 4.5v5M2 7h10M12 4.5v5" fill="none" stroke="currentColor" strokeWidth={1.4} />
      )}
    </svg>
  );
}

function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
