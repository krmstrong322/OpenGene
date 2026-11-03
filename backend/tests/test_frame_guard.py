"""Reading-frame guard (spec: Frame-Shift Safety Check).

An edit that changes a CDS length by a non-multiple of 3 is rejected by
default, padded with N under 'pad', or applied with a warning under 'allow'.
"""

import pytest
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.core import sequence as S
from opengene.models import Feature, FeatureType, PlasmidRecord
from opengene.session import store

# 10 bp spacer + 36 bp CDS (ATG, 10 codons, stop) + 10 bp spacer = 56 bp
CDS_SEQ = "ATG" + "GCT" * 10 + "TAA"
SEQ = "C" * 10 + CDS_SEQ + "C" * 10


def rec(circular=False, features=None):
    return PlasmidRecord(
        name="t",
        sequence=SEQ,
        is_circular=circular,
        features=features
        if features is not None
        else [Feature(name="geneX", type=FeatureType.cds, start=10, end=46)],
    )


# -- insert ---------------------------------------------------------------

def test_insert_inside_cds_non_multiple_of_3_rejected():
    r = rec()
    with pytest.raises(S.FrameShiftError, match="geneX"):
        S.insert(r, 16, "A")
    assert r.sequence == SEQ  # unchanged on rejection
    assert r.history == []


def test_insert_inside_cds_whole_codon_ok():
    r = rec()
    S.insert(r, 16, "GGC")
    cds = r.features[0]
    assert (cds.start, cds.end) == (10, 49)
    assert (cds.end - cds.start) % 3 == 0


def test_insert_pad_extends_to_whole_codon_with_N():
    r = rec()
    S.insert(r, 16, "A", frame_policy="pad")
    assert r.sequence[16:19] == "ANN"
    cds = r.features[0]
    assert (cds.end - cds.start) % 3 == 0
    assert r.history[-1].warnings and "padded with 2 N" in r.history[-1].warnings[0]


def test_insert_allow_applies_and_warns():
    r = rec()
    S.insert(r, 16, "A", frame_policy="allow")
    assert len(r.sequence) == len(SEQ) + 1
    assert "frameshift allowed" in r.history[-1].warnings[0]


def test_insert_on_cds_boundary_is_not_inside():
    # At the CDS start or end the insert falls outside the CDS.
    for pos in (10, 46):
        r = rec()
        S.insert(r, pos, "A")
        assert r.history[-1].warnings == []


def test_insert_outside_cds_unrestricted():
    r = rec()
    S.insert(r, 3, "A")
    assert len(r.sequence) == len(SEQ) + 1


def test_non_cds_features_are_not_guarded():
    r = rec(features=[Feature(name="tag", type=FeatureType.misc_feature, start=10, end=46)])
    S.insert(r, 16, "A")
    assert len(r.sequence) == len(SEQ) + 1


# -- delete ---------------------------------------------------------------

def test_delete_inside_cds_non_multiple_rejected():
    r = rec()
    with pytest.raises(S.FrameShiftError, match="-2 bp"):
        S.delete(r, 16, 18)
    assert r.sequence == SEQ


def test_delete_whole_codon_ok():
    r = rec()
    S.delete(r, 16, 19)
    assert (r.features[0].end - r.features[0].start) == 33


def test_delete_entire_cds_is_allowed():
    # Removing the whole CDS leaves no frame to shift.
    r = rec()
    S.delete(r, 5, 50)
    assert len(r.sequence) == len(SEQ) - 45


def test_delete_overlapping_cds_edge_counts_only_removed_cds_bases():
    # Deleting [5,12) removes 2 CDS bases (10,11) -> frameshift.
    r = rec()
    with pytest.raises(S.FrameShiftError):
        S.delete(r, 5, 12)
    # Deleting [4,13) removes 3 CDS bases -> fine.
    r = rec()
    S.delete(r, 4, 13)


def test_delete_pad_is_refused_with_explanation():
    r = rec()
    with pytest.raises(S.FrameShiftError, match="Padding only applies"):
        S.delete(r, 16, 18, frame_policy="pad")


# -- replace --------------------------------------------------------------

def test_replace_same_length_codon_swap_ok():
    r = rec()
    S.replace_range(r, 16, 19, "GGC")
    assert r.sequence[16:19] == "GGC"
    assert len(r.history) == 1 and r.history[0].op == "replace"


def test_replace_net_change_not_multiple_rejected():
    r = rec()
    with pytest.raises(S.FrameShiftError, match="-1 bp"):
        S.replace_range(r, 16, 19, "GG")
    assert r.sequence == SEQ


def test_replace_pad():
    r = rec()
    S.replace_range(r, 16, 19, "GG", frame_policy="pad")
    cds = r.features[0]
    assert (cds.end - cds.start) % 3 == 0


# -- circular CDS spanning the origin -------------------------------------

def test_wrapping_cds_guarded_at_origin():
    # CDS from 50 wrapping to 10 on a 56 bp circle (16 bp long).
    feats = [Feature(name="wrapCDS", type=FeatureType.cds, start=50, end=10)]
    r = rec(circular=True, features=feats)
    with pytest.raises(S.FrameShiftError, match="wrapCDS"):
        S.insert(r, 0, "A")  # the origin is inside this CDS
    with pytest.raises(S.FrameShiftError):
        S.delete(r, 54, 2)  # wrapping delete removing 4 of its bases


def test_unknown_policy_rejected():
    with pytest.raises(S.SequenceError, match="frame_policy"):
        S.insert(rec(), 3, "A", frame_policy="maybe")


# -- API ------------------------------------------------------------------

def test_api_returns_409_and_leaves_record_unchanged():
    store.clear()
    client = TestClient(app)
    r = rec()
    store.add(r)
    res = client.post(f"/records/{r.id}/insert", json={"position": 16, "sequence": "A"})
    assert res.status_code == 409
    assert "reading frame" in res.json()["detail"] or "multiple of 3" in res.json()["detail"]
    assert client.get(f"/records/{r.id}").json()["sequence"] == SEQ

    res = client.post(
        f"/records/{r.id}/insert",
        json={"position": 16, "sequence": "A", "frame_policy": "pad"},
    )
    assert res.status_code == 200
    assert res.json()["history"][-1]["warnings"]

    res = client.post(
        f"/records/{r.id}/delete", json={"start": 16, "end": 17, "frame_policy": "nope"}
    )
    assert res.status_code == 422  # invalid policy value
    store.clear()
