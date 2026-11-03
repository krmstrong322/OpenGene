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
#
# Every edit is "replace the half-open range [a, b) with L new bases": an
# insert has a == b, a delete has L == 0. All three go through one set of
# coordinate rules, and the reading-frame guard replays the same edit on a
# copy, so the guard can never disagree with what the edit actually does.
#
#   feature start x:  x < a  -> x      a <= x < b  -> a       x >= b -> shifted
#   feature end   x:  x <= a -> x      a < x <= b  -> a + L   x > b  -> shifted
#
# Consequences: an insert exactly at a feature's start lands before it, an
# insert exactly at its end lands after it, new bases that replace part of a
# feature become part of it, and a feature lying entirely inside [a, b) is
# removed, because it was replaced.


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


def _segments(start: int, end: int, n: int) -> list[tuple[int, int]]:
    """Linear pieces of a half-open interval that may wrap the origin."""
    if start < end:
        return [(start, end)]
    if start > end:
        return [(start, n), (0, end)]
    return []


def _overlap(a: list[tuple[int, int]], b: list[tuple[int, int]]) -> int:
    return sum(max(0, min(a1, b1) - max(a0, b0)) for a0, a1 in a for b0, b1 in b)


def _map_start(x: int, a: int, b: int, length: int) -> int:
    if x < a:
        return x
    if x < b:
        return a
    return x + length - (b - a)


def _map_end(x: int, a: int, b: int, length: int) -> int:
    if x <= a:
        return x
    if x <= b:
        return a + length
    return x + length - (b - a)


def _replace_linear(record: PlasmidRecord, a: int, b: int, seq: str) -> list[Feature]:
    """Replace ``[a, b)`` (a <= b) with ``seq``. Returns features it removed."""
    n = record.length
    new_n = n - (b - a) + len(seq)
    edit = _segments(a, b, n)
    kept: list[Feature] = []
    removed: list[Feature] = []
    for f in record.features:
        span = f.length(n)
        if span == 0:
            # A point (zero-length) feature: both ends move together, or the
            # separate start/end rules would stretch it over the new bases.
            point = _map_start(f.start, a, b, len(seq))
            if record.is_circular and new_n:
                point %= new_n
            kept.append(f.model_copy(update={"start": point, "end": point}))
            continue
        if _overlap(edit, _segments(f.start, f.end, n)) >= span:
            removed.append(f)
            continue
        if a <= f.start < b and a < f.end <= b:
            # Only an origin-wrapping feature can have both ends inside the
            # range without being covered: what survives is the part outside
            # [a, b), which wraps around the new bases.
            start, end = a + len(seq), a
        else:
            start = _map_start(f.start, a, b, len(seq))
            end = _map_end(f.end, a, b, len(seq))
        # Normalise: a start at the very end of a circle is its origin, an end
        # at 0 is the very end, and a non-empty feature whose ends meet now
        # covers the whole sequence (start == end would otherwise read as
        # zero length and hide a frame change from the guard).
        if start == new_n:
            start = 0
        if end == 0 and start > 0:
            end = new_n
        if start == end:
            start, end = 0, new_n
        kept.append(f.model_copy(update={"start": start, "end": end}))
    record.sequence = record.sequence[:a] + seq + record.sequence[b:]
    record.features = kept
    return removed


def _rotate_raw(record: PlasmidRecord, k: int) -> None:
    """Make old index ``k`` the new origin of a circular record."""
    n = record.length
    k %= n
    if k == 0:
        return
    record.sequence = record.sequence[k:] + record.sequence[:k]
    rotated: list[Feature] = []
    for f in record.features:
        if f.length(n) == n:  # covers the whole circle; leave it whole
            rotated.append(f)
            continue
        start, end = (f.start - k) % n, (f.end - k) % n
        if end == 0 and start > 0:
            end = n  # ends exactly at the new origin
        rotated.append(f.model_copy(update={"start": start, "end": end}))
    record.features = rotated


def _edit_raw(record: PlasmidRecord, a: int, b: int, seq: str) -> list[Feature]:
    """Replace ``[a, b)`` with ``seq`` (no checks, no history). ``a > b``
    means the range wraps the origin; the kept sequence then starts at the old
    index ``b`` and the new bases go at its end. Returns removed features."""
    if a > b:
        _rotate_raw(record, b)
        return _replace_linear(record, a - b, record.length, seq)
    return _replace_linear(record, a, b, seq)


def _check_range(record: PlasmidRecord, start: int, end: int) -> None:
    n = record.length
    if not (0 <= start <= n and 0 <= end <= n):
        raise SequenceError(f"range [{start},{end}) out of bounds for length {n}")
    if start > end and not record.is_circular:
        raise SequenceError("wrap-around range requires a circular sequence")


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


def _check_policy(policy: str) -> None:
    if policy not in FRAME_POLICIES:
        raise SequenceError(
            f"unknown frame_policy {policy!r}; use one of {', '.join(FRAME_POLICIES)}"
        )


def _names(features: Iterable[Feature]) -> str:
    return ", ".join(sorted({f.name for f in features}))


def _frame_shifts(
    record: PlasmidRecord, a: int, b: int, seq: str
) -> list[tuple[Feature, int]]:
    """Replay the edit on a copy and return each CDS whose length would change
    by a non-multiple of 3, with that change. A CDS the edit removes entirely
    is not listed: it has no reading frame left to shift."""
    trial = record.model_copy(deep=True)
    _edit_raw(trial, a, b, seq)
    after = {f.id: f for f in trial.features}
    shifts: list[tuple[Feature, int]] = []
    for f in record.features:
        if f.type != FeatureType.cds or f.id not in after:
            continue
        change = after[f.id].length(trial.length) - f.length(record.length)
        if change % 3:
            shifts.append((f, change))
    return shifts


def _apply_edit(
    record: PlasmidRecord,
    a: int,
    b: int,
    seq: str,
    policy: str,
    action: str,
) -> tuple[str, list[str]]:
    """Check the reading frame of every CDS the edit touches, then apply it.
    Returns the bases actually inserted (padding included) and the warnings
    to record."""
    warnings: list[str] = []
    shifts = _frame_shifts(record, a, b, seq)
    if shifts:
        detail = ", ".join(f"{f.name} by {d:+d} bp" for f, d in shifts)
        problem = f"{action} changes {detail}, not a multiple of 3"
        if policy == "allow":
            warnings.append(f"frameshift allowed: {problem}")
        elif policy == "pad":
            if not seq:
                raise FrameShiftError(
                    f"{problem}. Padding only applies to inserted bases; delete a "
                    "multiple of 3 bp instead, or choose to allow the frameshift."
                )
            for k in (1, 2):
                if not _frame_shifts(record, a, b, seq + "N" * k):
                    seq += "N" * k
                    warnings.append(
                        f"padded with {k} N to keep the reading frame ({problem}); "
                        "replace the N bases with the sequence you intend"
                    )
                    break
            else:
                raise FrameShiftError(
                    f"{problem}. Padding can't fix this: the affected coding "
                    "sequences would need different amounts. Adjust the edit, "
                    "or choose to allow the frameshift."
                )
        else:
            raise FrameShiftError(
                f"{problem}, so it would shift the reading frame. Use a multiple "
                "of 3 bp, or choose to pad the insert or allow the frameshift."
            )
    removed = _edit_raw(record, a, b, seq)
    if removed:
        warnings.append(f"removed {_names(removed)}: the edit covered it entirely")
    return seq, warnings


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
    inserted, warnings = _apply_edit(
        record, pos, pos, insert_seq, frame_policy,
        f"inserting {len(insert_seq)} bp at {pos}",
    )
    _record_history(record, "insert", f"inserted {len(inserted)} bp at {pos}", warnings)
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
    removed = sum(b - a for a, b in _segments(start, end, n))
    _, warnings = _apply_edit(
        record, start, end, "", frame_policy, f"deleting [{start},{end})"
    )
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

    The frame check measures each CDS's actual new length, so a codon-for-codon
    swap passes and a replacement that overhangs a CDS end is judged by what
    happens to that CDS, not by the net change to the whole record.
    """
    _check_policy(frame_policy)
    replacement = validate_sequence(replacement)
    n = record.length
    _check_range(record, start, end)
    if start == end:
        return insert(record, start, replacement, frame_policy)
    removed = sum(b - a for a, b in _segments(start, end, n))
    inserted, warnings = _apply_edit(
        record, start, end, replacement, frame_policy, f"replacing [{start},{end})"
    )
    _record_history(
        record,
        "replace",
        f"replaced {removed} bp at [{start},{end}) with {len(inserted)} bp",
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
