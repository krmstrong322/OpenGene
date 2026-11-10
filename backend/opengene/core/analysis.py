"""Read-only facts about a stretch of sequence: what the sequence view shows
for the current selection."""

from __future__ import annotations

from dataclasses import dataclass

import primer3
from Bio.Seq import Seq
from Bio.SeqUtils import molecular_weight

from ..models import Feature, PlasmidRecord
from .sequence import SequenceError, gc_content, reverse_complement, slice_circular

# Above this, Tm and molecular weight stop being useful and cost time.
MAX_TM_LEN = 10_000
MAX_TRANSLATE_LEN = 30_000


@dataclass
class SelectionInfo:
    start: int
    end: int
    length: int
    gc_content: float
    tm: float | None  # None: ambiguous bases, too short or too long
    mw_single: float | None  # g/mol, single-stranded DNA
    mw_double: float | None  # g/mol, double-stranded DNA
    translation: str  # "*" = stop
    protein_mw: float | None  # g/mol, translation up to the first stop
    # What was translated: the selection's top strand from its first base, or
    # a feature (its own strand, parts only, honoring /codon_start).
    translation_of: str = "selection"
    translation_strand: int = 1


def feature_coding_sequence(record: PlasmidRecord, feature: Feature) -> str:
    """A feature's bases 5'->3' on its own strand, gaps between parts left out
    and /codon_start applied."""
    seq = "".join(
        slice_circular(record.sequence, s, e) for s, e in feature.spans() if s != e
    )
    if feature.strand == -1:
        seq = reverse_complement(seq)
    raw = feature.notes.get("codon_start", "1")
    start = raw[0] if isinstance(raw, list) else raw
    offset = int(start) - 1 if str(start) in ("2", "3") else 0
    return seq[offset:]


def _translate(seq: str) -> tuple[str, float | None]:
    if not 3 <= len(seq) <= MAX_TRANSLATE_LEN:
        return "", None
    translation = str(Seq(seq[: len(seq) - len(seq) % 3]).translate())
    protein = translation.split("*", 1)[0]
    mw = None
    if protein and not set(protein) - set("ACDEFGHIKLMNPQRSTVWY"):
        mw = round(molecular_weight(Seq(protein), "protein"), 1)
    return translation, mw


def selection_info(
    record: PlasmidRecord, start: int, end: int, feature_id: str | None = None
) -> SelectionInfo:
    """Facts about ``[start, end)``; ``start > end`` wraps the origin of a
    circular record. With ``feature_id`` (the selection is that feature), the
    translation is the feature's own rather than the top strand's."""
    n = record.length
    if not (0 <= start <= n and 0 <= end <= n):
        raise SequenceError(f"range [{start},{end}) out of bounds for length {n}")
    if start > end and not record.is_circular:
        raise SequenceError("wrap-around range requires a circular sequence")
    seq = slice_circular(record.sequence, start, end) if start != end else ""
    definite = bool(seq) and not set(seq) - set("ACGT")

    tm = None
    if definite and 8 <= len(seq) <= MAX_TM_LEN:
        tm = round(primer3.calc_tm(seq), 1)
    mw_single = mw_double = None
    if definite and len(seq) <= MAX_TM_LEN:
        mw_single = round(molecular_weight(Seq(seq), "DNA"), 1)
        mw_double = round(molecular_weight(Seq(seq), "DNA", double_stranded=True), 1)

    feature = next((f for f in record.features if f.id == feature_id), None)
    if feature is not None:
        translation, protein_mw = _translate(feature_coding_sequence(record, feature))
        of, strand = feature.name, feature.strand
    else:
        translation, protein_mw = _translate(seq)
        of, strand = "selection", 1

    return SelectionInfo(
        start=start,
        end=end,
        length=len(seq),
        gc_content=gc_content(seq),
        tm=tm,
        mw_single=mw_single,
        mw_double=mw_double,
        translation=translation,
        protein_mw=protein_mw,
        translation_of=of,
        translation_strand=strand,
    )
