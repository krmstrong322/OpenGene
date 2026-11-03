"""In-memory session store for plasmid records.

A process-local registry keyed by record id. Suitable for the MVP / single
instance; swap for Redis or a DB to scale horizontally.
"""

from __future__ import annotations

from threading import RLock

from .models import PlasmidRecord


class SessionStore:
    def __init__(self) -> None:
        self._records: dict[str, PlasmidRecord] = {}
        self._lock = RLock()

    def add(self, record: PlasmidRecord) -> PlasmidRecord:
        with self._lock:
            self._records[record.id] = record
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

    def clear(self) -> None:
        with self._lock:
            self._records.clear()


store = SessionStore()
