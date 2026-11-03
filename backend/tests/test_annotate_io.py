"""Tests for auto-annotation and file import/export round-trips."""

from opengene.core import annotate as A
from opengene.core.sequence import reverse_complement
from opengene.io import files as IO
from opengene.models import PlasmidRecord


def test_library_loads():
    lib = A.load_library()
    names = {e.name for e in lib}
    assert "T7 promoter" in names
    assert "6xHis tag" in names
    assert "AmpR (bla)" in names


def test_annotate_detects_t7_and_his_tag():
    t7 = "TAATACGACTCACTATAG"
    his = "CACCACCACCACCACCAC"
    seq = "AAAA" + t7 + "GGGG" + his + "TTTT"
    rec = PlasmidRecord(name="t", sequence=seq, is_circular=False)
    new = A.annotate(rec)
    found = {f.name for f in new}
    assert "T7 promoter" in found
    assert "6xHis tag" in found


def test_annotate_detects_reverse_strand():
    t7 = "TAATACGACTCACTATAG"
    seq = "AAAA" + reverse_complement(t7) + "TTTT"
    rec = PlasmidRecord(name="t", sequence=seq, is_circular=False)
    new = A.annotate(rec)
    t7_hits = [f for f in new if f.name == "T7 promoter"]
    assert any(f.strand == -1 for f in t7_hits)


def test_annotate_wraps_origin():
    t7 = "TAATACGACTCACTATAG"
    # place T7 so it straddles the origin of a circular record
    half = len(t7) // 2
    seq = t7[half:] + "A" * 50 + t7[:half]
    rec = PlasmidRecord(name="t", sequence=seq, is_circular=True)
    new = A.annotate(rec)
    assert any(f.name == "T7 promoter" and f.start > f.end for f in new)


def test_genbank_roundtrip():
    seq = "ATGGCAGCTTAATACGACTCACTATAGGGCC"
    rec = PlasmidRecord(name="demo", sequence=seq, is_circular=True)
    A.annotate(rec)
    gb = IO.export_string(rec, "genbank")
    assert "LOCUS" in gb
    reparsed = IO.parse_bytes(gb.encode(), "demo.gb")
    assert reparsed.sequence == seq
    assert reparsed.is_circular is True
    assert len(reparsed.features) >= 1


def test_fasta_roundtrip():
    seq = "ATGGCAGCTACGT"
    rec = PlasmidRecord(name="f", sequence=seq, is_circular=False)
    fa = IO.export_string(rec, "fasta")
    assert fa.startswith(">")
    reparsed = IO.parse_bytes(fa.encode(), "f.fasta")
    assert reparsed.sequence == seq


def test_format_detection():
    assert IO.format_for_extension("x.gb") == "genbank"
    assert IO.format_for_extension("x.dna") == "snapgene"
    assert IO.format_for_extension("x.fasta") == "fasta"
    assert IO.format_for_extension("x.xyz") is None
