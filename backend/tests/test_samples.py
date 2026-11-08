"""Bundled sample plasmids: every manifest entry loads, the library is seeded
once per data directory, and missing samples can be restored."""

import pytest
from fastapi.testclient import TestClient

from opengene import samples as S
from opengene.api import app
from opengene.session import SessionStore, store


@pytest.fixture(scope="module")
def built():
    return {spec.name: S.build_sample(spec) for spec in S.sample_specs()}


def test_manifest_names_are_unique_and_files_exist():
    specs = S.sample_specs()
    assert len(specs) >= 8
    assert len({s.name for s in specs}) == len(specs)
    for spec in specs:
        assert S._samples_dir().joinpath(spec.file).is_file(), spec.file


def test_every_sample_parses_and_is_annotated(built):
    for name, rec in built.items():
        assert rec.name == name
        assert rec.length > 500, name
        assert rec.features, f"{name} has no features"
        for f in rec.features:
            assert 0 <= f.start <= rec.length and 0 <= f.end <= rec.length, (name, f.name)


def test_noisy_ncbi_annotations_are_replaced(built):
    names = {f.name for f in built["pBR322"].features}
    assert {"AmpR (bla)", "TetR (tet)", "ColE1/pUC ori"} <= names
    assert "conflict" not in names and "old_sequence" not in names


def test_pACYC184_resistances_detected(built):
    # pACYC184's NCBI record marks CmR only as a ~3.5 kb misc_feature; the
    # library now detects the actual cat CDS from V00622, so both resistance
    # genes and the p15A origin come through auto-annotation.
    names = {f.name for f in built["pACYC184"].features}
    assert {"CmR (cat)", "TetR (tet)", "p15A ori"} <= names


def test_parts_missing_from_the_library_are_carried_over(built):
    feats = {f.name: f for f in built["pGEX-4T-1"].features}
    assert feats["GST"].type.value == "CDS" and feats["GST"].end - feats["GST"].start == 720
    assert feats["tac promoter"].type.value == "promoter"
    assert {"lacIq", "thrombin site", "AmpR (bla)"} <= set(feats)
    # The duplicated lacIq entries in the GenBank record collapse to one.
    assert sum(f.name == "lacIq" for f in feats.values()) == 1


def test_topology_overrides(built):
    assert built["EGFP CDS (linear)"].is_circular is False
    assert built["EGFP CDS (linear)"].sequence.startswith("ATG")
    assert built["pET-demo (T7/His/GFP)"].is_circular is True


def test_seed_once_adds_samples_only_the_first_time():
    st = SessionStore()
    added = S.seed_once(st)
    assert [r.name for r in added] == [s.name for s in S.sample_specs()]
    st.delete(added[0].id)
    assert S.seed_once(st) == []  # a deleted sample doesn't come back
    assert len(st.list()) == len(added) - 1


def test_library_lists_samples_in_manifest_order():
    st = SessionStore()
    S.seed_once(st)
    newest_first = sorted(st.list(), key=lambda r: r.updated_at, reverse=True)
    assert [r.name for r in newest_first] == [s.name for s in S.sample_specs()]


def test_seed_flag_survives_restart(tmp_path):
    db = str(tmp_path / "lib.sqlite3")
    first = SessionStore(db_path=db)
    S.seed_once(first)
    for r in first.list():
        first.delete(r.id)
    reopened = SessionStore(db_path=db)
    assert S.seed_once(reopened) == []
    assert reopened.list() == []


def test_restore_adds_only_missing_samples():
    st = SessionStore()
    added = S.seed_once(st)
    st.delete(added[1].id)
    restored = S.restore(st)
    assert [r.name for r in restored] == [added[1].name]
    assert S.restore(st) == []


def test_restore_endpoint_and_startup_seeding():
    store.clear()
    client = TestClient(app)  # no lifespan: nothing seeded yet
    assert client.get("/records").json() == []
    r = client.post("/samples/restore")
    assert r.status_code == 200
    assert len(r.json()["added"]) == len(S.sample_specs())
    assert client.post("/samples/restore").json()["added"] == []
    store.clear()


def test_startup_seeds_a_fresh_store(monkeypatch):
    fresh = SessionStore()
    monkeypatch.setattr("opengene.api.store", fresh)
    with TestClient(app):  # runs the lifespan
        pass
    assert len(fresh.list()) == len(S.sample_specs())
