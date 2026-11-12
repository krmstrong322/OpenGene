"""Renaming, changing topology and duplicating records."""

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


SEQ = "ATGGCAGCTACGTACGTAGC"  # 20 bp


def _create(client, circular=True):
    r = client.post("/records", json={"name": "t", "sequence": SEQ, "isCircular": circular})
    assert r.status_code == 200
    return r.json()


def _add_feature(client, rid, start, end, name="f"):
    r = client.post(
        f"/records/{rid}/features",
        json={"name": name, "type": "misc_feature", "start": start, "end": end, "strand": 1},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_rename_is_undoable(client):
    rid = _create(client)["id"]
    r = client.patch(f"/records/{rid}", json={"name": "  pMy   vector "})
    assert r.status_code == 200
    assert r.json()["name"] == "pMy vector"
    assert r.json()["canUndo"]
    assert client.post(f"/records/{rid}/undo").json()["name"] == "t"


def test_rename_rejects_empty(client):
    rid = _create(client)["id"]
    assert client.patch(f"/records/{rid}", json={"name": "   "}).status_code == 409
    assert client.get(f"/records/{rid}").json()["name"] == "t"


def test_unchanged_update_leaves_no_undo_point(client):
    rid = _create(client)["id"]
    r = client.patch(f"/records/{rid}", json={"name": "t", "isCircular": True})
    assert r.status_code == 200
    assert not r.json()["canUndo"]


def test_linear_to_circular_and_back(client):
    rid = _create(client, circular=False)["id"]
    _add_feature(client, rid, 2, 8)
    r = client.patch(f"/records/{rid}", json={"isCircular": True})
    assert r.json()["isCircular"] is True
    r = client.patch(f"/records/{rid}", json={"isCircular": False})
    assert r.json()["isCircular"] is False
    assert [(f["start"], f["end"]) for f in r.json()["features"]] == [(2, 8)]
    assert r.json()["sequence"] == SEQ


def test_linearizing_refuses_feature_across_origin(client):
    rid = _create(client)["id"]
    _add_feature(client, rid, 15, 5, name="wrapper")
    r = client.patch(f"/records/{rid}", json={"name": "renamed", "isCircular": False})
    assert r.status_code == 409
    assert "wrapper" in r.json()["detail"]
    after = client.get(f"/records/{rid}").json()
    # Nothing from the refused update sticks, the rename included.
    assert after["isCircular"] is True
    assert after["name"] == "t"
    assert [h["op"] for h in after["history"]] == ["feature"]


def test_linearizing_keeps_feature_ending_at_origin(client):
    rid = _create(client)["id"]
    rec = _add_feature(client, rid, 15, 0, name="tail")
    assert rec["features"][0]["end"] == 0
    r = client.patch(f"/records/{rid}", json={"isCircular": False})
    assert r.status_code == 200, r.text
    f = r.json()["features"][0]
    assert (f["start"], f["end"]) == (15, 20)


def test_duplicate_is_independent(client):
    rid = _create(client)["id"]
    _add_feature(client, rid, 2, 8)
    copy = client.post(f"/records/{rid}/duplicate").json()
    assert copy["id"] != rid
    assert copy["name"] == "t copy"
    assert copy["sequence"] == SEQ and len(copy["features"]) == 1
    assert copy["history"] == [] and not copy["canUndo"]
    # A second copy gets a distinct name; editing a copy leaves the source alone.
    assert client.post(f"/records/{rid}/duplicate").json()["name"] == "t copy 2"
    assert client.post(f"/records/{copy['id']}/duplicate").json()["name"] == "t copy 3"
    client.post(f"/records/{copy['id']}/insert", json={"position": 0, "sequence": "AAA"})
    assert client.get(f"/records/{rid}").json()["sequence"] == SEQ
    assert len(client.get("/records").json()) == 4


def test_update_unknown_record(client):
    assert client.patch("/records/nope", json={"name": "x"}).status_code == 404


def test_history_lists_every_undoable_step(client):
    rid = _create(client)["id"]
    rec = _add_feature(client, rid, 2, 8, name="site")
    fid = rec["features"][0]["id"]
    client.patch(f"/records/{rid}/features/{fid}", json={"name": "site 2"})
    client.post(f"/records/{rid}/insert", json={"position": 0, "sequence": "AAA"})
    client.delete(f"/records/{rid}/features/{fid}")
    history = client.get(f"/records/{rid}").json()["history"]
    assert [h["op"] for h in history] == ["feature", "feature", "insert", "feature"]
    assert "site 2" in history[1]["description"]
    # Undo takes the last step back off the list.
    after = client.post(f"/records/{rid}/undo").json()
    assert len(after["history"]) == 3 and len(after["features"]) == 1
