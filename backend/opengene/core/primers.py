"""Primer design and analysis backed by primer3-py.

Provides melting-temperature / GC calculation, hairpin and dimer warnings,
and a simple PCR-primer-pair design around a target region.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import primer3

from ..models import PlasmidRecord, Primer
from .sequence import (
    SequenceError,
    gc_content,
    reverse_complement,
    slice_circular,
    validate_sequence,
)


def _require_acgt(seq: str, what: str = "primer") -> None:
    """primer3's thermodynamics need definite bases; say so clearly instead of
    letting its ValueError surface as a server error."""
    ambiguous = sorted(set(seq) - set("ACGT"))
    if ambiguous:
        raise SequenceError(
            f"the {what} contains ambiguous bases ({', '.join(ambiguous)}), so its "
            "Tm and structure can't be calculated; use definite bases (A, C, G, T)"
        )


def _tm(seq: str, what: str) -> float:
    _require_acgt(seq, what)
    return primer3.calc_tm(seq)


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
    tm = round(_tm(seq, "primer"), 2)
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
    seq_a, seq_b = validate_sequence(seq_a), validate_sequence(seq_b)
    _require_acgt(seq_a)
    _require_acgt(seq_b)
    res = primer3.calc_heterodimer(seq_a, seq_b)
    return round(res.tm, 2) if res.structure_found else 0.0


def _grow_primer(
    template: str, start: int, length_min: int, length_max: int, target_tm: float,
) -> tuple[str, float]:
    """Extend an oligo from ``start`` until its Tm reaches ``target_tm``."""
    best_seq = template[start:start + length_min]
    best_tm = _tm(best_seq, "forward primer site")
    for ln in range(length_min, length_max + 1):
        candidate = template[start:start + ln]
        if len(candidate) < length_min:
            break
        if set(candidate) - set("ACGT"):
            break  # can't grow through an ambiguous base; keep the best so far
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
    first = reverse_complement(rev_region[-min_len:])
    best_rc, best_tm = first, _tm(first, "reverse primer site")
    for ln in range(min_len, max_len + 1):
        top = rev_region[-ln:] if ln <= len(rev_region) else rev_region
        cand = reverse_complement(top)
        if set(cand) - set("ACGT"):
            break  # can't grow through an ambiguous base; keep the best so far
        tm = primer3.calc_tm(cand)
        if abs(tm - target_tm) < abs(best_tm - target_tm):
            best_rc, best_tm = cand, tm
        if tm >= target_tm:
            best_rc, best_tm = cand, round(tm, 2)
            break
    rev_seq = best_rc

    fwd = Primer(
        name=unique_name(record, f"fwd {region_start % n + 1}"), sequence=fwd_seq,
        bindStart=region_start % n, bindEnd=(region_start + len(fwd_seq)) % n,
        strand=1, tm=round(fwd_tm, 2), gcContent=gc_content(fwd_seq),
    )
    rev = Primer(
        name=unique_name(record, f"rev {region_end % n or n}"), sequence=rev_seq,
        bindStart=(region_end - len(rev_seq)) % n, bindEnd=region_end % n,
        strand=-1, tm=round(best_tm, 2), gcContent=gc_content(rev_seq),
    )
    return fwd, rev


# --------------------------------------------------------------------------
# Saved primers: the oligos that belong to a record
# --------------------------------------------------------------------------

MAX_PRIMER_LENGTH = 200
MAX_PRIMER_NAME = 80


def clean_name(name: str) -> str:
    name = " ".join(name.split())
    if not name:
        raise SequenceError("a primer needs a name")
    if len(name) > MAX_PRIMER_NAME:
        raise SequenceError(f"a primer name can be at most {MAX_PRIMER_NAME} characters")
    return name


def unique_name(record: PlasmidRecord, wanted: str, ignore_id: str | None = None) -> str:
    """``wanted``, or ``wanted 2``, ``wanted 3``… if a primer already has that name."""
    taken = {p.name for p in record.primers if p.id != ignore_id}
    if wanted not in taken:
        return wanted
    k = 2
    while f"{wanted} {k}" in taken:
        k += 1
    return f"{wanted} {k}"


def clean_oligo(sequence: str) -> str:
    """A primer sequence as typed or pasted: spaces, digits and 5'/3' marks are
    dropped; what is left must be definite bases."""
    seq = "".join(c for c in sequence.upper() if c.isalpha())
    seq = validate_sequence(seq)
    if not seq:
        raise SequenceError("a primer needs a sequence")
    if len(seq) > MAX_PRIMER_LENGTH:
        raise SequenceError(f"a primer can be at most {MAX_PRIMER_LENGTH} nt")
    _require_acgt(seq)
    return seq


def make_primer(record: PlasmidRecord, name: str, sequence: str) -> Primer:
    """A new primer for ``record``, with its Tm, GC and binding site worked out."""
    from .sequence import bind_primer

    seq = clean_oligo(sequence)
    primer = Primer(
        name=clean_name(name),
        sequence=seq,
        tm=round(primer3.calc_tm(seq), 2),
        gcContent=gc_content(seq),
    )
    return bind_primer(record, primer)


def parse_primer_list(text: str) -> list[tuple[str, str]]:
    """``(name, sequence)`` pairs from pasted text or a file.

    Accepts FASTA (``>name`` then the sequence) or a table with one primer per
    line — name and sequence separated by a tab, comma or semicolon, as
    exported by spreadsheets and oligo order forms. A header row and extra
    columns are ignored. A line holding only a sequence gets a numbered name.
    """
    lines = [ln.strip() for ln in text.replace("\r", "\n").split("\n")]
    lines = [ln for ln in lines if ln]
    out: list[tuple[str, str]] = []
    if any(ln.startswith(">") for ln in lines):
        name, chunks = None, []
        for ln in lines + [">"]:
            if ln.startswith(">"):
                if name is not None and chunks:
                    out.append((name, "".join(chunks)))
                name, chunks = ln[1:].strip() or f"primer {len(out) + 1}", []
            elif name is not None:
                chunks.append(ln)
        return out
    for ln in lines:
        cells = [c.strip().strip('"') for c in _split_row(ln)]
        cells = [c for c in cells if c]
        if not cells:
            continue
        # The sequence is the first cell that reads as bases; the name is the
        # cell before it (or a number, if the line is a bare sequence).
        idx = next((i for i, c in enumerate(cells) if _looks_like_oligo(c)), None)
        if idx is None:
            continue  # a header row, or a line with no sequence
        name = cells[idx - 1] if idx > 0 else f"primer {len(out) + 1}"
        out.append((name, cells[idx]))
    return out


def _split_row(line: str) -> list[str]:
    for sep in ("\t", ";", ","):
        if sep in line:
            return line.split(sep)
    parts = line.rsplit(None, 1)  # "name sequence"
    return parts if len(parts) == 2 else [line]


def _looks_like_oligo(cell: str) -> bool:
    letters = "".join(c for c in cell.upper() if c.isalpha())
    spaced = cell.replace(" ", "").replace("-", "").replace("'", "")
    return len(letters) >= 6 and set(letters) <= set("ACGT") and all(
        c.isalpha() or c.isdigit() for c in spaced
    )


def primers_table(rows: list[tuple[str, PlasmidRecord, Primer]], fmt: str) -> tuple[str, str, str]:
    """Write primers out as ``csv`` or ``fasta``; ``rows`` are
    ``(record_name, record, primer)``. Returns (text, extension, media type)."""
    import csv
    import io

    if fmt == "fasta":
        body = "".join(f">{p.name}\n{p.sequence}\n" for _, _, p in rows)
        return body, "fasta", "text/x-fasta"
    if fmt != "csv":
        raise ValueError(f"unknown primer format {fmt!r}; use csv or fasta")
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["Name", "Sequence (5'-3')", "Length (nt)", "Tm (C)", "GC (%)", "Template", "Binds", "Strand"])
    for record_name, record, p in rows:
        if p.is_bound:
            last = p.bind_end if p.bind_end else record.length
            binds = f"{p.bind_start + 1}-{last}"
            strand = "+" if p.strand == 1 else "-"
        else:
            binds, strand = "does not bind", ""
        w.writerow([p.name, p.sequence, len(p.sequence), p.tm, p.gc_content, record_name, binds, strand])
    return buf.getvalue(), "csv", "text/csv"
