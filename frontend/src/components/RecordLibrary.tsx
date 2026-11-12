import { useEffect, useMemo, useState } from "react";
import { Copy, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { PlasmidRecord, RecordSummary } from "../lib/types";

interface Props {
  onOpen: (r: PlasmidRecord) => void;
  onNew: () => void;
  onImport: () => void;
  onError: (msg: string) => void;
}

type SortKey = "name" | "length" | "featureCount" | "updatedAt";

// The start screen: every plasmid saved on this computer, as a sortable table
// (most recently edited first by default).
export function RecordLibrary({ onOpen, onNew, onImport, onError }: Props) {
  const [rows, setRows] = useState<RecordSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  const [openingId, setOpeningId] = useState<string | null>(null);
  const open = async (id: string) => {
    if (openingId) return;
    setOpeningId(id);
    try {
      onOpen(await api.getRecord(id));
    } catch (e) {
      setOpeningId(null);
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

  const duplicate = async (id: string) => {
    try {
      const copy = await api.duplicateRecord(id);
      setNotice(`Added “${copy.name}”.`);
      load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const restoreSamples = async () => {
    setRestoring(true);
    try {
      const { added } = await api.restoreSamples();
      setNotice(
        added.length
          ? `Added ${added.length} sample plasmid${added.length === 1 ? "" : "s"}.`
          : "All sample plasmids are already in your library.",
      );
      load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setRestoring(false);
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
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}
    >
      <button
        className="sort-btn"
        title={`Sort by ${label.toLowerCase()}`}
        onClick={() =>
          setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }))
        }
      >
        {label}
        <span className="arrow" aria-hidden="true">
          {sort.key === key ? (sort.desc ? "↓" : "↑") : ""}
        </span>
      </button>
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
          <button
            className="btn"
            onClick={restoreSamples}
            disabled={restoring}
            title="Add back any of the bundled sample plasmids that aren't in your library"
          >
            {restoring ? "Adding…" : "Add samples"}
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
              <tr
                key={r.id}
                className={openingId === r.id ? "opening" : undefined}
                aria-busy={openingId === r.id}
                onClick={() => confirmId !== r.id && open(r.id)}
              >
                <td>
                  {/* A real button, so a record can be reached and opened from the keyboard. */}
                  <button
                    className="name-cell"
                    title={`Open ${r.name}`}
                    aria-label={`Open ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void open(r.id);
                    }}
                  >
                    <TopologyIcon circular={r.isCircular} />
                    <span className="name-text">{r.name}</span>
                    {openingId === r.id && <span className="muted opening-note">Opening…</span>}
                  </button>
                </td>
                <td className="right">{r.length.toLocaleString()} bp</td>
                <td className="muted hide-sm">
                  {r.hasTrace ? "Trace" : r.isCircular ? "Circular" : "Linear"}
                </td>
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
                    <>
                    <button
                      className="icon-btn sm"
                      title={`Duplicate ${r.name}`}
                      aria-label={`Duplicate ${r.name}`}
                      onClick={() => duplicate(r.id)}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      className="icon-btn sm danger"
                      title={`Delete ${r.name}`}
                      aria-label={`Delete ${r.name}`}
                      onClick={() => setConfirmId(r.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                    </>
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
            Drop GenBank, FASTA, EMBL or SnapGene files anywhere on this window, paste a sequence, or use{" "}
            <b>Add samples</b> for a set of reference plasmids to explore.
          </div>
        )}
        {rows !== null && rows.length > 0 && shown?.length === 0 && (
          <div className="table-empty">No plasmids match “{query}”.</div>
        )}

        <p className="library-foot">
          {notice ?? "Plasmids are saved on this computer automatically. Drop files anywhere on this window to import them."}
        </p>
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
