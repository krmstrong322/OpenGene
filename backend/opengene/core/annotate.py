"""Auto-annotation against the bundled feature library.

Pure-Python matcher (no external BLAST/HMMER). Each library part is found by
seed-and-extend: short exact k-mers locate candidate sites, then a local
alignment (Biopython ``PairwiseAligner``) scores the full part there. This
tolerates substitutions *and* indels, finds partial parts, and reports the
identity and coverage of every hit — unlike a plain exact scan.

Both strands are searched, matches may wrap the origin of a circular record,
and two rules keep short low-specificity motifs from firing spuriously:
a ribosome-binding site is only called just upstream of a start codon, and a
short motif contained inside a longer CDS/gene hit on the same strand is
dropped.

When NCBI BLAST+ is installed, :func:`blast_available` reports it so callers
may offer it as an extra; it is never required here.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from functools import lru_cache
from importlib import resources

from Bio import Align

from ..models import Feature, FeatureType, PlasmidRecord
from .sequence import reverse_complement

# Color per feature type for the frontend map.
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

SEED = 12  # k-mer length for seeding; parts shorter than this are scanned exactly
WINDOW_MARGIN = 12  # extra bases around a seed, to allow indels at the ends
RBS_TO_ATG = 14  # a ribosome-binding site sits within this many bp of its ATG


@dataclass
class LibraryEntry:
    name: str
    type: str
    sequence: str
    source: str = "canonical"


@dataclass
class Hit:
    entry: LibraryEntry
    start: int  # 0-indexed forward-strand coordinate
    end: int  # 0-indexed exclusive (end < start wraps the origin)
    strand: int
    identity: float  # 0..1, gap-aware
    coverage: float  # fraction of the library part that aligned
    score: float = field(default=0.0)


@lru_cache(maxsize=1)
def load_library() -> list[LibraryEntry]:
    with resources.files("opengene.data").joinpath("feature_library.json").open() as fh:
        raw = json.load(fh)
    return [LibraryEntry(**e) for e in raw]


def _aligner() -> Align.PairwiseAligner:
    a = Align.PairwiseAligner()
    a.mode = "local"
    # Penalise mismatches and gaps enough that the alignment stops cleanly at a
    # part's boundary instead of wandering into flanking sequence. This makes a
    # truncated part report honest coverage (e.g. 60% present -> coverage 0.6)
    # rather than inflating to full length at reduced identity.
    a.match_score = 2
    a.mismatch_score = -3
    a.open_gap_score = -6
    a.extend_gap_score = -2
    return a


def _build_index(haystack: str) -> dict[str, list[int]]:
    index: dict[str, list[int]] = {}
    for i in range(len(haystack) - SEED + 1):
        index.setdefault(haystack[i : i + SEED], []).append(i)
    return index


def _candidate_offsets(needle: str, index: dict[str, list[int]]) -> list[int]:
    """Estimated haystack start positions where ``needle`` might align, from
    seed hits projected back by the seed's offset within the needle."""
    offsets: set[int] = set()
    step = max(1, (len(needle) - SEED) // 6 or 1)  # a handful of seeds per part
    for s in range(0, len(needle) - SEED + 1, step):
        for pos in index.get(needle[s : s + SEED], ()):
            offsets.add(pos - s)
    # Merge offsets that fall within the same window so we align each site once.
    merged: list[int] = []
    for off in sorted(offsets):
        if not merged or off - merged[-1] > WINDOW_MARGIN:
            merged.append(off)
    return merged


def _align_at(
    aligner: Align.PairwiseAligner, haystack: str, needle: str, offset: int
) -> tuple[int, int, float, float] | None:
    """Align ``needle`` against a window of ``haystack`` near ``offset``.
    Returns (start, end, identity, coverage) in haystack coordinates, or None."""
    lo = max(0, offset - WINDOW_MARGIN)
    hi = min(len(haystack), offset + len(needle) + WINDOW_MARGIN)
    window = haystack[lo:hi]
    if len(window) < SEED:
        return None
    try:
        aln = aligner.align(window, needle)[0]
    except (ValueError, IndexError):
        return None
    counts = aln.counts()
    aligned_cols = counts.identities + counts.mismatches
    if aligned_cols == 0:
        return None
    identity = counts.identities / (aligned_cols + counts.gaps)
    tgt = aln.aligned[0]
    ndl = aln.aligned[1]
    start = lo + int(tgt[0][0])
    end = lo + int(tgt[-1][-1])
    coverage = (int(ndl[-1][-1]) - int(ndl[0][0])) / len(needle)
    return start, end, identity, coverage


def _scan_exact(haystack: str, needle: str, search_len: int) -> list[int]:
    hits: list[int] = []
    start = 0
    while True:
        i = haystack.find(needle, start, search_len + len(needle))
        if i == -1 or i >= search_len:
            break
        hits.append(i)
        start = i + 1
    return hits


def annotate(
    record: PlasmidRecord,
    replace_existing: bool = False,
    min_identity: float = 0.80,
    min_coverage: float = 0.80,
) -> list[Feature]:
    """Detect and append library features. Returns the new features."""
    library = load_library()
    seq = record.sequence
    n = len(seq)
    if n == 0 or not library:
        return []

    max_needle = max(len(e.sequence) for e in library)
    # Extend the haystack so a part can wrap the origin of a circular record.
    pad = min(max_needle, n) if record.is_circular else 0
    forward = seq + seq[:pad]
    reverse = reverse_complement(seq) + reverse_complement(seq)[:pad]
    search_len = n if record.is_circular else n

    fwd_index = _build_index(forward)
    rev_index = _build_index(reverse)
    aligner = _aligner()

    hits: list[Hit] = []
    for entry in library:
        needle = entry.sequence.upper()
        nlen = len(needle)
        if nlen == 0 or nlen > n:
            continue

        for strand, hay, index in ((1, forward, fwd_index), (-1, reverse, rev_index)):
            if nlen < SEED:
                # Too short to seed: require an exact match.
                raw = [(p, p + nlen, 1.0, 1.0) for p in _scan_exact(hay, needle, search_len)]
            else:
                raw = []
                for off in _candidate_offsets(needle, index):
                    res = _align_at(aligner, hay, needle, off)
                    if res is not None:
                        raw.append(res)

            for h_start, h_end, identity, coverage in raw:
                if identity < min_identity or coverage < min_coverage:
                    continue
                if h_start >= search_len:
                    continue
                # Map reverse-strand window coords back to forward coordinates.
                if strand == 1:
                    f_start, f_end = h_start % n, h_end % n
                else:
                    total = len(seq)
                    f_start = (total - h_end) % n
                    f_end = (total - h_start) % n
                hits.append(
                    Hit(entry, f_start, f_end, strand, round(identity, 3),
                        round(coverage, 3), identity * coverage * nlen)
                )

    kept = _resolve(hits, seq, n)

    # When replacing, old features are discarded, so don't dedupe against them.
    existing = (
        set()
        if replace_existing
        else {(f.start, f.end, f.strand, f.name) for f in record.features}
    )
    new_features: list[Feature] = []
    for h in kept:
        key = (h.start, h.end, h.strand, h.entry.name)
        if key in existing:
            continue
        existing.add(key)
        new_features.append(
            Feature(
                name=h.entry.name,
                type=FeatureType(h.entry.type),
                start=h.start,
                end=h.end,
                strand=h.strand,
                color=TYPE_COLORS.get(h.entry.type, "#9E9E9E"),
                notes={
                    "source": h.entry.source,
                    "auto": "true",
                    "identity": f"{h.identity:.0%}",
                    "coverage": f"{h.coverage:.0%}",
                },
            )
        )

    if replace_existing:
        record.features = new_features
    else:
        record.features.extend(new_features)
    return new_features


def _span(start: int, end: int, n: int) -> set[int]:
    if start <= end:
        return set(range(start, end))
    return set(range(start, n)) | set(range(0, end))


def _resolve(hits: list[Hit], seq: str, n: int) -> list[Hit]:
    """Drop spurious and redundant hits:

    * a ribosome-binding site is kept only just upstream of a start codon;
    * a short motif inside a longer CDS/gene hit on the same strand is dropped;
    * when two hits of the *same part* overlap, keep the higher-scoring one.
    """
    cds_spans = [
        (_span(h.start, h.end, n), h.strand)
        for h in hits
        if h.entry.type == "CDS"
    ]

    filtered: list[Hit] = []
    for h in hits:
        if h.entry.type == "RBS" and not _rbs_has_start(h, seq, n):
            continue
        if len(h.entry.sequence) < SEED and h.entry.type != "CDS":
            inside = any(
                h.strand == strand and _span(h.start, h.end, n) <= span
                for span, strand in cds_spans
            )
            if inside:
                continue
        filtered.append(h)

    # De-duplicate overlapping hits of the same part (keep the best).
    filtered.sort(key=lambda x: x.score, reverse=True)
    chosen: list[Hit] = []
    for h in filtered:
        hspan = _span(h.start, h.end, n)
        if any(
            c.entry.name == h.entry.name
            and c.strand == h.strand
            and hspan & _span(c.start, c.end, n)
            for c in chosen
        ):
            continue
        chosen.append(h)
    chosen.sort(key=lambda x: (x.start, x.entry.name))
    return chosen


def _rbs_has_start(h: Hit, seq: str, n: int) -> bool:
    """True if an ATG starts within RBS_TO_ATG bp downstream of the motif."""
    if h.strand == 1:
        region = "".join(seq[(h.end + i) % n] for i in range(RBS_TO_ATG + 3))
        return "ATG" in region[:RBS_TO_ATG + 1]
    rc = reverse_complement(seq)
    # downstream on the - strand is before the motif's forward start
    begin = (n - h.start) % n
    region = "".join(rc[(begin + i) % n] for i in range(RBS_TO_ATG + 3))
    return "ATG" in region[:RBS_TO_ATG + 1]


def blast_available() -> bool:
    """True if NCBI BLAST+ (blastn) is on PATH for optional extended matching."""
    return shutil.which("blastn") is not None
