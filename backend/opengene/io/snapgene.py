"""SnapGene ``.dna`` writer, plus the extra fields OpenGene reads from ``.dna``
files that Biopython's reader drops (feature colors).

A ``.dna`` file is a series of packets, each one byte of type, a big-endian
uint32 length, then the data:

    0x09  cookie     b"SnapGene", uint16 sequence type (1 = DNA),
                     uint16 export version, uint16 import version
    0x00  DNA        one flags byte (bit 0 circular, bit 1 double-stranded,
                     bits 2-4 Dam/Dcm/EcoKI methylation), then ASCII bases
    0x08  XML        <AdditionalSequenceProperties> (end stickiness)
    0x0A  XML        <Features>: one <Feature> per feature, one <Segment> per
                     piece with a 1-based inclusive ``range="start-end"``
                     (start > end wraps the origin); gaps between pieces are
                     ``type="gap"`` segments
    0x05  XML        <Primers>
    0x06  XML        <Notes> (UUID, dates, description)

Packets OpenGene doesn't write (enzyme caches, history, alignments) are
optional; SnapGene rebuilds them on open.
"""

from __future__ import annotations

import re
import struct
import uuid
from datetime import datetime, timezone
from xml.dom.minidom import parseString
from xml.sax.saxutils import quoteattr

from ..models import Feature, PlasmidRecord

# Cookie versions copied from a file saved by a recent SnapGene release.
_SEQ_TYPE_DNA = 1
_EXPORT_VERSION = 14
_IMPORT_VERSION = 16

_FLAG_CIRCULAR = 0x01
_FLAG_DOUBLE_STRANDED = 0x02
# Dam+, Dcm+, EcoKI+: SnapGene's default for plasmids grown in E. coli K-12.
_FLAGS_METHYLATION = 0x04 | 0x08 | 0x10

_DIRECTIONALITY = {1: "1", -1: "2"}
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_DEFAULT_COLOR = "#a6acb3"  # SnapGene's grey for features with no color

# OpenGene type -> SnapGene (GenBank) feature key. Other types are written as is.
_TYPE_OUT = {
    "origin": "rep_origin",
    "primer": "primer_bind",
    "tag": "misc_feature",
}

# Qualifiers OpenGene writes from its own fields, never copied from notes.
_OWN_QUALIFIERS = {"label", "ApEinfo_fwdcolor", "ApEinfo_revcolor", "color"}

# Bytes XML 1.0 can't hold even when escaped (control characters).
_XML_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _packet(kind: int, data: bytes) -> bytes:
    return struct.pack(">BI", kind, len(data)) + data


def _attr(value: object) -> str:
    """A quoted, escaped XML attribute value."""
    return quoteattr(_XML_ILLEGAL.sub("", str(value)))


def _text(value: object) -> str:
    return (
        _XML_ILLEGAL.sub("", str(value))
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _range(start: int, end: int, n: int) -> str:
    """SnapGene's 1-based inclusive range for half-open ``[start, end)``.
    ``start > end`` (wrapping the origin) stays start > end, as SnapGene
    writes it."""
    if start > end:
        return f"{start + 1}-{end if end > 0 else n}"
    return f"{start + 1}-{max(end, start + 1)}"


def _color(feature: Feature) -> str:
    if feature.color and _HEX_COLOR.match(feature.color):
        return feature.color
    return _DEFAULT_COLOR


def _feature_xml(feature: Feature, recent_id: int, n: int) -> str:
    ftype = _TYPE_OUT.get(feature.type, feature.type)
    color = _color(feature)
    translated = ' translated="1"' if feature.type == "CDS" else ""
    spans = feature.spans()
    segments: list[str] = []
    for i, (s, e) in enumerate(spans):
        if i:
            # The gap (intron) between the previous piece and this one.
            gap_start, gap_end = spans[i - 1][1], s
            if gap_start != gap_end:
                segments.append(
                    f"<Segment range={_attr(_range(gap_start, gap_end, n))} "
                    f'color={_attr(color)} type="gap"/>'
                )
        segments.append(
            f"<Segment range={_attr(_range(s, e, n))} color={_attr(color)} "
            f'type="standard"{translated}/>'
        )
    qualifiers: list[str] = []
    for key, value in feature.notes.items():
        if key in _OWN_QUALIFIERS:
            continue
        values = value if isinstance(value, list) else [value]
        vs = "".join(f"<V text={_attr(v)}/>" for v in values)
        qualifiers.append(f"<Q name={_attr(key)}>{vs}</Q>")
    reverse = (
        ' swappedSegmentNumbering="1" readingFrame="-1"' if feature.strand == -1 else ""
    )
    return (
        f"<Feature recentID={_attr(recent_id)} name={_attr(feature.name)} "
        f"directionality={_attr(_DIRECTIONALITY[feature.strand])} type={_attr(ftype)}"
        f'{reverse} allowSegmentOverlaps="0" consecutiveTranslationNumbering="1">'
        + "".join(segments)
        + "".join(qualifiers)
        + "</Feature>"
    )


def _features_xml(record: PlasmidRecord) -> bytes:
    n = record.length
    body = "".join(_feature_xml(f, i, n) for i, f in enumerate(record.features))
    return (
        f'<?xml version="1.0"?><Features nextValidID="{len(record.features)}">'
        f"{body}</Features>"
    ).encode("utf-8")


def _primers_xml(record: PlasmidRecord) -> bytes:
    primers = []
    for i, p in enumerate(record.primers):
        # Primer binding sites are written shifted: 0-based start, 0-based
        # inclusive end (Biopython's reader undoes the same shift).
        last = (p.bind_end - 1) % record.length if record.length else 0
        site = (
            f"<BindingSite location={_attr(f'{p.bind_start}-{last}')} "
            f'boundStrand="{0 if p.strand == 1 else 1}" '
            f"annealedBases={_attr(p.sequence)} "
            f'meltingTemperature="{round(p.tm)}"/>'
        )
        primers.append(
            f"<Primer recentID={_attr(i)} name={_attr(p.name)} "
            f"sequence={_attr(p.sequence)}>{site}</Primer>"
        )
    return (
        f'<?xml version="1.0"?><Primers nextValidID="{len(primers)}">'
        '<HybridizationParams minContinuousMatchLen="10" allowMismatch="1" '
        'minMeltingTemperature="40" showAdditionalFivePrimeMatches="1" '
        'minimumFivePrimeAnnealing="15"/>'
        + "".join(primers)
        + "</Primers>"
    ).encode("utf-8")


def _snapgene_date(ts: float) -> tuple[str, str]:
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    return f"{d.year}.{d.month}.{d.day}", f"{d.hour}:{d.minute}:{d.second}"


def _notes_xml(record: PlasmidRecord) -> bytes:
    created, created_utc = _snapgene_date(record.created_at)
    modified, modified_utc = _snapgene_date(record.updated_at)
    # A stable UUID per record, so re-exporting the same plasmid gives the
    # same identity in SnapGene.
    rec_uuid = uuid.uuid5(uuid.NAMESPACE_URL, f"opengene:{record.id}")
    return (
        "<Notes>"
        f"<UUID>{rec_uuid}</UUID>"
        "<Type>Synthetic</Type>"
        f"<Description>{_text(record.name)}</Description>"
        f'<Created UTC="{created_utc}">{created}</Created>'
        f'<LastModified UTC="{modified_utc}">{modified}</LastModified>'
        "<CreatedBy>OpenGene</CreatedBy>"
        "<SequenceClass>UNA</SequenceClass>"
        "<TransformedInto>unspecified</TransformedInto>"
        "</Notes>"
    ).encode("utf-8")


_ADDITIONAL_PROPERTIES = (
    b"<AdditionalSequenceProperties><UpstreamStickiness>0</UpstreamStickiness>"
    b"<DownstreamStickiness>0</DownstreamStickiness>"
    b"<UpstreamModification>Unmodified</UpstreamModification>"
    b"<DownstreamModification>Unmodified</DownstreamModification>"
    b"</AdditionalSequenceProperties>"
)


def to_snapgene(record: PlasmidRecord) -> bytes:
    """Serialize a record as a SnapGene ``.dna`` file."""
    flags = _FLAG_DOUBLE_STRANDED | _FLAGS_METHYLATION
    if record.is_circular:
        flags |= _FLAG_CIRCULAR
    cookie = b"SnapGene" + struct.pack(">HHH", _SEQ_TYPE_DNA, _EXPORT_VERSION, _IMPORT_VERSION)
    return b"".join(
        [
            _packet(0x09, cookie),
            _packet(0x00, bytes([flags]) + record.sequence.encode("ascii")),
            _packet(0x08, _ADDITIONAL_PROPERTIES),
            _packet(0x0A, _features_xml(record)),
            _packet(0x05, _primers_xml(record)),
            _packet(0x06, _notes_xml(record)),
        ]
    )


# --------------------------------------------------------------------------
# Reading: what Biopython's reader leaves out
# --------------------------------------------------------------------------

def _packets(data: bytes):
    i = 0
    while i + 5 <= len(data):
        kind, length = struct.unpack(">BI", data[i : i + 5])
        yield kind, data[i + 5 : i + 5 + length]
        i += 5 + length


def feature_colors(data: bytes) -> tuple[list[str | None], bool]:
    """Colors of the features in a ``.dna`` file's Features packet, in file
    order (the first non-gap segment's color), and whether that packet comes
    before the Primers packet — Biopython adds features packet by packet, so
    this says where in its feature list these ones sit."""
    colors: list[str | None] = []
    features_first = True
    seen_primers = False
    for kind, body in _packets(data):
        if kind == 0x05:
            seen_primers = True
        elif kind == 0x0A:
            features_first = not seen_primers
            try:
                xml = parseString(body.decode("utf-8"))
            except Exception:
                return [], True
            for feat in xml.getElementsByTagName("Feature"):
                color = None
                for seg in feat.getElementsByTagName("Segment"):
                    if seg.getAttribute("type") != "gap" and seg.getAttribute("color"):
                        color = seg.getAttribute("color")
                        break
                colors.append(color)
    return colors, features_first
