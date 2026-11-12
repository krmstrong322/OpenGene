import { useRef } from "react";
import { SPLIT_MAX, SPLIT_MIN } from "../lib/layout";

// The draggable divider between the maps and the sequence. `value` is the
// first pane's share of the container; the divider reports a new share while
// dragged, steps with the arrow keys, and resets on double-click.
export function Splitter({
  vertical,
  value,
  onChange,
  onReset,
}: {
  /** True when the panes sit side by side (the divider is a vertical bar). */
  vertical: boolean;
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const fromPointer = (e: React.PointerEvent) => {
    const box = ref.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    const v = vertical
      ? (e.clientX - box.left) / box.width
      : (e.clientY - box.top) / box.height;
    onChange(v);
  };

  return (
    <div
      ref={ref}
      className="splitter"
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label="Resize maps and sequence"
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(value * 100)}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const back = vertical ? "ArrowLeft" : "ArrowUp";
        const fwd = vertical ? "ArrowRight" : "ArrowDown";
        if (e.key === back || e.key === fwd) {
          e.preventDefault();
          onChange(value + (e.key === fwd ? 0.02 : -0.02));
        } else if (e.key === "Home") {
          e.preventDefault();
          onChange(SPLIT_MIN);
        } else if (e.key === "End") {
          e.preventDefault();
          onChange(SPLIT_MAX);
        } else if (e.key === "Enter") {
          e.preventDefault();
          onReset();
        }
      }}
    />
  );
}
