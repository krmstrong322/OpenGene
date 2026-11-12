import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { api } from "../lib/api";
import { selectionSegments } from "../lib/selection";
import type { PlasmidRecord, Selection, TraceData } from "../lib/types";

interface Props {
  record: PlasmidRecord;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  onError: (msg: string) => void;
}

// Vertical layout (CSS px).
const H = 230;
const POS_Y = 11; // baseline of the position numbers
const CALL_Y = 27; // baseline of the base calls
const QUAL_TOP = 33;
const QUAL_H = 22; // a Q60 bar fills this
const TRACE_TOP = 62;
const TRACE_BOTTOM = H - 6;
const LOW_Q = 20; // bases under Q20 are shaded

const X_ZOOMS = [0.5, 1, 1.5, 2, 3, 4, 6];
const BASES = ["A", "C", "G", "T"] as const;

// Index of the last peak at or before `sample` (binary search).
function peakIndexAt(peaks: number[], sample: number): number {
  let lo = 0;
  let hi = peaks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (peaks[mid] <= sample) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Re-render when the app's theme or the OS color scheme changes, so the
// canvas (which can't use CSS variables) picks up the new colors.
function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);
  return v;
}

export function ChromatogramPane({ record, selection, onSelect, onError }: Props) {
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [xi, setXi] = useState(3); // index into X_ZOOMS
  const [yZoom, setYZoom] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const themeVersion = useThemeVersion();
  const xScale = X_ZOOMS[xi];

  // The trace's peaks move with sequence edits, so refetch when it changes.
  useEffect(() => {
    let cancelled = false;
    api
      .trace(record.id)
      .then((t) => !cancelled && setTrace(t))
      .catch((e) => {
        if (cancelled) return;
        setTrace(null);
        onError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.sequence]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nSamples = trace ? trace.samples.A.length : 0;
  const peaks = useMemo(() => trace?.peaks ?? [], [trace]);
  // Scale to the typical called-peak height (98th percentile), not the
  // tallest blob, which is often dye noise at the start of a read.
  const maxV = useMemo(() => {
    if (!trace || !trace.peaks.length) return 1;
    const heights = trace.peaks
      .map((p) => Math.max(...BASES.map((b) => trace.samples[b][p] ?? 0)))
      .sort((a, b) => a - b);
    return Math.max(1, heights[Math.floor(heights.length * 0.98)] * 1.15);
  }, [trace]);

  // x (content px) of the boundary before base i: halfway between peaks.
  const bound = useCallback(
    (i: number) => {
      if (!peaks.length) return 0;
      if (i <= 0) return 0;
      if (i >= peaks.length) return nSamples * xScale;
      return ((peaks[i - 1] + peaks[i]) / 2) * xScale;
    },
    [peaks, nSamples, xScale],
  );

  // ----- drawing -----
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !trace) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, H);
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const color = { A: v("--trace-a"), C: v("--trace-c"), G: v("--trace-g"), T: v("--trace-t") };
    const x0 = scrollLeft;
    const sx = (sample: number) => sample * xScale - x0;

    // Visible bases.
    const first = Math.max(0, peakIndexAt(peaks, x0 / xScale) - 1);
    const last = Math.min(peaks.length - 1, peakIndexAt(peaks, (x0 + viewW) / xScale) + 1);

    // Selection band.
    ctx.fillStyle = v("--seq-sel");
    for (const [a, b] of selectionSegments(selection, record.length)) {
      const left = bound(a) - x0;
      const right = bound(b) - x0;
      if (right > 0 && left < viewW) ctx.fillRect(left, 0, Math.max(1.5, right - left), H);
    }

    // Low-quality shading behind the traces.
    ctx.fillStyle = v("--trace-lowq");
    for (let i = first; i <= last; i++) {
      if (trace.quality[i] < LOW_Q) {
        ctx.fillRect(bound(i) - x0, TRACE_TOP - 4, bound(i + 1) - bound(i), TRACE_BOTTOM - TRACE_TOP + 4);
      }
    }

    // Quality bars.
    const spacing = peaks.length > 1 ? ((peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1)) * xScale : 10;
    const barW = Math.max(1, Math.min(8, spacing * 0.7));
    for (let i = first; i <= last; i++) {
      const q = Math.min(60, trace.quality[i]);
      const h = (q / 60) * QUAL_H;
      ctx.fillStyle = q >= LOW_Q ? v("--trace-qual") : v("--trace-qual-low");
      ctx.fillRect(sx(peaks[i]) - barW / 2, QUAL_TOP + QUAL_H - h, barW, h);
    }

    // Traces.
    const s0 = Math.max(0, Math.floor(x0 / xScale) - 2);
    const s1 = Math.min(nSamples - 1, Math.ceil((x0 + viewW) / xScale) + 2);
    const traceH = TRACE_BOTTOM - TRACE_TOP;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    for (const b of BASES) {
      const data = trace.samples[b];
      ctx.strokeStyle = color[b];
      ctx.beginPath();
      for (let s = s0; s <= s1; s++) {
        const y = TRACE_BOTTOM - Math.min(1.05, (data[s] / maxV) * yZoom) * traceH;
        if (s === s0) ctx.moveTo(sx(s), y);
        else ctx.lineTo(sx(s), y);
      }
      ctx.stroke();
    }

    // Base calls and position numbers.
    ctx.textAlign = "center";
    const showCalls = spacing >= 6;
    const step = spacing >= 9 ? 10 : spacing >= 4 ? 20 : 50;
    ctx.font = `600 12px ${v("--font-mono")}`;
    for (let i = first; i <= last; i++) {
      const x = sx(peaks[i]);
      const base = record.sequence[i] ?? "";
      if (showCalls) {
        ctx.fillStyle = (color as Record<string, string>)[base] || v("--muted");
        ctx.fillText(base, x, CALL_Y);
      }
    }
    ctx.font = `10px ${v("--font-sans")}`;
    ctx.fillStyle = v("--faint");
    for (let i = first; i <= last; i++) {
      if ((i + 1) % step === 0) ctx.fillText(String(i + 1), sx(peaks[i]), POS_Y);
    }
  }, [trace, viewW, scrollLeft, xScale, yZoom, maxV, selection, record.sequence, record.length, bound, peaks, nSamples, themeVersion]);

  // ----- selection -----
  const anchor = useRef<number | null>(null);
  const own = useRef<Selection | null>(null);
  const dragging = useRef(false);

  const baseAt = (clientX: number) => {
    const el = scrollerRef.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const sample = x / xScale;
    let i = peakIndexAt(peaks, sample);
    // Nearest peak, not just the one to the left.
    if (i + 1 < peaks.length && peaks[i + 1] - sample < sample - peaks[i]) i += 1;
    return i;
  };
  const selectBases = (a: number, b: number) => {
    const sel = { start: Math.min(a, b), end: Math.max(a, b) + 1 };
    own.current = sel;
    onSelect(sel);
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragging.current && anchor.current !== null && peaks.length) {
        selectBases(anchor.current, baseAt(e.clientX));
      }
    };
    const up = () => (dragging.current = false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  // A selection made elsewhere scrolls into view (centred) if it's off screen.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !selection || selection === own.current || !peaks.length) return;
    const a = Math.min(selection.start, selection.end);
    const left = bound(a);
    if (left < el.scrollLeft || left > el.scrollLeft + el.clientWidth - 20) {
      el.scrollLeft = Math.max(0, left - el.clientWidth / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, trace]);

  // Keep the same base centred when zooming.
  const zoomTo = (next: number) => {
    const el = scrollerRef.current;
    if (!el) return setXi(next);
    const centre = (el.scrollLeft + el.clientWidth / 2) / xScale;
    setXi(next);
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, centre * X_ZOOMS[next] - el.clientWidth / 2);
    });
  };

  const meta = trace?.meta ?? {};
  const good = trace ? trace.quality.filter((q) => q >= LOW_Q).length : 0;

  return (
    <section className="pane">
      <div className="pane-head">
        <h3 className="pane-title">Chromatogram</h3>
        <span className="meta">
          {[meta.sample, meta.instrument, meta.format].filter(Boolean).join(" · ")}
          {trace && ` · ${good.toLocaleString()} of ${trace.quality.length.toLocaleString()} bases Q${LOW_Q}+`}
        </span>
        <span className="spacer" />
        <span className="trace-legend" aria-hidden="true">
          {BASES.map((b) => (
            <span key={b} className={`trace-key trace-${b.toLowerCase()}`}>
              {b}
            </span>
          ))}
        </span>
        <span className="zoom-group" role="group" aria-label="Horizontal zoom">
          <button className="icon-btn sm" onClick={() => zoomTo(Math.max(0, xi - 1))} disabled={xi === 0} aria-label="Zoom out" title="Zoom out">
            <Minus size={13} />
          </button>
          <span className="muted">Zoom</span>
          <button className="icon-btn sm" onClick={() => zoomTo(Math.min(X_ZOOMS.length - 1, xi + 1))} disabled={xi === X_ZOOMS.length - 1} aria-label="Zoom in" title="Zoom in">
            <Plus size={13} />
          </button>
        </span>
        <span className="zoom-group" role="group" aria-label="Peak height">
          <button className="icon-btn sm" onClick={() => setYZoom((y) => Math.max(0.25, y / 1.5))} aria-label="Lower peaks" title="Lower peaks">
            <Minus size={13} />
          </button>
          <span className="muted">Height</span>
          <button className="icon-btn sm" onClick={() => setYZoom((y) => Math.min(16, y * 1.5))} aria-label="Taller peaks" title="Taller peaks">
            <Plus size={13} />
          </button>
        </span>
      </div>
      <div
        ref={scrollerRef}
        className="trace-scroller"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onMouseDown={(e) => {
          if (e.button !== 0 || !peaks.length) return;
          e.preventDefault();
          const i = baseAt(e.clientX);
          const from = e.shiftKey && anchor.current !== null ? anchor.current : i;
          anchor.current = from;
          dragging.current = true;
          selectBases(from, i);
        }}
      >
        <div className="trace-content" style={{ width: Math.max(viewW, nSamples * xScale), height: H }}>
          <canvas ref={canvasRef} className="trace-canvas" style={{ width: viewW, height: H }} />
        </div>
      </div>
    </section>
  );
}
