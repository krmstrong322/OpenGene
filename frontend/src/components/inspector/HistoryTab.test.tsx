import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { record } from "../../test/fixtures";
import { HistoryTab } from "./HistoryTab";

afterEach(cleanup);

const step = (id: string, description: string, warnings: string[] = []) => ({
  id,
  op: "insert",
  description,
  timestamp: 1_700_000_000,
  warnings,
});

describe("HistoryTab", () => {
  it("explains itself when nothing has changed", () => {
    render(<HistoryTab record={record("ACGT")} onUndo={vi.fn()} onRedo={vi.fn()} />);
    expect(screen.getByText(/Nothing has been changed yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveProperty("disabled", true);
  });

  it("lists changes newest first, with the engine's warnings", () => {
    const rec = record("ACGT", {
      canUndo: true,
      history: [
        step("1", "inserted 3 bp after base 10"),
        step("2", "deleted 1 bp (base 4)", ["frameshift allowed: lacZ by -1 bp"]),
      ],
    });
    render(<HistoryTab record={rec} onUndo={vi.fn()} onRedo={vi.fn()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Deleted 1 bp (base 4)")).toBeTruthy();
    expect(within(items[0]).getByText(/Frameshift allowed/)).toBeTruthy();
    expect(within(items[1]).getByText("Inserted 3 bp after base 10")).toBeTruthy();
  });

  it("offers undo and redo only when the engine can do them", async () => {
    const onUndo = vi.fn();
    const rec = record("ACGT", { canUndo: true, canRedo: false, history: [step("1", "inserted 1 bp")] });
    render(<HistoryTab record={rec} onUndo={onUndo} onRedo={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Redo" })).toHaveProperty("disabled", true);
  });

  it("says when listed changes can no longer be undone", () => {
    const rec = record("ACGT", { canUndo: false, canRedo: false, history: [step("1", "inserted 1 bp")] });
    render(<HistoryTab record={rec} onUndo={vi.fn()} onRedo={vi.fn()} />);
    expect(screen.getByText(/can no longer be undone/)).toBeTruthy();
  });
});
