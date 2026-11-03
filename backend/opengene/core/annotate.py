"""Auto-annotation against the bundled feature library.

Pure-Python matcher (no external BLAST required). Each library entry is
searched on both strands, allowing a small number of mismatches for longer
features so that engineered point variants still annotate. When the optional
``OPENGENE_BLAST`` hook is configured and NCBI BLAST+ is installed, callers
may extend this via :func:`blast_available`, but it is never required.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

from ..models import Feature, FeatureType, PlasmidRecord
from .sequence import reverse_complement

# A color per feature type for the frontend map.
TYPE_COLORS = {
    "promoter": "#4CAF50",
    "CDS": "#2196F3",
    "terminator": "#F44336",
    "origin": "#FF9800",
    "primer": "#9C27B0",
    "tag": "#00BCD4",
    "RBS": "#8BC34A",
    "misc_feature": "#9E9E9E",
}


@dataclass
class LibraryEntry:
    name: str
    type: str
    sequence: str
    source: str = "canonical"


@lru_cache(maxsize=1)
def load_library() -> list[LibraryEntry]:
    with resources.files("opengene.data").joinpath("feature_library.json").open() as fh:
        raw = json.load(fh)
    return [LibraryEntry(**e) for e in raw]


def _mismatches(a: str, b: str, limit: int) -> int:
    """Count mismatches between equal-length strings, short-circuiting at limit."""
    count = 0
    for x, y in zip(a, b):
        if x != y:
            count += 1
            if count > limit:
                return count
    return count


def _allowed_mismatches(length: int) -> int:
    """Permit ~5% mismatches for features >= 40 bp; exact for short motifs."""
    if length < 40:
        return 0
    return max(1, length // 20)


def _search_strand(
    haystack: str, needle: str, search_len: int, limit: int
) -> list[int]:
    """Return start positions where ``needle`` matches within ``limit`` mismatches."""
    hits: list[int] = []
    nlen = len(needle)
    for i in range(search_len):
        window = haystack[i:i + nlen]
        if len(window) < nlen:
            break
        if limit == 0:
            if window == needle:
                hits.append(i)
        elif _mismatches(window, needle, limit) <= limit:
            hits.append(i)
    return hits


def annotate(
    record: PlasmidRecord,
    replace_existing: bool = False,
    min_identity: float = 0.95,
) -> list[Feature]:
    """Detect and append features from the library. Returns the new features."""
    library = load_library()
    seq = record.sequence
    n = len(seq)
    if n == 0:
        return []

    # For circular records, extend the haystack so matches can wrap the origin.
    if record.is_circular and library:
        max_needle = max(len(e.sequence) for e in library)
        haystack = seq + seq[: min(max_needle - 1, n)]
    else:
        haystack = seq

    new_features: list[Feature] = []
    existing_spans = {(f.start, f.end, f.strand) for f in record.features}

    for entry in library:
        needle = entry.sequence.upper()
        nlen = len(needle)
        if nlen == 0 or nlen > n:
            continue
        limit = _allowed_mismatches(nlen)
        # effective allowed mismatches also bounded by requested identity
        limit = min(limit, int(nlen * (1 - min_identity)) if min_identity < 1 else limit)

        search_len = n if record.is_circular else max(0, n - nlen + 1)

        for strand, target in ((1, needle), (-1, reverse_complement(needle))):
            for pos in _search_strand(haystack, target, search_len, limit):
                start = pos % n
                end = (pos + nlen) % n
                span = (start, end, strand)
                if span in existing_spans:
                    continue
                existing_spans.add(span)
                new_features.append(
                    Feature(
                        name=entry.name,
                        type=FeatureType(entry.type),
                        start=start,
                        end=end,
                        strand=strand,
                        color=TYPE_COLORS.get(entry.type, "#9E9E9E"),
                        notes={"source": entry.source, "auto": "true"},
                    )
                )

    if replace_existing:
        record.features = new_features
    else:
        record.features.extend(new_features)
    return new_features


def blast_available() -> bool:
    """True if NCBI BLAST+ (blastn) is on PATH for optional extended matching."""
    return shutil.which("blastn") is not None
