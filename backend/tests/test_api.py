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
    return TestClient(app)


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
        "id", "name", "length", "isCircular", "featureCount", "createdAt", "updatedAt"
    }
    assert rows[0]["length"] == 11
