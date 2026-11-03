"""Core data models for OpenGene.

Mirrors the ``PlasmidRecord`` TypeScript schema from the specification.
Coordinates are 0-indexed, half-open ``[start, end)`` on the forward strand,
following the Python/Biopython convention. For circular records a feature may
wrap past the origin, in which case ``start > end``.
"""

from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Strand = Literal[1, -1]

VALID_BASES = set("ACGTN")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class FeatureType(str, Enum):
    promoter = "promoter"
    cds = "CDS"
    terminator = "terminator"
    origin = "origin"
    primer = "primer"
    tag = "tag"
    rbs = "RBS"
    misc_feature = "misc_feature"


class Feature(BaseModel):
    id: str = Field(default_factory=_new_id)
    name: str
    type: FeatureType = FeatureType.misc_feature
    start: int  # 0-indexed, inclusive
    end: int  # 0-indexed, exclusive (may be < start when wrapping the origin)
    strand: Strand = 1
    color: Optional[str] = None
    notes: dict[str, str] = Field(default_factory=dict)

    def wraps_origin(self, seq_len: int) -> bool:
        """True when the feature spans the origin of a circular sequence."""
        return self.start > self.end

    def length(self, seq_len: int) -> int:
        if self.wraps_origin(seq_len):
            return (seq_len - self.start) + self.end
        return self.end - self.start


class Primer(BaseModel):
    id: str = Field(default_factory=_new_id)
    name: str
    sequence: str
    bind_start: int = Field(alias="bindStart")
    bind_end: int = Field(alias="bindEnd")
    strand: Strand = 1
    tm: float
    gc_content: float = Field(alias="gcContent")

    model_config = {"populate_by_name": True}

    @field_validator("sequence")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class HistoryEvent(BaseModel):
    id: str = Field(default_factory=_new_id)
    op: str
    description: str
    timestamp: float
    warnings: list[str] = Field(default_factory=list)


class PlasmidRecord(BaseModel):
    id: str = Field(default_factory=_new_id)
    name: str = "untitled"
    is_circular: bool = Field(default=True, alias="isCircular")
    sequence: str = ""
    features: list[Feature] = Field(default_factory=list)
    primers: list[Primer] = Field(default_factory=list)
    history: list[HistoryEvent] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time, alias="createdAt")
    # Last time the record was saved after any change (sequence, features,
    # primers, annotation). Stamped by SessionStore.add/save.
    updated_at: float = Field(default_factory=time.time, alias="updatedAt")

    model_config = {"populate_by_name": True}

    def summary_api(self) -> dict:
        """Lightweight listing entry (no sequence) for the plasmid library."""
        return {
            "id": self.id,
            "name": self.name,
            "length": self.length,
            "isCircular": self.is_circular,
            "featureCount": len(self.features),
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    @field_validator("sequence")
    @classmethod
    def _validate_sequence(cls, v: str) -> str:
        v = v.upper().replace("U", "T")
        bad = set(v) - VALID_BASES
        if bad:
            raise ValueError(f"sequence contains invalid bases: {sorted(bad)}")
        return v

    @property
    def length(self) -> int:
        return len(self.sequence)

    def model_dump_api(self) -> dict:
        """Serialize with camelCase keys and a computed ``length`` field."""
        data = self.model_dump(by_alias=True)
        data["length"] = self.length
        return data
