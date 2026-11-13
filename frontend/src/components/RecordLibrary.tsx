import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { saveBlob } from "../lib/exports";
import { readPref, writePref } from "../lib/prefs";
import { primerBinding } from "../lib/primers";
import type { PlasmidRecord, PrimerSummary, RecordSummary } from "../lib/types";
import { Menu } from "./Menu";

interface Props {
  /** Open a record; with `primerId`, go straight to that primer in it. */
  onOpen: (r: PlasmidRecord, primerId?: string) => void;
  onNew: () => void;
  onImport: () => void;
  onError: (msg: string) => void;
}

type SortKey = "name" | "length" | "featureCount" | "updatedAt";

const EXPANDED_KEY = "opengene.libraryExpanded";

function readExpanded(): Set<string> {
  try {
    const v = JSON.parse(readPref(EXPANDED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

// The start screen: every sequence saved on this computer, as a sortable tree
// (most recently edited first by default). A sequence opens out to show the
// primers saved with it; a primer opens its sequence at its binding site.
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
  // Which sequences are opened out, remembered between visits.
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const setOpen = (ids: string[], isOpen: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (isOpen) next.add(id);
        else next.delete(id);
      }
      writePref(EXPANDED_KEY, JSON.stringify([...next]));
      return next;
    });

  const open = async (id: string, primerId?: string) => {
    if (openingId) return;
    setOpeningId(id);
    try {
      onOpen(await api.getRecord(id), primerId);
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
    const bases = q.replace(/[^a-z]/g, "");
    const matches = (p: PrimerSummary) =>
      p.name.toLowerCase().includes(q) ||
      (bases.length >= 4 && /^[acgt]+$/.test(bases) && p.sequence.toLowerCase().includes(bases));
    // A sequence is listed if its name matches, or one of its primers does —
    // in which case it is opened out to just the primers that match.
    const list = rows
      .map((r) => {
        if (!q) return { ...r, found: null as PrimerSummary[] | null };
        const found = r.primers.filter(matches);
        if (r.name.toLowerCase().includes(q)) return { ...r, found: found.length ? found : null };
        return found.length ? { ...r, found } : null;
      })
      .filter((r) => r !== null);
    const dir = sort.desc ? -1 : 1;
    list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c * dir;
    });
    return list;
  }, [rows, query, sort]);

  const primerTotal = rows?.reduce((n, r) => n + r.primers.length, 0) ?? 0;
  const withPrimers = rows?.filter((r) => r.primers.length > 0).map((r) => r.id) ?? [];
  const allOpen = withPrimers.length > 0 && withPrimers.every((id) => expanded.has(id));

  const exportPrimers = (fmt: "csv" | "fasta") =>
    api
      .exportPrimers(fmt)
      .then((blob) => saveBlob(blob, `OpenGene primers.${fmt}`))
      .catch((e) => onError((e as Error).message));

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
          {withPrimers.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setOpen(withPrimers, !allOpen)}
              title={allOpen ? "Hide every sequence's primers" : "Show every sequence's primers"}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
          <span className="spacer" />
          <div className="search">
            <Search size={13} />
            <input
              className="input"
              placeholder="Filter sequences and primers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter by sequence name, primer name or primer sequence"
            />
          </div>
          {primerTotal > 0 && (
            <Menu
              label={
                <>
                  <Download size={13} /> Primers
                </>
              }
              buttonClass="btn"
              title="Save every primer in the library to one file"
            >
              <button className="menu-item" onClick={() => exportPrimers("csv")}>
                Spreadsheet <span className="menu-sub">.csv</span>
              </button>
              <button className="menu-item" onClick={() => exportPrimers("fasta")}>
                FASTA <span className="menu-sub">.fasta</span>
              </button>
            </Menu>
          )}
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
              <th className="right hide-md">Primers</th>
              {header("updatedAt", "Modified", "hide-sm")}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown?.map((r) => {
              // While filtering, a match among the primers opens the sequence out.
              const isOpen = r.found ? true : expanded.has(r.id);
              const children = r.found ?? r.primers;
              return (
              <Fragment key={r.id}>
              <tr
                className={openingId === r.id ? "opening" : undefined}
                aria-busy={openingId === r.id}
                onClick={() => confirmId !== r.id && open(r.id)}
              >
                <td>
                  <span className="tree-cell">
                  {r.primers.length > 0 ? (
                    <button
                      className="twisty"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} the primers of ${r.name}`}
                      title={isOpen ? "Hide primers" : `Show ${r.primers.length} primer${r.primers.length === 1 ? "" : "s"}`}
                      disabled={!!r.found}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen([r.id], !isOpen);
                      }}
                    >
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  ) : (
                    <span className="twisty" aria-hidden="true" />
                  )}
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
                  </span>
                </td>
                <td className="right">{r.length.toLocaleString()} bp</td>
                <td className="muted hide-sm">
                  {r.hasTrace ? "Trace" : r.isCircular ? "Circular" : "Linear"}
                </td>
                <td className="right hide-md">{r.featureCount}</td>
                <td className="right hide-md">{r.primers.length || ""}</td>
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
              {isOpen &&
                children.map((p) => {
                  const binding = primerBinding(p, r.length);
                  return (
                    <tr key={p.id} className="child" onClick={() => open(r.id, p.id)}>
                      <td>
                        <span className="tree-cell child">
                          <button
                            className="name-cell"
                            title={`Open ${r.name} at primer ${p.name}`}
                            aria-label={`Open ${r.name} at primer ${p.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void open(r.id, p.id);
                            }}
                          >
                            <span className={`primer-arrow${p.strand === -1 ? " rev" : ""}`} aria-hidden="true" />
                            <span className="name-text">{p.name}</span>
                          </button>
                          <code className="primer-seq" title={p.sequence}>
                            {p.sequence}
                          </code>
                        </span>
                      </td>
                      <td className="right muted">{p.sequence.length} nt</td>
                      <td className="muted hide-sm">Tm {p.tm.toFixed(1)} °C</td>
                      <td className="hide-md" />
                      <td className="hide-md" />
                      <td className={binding.warn ? "warn-text hide-sm" : "muted hide-sm"} title={binding.detail}>
                        {binding.text}
                      </td>
                      <td />
                    </tr>
                  );
                })}
              </Fragment>
              );
            })}
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
          {notice ?? "Sequences and their primers are saved on this computer automatically. Drop files anywhere on this window to import them."}
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
