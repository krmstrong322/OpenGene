import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { feature } from "../test/fixtures";
import { mapKeyHandler } from "./mapKeys";

const features = [
  feature({ id: "c", start: 300, end: 400, name: "third" }),
  feature({ id: "a", start: 10, end: 50, name: "first" }),
  feature({ id: "b", start: 100, end: 200, name: "second" }),
];

function press(key: string, selectedId?: string, extra: Partial<KeyboardEvent> = {}) {
  const onSelectFeature = vi.fn();
  const zoomBy = vi.fn();
  const resetZoom = vi.fn();
  const preventDefault = vi.fn();
  const handler = mapKeyHandler({
    features,
    selection: selectedId ? { start: 0, end: 1, featureId: selectedId } : null,
    onSelectFeature,
    zoomBy,
    resetZoom,
  });
  handler({ key, preventDefault, ...extra } as unknown as KeyboardEvent<SVGSVGElement>);
  return { selected: onSelectFeature.mock.calls[0]?.[0]?.name, zoomBy, resetZoom, preventDefault };
}

describe("map keyboard control", () => {
  it("steps through features in sequence order, not list order", () => {
    expect(press("ArrowRight").selected).toBe("first");
    expect(press("ArrowRight", "a").selected).toBe("second");
    expect(press("ArrowLeft", "b").selected).toBe("first");
  });

  it("wraps around at either end", () => {
    expect(press("ArrowRight", "c").selected).toBe("first");
    expect(press("ArrowLeft", "a").selected).toBe("third");
    expect(press("ArrowLeft").selected).toBe("third");
  });

  it("jumps to the first and last feature", () => {
    expect(press("Home", "b").selected).toBe("first");
    expect(press("End", "b").selected).toBe("third");
  });

  it("zooms with + and −, and resets with 0", () => {
    expect(press("+").zoomBy).toHaveBeenCalledWith(1.5);
    expect(press("-").zoomBy).toHaveBeenCalledWith(1 / 1.5);
    expect(press("0").resetZoom).toHaveBeenCalled();
  });

  it("leaves browser shortcuts and unrelated keys alone", () => {
    const withCtrl = press("ArrowRight", undefined, { ctrlKey: true });
    expect(withCtrl.selected).toBeUndefined();
    expect(withCtrl.preventDefault).not.toHaveBeenCalled();
    expect(press("x").preventDefault).not.toHaveBeenCalled();
  });
});
