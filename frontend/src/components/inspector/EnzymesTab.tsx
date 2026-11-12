import type { EnzymeInfo } from "../../lib/types";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { METHYL_LABELS } from "../../lib/types";
import type { Props } from "./shared";

export function EnzymesTab(props: Props) {
  const { record, enzymeInput, setEnzymeInput, cutSites, onError } = props;
  const [catalog, setCatalog] = useState<EnzymeInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [onlyCutters, setOnlyCutters] = useState(true);
  const [digest, setDigest] = useState<{ enzyme: string; fragment_sizes: number[] }[]>([]);

  const selected = useMemo(
    () => enzymeInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    [enzymeInput],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    let cancelled = false;
    api.enzymes(record.id)
      .then((c) => !cancelled && setCatalog(c))
      .catch((e) => !cancelled && onError((e as Error).message));
    return () => { cancelled = true; };
    // Recompute cut counts whenever the sequence changes.
  }, [record.id, record.sequence, onError]);

  const setSelection = (names: string[]) => setEnzymeInput(Array.from(new Set(names)).join(", "));
  const toggle = (name: string) =>
    setSelection(selectedSet.has(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  const byName = useMemo(() => {
    const m = new Map<string, EnzymeInfo>();
    catalog?.forEach((e) => m.set(e.name, e));
    return m;
  }, [catalog]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    catalog?.forEach((e) => e.suppliers.forEach((x) => set.add(x)));
    return Array.from(set).sort();
  }, [catalog]);

  // Ready-made sets, each replacing the current selection.
  const applySet = (pick: (e: EnzymeInfo) => boolean) => {
    if (!catalog) return;
    setSelection(catalog.filter(pick).map((e) => e.name));
  };
  const SETS: [string, string, (e: EnzymeInfo) => boolean][] = [
    ["Unique cutters", "cut exactly once", (e) => e.cuts === 1],
    ["Unique + 2-cutters", "cut once or twice", (e) => e.cuts >= 1 && e.cuts <= 2],
    ["6+ bp cutters", "≥6 bp site, cut ≥1×", (e) => e.size >= 6 && e.cuts >= 1],
    ["Blunt cutters", "blunt ends, cut ≥1×", (e) => e.overhang_type === "blunt" && e.cuts >= 1],
  ];

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog
      .filter((e) => (!onlyCutters || e.cuts > 0 || selectedSet.has(e.name)))
      .filter((e) => (!supplier || e.suppliers.includes(supplier)))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.site.toLowerCase().includes(q))
      .slice(0, 300);
  }, [catalog, query, supplier, onlyCutters, selectedSet]);

  const runDigest = async () => {
    try {
      setDigest(await api.digest(record.id, selected));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Methylation from the sites currently on the map. Dam/Dcm block cleavage
  // in standard E. coli, so they drive the warnings; CpG (which matches almost
  // any site) is listed separately as it only matters for CpG-methylated DNA.
  const [blocking, cpgOnly] = useMemo(() => {
    const block = new Map<string, Set<string>>();
    const cpg = new Set<string>();
    for (const c of cutSites) {
      for (const m of c.methylation) {
        if (m === "cpg") cpg.add(c.enzyme);
        else {
          const set = block.get(c.enzyme) ?? new Set<string>();
          set.add(m);
          block.set(c.enzyme, set);
        }
      }
    }
    for (const name of block.keys()) cpg.delete(name);
    return [block, cpg] as const;
  }, [cutSites]);

  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">
          On the map <span className="count">{selected.length}</span>
        </h4>
        {selected.length ? (
          <div className="kv">
            {selected.map((name) => {
              const e = byName.get(name);
              const warned = blocking.has(name);
              return (
                <button
                  key={name}
                  className={warned ? "tag warn" : "tag"}
                  title={
                    (e ? `${e.site} · ${e.overhang_type}${e.overhang ? ` ${e.overhang}` : ""} · ${e.cuts} cut${e.cuts === 1 ? "" : "s"}` : name) +
                    (warned ? ` · overlaps ${[...blocking.get(name)!].map((k) => METHYL_LABELS[k]).join(", ")} — check sensitivity` : "") +
                    " — click to remove"
                  }
                  onClick={() => toggle(name)}
                >
                  {warned && <span className="warn-dot" aria-hidden="true">⚠</span>}
                  {name}
                  {e && <span className="tag-sub">{e.cuts}×</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="hint">No enzymes selected. Pick a set or search below.</p>
        )}
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={runDigest} disabled={!selected.length}>
            Digest
          </button>
          <button className="btn btn-sm" onClick={() => setSelection([])} disabled={!selected.length}>
            Clear
          </button>
        </div>
      </section>

      <section className="section">
        <h4 className="section-title">Enzyme sets</h4>
        <div className="kv">
          {SETS.map(([label, sub, pick]) => (
            <button key={label} className="tag" title={sub} disabled={!catalog} onClick={() => applySet(pick)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h4 className="section-title">
          Browse {catalog && <span className="count">{catalog.length}</span>}
        </h4>
        <div className="row">
          <input
            className="input"
            placeholder="Search name or site…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="row">
          <select className="select" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier">
            <option value="">Any supplier</option>
            {suppliers.map((sp) => (
              <option key={sp} value={sp}>{sp}</option>
            ))}
          </select>
          <label className="check" title="Hide enzymes that don't cut this record">
            <input type="checkbox" checked={onlyCutters} onChange={(e) => setOnlyCutters(e.target.checked)} />
            Cutters only
          </label>
        </div>
        {!catalog ? (
          <p className="hint">Loading enzymes…</p>
        ) : (
          <ul className="enz-list">
            {filtered.map((e) => {
              const warned = blocking.has(e.name) && selectedSet.has(e.name);
              return (
                <li key={e.name}>
                  <label className="enz-row">
                    <input type="checkbox" checked={selectedSet.has(e.name)} onChange={() => toggle(e.name)} />
                    <span className="enz-name">{e.name}</span>
                    <span className="enz-site mono">{e.site}</span>
                    <span className="enz-meta">
                      {e.overhang_type === "blunt" ? "blunt" : `${e.overhang_type} ${e.overhang}`}
                    </span>
                    <span className={e.cuts ? "enz-cuts" : "enz-cuts zero"}>{e.cuts}×</span>
                    {warned && <span className="warn-dot" title="May be methylation-blocked">⚠</span>}
                  </label>
                </li>
              );
            })}
            {!filtered.length && <li className="empty">No enzymes match.</li>}
          </ul>
        )}
      </section>

      {(blocking.size > 0 || cpgOnly.size > 0) && (
        <section className="section">
          <h4 className="section-title">Methylation</h4>
          {blocking.size > 0 && (
            <>
              <p className="hint">
                These recognition sites overlap a Dam/Dcm motif. Dam/Dcm methylation
                (present in standard <em>E. coli</em>) blocks <em>some</em> of these enzymes
                but not all — check the enzyme&rsquo;s methylation sensitivity:
              </p>
              <ul className="list">
                {[...blocking].map(([name, types]) => (
                  <li key={name}>
                    <div className="list-row">
                      <span className="grow">{name}</span>
                      <span className="list-sub">{[...types].map((t) => METHYL_LABELS[t]).join(", ")}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {cpgOnly.size > 0 && (
            <p className="hint" style={{ marginBottom: 0 }}>
              Overlap a CpG (CG) site — only relevant for CpG-methylated (e.g. mammalian)
              template: {[...cpgOnly].sort().join(", ")}.
            </p>
          )}
        </section>
      )}

      {digest.length > 0 && (
        <section className="section">
          <h4 className="section-title">
            Fragments <span className="count">{digest.length}</span>
          </h4>
          <ul className="list">
            {digest.map((d) => (
              <li key={d.enzyme}>
                <div className="list-row">
                  <span className="grow">{d.enzyme}</span>
                  <span className="list-sub" title={`${d.fragment_sizes.length} fragment(s)`}>
                    {d.fragment_sizes.map((n) => n.toLocaleString()).join(" + ")} bp
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
