"""Primer design and analysis backed by primer3-py.

Provides melting-temperature / GC calculation, hairpin and dimer warnings,
and a simple PCR-primer-pair design around a target region.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import primer3

from ..models import PlasmidRecord, Primer
from .sequence import gc_content, reverse_complement, slice_circular, validate_sequence


@dataclass
class PrimerAnalysis:
    sequence: str
    tm: float
    gc_content: float
    length: int
    hairpin_tm: float
    homodimer_tm: float
    warnings: list[str] = field(default_factory=list)


def analyze_primer(seq: str, target_tm: float = 60.0) -> PrimerAnalysis:
    """Compute Tm, GC, and structural warnings for a single oligo."""
    seq = validate_sequence(seq)
    tm = round(primer3.calc_tm(seq), 2)
    hairpin = primer3.calc_hairpin(seq)
    homodimer = primer3.calc_homodimer(seq)
    gc = gc_content(seq)

    warnings: list[str] = []
    if hairpin.structure_found and hairpin.tm > 45:
        warnings.append(f"strong hairpin (Tm {hairpin.tm:.1f}C)")
    if homodimer.structure_found and homodimer.tm > 45:
        warnings.append(f"strong self-dimer (Tm {homodimer.tm:.1f}C)")
    if gc < 40 or gc > 60:
        warnings.append(f"GC content {gc}% outside 40-60%")
    if not (18 <= len(seq) <= 30):
        warnings.append(f"length {len(seq)} outside 18-30 nt")
    if abs(tm - target_tm) > 5:
        warnings.append(f"Tm {tm}C far from target {target_tm}C")
    last5 = seq[-5:]
    if sum(1 for b in last5 if b in "GC") >= 4:
        warnings.append("GC clamp too strong (>=4 G/C in last 5 nt)")

    return PrimerAnalysis(
        sequence=seq,
        tm=tm,
        gc_content=gc,
        length=len(seq),
        hairpin_tm=round(hairpin.tm, 2) if hairpin.structure_found else 0.0,
        homodimer_tm=round(homodimer.tm, 2) if homodimer.structure_found else 0.0,
        warnings=warnings,
    )


def heterodimer_tm(seq_a: str, seq_b: str) -> float:
    res = primer3.calc_heterodimer(validate_sequence(seq_a), validate_sequence(seq_b))
    return round(res.tm, 2) if res.structure_found else 0.0


def _grow_primer(
    template: str, start: int, length_min: int, length_max: int, target_tm: float,
) -> tuple[str, float]:
    """Extend an oligo from ``start`` until its Tm reaches ``target_tm``."""
    best_seq = template[start:start + length_min]
    best_tm = primer3.calc_tm(best_seq)
    for ln in range(length_min, length_max + 1):
        candidate = template[start:start + ln]
        if len(candidate) < length_min:
            break
        tm = primer3.calc_tm(candidate)
        if abs(tm - target_tm) < abs(best_tm - target_tm):
            best_seq, best_tm = candidate, tm
        if tm >= target_tm:
            best_seq, best_tm = candidate, tm
            break
    return best_seq, round(best_tm, 2)


def design_primer_pair(
    record: PlasmidRecord,
    region_start: int,
    region_end: int,
    target_tm: float = 60.0,
    min_len: int = 18,
    max_len: int = 30,
) -> tuple[Primer, Primer]:
    """Design forward/reverse primers flanking ``[region_start, region_end)``.

    The forward primer binds the top strand starting at ``region_start``; the
    reverse primer is the reverse-complement of the top strand ending at
    ``region_end``.
    """
    seq = record.sequence
    n = len(seq)

    fwd_template = slice_circular(seq, region_start, region_start + max_len) \
        if record.is_circular else seq[region_start:region_start + max_len]
    fwd_seq, fwd_tm = _grow_primer(fwd_template, 0, min_len, max_len, target_tm)

    # Reverse primer: take top-strand bases ending at region_end, then revcomp.
    rev_region = slice_circular(seq, region_end - max_len, region_end) \
        if record.is_circular else seq[max(0, region_end - max_len):region_end]
    rev_top = rev_region[::-1]  # grow from the 3' end inward
    best_rc, best_tm = rev_top[:min_len], primer3.calc_tm(reverse_complement(rev_top[:min_len]))
    for ln in range(min_len, max_len + 1):
        top = rev_region[-ln:] if ln <= len(rev_region) else rev_region
        cand = reverse_complement(top)
        tm = primer3.calc_tm(cand)
        if abs(tm - target_tm) < abs(best_tm - target_tm):
            best_rc, best_tm = cand, tm
        if tm >= target_tm:
            best_rc, best_tm = cand, round(tm, 2)
            break
    rev_seq = best_rc

    fwd = Primer(
        name="fwd", sequence=fwd_seq,
        bindStart=region_start % n, bindEnd=(region_start + len(fwd_seq)) % n,
        strand=1, tm=round(fwd_tm, 2), gcContent=gc_content(fwd_seq),
    )
    rev = Primer(
        name="rev", sequence=rev_seq,
        bindStart=(region_end - len(rev_seq)) % n, bindEnd=region_end % n,
        strand=-1, tm=round(best_tm, 2), gcContent=gc_content(rev_seq),
    )
    return fwd, rev
