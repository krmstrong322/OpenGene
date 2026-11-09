"""SnapGene .dna export, and IUPAC ambiguity codes in sequences."""

import io
import struct
from xml.dom.minidom import parseString

import pytest
from Bio import SeqIO
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.core import primers as P
from opengene.core import sequence as S
from opengene.io import files as IO
from opengene.io.snapgene import to_snapgene
from opengene.models import Feature, PlasmidRecord, Primer, Segment
from opengene.samples import _samples_dir, sample_specs
from opengene.session import store

SEQ = "ATGC" * 250  # 1000 bp


def _packets(data: bytes) -> list[tuple[int, bytes]]:
    out, i = [], 0
    while i < len(data):
        kind, length = struct.unpack(">BI", data[i : i + 5])
        out.append((kind, data[i + 5 : i + 5 + length]))
        i += 5 + length
    assert i == len(data)
    return out


def _xml(data: bytes, kind: int):
    return parseString(dict(_packets(data))[kind].decode("utf-8"))


def _summary(rec: PlasmidRecord):
    # A feature with no color is written in SnapGene's default grey.
    return [(f.name, f.type, f.spans(), f.strand, (f.color or "#a6acb3").lower()) for f in rec.features]


# --------------------------------------------------------------------------
# File structure
# --------------------------------------------------------------------------

def test_packets_start_with_the_snapgene_cookie():
    data = to_snapgene(PlasmidRecord(name="t", sequence=SEQ))
    kinds = [k for k, _ in _packets(data)]
    assert kinds[0] == 0x09 and set(kinds) >= {0x00, 0x0A, 0x05, 0x06}
    cookie = dict(_packets(data))[0x09]
    assert cookie[:8] == b"SnapGene" and struct.unpack(">H", cookie[8:10])[0] == 1


@pytest.mark.parametrize("circular", [True, False])
def test_dna_packet_flags_and_sequence(circular):
    data = to_snapgene(PlasmidRecord(name="t", sequence=SEQ, is_circular=circular))
    dna = dict(_packets(data))[0x00]
    assert bool(dna[0] & 0x01) == circular and dna[0] & 0x02
    assert dna[1:].decode() == SEQ
    bio = SeqIO.read(io.BytesIO(data), "snapgene")
    assert bio.annotations["topology"] == ("circular" if circular else "linear")


def test_wrapping_feature_range_runs_across_the_origin():
    rec = PlasmidRecord(name="t", sequence=SEQ, features=[Feature(name="w", type="CDS", start=990, end=20)])
    seg = _xml(to_snapgene(rec), 0x0A).getElementsByTagName("Segment")[0]
    assert seg.getAttribute("range") == "991-20"


def test_multi_part_feature_writes_gap_segments():
    f = Feature(
        name="g", type="CDS", start=100, end=300, strand=-1,
        segments=[Segment(start=100, end=150), Segment(start=250, end=300)],
    )
    xml = _xml(to_snapgene(PlasmidRecord(name="t", sequence=SEQ, features=[f])), 0x0A)
    feat = xml.getElementsByTagName("Feature")[0]
    assert feat.getAttribute("directionality") == "2"
    segs = [(s.getAttribute("range"), s.getAttribute("type")) for s in feat.getElementsByTagName("Segment")]
    assert segs == [("101-150", "standard"), ("151-250", "gap"), ("251-300", "standard")]


def test_types_qualifiers_and_awkward_text_survive():
    f = Feature(
        name='a "quoted" & name', type="origin", start=0, end=50,
        notes={"note": ["one & two", "<three>"], "gene": "ΔlacZ"},
    )
    rec = PlasmidRecord(name="pΔ", sequence=SEQ, features=[f])
    back = IO.parse_bytes(to_snapgene(rec), "x.dna").features[0]
    assert back.name == 'a "quoted" & name'
    assert back.type == "origin"
    # Biopython's reader strips anything tag-shaped (SnapGene stores HTML).
    assert back.notes["note"] == ["one & two", ""]
    assert back.notes["gene"] == "ΔlacZ"
    feat = _xml(to_snapgene(rec), 0x0A).getElementsByTagName("Feature")[0]
    assert feat.getAttribute("type") == "rep_origin"


def test_primers_are_written_as_binding_sites():
    rec = PlasmidRecord(
        name="t", sequence=SEQ,
        primers=[
            Primer(name="fwd", sequence=SEQ[100:120], bindStart=100, bindEnd=120, strand=1, tm=55, gcContent=50),
            Primer(name="rev", sequence=S.reverse_complement(SEQ[300:322]), bindStart=300, bindEnd=322,
                   strand=-1, tm=58, gcContent=50),
        ],
    )
    back = IO.parse_bytes(to_snapgene(rec), "x.dna")
    got = {(f.name, f.type, f.start, f.end, f.strand) for f in back.features}
    assert got == {("fwd", "primer", 100, 120, 1), ("rev", "primer", 300, 322, -1)}


# --------------------------------------------------------------------------
# Round trips
# --------------------------------------------------------------------------

@pytest.mark.parametrize("spec", sample_specs(), ids=lambda s: s.file)
def test_samples_round_trip_through_dna(spec):
    data = _samples_dir().joinpath(spec.file).read_bytes()
    first = IO.parse_bytes(data, spec.file)
    again = IO.parse_bytes(to_snapgene(first), "again.dna")
    assert again.sequence == first.sequence
    assert again.is_circular == first.is_circular
    assert _summary(again) == _summary(first)


def test_dna_import_keeps_feature_colors_but_not_white():
    rec = PlasmidRecord(
        name="t", sequence=SEQ,
        features=[
            Feature(name="a", type="CDS", start=0, end=30, color="#123456"),
            Feature(name="p", type="promoter", start=40, end=80, color="#ffffff"),
        ],
    )
    back = {f.name: f.color for f in IO.parse_bytes(to_snapgene(rec), "x.dna").features}
    assert back["a"] == "#123456"
    assert back["p"] != "#ffffff"  # white falls back to the type color


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

@pytest.fixture
def client():
    store.clear()
    yield TestClient(app)
    store.clear()


@pytest.mark.parametrize("fmt", ["snapgene", "dna"])
def test_api_exports_dna(client, fmt):
    rec = client.post("/records", json={"name": "my plasmid", "sequence": SEQ, "isCircular": True}).json()
    r = client.get(f"/records/{rec['id']}/export", params={"fmt": fmt})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert 'filename="myplasmid.dna"' in r.headers["content-disposition"]
    assert r.content.startswith(b"\x09\x00\x00\x00\x0eSnapGene")
    # And it imports straight back.
    back = client.post("/records/import", files={"file": ("x.dna", r.content, "application/octet-stream")})
    assert back.status_code == 200 and back.json()["sequence"] == SEQ


def test_api_rejects_unknown_export_format(client):
    rec = client.post("/records", json={"name": "t", "sequence": SEQ, "isCircular": True}).json()
    assert client.get(f"/records/{rec['id']}/export", params={"fmt": "xdna"}).status_code == 422


# --------------------------------------------------------------------------
# IUPAC ambiguity codes
# --------------------------------------------------------------------------

AMBIGUOUS = "RYSWKMBDHVN"


def test_ambiguity_codes_are_accepted_everywhere_bases_are():
    rec = PlasmidRecord(name="t", sequence=SEQ[:100] + AMBIGUOUS.lower() + SEQ[100:])
    assert AMBIGUOUS in rec.sequence
    S.insert(rec, 0, "ry")
    S.mutate(rec, 5, "k")
    assert rec.sequence.startswith("RY") and rec.sequence[5] == "K"


def test_other_letters_are_still_rejected():
    with pytest.raises(ValueError):
        PlasmidRecord(name="t", sequence="ACGTX")
    with pytest.raises(S.SequenceError):
        S.validate_sequence("AC-GT")


def test_reverse_complement_of_ambiguity_codes():
    assert S.reverse_complement("ACGTRYSWKMBDHVN") == "NBDHVKMWSRYACGT"


def test_ambiguous_codes_survive_every_export_format():
    rec = PlasmidRecord(name="t", sequence=SEQ[:500] + AMBIGUOUS + SEQ[500:])
    for fmt, ext in (("genbank", "gb"), ("fasta", "fasta"), ("embl", "embl")):
        assert IO.parse_bytes(IO.export_string(rec, fmt).encode(), f"x.{ext}").sequence == rec.sequence
    assert IO.parse_bytes(to_snapgene(rec), "x.dna").sequence == rec.sequence


def test_degenerate_primer_analysis_is_a_clear_error_not_a_crash(client):
    with pytest.raises(S.SequenceError, match="ambiguous bases"):
        P.analyze_primer("ACGTRACGTACGTACGTACG")
    r = client.post("/primers/analyze", json={"sequence": "ACGTNACGTACGTACGTACG"})
    assert r.status_code == 422 and "ambiguous" in r.json()["detail"]


def test_primer_design_on_an_ambiguous_site_is_a_clear_error(client):
    seq = SEQ[:200] + "N" * 40 + SEQ[200:]
    rec = client.post("/records", json={"name": "t", "sequence": seq, "isCircular": True}).json()
    r = client.post(f"/records/{rec['id']}/design_primers", json={"region_start": 200, "region_end": 600})
    assert r.status_code == 422 and "ambiguous" in r.json()["detail"]


def test_primer_growth_stops_before_an_ambiguous_base():
    # A definite 18-base start, then an N: the primer stays clear of it.
    seq = "GCGCATATGCGCATATGC" + "N" + SEQ
    rec = PlasmidRecord(name="t", sequence=seq, is_circular=False)
    fwd, _ = P.design_primer_pair(rec, 0, 400)
    assert "N" not in fwd.sequence and len(fwd.sequence) == 18
