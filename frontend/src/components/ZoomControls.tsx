import { Maximize, Minus, Plus } from "lucide-react";

// Zoom buttons that float in a corner of a map: out, the current level, in,
// and back to the whole map. Ctrl/⌘ + scroll (or a trackpad pinch) and
// dragging do the same from the map itself.
export function ZoomControls({
  zoom,
  min,
  max,
  onZoom,
  onReset,
  label,
}: {
  zoom: number;
  min: number;
  max: number;
  /** Multiply the zoom by `factor`, keeping the middle of the view fixed. */
  onZoom: (factor: number) => void;
  onReset: () => void;
  /** What is being zoomed, for screen readers ("circular map"). */
  label: string;
}) {
  return (
    <div className="map-zoom" role="group" aria-label={`Zoom ${label}`}>
      <button
        className="icon-btn sm"
        onClick={() => onZoom(1 / 1.5)}
        disabled={zoom <= min * 1.001}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <Minus size={13} />
      </button>
      <span className="map-zoom-level num" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button
        className="icon-btn sm"
        onClick={() => onZoom(1.5)}
        disabled={zoom >= max * 0.999}
        title="Zoom in (Ctrl/⌘ + scroll, or pinch)"
        aria-label="Zoom in"
      >
        <Plus size={13} />
      </button>
      <button
        className="icon-btn sm"
        onClick={onReset}
        disabled={zoom <= min * 1.001}
        title="Show the whole map"
        aria-label="Show the whole map"
      >
        <Maximize size={12} />
      </button>
    </div>
  );
}

/**
 * How much one wheel event zooms. A trackpad pinch arrives as many small
 * deltas, a mouse wheel as a few large ones, so the wheel is scaled down to
 * make one notch a modest step.
 */
export function wheelZoomFactor(e: WheelEvent): number {
  const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE;
  const delta = lines ? e.deltaY * 33 : e.deltaY;
  const perUnit = Math.abs(delta) >= 50 ? 0.0025 : 0.01;
  return Math.exp(-delta * perUnit);
}
