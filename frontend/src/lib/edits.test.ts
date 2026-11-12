import { beforeEach, describe, expect, it, vi } from "vitest";
import { record } from "../test/fixtures";
import { api } from "./api";
import {
  cleanPaste,
  copiedMessage,
  editAtSelection,
  editErrorMessage,
  isBaseKey,
  pasteProblem,
  selectedSpan,
} from "./edits";

vi.mock("./api", () => ({
  api: { insert: vi.fn(), del: vi.fn(), replace: vi.fn() },
}));
const mocked = vi.mocked(api);

describe("pasted text", () => {
  it("drops FASTA headers, numbering and whitespace", () => {
    expect(cleanPaste(">pUC19 cloning vector\n  1 acgt acgt\n 11 ttaa\n")).toBe("ACGTACGTTTAA");
  });

  it("accepts IUPAC codes and names anything else", () => {
    expect(pasteProblem("ACGTNRYK")).toBeNull();
    expect(pasteProblem("ACGTJX")).toContain("J X");
  });
});

describe("typed keys", () => {
  it("treats bases and IUPAC codes as input, in either case", () => {
    for (const k of ["a", "C", "g", "T", "n", "R"]) expect(isBaseKey(k)).toBe(true);
  });

  it("ignores everything else", () => {
    for (const k of ["j", "1", " ", "Enter", "ArrowLeft", "AC"]) expect(isBaseKey(k)).toBe(false);
  });
});

describe("selectedSpan", () => {
  it("is null for a cursor", () => {
    expect(selectedSpan({ start: 4, end: 4 }, 100)).toBeNull();
  });

  it("keeps start > end for a selection that wraps the origin", () => {
    expect(selectedSpan({ start: 90, end: 10, wrap: true }, 100)).toEqual({ start: 90, end: 10, len: 20 });
  });
});

describe("editAtSelection always goes through the engine", () => {
  const before = record("ACGTACGTAC"); // 10 bp
  beforeEach(() => vi.clearAllMocks());

  it("inserts at a cursor", async () => {
    mocked.insert.mockResolvedValue(record("ACGTTTTACGTAC"));
    const res = await editAtSelection(before, { start: 4, end: 4 }, "TTT", "allow");
    expect(mocked.insert).toHaveBeenCalledWith("rec1", 4, "TTT", "allow");
    expect(res).toMatchObject({ at: 4, inserted: 3 });
  });

  it("replaces a selected range", async () => {
    mocked.replace.mockResolvedValue(record("ACGGCGTAC"));
    const res = await editAtSelection(before, { start: 5, end: 2 }, "GG", "reject");
    expect(mocked.replace).toHaveBeenCalledWith("rec1", 2, 5, "GG", "reject");
    expect(res).toMatchObject({ at: 2, inserted: 2 });
  });

  it("deletes a range when given no bases", async () => {
    mocked.del.mockResolvedValue(record("ACGTAAC"));
    const res = await editAtSelection(before, { start: 4, end: 7 }, "", "allow");
    expect(mocked.del).toHaveBeenCalledWith("rec1", 4, 7, "allow");
    expect(res).toMatchObject({ at: 4, inserted: 0 });
  });

  it("puts the cursor after the kept bases when the edit wraps the origin", async () => {
    // Deleting [8, 2) leaves bases 2..8, renumbered from 0.
    mocked.del.mockResolvedValue(record("GTACGT"));
    const res = await editAtSelection(before, { start: 8, end: 2, wrap: true }, "", "allow");
    expect(mocked.del).toHaveBeenCalledWith("rec1", 8, 2, "allow");
    expect(res.at).toBe(6);
  });

  it("counts padding the engine added as inserted", async () => {
    mocked.insert.mockResolvedValue(record("AANNCGTACGTAC"));
    const res = await editAtSelection(before, { start: 1, end: 1 }, "A", "pad");
    expect(res.inserted).toBe(3);
  });

  it("reports the warnings of the step it made", async () => {
    mocked.insert.mockResolvedValue(
      record("AACGTACGTAC", {
        history: [{ id: "h", op: "insert", description: "", timestamp: 0, warnings: ["frameshift allowed"] }],
      }),
    );
    const res = await editAtSelection(before, { start: 0, end: 0 }, "A", "allow");
    expect(res.warnings).toEqual(["frameshift allowed"]);
  });
});

describe("messages", () => {
  it("points a blocked frameshift at the setting that controls it", () => {
    const msg = editErrorMessage(new Error("it would shift the reading frame"));
    expect(msg).toContain("Reading frame in the Edit tab");
    expect(editErrorMessage(new Error("position out of range"))).toBe("position out of range");
  });

  it("confirms a copy with a count", () => {
    expect(copiedMessage(1)).toBe("Copied 1 base.");
    expect(copiedMessage(720, "reverse complement")).toBe("Copied the reverse complement of 720 bases.");
  });
});
