"""FastAPI application exposing the deterministic plasmid engine.

All sequence mutations flow through :mod:`opengene.core.sequence`, upholding
the specification's *Sequence Invariant*: validated DNA only, no free-form
string edits from outside the engine.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from . import __version__
from .core import annotate as annotate_mod
from .core import primers as primers_mod
from .core import restriction as restriction_mod
from .core import sequence as seq_mod
from .io import files as io_files
from .models import Feature, PlasmidRecord
from .session import store

app = FastAPI(title="OpenGene API", version=__version__)

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


class DeleteRequest(BaseModel):
    start: int
    end: int


class MutateRequest(BaseModel):
    position: int
    base: str


class ReplaceRequest(BaseModel):
    start: int
    end: int
    sequence: str


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
    min_identity: float = 0.95


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _get(record_id: str) -> PlasmidRecord:
    try:
        return store.get(record_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"record {record_id} not found")


def _record_response(record: PlasmidRecord) -> dict:
    return record.model_dump_api()


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
    return [r.model_dump_api() for r in store.list()]


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


@app.get("/records/{record_id}/export", response_class=PlainTextResponse)
def export_record(record_id: str, fmt: str = "genbank") -> str:
    record = _get(record_id)
    try:
        return io_files.export_string(record, fmt)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# --------------------------------------------------------------------------
# Deterministic editing
# --------------------------------------------------------------------------

@app.post("/records/{record_id}/insert")
def insert(record_id: str, req: InsertRequest) -> dict:
    record = _get(record_id)
    try:
        seq_mod.insert(record, req.position, req.sequence)
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _record_response(record)


@app.post("/records/{record_id}/delete")
def delete(record_id: str, req: DeleteRequest) -> dict:
    record = _get(record_id)
    try:
        seq_mod.delete(record, req.start, req.end)
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _record_response(record)


@app.post("/records/{record_id}/mutate")
def mutate(record_id: str, req: MutateRequest) -> dict:
    record = _get(record_id)
    try:
        seq_mod.mutate(record, req.position, req.base)
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _record_response(record)


@app.post("/records/{record_id}/replace")
def replace(record_id: str, req: ReplaceRequest) -> dict:
    record = _get(record_id)
    try:
        seq_mod.replace_range(record, req.start, req.end, req.sequence)
    except seq_mod.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _record_response(record)


@app.post("/records/{record_id}/reverse_complement")
def reverse_complement(record_id: str) -> dict:
    record = _get(record_id)
    seq_mod.reverse_complement_record(record)
    return _record_response(record)


# --------------------------------------------------------------------------
# Analysis
# --------------------------------------------------------------------------

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
    record = _get(record_id)
    fwd, rev = primers_mod.design_primer_pair(
        record, req.region_start, req.region_end, req.target_tm
    )
    record.primers.extend([fwd, rev])
    return {
        "forward": fwd.model_dump(by_alias=True),
        "reverse": rev.model_dump(by_alias=True),
    }


# --------------------------------------------------------------------------
# Annotation
# --------------------------------------------------------------------------

@app.post("/records/{record_id}/annotate")
def annotate(record_id: str, req: AnnotateRequest) -> dict:
    record = _get(record_id)
    new = annotate_mod.annotate(
        record,
        replace_existing=req.replace_existing,
        min_identity=req.min_identity,
    )
    return {
        "added": [f.model_dump() for f in new],
        "record": _record_response(record),
    }


@app.post("/records/{record_id}/features")
def add_feature(record_id: str, feature: Feature) -> dict:
    record = _get(record_id)
    record.features.append(feature)
    return _record_response(record)


@app.delete("/records/{record_id}/features/{feature_id}")
def delete_feature(record_id: str, feature_id: str) -> dict:
    record = _get(record_id)
    record.features = [f for f in record.features if f.id != feature_id]
    return _record_response(record)


@app.get("/feature_library")
def feature_library() -> list[dict]:
    return [
        {"name": e.name, "type": e.type, "length": len(e.sequence), "source": e.source}
        for e in annotate_mod.load_library()
    ]
