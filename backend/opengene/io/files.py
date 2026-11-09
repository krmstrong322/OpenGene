"""File import/export.

Import:  GenBank (.gb/.gbk), FASTA (.fasta/.fa), EMBL (.embl), SnapGene (.dna).
Export:  GenBank, FASTA, EMBL.

SnapGene ``.dna`` is import-only (Biopython has a reader but no writer); callers
export to GenBank to round-trip into other tools.
"""

from __future__ import annotations

import io
from pathlib import Path

from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqFeature import CompoundLocation, SeqFeature, SimpleLocation
from Bio.SeqRecord import SeqRecord

from ..core.annotate import TYPE_COLORS
from ..models import Feature, FeatureType, PlasmidRecord, Segment

# Biopython format name per extension.
_READ_FORMATS = {
    ".gb": "genbank",
    ".gbk": "genbank",
    ".genbank": "genbank",
    ".fasta": "fasta",
    ".fa": "fasta",
    ".fna": "fasta",
    ".embl": "embl",
    ".dna": "snapgene",
}

_WRITE_FORMATS = {
    "genbank": "genbank",
    "gb": "genbank",
    "fasta": "fasta",
    "embl": "embl",
}

# GenBank feature keys OpenGene renames on import (and back on export). Every
# other key is kept verbatim, so ``gene``, ``exon``, ``polyA_signal`` etc.
# survive a round trip.
_TYPE_IN = {
    "rep_origin": FeatureType.origin.value,
    "primer_bind": FeatureType.primer.value,
    "ribosome_binding_site": FeatureType.rbs.value,
}

_TYPE_OUT = {
    FeatureType.origin.value: "rep_origin",
    FeatureType.primer.value: "primer_bind",
    # "tag" is OpenGene's own category, not an INSDC key.
    FeatureType.tag.value: "misc_feature",
}

# Since 2014 INSDC files describe promoters, terminators and RBSs as
# ``regulatory`` with a ``/regulatory_class``; show them as their class.
_REGULATORY_CLASS_IN = {
    "promoter": FeatureType.promoter.value,
    "terminator": FeatureType.terminator.value,
    "ribosome_binding_site": FeatureType.rbs.value,
}

# Qualifiers OpenGene writes from its own fields, never copied from notes.
_OWN_QUALIFIERS = ("label", "ApEinfo_fwdcolor", "ApEinfo_revcolor")


def format_for_extension(filename: str) -> str | None:
    return _READ_FORMATS.get(Path(filename).suffix.lower())


def _feature_name(bio_feat: SeqFeature) -> str:
    for key in ("label", "gene", "product", "note"):
        vals = bio_feat.qualifiers.get(key)
        if vals:
            return str(vals[0])
    return bio_feat.type


def _is_circular(bio_rec: SeqRecord) -> bool:
    topology = bio_rec.annotations.get("topology", "").lower()
    if topology:
        return topology == "circular"
    # SnapGene stores it differently; default to circular for plasmids.
    return True


def _feature_type_in(bio_feat: SeqFeature) -> str:
    if bio_feat.type == "regulatory":
        cls = (bio_feat.qualifiers.get("regulatory_class") or [""])[0]
        if cls in _REGULATORY_CLASS_IN:
            return _REGULATORY_CLASS_IN[cls]
    return _TYPE_IN.get(bio_feat.type, bio_feat.type)


def _feature_type_out(feature: Feature) -> str:
    # A promoter/terminator/RBS that came in as ``regulatory`` goes back out
    # the same way.
    cls = feature.notes.get("regulatory_class")
    if cls in _REGULATORY_CLASS_IN and _REGULATORY_CLASS_IN[cls] == feature.type:
        return "regulatory"
    return _TYPE_OUT.get(feature.type, feature.type)


def _location_in(loc, n: int, circular: bool) -> tuple[int, int, list[Segment]] | None:
    """Map a Biopython location to ``(start, end, segments)``.

    Pieces are put in forward walking order (Biopython lists a minus-strand
    feature's pieces right to left), and pieces that meet — including across
    the origin of a circular record — are merged, so an origin-spanning
    ``join(901..1000,1..50)`` becomes the single wrapping span 900–50 rather
    than 0–1000. Returns ``None`` for an empty or out-of-range location.
    """
    parts = [(int(p.start), int(p.end)) for p in loc.parts]
    if not parts or any(s < 0 or e > n or s > e for s, e in parts):
        return None
    parts = [p for p in parts if p[1] > p[0]] or parts[:1]
    if loc.strand == -1:
        parts.reverse()
    # Forward order steps back at most once, and only by wrapping the origin
    # of a circular record. Anything else (e.g. a trans-spliced gene) is laid
    # out left to right instead.
    backs = sum(1 for a, b in zip(parts, parts[1:]) if b[0] < a[0])
    if backs > (1 if circular else 0):
        parts.sort()
    pieces: list[tuple[int, int]] = [parts[0]]
    for s, e in parts[1:]:
        ps, pe = pieces[-1]
        if s == pe or (circular and pe == n and s == 0):
            pieces[-1] = (ps, e)
        else:
            pieces.append((s, e))
    # Pieces listed from the origin whose last one runs into it (e.g.
    # ``complement(join(1..50,901..1000))``) are one stretch across the origin.
    if circular and len(pieces) > 1 and pieces[0][0] == 0 and pieces[-1][1] == n:
        pieces = [(pieces[-1][0], pieces[0][1])] + pieces[1:-1]
    if len(pieces) == 1 and pieces[0][0] == pieces[0][1] and parts[0][1] > parts[0][0]:
        # Merged all the way round: the whole circle, stored as [0, n).
        pieces = [(0, n)]
    start, end = pieces[0][0], pieces[-1][1]
    segments = [Segment(start=s, end=e) for s, e in pieces] if len(pieces) > 1 else []
    return start, end, segments


def _notes_in(bio_feat: SeqFeature) -> dict[str, str | list[str]]:
    notes: dict[str, str | list[str]] = {}
    for k, v in bio_feat.qualifiers.items():
        # A stored translation goes stale after any edit; it's derived data.
        if k == "translation" or not v:
            continue
        vals = [str(x) for x in v]
        notes[k] = vals[0] if len(vals) == 1 else vals
    return notes


def from_biopython(bio_rec: SeqRecord, name: str | None = None) -> PlasmidRecord:
    n = len(bio_rec.seq)
    circular = _is_circular(bio_rec)
    features: list[Feature] = []
    for bf in bio_rec.features:
        if bf.type == "source":
            continue
        loc = bf.location
        if loc is None:
            continue
        placed = _location_in(loc, n, circular)
        if placed is None:
            continue
        start, end, segments = placed
        ftype = _feature_type_in(bf)
        strand = -1 if loc.strand == -1 else 1
        color = None
        for ck in ("ApEinfo_fwdcolor", "ApEinfo_revcolor", "color"):
            if ck in bf.qualifiers:
                color = str(bf.qualifiers[ck][0])
                break
        features.append(
            Feature(
                name=_feature_name(bf),
                type=ftype,
                start=start,
                end=end,
                strand=strand,
                color=color or TYPE_COLORS.get(ftype),
                notes=_notes_in(bf),
                segments=segments,
            )
        )

    return PlasmidRecord(
        name=name or bio_rec.name or bio_rec.id or "untitled",
        is_circular=circular,
        sequence=str(bio_rec.seq),
        features=features,
    )


def parse_bytes(data: bytes, filename: str) -> PlasmidRecord:
    fmt = format_for_extension(filename)
    if fmt is None:
        raise ValueError(f"unsupported file extension: {filename}")
    if fmt == "snapgene":
        handle = io.BytesIO(data)
        bio_rec = SeqIO.read(handle, "snapgene")
    else:
        text = data.decode("utf-8", errors="replace")
        bio_rec = SeqIO.read(io.StringIO(text), fmt)
    return from_biopython(bio_rec, name=Path(filename).stem)


def parse_file(path: str | Path) -> PlasmidRecord:
    path = Path(path)
    return parse_bytes(path.read_bytes(), path.name)


def _location_out(feature: Feature, n: int):
    """The Biopython location for a feature: a ``join`` for multi-part
    features and for any piece that wraps the origin."""
    parts: list[SimpleLocation] = []
    for s, e in feature.spans():
        if s > e:
            # Wraps the origin: [s, n) then [0, e). Drop an empty half.
            if n > s:
                parts.append(SimpleLocation(s, n, strand=feature.strand))
            if e > 0:
                parts.append(SimpleLocation(0, e, strand=feature.strand))
        else:
            parts.append(SimpleLocation(s, e, strand=feature.strand))
    if feature.strand == -1:
        parts.reverse()  # Biopython expects biological order
    if len(parts) == 1:
        return parts[0]
    return CompoundLocation(parts)


def to_biopython(record: PlasmidRecord) -> SeqRecord:
    bio_rec = SeqRecord(
        Seq(record.sequence),
        id=record.name[:15] or "plasmid",
        name=record.name[:15] or "plasmid",
        description=record.name,
    )
    bio_rec.annotations["molecule_type"] = "DNA"
    bio_rec.annotations["topology"] = "circular" if record.is_circular else "linear"
    n = record.length
    for f in record.features:
        # The feature's own name and color win over any stale copy in notes.
        qualifiers: dict[str, list[str]] = {"label": [f.name]}
        if f.color:
            qualifiers["ApEinfo_fwdcolor"] = [f.color]
            qualifiers["ApEinfo_revcolor"] = [f.color]
        for k, v in f.notes.items():
            if k in _OWN_QUALIFIERS:
                continue
            qualifiers[k] = list(v) if isinstance(v, list) else [v]
        bio_rec.features.append(
            SeqFeature(_location_out(f, n), type=_feature_type_out(f), qualifiers=qualifiers)
        )
    return bio_rec


def export_string(record: PlasmidRecord, fmt: str) -> str:
    bio_fmt = _WRITE_FORMATS.get(fmt.lower())
    if bio_fmt is None:
        raise ValueError(f"unsupported export format: {fmt}")
    handle = io.StringIO()
    SeqIO.write(to_biopython(record), handle, bio_fmt)
    return handle.getvalue()
