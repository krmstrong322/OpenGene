"""Multi-part (joined) features, origin-spanning joins, feature types and
qualifiers: what an imported file says must survive import, edits and export."""

import io

import pytest
from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqFeature import CompoundLocation, SeqFeature, SimpleLocation
from Bio.SeqRecord import SeqRecord
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.core import sequence as S
from opengene.io import files as IO
from opengene.models import Feature, PlasmidRecord, Segment
from opengene.samples import _samples_dir, sample_specs
from opengene.session import store

N = 1000
SEQ = ("ATGC" * 250)


def _gb(features, n=N, circular=True) -> str:
    rec = SeqRecord(
        Seq(SEQ[:n]),
        id="t",
        name="t",
        annotations={"molecule_type": "DNA", "topology": "circular" if circular else "linear"},
    )
    rec.features.extend(features)
    h = io.StringIO()
    SeqIO.write(rec, h, "genbank")
    return h.getvalue()


def _import(features, **kw) -> PlasmidRecord:
    return IO.parse_bytes(_gb(features, **kw).encode(), "t.gb")


def _locations(text: str) -> dict[str, str]:
    """Feature key + location lines of a GenBank text, keyed by /label."""
    rec = SeqIO.read(io.StringIO(text), "genbank")
    return {
        f.qualifiers["label"][0]: f"{f.type} {f.location}"
        for f in rec.features
        if "label" in f.qualifiers
    }


def _export(record: PlasmidRecord) -> str:
    return IO.export_string(record, "genbank")


def _feat(name: str, ftype: str, loc, **quals) -> SeqFeature:
    q = {"label": [name]}
    q.update({k: v if isinstance(v, list) else [v] for k, v in quals.items()})
    return SeqFeature(loc, type=ftype, qualifiers=q)


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------

def test_origin_spanning_join_is_a_wrapping_span_not_the_whole_plasmid():
    rec = _import([_feat("orf", "CDS", CompoundLocation([SimpleLocation(900, N, 1), SimpleLocation(0, 50, 1)]))])
    f = rec.features[0]
    assert (f.start, f.end, f.segments) == (900, 50, [])
    assert f.length(N) == 150


def test_minus_strand_origin_join_written_either_way_round_merges():
    canonical = CompoundLocation([SimpleLocation(0, 50, -1), SimpleLocation(900, N, -1)])
    flipped = CompoundLocation([SimpleLocation(900, N, -1), SimpleLocation(0, 50, -1)])
    for loc in (canonical, flipped):
        f = _import([_feat("x", "CDS", loc)]).features[0]
        assert (f.start, f.end, f.strand, f.segments) == (900, 50, -1, [])


def test_join_with_gaps_keeps_its_parts():
    loc = CompoundLocation([SimpleLocation(400, 450, -1), SimpleLocation(100, 200, -1)])
    f = _import([_feat("split", "gene", loc)]).features[0]
    assert (f.start, f.end) == (100, 450)
    assert f.spans() == [(100, 200), (400, 450)]
    assert f.coding_length(N) == 150


def test_join_crossing_the_origin_with_a_gap():
    loc = CompoundLocation(
        [SimpleLocation(300, 320, -1), SimpleLocation(0, 30, -1), SimpleLocation(950, N, -1)]
    )
    f = _import([_feat("e", "exon", loc)]).features[0]
    assert f.spans() == [(950, 30), (300, 320)]
    assert (f.start, f.end) == (950, 320)


def test_linear_record_join_is_not_merged_across_the_ends():
    loc = CompoundLocation([SimpleLocation(0, 50, 1), SimpleLocation(900, N, 1)])
    f = _import([_feat("x", "misc_feature", loc)], circular=False).features[0]
    assert f.spans() == [(0, 50), (900, N)]


def test_genbank_feature_keys_are_kept():
    keys = ["gene", "exon", "polyA_signal", "enhancer", "LTR", "protein_bind", "sig_peptide"]
    rec = _import([_feat(k, k, SimpleLocation(10 * i, 10 * i + 5, 1)) for i, k in enumerate(keys)])
    assert [f.type for f in rec.features] == keys


def test_renamed_keys_map_to_opengene_types():
    rec = _import([
        _feat("ori", "rep_origin", SimpleLocation(0, 10, 1)),
        _feat("p1", "primer_bind", SimpleLocation(20, 40, 1)),
        _feat("prom", "regulatory", SimpleLocation(50, 90, 1), regulatory_class="promoter"),
        _feat("term", "regulatory", SimpleLocation(100, 140, 1), regulatory_class="terminator"),
        _feat("enh", "regulatory", SimpleLocation(150, 190, 1), regulatory_class="enhancer"),
    ])
    assert [f.type for f in rec.features] == ["origin", "primer", "promoter", "terminator", "regulatory"]


def test_repeated_qualifiers_are_all_kept():
    f = _import([_feat("x", "CDS", SimpleLocation(0, 30, 1), note=["one", "two"], gene="abc")]).features[0]
    assert f.notes["note"] == ["one", "two"]
    assert f.notes["gene"] == "abc"


# --------------------------------------------------------------------------
# Round trip
# --------------------------------------------------------------------------

def test_round_trip_preserves_locations_types_and_qualifiers():
    feats = [
        _feat("wrap", "CDS", CompoundLocation([SimpleLocation(900, N, 1), SimpleLocation(0, 51, 1)]),
              note=["a", "b"]),
        _feat("split", "gene", CompoundLocation([SimpleLocation(400, 450, -1), SimpleLocation(100, 200, -1)])),
        _feat("prom", "regulatory", SimpleLocation(600, 650, 1), regulatory_class="promoter"),
        _feat("ori", "rep_origin", SimpleLocation(700, 800, 1)),
        _feat("pA", "polyA_signal", SimpleLocation(810, 830, -1)),
    ]
    original = _gb(feats)
    out = _export(IO.parse_bytes(original.encode(), "t.gb"))
    assert _locations(out) == _locations(original)
    notes = {f.qualifiers["label"][0]: f.qualifiers for f in SeqIO.read(io.StringIO(out), "genbank").features}
    assert notes["wrap"]["note"] == ["a", "b"]
    assert notes["prom"]["regulatory_class"] == ["promoter"]


def test_wrapping_feature_made_in_the_app_exports_as_a_join():
    rec = PlasmidRecord(name="t", sequence=SEQ, features=[Feature(name="w", type="CDS", start=990, end=20)])
    assert _locations(_export(rec))["w"] == "CDS join{[990:1000](+), [0:20](+)}"


def test_renamed_feature_exports_its_new_name():
    rec = _import([_feat("old", "CDS", SimpleLocation(0, 30, 1))])
    rec.features[0] = rec.features[0].model_copy(update={"name": "new"})
    assert list(_locations(_export(rec))) == ["new"]


@pytest.mark.parametrize("spec", sample_specs(), ids=lambda s: s.file)
def test_sample_files_round_trip(spec):
    data = _samples_dir().joinpath(spec.file).read_bytes()
    first = IO.parse_bytes(data, spec.file)
    again = IO.parse_bytes(_export(first).encode(), "again.gb")
    assert [(f.type, f.spans(), f.strand) for f in again.features] == [
        (f.type, f.spans(), f.strand) for f in first.features
    ]


# --------------------------------------------------------------------------
# Edits move every part
# --------------------------------------------------------------------------

def _spliced(strand=1) -> PlasmidRecord:
    # Two 30 bp exons (a 60 bp spliced CDS) with a 40 bp intron between.
    return PlasmidRecord(
        name="t",
        sequence=SEQ,
        features=[
            Feature(
                name="cds", type="CDS", start=100, end=200, strand=strand,
                segments=[Segment(start=100, end=130), Segment(start=170, end=200)],
            )
        ],
    )


def test_insert_in_intron_moves_later_parts_and_keeps_the_frame():
    rec = S.insert(_spliced(), 150, "A")  # 1 bp: fine, the intron isn't coded
    f = rec.features[0]
    assert f.spans() == [(100, 130), (171, 201)]
    assert (f.start, f.end) == (100, 201)


def test_insert_in_exon_of_spliced_cds_is_a_frameshift():
    with pytest.raises(S.FrameShiftError):
        S.insert(_spliced(), 110, "A")


def test_delete_covering_one_part_drops_only_that_part():
    rec = S.delete(_spliced(), 160, 210, frame_policy="allow")
    f = rec.features[0]
    assert (f.start, f.end, f.segments) == (100, 130, [])


def test_delete_covering_every_part_removes_the_feature():
    rec = S.delete(_spliced(), 90, 210, frame_policy="allow")
    assert rec.features == []


def test_wrapping_edit_rotates_every_part():
    rec = _spliced()
    rec = S.replace_range(rec, 990, 10, "GGGGGGGGGGGGGGGGGGGG")  # same length, wraps
    f = rec.features[0]
    assert f.spans() == [(f.start, f.start + 30), (f.start + 70, f.end)]
    assert f.end - f.start == 100
    assert rec.sequence[f.start:f.end] == SEQ[100:200]


def test_reverse_complement_flips_parts():
    rec = S.reverse_complement_record(_spliced())
    f = rec.features[0]
    assert f.strand == -1
    assert f.spans() == [(N - 200, N - 170), (N - 130, N - 100)]


def test_segments_must_match_the_outer_span():
    with pytest.raises(ValueError):
        Feature(name="x", start=0, end=50, segments=[Segment(start=0, end=10), Segment(start=20, end=40)])


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

@pytest.fixture
def client():
    store.clear()
    yield TestClient(app)
    store.clear()


def test_api_import_returns_parts_and_blocks_span_edits(client):
    text = _gb([_feat("split", "gene", CompoundLocation([SimpleLocation(100, 200, 1), SimpleLocation(400, 450, 1)]))])
    r = client.post("/records/import", files={"file": ("t.gb", text.encode(), "text/plain")})
    assert r.status_code == 200
    rec = r.json()
    f = rec["features"][0]
    assert f["type"] == "gene"
    assert f["segments"] == [{"start": 100, "end": 200}, {"start": 400, "end": 450}]

    url = f"/records/{rec['id']}/features/{f['id']}"
    assert client.patch(url, json={"start": 120}).status_code == 422
    r = client.patch(url, json={"name": "renamed", "type": "mRNA"})
    assert r.status_code == 200
    assert r.json()["features"][0]["type"] == "mRNA"


def test_api_accepts_any_feature_key(client):
    rec = client.post("/records", json={"name": "t", "sequence": SEQ, "isCircular": True}).json()
    r = client.post(f"/records/{rec['id']}/features",
                    json={"name": "e", "type": "enhancer", "start": 0, "end": 40, "strand": 1})
    assert r.status_code == 200
    assert r.json()["features"][0]["type"] == "enhancer"
    bad = client.post(f"/records/{rec['id']}/features",
                      json={"name": "e", "type": "two words", "start": 0, "end": 40, "strand": 1})
    assert bad.status_code == 422
