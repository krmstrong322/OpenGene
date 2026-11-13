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
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

Strand = Literal[1, -1]

# IUPAC nucleotide codes: the four bases plus the ambiguity codes
# (R = A/G, Y = C/T, S = G/C, W = A/T, K = G/T, M = A/C, B/D/H/V = not A/C/G/T,
# N = any).
VALID_BASES = set("ACGTRYSWKMBDHVN")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class FeatureType(str, Enum):
    """Feature types OpenGene gives special meaning to (colors, the frame guard,
    auto-annotation). ``Feature.type`` is not limited to these: any other
    INSDC/GenBank feature key (``gene``, ``exon``, ``polyA_signal`` ...) is kept
    verbatim so it survives an import/export round trip."""

    promoter = "promoter"
    cds = "CDS"
    terminator = "terminator"
    origin = "origin"
    primer = "primer"
    tag = "tag"
    rbs = "RBS"
    misc_feature = "misc_feature"


class Segment(BaseModel):
    """One piece of a multi-part feature (e.g. an exon), half-open and 0-indexed.
    ``start > end`` means the piece itself wraps the origin."""

    start: int
    end: int


# A qualifier value: one string, or several when the file repeats the key
# (e.g. several ``/note`` lines).
NoteValue = Union[str, list[str]]


class Feature(BaseModel):
    id: str = Field(default_factory=_new_id)
    name: str
    type: str = FeatureType.misc_feature.value
    start: int  # 0-indexed, inclusive
    end: int  # 0-indexed, exclusive (may be < start when wrapping the origin)
    strand: Strand = 1
    color: Optional[str] = None
    notes: dict[str, NoteValue] = Field(default_factory=dict)
    # Multi-part features (GenBank ``join(...)``). Empty for a simple feature.
    # When set, the pieces are listed in forward (increasing-coordinate) order
    # walking from ``start`` — whatever the strand — so ``start`` is the first
    # piece's start and ``end`` the last piece's end; the gaps between pieces
    # (introns) are not part of the feature.
    segments: list[Segment] = Field(default_factory=list)

    @field_validator("type", mode="before")
    @classmethod
    def _type_str(cls, v: object) -> str:
        if isinstance(v, Enum):
            v = v.value
        v = str(v).strip()
        if not v or any(c.isspace() for c in v):
            raise ValueError("feature type must be a single non-empty word")
        return v

    @model_validator(mode="after")
    def _segments_match_span(self) -> "Feature":
        if len(self.segments) == 1:
            self.segments = []
        if self.segments and (
            self.segments[0].start != self.start or self.segments[-1].end != self.end
        ):
            raise ValueError(
                "a multi-part feature's start/end must be its first piece's start "
                "and last piece's end"
            )
        return self

    def spans(self) -> list[tuple[int, int]]:
        """The ``(start, end)`` pieces of the feature (one for a simple feature)."""
        if self.segments:
            return [(s.start, s.end) for s in self.segments]
        return [(self.start, self.end)]

    def coding_length(self, seq_len: int) -> int:
        """Bases actually in the feature: the outer span minus any gaps between
        pieces. This is what must stay a multiple of 3 for a spliced CDS."""
        if not self.segments:
            return self.length(seq_len)
        return sum(
            (seq_len - s) + e if s > e else e - s for s, e in self.spans()
        )

    # KNOWN LIMITATION (half-open coordinates): a feature that spans an entire
    # circular sequence is stored as [0, length); its start codon position is
    # not represented, so a feature reduced to the whole circle by an edit
    # loses where translation begins. Faithful support needs a location model
    # (e.g. storing start + length, or GenBank-style join()).  The frame guard
    # does not depend on it: full-circle features are kept full-circle so any
    # internal insert still changes their length.
    def wraps_origin(self, seq_len: int) -> bool:
        """True when the feature spans the origin of a circular sequence."""
        return self.start > self.end

    def length(self, seq_len: int) -> int:
        if self.wraps_origin(seq_len):
            return (seq_len - self.start) + self.end
        return self.end - self.start


class Primer(BaseModel):
    """A saved oligo. It belongs to a record and stays with it through edits.

    The oligo itself (name, sequence, Tm, GC) is what the user ordered and
    never changes on its own. Where it binds is *derived*: after every edit
    the engine looks the oligo up in the record again (see
    ``core.sequence.rebind_primers``), so ``bind_start`` / ``bind_end`` follow
    the sequence, and are ``None`` when the oligo no longer binds anywhere.
    """

    id: str = Field(default_factory=_new_id)
    name: str
    sequence: str
    # The bases the primer anneals to, [bind_start, bind_end) on the top
    # strand (may wrap the origin). A primer with a 5' tail anneals with its
    # 3' part only, so this span can be shorter than the oligo.
    bind_start: Optional[int] = Field(default=None, alias="bindStart")
    bind_end: Optional[int] = Field(default=None, alias="bindEnd")
    strand: Strand = 1
    # How many places in the record the annealing part matches (1 is what you
    # want; more means the primer is not specific).
    binding_sites: int = Field(default=1, alias="bindingSites")
    tm: float
    gc_content: float = Field(alias="gcContent")

    @property
    def is_bound(self) -> bool:
        return self.bind_start is not None and self.bind_end is not None

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


class Trace(BaseModel):
    """A Sanger chromatogram attached to a record read from an .ab1/.scf file.

    ``peaks`` and ``quality`` have one entry per base of the record's
    sequence: the sample index of that base's peak and its Phred quality (0
    for a base that was typed in rather than called). Sequence edits keep
    them in step with the bases."""

    samples: dict[str, list[int]]  # "A", "C", "G", "T" -> intensity per sample
    peaks: list[int]
    quality: list[int]
    meta: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistent(self) -> "Trace":
        if sorted(self.samples) != ["A", "C", "G", "T"]:
            raise ValueError("a trace needs the A, C, G and T channels")
        if len({len(v) for v in self.samples.values()}) > 1:
            raise ValueError("trace channels differ in length")
        if len(self.peaks) != len(self.quality):
            raise ValueError("trace peaks and qualities differ in length")
        return self

    @property
    def n_samples(self) -> int:
        return len(self.samples["A"])


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
    # Set for a record opened from a sequencing trace (.ab1 / .scf).
    trace: Optional[Trace] = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _trace_matches_sequence(self) -> "PlasmidRecord":
        if self.trace is not None and len(self.trace.peaks) != len(self.sequence):
            raise ValueError("trace has a different number of bases than the sequence")
        return self

    def summary_api(self) -> dict:
        """Lightweight listing entry (no sequence) for the plasmid library."""
        return {
            "id": self.id,
            "name": self.name,
            "length": self.length,
            "isCircular": self.is_circular,
            "featureCount": len(self.features),
            # Enough of each primer to list it under its sequence in the library.
            "primers": [
                {
                    "id": p.id,
                    "name": p.name,
                    "sequence": p.sequence,
                    "tm": p.tm,
                    "bindStart": p.bind_start,
                    "bindEnd": p.bind_end,
                    "strand": p.strand,
                }
                for p in self.primers
            ],
            "hasTrace": self.trace is not None,
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
        # The trace's samples are large; they're served on their own
        # (GET /records/{id}/trace) and only flagged here.
        data = self.model_dump(by_alias=True, exclude={"trace"})
        data["length"] = self.length
        data["hasTrace"] = self.trace is not None
        return data
