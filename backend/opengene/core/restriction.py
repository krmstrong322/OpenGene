"""Restriction enzyme cut-site mapping using Biopython's REBASE/NEB catalog."""

from __future__ import annotations

from dataclasses import dataclass, field

from Bio.Restriction import AllEnzymes, CommOnly, RestrictionBatch
from Bio.Seq import Seq

from ..models import PlasmidRecord


@dataclass
class CutSite:
    enzyme: str
    position: int  # 0-indexed forward-strand cut position (top strand)
    recognition_site: str
    strand: int = 1


@dataclass
class DigestResult:
    enzyme: str
    cut_positions: list[int] = field(default_factory=list)
    fragment_sizes: list[int] = field(default_factory=list)
    is_circular: bool = True


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


def find_cut_sites(
    record: PlasmidRecord, enzymes: list[str] | None = None
) -> list[CutSite]:
    """Return all cut sites for the requested enzymes (default: commercial set)."""
    batch = _enzyme_batch(enzymes)
    seq = Seq(record.sequence)
    linear = not record.is_circular
    results = batch.search(seq, linear=linear)
    sites: list[CutSite] = []
    for enzyme, positions in results.items():
        for p in positions:
            # Biopython returns 1-indexed positions of the base after the cut.
            sites.append(
                CutSite(
                    enzyme=str(enzyme),
                    position=(p - 1) % max(record.length, 1),
                    recognition_site=str(enzyme.site),
                )
            )
    sites.sort(key=lambda s: (s.position, s.enzyme))
    return sites


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
