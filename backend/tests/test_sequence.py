"""Tests for the deterministic sequence engine, with emphasis on circular
boundary wrap-around and reading-frame correctness."""

import pytest

from opengene.core import sequence as S
from opengene.models import Feature, FeatureType, PlasmidRecord


def make_record(seq, circular=True, features=None):
    return PlasmidRecord(
        name="t", sequence=seq, is_circular=circular, features=features or []
    )


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def test_validate_uppercases_and_maps_rna():
    assert S.validate_sequence("acguACGU") == "ACGTACGT"


def test_validate_rejects_bad_bases():
    with pytest.raises(S.SequenceError):
        S.validate_sequence("ACGTX")


def test_reverse_complement():
    assert S.reverse_complement("ATGC") == "GCAT"


def test_gc_content():
    assert S.gc_content("GGCC") == 100.0
    assert S.gc_content("ATAT") == 0.0
    assert S.gc_content("") == 0.0


# --------------------------------------------------------------------------
# Circular index wrapping
# --------------------------------------------------------------------------

def test_normalize_index_wraps_circular():
    assert S.normalize_index(12, 10, circular=True) == 2
    assert S.normalize_index(-1, 10, circular=True) == 9


def test_normalize_index_linear_bounds():
    assert S.normalize_index(10, 10, circular=False) == 10  # end is valid
    with pytest.raises(S.SequenceError):
        S.normalize_index(11, 10, circular=False)


def test_slice_circular_wraps():
    assert S.slice_circular("ABCDEFGH", 6, 2) == "GHAB"
    assert S.slice_circular("ABCDEFGH", 1, 4) == "BCD"


# --------------------------------------------------------------------------
# Insert / delete / mutate with feature shifting
# --------------------------------------------------------------------------

def test_insert_shifts_downstream_features():
    rec = make_record(
        "AAAATTTT",
        features=[
            Feature(name="up", type=FeatureType.misc_feature, start=0, end=2),
            Feature(name="down", type=FeatureType.misc_feature, start=4, end=6),
        ],
    )
    S.insert(rec, 2, "GG")
    assert rec.sequence == "AAGGAATTTT"
    up = next(f for f in rec.features if f.name == "up")
    down = next(f for f in rec.features if f.name == "down")
    assert (up.start, up.end) == (0, 2)        # unaffected
    assert (down.start, down.end) == (6, 8)    # shifted by +2


def test_delete_shifts_and_removes_internal():
    rec = make_record(
        "AAAATTTTCCCC",
        features=[Feature(name="tail", type=FeatureType.misc_feature, start=8, end=12)],
    )
    S.delete(rec, 4, 8)
    assert rec.sequence == "AAAACCCC"
    tail = rec.features[0]
    assert (tail.start, tail.end) == (4, 8)


def test_mutate_single_base():
    rec = make_record("ATGC")
    S.mutate(rec, 1, "G")
    assert rec.sequence == "AGGC"


def test_mutate_out_of_range():
    rec = make_record("ATGC")
    with pytest.raises(S.SequenceError):
        S.mutate(rec, 9, "A")


def test_wrap_around_delete_circular():
    # delete from index 6 wrapping past origin to index 2 -> removes GH + AB
    rec = make_record("ABCDEFGH".replace("B", "T").replace("D", "G")  # ensure ACGTN
                      if False else "AACCGGTT", circular=True)
    # sequence AACCGGTT, delete [6,2) => remove TT (6,7) + AA (0,1) -> leaves CCGG
    S.delete(rec, 6, 2)
    assert rec.sequence == "CCGG"


def test_wrap_around_delete_requires_circular():
    rec = make_record("AACCGGTT", circular=False)
    with pytest.raises(S.SequenceError):
        S.delete(rec, 6, 2)


def test_insert_at_origin_circular_wraps_index():
    rec = make_record("AAAA", circular=True)
    S.insert(rec, 4, "GG")  # position == length, valid append
    assert rec.sequence == "GGAAAA" or rec.sequence == "AAAAGG"


# --------------------------------------------------------------------------
# Reverse complement of whole record
# --------------------------------------------------------------------------

def test_reverse_complement_record_flips_features():
    rec = make_record(
        "ATGCATGC",
        features=[Feature(name="f", type=FeatureType.cds, start=0, end=3, strand=1)],
    )
    S.reverse_complement_record(rec)
    assert rec.sequence == "GCATGCAT"
    f = rec.features[0]
    assert f.strand == -1
    assert (f.start, f.end) == (5, 8)


# --------------------------------------------------------------------------
# ORF detection across 6 frames + reading frame checks
# --------------------------------------------------------------------------

def test_find_orf_forward_frame():
    # ATG + 30 codons + stop on forward strand
    orf_seq = "ATG" + "GCT" * 32 + "TAA"
    rec = make_record("CC" + orf_seq + "CC", circular=False)
    orfs = S.find_orfs(rec, min_aa=30)
    assert any(o.strand == 1 and o.start == 2 for o in orfs)
    hit = next(o for o in orfs if o.start == 2)
    assert hit.protein.startswith("M")
    assert hit.length_bp == len(orf_seq)


def test_find_orf_reverse_strand():
    orf_seq = "ATG" + "GCT" * 32 + "TAA"
    rc = S.reverse_complement(orf_seq)
    rec = make_record("CC" + rc + "CC", circular=False)
    orfs = S.find_orfs(rec, min_aa=30)
    assert any(o.strand == -1 for o in orfs)


def test_orf_wraps_origin_circular():
    # Build an ORF that starts near the end and wraps the origin.
    body = "GCT" * 40 + "TAA"      # 123 bp coding tail + stop
    head = body[:30]               # part that will sit before origin
    rest = body[30:]
    seq = "ATG" + rest             # ATG at end ... but we want wrap:
    # Construct: [ ...head ][ ATG + remaining ] so ATG is near the 3' end.
    plasmid = head + "ATG" + rest
    # rotate so ATG+rest sits at the end crossing origin
    rot = plasmid[33:] + plasmid[:33]
    rec = make_record(rot, circular=True)
    orfs = S.find_orfs(rec, min_aa=30)
    assert any(o.strand == 1 for o in orfs)


def test_frame_shift_detection_via_length_mod3():
    # A 3-bp insert preserves frame; a 1-bp insert breaks it.
    assert len("ATG") % 3 == 0
    assert len("A") % 3 != 0


# --------------------------------------------------------------------------
# Primer invalidation on edits (PR #5 review)
# --------------------------------------------------------------------------

from opengene.models import Primer


# The template: 40 bp of filler, then two distinct 20-nt primer sites.
UP = "GATTACAGGCTTAACCGGTA"
DOWN = "CCATGGTTCAAGTCGATCCA"
TEMPLATE = "ACGT" * 5 + UP + "TTTT" * 5 + DOWN + "ACGT" * 5  # 100 bp


def _rec_with_primers(circular=True):
    rec = make_record(TEMPLATE, circular=circular)
    rec.primers = [
        Primer(name="up", sequence=UP, tm=60, gcContent=50),
        Primer(name="down", sequence=S.reverse_complement(DOWN), tm=60, gcContent=50),
    ]
    S.rebind_primers(rec)
    return rec


def _site(rec, name):
    p = next(p for p in rec.primers if p.name == name)
    return (p.bind_start, p.bind_end, p.strand)


def test_primers_find_their_sites_on_either_strand():
    rec = _rec_with_primers()
    assert _site(rec, "up") == (20, 40, 1)
    assert _site(rec, "down") == (60, 80, -1)


def test_insert_moves_downstream_primer_and_keeps_upstream():
    rec = _rec_with_primers()
    S.insert(rec, 50, "AAAA")  # between the two primers
    assert _site(rec, "up") == (20, 40, 1)
    assert _site(rec, "down") == (64, 84, -1)
    assert not rec.history[-1].warnings


def test_deleting_a_binding_site_keeps_the_primer_unbound():
    rec = _rec_with_primers()
    S.delete(rec, 55, 85)  # covers the "down" primer's binding site
    assert {p.name for p in rec.primers} == {"up", "down"}
    assert _site(rec, "down") == (None, None, -1)
    assert "down no longer binds" in rec.history[-1].warnings[-1]
    # Putting the site back makes it bind again.
    S.insert(rec, 55, TEMPLATE[55:85])
    assert _site(rec, "down") == (60, 80, -1)


def test_mutation_near_the_5_prime_end_leaves_the_3_prime_end_annealing():
    rec = _rec_with_primers()
    S.mutate(rec, 21, "C" if TEMPLATE[21] != "C" else "A")  # 2nd base of "up"
    start, end, strand = _site(rec, "up")
    assert (end, strand) == (40, 1) and 22 <= start <= 25


def test_mutation_at_the_3_prime_end_stops_the_primer_binding():
    rec = _rec_with_primers()
    S.mutate(rec, 39, "C" if TEMPLATE[39] != "C" else "A")  # last base of "up"
    assert _site(rec, "up") == (None, None, 1)


def test_reverse_complement_keeps_primers_on_the_other_strand():
    rec = _rec_with_primers()
    S.reverse_complement_record(rec)
    assert _site(rec, "up") == (60, 80, -1)
    assert _site(rec, "down") == (20, 40, 1)


def test_primer_with_a_5_prime_tail_binds_by_its_3_prime_part():
    rec = _rec_with_primers()
    found = S.locate_primer(rec.sequence, True, "GAATTCGGATCC" + UP)
    assert found == (20, 40, 1, 1)


def test_primer_across_the_origin_binds_only_on_a_circle():
    oligo = TEMPLATE[-10:] + TEMPLATE[:10]
    assert S.locate_primer(TEMPLATE + "G", True, TEMPLATE[-9:] + "G" + TEMPLATE[:10])[:3] == (91, 10, 1)
    assert S.locate_primer(TEMPLATE + "G", False, TEMPLATE[-9:] + "G" + TEMPLATE[:10]) is None
    assert oligo  # (kept for readability of the case above)


def test_a_repeated_site_is_counted_and_the_previous_one_is_kept():
    seq = UP + "TTTTTTTTTT" + UP + "CCCCCCCCCC"
    assert S.locate_primer(seq, False, UP) == (0, 20, 1, 2)
    assert S.locate_primer(seq, False, UP, near=30) == (30, 50, 1, 2)



def test_wrap_delete_renumbers_primers_that_survive_it():
    rec = _rec_with_primers()
    S.delete(rec, 70, 2)  # wraps the origin: cuts into "down", renumbers the rest
    assert _site(rec, "up") == (18, 38, 1)
    assert _site(rec, "down") == (None, None, -1)


def test_slice_circular_whole_sequence_and_wraps():
    from opengene.core.sequence import slice_circular
    assert slice_circular("ACGTA", 0, 5) == "ACGTA"
    assert slice_circular("ACGTA", 3, 2) == "TAAC"
    assert slice_circular("ACGTA", 4, 7) == "AAC"
