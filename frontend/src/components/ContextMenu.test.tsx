import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type MenuEntry } from "./ContextMenu";

afterEach(cleanup);

function setup() {
  const copy = vi.fn();
  const del = vi.fn();
  const onClose = vi.fn();
  const entries: MenuEntry[] = [
    { kind: "heading", label: "lacZ" },
    { label: "Copy", hint: "Ctrl+C", run: copy },
    { label: "Paste", disabled: true, run: vi.fn() },
    { kind: "sep" },
    { label: "Delete bases", danger: true, run: del },
  ];
  render(<ContextMenu x={10} y={10} entries={entries} onClose={onClose} />);
  return { copy, del, onClose };
}

describe("ContextMenu", () => {
  it("focuses the first available item and moves with the arrow keys, skipping disabled ones", async () => {
    setup();
    const user = userEvent.setup();
    expect(screen.getByRole("menuitem", { name: /Copy/ })).toHaveProperty("disabled", false);
    expect(document.activeElement?.textContent).toContain("Copy");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Delete bases");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Copy");
  });

  it("runs the chosen item and closes", async () => {
    const { del, onClose } = setup();
    await userEvent.setup().click(screen.getByRole("menuitem", { name: "Delete bases" }));
    expect(del).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("does nothing for a disabled item", async () => {
    const { onClose } = setup();
    await userEvent.setup().click(screen.getByRole("menuitem", { name: "Paste" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and on a click outside", async () => {
    const { onClose, copy } = setup();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(copy).not.toHaveBeenCalled();
  });
});
