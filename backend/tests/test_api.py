"""End-to-end API tests via FastAPI TestClient."""

import pytest
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.session import store


@pytest.fixture(autouse=True)
def _clear_store():
    store.clear()
    yield
    store.clear()


@pytest.fixture
def client():
    return TestClient(app, base_url="http://localhost")


def _create(client, seq="ATGGCAGCTACGTACGTAGC", circular=True):
    r = client.post("/records", json={"name": "t", "sequence": seq, "isCircular": circular})
    assert r.status_code == 200
    return r.json()


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_create_and_get(client):
    rec = _create(client)
    rid = rec["id"]
    assert rec["length"] == 20
    r = client.get(f"/records/{rid}")
    assert r.status_code == 200
    assert r.json()["sequence"].startswith("ATG")


def test_create_rejects_bad_sequence(client):
    r = client.post("/records", json={"name": "t", "sequence": "ATGX"})
    assert r.status_code == 422


def test_insert_endpoint(client):
    rec = _create(client, seq="AAAATTTT")
    rid = rec["id"]
    r = client.post(f"/records/{rid}/insert", json={"position": 4, "sequence": "GG"})
    assert r.status_code == 200
    assert r.json()["sequence"] == "AAAAGGTTTT"


def test_delete_wraps_origin(client):
    rec = _create(client, seq="AACCGGTT", circular=True)
    rid = rec["id"]
    r = client.post(f"/records/{rid}/delete", json={"start": 6, "end": 2})
    assert r.status_code == 200
    assert r.json()["sequence"] == "CCGG"


def test_mutate_endpoint(client):
    rec = _create(client, seq="ATGC")
    rid = rec["id"]
    r = client.post(f"/records/{rid}/mutate", json={"position": 0, "base": "G"})
    assert r.json()["sequence"] == "GTGC"


def test_reverse_complement_endpoint(client):
    rec = _create(client, seq="ATGC", circular=False)
    rid = rec["id"]
    r = client.post(f"/records/{rid}/reverse_complement")
    assert r.json()["sequence"] == "GCAT"


def test_orfs_endpoint(client):
    orf_seq = "ATG" + "GCT" * 32 + "TAA"
    rec = _create(client, seq="CC" + orf_seq + "CC", circular=False)
    rid = rec["id"]
    r = client.get(f"/records/{rid}/orfs?min_aa=30")
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_cut_sites_endpoint(client):
    rec = _create(client, seq="AAAA" + "GAATTC" + "AAAA", circular=False)
    rid = rec["id"]
    r = client.get(f"/records/{rid}/cut_sites?enzymes=EcoRI")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_primer_analyze_endpoint(client):
    r = client.post("/primers/analyze", json={"sequence": "ATGGCAGCTAGCTAGCATCG"})
    assert r.status_code == 200
    assert "tm" in r.json()


def test_annotate_endpoint(client):
    seq = "AAAA" + "TAATACGACTCACTATAG" + "GGGG"
    rec = _create(client, seq=seq, circular=False)
    rid = rec["id"]
    r = client.post(f"/records/{rid}/annotate", json={})
    assert r.status_code == 200
    assert any(f["name"] == "T7 promoter" for f in r.json()["added"])


def test_export_endpoint(client):
    rec = _create(client, seq="ATGGCAGCTACGT")
    rid = rec["id"]
    r = client.get(f"/records/{rid}/export?fmt=fasta")
    assert r.status_code == 200
    assert r.text.startswith(">")


def test_feature_crud(client):
    rec = _create(client)
    rid = rec["id"]
    feat = {"name": "myfeat", "type": "CDS", "start": 0, "end": 3, "strand": 1}
    r = client.post(f"/records/{rid}/features", json=feat)
    assert r.status_code == 200
    fid = r.json()["features"][0]["id"]
    r = client.delete(f"/records/{rid}/features/{fid}")
    assert r.json()["features"] == []


def test_404_on_missing_record(client):
    r = client.get("/records/doesnotexist")
    assert r.status_code == 404


# --- undo / redo ---------------------------------------------------------

def test_undo_redo_roundtrip(client):
    rec = _create(client, seq="AAAATTTT")
    rid = rec["id"]
    assert rec["canUndo"] is False and rec["canRedo"] is False

    r = client.post(f"/records/{rid}/insert", json={"position": 4, "sequence": "GG"}).json()
    assert r["sequence"] == "AAAAGGTTTT"
    assert r["canUndo"] is True and r["canRedo"] is False

    r = client.post(f"/records/{rid}/undo").json()
    assert r["sequence"] == "AAAATTTT"
    assert r["canUndo"] is False and r["canRedo"] is True

    r = client.post(f"/records/{rid}/redo").json()
    assert r["sequence"] == "AAAAGGTTTT"
    assert r["canUndo"] is True and r["canRedo"] is False


def test_undo_with_nothing_to_undo_is_409(client):
    rec = _create(client, seq="ATGC")
    r = client.post(f"/records/{rec['id']}/undo")
    assert r.status_code == 409


def test_a_new_edit_clears_the_redo_stack(client):
    rec = _create(client, seq="AAAATTTT")
    rid = rec["id"]
    client.post(f"/records/{rid}/insert", json={"position": 0, "sequence": "C"})
    client.post(f"/records/{rid}/undo")  # redo now available
    r = client.post(f"/records/{rid}/mutate", json={"position": 0, "base": "G"}).json()
    assert r["canRedo"] is False
    assert client.post(f"/records/{rid}/redo").status_code == 409


def test_failed_edit_leaves_no_undo_point(client):
    # A rejected edit (invalid base) must not push a dead undo entry.
    rec = _create(client, seq="ATGC")
    rid = rec["id"]
    bad = client.post(f"/records/{rid}/insert", json={"position": 0, "sequence": "X"})
    assert bad.status_code == 422
    assert client.get(f"/records/{rid}").json()["canUndo"] is False


def test_undo_restores_features_and_history(client):
    rec = _create(client, seq="AAAA" + "TAATACGACTCACTATAG" + "GGGG", circular=False)
    rid = rec["id"]
    annotated = client.post(f"/records/{rid}/annotate", json={}).json()["record"]
    assert len(annotated["features"]) >= 1
    undone = client.post(f"/records/{rid}/undo").json()
    assert undone["features"] == []


# --- feature update ------------------------------------------------------

def test_update_feature_fields(client):
    rec = _create(client, seq="ATGGCAGCTACGTACGTAGC")
    rid = rec["id"]
    feat = {"name": "old", "type": "CDS", "start": 0, "end": 3, "strand": 1}
    fid = client.post(f"/records/{rid}/features", json=feat).json()["features"][0]["id"]
    r = client.patch(
        f"/records/{rid}/features/{fid}",
        json={"name": "new", "strand": -1, "end": 6, "color": "#abcdef"},
    )
    assert r.status_code == 200
    f = r.json()["features"][0]
    assert f["name"] == "new" and f["strand"] == -1 and f["end"] == 6
    assert f["color"] == "#abcdef" and f["start"] == 0  # unchanged
    assert f["id"] == fid  # identity preserved


def test_update_feature_out_of_bounds_is_422(client):
    rec = _create(client, seq="ATGC")
    rid = rec["id"]
    fid = client.post(
        f"/records/{rid}/features",
        json={"name": "f", "type": "misc_feature", "start": 0, "end": 3, "strand": 1},
    ).json()["features"][0]["id"]
    r = client.patch(f"/records/{rid}/features/{fid}", json={"end": 99})
    assert r.status_code == 422


def test_update_missing_feature_is_404(client):
    rec = _create(client, seq="ATGC")
    r = client.patch(f"/records/{rec['id']}/features/nope", json={"name": "x"})
    assert r.status_code == 404


@pytest.mark.parametrize("field", ["name", "type", "start", "end", "strand"])
def test_update_feature_rejects_explicit_null(client, field):
    # An explicit null for a non-nullable field is a 422, not a 500, and must
    # not be stored (a null strand/type can't be restored from a snapshot).
    rec = _create(client, seq="ATGGCAGCTACGT")
    rid = rec["id"]
    fid = client.post(
        f"/records/{rid}/features",
        json={"name": "f", "type": "CDS", "start": 0, "end": 3, "strand": 1},
    ).json()["features"][0]["id"]
    r = client.patch(f"/records/{rid}/features/{fid}", json={field: None})
    assert r.status_code == 422
    # The feature is unchanged and still valid.
    f = client.get(f"/records/{rid}").json()["features"][0]
    assert f["name"] == "f" and f["type"] == "CDS" and f["strand"] == 1


def test_update_feature_allows_null_color(client):
    rec = _create(client, seq="ATGGCAGCTACGT")
    rid = rec["id"]
    fid = client.post(
        f"/records/{rid}/features",
        json={"name": "f", "type": "CDS", "start": 0, "end": 3, "strand": 1, "color": "#abcdef"},
    ).json()["features"][0]["id"]
    r = client.patch(f"/records/{rid}/features/{fid}", json={"color": None})
    assert r.status_code == 200
    assert r.json()["features"][0]["color"] is None


def test_update_feature_is_undoable(client):
    rec = _create(client, seq="ATGGCAGCTACGT")
    rid = rec["id"]
    fid = client.post(
        f"/records/{rid}/features",
        json={"name": "orig", "type": "CDS", "start": 0, "end": 3, "strand": 1},
    ).json()["features"][0]["id"]
    client.patch(f"/records/{rid}/features/{fid}", json={"name": "renamed"})
    undone = client.post(f"/records/{rid}/undo").json()
    assert undone["features"][0]["name"] == "orig"


def test_export_unicode_name(client):
    # PR #1 review: a non-Latin-1 name used to crash the export with HTTP 500.
    rec = client.post("/records", json={"name": "ΔGFP/v2", "sequence": "ATGC"}).json()
    r = client.get(f"/records/{rec['id']}/export?fmt=fasta")
    assert r.status_code == 200
    cd = r.headers["content-disposition"]
    assert 'filename="GFPv2.fasta"' in cd
    assert "filename*=UTF-8''%CE%94GFP%2Fv2.fasta" in cd


def test_export_ascii_name_unchanged(client):
    rec = client.post("/records", json={"name": "pUC19", "sequence": "ATGC"}).json()
    cd = client.get(f"/records/{rec['id']}/export?fmt=genbank").headers["content-disposition"]
    assert 'filename="pUC19.gb"' in cd


def test_list_records_is_a_light_summary_newest_first(client):
    a = _create(client, seq="ATGCATGC")
    b = _create(client, seq="GGGGCCCC")
    client.post(f"/records/{a['id']}/insert", json={"position": 0, "sequence": "AAA"})
    rows = client.get("/records").json()
    assert [r["id"] for r in rows] == [a["id"], b["id"]]  # a was edited last
    assert set(rows[0]) == {
        "id", "name", "length", "isCircular", "featureCount", "hasTrace", "createdAt", "updatedAt"
    }
    assert rows[0]["length"] == 11


def test_any_change_counts_as_an_edit_for_the_library(client):
    # Review: feature/annotation/primer changes must update "last edited" too.
    a = _create(client, seq="ATGCATGCATGC")
    b = _create(client, seq="GGGGCCCC")
    assert client.get("/records").json()[0]["id"] == b["id"]
    feat = {"name": "note", "type": "misc_feature", "start": 0, "end": 3, "strand": 1}
    client.post(f"/records/{a['id']}/features", json=feat)
    rows = client.get("/records").json()
    assert rows[0]["id"] == a["id"]
    assert rows[0]["updatedAt"] >= rows[1]["updatedAt"]


def test_selection_info(client):
    seq = "ATGGCTAAAGGTTAA" + "GCGCGCATATAT" * 5
    rec = _create(client, seq=seq)
    r = client.get(f"/records/{rec['id']}/selection", params={"start": 0, "end": 15})
    assert r.status_code == 200
    info = r.json()
    assert info["length"] == 15
    assert info["translation"] == "MAKG*"
    assert info["tm"] is not None and info["mw_double"] > info["mw_single"] > 0
    assert info["protein_mw"] > 0
    assert info["gc_content"] == round(100 * 5 / 15, 2)


def test_selection_info_wraps_and_handles_ambiguity(client):
    rec = _create(client, seq="ACGTACGTAC" + "RYN" + "GGGCCC")
    n = rec["length"]
    wrap = client.get(f"/records/{rec['id']}/selection", params={"start": n - 3, "end": 3}).json()
    assert wrap["length"] == 6
    amb = client.get(f"/records/{rec['id']}/selection", params={"start": 5, "end": 16}).json()
    assert amb["tm"] is None and amb["mw_single"] is None
    assert client.get(f"/records/{rec['id']}/selection", params={"start": 0, "end": n + 5}).status_code == 422
    caret = client.get(f"/records/{rec['id']}/selection", params={"start": 4, "end": 4}).json()
    assert caret["length"] == 0 and caret["translation"] == ""


def test_selection_info_of_the_whole_sequence(client):
    seq = "ATGGCTAAAGGTTAA" + "GCGCGCATATAT" * 5
    rec = _create(client, seq=seq)
    info = client.get(f"/records/{rec['id']}/selection", params={"start": 0, "end": len(seq)}).json()
    assert info["length"] == len(seq)


def test_selection_info_translates_a_selected_feature_on_its_own_strand(client):
    from opengene.core.sequence import reverse_complement

    cds = "ATGGCTAAAGGTTAA"  # MAKG*
    seq = "CCCC" + reverse_complement(cds) + "GGGG"
    rec = _create(client, seq=seq)
    rid = rec["id"]
    r = client.post(f"/records/{rid}/features",
                    json={"name": "rev", "type": "CDS", "start": 4, "end": 19, "strand": -1})
    fid = r.json()["features"][0]["id"]
    info = client.get(f"/records/{rid}/selection",
                      params={"start": 4, "end": 19, "feature_id": fid}).json()
    assert info["translation"] == "MAKG*"
    assert info["translation_of"] == "rev" and info["translation_strand"] == -1
    plain = client.get(f"/records/{rid}/selection", params={"start": 4, "end": 19}).json()
    assert plain["translation_of"] == "selection" and plain["translation"] != "MAKG*"


def test_enzymes_endpoint_and_cut_site_detail(client):
    rec = _create(client, seq="AA" + "GAATTC" + "AAAA" + "GGATCC" + "AA")
    cat = client.get(f"/records/{rec['id']}/enzymes")
    assert cat.status_code == 200
    by = {e["name"]: e for e in cat.json()}
    assert by["EcoRI"]["cuts"] == 1 and by["EcoRI"]["overhang_type"] == "5'"
    assert "New England Biolabs" in by["EcoRI"]["suppliers"]
    sites = client.get(f"/records/{rec['id']}/cut_sites", params={"enzymes": "BamHI"}).json()
    assert sites and sites[0]["overhang"] == "GATC" and "methylation" in sites[0]
