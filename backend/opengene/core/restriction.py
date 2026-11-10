"""Restriction enzyme cut-site mapping using Biopython's REBASE/NEB catalog.

Adds, on top of cut positions: the overhang each enzyme leaves (5'/3'/blunt
and its bases), the commercial suppliers of each enzyme, ready-made enzyme
sets (unique cutters, etc.), and a flag for cut sites that overlap a Dam, Dcm
or CpG methylation site, where cleavage may be blocked in a methylating host.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from Bio.Restriction import AllEnzymes, CommOnly, RestrictionBatch
from Bio.Restriction.Restriction_Dictionary import suppliers as _SUPPLIERS
from Bio.Seq import Seq

from ..models import PlasmidRecord

# Supplier single-letter code -> company name (Biopython's REBASE table).
SUPPLIERS: dict[str, str] = {code: name for code, (name, _) in _SUPPLIERS.items()}

# Host methylation that can block cleavage. Each: the motif (as a regex over
# the top strand, both orientations folded in since all three are symmetric
# enough) and the offset of the methylated base within a match.
#   Dam  G A T C   -> the A (E. coli dam+)
#   Dcm  C C W G G -> the inner C (E. coli dcm+)
#   CpG  C G       -> the C (CpG methylase / mammalian DNA)
_METHYL = {
    "dam": (re.compile("GATC"), 1),
    "dcm": (re.compile("CC[AT]GG"), 1),
    "cpg": (re.compile("CG"), 0),
}
METHYL_LABELS = {"dam": "Dam (GATC)", "dcm": "Dcm (CCWGG)", "cpg": "CpG (CG)"}


@dataclass
class CutSite:
    enzyme: str
    position: int  # 0-indexed forward-strand cut position (top strand)
    recognition_site: str
    strand: int = 1
    overhang_type: str = "blunt"  # "5'", "3'", or "blunt"
    overhang: str = ""  # overhang bases (empty for a blunt cutter)
    methylation: list[str] = field(default_factory=list)  # blocking types here


@dataclass
class EnzymeInfo:
    name: str
    site: str
    size: int  # length of the recognition sequence
    overhang_type: str
    overhang: str
    suppliers: list[str]
    cuts: int  # times it cuts the current record


@dataclass
class DigestResult:
    enzyme: str
    cut_positions: list[int] = field(default_factory=list)
    fragment_sizes: list[int] = field(default_factory=list)
    is_circular: bool = True


def _overhang_type(enzyme) -> str:
    if enzyme.is_blunt():
        return "blunt"
    if enzyme.is_5overhang():
        return "5'"
    if enzyme.is_3overhang():
        return "3'"
    return "unknown"


def _enzyme_batch(enzymes: list[str] | None) -> RestrictionBatch:
    if not enzymes:
        return CommOnly  # commercially available subset — a sane default
    batch = RestrictionBatch()
    for name in enzymes:
        try:
            batch.add(name)
        except ValueError:
            # Fall back to a lookup in the full catalog, skip unknown names.
            if name in AllEnzymes.as_string():
                batch.add(name)
    return batch


def _methyl_bases(seq: str, circular: bool) -> dict[str, set[int]]:
    """Index (mod len) of every methylated base in the sequence, per type.

    The sequence is scanned on the top strand; a circular record is extended
    so a motif can wrap the origin. Dam/Dcm/CpG motifs are symmetric enough
    that the top-strand scan also covers sites on the bottom strand.
    """
    n = len(seq)
    out: dict[str, set[int]] = {k: set() for k in _METHYL}
    if n == 0:
        return out
    hay = seq + seq[:4] if circular else seq
    for key, (pattern, off) in _METHYL.items():
        # Step one base at a time so overlapping motifs (e.g. CGCG) are caught.
        start = 0
        while (m := pattern.search(hay, start)) is not None:
            if m.start() < n:
                out[key].add((m.start() + off) % n)
            start = m.start() + 1
    return out


def _site_methylation(
    site_start: int, size: int, n: int, circular: bool, methyl: dict[str, set[int]]
) -> list[str]:
    """Which methylation types have a methylated base inside the recognition
    span ``[site_start, site_start + size)`` (wrapping the origin if needed)."""
    span = {(site_start + i) % n for i in range(size)} if circular else set(range(site_start, site_start + size))
    return [key for key, bases in methyl.items() if span & bases]


def find_cut_sites(
    record: PlasmidRecord, enzymes: list[str] | None = None
) -> list[CutSite]:
    """All cut sites for the requested enzymes (default: the commercial set),
    each with its overhang and any overlapping methylation."""
    batch = _enzyme_batch(enzymes)
    seq = Seq(record.sequence)
    n = max(record.length, 1)
    linear = not record.is_circular
    methyl = _methyl_bases(record.sequence, record.is_circular)
    results = batch.search(seq, linear=linear)
    sites: list[CutSite] = []
    for enzyme, positions in results.items():
        otype = _overhang_type(enzyme)
        ovhg = "" if enzyme.is_blunt() else (enzyme.ovhgseq or "")
        for p in positions:
            # Biopython returns 1-indexed positions of the base after the cut.
            pos = (p - 1) % n
            # The recognition site's 5' end sits fst5 bases before the cut.
            site_start = (p - 1 - enzyme.fst5) % n
            sites.append(
                CutSite(
                    enzyme=str(enzyme),
                    position=pos,
                    recognition_site=str(enzyme.site),
                    overhang_type=otype,
                    overhang=ovhg,
                    methylation=_site_methylation(
                        site_start, enzyme.size, n, record.is_circular, methyl
                    ),
                )
            )
    sites.sort(key=lambda s: (s.position, s.enzyme))
    return sites


def enzyme_catalog(
    record: PlasmidRecord, enzymes: list[str] | None = None
) -> list[EnzymeInfo]:
    """Every enzyme in scope (default: commercial set) with how often it cuts
    the current record, its overhang and its suppliers — for an enzyme picker."""
    batch = _enzyme_batch(enzymes)
    counts = batch.search(Seq(record.sequence), linear=not record.is_circular)
    out: list[EnzymeInfo] = []
    for enzyme in batch:
        out.append(
            EnzymeInfo(
                name=str(enzyme),
                site=str(enzyme.site),
                size=enzyme.size,
                overhang_type=_overhang_type(enzyme),
                overhang="" if enzyme.is_blunt() else (enzyme.ovhgseq or ""),
                suppliers=sorted(
                    SUPPLIERS[c] for c in enzyme.suppl if c in SUPPLIERS
                ),
                cuts=len(counts.get(enzyme, [])),
            )
        )
    out.sort(key=lambda e: e.name)
    return out


def digest(record: PlasmidRecord, enzymes: list[str]) -> list[DigestResult]:
    """Simulate a digest and return cut positions and fragment sizes."""
    out: list[DigestResult] = []
    n = record.length
    for name in enzymes:
        sites = find_cut_sites(record, [name])
        cuts = sorted({s.position for s in sites})
        frags: list[int] = []
        if cuts:
            if record.is_circular:
                for a, b in zip(cuts, cuts[1:] + [cuts[0] + n]):
                    frags.append(b - a)
            else:
                bounds = [0] + cuts + [n]
                frags = [b - a for a, b in zip(bounds, bounds[1:])]
        else:
            frags = [n]  # uncut: single linear/circular band
        out.append(
            DigestResult(
                enzyme=name,
                cut_positions=cuts,
                fragment_sizes=sorted(frags, reverse=True),
                is_circular=record.is_circular,
            )
        )
    return out


def unique_cutters(record: PlasmidRecord, enzymes: list[str] | None = None) -> list[str]:
    """Enzymes that cut the record exactly once — useful for cloning."""
    batch = _enzyme_batch(enzymes)
    seq = Seq(record.sequence)
    results = batch.search(seq, linear=not record.is_circular)
    return sorted(str(e) for e, p in results.items() if len(p) == 1)
