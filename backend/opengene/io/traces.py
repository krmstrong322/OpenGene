"""Sanger sequencing traces: ABI (``.ab1``/``.abi``) and SCF (``.scf``).

A trace becomes a linear record whose sequence is the base calls, carrying
the four fluorescence channels, each base's peak position (sample index) and
its Phred quality.

ABI files are read with Biopython (analyzed data ``DATA9``-``DATA12`` in the
channel order given by ``FWO_1``, peaks ``PLOC2``, calls ``PBAS2``). SCF has
no Biopython reader, so it is parsed here (versions 2 and 3):

    header (128 bytes, big-endian): magic ".scf", samples, samples_offset,
        bases, left_clip, right_clip, bases_offset, comments_size,
        comments_offset, version ("2.00"/"3.00"), sample_size (1|2), ...
    samples  v2: per sample A, C, G, T interleaved
             v3: all of A, then C, G, T; each channel delta-encoded twice
    bases    v2: per base: uint32 peak, prob A/C/G/T, call, 3 spare bytes
             v3: all peaks, then all prob A, C, G, T, then calls, then spare
    comments "KEY=value" lines
"""

from __future__ import annotations

import io
import struct

from Bio import SeqIO

from ..models import PlasmidRecord, Trace

CHANNELS = "ACGT"


def _text(v: object) -> str:
    if isinstance(v, bytes):
        return v.decode("latin-1", errors="replace").strip("\x00 ").strip()
    return str(v).strip()


def parse_abi(data: bytes, name: str) -> PlasmidRecord:
    rec = SeqIO.read(io.BytesIO(data), "abi")
    raw = rec.annotations.get("abif_raw", {})
    order = _text(raw.get("FWO_1", b"GATC")).upper()
    if sorted(order) != sorted(CHANNELS):
        raise ValueError(f"unexpected ABI channel order {order!r}")
    # Analyzed traces are DATA9-12; very old files only have raw DATA1-4.
    first = 9 if all(f"DATA{9 + i}" in raw for i in range(4)) else 1
    samples = {base: list(raw[f"DATA{first + i}"]) for i, base in enumerate(order)}
    calls = str(rec.seq).upper()
    peaks = list(raw.get("PLOC2") or raw.get("PLOC1") or [])
    quality = list(rec.letter_annotations.get("phred_quality") or raw.get("PCON2") or [])
    if len(peaks) != len(calls):
        raise ValueError("the ABI file's peak positions don't match its base calls")
    if len(quality) != len(calls):
        quality = [0] * len(calls)
    meta = {
        "format": "ABI",
        "sample": _text(raw.get("SMPL1", "")),
        "instrument": _text(raw.get("MCHN1", "")),
        "run_date": _text(raw.get("RUND1", "")),
    }
    return _record(name, calls, samples, peaks, quality, meta)


def parse_scf(data: bytes, name: str) -> PlasmidRecord:
    if len(data) < 128 or data[:4] != b".scf":
        raise ValueError("not an SCF file")
    (
        _magic, n_samples, samples_off, n_bases, _lclip, _rclip, bases_off,
        comments_size, comments_off, version, sample_size,
    ) = struct.unpack(">4sIIIIIIII4sI", data[:44])
    if sample_size not in (1, 2):
        raise ValueError(f"unsupported SCF sample size {sample_size}")
    v3 = version[:1] >= b"3"
    fmt = "B" if sample_size == 1 else "H"
    mask = 0xFF if sample_size == 1 else 0xFFFF
    count = 4 * n_samples
    end = samples_off + count * sample_size
    if end > len(data):
        raise ValueError("SCF file is truncated")
    values = struct.unpack(f">{count}{fmt}", data[samples_off:end])

    samples: dict[str, list[int]] = {}
    if v3:
        for c, base in enumerate(CHANNELS):
            chan = list(values[c * n_samples:(c + 1) * n_samples])
            for _ in range(2):  # undo the two rounds of delta encoding
                acc = 0
                for i, v in enumerate(chan):
                    acc = (acc + v) & mask
                    chan[i] = acc
            samples[base] = chan
    else:
        for c, base in enumerate(CHANNELS):
            samples[base] = list(values[c::4])

    if bases_off + 12 * n_bases > len(data):
        raise ValueError("SCF file is truncated")
    if v3:
        peaks = list(struct.unpack(f">{n_bases}I", data[bases_off:bases_off + 4 * n_bases]))
        p = bases_off + 4 * n_bases
        probs = {b: data[p + i * n_bases:p + (i + 1) * n_bases] for i, b in enumerate(CHANNELS)}
        calls_raw = data[p + 4 * n_bases:p + 5 * n_bases]
        prob_at = lambda k, b: probs[b][k]  # noqa: E731
    else:
        rows = [data[bases_off + 12 * k:bases_off + 12 * (k + 1)] for k in range(n_bases)]
        peaks = [struct.unpack(">I", r[:4])[0] for r in rows]
        calls_raw = bytes(r[8] for r in rows)
        prob_at = lambda k, b: rows[k][4 + CHANNELS.index(b)]  # noqa: E731

    calls = calls_raw.decode("latin-1").upper().replace("-", "N")
    quality = [
        prob_at(k, c) if c in CHANNELS else max(prob_at(k, b) for b in CHANNELS)
        for k, c in enumerate(calls)
    ]
    comments = data[comments_off:comments_off + comments_size].decode("latin-1", errors="replace")
    fields = dict(
        line.split("=", 1) for line in comments.replace("\x00", "").splitlines() if "=" in line
    )
    meta = {
        "format": f"SCF {version.decode('latin-1', errors='replace')}",
        "sample": fields.get("NAME", "").strip(),
        "instrument": fields.get("MACH", "").strip(),
        "run_date": fields.get("DATE", fields.get("RUND", "")).strip(),
    }
    return _record(name, calls, samples, peaks, quality, meta)


def _record(
    name: str,
    calls: str,
    samples: dict[str, list[int]],
    peaks: list[int],
    quality: list[int],
    meta: dict[str, str],
) -> PlasmidRecord:
    n = len(next(iter(samples.values()))) if samples else 0
    peaks = [min(max(0, int(p)), max(0, n - 1)) for p in peaks]
    return PlasmidRecord(
        name=name,
        is_circular=False,
        sequence=calls,
        trace=Trace(
            samples={b: samples[b] for b in CHANNELS},
            peaks=peaks,
            quality=[int(q) for q in quality],
            meta={k: v for k, v in meta.items() if v},
        ),
    )
