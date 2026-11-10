"""Sequencing traces (.ab1 / .scf): reading, editing, API.

The files here are built in the test so no third-party data is committed;
their layouts follow the ABIF and SCF specifications (checked by hand against
real instrument files from Biopython's and BioPerl's test suites).
"""

import struct

import pytest
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.core import sequence as S
from opengene.io import files as IO
from opengene.models import PlasmidRecord, Trace
from opengene.session import SessionStore, store

CALLS = "ACGTNACGTA"
SPACING = 10
N_SAMPLES = len(CALLS) * SPACING + 10
PEAKS = [5 + SPACING * i for i in range(len(CALLS))]
QUAL = [10, 20, 30, 40, 5, 11, 22, 33, 44, 15]


def _channels() -> dict[str, list[int]]:
    """A peak of height 900 in the called base's channel at each peak."""
    chans = {b: [0] * N_SAMPLES for b in "ACGT"}
    for base, p in zip(CALLS, PEAKS):
        for b in "ACGT":
            chans[b][p] = 900 if b == base else (300 if base == "N" else 40)
    return chans


# --------------------------------------------------------------------------
# File builders
# --------------------------------------------------------------------------

def _scf(version: int) -> bytes:
    chans = _channels()
    if version == 3:
        body = b""
        for b in "ACGT":
            vals = chans[b]
            for _ in range(2):  # delta-encode twice
                prev, out = 0, []
                for v in vals:
                    out.append((v - prev) & 0xFFFF)
                    prev = v
                vals = out
            body += struct.pack(f">{N_SAMPLES}H", *vals)
    else:
        body = b"".join(struct.pack(">4H", *(chans[b][i] for b in "ACGT")) for i in range(N_SAMPLES))
    # Each base's probability sits on its called channel; the N's sits on G,
    # since an N's quality is read as the best of its four probabilities.
    probs = {
        b: [q if c == b or (c == "N" and b == "G") else 0 for c, q in zip(CALLS, QUAL)]
        for b in "ACGT"
    }
    if version == 3:
        bases = struct.pack(f">{len(CALLS)}I", *PEAKS)
        for b in "ACGT":
            bases += bytes(probs[b])
        bases += CALLS.encode() + b"\0" * 3 * len(CALLS)
    else:
        bases = b"".join(
            struct.pack(">I4Bc3x", p, *(probs[b][i] for b in "ACGT"), c.encode())
            for i, (c, p) in enumerate(zip(CALLS, PEAKS))
        )
    comments = b"NAME=read1\nMACH=test-seq\n\0"
    samples_off = 128
    bases_off = samples_off + len(body)
    comments_off = bases_off + len(bases)
    header = struct.pack(
        ">4sIIIIIIII4sIII",
        b".scf", N_SAMPLES, samples_off, len(CALLS), 0, 0, bases_off,
        len(comments), comments_off, f"{version}.00".encode(), 2, 0, 0,
    ).ljust(128, b"\0")
    return header + body + bases + comments


def _abi() -> bytes:
    """A minimal ABIF file with the tags OpenGene reads, channels in G A T C
    order as instruments write them."""
    chans = _channels()
    entries: list[tuple[str, int, int, int, bytes]] = []  # name, number, type, elsize, data

    def add(name, number, etype, elsize, data):
        entries.append((name, number, etype, elsize, data))

    for i, b in enumerate("GATC"):
        add("DATA", 9 + i, 4, 2, struct.pack(f">{N_SAMPLES}h", *chans[b]))
    add("FWO_", 1, 2, 1, b"GATC")
    add("PBAS", 2, 2, 1, CALLS.encode())
    add("PCON", 2, 2, 1, bytes(QUAL))
    add("PLOC", 2, 4, 2, struct.pack(f">{len(PEAKS)}h", *PEAKS))
    add("SMPL", 1, 18, 1, bytes([5]) + b"read1")
    add("MCHN", 1, 18, 1, bytes([8]) + b"test-seq")

    data_start = 128
    blob = b""
    dir_entries = b""
    for name, number, etype, elsize, data in entries:
        count = len(data) // elsize
        if len(data) <= 4:
            offset_field = data.ljust(4, b"\0")
        else:
            offset_field = struct.pack(">I", data_start + len(blob))
            blob += data
        dir_entries += struct.pack(">4sihhii", name.encode(), number, etype, elsize, count, len(data))
        dir_entries += offset_field + b"\0\0\0\0"
    dir_offset = data_start + len(blob)
    header = b"ABIF" + struct.pack(">h", 101)
    header += struct.pack(">4sihhii", b"tdir", 1, 1023, 28, len(entries), len(dir_entries))
    header += struct.pack(">i", dir_offset) + b"\0\0\0\0"
    return header.ljust(data_start, b"\0") + blob + dir_entries


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

@pytest.mark.parametrize("make,filename", [
    (lambda: _scf(2), "read.scf"),
    (lambda: _scf(3), "read.scf"),
    (_abi, "read.ab1"),
])
def test_trace_files_read(make, filename):
    rec = IO.parse_bytes(make(), filename)
    assert rec.sequence == CALLS and rec.is_circular is False and rec.name == "read"
    t = rec.trace
    assert t.samples == _channels()  # every channel in the right place
    assert t.peaks == PEAKS
    assert t.quality == QUAL
    assert t.meta["sample"] == "read1" and t.meta["instrument"] == "test-seq"


def test_bad_trace_files():
    with pytest.raises(ValueError):
        IO.parse_bytes(b"not a trace", "x.scf")
    with pytest.raises(ValueError):
        IO.parse_bytes(_scf(3)[:300], "x.scf")


# --------------------------------------------------------------------------
# Edits keep the trace aligned
# --------------------------------------------------------------------------

def _rec() -> PlasmidRecord:
    return IO.parse_bytes(_scf(3), "read.scf")


def test_insert_spaces_new_peaks_between_neighbours():
    rec = S.insert(_rec(), 3, "GG")
    t = rec.trace
    assert rec.sequence == "ACGGGTNACGTA"
    assert t.peaks[:3] == PEAKS[:3] and t.peaks[5:] == PEAKS[3:]
    left, right = PEAKS[2], PEAKS[3]
    assert left < t.peaks[3] < t.peaks[4] < right
    assert t.quality[3:5] == [0, 0]


def test_insert_at_the_ends_extrapolates_within_the_trace():
    rec = S.insert(_rec(), 0, "TT")
    assert rec.trace.peaks[:2] == sorted(rec.trace.peaks[:2]) and rec.trace.peaks[1] < PEAKS[0]
    rec = S.insert(_rec(), len(CALLS), "TT")
    assert PEAKS[-1] < rec.trace.peaks[-2] < rec.trace.peaks[-1] <= N_SAMPLES - 1


def test_delete_and_mutate():
    rec = S.delete(_rec(), 2, 5)
    assert rec.trace.peaks == PEAKS[:2] + PEAKS[5:]
    assert rec.trace.quality == QUAL[:2] + QUAL[5:]
    rec = S.mutate(_rec(), 4, "G")  # correct the N call
    assert rec.sequence[4] == "G" and rec.trace.peaks == PEAKS


def test_reverse_complement_flips_the_trace():
    rec = S.reverse_complement_record(_rec())
    t = rec.trace
    assert t.peaks == [N_SAMPLES - 1 - p for p in reversed(PEAKS)]
    assert t.quality == list(reversed(QUAL))
    # The called base's channel is still the tallest at each peak.
    for base, p in zip(rec.sequence, t.peaks):
        if base in "ACGT":
            assert max("ACGT", key=lambda c: t.samples[c][p]) == base


def test_trace_must_match_the_sequence():
    t = _rec().trace
    with pytest.raises(ValueError):
        PlasmidRecord(name="x", sequence="ACG", is_circular=False, trace=t)
    with pytest.raises(ValueError):
        Trace(samples={"A": [1], "C": [1], "G": [1]}, peaks=[], quality=[])


def test_trace_survives_persistence(tmp_path):
    db = str(tmp_path / "t.db")
    s1 = SessionStore(db)
    rec = s1.add(_rec())
    s2 = SessionStore(db)
    assert s2.get(rec.id).trace == rec.trace


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

@pytest.fixture
def client():
    store.clear()
    yield TestClient(app)
    store.clear()


def test_api_trace(client):
    r = client.post("/records/import", files={"file": ("read.ab1", _abi(), "application/octet-stream")})
    assert r.status_code == 200
    rec = r.json()
    assert rec["hasTrace"] is True and "trace" not in rec
    assert client.get("/records").json()[0]["hasTrace"] is True

    trace = client.get(f"/records/{rec['id']}/trace").json()
    assert trace["peaks"] == PEAKS and set(trace["samples"]) == set("ACGT")

    # Edit, then undo: the trace follows.
    client.post(f"/records/{rec['id']}/insert", json={"position": 3, "sequence": "GG"})
    assert len(client.get(f"/records/{rec['id']}/trace").json()["peaks"]) == len(CALLS) + 2
    client.post(f"/records/{rec['id']}/undo")
    assert client.get(f"/records/{rec['id']}/trace").json()["peaks"] == PEAKS

    plain = client.post("/records", json={"name": "p", "sequence": "ACGT", "isCircular": True}).json()
    assert plain["hasTrace"] is False
    assert client.get(f"/records/{plain['id']}/trace").status_code == 404
