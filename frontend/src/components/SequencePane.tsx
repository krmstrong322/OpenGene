// The sequence pane: its toolbar, the find bar, the selection read-out, and
// the sequence view itself.
import type { Options } from "../lib/seqLayout";
import { useCallback, useEffect, useState } from "react";
import { Copy, Search } from "lucide-react";
import { api } from "../lib/api";
import { FindBar } from "./FindBar";
import { boundaryLabel, selectionRange } from "../lib/coords";
import { readPref, writePref } from "../lib/prefs";
import { copiedMessage, copyText } from "../lib/edits";
import { selectionSegments } from "../lib/selection";
import { reverseComplement } from "../lib/translate";
import type { PlasmidRecord, SearchHit, Selection, SelectionInfo } from "../lib/types";
import { SequenceViewer } from "./SequenceViewer";
import type { Props } from "./SequenceViewer";

const HINT_SEEN_KEY = "opengene.seqHintSeen";

export function SequencePane(props: Props) {
  const { record, selection } = props;
  const [opts, setOpts] = useState<Options>({
    complement: true,
    translations: true,
    features: true,
    enzymes: true,
  });
  const toggle = (k: keyof Options) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const segs = selectionSegments(selection, record.length);
  const selected = segs.map(([a, b]) => record.sequence.slice(a, b)).join("");

  // Find: Ctrl/⌘+F opens the bar (or refocuses it) while a record is open.
  const [findOpen, setFindOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [hits, setHits] = useState<{ list: SearchHit[]; current: number }>({ list: [], current: -1 });
  const openFind = useCallback(() => {
    setFindOpen(true);
    setFindFocus((t) => t + 1);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFind]);

  return (
    <section className="pane seq-pane">
      <div className="pane-head">
        <h3 className="pane-title">Sequence</h3>
        <div className="map-controls">
          {(
            [
              ["complement", "Both strands"],
              ["translations", "Translations"],
              ["features", "Features"],
              ["enzymes", "Enzymes"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={opts[k]} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={openFind} title="Find a sequence, protein or feature (Ctrl/⌘+F)">
          <Search size={13} /> Find
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!selected}
          onClick={() =>
            void copyText(selected).then(() => props.onInfo?.(copiedMessage(selected.length)))
          }
          title="Copy the selected bases (Ctrl/⌘+C in the sequence)"
        >
          <Copy size={13} /> Copy
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!selected}
          onClick={() =>
            void copyText(reverseComplement(selected)).then(() =>
              props.onInfo?.(copiedMessage(selected.length, "reverse complement")),
            )
          }
          title="Copy the reverse complement of the selection"
        >
          <Copy size={13} /> Rev. comp.
        </button>
      </div>
      {findOpen && (
        <FindBar
          record={record}
          focusToken={findFocus}
          onClose={() => setFindOpen(false)}
          onHits={(list, current) => setHits({ list, current })}
          onSelect={props.onSelect}
          onSelectFeature={props.onSelectFeature}
        />
      )}
      <SelectionBar record={record} selection={selection} />
      <SequenceViewer {...props} opts={opts} hits={hits.list} currentHit={hits.current} />
    </section>
  );
}

function SelectionBar({ record, selection }: { record: PlasmidRecord; selection: Selection | null }) {
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  const [hintSeen, setHintSeen] = useState(() => readPref(HINT_SEEN_KEY) === "1");
  useEffect(() => {
    if (selection && !hintSeen) {
      writePref(HINT_SEEN_KEY, "1");
      setHintSeen(true);
    }
  }, [selection, hintSeen]);
  const segs = selectionSegments(selection, record.length);
  const hasRange = segs.length > 0;
  const start = selection?.wrap ? selection.start : Math.min(selection?.start ?? 0, selection?.end ?? 0);
  const end = selection?.wrap ? selection.end : Math.max(selection?.start ?? 0, selection?.end ?? 0);
  const featureId = selection?.featureId;

  useEffect(() => {
    setInfo(null);
    if (!hasRange) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .selectionInfo(record.id, start, end, featureId)
        .then((i) => !cancelled && setInfo(i))
        .catch(() => !cancelled && setInfo(null));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [record.id, record.sequence, hasRange, start, end, featureId]);

  if (!selection) {
    // The how-to is for newcomers: once someone has made a selection on this
    // computer it gives way to a plain "nothing selected".
    return (
      <div className="seq-info muted">
        {hintSeen
          ? "Nothing selected"
          : "Click to place the cursor, then type or paste bases. Drag to select; right-click for more."}
      </div>
    );
  }
  if (!hasRange) {
    return (
      <div className="seq-info">
        Cursor {boundaryLabel(selection.start, record.length, record.isCircular)}
      </div>
    );
  }
  const len = segs.reduce((s, [a, b]) => s + b - a, 0);
  return (
    <div className="seq-info">
      <span className="num">
        {selectionRange(selection, record.length)}
      </span>
      <span>
        <b className="num">{len.toLocaleString()}</b> bp
      </span>
      {info && (
        <>
          <span>
            GC <b className="num">{info.gc_content.toFixed(1)}%</b>
          </span>
          {info.tm !== null && (
            <span>
              Tm <b className="num">{info.tm.toFixed(1)} °C</b>
            </span>
          )}
          {info.mw_double !== null && (
            <span title={`single-stranded ${formatMw(info.mw_single!)}`}>
              MW <b className="num">{formatMw(info.mw_double)}</b> ds
            </span>
          )}
          {info.translation && (
            <span className="seq-info-aa" title={info.translation}>
              <span className="muted">
                {info.translation_of === "selection"
                  ? "Translation"
                  : `${info.translation_of} (${info.translation_strand === -1 ? "−" : "+"})`}
              </span>{" "}
              <code>{info.translation}</code>
              {info.protein_mw !== null && (
                <span className="muted num"> · {formatMw(info.protein_mw)}</span>
              )}
              <button
                className="icon-btn sm"
                aria-label="Copy translation"
                title="Copy translation"
                onClick={() => void copyText(info.translation)}
              >
                <Copy size={12} />
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );
}

function formatMw(gPerMol: number): string {
  return gPerMol >= 1e6
    ? `${(gPerMol / 1e6).toFixed(2)} MDa`
    : gPerMol >= 1e3
      ? `${(gPerMol / 1e3).toFixed(1)} kDa`
      : `${gPerMol.toFixed(0)} Da`;
}
