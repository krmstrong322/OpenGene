"""Find a DNA or protein sequence in a record.

DNA queries may use IUPAC codes; a query code matches a sequence base when
it covers every base that sequence letter could be (query ``R`` matches A, G
and R; query ``A`` does not match a sequence ``N``). Both strands are
searched, matches may run across the origin of a circular record, and up to a
few mismatches can be allowed.

Protein queries are searched in all six reading frames and in the translation
of every multi-part (spliced) CDS; ``X`` in a query matches any amino acid and
``*`` is a stop.

Hits are half-open forward-strand ``[start, end)``; ``start > end`` means the
hit wraps the origin.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from Bio.Seq import Seq

from ..models import Feature, PlasmidRecord
from .sequence import SequenceError, reverse_complement, validate_sequence

MAX_HITS = 1000
MAX_MISMATCHES = 3

_IUPAC = {
    "A": "A", "C": "C", "G": "G", "T": "T",
    "R": "AG", "Y": "CT", "S": "CG", "W": "AT", "K": "GT", "M": "AC",
    "B": "CGT", "D": "AGT", "H": "ACT", "V": "ACG", "N": "ACGT",
}
# For each query code, the sequence letters it covers.
_COVERS = {
    q: "".join(s for s, bases in _IUPAC.items() if set(bases) <= set(qb))
    for q, qb in _IUPAC.items()
}
_AMINO = set("ACDEFGHIKLMNPQRSTVWY*")


@dataclass
class Hit:
    start: int
    end: int
    strand: int
    mismatches: int = 0
    frame: int | None = None  # protein hits: reading frame 0-2 on its strand
    feature: str | None = None  # protein hits inside a spliced CDS


@dataclass
class SearchResult:
    hits: list[Hit]
    truncated: bool  # more than MAX_HITS matches; only the first are listed


# --------------------------------------------------------------------------
# DNA
# --------------------------------------------------------------------------

def _class(q: str) -> str:
    return f"[{_COVERS[q]}]" if len(_COVERS[q]) > 1 else _COVERS[q]


def _matches(q: str, s: str) -> bool:
    return s in _COVERS[q]


def _find_on_top(hay: str, query: str, limit: int, k: int) -> dict[int, int]:
    """Start positions (< ``limit``) where ``query`` matches ``hay`` with at
    most ``k`` mismatches, mapped to their mismatch count.

    With mismatches, the query is cut into ``k + 1`` pieces: any match with
    ``k`` mismatches has at least one piece matching exactly (pigeonhole), so
    exact regex hits of the pieces give every candidate, then each is checked.
    """
    m = len(query)
    found: dict[int, int] = {}
    pieces = k + 1 if k else 1
    size = m // pieces
    bounds = [(i * size, (i + 1) * size if i < pieces - 1 else m) for i in range(pieces)]
    for lo, hi in bounds:
        pattern = re.compile("(?=" + "".join(_class(c) for c in query[lo:hi]) + ")")
        for match in pattern.finditer(hay):
            start = match.start() - lo
            if start < 0 or start >= limit or start in found or start + m > len(hay):
                continue
            if k == 0:
                found[start] = 0
                continue
            mism = 0
            for i in range(m):
                if not _matches(query[i], hay[start + i]):
                    mism += 1
                    if mism > k:
                        break
            if mism <= k:
                found[start] = mism
    return found


def search_dna(record: PlasmidRecord, query: str, mismatches: int = 0) -> SearchResult:
    query = validate_sequence(re.sub(r"\s+", "", query))
    if not query:
        raise SequenceError("enter a DNA sequence to search for")
    if not 0 <= mismatches <= MAX_MISMATCHES:
        raise SequenceError(f"mismatches must be between 0 and {MAX_MISMATCHES}")
    m = len(query)
    if mismatches and m < 2 * (mismatches + 1):
        raise SequenceError(
            f"a {m}-base query is too short to allow {mismatches} mismatch"
            f"{'es' if mismatches > 1 else ''}"
        )
    seq = record.sequence
    n = len(seq)
    if m > n:
        return SearchResult([], False)
    hay = seq + seq[: m - 1] if record.is_circular else seq
    limit = n if record.is_circular else n - m + 1

    hits: list[Hit] = []
    for strand, q in ((1, query), (-1, reverse_complement(query))):
        if strand == -1 and q == query:
            break  # palindrome: the reverse strand finds the same sites
        for start, mism in _find_on_top(hay, q, limit, mismatches).items():
            end = start + m
            hits.append(Hit(start, end % n if end > n else end, strand, mism))
    hits.sort(key=lambda h: (h.start, -h.strand))
    return SearchResult(hits[:MAX_HITS], len(hits) > MAX_HITS)


# --------------------------------------------------------------------------
# Protein
# --------------------------------------------------------------------------

def _protein_pattern(query: str) -> re.Pattern[str]:
    query = re.sub(r"\s+", "", query).upper()
    if not query:
        raise SequenceError("enter a protein sequence to search for")
    bad = sorted(set(query) - _AMINO - {"X"})
    if bad:
        raise SequenceError(f"not amino acids: {', '.join(bad)}")
    return re.compile(
        "(?=" + "".join("." if c == "X" else re.escape(c) for c in query) + ")"
    )


def _translate(dna: str) -> str:
    return str(Seq(dna[: len(dna) - len(dna) % 3]).translate())


def _coding_positions(feature: Feature, n: int) -> list[int]:
    out: list[int] = []
    for s, e in feature.spans():
        out.extend(range(s, e) if e > s else [*range(s, n), *range(0, e)])
    if feature.strand == -1:
        out.reverse()
    raw = feature.notes.get("codon_start", "1")
    raw = raw[0] if isinstance(raw, list) else raw
    return out[int(raw) - 1:] if str(raw) in ("2", "3") else out


def search_protein(record: PlasmidRecord, query: str) -> SearchResult:
    pattern = _protein_pattern(query)
    m = len(re.sub(r"\s+", "", query))
    seq = record.sequence
    n = len(seq)
    span = 3 * m
    if span > n:
        return SearchResult([], False)

    found: dict[tuple[int, int, int], Hit] = {}

    def add(hit: Hit) -> None:
        found.setdefault((hit.start, hit.end, hit.strand), hit)

    # Six frames. On a circular record the strand is extended past the origin
    # so a match may cross it; a match starting in the extension is the same
    # as one found from the first copy in another frame.
    for strand in (1, -1):
        dna = seq if strand == 1 else reverse_complement(seq)
        hay = dna + dna[: span + 2] if record.is_circular else dna
        for frame in range(3):
            protein = _translate(hay[frame:])
            for match in pattern.finditer(protein):
                p = frame + 3 * match.start()  # strand-local start
                if p >= n or (not record.is_circular and p + span > n):
                    continue
                if strand == 1:
                    start, end = p, p + span
                else:
                    start, end = n - (p + span), n - p
                add(Hit(start % n, end % n if end > n else end, strand, frame=frame))

    # Spliced CDSs: their protein skips the gaps between parts.
    for f in record.features:
        if f.type != "CDS" or not f.segments:
            continue
        pos = _coding_positions(f, n)
        coding = "".join(seq[i] for i in pos)
        if f.strand == -1:
            coding = coding.translate(str.maketrans("ACGTRYKMBDHV", "TGCAYRMKVHDB"))
        protein = _translate(coding)
        for match in pattern.finditer(protein):
            first, last = pos[3 * match.start()], pos[3 * (match.start() + m) - 1]
            start, end = (first, last + 1) if f.strand == 1 else (last, first + 1)
            add(Hit(start, end % n if end > n else end, f.strand, feature=f.name))

    hits = sorted(found.values(), key=lambda h: (h.start, -h.strand))
    return SearchResult(hits[:MAX_HITS], len(hits) > MAX_HITS)
