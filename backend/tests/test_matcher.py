"""Alignment-based auto-annotation: tolerance, partial hits, false-positive
suppression, identity/coverage reporting."""

import random

import pytest

from opengene.core import annotate as A
from opengene.core.sequence import reverse_complement
from opengene.models import PlasmidRecord

BACKBONE = "ATATGCGCGCTATACGTTAGCGCTATTAGC" * 70  # ~2.1 kb of neutral filler


@pytest.fixture(scope="module")
def ampr():
    return next(e.sequence for e in A.load_library() if e.name == "AmpR (bla)")


def _annotate(seq, **kw):
    rec = PlasmidRecord(name="t", sequence=seq, is_circular=True)
    return A.annotate(rec, **kw)


def _ampr_hit(seq, **kw):
    return [f for f in _annotate(seq, **kw) if f.name == "AmpR (bla)"]


def test_exact_match_full_identity_and_coverage(ampr):
    f = _ampr_hit(BACKBONE + ampr + BACKBONE)[0]
    assert f.notes["identity"] == "100.0%"
    assert f.notes["coverage"] == "100%"
    assert f.notes["exact"] == "true"
    assert f.notes["auto"] == "true"


def test_tolerates_single_base_insertion(ampr):
    assert _ampr_hit(BACKBONE + ampr[:400] + "A" + ampr[400:] + BACKBONE)


def test_tolerates_single_base_deletion(ampr):
    assert _ampr_hit(BACKBONE + ampr[:400] + ampr[401:] + BACKBONE)


def test_reports_reduced_identity_for_substitutions(ampr):
    rng = random.Random(1)
    m = list(ampr)
    for i in rng.sample(range(len(ampr)), int(len(ampr) * 0.03)):
        m[i] = rng.choice([b for b in "ACGT" if b != m[i]])
    f = _ampr_hit(BACKBONE + "".join(m) + BACKBONE)[0]
    assert 0.90 <= float(f.notes["identity"].rstrip("%")) / 100 < 1.0
    assert f.notes["exact"] == "false"


def test_rejects_too_divergent(ampr):
    rng = random.Random(2)
    m = list(ampr)
    for i in rng.sample(range(len(ampr)), int(len(ampr) * 0.25)):
        m[i] = rng.choice([b for b in "ACGT" if b != m[i]])
    assert not _ampr_hit(BACKBONE + "".join(m) + BACKBONE)


def test_partial_hit_reports_honest_coverage(ampr):
    f = _ampr_hit(BACKBONE + ampr[: int(len(ampr) * 0.6)] + BACKBONE, min_coverage=0.5)[0]
    cov = int(f.notes["coverage"].rstrip("%"))
    assert 55 <= cov <= 65


def test_partial_hit_excluded_by_default_coverage(ampr):
    # Default coverage threshold (0.8) excludes a 60% fragment.
    assert not _ampr_hit(BACKBONE + ampr[: int(len(ampr) * 0.6)] + BACKBONE)


def test_finds_reverse_strand(ampr):
    f = _ampr_hit(BACKBONE + reverse_complement(ampr) + BACKBONE)[0]
    assert f.strand == -1


def test_detects_origin_wrapping_feature(ampr):
    # Place AmpR straddling the origin of a circular record.
    half = len(ampr) // 2
    seq = ampr[half:] + BACKBONE + ampr[:half]
    rec = PlasmidRecord(name="t", sequence=seq, is_circular=True)
    hits = [f for f in A.annotate(rec) if f.name == "AmpR (bla)"]
    assert hits and hits[0].start > hits[0].end  # wraps


def test_rbs_requires_a_downstream_start_codon():
    rbs = next(e.sequence for e in A.load_library() if e.type == "RBS")
    # RBS followed closely by ATG -> kept
    with_atg = BACKBONE + rbs + "CCATGAAACCCGGG" + BACKBONE
    assert any(f.type == "RBS" for f in _annotate(with_atg))
    # RBS with no ATG nearby downstream -> dropped
    no_atg = BACKBONE + rbs + "CCCCCCCCCCCCCCCCCCCCCCCC" + BACKBONE
    assert not any(f.type == "RBS" for f in _annotate(no_atg))


def test_short_motif_inside_cds_is_suppressed(ampr):
    # The spurious Shine-Dalgarno hit inside EGFP must not appear.
    egfp = next(e.sequence for e in A.load_library() if e.name == "EGFP")
    rec = PlasmidRecord(name="t", sequence=BACKBONE + egfp + BACKBONE, is_circular=True)
    feats = A.annotate(rec)
    assert any(f.name == "EGFP" for f in feats)
    rbs_in_egfp = [
        f for f in feats
        if f.type == "RBS" and f.start >= len(BACKBONE) and f.end <= len(BACKBONE) + len(egfp)
    ]
    assert not rbs_in_egfp


def test_replace_existing_clears_old_features(ampr):
    rec = PlasmidRecord(name="t", sequence=BACKBONE + ampr + BACKBONE, is_circular=True)
    A.annotate(rec)
    before = len(rec.features)
    assert before >= 1
    A.annotate(rec, replace_existing=True)
    assert len(rec.features) == before  # not doubled


# --- PR #3 review regressions --------------------------------------------

def test_scattered_mismatches_at_seed_positions_still_found(ampr):
    # A variant with a substitution landing on each sampled seed used to
    # produce no candidate offsets and miss the gene. Seeding every position
    # fixes it.
    m = list(ampr)
    for i in (5, 146, 287, 428, 569, 710, 851):
        m[i] = "A" if m[i] != "A" else "C"
    f = _ampr_hit(BACKBONE + "".join(m) + BACKBONE)[0]
    assert f.notes["exact"] == "false"
    assert 0.98 <= float(f.notes["identity"].rstrip("%")) / 100 < 1.0


def test_single_substitution_not_labelled_exact(ampr):
    m = list(ampr)
    m[400] = "A" if m[400] != "A" else "C"
    f = _ampr_hit(BACKBONE + "".join(m) + BACKBONE)[0]
    assert f.notes["exact"] == "false"  # ~99.9%, must not round to exact


def test_partial_in_record_shorter_than_reference(ampr):
    # A short linear record holding only part of a long gene is still annotated.
    rec = PlasmidRecord(name="t", sequence="AATT" + ampr[:700] + "AATT", is_circular=False)
    hits = [f for f in A.annotate(rec, min_coverage=0.5) if f.name == "AmpR (bla)"]
    assert hits and float(hits[0].notes["coverage"].rstrip("%")) >= 70


def test_linear_feature_ending_at_last_base_keeps_end(ampr):
    seq = "GGGG" + ampr  # AmpR ends at the final base
    f = [f for f in A.annotate(PlasmidRecord(name="t", sequence=seq, is_circular=False))
         if f.name == "AmpR (bla)"][0]
    assert f.end == len(seq)  # not wrapped to 0


def test_linear_rbs_at_end_not_satisfied_by_start_atg():
    rbs = next(e.sequence for e in A.load_library() if e.type == "RBS")
    seq = "ATGCCC" + "T" * 60 + rbs  # ATG at the start, RBS at the end
    linear = PlasmidRecord(name="t", sequence=seq, is_circular=False)
    circular = PlasmidRecord(name="t", sequence=seq, is_circular=True)
    assert not [f for f in A.annotate(linear) if f.type == "RBS"]      # ends don't connect
    assert [f for f in A.annotate(circular) if f.type == "RBS"]        # wraps to the ATG
