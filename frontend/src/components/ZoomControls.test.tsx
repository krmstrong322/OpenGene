import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZoomControls, wheelZoomFactor } from "./ZoomControls";

afterEach(cleanup);

describe("ZoomControls", () => {
  it("shows the level and disables what can't be done at the whole-map view", () => {
    render(<ZoomControls zoom={1} min={1} max={8} onZoom={vi.fn()} onReset={vi.fn()} label="linear map" />);
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom out" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Show the whole map" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveProperty("disabled", false);
  });

  it("zooms in and out by the same step, and resets", async () => {
    const onZoom = vi.fn();
    const onReset = vi.fn();
    render(<ZoomControls zoom={2} min={1} max={8} onZoom={onZoom} onReset={onReset} label="linear map" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Show the whole map" }));
    expect(onZoom.mock.calls[0][0] * onZoom.mock.calls[1][0]).toBeCloseTo(1);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("stops zooming in at the maximum", () => {
    render(<ZoomControls zoom={8} min={1} max={8} onZoom={vi.fn()} onReset={vi.fn()} label="linear map" />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveProperty("disabled", true);
  });
});

describe("wheelZoomFactor", () => {
  const wheel = (deltaY: number) => new WheelEvent("wheel", { deltaY });

  it("zooms in when scrolling up and out when scrolling down", () => {
    expect(wheelZoomFactor(wheel(-100))).toBeGreaterThan(1);
    expect(wheelZoomFactor(wheel(100))).toBeLessThan(1);
  });

  it("makes one mouse-wheel notch a modest step", () => {
    expect(wheelZoomFactor(wheel(-100))).toBeLessThan(1.5);
  });

  it("is symmetric, so scrolling there and back returns to the same zoom", () => {
    expect(wheelZoomFactor(wheel(-4)) * wheelZoomFactor(wheel(4))).toBeCloseTo(1);
  });
});
