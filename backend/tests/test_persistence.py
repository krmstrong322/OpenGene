"""SQLite persistence: records and in-place edits survive a store restart."""

from opengene.core import sequence as S
from opengene.models import PlasmidRecord
from opengene.session import SessionStore


def test_records_survive_restart(tmp_path):
    db = str(tmp_path / "data")
    store = SessionStore(db_path=f"{db}/opengene.sqlite3")
    rec = PlasmidRecord(name="p1", sequence="ATGCATGC", is_circular=True)
    store.add(rec)
    rid = rec.id

    # Simulate an in-place edit followed by an explicit save (as endpoints do).
    S.insert(rec, 4, "GG")
    store.save(rec)

    # "Restart": a fresh store pointed at the same file.
    store2 = SessionStore(db_path=f"{db}/opengene.sqlite3")
    loaded = store2.get(rid)
    assert loaded.sequence == "ATGCGGATGC"
    assert loaded.name == "p1"
    assert loaded.is_circular is True


def test_delete_removes_from_disk(tmp_path):
    path = f"{tmp_path}/opengene.sqlite3"
    store = SessionStore(db_path=path)
    rec = PlasmidRecord(name="p", sequence="ACGT")
    store.add(rec)
    store.delete(rec.id)

    store2 = SessionStore(db_path=path)
    assert store2.list() == []


def test_in_memory_store_has_no_file(tmp_path, monkeypatch):
    # Without a db_path nothing is written.
    store = SessionStore()
    store.add(PlasmidRecord(name="x", sequence="ACGT"))
    assert len(store.list()) == 1
    # no file side effects to assert; just ensure clear works
    store.clear()
    assert store.list() == []
