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


# Thresholds used when judging an oligo. They are the usual rules of thumb for
# PCR primers; the thermodynamics behind them (nearest-neighbour Tm, hairpin
# and dimer stability) come from primer3.
GC_RANGE = (40.0, 60.0)
LENGTH_RANGE = (18, 30)
STRUCTURE_TM_LIMIT = 45.0  # a hairpin or dimer above this competes with annealing
PAIR_TM_DIFFERENCE_LIMIT = 3.0
MAX_END_GC = 3  # G/C allowed in the last five bases before the 3' end is "sticky"


def _longest_run(seq: str) -> int:
    best = run = 0
    prev = ""
    for b in seq:
        run = run + 1 if b == prev else 1
        best = max(best, run)
        prev = b
    return best


def oligo_warnings(seq: str) -> list[str]:
    """What is wrong with an oligo in itself, whatever it is used on."""
    hairpin = primer3.calc_hairpin(seq)
    homodimer = primer3.calc_homodimer(seq)
    gc = gc_content(seq)
    warnings: list[str] = []
    if hairpin.structure_found and hairpin.tm > STRUCTURE_TM_LIMIT:
        warnings.append(f"strong hairpin (Tm {hairpin.tm:.1f}C)")
    if homodimer.structure_found and homodimer.tm > STRUCTURE_TM_LIMIT:
        warnings.append(f"strong self-dimer (Tm {homodimer.tm:.1f}C)")
    if not GC_RANGE[0] <= gc <= GC_RANGE[1]:
        warnings.append(f"GC content {gc}% outside {GC_RANGE[0]:.0f}-{GC_RANGE[1]:.0f}%")
    if not LENGTH_RANGE[0] <= len(seq) <= LENGTH_RANGE[1]:
        warnings.append(f"length {len(seq)} outside {LENGTH_RANGE[0]}-{LENGTH_RANGE[1]} nt")
    if sum(1 for b in seq[-5:] if b in "GC") > MAX_END_GC:
        warnings.append(f"GC clamp too strong (>{MAX_END_GC} G/C in last 5 nt)")
    if _longest_run(seq) > 4:
        warnings.append(f"run of {_longest_run(seq)} identical bases")
    return warnings


def analyze_primer(seq: str, target_tm: float | None = 60.0) -> PrimerAnalysis:
    """Compute Tm, GC, and structural warnings for a single oligo."""
    seq = validate_sequence(seq)
    tm = round(_tm(seq, "primer"), 2)
    hairpin = primer3.calc_hairpin(seq)
    homodimer = primer3.calc_homodimer(seq)
    gc = gc_content(seq)

    warnings = oligo_warnings(seq)
    if target_tm is not None and abs(tm - target_tm) > 5:
        warnings.append(f"Tm {tm}C far from target {target_tm}C")

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


@dataclass
class PrimerPair:
    forward: Primer
    reverse: Primer
    product_size: int
    # Things about the *pair* the user should know: a Tm mismatch, a dimer
    # between the two, or that no pair met the usual criteria here.
    warnings: list[str] = field(default_factory=list)


MIN_PRODUCT = 60  # shorter than this leaves no room for two primers
FLANK = 250  # how far outside the selection a flanking primer may sit


def _run_primer3(seq_args: dict, global_args: dict) -> dict:
    return primer3.design_primers(seq_args, global_args)


def design_primer_pair(
    record: PlasmidRecord,
    region_start: int,
    region_end: int,
    target_tm: float = 60.0,
    mode: str = "exact",
) -> PrimerPair:
    """Design a PCR primer pair for ``[region_start, region_end)`` with primer3.

    ``mode`` says what the product should be:

    * ``"exact"`` — the product is exactly the region (cloning a gene, say):
      the primers start at its two ends and primer3 chooses how long each
      should be.
    * ``"flank"`` — the product contains the region (checking an insert, or
      sequencing across it): primer3 searches up to ``FLANK`` bp either side
      for the best-placed pair.

    primer3 scores every candidate on Tm against the target, GC content, 3'
    end stability, hairpins and self-dimers, and each pair on Tm match and
    cross-dimers. If nothing passes its limits the least-bad pair is returned
    with warnings saying what is wrong with it.
    """
    if mode not in ("exact", "flank"):
        raise SequenceError(f"unknown design mode {mode!r}; use 'exact' or 'flank'")
    seq = record.sequence
    n = len(seq)
    if n == 0:
        raise SequenceError("there is no sequence to design primers on")
    start = region_start % n
    if region_start == region_end:
        length = 0  # a cursor, not a span
    elif region_end > region_start:
        length = region_end - region_start
    elif record.is_circular:
        length = n - region_start + region_end  # the region wraps the origin
    else:
        length = 0
    if length <= 0 or length > n:
        raise SequenceError("select the region to amplify first")
    if length < MIN_PRODUCT:
        raise SequenceError(
            f"select at least {MIN_PRODUCT} bp: a shorter product leaves no room for two primers"
        )

    # A linear window onto the record with the region ``offset`` bases in, so a
    # region (or a flank) that crosses the origin of a circle is contiguous.
    if record.is_circular:
        flank = min(FLANK, (n - length) // 2) if mode == "flank" else 0
        lo = (start - flank) % n
        window = slice_circular(seq + seq, lo, lo + length + 2 * flank)
        offset = flank
    else:
        flank = FLANK if mode == "flank" else 0
        lo = max(0, start - flank)
        hi = min(n, start + length + flank)
        window = seq[lo:hi]
        offset = start - lo
    # primer3 handles A, C, G, T and N; other IUPAC codes become N, which it
    # will not place a primer over.
    template = "".join(b if b in "ACGT" else "N" for b in window)

    seq_args: dict = {"SEQUENCE_ID": record.name or "record", "SEQUENCE_TEMPLATE": template}
    if mode == "exact":
        seq_args["SEQUENCE_FORCE_LEFT_START"] = offset
        seq_args["SEQUENCE_FORCE_RIGHT_START"] = offset + length - 1
        product_range = [[length, length]]
    else:
        seq_args["SEQUENCE_TARGET"] = [offset, length]
        product_range = [[length, len(template)]]

    strict = {
        "PRIMER_NUM_RETURN": 1,
        "PRIMER_PRODUCT_SIZE_RANGE": product_range,
        "PRIMER_MIN_SIZE": LENGTH_RANGE[0],
        "PRIMER_OPT_SIZE": 20,
        "PRIMER_MAX_SIZE": LENGTH_RANGE[1],
        "PRIMER_OPT_TM": target_tm,
        "PRIMER_MIN_TM": target_tm - 3,
        "PRIMER_MAX_TM": target_tm + 3,
        "PRIMER_PAIR_MAX_DIFF_TM": PAIR_TM_DIFFERENCE_LIMIT,
        "PRIMER_MIN_GC": GC_RANGE[0],
        "PRIMER_MAX_GC": GC_RANGE[1],
        "PRIMER_MAX_END_GC": MAX_END_GC,
        "PRIMER_MAX_POLY_X": 4,
        "PRIMER_MAX_NS_ACCEPTED": 0,
        "PRIMER_MAX_HAIRPIN_TH": STRUCTURE_TM_LIMIT,
        "PRIMER_MAX_SELF_ANY_TH": STRUCTURE_TM_LIMIT,
        "PRIMER_MAX_SELF_END_TH": STRUCTURE_TM_LIMIT,
        "PRIMER_PAIR_MAX_COMPL_ANY_TH": STRUCTURE_TM_LIMIT,
        "PRIMER_PAIR_MAX_COMPL_END_TH": STRUCTURE_TM_LIMIT,
    }
    result = _run_primer3(seq_args, strict)
    relaxed = False
    if not result.get("PRIMER_PAIR_NUM_RETURNED"):
        # Nothing passes the usual limits here. Ask for the least-bad pair
        # instead, and carry the reasons back as warnings.
        relaxed = True
        result = _run_primer3(
            seq_args,
            {
                **strict,
                "PRIMER_PICK_ANYWAY": 1,
                "PRIMER_MIN_TM": target_tm - 15,
                "PRIMER_MAX_TM": target_tm + 15,
                "PRIMER_PAIR_MAX_DIFF_TM": 30,
                "PRIMER_MIN_GC": 20,
                "PRIMER_MAX_GC": 80,
                "PRIMER_MAX_END_GC": 5,
                "PRIMER_MAX_POLY_X": 8,
            },
        )
    if not result.get("PRIMER_PAIR_NUM_RETURNED"):
        why = "; ".join(
            f"{side}: {result.get(key, 'no candidates')}"
            for side, key in (
                ("forward", "PRIMER_LEFT_EXPLAIN"),
                ("reverse", "PRIMER_RIGHT_EXPLAIN"),
            )
        )
        raise SequenceError(
            "no usable primer pair here"
            + (" (ambiguous bases at the ends of the region?)" if "N" in template else "")
            + f". primer3 reports — {why}"
        )

    fwd_seq = result["PRIMER_LEFT_0_SEQUENCE"]
    rev_seq = result["PRIMER_RIGHT_0_SEQUENCE"]
    # PICK_ANYWAY can hand back a primer over an ambiguous (N) stretch; such a
    # primer can't be ordered, so refuse rather than return it.
    if "N" in fwd_seq or "N" in rev_seq:
        raise SequenceError(
            "no usable primer pair here: the ends of the region contain ambiguous "
            "bases, which a primer can't be designed over"
        )
    fwd = Primer(
        name=unique_name(record, f"fwd {start + 1}"),
        sequence=fwd_seq,
        strand=1,
        tm=round(result["PRIMER_LEFT_0_TM"], 2),
        gcContent=round(result["PRIMER_LEFT_0_GC_PERCENT"], 1),
        warnings=oligo_warnings(fwd_seq),
    )
    rev = Primer(
        name=unique_name(record, f"rev {(start + length - 1) % n + 1}"),
        sequence=rev_seq,
        strand=-1,
        tm=round(result["PRIMER_RIGHT_0_TM"], 2),
        gcContent=round(result["PRIMER_RIGHT_0_GC_PERCENT"], 1),
        warnings=oligo_warnings(rev_seq),
    )

    warnings: list[str] = []
    if relaxed:
        warnings.append("no pair met the usual criteria here; this is the best primer3 could do")
    if abs(fwd.tm - rev.tm) > PAIR_TM_DIFFERENCE_LIMIT:
        warnings.append(f"the two primers' Tms differ by {abs(fwd.tm - rev.tm):.1f}C")
    cross = max(result.get("PRIMER_PAIR_0_COMPL_ANY_TH", 0), result.get("PRIMER_PAIR_0_COMPL_END_TH", 0))
    if cross > STRUCTURE_TM_LIMIT:
        warnings.append(f"the two primers can form a dimer (Tm {cross:.1f}C)")

    return PrimerPair(
        forward=fwd,
        reverse=rev,
        product_size=int(result.get("PRIMER_PAIR_0_PRODUCT_SIZE", length)),
        warnings=warnings,
    )


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
