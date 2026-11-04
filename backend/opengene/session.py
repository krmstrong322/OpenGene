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


# How many undo steps to retain per record. Snapshots are full record JSON;
# plasmids are small (a few kb), so a generous depth is cheap.
UNDO_DEPTH = 50


class SessionStore:
    def __init__(self, db_path: str | None = None) -> None:
        self._records: dict[str, PlasmidRecord] = {}
        self._lock = RLock()
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None
        # Per-record undo/redo stacks of serialized snapshots. In-memory only
        # (not mirrored to SQLite): undo history does not survive a restart,
        # which is an accepted limitation.
        self._undo: dict[str, list[str]] = {}
        self._redo: dict[str, list[str]] = {}
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
            self._undo.pop(record_id, None)
            self._redo.pop(record_id, None)
            if self._conn:
                self._conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
                self._conn.commit()

    def clear(self) -> None:
        with self._lock:
            self._records.clear()
            self._undo.clear()
            self._redo.clear()
            if self._conn:
                self._conn.execute("DELETE FROM records")
                self._conn.commit()

    # -- undo / redo ------------------------------------------------------
    #
    # A caller serializes the record's pre-edit state, applies the edit, and —
    # only if it succeeds — calls ``commit`` with that pre-state. ``commit``
    # pushes it onto the undo stack, clears the redo stack (a new edit
    # invalidates any redo future), and saves. A failed edit therefore leaves
    # no dead undo entry. ``undo`` then moves the current state onto the redo
    # stack and restores the top of the undo stack; ``redo`` is the mirror.

    def commit(self, record: PlasmidRecord, pre_state: str) -> PlasmidRecord:
        """Record ``pre_state`` as an undo point and persist the edited record."""
        with self._lock:
            stack = self._undo.setdefault(record.id, [])
            stack.append(pre_state)
            if len(stack) > UNDO_DEPTH:
                del stack[0]
            self._redo.pop(record.id, None)
        return self.save(record)

    def can_undo(self, record_id: str) -> bool:
        return bool(self._undo.get(record_id))

    def can_redo(self, record_id: str) -> bool:
        return bool(self._redo.get(record_id))

    def undo(self, record_id: str) -> PlasmidRecord:
        return self._step(record_id, self._undo, self._redo)

    def redo(self, record_id: str) -> PlasmidRecord:
        return self._step(record_id, self._redo, self._undo)

    def _step(
        self,
        record_id: str,
        from_stack: dict[str, list[str]],
        to_stack: dict[str, list[str]],
    ) -> PlasmidRecord:
        with self._lock:
            if record_id not in self._records:
                raise KeyError(record_id)
            stack = from_stack.get(record_id)
            if not stack:
                raise IndexError("nothing to undo/redo")
            to_stack.setdefault(record_id, []).append(
                self._records[record_id].model_dump_json()
            )
            restored = PlasmidRecord.model_validate_json(stack.pop())
            self._records[record_id] = restored
        # Persist the restored state (updates the stored row + updated_at).
        restored.updated_at = time.time()
        self._persist(restored)
        return restored


def _default_store() -> SessionStore:
    data_dir = os.environ.get("OPENGENE_DATA_DIR")
    if data_dir:
        return SessionStore(db_path=str(Path(data_dir) / "opengene.sqlite3"))
    return SessionStore()


store = _default_store()
