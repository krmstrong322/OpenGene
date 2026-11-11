// Sequence edits made directly in the views (typing, paste, delete, the
// right-click menu). Every one is a structured call to the engine — nothing
// here changes sequence text itself.
import { api } from "./api";
import type { FramePolicy, PlasmidRecord, Selection } from "./types";

export const IUPAC = /^[ACGTURYSWKMBDHVN]*$/;

/** True for a single key that is a base (IUPAC codes included). */
export function isBaseKey(key: string): boolean {
  return key.length === 1 && /^[ACGTURYSWKMBDHVN]$/i.test(key);
}

/** Pasted text as bases: drop FASTA headers, whitespace and numbering. */
export function cleanPaste(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">"))
    .join("")
    .replace(/[\s\d]/g, "")
    .toUpperCase();
}

/** Why `bases` can't be pasted, or null if it can. */
export function pasteProblem(bases: string): string | null {
  if (IUPAC.test(bases)) return null;
  const bad = Array.from(new Set(bases.replace(/[ACGTURYSWKMBDHVN]/g, ""))).join(" ");
  return `Can't paste: the clipboard holds characters that aren't bases (${bad}).`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back for contexts without the async clipboard API.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/** The span a selection covers (a wrapping one keeps start > end), or null for a cursor. */
export function selectedSpan(
  sel: Selection | null,
  n: number,
): { start: number; end: number; len: number } | null {
  if (!sel || sel.start === sel.end) return null;
  return sel.wrap
    ? { start: sel.start, end: sel.end, len: n - sel.start + sel.end }
    : {
        start: Math.min(sel.start, sel.end),
        end: Math.max(sel.start, sel.end),
        len: Math.abs(sel.end - sel.start),
      };
}

export interface EditResult {
  record: PlasmidRecord;
  /** Where the new bases start in the updated record. */
  at: number;
  /** How many bases went in (padding included). */
  inserted: number;
  warnings: string[];
}

/**
 * Put `bases` where the selection is: replacing a selected range, or inserted
 * at a cursor. Empty `bases` deletes the range.
 */
export async function editAtSelection(
  record: PlasmidRecord,
  sel: Selection,
  bases: string,
  framePolicy: FramePolicy,
): Promise<EditResult> {
  const n = record.length;
  const r = selectedSpan(sel, n);
  let updated: PlasmidRecord;
  let at: number;
  let kept: number;
  if (r) {
    updated = bases
      ? await api.replace(record.id, r.start, r.end, bases, framePolicy)
      : await api.del(record.id, r.start, r.end, framePolicy);
    // An edit that wraps the origin renumbers the record: what was kept now
    // starts at 0 and the new bases follow it.
    at = r.start > r.end ? n - r.len : r.start;
    kept = n - r.len;
  } else {
    updated = await api.insert(record.id, sel.start, bases, framePolicy);
    at = sel.start;
    kept = n;
  }
  return {
    record: updated,
    at: Math.min(at, updated.length),
    inserted: Math.max(0, updated.length - kept),
    warnings: updated.history[updated.history.length - 1]?.warnings ?? [],
  };
}

/** An engine error as shown to the user, with where to change the frame guard. */
export function editErrorMessage(err: unknown): string {
  const msg = (err as Error).message;
  return /reading frame|frameshift/i.test(msg)
    ? `${msg}\nThe rule for edits inside coding sequences is set under Reading frame in the Edit tab.`
    : msg;
}
