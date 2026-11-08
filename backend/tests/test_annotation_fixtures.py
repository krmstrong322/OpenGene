"""Auto-annotation against real reference plasmids (independent ground truth).

Unlike test_matcher.py's synthetic cases, these parse unmodified NCBI records
(the bundled samples in opengene/data/samples) and assert the origins the matcher finds, their coordinates,
and their identity/coverage at the DEFAULT thresholds. A truncated, mislabeled
or mis-sourced origin would show up here as a wrong interval, a missing hit, or
reduced identity — in particular, the ColE1/pUC origin was derived from pUC19
but must also be found in the independent pBR322 record.
"""

from pathlib import Path

import pytest

from opengene.core import annotate as A
from opengene.io import files as IO

FIXTURES = Path(__file__).parent.parent / "opengene" / "data" / "samples"


def _origins(filename):
    rec = IO.parse_file(FIXTURES / filename)
    rec.features = []  # annotate from scratch
    feats = A.annotate(rec)  # default thresholds (0.80 / 0.80)
    return rec, {f.name: f for f in feats if f.type.value == "origin"}


def _near(value, target, tol=12):
    return abs(value - target) <= tol


def test_pUC19_has_cole1_origin_at_expected_place():
    rec, oris = _origins("pUC19_L09137.gb")
    assert set(oris) == {"ColE1/pUC ori"}
    o = oris["ColE1/pUC ori"]
    assert _near(o.start, 679) and _near(o.end, 1625)
    assert o.notes["identity"] == "100.0%" and o.notes["coverage"] == "100%"


def test_pBR322_shares_the_cole1_origin():
    # Independence: the origin was derived from pUC19; pBR322 is a separate
    # record and must still carry it, at ~99.9% (its high-copy variant differs).
    rec, oris = _origins("pBR322_J01749.gb")
    assert "ColE1/pUC ori" in oris
    o = oris["ColE1/pUC ori"]
    assert _near(o.start, 2346) and _near(o.end, 3292)
    assert 0.99 <= float(o.notes["identity"].rstrip("%")) / 100 <= 1.0
    assert o.notes["coverage"] == "100%"


def test_pEGFP_N1_has_f1_sv40_and_a_shorter_pUC_origin():
    rec, oris = _origins("pEGFP-N1_U55762.gb")
    assert {"f1 ori", "SV40 ori", "ColE1/pUC ori"} <= set(oris)

    f1 = oris["f1 ori"]
    assert _near(f1.start, 1648) and _near(f1.end, 2107)
    assert f1.notes["exact"] == "true"

    sv40 = oris["SV40 ori"]
    assert _near(sv40.start, 2151) and _near(sv40.end, 2527)
    assert sv40.notes["exact"] == "true"

    # The pUC origin here is a shorter variant: full identity, partial coverage.
    cole1 = oris["ColE1/pUC ori"]
    assert float(cole1.notes["identity"].rstrip("%")) / 100 >= 0.98
    assert 0.80 <= float(cole1.notes["coverage"].rstrip("%")) / 100 < 1.0


def test_pACYC184_has_p15A_origin_and_not_cole1():
    rec, oris = _origins("pACYC184_X06403.gb")
    assert "p15A ori" in oris
    # p15A is a distinct origin family; the ColE1/pUC one must not cross-match.
    assert "ColE1/pUC ori" not in oris
    o = oris["p15A ori"]
    assert _near(o.start, 580) and _near(o.end, 1493)
    assert o.notes["exact"] == "true"


def test_pACYC184_has_cmr_cat_cds():
    # The CmR (cat) library entry comes from the independent Tn9 record V00622,
    # not from this plasmid: the pACYC184 GenBank record over-annotates the
    # region as misc_feature 219..3805 (~3.5 kb), so the ~660 bp cat CDS and its
    # strand are verified against V00622, not against the sample itself.
    rec = IO.parse_file(FIXTURES / "pACYC184_X06403.gb")
    rec.features = []
    feats = {f.name: f for f in A.annotate(rec) if f.type.value == "CDS"}
    assert "CmR (cat)" in feats
    cat = feats["CmR (cat)"]
    # 660 bp CDS on the reverse strand, wrapping the origin at position 1 of the
    # 4245 bp circular record (end 219, start 3804 -> 219 + (4245 - 3804) = 660).
    assert cat.strand == -1
    span = (cat.end - cat.start) % rec.length
    assert _near(span, 660)
    assert _near(cat.end, 219) and _near(cat.start, 3804)
    assert cat.notes["exact"] == "true"
    assert cat.notes["source"] == "V00622.1"
