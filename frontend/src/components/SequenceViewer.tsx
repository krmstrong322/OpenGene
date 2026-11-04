import { useMemo } from "react";
import type { Feature, PlasmidRecord, Selection } from "../lib/types";
import { TYPE_COLORS } from "../lib/types";
import { inSelection as segInSelection, selectionLength } from "../lib/selection";

interface Props {
  record: PlasmidRecord;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  hoveredId: string | null;
}

const PER_LINE = 60;

// For each base index, the top-most feature covering it (for coloring).
function buildCoverage(record: PlasmidRecord): (Feature | undefined)[] {
  const cov = new Array<Feature | undefined>(record.length);
  for (const f of record.features) {
    const paint = (s: number, e: number) => {
      for (let i = s; i < e; i++) if (!cov[i]) cov[i] = f;
    };
    if (f.end >= f.start) paint(f.start, f.end);
    else {
      paint(f.start, record.length);
      paint(0, f.end);
    }
  }
  return cov;
}

export function SequenceViewer({ record, selection, onSelect, hoveredId }: Props) {
  const seq = record.sequence;
  const coverage = useMemo(() => buildCoverage(record), [record]);

  const lines = useMemo(() => {
    const out: { start: number; text: string }[] = [];
    for (let i = 0; i < seq.length; i += PER_LINE) {
      out.push({ start: i, text: seq.slice(i, i + PER_LINE) });
    }
    return out;
  }, [seq]);

  const inSelection = (i: number) => segInSelection(selection, record.length, i);

  const handleBaseClick = (i: number, shift: boolean) => {
    if (shift && selection) {
      onSelect({ start: selection.start, end: i + 1 });
    } else {
      onSelect({ start: i, end: i + 1 });
    }
  };

  return (
    <div className="seq-viewer" role="region" aria-label="Sequence">
      {lines.map((line) => (
        <div key={line.start} className="seq-line">
          <span className="seq-pos">{String(line.start + 1).padStart(6, " ")}</span>
          <span className="seq-bases">
            {line.text.split("").map((base, j) => {
              const idx = line.start + j;
              const f = coverage[idx];
              const sel = inSelection(idx);
              const hov = f && f.id === hoveredId;
              return (
                <span
                  key={idx}
                  className="seq-base"
                  style={{
                    background: sel
                      ? "#ffca28"
                      : f
                        ? (f.color || TYPE_COLORS[f.type]) + (hov ? "" : "44")
                        : "transparent",
                    color: sel ? "#000" : f && hov ? "#fff" : "#263238",
                    outline: hov ? "1px solid #212121" : "none",
                  }}
                  title={f ? `${f.name} (${idx})` : `base ${idx}`}
                  onClick={(e) => handleBaseClick(idx, e.shiftKey)}
                >
                  {base}
                </span>
              );
            })}
          </span>
        </div>
      ))}
      {selection && selection.start !== selection.end && (
        <div className="seq-selinfo">
          Selected {selection.start}–{selection.end}
          {selection.wrap ? " (wraps origin)" : ""} (
          {selectionLength(selection, record.length)} bp)
        </div>
      )}
    </div>
  );
}
