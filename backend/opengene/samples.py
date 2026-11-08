"""Sample plasmids bundled with the engine.

``data/samples/`` holds public reference vectors (unmodified NCBI GenBank
records) and two small FASTA files, listed in ``samples.json``. A new library
gets them once: the first time the engine starts with a given data directory,
``seed_once`` adds every sample and records that it did, so samples a user
deletes don't come back on the next launch. ``restore`` adds back any that are
missing, on request.

NCBI's own annotations are uneven (pBR322 carries dozens of "conflict" and
"old_sequence" notes; pUC19 has none), so each sample is annotated the same
way a user would: auto-annotation from the feature library. Where the library
lacks a part (e.g. GST in pGEX-4T-1), the manifest's ``keep`` list carries that
feature over from the file under a short name.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from importlib import resources

from .core import annotate as annotate_mod
from .io import files as io_files
from .models import FeatureType, PlasmidRecord
from .session import SessionStore

SEEDED_KEY = "samples_seeded"


@dataclass(frozen=True)
class SampleSpec:
    file: str
    name: str
    description: str = ""
    circular: bool | None = None  # override the file's topology (FASTA has none)
    keep: list[dict] = field(default_factory=list)


def _samples_dir():
    return resources.files("opengene.data").joinpath("samples")


def sample_specs() -> list[SampleSpec]:
    with _samples_dir().joinpath("samples.json").open(encoding="utf-8") as fh:
        return [SampleSpec(**entry) for entry in json.load(fh)]


def build_sample(spec: SampleSpec) -> PlasmidRecord:
    """Parse a sample file and annotate it, without storing it."""
    data = _samples_dir().joinpath(spec.file).read_bytes()
    record = io_files.parse_bytes(data, spec.file)
    record.name = spec.name
    if spec.circular is not None:
        record.is_circular = spec.circular

    # Features the library can't detect, copied from the file (once per span).
    carried = []
    seen: set[tuple[int, int, int]] = set()
    for keep in spec.keep:
        for f in record.features:
            span = (f.start, f.end, f.strand)
            if f.name != keep["from"] or span in seen:
                continue
            seen.add(span)
            ftype = FeatureType(keep.get("type", f.type.value))
            carried.append(
                f.model_copy(
                    update={
                        "name": keep.get("name", f.name),
                        "type": ftype,
                        "color": annotate_mod.TYPE_COLORS.get(ftype.value),
                    }
                )
            )

    annotate_mod.annotate(record, replace_existing=True)
    record.features = sorted(record.features + carried, key=lambda f: (f.start, f.end))
    return record


def _add(store: SessionStore, specs: list[SampleSpec]) -> list[PlasmidRecord]:
    # Add in reverse so the library (newest first) lists them in manifest order.
    added = []
    for spec in reversed(specs):
        added.append(store.add(build_sample(spec)))
    return list(reversed(added))


def seed_once(store: SessionStore) -> list[PlasmidRecord]:
    """Add every sample the first time this store is seeded; no-op afterwards."""
    if store.get_meta(SEEDED_KEY):
        return []
    added = _add(store, sample_specs())
    store.set_meta(SEEDED_KEY, "1")
    return added


def restore(store: SessionStore) -> list[PlasmidRecord]:
    """Add back any sample whose name isn't in the library."""
    present = {r.name for r in store.list()}
    missing = [s for s in sample_specs() if s.name not in present]
    added = _add(store, missing)
    store.set_meta(SEEDED_KEY, "1")
    return added
