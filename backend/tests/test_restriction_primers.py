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


# --- enzyme catalog, overhangs, methylation --------------------------------

def test_cut_sites_report_overhangs():
    from opengene.core import restriction as R
    seq = "AA" + "GAATTC" + "AA" + "GGTACC" + "AA" + "GATATC" + "AA"
    by = {s.enzyme: s for s in R.find_cut_sites(make_record(seq, False), ["EcoRI", "KpnI", "EcoRV"])}
    assert by["EcoRI"].overhang_type == "5'" and by["EcoRI"].overhang == "AATT"
    assert by["KpnI"].overhang_type == "3'" and by["KpnI"].overhang == "GTAC"
    assert by["EcoRV"].overhang_type == "blunt" and by["EcoRV"].overhang == ""


def test_dam_dcm_cpg_methylation_flags():
    from opengene.core import restriction as R
    # MboI GATC is a Dam site; EcoRII CCWGG is a Dcm site.
    dam = R.find_cut_sites(make_record("TTTGGATCCTTT", False), ["MboI"])
    assert dam and all("dam" in s.methylation for s in dam)
    dcm = R.find_cut_sites(make_record("TTTCCAGGTTT", False), ["EcoRII"])
    assert dcm and all("dcm" in s.methylation for s in dcm)
    # EcoRI GAATTC has no Dam/Dcm/CpG base in its site.
    clean = R.find_cut_sites(make_record("TTTGAATTCTTT", False), ["EcoRI"])
    assert clean and all(not s.methylation for s in clean)


def test_methylation_wraps_the_origin():
    from opengene.core import restriction as R
    # GATC split across the origin: "ATC....G" so the circle reads ...G|ATC...
    rec = make_record("ATCAAAAAAAAAAAG", True)  # G at end + ATC at start -> GATC over origin
    sites = R.find_cut_sites(rec, ["MboI"])
    assert sites and all("dam" in s.methylation for s in sites)


def test_enzyme_catalog_counts_and_suppliers():
    from opengene.core import restriction as R
    rec = make_record("AA" + "GAATTC" + "AA" + "GAATTC" + "AA", False)  # EcoRI twice
    cat = {e.name: e for e in R.enzyme_catalog(rec)}
    assert len(cat) > 500
    assert cat["EcoRI"].cuts == 2 and cat["EcoRI"].overhang == "AATT"
    assert "New England Biolabs" in cat["EcoRI"].suppliers
    assert cat["EcoRV"].cuts == 0
