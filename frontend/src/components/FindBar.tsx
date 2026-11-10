import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { api } from "../lib/api";
import type { Feature, PlasmidRecord, SearchHit, Selection } from "../lib/types";

type Mode = "dna" | "protein" | "features";

const MODES: [Mode, string][] = [
  ["dna", "DNA"],
  ["protein", "Protein"],
  ["features", "Features"],
];

const PLACEHOLDER: Record<Mode, string> = {
  dna: "e.g. GAATTC or GGNCC",
  protein: "e.g. MVSKGEE (X = any)",
  features: "name or type",
};

interface Props {
  record: PlasmidRecord;
  focusToken: number; // bump to focus the query field
  onClose: () => void;
  onHits: (hits: SearchHit[], current: number) => void;
  onSelect: (sel: Selection) => void;
  onSelectFeature: (f: Feature) => void;
}

// Feature- and primer-name matches, found locally (no sequence involved).
function nameHits(record: PlasmidRecord, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const f of record.features) {
    if (f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)) {
      hits.push({ start: f.start, end: f.end, strand: f.strand, mismatches: 0, featureId: f.id, label: f.name });
    }
  }
  for (const p of record.primers) {
    if (p.name.toLowerCase().includes(q)) {
      hits.push({ start: p.bindStart, end: p.bindEnd, strand: p.strand, mismatches: 0, label: `primer ${p.name}` });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export function FindBar({ record, focusToken, onClose, onHits, onSelect, onSelectFeature }: Props) {
  const [mode, setMode] = useState<Mode>("dna");
  const [query, setQuery] = useState("");
  const [mismatches, setMismatches] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [goTo, setGoTo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // The query the current hits belong to. A re-run for the same query (the
  // sequence was edited) refreshes the highlights without moving the
  // selection; a new query jumps to its first hit.
  const lastKey = useRef("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const show = (list: SearchHit[], i: number) => {
    setCurrent(i);
    onHits(list, i);
    const h = list[i];
    if (!h) return;
    const f = h.featureId ? record.features.find((x) => x.id === h.featureId) : undefined;
    if (f) onSelectFeature(f);
    else onSelect({ start: h.start, end: h.end, wrap: record.isCircular && h.end < h.start });
  };

  const landed = (list: SearchHit[], key: string) => {
    if (key === lastKey.current) {
      const i = list.length ? Math.min(Math.max(current, 0), list.length - 1) : -1;
      setCurrent(i);
      onHits(list, i);
    } else {
      lastKey.current = key;
      show(list, list.length ? 0 : -1);
    }
  };

  // Search as the query changes (debounced), and again whenever the sequence
  // does, so hits never point at stale coordinates.
  useEffect(() => {
    setError(null);
    const key = `${mode}|${query.trim()}|${mode === "dna" ? mismatches : 0}`;
    if (!query.trim()) {
      lastKey.current = "";
      setHits([]);
      setTruncated(false);
      setCurrent(-1);
      onHits([], -1);
      return;
    }
    if (mode === "features") {
      const list = nameHits(record, query);
      setHits(list);
      setTruncated(false);
      landed(list, key);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setBusy(true);
      api
        .search(record.id, query, mode, mode === "dna" ? mismatches : 0)
        .then((res) => {
          if (cancelled) return;
          setHits(res.hits);
          setTruncated(res.truncated);
          landed(res.hits, key);
        })
        .catch((e) => {
          if (cancelled) return;
          lastKey.current = "";
          setHits([]);
          setCurrent(-1);
          onHits([], -1);
          setError((e as Error).message);
        })
        .finally(() => !cancelled && setBusy(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, mismatches, record.id, record.sequence, record.features, record.primers]);

  const step = (d: number) => {
    if (!hits.length) return;
    show(hits, (current + d + hits.length) % hits.length);
  };

  const close = () => {
    onHits([], -1);
    onClose();
  };

  const jump = () => {
    const p = Number(goTo.replace(/[,\s]/g, ""));
    if (!Number.isFinite(p)) return;
    const pos = Math.max(0, Math.min(record.length, Math.round(p)));
    onSelect({ start: pos, end: pos });
  };

  const h = hits[current];
  const detail = h
    ? [
        h.mismatches ? `${h.mismatches} mismatch${h.mismatches > 1 ? "es" : ""}` : "",
        h.strand === -1 ? "− strand" : "",
        h.feature ? `in ${h.feature}` : "",
        h.label ?? "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="find-bar" role="search">
      <div className="seg" role="radiogroup" aria-label="Search for">
        {MODES.map(([m, label]) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? "seg-btn on" : "seg-btn"}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        className={`input${mode === "features" ? "" : " mono"} find-input`}
        value={query}
        placeholder={PLACEHOLDER[mode]}
        spellCheck={false}
        aria-label="Find"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      {mode === "dna" && (
        <label className="check" title="Allowed mismatches">
          <select
            className="select narrow"
            value={mismatches}
            onChange={(e) => setMismatches(Number(e.target.value))}
            aria-label="Allowed mismatches"
          >
            {[0, 1, 2, 3].map((k) => (
              <option key={k} value={k}>
                {k === 0 ? "Exact" : `≤ ${k} mismatch${k > 1 ? "es" : ""}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="find-count num" aria-live="polite">
        {error ? (
          <span className="find-error">{error}</span>
        ) : busy ? (
          "…"
        ) : query.trim() ? (
          hits.length ? (
            `${current + 1} of ${hits.length}${truncated ? "+" : ""}`
          ) : (
            "No matches"
          )
        ) : (
          ""
        )}
      </span>
      {detail && <span className="find-detail muted">{detail}</span>}
      <button className="icon-btn sm" onClick={() => step(-1)} disabled={!hits.length} title="Previous (Shift+Enter)" aria-label="Previous match">
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn sm" onClick={() => step(1)} disabled={!hits.length} title="Next (Enter)" aria-label="Next match">
        <ChevronDown size={14} />
      </button>
      <span className="spacer" />
      <label className="check">
        Go to
        <input
          className="input narrow num"
          value={goTo}
          inputMode="numeric"
          placeholder="bp"
          aria-label="Go to position"
          onChange={(e) => setGoTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              jump();
            }
          }}
        />
      </label>
      <button className="icon-btn sm" onClick={close} title="Close (Esc)" aria-label="Close find">
        <X size={14} />
      </button>
    </div>
  );
}
