"""Tests for restriction digest and primer design."""

from opengene.core import primers as P
from opengene.core import restriction as R
from opengene.models import PlasmidRecord


def make_record(seq, circular=True):
    return PlasmidRecord(name="t", sequence=seq, is_circular=circular)


def test_ecori_single_cut():
    # EcoRI site GAATTC embedded once.
    seq = "AAAAAA" + "GAATTC" + "AAAAAA"
    rec = make_record(seq, circular=False)
    sites = R.find_cut_sites(rec, ["EcoRI"])
    assert len(sites) == 1
    assert sites[0].enzyme == "EcoRI"


def test_digest_fragment_sizes_sum_to_length_circular():
    seq = ("GAATTC" + "A" * 20) * 3  # three EcoRI sites, circular
    rec = make_record(seq, circular=True)
    results = R.digest(rec, ["EcoRI"])
    res = results[0]
    assert len(res.cut_positions) == 3
    assert sum(res.fragment_sizes) == rec.length


def test_digest_linear_fragment_count():
    seq = "A" * 10 + "GAATTC" + "A" * 10
    rec = make_record(seq, circular=False)
    res = R.digest(rec, ["EcoRI"])[0]
    assert len(res.cut_positions) == 1
    assert len(res.fragment_sizes) == 2
    assert sum(res.fragment_sizes) == rec.length


def test_unique_cutters():
    seq = "A" * 20 + "GAATTC" + "A" * 20
    rec = make_record(seq, circular=True)
    uniq = R.unique_cutters(rec)
    assert "EcoRI" in uniq


def test_primer_analysis_basic():
    res = P.analyze_primer("ATGGCAGCTAGCTAGCATCG", target_tm=60)
    assert 0 < res.tm < 100
    assert 0 <= res.gc_content <= 100
    assert res.length == 20


def test_primer_analysis_flags_short():
    res = P.analyze_primer("ATGC", target_tm=60)
    assert any("length" in w for w in res.warnings)


def test_design_primer_pair():
    # A 500 bp random-ish template.
    body = ("ATGCGTACGATCGTAGCTAGCTAGCGATCGATCGTAGCTA" * 13)[:500]
    rec = make_record(body, circular=True)
    fwd, rev = P.design_primer_pair(rec, 50, 300, target_tm=60)
    assert fwd.strand == 1 and rev.strand == -1
    assert 18 <= len(fwd.sequence) <= 30
    assert 18 <= len(rev.sequence) <= 30
    assert fwd.tm > 0 and rev.tm > 0
