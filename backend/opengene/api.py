"""FastAPI application exposing the deterministic plasmid engine.

All sequence mutations flow through :mod:`opengene.core.sequence`, upholding
the specification's *Sequence Invariant*: validated DNA only, no free-form
string edits from outside the engine.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager, contextmanager
from dataclasses import asdict
from typing import AsyncIterator, Iterator, Literal
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import __version__
from . import samples as samples_mod
from .core import analysis as analysis_mod
from .core import annotate as annotate_mod
from .core import primers as primers_mod
from .core import restriction as restriction_mod
from .core import search as search_mod
from .core import sequence as seq_mod
from .io import files as io_files
from .models import Feature, PlasmidRecord
from .session import store

log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    # A new library starts with the bundled sample plasmids (once per data
    # directory; see opengene.samples). Never let this block startup.
    try:
        samples_mod.seed_once(store)
    except Exception:
        log.exception("could not add sample plasmids")
    yield


app = FastAPI(title="OpenGene API", version=__version__, lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------

class CreateRequest(BaseModel):
    name: str = "untitled"
    sequence: str
    is_circular: bool = Field(default=True, alias="isCircular")
    model_config = {"populate_by_name": True}


class InsertRequest(BaseModel):
    position: int
    sequence: str
    frame_policy: seq_mod.FramePolicy = "reject"


class DeleteRequest(BaseModel):
    start: int
    end: int
    frame_policy: seq_mod.FramePolicy = "reject"


class MutateRequest(BaseModel):
    position: int
    base: str


class ReplaceRequest(BaseModel):
    start: int
    end: int
    sequence: str
    frame_policy: seq_mod.FramePolicy = "reject"


class DigestRequest(BaseModel):
    enzymes: list[str]


class PrimerAnalyzeRequest(BaseModel):
    sequence: str
    target_tm: float = 60.0


class PrimerDesignRequest(BaseModel):
    region_start: int
    region_end: int
    target_tm: float = 60.0


class AnnotateRequest(BaseModel):
    replace_existing: bool = False
    min_identity: float = 0.80
    min_coverage: float = 0.80


class FeatureUpdate(BaseModel):
    """Partial update for an existing feature. Only provided fields change."""
    name: str | None = None
    type: str | None = None
    start: int | None = None
    end: int | None = None
    strand: Literal[1, -1] | None = None
    color: str | None = None


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _get(record_id: str) -> PlasmidRecord:
    try:
        return store.get(record_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"record {record_id} not found")


def _record_response(record: PlasmidRecord) -> dict:
    data = record.model_dump_api()
    # Surface undo/redo availability so the UI can enable its buttons without
    # a separate round-trip.
    data["canUndo"] = store.can_undo(record.id)
    data["canRedo"] = store.can_redo(record.id)
    return data


@contextmanager
def _edit_txn(record_id: str) -> Iterator[tuple[PlasmidRecord, str]]:
    """Serialize a whole edit of one record under its transaction lock.

    Yields ``(record, pre_state)``: the shared record and a serialized snapshot
    of its state before the edit. The caller mutates ``record`` and, on
    success, calls ``store.commit(record, pre_state)`` — all inside the lock, so
    concurrent edits of the same record cannot interleave. A rejected edit
    raises out of the block, releasing the lock and leaving no undo point.
    """
    _get(record_id)  # 404 before taking the lock if unknown
    with store.record_lock(record_id):
        record = _get(record_id)  # re-read inside the lock
        yield record, record.model_dump_json()


# --------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__, "blast": annotate_mod.blast_available()}


@app.post("/records")
def create_record(req: CreateRequest) -> dict:
    try:
        record = PlasmidRecord(
            name=req.name, sequence=req.sequence, is_circular=req.is_circular
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    store.add(record)
    return _record_response(record)


@app.get("/records")
def list_records() -> list[dict]:
    """Saved records, most recently edited first, without their sequences."""
    records = sorted(store.list(), key=lambda r: r.updated_at, reverse=True)
    return [r.summary_api() for r in records]


@app.post("/samples/restore")
def restore_samples() -> dict:
    """Add back any bundled sample plasmid that isn't in the library."""
    added = samples_mod.restore(store)
    return {"added": [r.summary_api() for r in added]}


@app.get("/records/{record_id}")
def get_record(record_id: str) -> dict:
    return _record_response(_get(record_id))


@app.delete("/records/{record_id}")
def delete_record(record_id: str) -> dict:
    store.delete(record_id)
    return {"deleted": record_id}


# --------------------------------------------------------------------------
# File I/O
# --------------------------------------------------------------------------

@app.post("/records/import")
async def import_file(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    try:
        record = io_files.parse_bytes(data, file.filename or "upload.gb")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"parse failed: {e}")
    store.add(record)
    return _record_response(record)


@app.get("/records/{record_id}/export")
def export_record(record_id: str, fmt: str = "genbank") -> Response:
    record = _get(record_id)
    try:
        body, ext, media = io_files.export_bytes(record, fmt)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return Response(
        body,
        media_type=media,
        headers={"Content-Disposition": _attachment(record.name, ext)},
    )


def _attachment(name: str, ext: str) -> str:
    """Content-Disposition for a download. HTTP headers are Latin-1, so a name
    like "ΔGFP" gets an ASCII fallback plus the RFC 5987 UTF-8 form, which
    browsers and Electron prefer when present."""
    ascii_name = "".join(c for c in name if c.isascii() and (c.isalnum() or c in "-_."))
    fallback = f"{ascii_name or 'plasmid'}.{ext}"
    encoded = quote(f"{name}.{ext}", safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


# --------------------------------------------------------------------------
# Deterministic editing
# --------------------------------------------------------------------------

@app.post("/records/{record_id}/insert")
def insert(record_id: str, req: InsertRequest) -> dict:
    with _edit_txn(record_id) as (record, pre):
        try:
            seq_mod.insert(record, req.position, req.sequence, req.frame_policy)
        except seq_mod.FrameShiftError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except seq_mod.SequenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        store.commit(record, pre)
        return _record_response(record)


@app.post("/records/{record_id}/delete")
def delete(record_id: str, req: DeleteRequest) -> dict:
    with _edit_txn(record_id) as (record, pre):
        try:
            seq_mod.delete(record, req.start, req.end, req.frame_policy)
        except seq_mod.FrameShiftError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except seq_mod.SequenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        store.commit(record, pre)
        return _record_response(record)


@app.post("/records/{record_id}/mutate")
def mutate(record_id: str, req: MutateRequest) -> dict:
    with _edit_txn(record_id) as (record, pre):
        try:
            seq_mod.mutate(record, req.position, req.base)
        except seq_mod.SequenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        store.commit(record, pre)
        return _record_response(record)


@app.post("/records/{record_id}/replace")
def replace(record_id: str, req: ReplaceRequest) -> dict:
    with _edit_txn(record_id) as (record, pre):
        try:
            seq_mod.replace_range(
                record, req.start, req.end, req.sequence, req.frame_policy
            )
        except seq_mod.FrameShiftError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except seq_mod.SequenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        store.commit(record, pre)
        return _record_response(record)


@app.post("/records/{record_id}/reverse_complement")
def reverse_complement(record_id: str) -> dict:
    with _edit_txn(record_id) as (record, pre):
        seq_mod.reverse_complement_record(record)
        store.commit(record, pre)
        return _record_response(record)


@app.post("/records/{record_id}/undo")
def undo(record_id: str) -> dict:
    _get(record_id)  # 404 if unknown
    with store.record_lock(record_id):
        try:
            record = store.undo(record_id)
        except IndexError:
            raise HTTPException(status_code=409, detail="nothing to undo")
    return _record_response(record)


@app.post("/records/{record_id}/redo")
def redo(record_id: str) -> dict:
    _get(record_id)  # 404 if unknown
    with store.record_lock(record_id):
        try:
            record = store.redo(record_id)
        except IndexError:
            raise HTTPException(status_code=409, detail="nothing to redo")
    return _record_response(record)


# --------------------------------------------------------------------------
# Analysis
# --------------------------------------------------------------------------

@app.get("/records/{record_id}/selection")
def selection_info(record_id: str, start: int, end: int, feature_id: str | None = None) -> dict:
    """Length, GC, Tm, molecular weight and translation of ``[start, end)``
    (``start > end`` wraps the origin). With ``feature_id``, the translation is
    that feature's: its strand, its parts only."""
    record = _get(record_id)
    try:
        return asdict(analysis_mod.selection_info(record, start, end, feature_id))
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/records/{record_id}/search")
def search(
    record_id: str, query: str, kind: Literal["dna", "protein"] = "dna", mismatches: int = 0
) -> dict:
    """Find a DNA (both strands, IUPAC, optional mismatches) or protein (six
    frames and spliced CDSs) sequence."""
    record = _get(record_id)
    try:
        if kind == "dna":
            result = search_mod.search_dna(record, query, mismatches)
        else:
            result = search_mod.search_protein(record, query)
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return asdict(result)


@app.get("/records/{record_id}/orfs")
def orfs(record_id: str, min_aa: int = 30) -> list[dict]:
    record = _get(record_id)
    return [asdict(o) for o in seq_mod.find_orfs(record, min_aa=min_aa)]


@app.get("/records/{record_id}/cut_sites")
def cut_sites(record_id: str, enzymes: str | None = None) -> list[dict]:
    record = _get(record_id)
    enzyme_list = enzymes.split(",") if enzymes else None
    return [asdict(s) for s in restriction_mod.find_cut_sites(record, enzyme_list)]


@app.post("/records/{record_id}/digest")
def digest(record_id: str, req: DigestRequest) -> list[dict]:
    record = _get(record_id)
    return [asdict(d) for d in restriction_mod.digest(record, req.enzymes)]


@app.get("/records/{record_id}/unique_cutters")
def unique_cutters(record_id: str) -> list[str]:
    record = _get(record_id)
    return restriction_mod.unique_cutters(record)


# --------------------------------------------------------------------------
# Primers
# --------------------------------------------------------------------------

@app.post("/primers/analyze")
def analyze_primer(req: PrimerAnalyzeRequest) -> dict:
    try:
        return asdict(primers_mod.analyze_primer(req.sequence, req.target_tm))
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/records/{record_id}/design_primers")
def design_primers(record_id: str, req: PrimerDesignRequest) -> dict:
    with _edit_txn(record_id) as (record, pre):
        try:
            fwd, rev = primers_mod.design_primer_pair(
                record, req.region_start, req.region_end, req.target_tm
            )
        except seq_mod.SequenceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        record.primers.extend([fwd, rev])
        store.commit(record, pre)
        return {
            "forward": fwd.model_dump(by_alias=True),
            "reverse": rev.model_dump(by_alias=True),
        }


# --------------------------------------------------------------------------
# Annotation
# --------------------------------------------------------------------------

@app.post("/records/{record_id}/annotate")
def annotate(record_id: str, req: AnnotateRequest) -> dict:
    with _edit_txn(record_id) as (record, pre):
        new = annotate_mod.annotate(
            record,
            replace_existing=req.replace_existing,
            min_identity=req.min_identity,
            min_coverage=req.min_coverage,
        )
        store.commit(record, pre)
        return {
            "added": [f.model_dump() for f in new],
            "record": _record_response(record),
        }


def _validate_feature_span(record: PlasmidRecord, start: int, end: int) -> None:
    n = record.length
    if not (0 <= start <= n and 0 <= end <= n):
        raise HTTPException(
            status_code=422,
            detail=f"feature range [{start},{end}) out of bounds for length {n}",
        )
    if start > end and not record.is_circular:
        raise HTTPException(
            status_code=422,
            detail="a feature may only wrap the origin on a circular record",
        )


# Feature fields that may not be set to null (only ``color`` is nullable).
_NON_NULLABLE_FEATURE_FIELDS = ("name", "type", "start", "end", "strand")


@app.post("/records/{record_id}/features")
def add_feature(record_id: str, feature: Feature) -> dict:
    with _edit_txn(record_id) as (record, pre):
        _validate_feature_span(record, feature.start, feature.end)
        record.features.append(feature)
        store.commit(record, pre)
        return _record_response(record)


@app.patch("/records/{record_id}/features/{feature_id}")
def update_feature(record_id: str, feature_id: str, req: FeatureUpdate) -> dict:
    changes = req.model_dump(exclude_unset=True)
    # ``exclude_unset`` keeps an explicit ``null`` the client sent. Reject nulls
    # for non-nullable fields here, before validation or ``model_copy`` (which
    # does not re-validate) can turn them into a 500 or an unrestorable feature.
    nulled = [k for k in _NON_NULLABLE_FEATURE_FIELDS if changes.get(k) is None and k in changes]
    if nulled:
        raise HTTPException(
            status_code=422, detail=f"fields may not be null: {', '.join(nulled)}"
        )
    with _edit_txn(record_id) as (record, pre):
        feat = next((f for f in record.features if f.id == feature_id), None)
        if feat is None:
            raise HTTPException(status_code=404, detail=f"feature {feature_id} not found")
        new_start = changes.get("start", feat.start)
        new_end = changes.get("end", feat.end)
        if feat.segments and (new_start, new_end) != (feat.start, feat.end):
            raise HTTPException(
                status_code=422,
                detail=f"{feat.name} has {len(feat.segments)} parts; its coordinates "
                "can't be changed as a single span",
            )
        _validate_feature_span(record, new_start, new_end)
        record.features = [feat.model_copy(update=changes) if f.id == feature_id else f
                           for f in record.features]
        store.commit(record, pre)
        return _record_response(record)


@app.delete("/records/{record_id}/features/{feature_id}")
def delete_feature(record_id: str, feature_id: str) -> dict:
    with _edit_txn(record_id) as (record, pre):
        record.features = [f for f in record.features if f.id != feature_id]
        store.commit(record, pre)
        return _record_response(record)


@app.get("/feature_library")
def feature_library() -> list[dict]:
    return [
        {"name": e.name, "type": e.type, "length": len(e.sequence), "source": e.source}
        for e in annotate_mod.load_library()
    ]
