// How a saved primer's binding is described to the user.
import { rangeLabel } from "./coords";
import type { Primer } from "./types";

/** A primer that binds: its site is known. */
export type BoundPrimer = Primer & { bindStart: number; bindEnd: number };

export function isBound(p: Pick<Primer, "bindStart" | "bindEnd">): p is BoundPrimer {
  return p.bindStart !== null && p.bindEnd !== null;
}

export interface Binding {
  bound: boolean;
  /** Short text for a list row: "21–40 +", "2 sites", "doesn't bind". */
  text: string;
  /** The longer explanation, for a tooltip. */
  detail: string;
  /** True when the user should look twice (no site, or more than one). */
  warn: boolean;
}

export function primerBinding(
  p: Pick<Primer, "bindStart" | "bindEnd" | "strand" | "sequence" | "bindingSites">,
  length: number,
): Binding {
  if (!isBound(p)) {
    return {
      bound: false,
      text: "doesn’t bind",
      detail: "No part of this primer’s 3′ end matches this sequence.",
      warn: true,
    };
  }
  const range = rangeLabel(p.bindStart, p.bindEnd, length);
  const strand = p.strand === 1 ? "+" : "−";
  const annealed =
    p.bindEnd >= p.bindStart ? p.bindEnd - p.bindStart : length - p.bindStart + p.bindEnd;
  const tail = p.sequence.length - annealed;
  const sites = p.bindingSites ?? 1;
  const notes = [
    `Binds bases ${range} on the ${p.strand === 1 ? "top" : "bottom"} strand.`,
    tail > 0 ? `${annealed} of its ${p.sequence.length} nt anneal; the 5′ ${tail} nt don’t match.` : "",
    sites > 1 ? `Its site occurs ${sites} times in this sequence.` : "",
  ].filter(Boolean);
  return {
    bound: true,
    text: sites > 1 ? `${range} ${strand} · ${sites} sites` : `${range} ${strand}`,
    detail: notes.join(" "),
    warn: sites > 1,
  };
}
