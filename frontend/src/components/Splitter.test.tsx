import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPLIT_MAX, SPLIT_MIN } from "../lib/layout";
import { Splitter } from "./Splitter";

afterEach(cleanup);

describe("Splitter", () => {
  it("describes itself as a separator with its position", () => {
    render(<Splitter vertical value={0.4} onChange={vi.fn()} onReset={vi.fn()} />);
    const sep = screen.getByRole("separator");
    expect(sep.getAttribute("aria-orientation")).toBe("vertical");
    expect(sep.getAttribute("aria-valuenow")).toBe("40");
  });

  it("moves with the arrow keys that match its orientation", () => {
    const onChange = vi.fn();
    render(<Splitter vertical value={0.5} onChange={onChange} onReset={vi.fn()} />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    fireEvent.keyDown(sep, { key: "ArrowDown" });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([0.52, 0.48]);
  });

  it("uses up and down when the panes are stacked", () => {
    const onChange = vi.fn();
    render(<Splitter vertical={false} value={0.5} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(0.52);
  });

  it("jumps to its limits and resets", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(<Splitter vertical value={0.5} onChange={onChange} onReset={onReset} />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "Home" });
    fireEvent.keyDown(sep, { key: "End" });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([SPLIT_MIN, SPLIT_MAX]);
    fireEvent.doubleClick(sep);
    fireEvent.keyDown(sep, { key: "Enter" });
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
