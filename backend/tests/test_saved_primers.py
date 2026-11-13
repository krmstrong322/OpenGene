"""Saved primers: oligos that belong to a record and stay with it."""

import pytest
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.core import primers as P
from opengene.session import store

UP = "GATTACAGGCTTAACCGGTA"
DOWN = "CCATGGTTCAAGTCGATCCA"
TEMPLATE = "ACGT" * 5 + UP + "TTTT" * 5 + DOWN + "ACGT" * 5  # 100 bp
DOWN_PRIMER = "TGGATCGACTTGAACCATGG"  # reverse complement of DOWN


@pytest.fixture(autouse=True)
def _clear_store():
    store.clear()
    yield
    store.clear()


@pytest.fixture
def client():
    return TestClient(app, base_url="http://localhost")


@pytest.fixture
def rid(client):
    r = client.post("/records", json={"name": "pTest", "sequence": TEMPLATE, "isCircular": True})
    return r.json()["id"]


def _add(client, rid, name, sequence):
    r = client.post(f"/records/{rid}/primers", json={"name": name, "sequence": sequence})
    assert r.status_code == 200, r.text
    return r.json()


def _primer(rec, name):
    return next(p for p in rec["primers"] if p["name"] == name)


def test_added_primer_gets_tm_gc_and_its_binding_site(client, rid):
    rec = _add(client, rid, "  up  primer ", "5'-gattacaggc ttaaccggta-3'")
    p = _primer(rec, "up primer")
    assert p["sequence"] == UP
    assert (p["bindStart"], p["bindEnd"], p["strand"], p["bindingSites"]) == (20, 40, 1, 1)
    assert p["tm"] > 40 and p["gcContent"] == 45.0
    assert rec["canUndo"] and "added primer" in rec["history"][-1]["description"]


def test_reverse_primer_binds_the_other_strand(client, rid):
    p = _primer(_add(client, rid, "down", DOWN_PRIMER), "down")
    assert (p["bindStart"], p["bindEnd"], p["strand"]) == (60, 80, -1)


def test_primer_that_matches_nothing_is_saved_as_not_binding(client, rid):
    p = _primer(_add(client, rid, "stray", "GGGGGGGGGGCCCCCCCCCC"), "stray")
    assert p["bindStart"] is None and p["bindEnd"] is None and p["bindingSites"] == 0


@pytest.mark.parametrize(
    "name, sequence, problem",
    [
        ("", UP, "needs a name"),
        ("x", "", "needs a sequence"),
        ("x", "ACGTNNACGTACGTACGT", "ambiguous"),
        ("x", "ACGT" * 60, "at most"),
    ],
)
def test_bad_primers_are_refused(client, rid, name, sequence, problem):
    r = client.post(f"/records/{rid}/primers", json={"name": name, "sequence": sequence})
    assert r.status_code == 422 and problem in r.json()["detail"]
    assert client.get(f"/records/{rid}").json()["primers"] == []


def test_duplicate_names_are_numbered(client, rid):
    _add(client, rid, "seq-F", UP)
    rec = _add(client, rid, "seq-F", DOWN_PRIMER)
    assert [p["name"] for p in rec["primers"]] == ["seq-F", "seq-F 2"]


def test_primers_follow_edits_and_survive_losing_their_site(client, rid):
    _add(client, rid, "up", UP)
    _add(client, rid, "down", DOWN_PRIMER)
    rec = client.post(f"/records/{rid}/insert", json={"position": 50, "sequence": "AAAAAA", "frame_policy": "allow"}).json()
    assert (_primer(rec, "up")["bindStart"], _primer(rec, "down")["bindStart"]) == (20, 66)
    rec = client.post(f"/records/{rid}/delete", json={"start": 15, "end": 45, "frame_policy": "allow"}).json()
    assert len(rec["primers"]) == 2
    assert _primer(rec, "up")["bindStart"] is None
    assert "up no longer binds" in rec["history"][-1]["warnings"][-1]
    # Undo brings the site, and the binding, back.
    rec = client.post(f"/records/{rid}/undo").json()
    assert _primer(rec, "up")["bindStart"] == 20


def test_rename_and_change_sequence(client, rid):
    pid = _add(client, rid, "up", UP)["primers"][0]["id"]
    rec = client.patch(f"/records/{rid}/primers/{pid}", json={"name": "pTest-F1"}).json()
    assert _primer(rec, "pTest-F1")["bindStart"] == 20
    rec = client.patch(f"/records/{rid}/primers/{pid}", json={"sequence": DOWN_PRIMER}).json()
    p = _primer(rec, "pTest-F1")
    assert p["id"] == pid and (p["bindStart"], p["strand"]) == (60, -1)
    assert client.patch(f"/records/{rid}/primers/{pid}", json={"sequence": "ACGTN"}).status_code == 422
    assert client.patch(f"/records/{rid}/primers/nope", json={"name": "x"}).status_code == 404


def test_unchanged_update_leaves_no_undo_step(client, rid):
    rec = _add(client, rid, "up", UP)
    steps = len(rec["history"])
    rec = client.patch(f"/records/{rid}/primers/{rec['primers'][0]['id']}", json={"name": "up"}).json()
    assert len(rec["history"]) == steps


def test_delete_primer_is_undoable(client, rid):
    pid = _add(client, rid, "up", UP)["primers"][0]["id"]
    assert client.delete(f"/records/{rid}/primers/{pid}").json()["primers"] == []
    assert client.delete(f"/records/{rid}/primers/{pid}").status_code == 404
    assert len(client.post(f"/records/{rid}/undo").json()["primers"]) == 1


def test_designed_pair_is_saved_with_distinct_names(client, rid):
    body = {"region_start": 20, "region_end": 80}
    first = client.post(f"/records/{rid}/design_primers", json=body).json()
    second = client.post(f"/records/{rid}/design_primers", json=body).json()
    names = [p["name"] for p in second["record"]["primers"]]
    assert len(names) == 4 and len(set(names)) == 4
    assert first["forward"]["bindStart"] == 20 and first["reverse"]["strand"] == -1


def test_library_listing_carries_each_records_primers(client, rid):
    _add(client, rid, "up", UP)
    row = next(r for r in client.get("/records").json() if r["id"] == rid)
    assert [(p["name"], p["sequence"], p["bindStart"]) for p in row["primers"]] == [("up", UP, 20)]
    assert "sequence" not in row  # the listing stays light: no record sequence


# -- import / export ----------------------------------------------------------

def test_parse_fasta_and_tables():
    assert P.parse_primer_list(f">F1 forward\n{UP[:10]}\n{UP[10:]}\n>R1\n{DOWN_PRIMER}\n") == [
        ("F1 forward", UP),
        ("R1", DOWN_PRIMER),
    ]
    table = f"Name\\tSequence\\tScale\nF1\\t{UP}\\t25 nmol\nR1\\t{DOWN_PRIMER}\\t25 nmol\n".replace("\\\\t", "\\t")
    assert P.parse_primer_list(table.replace("\\t", "\t")) == [("F1", UP), ("R1", DOWN_PRIMER)]
    assert P.parse_primer_list(f"F1,{UP}\nR1;{DOWN_PRIMER}\n") == [("F1", UP), ("R1", DOWN_PRIMER)]
    assert P.parse_primer_list(f"F1 {UP}\n{DOWN_PRIMER}\n") == [("F1", UP), ("primer 2", DOWN_PRIMER)]
    assert P.parse_primer_list("just some words\n\n") == []


def test_import_adds_good_rows_and_reports_bad_ones(client, rid):
    text = f"F1,{UP}\nbad,ACGTACGTNNNNACGT\nR1,{DOWN_PRIMER}\n"
    r = client.post(f"/records/{rid}/primers/import", json={"text": text}).json()
    assert r["added"] == ["F1", "R1"]
    assert r["skipped"] == []  # a row whose sequence isn't plain bases isn't read as a primer
    assert len(r["record"]["primers"]) == 2
    # One import is one undo step.
    assert client.post(f"/records/{rid}/undo").json()["primers"] == []


def test_import_with_nothing_readable_is_an_error(client, rid):
    r = client.post(f"/records/{rid}/primers/import", json={"text": "hello\nworld\n"})
    assert r.status_code == 422 and "no primers found" in r.json()["detail"]


def test_import_reports_a_primer_that_is_too_long(client, rid):
    r = client.post(f"/records/{rid}/primers/import", json={"text": f">long\n{'ACGT' * 60}\n>ok\n{UP}\n"}).json()
    assert r["added"] == ["ok"] and len(r["skipped"]) == 1 and "long" in r["skipped"][0]


def test_export_csv_and_fasta(client, rid):
    _add(client, rid, "up", UP)
    _add(client, rid, "stray", "GGGGGGGGGGCCCCCCCCCC")
    csv = client.get(f"/records/{rid}/primers/export?fmt=csv")
    assert csv.status_code == 200 and "pTest%20primers.csv" in csv.headers["content-disposition"]
    lines = csv.text.strip().split("\n")
    assert lines[0].startswith("Name,Sequence")
    assert lines[1].split(",")[:3] == ["up", UP, "20"] and "21-40" in lines[1] and lines[1].endswith("+")
    assert "does not bind" in lines[2]
    fasta = client.get(f"/records/{rid}/primers/export?fmt=fasta").text
    assert fasta == f">up\n{UP}\n>stray\nGGGGGGGGGGCCCCCCCCCC\n"
    assert client.get(f"/records/{rid}/primers/export?fmt=xlsx").status_code == 422


def test_export_everything_names_each_template(client, rid):
    _add(client, rid, "up", UP)
    other = client.post("/records", json={"name": "pOther", "sequence": TEMPLATE}).json()["id"]
    _add(client, other, "down", DOWN_PRIMER)
    text = client.get("/primers/export").text
    assert ",pOther," in text and ",pTest," in text and text.count("\n") == 3


@pytest.mark.parametrize("fmt", ["snapgene", "genbank", "fasta", "embl"])
def test_record_with_an_unbound_primer_still_exports(client, rid, fmt):
    _add(client, rid, "up", UP)
    _add(client, rid, "stray", "GGGGGGGGGGCCCCCCCCCC")
    r = client.get(f"/records/{rid}/export?fmt={fmt}")
    assert r.status_code == 200 and len(r.content) > 50
    if fmt == "snapgene":
        assert b'name="stray"' in r.content and b'name="up"' in r.content
