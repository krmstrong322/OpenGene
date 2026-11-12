import { BAR_H, CUT_ROW, FEAT_ROW, OVERSCAN, PAD_X, ROW, buildLines, colOf, groupBases, lineAt, linearize } from "../lib/seqLayout";
import type { Line, Options, Piece } from "../lib/seqLayout";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { textFieldFocused } from "../lib/desktop";
import { cleanPaste, copyText, editAtSelection, editErrorMessage, isBaseKey, pasteProblem, selectedSpan } from "../lib/edits";
import { selectionSegments } from "../lib/selection";
import { cdsTranslations, complement } from "../lib/translate";
import type { CutSite, Feature, FramePolicy, PlasmidRecord, SearchHit, Selection } from "../lib/types";
import { TYPE_COLORS, featureSpans } from "../lib/types";

export interface Props {
  record: PlasmidRecord;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  hoveredId: string | null;
  onHover: (featureId: string | null) => void;
  onSelectFeature: (f: Feature) => void;
  cutSites: CutSite[];
  framePolicy: FramePolicy;
  onRecordChange: (r: PlasmidRecord) => void;
  onError: (msg: string) => void;
  /** Report something the engine did that the user should know about (not a failure). */
  onWarning?: (msg: string) => void;
  /** Confirm that something worked ("Copied 29 bases"). */
  onInfo?: (msg: string) => void;
  /** Open the right-click menu at a point (over `feature`, if on a feature bar). */
  onMenu?: (x: number, y: number, feature?: Feature) => void;
}

export function SequenceViewer({
  record,
  selection,
  onSelect,
  hoveredId,
  onHover,
  onSelectFeature,
  cutSites,
  framePolicy,
  onRecordChange,
  onError,
  onWarning,
  onMenu,
  opts,
  hits,
  currentHit,
}: Props & { opts: Options; hits: SearchHit[]; currentHit: number }) {
  const n = record.length;
  const seq = record.sequence;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [cw, setCw] = useState(7.2);
  const [width, setWidth] = useState(800);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);

  // Character width of the mono font, measured (and re-measured once web
  // fonts load) so columns line up with the text exactly.
  useLayoutEffect(() => {
    const measure = () => {
      const w = probeRef.current?.getBoundingClientRect().width;
      if (w) setCw(w / 10);
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setViewH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gutter = (String(n).length + 2) * cw;
  const x0 = PAD_X + gutter;
  const perLine = useMemo(() => {
    const avail = width - x0 - PAD_X;
    return Math.max(10, Math.floor((avail / cw + 1) / 1.1 / 10) * 10);
  }, [width, x0, cw]);

  const translations = useMemo(() => cdsTranslations(record), [record]);
  const lines = useMemo(
    () => buildLines(record, perLine, cutSites, translations, opts, cw),
    [record, perLine, cutSites, translations, opts, cw],
  );
  const total = lines.length ? lines[lines.length - 1].top + lines[lines.length - 1].height : 0;

  // x of base offset k within a line, and of the boundary before it.
  const baseX = (k: number) => x0 + colOf(k) * cw;
  const boundaryX = (k: number) =>
    k > 0 && k % 10 === 0 ? baseX(k - 1) + cw * 1.5 : baseX(k);

  // ----- selection bookkeeping -----
  // The anchor is the fixed end of a selection; the other end moves with
  // shift-click, drag and shift-arrows.
  const anchorRef = useRef<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const ownSelection = useRef<Selection | null>(null);

  const select = useCallback(
    (anchor: number, focus: number) => {
      anchorRef.current = anchor;
      focusRef.current = focus;
      const sel = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
      ownSelection.current = sel;
      onSelect(sel);
    },
    [onSelect],
  );

  // Scroll the line holding `pos` into view, if it isn't already: just
  // enough for keyboard moves, or to the top for a jump from elsewhere.
  const scrollToPos = useCallback(
    (pos: number, toTop = false) => {
      const el = scrollerRef.current;
      if (!el || !lines.length) return;
      const line = lines[Math.min(lines.length - 1, Math.floor(Math.max(0, pos) / perLine))];
      const above = line.top < el.scrollTop;
      const below = line.top + line.height > el.scrollTop + el.clientHeight;
      if (above || below) {
        el.scrollTop =
          above || toTop ? line.top - 8 : line.top + line.height - el.clientHeight + 8;
      }
    },
    [lines, perLine],
  );

  // A selection made elsewhere (a feature on the map, the feature list)
  // scrolls into view and resets the anchor.
  useEffect(() => {
    if (!selection || selection === ownSelection.current) return;
    anchorRef.current = selection.start;
    focusRef.current = selection.end;
    scrollToPos(selection.start, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // ----- mouse -----
  const posAt = useCallback(
    (clientX: number, clientY: number): number => {
      const rect = contentRef.current!.getBoundingClientRect();
      const y = Math.max(0, Math.min(total - 1, clientY - rect.top));
      const line = lines[lineAt(lines, y)];
      const len = line.end - line.start;
      const col = (clientX - rect.left - x0) / cw;
      if (col <= 0) return line.start;
      const group = Math.floor(col / 11);
      const within = col - group * 11;
      let k = within >= 10 ? (group + 1) * 10 : group * 10 + Math.round(within);
      k = Math.max(0, Math.min(len, k));
      return line.start + k;
    },
    [lines, total, x0, cw],
  );

  const dragging = useRef(false);
  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    scrollerRef.current?.focus();
    const p = posAt(e.clientX, e.clientY);
    if (e.shiftKey && anchorRef.current !== null) select(anchorRef.current, p);
    else select(p, p);
    dragging.current = true;
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || anchorRef.current === null) return;
      const el = scrollerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + 16) el.scrollTop -= 24;
        else if (e.clientY > r.bottom - 16) el.scrollTop += 24;
      }
      const p = posAt(e.clientX, e.clientY);
      if (p !== focusRef.current) select(anchorRef.current, p);
    };
    const up = () => (dragging.current = false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [posAt, select]);

  // ----- editing through the engine -----
  // Put `bases` at `sel` (replacing a range, inserting at a cursor; "" deletes)
  // and leave the cursor after them, or select them when `selectNew` is set.
  const edit = async (sel: Selection, bases: string, selectNew: boolean) => {
    try {
      const res = await editAtSelection(record, sel, bases, framePolicy);
      onRecordChange(res.record);
      const end = Math.min(res.record.length, res.at + res.inserted);
      select(selectNew ? res.at : end, end);
      if (res.warnings.length) (onWarning ?? onError)(res.warnings.join("\n"));
    } catch (err) {
      onError(editErrorMessage(err));
    }
  };

  // Typing. Keystrokes are buffered and sent in order, one engine call at a
  // time, so fast typing can't race the cursor: whatever arrives while a call
  // is in flight goes out together in the next one.
  const typed = useRef("");
  const typing = useRef(false);
  const typeBases = (bases: string) => {
    if (!selection) return;
    typed.current += bases;
    if (typing.current) return;
    typing.current = true;
    void (async () => {
      let rec = record;
      let sel: Selection = selection;
      try {
        while (typed.current) {
          const next = typed.current;
          typed.current = "";
          const res = await editAtSelection(rec, sel, next, framePolicy);
          rec = res.record;
          const p = Math.min(rec.length, res.at + res.inserted);
          sel = { start: p, end: p };
          onRecordChange(rec);
          select(p, p);
          scrollToPos(p);
          if (res.warnings.length) (onWarning ?? onError)(res.warnings.join("\n"));
        }
      } catch (err) {
        typed.current = "";
        onError(editErrorMessage(err));
      } finally {
        typing.current = false;
      }
    })();
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const bases = cleanPaste(e.clipboardData?.getData("text") ?? "");
    if (!bases) return;
    const problem = pasteProblem(bases);
    if (problem) {
      onError(problem);
      return;
    }
    if (!selection) {
      onError("Click in the sequence to place the cursor, then paste.");
      return;
    }
    void edit(selection, bases, true);
  };

  // Copy / cut from the browser or the desktop app's Edit menu (the keyboard
  // shortcut for copy is handled in onKeyDown). Cut also deletes the bases.
  const cutting = useRef(false);
  const onCopy = (e: ClipboardEvent) => {
    const text = selectionSegments(selection, n)
      .map(([a, b]) => seq.slice(a, b))
      .join("");
    if (!text) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", text);
    // A cut can arrive twice (shortcut and menu); delete only once.
    if (e.type === "cut" && selection && !typing.current && !cutting.current) {
      cutting.current = true;
      void edit(selection, "", false).finally(() => (cutting.current = false));
    }
  };

  // Clipboard events are listened for on the document and acted on while the
  // view has the focus: the view isn't a text field, so the browser may aim
  // them at the page body instead of at it. Cancelling the before* events
  // tells the browser that Cut/Copy/Paste are available here, which is what
  // makes the desktop app's Edit menu (and its shortcuts) reach the view.
  const clipboardRef = useRef({ onCopy, onPaste });
  clipboardRef.current = { onCopy, onPaste };
  useEffect(() => {
    const focused = () => !!scrollerRef.current && document.activeElement === scrollerRef.current;
    // Copy also works while the focus is on a button or nothing at all (after
    // Select All from the menu, say) — anywhere but a text field, which has
    // its own text to copy. Changing the sequence needs the view focused.
    const canCopy = () => focused() || !textFieldFocused();
    const allowCopy = (e: Event) => canCopy() && e.preventDefault();
    const allowEdit = (e: Event) => focused() && e.preventDefault();
    const copy = (e: Event) => canCopy() && clipboardRef.current.onCopy(e as ClipboardEvent);
    const cut = (e: Event) => focused() && clipboardRef.current.onCopy(e as ClipboardEvent);
    const paste = (e: Event) => focused() && clipboardRef.current.onPaste(e as ClipboardEvent);
    const handlers: [string, (e: Event) => void][] = [
      ["beforecopy", allowCopy],
      ["beforecut", allowEdit],
      ["beforepaste", allowEdit],
      ["copy", copy],
      ["cut", cut],
      ["paste", paste],
    ];
    handlers.forEach(([name, h]) => document.addEventListener(name, h));
    return () => handlers.forEach(([name, h]) => document.removeEventListener(name, h));
  }, []);

  // Right-click: keep a selection that was clicked inside, otherwise move the
  // cursor to the click first (as a text editor does), then open the menu.
  const onContextMenu = (e: ReactMouseEvent) => {
    if (!onMenu) return;
    e.preventDefault();
    scrollerRef.current?.focus();
    const p = posAt(e.clientX, e.clientY);
    const inside = selectionSegments(selection, n).some(([a, b]) => p >= a && p <= b);
    if (!inside) select(p, p);
    onMenu(e.clientX, e.clientY);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    if (mod && key.toLowerCase() === "a") {
      e.preventDefault();
      select(0, n);
      return;
    }
    if (mod && key.toLowerCase() === "c") {
      const text = selectionSegments(selection, n)
        .map(([a, b]) => seq.slice(a, b))
        .join("");
      if (text) {
        e.preventDefault();
        void copyText(text);
      }
      return;
    }
    if (key === "Escape") {
      ownSelection.current = null;
      anchorRef.current = focusRef.current = null;
      onSelect(null);
      return;
    }
    if ((key === "Backspace" || key === "Delete") && selection) {
      e.preventDefault();
      if (typing.current) return;
      if (selectedSpan(selection, n)) {
        void edit(selection, "", false);
      } else {
        const p = selection.start;
        const [a, b] = key === "Backspace" ? [p - 1, p] : [p, p + 1];
        if (a < 0 || b > n) return;
        void edit({ start: a, end: b }, "", false);
      }
      return;
    }
    // A base typed at the cursor is inserted; typed over a selection it
    // replaces the selection.
    if (!mod && !e.altKey && isBaseKey(key) && selection) {
      e.preventDefault();
      typeBases(key.toUpperCase());
      return;
    }
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -perLine,
      ArrowDown: perLine,
    };
    let target: number | null = null;
    const focus = focusRef.current ?? selection?.end ?? 0;
    if (key in steps) {
      if (!e.shiftKey && selection && selection.start !== selection.end && (key === "ArrowLeft" || key === "ArrowRight")) {
        // Collapse a selection to its edge, like a text editor.
        const r = selectedSpan(selection, n)!;
        target = key === "ArrowLeft" ? r.start : r.end;
      } else {
        target = focus + steps[key];
      }
    } else if (key === "Home") {
      target = mod ? 0 : Math.floor(Math.min(focus, n - 1) / perLine) * perLine;
    } else if (key === "End") {
      target = mod ? n : Math.min(n, (Math.floor(Math.min(focus, n - 1) / perLine) + 1) * perLine);
    }
    if (target === null) return;
    e.preventDefault();
    target = Math.max(0, Math.min(n, target));
    if (e.shiftKey && anchorRef.current !== null) select(anchorRef.current, target);
    else select(target, target);
    scrollToPos(target);
  };

  // ----- virtualized rendering -----
  const first = lines.length ? lineAt(lines, Math.max(0, scrollTop - OVERSCAN)) : 0;
  const visible: Line[] = [];
  for (let i = first; i < lines.length && lines[i].top < scrollTop + viewH + OVERSCAN; i++) {
    visible.push(lines[i]);
  }
  const selSegs = selectionSegments(selection, n);
  // Search hits, split at the origin and bucketed by line.
  const hitsByLine = useMemo(() => {
    const out = new Map<number, { a: number; b: number; strand: number; current: boolean }[]>();
    hits.forEach((h, i) => {
      for (const [a, b] of linearize(h.start, h.end, n)) {
        for (let li = Math.floor(a / perLine); li <= Math.floor((b - 1) / perLine); li++) {
          const list = out.get(li) ?? [];
          list.push({ a, b, strand: h.strand, current: i === currentHit });
          out.set(li, list);
        }
      }
    });
    return out;
  }, [hits, currentHit, n, perLine]);
  const caret = selection && selection.start === selection.end ? selection.start : null;
  const hovered = hoveredId ? record.features.find((f) => f.id === hoveredId) ?? null : null;
  const hoveredSegs = hovered
    ? featureSpans(hovered).flatMap(([s, e]) => linearize(s, e, n))
    : [];

  return (
    <div
      ref={scrollerRef}
      className="seq-viewer"
      tabIndex={0}
      role="textbox"
      aria-label="Sequence"
      aria-readonly="false"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <span ref={probeRef} className="seq-probe" aria-hidden="true">
        0000000000
      </span>
      <div
        ref={contentRef}
        className="seq-content"
        style={{ height: total }}
        onMouseDown={onMouseDown}
      >
        {visible.map((line) => {
          const len = line.end - line.start;
          const strandTop = line.cutRows * CUT_ROW;
          const strandH = ROW * (opts.complement ? 2 : 1);
          const cdsTop = strandTop + strandH;
          const featTop = cdsTop + line.cdsRows * ROW;
          const overlap = (a: number, b: number) =>
            [Math.max(a, line.start) - line.start, Math.min(b, line.end) - line.start] as const;
          const rect = (a: number, b: number) => ({
            left: baseX(a),
            width: baseX(b - 1) + cw - baseX(a),
          });
          const text = seq.slice(line.start, line.end);
          return (
            <div key={line.start} className="seq-line" style={{ top: line.top, height: line.height }}>
              {/* highlights behind the strands */}
              {hoveredSegs.map(([a, b], i) => {
                const [s, e] = overlap(a, b);
                if (e <= s) return null;
                return (
                  <div
                    key={`h${i}`}
                    className="seq-hl"
                    style={{
                      ...rect(s, e),
                      top: strandTop,
                      height: strandH,
                      background: (hovered!.color || TYPE_COLORS[hovered!.type] || "#8E949C") + "40",
                    }}
                  />
                );
              })}
              {(hitsByLine.get(Math.floor(line.start / perLine)) ?? []).map((h, i) => {
                const [s, e] = overlap(h.a, h.b);
                if (e <= s) return null;
                // A minus-strand hit marks the bottom strand when it's shown.
                const bottom = h.strand === -1 && opts.complement;
                return (
                  <div
                    key={`m${i}`}
                    className={h.current ? "seq-hit current" : "seq-hit"}
                    style={{ ...rect(s, e), top: strandTop + (bottom ? ROW : 0), height: ROW }}
                  />
                );
              })}
              {selSegs.map(([a, b], i) => {
                const [s, e] = overlap(a, b);
                if (e <= s) return null;
                return (
                  <div key={`s${i}`} className="seq-sel" style={{ ...rect(s, e), top: strandTop, height: strandH }} />
                );
              })}

              {/* enzyme cut sites */}
              {line.cuts.map((c, i) => {
                const x = boundaryX(c.pos - line.start);
                return (
                  <div key={`c${i}`}>
                    <div className="seq-cut-label" style={{ left: x - 1, top: c.row * CUT_ROW }}>
                      {c.enzyme}
                    </div>
                    <div
                      className="seq-cut"
                      style={{ left: x, top: (c.row + 1) * CUT_ROW - 2, height: strandTop - (c.row + 1) * CUT_ROW + 2 + ROW }}
                    />
                  </div>
                );
              })}

              {/* strands */}
              <div className="seq-pos" style={{ top: strandTop, width: x0 - PAD_X - cw }}>
                {(line.start + 1).toLocaleString()}
              </div>
              <div className="seq-strand" style={{ top: strandTop, left: x0 }}>
                {groupBases(text)}
              </div>
              {opts.complement && (
                <div className="seq-strand comp" style={{ top: strandTop + ROW, left: x0 }}>
                  {groupBases(complement(text))}
                </div>
              )}
              {caret !== null && caret >= line.start && (caret < line.end || (caret === n && line.end === n)) && (
                <div
                  className="seq-caret"
                  style={{ left: boundaryX(caret - line.start) - 1, top: strandTop, height: strandH }}
                />
              )}

              {/* translations */}
              {line.cds.map(({ t, row }) => {
                const chars = new Array(colOf(Math.max(0, len - 1)) + 1).fill(" ");
                for (let k = 0; k < len; k++) {
                  const aa = t.aa.get(line.start + k);
                  if (aa) chars[colOf(k)] = aa;
                }
                return (
                  <div
                    key={`t${t.feature.id}`}
                    className="seq-aa"
                    style={{ top: cdsTop + row * ROW, left: x0, color: t.color }}
                    title={`${t.feature.name} translation`}
                  >
                    {chars.join("")}
                  </div>
                );
              })}

              {/* feature bars */}
              {line.feats.map((lf) => {
                const y = featTop + lf.lane * FEAT_ROW;
                const parts = lf.pieces.filter((p) => !p.gap);
                const widest = parts.reduce<Piece | null>((w, p) => (!w || p.b - p.a > w.b - w.a ? p : w), null);
                return (
                  <div
                    key={`f${lf.f.id}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onSelectFeature(lf.f);
                    }}
                    onContextMenu={(e) => {
                      if (!onMenu) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onMenu(e.clientX, e.clientY, lf.f);
                    }}
                    onMouseEnter={() => onHover(lf.f.id)}
                    onMouseLeave={() => onHover(null)}
                    title={`${lf.f.name} · ${lf.f.type} · ${lf.f.strand === 1 ? "+" : "−"}`}
                  >
                    {lf.pieces.map((p, i) => {
                      const s = p.a - line.start;
                      const e = p.b - line.start;
                      const r = rect(s, e);
                      if (p.gap) {
                        return (
                          <div
                            key={i}
                            className="seq-feat-gap"
                            style={{ left: r.left, width: r.width, top: y + BAR_H / 2 - 1, background: lf.color }}
                          />
                        );
                      }
                      return (
                        <div
                          key={i}
                          className={`seq-feat${p.tip ? ` tip-${p.tip}` : ""}${hoveredId === lf.f.id ? " active" : ""}`}
                          style={{ ...r, top: y, height: BAR_H, background: lf.color }}
                        >
                          {p === widest ? lf.f.name : ""}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
