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
from typing import Iterable, Literal

from Bio.Seq import Seq

from ..models import Feature, FeatureType, HistoryEvent, PlasmidRecord

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


def _record_history(
    record: PlasmidRecord, op: str, description: str, warnings: list[str] | None = None
) -> None:
    record.history.append(
        HistoryEvent(
            op=op,
            description=description,
            timestamp=time.time(),
            warnings=list(warnings or []),
        )
    )


# --------------------------------------------------------------------------
# Reading-frame guard
# --------------------------------------------------------------------------
#
# Spec, "Frame-Shift Safety Check": an edit inside a CDS must keep the CDS
# length a multiple of 3, or the backend must reject it or pad it with an
# explicit warning. Policies:
#   reject (default) - raise FrameShiftError, nothing changes
#   pad              - extend the inserted bases with N up to a whole codon
#   allow            - apply as asked, record a warning in the history

FramePolicy = Literal["reject", "pad", "allow"]
FRAME_POLICIES = ("reject", "pad", "allow")


class FrameShiftError(SequenceError):
    """Raised when an edit would shift the reading frame of a CDS."""


def _segments(start: int, end: int, n: int) -> list[tuple[int, int]]:
    """Linear pieces of a half-open interval that may wrap the origin."""
    if start < end:
        return [(start, end)]
    if start > end:
        return [(start, n), (0, end)]
    return []


def _overlap(a: list[tuple[int, int]], b: list[tuple[int, int]]) -> int:
    return sum(max(0, min(a1, b1) - max(a0, b0)) for a0, a1 in a for b0, b1 in b)


def _cds_features(record: PlasmidRecord) -> list[Feature]:
    return [f for f in record.features if f.type == FeatureType.cds]


def _cds_containing(record: PlasmidRecord, pos: int) -> list[Feature]:
    """CDS features with ``pos`` strictly inside them (not on a boundary)."""
    n = record.length
    hits: list[Feature] = []
    for f in _cds_features(record):
        span = f.length(n)
        if n and span > 0 and 0 < (pos - f.start) % n < span:
            hits.append(f)
    return hits


def _cds_cut(record: PlasmidRecord, start: int, end: int) -> list[tuple[Feature, int]]:
    """CDS features partly removed by deleting ``[start, end)``, with the
    number of their bases removed. A CDS deleted entirely is not listed: it is
    gone, so it has no frame left to shift."""
    n = record.length
    cut = _segments(start, end, n)
    hits: list[tuple[Feature, int]] = []
    for f in _cds_features(record):
        removed = _overlap(cut, _segments(f.start, f.end, n))
        if 0 < removed < f.length(n):
            hits.append((f, removed))
    return hits


def _check_policy(policy: str) -> None:
    if policy not in FRAME_POLICIES:
        raise SequenceError(
            f"unknown frame_policy {policy!r}; use one of {', '.join(FRAME_POLICIES)}"
        )


def _resolve_frame(
    policy: str, problem: str, delta: int, inserted: str | None
) -> tuple[str | None, list[str]]:
    """Apply the frame policy to a violation. Returns the (possibly padded)
    inserted sequence and any warnings to record."""
    if policy == "allow":
        return inserted, [f"frameshift allowed: {problem}"]
    if policy == "pad":
        if inserted is None:
            raise FrameShiftError(
                f"{problem}. Padding only applies to inserted bases; delete a "
                "multiple of 3 bp instead, or choose to allow the frameshift."
            )
        k = (-delta) % 3
        return inserted + "N" * k, [
            f"padded with {k} N to keep the reading frame ({problem}); "
            "replace the N bases with the sequence you intend"
        ]
    raise FrameShiftError(
        f"{problem}, so it would shift the reading frame. Use a multiple of 3 bp, "
        "or choose to pad the insert or allow the frameshift."
    )


def _names(features: Iterable[Feature]) -> str:
    return ", ".join(sorted({f.name for f in features}))


# --------------------------------------------------------------------------
# Raw edits (no checks, no history) — shared by the public operations
# --------------------------------------------------------------------------

def _insert_raw(record: PlasmidRecord, pos: int, seq: str) -> None:
    old_len = record.length
    record.sequence = record.sequence[:pos] + seq + record.sequence[pos:]
    record.features = _adjust_features(record.features, pos, len(seq), old_len)


def _delete_raw(record: PlasmidRecord, start: int, end: int) -> None:
    n = record.length
    if start > end:
        # Wrapping span: keep [end, start). The kept sequence now begins at the
        # old index `end`, so coordinates are rebuilt relative to that origin.
        record.sequence = record.sequence[end:start]
        record.features = _adjust_features(record.features, 0, -end, n)
        record.features = _adjust_features(
            record.features, start - end, -(n - start), n - end
        )
        return
    record.sequence = record.sequence[:start] + record.sequence[end:]
    record.features = _adjust_features(record.features, start, -(end - start), n)


def _check_range(record: PlasmidRecord, start: int, end: int) -> None:
    n = record.length
    if not (0 <= start <= n and 0 <= end <= n):
        raise SequenceError(f"range [{start},{end}) out of bounds for length {n}")
    if start > end and not record.is_circular:
        raise SequenceError("wrap-around range requires a circular sequence")


# --------------------------------------------------------------------------
# CRUD operations
# --------------------------------------------------------------------------

def insert(
    record: PlasmidRecord,
    position: int,
    insert_seq: str,
    frame_policy: FramePolicy = "reject",
) -> PlasmidRecord:
    """Insert ``insert_seq`` before ``position`` (0-indexed)."""
    _check_policy(frame_policy)
    insert_seq = validate_sequence(insert_seq)
    if not insert_seq:
        raise SequenceError("nothing to insert")
    pos = normalize_index(position, record.length, record.is_circular)

    warnings: list[str] = []
    affected = _cds_containing(record, pos)
    if affected and len(insert_seq) % 3:
        problem = (
            f"inserting {len(insert_seq)} bp at {pos} changes {_names(affected)} "
            f"by +{len(insert_seq)} bp, not a multiple of 3"
        )
        insert_seq, warnings = _resolve_frame(
            frame_policy, problem, len(insert_seq), insert_seq
        )

    _insert_raw(record, pos, insert_seq)
    _record_history(
        record, "insert", f"inserted {len(insert_seq)} bp at {pos}", warnings
    )
    return record


def delete(
    record: PlasmidRecord,
    start: int,
    end: int,
    frame_policy: FramePolicy = "reject",
) -> PlasmidRecord:
    """Delete bases in ``[start, end)``. Supports wrap-around when start > end."""
    _check_policy(frame_policy)
    n = record.length
    if n == 0:
        raise SequenceError("cannot delete from empty sequence")
    _check_range(record, start, end)
    if start == end:
        raise SequenceError("nothing to delete: empty range")

    warnings: list[str] = []
    shifted = [(f, k) for f, k in _cds_cut(record, start, end) if k % 3]
    if shifted:
        detail = ", ".join(f"{f.name} by -{k} bp" for f, k in shifted)
        problem = f"deleting [{start},{end}) changes {detail}, not a multiple of 3"
        _, warnings = _resolve_frame(frame_policy, problem, 0, None)

    removed = sum(b - a for a, b in _segments(start, end, n))
    _delete_raw(record, start, end)
    where = "spanning origin" if start > end else f"at [{start},{end})"
    _record_history(record, "delete", f"deleted {removed} bp {where}", warnings)
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
    record: PlasmidRecord,
    start: int,
    end: int,
    replacement: str,
    frame_policy: FramePolicy = "reject",
) -> PlasmidRecord:
    """Replace ``[start, end)`` with ``replacement``.

    The frame check looks at the *net* length change, so swapping a codon for
    a codon passes even though it is done as a delete followed by an insert.
    """
    _check_policy(frame_policy)
    replacement = validate_sequence(replacement)
    n = record.length
    _check_range(record, start, end)
    if start == end:
        return insert(record, start, replacement, frame_policy)

    removed = sum(b - a for a, b in _segments(start, end, n))
    delta = len(replacement) - removed

    warnings: list[str] = []
    affected = [f for f, _ in _cds_cut(record, start, end)]
    if affected and delta % 3:
        problem = (
            f"replacing [{start},{end}) changes {_names(affected)} by {delta:+d} bp, "
            "not a multiple of 3"
        )
        replacement, warnings = _resolve_frame(frame_policy, problem, delta, replacement)

    _delete_raw(record, start, end)
    # After a wrapping delete the kept sequence starts at the old `end`, so the
    # gap left by the deletion sits at the very end of it.
    at = start if start < end else record.length
    _insert_raw(record, at, replacement)
    _record_history(
        record,
        "replace",
        f"replaced {removed} bp at [{start},{end}) with {len(replacement)} bp",
        warnings,
    )
    return record


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
