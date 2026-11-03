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
from Bio.SeqFeature import FeatureLocation, SeqFeature
from Bio.SeqRecord import SeqRecord

from ..core.annotate import TYPE_COLORS
from ..models import Feature, FeatureType, PlasmidRecord

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

# GenBank feature-type -> our FeatureType enum.
_TYPE_IN = {
    "promoter": FeatureType.promoter,
    "CDS": FeatureType.cds,
    "terminator": FeatureType.terminator,
    "rep_origin": FeatureType.origin,
    "primer_bind": FeatureType.primer,
    "RBS": FeatureType.rbs,
    "ribosome_binding_site": FeatureType.rbs,
    "protein_bind": FeatureType.misc_feature,
    "misc_feature": FeatureType.misc_feature,
}

_TYPE_OUT = {
    FeatureType.promoter: "promoter",
    FeatureType.cds: "CDS",
    FeatureType.terminator: "terminator",
    FeatureType.origin: "rep_origin",
    FeatureType.primer: "primer_bind",
    FeatureType.rbs: "RBS",
    FeatureType.tag: "misc_feature",
    FeatureType.misc_feature: "misc_feature",
}


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


def from_biopython(bio_rec: SeqRecord, name: str | None = None) -> PlasmidRecord:
    features: list[Feature] = []
    for bf in bio_rec.features:
        if bf.type == "source":
            continue
        loc = bf.location
        if loc is None:
            continue
        ftype = _TYPE_IN.get(bf.type, FeatureType.misc_feature)
        strand = -1 if loc.strand == -1 else 1
        color = None
        for ck in ("ApEinfo_fwdcolor", "ApEinfo_revcolor", "color"):
            if ck in bf.qualifiers:
                color = str(bf.qualifiers[ck][0])
                break
        notes = {
            k: str(v[0])
            for k, v in bf.qualifiers.items()
            if v and k not in ("translation",)
        }
        features.append(
            Feature(
                name=_feature_name(bf),
                type=ftype,
                start=int(loc.start),
                end=int(loc.end),
                strand=strand,
                color=color or TYPE_COLORS.get(ftype.value),
                notes=notes,
            )
        )

    return PlasmidRecord(
        name=name or bio_rec.name or bio_rec.id or "untitled",
        is_circular=_is_circular(bio_rec),
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


def to_biopython(record: PlasmidRecord) -> SeqRecord:
    bio_rec = SeqRecord(
        Seq(record.sequence),
        id=record.name[:15] or "plasmid",
        name=record.name[:15] or "plasmid",
        description=record.name,
    )
    bio_rec.annotations["molecule_type"] = "DNA"
    bio_rec.annotations["topology"] = "circular" if record.is_circular else "linear"
    for f in record.features:
        # Wrap-around features are emitted as a truncated span (GenBank join of
        # origin-spanning features is lossy across tools; we keep it simple).
        start = min(f.start, f.end)
        end = max(f.start, f.end)
        qualifiers = {"label": [f.name]}
        if f.color:
            qualifiers["ApEinfo_fwdcolor"] = [f.color]
        qualifiers.update({k: [v] for k, v in f.notes.items()})
        bio_rec.features.append(
            SeqFeature(
                FeatureLocation(start, end, strand=f.strand),
                type=_TYPE_OUT.get(f.type, "misc_feature"),
                qualifiers=qualifiers,
            )
        )
    return bio_rec


def export_string(record: PlasmidRecord, fmt: str) -> str:
    bio_fmt = _WRITE_FORMATS.get(fmt.lower())
    if bio_fmt is None:
        raise ValueError(f"unsupported export format: {fmt}")
    handle = io.StringIO()
    SeqIO.write(to_biopython(record), handle, bio_fmt)
    return handle.getvalue()
