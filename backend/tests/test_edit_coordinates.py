"""Feature coordinates after edits, checked against an independent model.

Each original base gets a label. The same edit is applied to the list of
labels (new bases get the label -1), which says exactly which original bases
survive and where. After every edit, each surviving feature must cover
exactly its own surviving original bases: no fewer (a collapsed or truncated
feature) and no others (a feature that grew over neighbouring bases).
"""

import random

import pytest

from opengene.core import sequence as S
from opengene.models import Feature, FeatureType, PlasmidRecord


def _segments(start, end, n):
    if start < end:
        return [(start, end)]
    if start > end:
        return [(start, n), (0, end)]
    return []


def _positions(f, n):
    return {i for a, b in _segments(f.start, f.end, n) for i in range(a, b)}


def _edit_labels(n, a, b, new_len):
    """Lay out the labels exactly as an edit of [a, b) with new_len bases does:
    a wrapping range keeps [b, a) as the new start of the sequence."""
    labels = list(range(n))
    if a > b:
        labels = labels[b:] + labels[:b]
        a, b = a - b, n
    return labels[:a] + [-1] * new_len + labels[b:]


def _random_record(rng):
    n = rng.randint(12, 60)
    circular = rng.random() < 0.65
    feats = []
    for i in range(rng.randint(1, 4)):
        start = rng.randrange(n)
        span = rng.randint(1, n - 1) if rng.random() < 0.9 else n  # sometimes full length
        end = start + span
        if span == n:
            start, end = 0, n
        elif end > n:
            if not circular:
                end = n
            else:
                end -= n
        feats.append(Feature(name=f"f{i}", type=FeatureType.misc_feature, start=start, end=end))
    seq = "".join(rng.choice("ACGT") for _ in range(n))
    return PlasmidRecord(name="p", sequence=seq, is_circular=circular, features=feats)


def test_features_cover_exactly_their_surviving_bases():
    rng = random.Random(7)
    checked = 0
    for _ in range(6000):
        r = _random_record(rng)
        n = r.length
        op = rng.choice(["insert", "delete", "replace"])
        a = rng.randrange(n + (0 if r.is_circular else 1))
        b = rng.randrange(n + 1) if r.is_circular else rng.randint(a, n)
        new = "".join(rng.choice("ACGT") for _ in range(rng.randint(1, 6)))
        before = {f.id: (f, _positions(f, n)) for f in r.features}

        if op == "insert":
            pos = a % n if r.is_circular else a
            S.insert(r, a, new, frame_policy="allow")
            lab = _edit_labels(n, pos, pos, len(new))
        elif a == b:
            continue
        elif op == "delete":
            S.delete(r, a, b, frame_policy="allow")
            lab = _edit_labels(n, a, b, 0)
        else:
            S.replace_range(r, a, b, new, frame_policy="allow")
            lab = _edit_labels(n, a, b, len(new))

        new_n = r.length
        assert new_n == len(lab)
        survived = set(lab) - {-1}
        after = {f.id: f for f in r.features}
        for fid, (old, pos_before) in before.items():
            expected = pos_before & survived
            if fid not in after:
                assert not expected, ("removed but bases survive", op, a, b, old, n)
                continue
            g = after[fid]
            assert 0 <= g.start < new_n or (new_n == 0), ("start out of range", g, new_n)
            assert 0 <= g.end <= new_n, ("end out of range", g, new_n)
            got = {lab[i] for i in _positions(g, new_n)} - {-1}
            assert got == expected, (op, a, b, len(new), n, r.is_circular, old, g)
            checked += 1
    assert checked > 5000


def test_zero_length_features_stay_zero_length():
    # Review: legacy zero-length features must not turn into full-length ones.
    r = PlasmidRecord(name="t", sequence="A" * 24, is_circular=False,
                      features=[Feature(name="pt", start=10, end=10)])
    S.insert(r, 10, "C")
    assert r.features[0].start == r.features[0].end
    r = PlasmidRecord(name="t", sequence="A" * 24, is_circular=True,
                      features=[Feature(name="pt", start=10, end=10)])
    S.replace_range(r, 5, 15, "GGG", frame_policy="allow")
    assert r.features[0].start == r.features[0].end


def test_cds_reduced_to_whole_circle_is_still_checked():
    # Review (high): deleting [10,90) leaves 20 of a wrapping CDS's 30 bases.
    r = PlasmidRecord(name="t", sequence="ACGT" * 25, is_circular=True,
                      features=[Feature(name="cds", type=FeatureType.cds, start=90, end=20)])
    try:
        S.delete(r, 10, 90)
    except S.FrameShiftError as e:
        assert "-10 bp" in str(e)
    else:
        raise AssertionError("a 10 bp frameshift was accepted")


def test_insert_at_origin_before_a_cds_after_wrapping_delete():
    # Review: after a wrapping delete the CDS must start at 0, not at n.
    r = PlasmidRecord(name="t", sequence="ACGT" * 25, is_circular=True,
                      features=[Feature(name="cds", type=FeatureType.cds, start=0, end=18)])
    S.delete(r, 90, 9, frame_policy="allow")
    assert (r.features[0].start, r.features[0].end) == (0, 9)
    S.insert(r, 0, "G")  # lands before the CDS: no frame change
    assert (r.features[0].start, r.features[0].end) == (1, 10)


def test_wrapping_delete_then_origin_insert_is_guarded():
    # Copilot PR #2 round 2: a wrapping delete reduces CDS [90,20) to the whole
    # remaining circle. A later 1 bp insert must then be seen as inside it (a
    # frameshift), not absorbed at a boundary.
    r = PlasmidRecord(name="t", sequence="ACGT" * 25, is_circular=True,
                      features=[Feature(name="cds", type=FeatureType.cds, start=90, end=20)])
    S.delete(r, 11, 90)  # removes 9 coding bases (a multiple of 3): allowed
    assert r.features[0].length(r.length) == r.length  # full circle now
    with pytest.raises(S.FrameShiftError):
        S.insert(r, 0, "A")
    # a whole-codon insert is still fine, and keeps it full-circle
    S.insert(r, 0, "ACG")
    assert r.features[0].length(r.length) == r.length


def test_full_circle_feature_stays_full_circle_under_edits():
    for circular in (True,):
        r = PlasmidRecord(name="t", sequence="ACGT" * 10, is_circular=circular,
                          features=[Feature(name="whole", start=0, end=40)])
        S.insert(r, 17, "GG")
        assert (r.features[0].start, r.features[0].end) == (0, 42)
        S.delete(r, 5, 11)
        assert (r.features[0].start, r.features[0].end) == (0, 36)
