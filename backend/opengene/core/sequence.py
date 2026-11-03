"""Deterministic sequence editing engine.

All mutations are routed through these functions, which validate via
``Bio.Seq`` before returning. Per the specification's *Sequence Invariant*,
no sequence string produced elsewhere (e.g. by an LLM) may mutate state
without passing through :func:`validate_sequence` here.

Coordinates are 0-indexed, half-open ``[start, end)``. Insertions and
deletions correctly shift downstream feature coordinates and respect circular
origin wrapping.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterable

from Bio.Seq import Seq

from ..models import Feature, HistoryEvent, PlasmidRecord

VALID_BASES = set("ACGTN")
STOP_CODONS = {"TAA", "TAG", "TGA"}
START_CODON = "ATG"


class SequenceError(ValueError):
    """Raised for invalid sequence operations."""


# --------------------------------------------------------------------------
# Validation and primitives
# --------------------------------------------------------------------------

def validate_sequence(seq: str) -> str:
    """Normalize and validate a nucleotide string via Biopython.

    Uppercases, maps RNA ``U`` to ``T``, and rejects any non-ACGTN base.
    Returns the canonical string.
    """
    seq = seq.upper().replace("U", "T")
    bad = sorted(set(seq) - VALID_BASES)
    if bad:
        raise SequenceError(f"invalid bases: {bad}")
    # Round-trip through Bio.Seq so malformed input is caught consistently.
    return str(Seq(seq))


def reverse_complement(seq: str) -> str:
    return str(Seq(validate_sequence(seq)).reverse_complement())


def gc_content(seq: str) -> float:
    seq = seq.upper()
    if not seq:
        return 0.0
    gc = sum(1 for b in seq if b in "GC")
    return round(100.0 * gc / len(seq), 2)


# --------------------------------------------------------------------------
# Circular index helpers
# --------------------------------------------------------------------------

def normalize_index(index: int, length: int, circular: bool) -> int:
    """Clamp or wrap an index into a valid insertion position ``[0, length]``."""
    if circular and length > 0:
        return index % length
    if index < 0 or index > length:
        raise SequenceError(f"index {index} out of range for length {length}")
    return index


def slice_circular(seq: str, start: int, end: int) -> str:
    """Return ``seq[start:end]`` with wrap-around when ``start > end``."""
    n = len(seq)
    start %= n if n else 1
    end %= n if n else 1
    if start <= end:
        return seq[start:end]
    return seq[start:] + seq[:end]


# --------------------------------------------------------------------------
# Feature coordinate maintenance
# --------------------------------------------------------------------------

def _shift_point(pos: int, at: int, delta: int, old_len: int) -> int:
    """Shift a single coordinate for an insert/delete of ``delta`` at ``at``."""
    if delta >= 0:  # insertion
        # Coordinates strictly past the insertion point shift; a coordinate
        # sitting exactly on the insertion point stays, so inserted bases fall
        # outside an existing feature's boundary rather than silently extending
        # it. (An insert strictly inside a feature is absorbed, as its end > at.)
        return pos + delta if pos > at else pos
    # deletion of abs(delta) bases starting at `at`
    removed = -delta
    end_del = at + removed
    if pos <= at:
        return pos
    if pos >= end_del:
        return pos + delta
    return at  # position fell inside the deleted span


def _adjust_features(
    features: Iterable[Feature], at: int, delta: int, old_len: int
) -> list[Feature]:
    adjusted: list[Feature] = []
    for f in features:
        new_start = _shift_point(f.start, at, delta, old_len)
        new_end = _shift_point(f.end, at, delta, old_len)
        nf = f.model_copy(update={"start": new_start, "end": new_end})
        adjusted.append(nf)
    return adjusted


def _record_history(record: PlasmidRecord, op: str, description: str) -> None:
    record.history.append(
        HistoryEvent(op=op, description=description, timestamp=time.time())
    )


# --------------------------------------------------------------------------
# CRUD operations
# --------------------------------------------------------------------------

def insert(record: PlasmidRecord, position: int, insert_seq: str) -> PlasmidRecord:
    """Insert ``insert_seq`` before ``position`` (0-indexed)."""
    insert_seq = validate_sequence(insert_seq)
    pos = normalize_index(position, record.length, record.is_circular)
    new_seq = record.sequence[:pos] + insert_seq + record.sequence[pos:]
    record.sequence = new_seq
    record.features = _adjust_features(
        record.features, pos, len(insert_seq), record.length - len(insert_seq)
    )
    _record_history(
        record, "insert", f"inserted {len(insert_seq)} bp at {pos}"
    )
    return record


def delete(record: PlasmidRecord, start: int, end: int) -> PlasmidRecord:
    """Delete bases in ``[start, end)``. Supports wrap-around when start > end."""
    n = record.length
    if n == 0:
        raise SequenceError("cannot delete from empty sequence")
    if start > end:
        if not record.is_circular:
            raise SequenceError("wrap-around delete requires a circular sequence")
        # delete the wrapping span in two pieces; normalize to the tail+head form
        removed = (n - start) + end
        record.sequence = record.sequence[end:start]
        # Everything shifts: rebuild feature coords relative to the new origin.
        record.features = _adjust_features(record.features, 0, -end, n)
        record.features = _adjust_features(
            record.features, start - end, -(n - start), n - end
        )
        _record_history(record, "delete", f"deleted {removed} bp spanning origin")
        return record

    removed = end - start
    record.sequence = record.sequence[:start] + record.sequence[end:]
    record.features = _adjust_features(record.features, start, -removed, n)
    _record_history(record, "delete", f"deleted {removed} bp at [{start},{end})")
    return record


def mutate(record: PlasmidRecord, position: int, new_base: str) -> PlasmidRecord:
    """Substitute a single base at ``position``."""
    new_base = validate_sequence(new_base)
    if len(new_base) != 1:
        raise SequenceError("mutate expects exactly one base")
    if position < 0 or position >= record.length:
        raise SequenceError(f"position {position} out of range")
    old = record.sequence[position]
    record.sequence = (
        record.sequence[:position] + new_base + record.sequence[position + 1:]
    )
    _record_history(
        record, "mutate", f"{old}>{new_base} at {position}"
    )
    return record


def replace_range(
    record: PlasmidRecord, start: int, end: int, replacement: str
) -> PlasmidRecord:
    """Replace ``[start, end)`` with ``replacement`` (delete + insert)."""
    replacement = validate_sequence(replacement)
    delete(record, start, end)
    return insert(record, start, replacement)


def reverse_complement_record(record: PlasmidRecord) -> PlasmidRecord:
    """Reverse-complement the whole record, flipping feature coordinates."""
    n = record.length
    record.sequence = reverse_complement(record.sequence)
    flipped: list[Feature] = []
    for f in record.features:
        new_start = n - f.end
        new_end = n - f.start
        flipped.append(
            f.model_copy(
                update={
                    "start": new_start,
                    "end": new_end,
                    "strand": -f.strand,
                }
            )
        )
    record.features = flipped
    _record_history(record, "reverse_complement", "reverse-complemented record")
    return record


# --------------------------------------------------------------------------
# ORF detection across 6 reading frames
# --------------------------------------------------------------------------

@dataclass
class ORF:
    start: int  # 0-indexed, forward-strand coordinate of first base of ATG
    end: int  # 0-indexed exclusive, forward-strand coordinate after stop
    strand: int
    frame: int  # 0, 1, or 2 relative to its strand's 5' end
    length_bp: int
    protein: str


def find_orfs(
    record: PlasmidRecord, min_aa: int = 30
) -> list[ORF]:
    """Find ORFs across all six reading frames.

    For circular records the sequence is scanned with a doubled window so ORFs
    crossing the origin are detected. ``min_aa`` filters short spurious ORFs.
    """
    seq = record.sequence
    n = len(seq)
    if n == 0:
        return []

    orfs: list[ORF] = []
    search_seq = seq + seq if record.is_circular else seq
    limit = n if record.is_circular else n

    for strand in (1, -1):
        s = search_seq if strand == 1 else reverse_complement(search_seq)
        slen = len(s)
        for frame in range(3):
            i = frame
            while i < slen - 2:
                if s[i:i + 3] == START_CODON:
                    j = i
                    while j < slen - 2:
                        codon = s[j:j + 3]
                        if codon in STOP_CODONS:
                            orf_len = j + 3 - i
                            prot = str(Seq(s[i:j + 3]).translate(to_stop=True))
                            if len(prot) >= min_aa and i < limit:
                                orfs.append(
                                    _to_forward_orf(
                                        i, j + 3, strand, frame, orf_len, prot, n,
                                        record.is_circular,
                                    )
                                )
                            i = j  # continue search after this ORF's start
                            break
                        j += 3
                    else:
                        break
                i += 3

    # Deduplicate (circular doubling can produce equivalents) and sort.
    seen = set()
    unique: list[ORF] = []
    for o in sorted(orfs, key=lambda x: (x.start, x.strand, -x.length_bp)):
        key = (o.start % n, o.strand, o.length_bp)
        if key not in seen:
            seen.add(key)
            unique.append(o)
    return unique


def _to_forward_orf(
    i: int, j: int, strand: int, frame: int, orf_len: int,
    prot: str, n: int, circular: bool,
) -> ORF:
    """Map coordinates found on the (possibly reverse) search strand back to
    forward-strand 0-indexed coordinates."""
    if strand == 1:
        start, end = i % n, j % n
    else:
        # positions on reverse strand of doubled seq map back to forward coords
        total = 2 * n if circular else n
        start = (total - j) % n
        end = (total - i) % n
    return ORF(
        start=start, end=end, strand=strand, frame=frame,
        length_bp=orf_len, protein=prot,
    )
