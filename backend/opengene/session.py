"""Session store for plasmid records.

In-memory by default (used by tests and transient servers). When the
``OPENGENE_DATA_DIR`` environment variable is set — as the desktop app does,
pointing at the OS per-user data directory — records are additionally
written through to a SQLite file so a user's work survives restarts.

The in-memory dict remains the working set (so object references stay stable
within a run); SQLite is a durable mirror, loaded on startup and upserted on
every ``add`` / ``save`` and removed on ``delete``.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from threading import RLock

from .models import PlasmidRecord


class SessionStore:
    def __init__(self, db_path: str | None = None) -> None:
        self._records: dict[str, PlasmidRecord] = {}
        self._lock = RLock()
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None
        if db_path:
            self._init_db()
            self._load_all()

    # -- persistence ------------------------------------------------------

    def _init_db(self) -> None:
        assert self._db_path
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
                id         TEXT PRIMARY KEY,
                name       TEXT,
                data       TEXT NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        self._conn.commit()

    def _load_all(self) -> None:
        assert self._conn
        for data, row_saved_at in self._conn.execute(
            "SELECT data, updated_at FROM records"
        ):
            try:
                raw = json.loads(data)
                # Rows saved before records carried timestamps: use the row's
                # last-save time, which stays the same across restarts, rather
                # than letting the load time become "created/edited just now".
                for field, alias in (("created_at", "createdAt"), ("updated_at", "updatedAt")):
                    if field not in raw and alias not in raw:
                        raw[field] = row_saved_at
                rec = PlasmidRecord.model_validate(raw)
                self._records[rec.id] = rec
            except Exception:
                # Skip corrupt rows rather than failing startup.
                continue

    def _persist(self, record: PlasmidRecord) -> None:
        if not self._conn:
            return
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO records (id, name, data, updated_at) "
                "VALUES (?, ?, ?, ?)",
                (record.id, record.name, record.model_dump_json(), time.time()),
            )
            self._conn.commit()

    # -- public API -------------------------------------------------------

    def add(self, record: PlasmidRecord) -> PlasmidRecord:
        record.updated_at = time.time()
        with self._lock:
            self._records[record.id] = record
        self._persist(record)
        return record

    def save(self, record: PlasmidRecord) -> PlasmidRecord:
        """Persist in-place mutations of an already-stored record."""
        record.updated_at = time.time()
        with self._lock:
            self._records[record.id] = record
        self._persist(record)
        return record

    def get(self, record_id: str) -> PlasmidRecord:
        with self._lock:
            if record_id not in self._records:
                raise KeyError(record_id)
            return self._records[record_id]

    def list(self) -> list[PlasmidRecord]:
        with self._lock:
            return list(self._records.values())

    def delete(self, record_id: str) -> None:
        with self._lock:
            self._records.pop(record_id, None)
            if self._conn:
                self._conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
                self._conn.commit()

    def clear(self) -> None:
        with self._lock:
            self._records.clear()
            if self._conn:
                self._conn.execute("DELETE FROM records")
                self._conn.commit()


def _default_store() -> SessionStore:
    data_dir = os.environ.get("OPENGENE_DATA_DIR")
    if data_dir:
        return SessionStore(db_path=str(Path(data_dir) / "opengene.sqlite3"))
    return SessionStore()


store = _default_store()
