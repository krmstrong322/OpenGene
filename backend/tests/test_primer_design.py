"""PCR primer-pair design, backed by primer3."""

import pytest
from fastapi.testclient import TestClient

from opengene.core import primers as P
from opengene.core import sequence as S
from opengene.models import PlasmidRecord
from opengene.api import app
from opengene.session import store

# A varied ~600 bp template with no repeats, so every designed primer binds a
# single site. Deterministic (seeded), with GC held near 50% so primer3 has
# room to pick good primers anywhere.
def _random_template(length: int, seed: int) -> str:
    import random

    rng = random.Random(seed)
    return "".join(rng.choice("ACGT") for _ in range(length))


TEMPLATE = _random_template(600, seed=20260114)


def _rec(seq=TEMPLATE, circular=True):
    return PlasmidRecord(name="t", sequence=seq, is_circular=circular)


def test_exact_mode_primers_sit_at_the_region_ends():
    rec = _rec()
    pair = P.design_primer_pair(rec, 100, 400, mode="exact")
    # The product is exactly the region.
    assert pair.product_size == 300
    # The forward primer reads into the region from its start; the reverse from
    # its end. After binding, the forward primer's 5' base is at the region start.
    fwd = S.bind_primer(rec, pair.forward)
    rev = S.bind_primer(rec, pair.reverse)
    assert fwd.bind_start == 100 and fwd.strand == 1
    assert rev.bind_end == 400 and rev.strand == -1


def test_flank_mode_product_contains_the_region():
    rec = _rec()
    pair = P.design_primer_pair(rec, 250, 350, mode="flank")
    # Primers may sit outside the region, so the product is at least as large.
    assert pair.product_size >= 100
    fwd = S.bind_primer(rec, pair.forward)
    rev = S.bind_primer(rec, pair.reverse)
    assert fwd.bind_start is not None and fwd.bind_start <= 250
    assert rev.bind_end is not None and rev.bind_end >= 350


def test_designed_primers_have_sensible_tm_and_gc():
    pair = P.design_primer_pair(_rec(), 100, 400)
    for p in (pair.forward, pair.reverse):
        assert 50 <= p.tm <= 70  # near the 60C default target
        assert 30 <= p.gc_content <= 70
        assert 18 <= len(p.sequence) <= 30
    # A good pair over a clean template has no warnings.
    assert pair.warnings == []
    assert abs(pair.forward.tm - pair.reverse.tm) <= P.PAIR_TM_DIFFERENCE_LIMIT


def test_a_hard_template_still_returns_a_pair_with_warnings():
    # An AT-only region can't give a 60C, 40-60% GC primer; primer3 is asked
    # again for the best it can do, and the shortfall comes back as warnings.
    seq = "AT" * 150  # 300 bp, 0% GC
    pair = P.design_primer_pair(_rec(seq, circular=False), 20, 280, mode="exact")
    assert pair.forward.sequence and pair.reverse.sequence
    assert any("usual criteria" in w for w in pair.warnings)


def test_region_too_short_is_refused():
    with pytest.raises(S.SequenceError, match="at least"):
        P.design_primer_pair(_rec(), 100, 140)  # 40 bp < MIN_PRODUCT


def test_no_region_is_refused():
    with pytest.raises(S.SequenceError, match="select the region"):
        P.design_primer_pair(_rec(), 100, 100)


def test_region_may_cross_the_origin_of_a_circle():
    rec = _rec()
    n = len(TEMPLATE)
    # A region from near the end, wrapping through the origin.
    pair = P.design_primer_pair(rec, n - 150, 150, mode="exact")
    assert pair.product_size == 300
    fwd = S.bind_primer(rec, pair.forward)
    assert fwd.bind_start == n - 150


class TestEndpoint:
    @pytest.fixture(autouse=True)
    def _clear(self):
        store.clear()
        yield
        store.clear()

    @pytest.fixture
    def client(self):
        return TestClient(app, base_url="http://localhost")

    def test_designed_pair_is_saved_with_binding_and_product_size(self, client):
        rid = client.post(
            "/records", json={"name": "t", "sequence": TEMPLATE, "isCircular": True}
        ).json()["id"]
        r = client.post(
            f"/records/{rid}/design_primers",
            json={"region_start": 100, "region_end": 400, "mode": "exact"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["productSize"] == 300
        assert body["forward"]["bindStart"] == 100
        assert body["forward"]["annealTm"] is not None
        # Both primers are saved on the record.
        assert len(body["record"]["primers"]) == 2
        assert "300 bp product" in body["record"]["history"][-1]["description"]

    def test_pair_warnings_are_recorded_in_the_history(self, client):
        rid = client.post(
            "/records", json={"name": "t", "sequence": "AT" * 200, "isCircular": False}
        ).json()["id"]
        r = client.post(
            f"/records/{rid}/design_primers", json={"region_start": 20, "region_end": 380}
        ).json()
        assert r["warnings"]
        assert r["record"]["history"][-1]["warnings"] == r["warnings"]

    def test_bad_mode_is_rejected(self, client):
        rid = client.post("/records", json={"name": "t", "sequence": TEMPLATE}).json()["id"]
        r = client.post(
            f"/records/{rid}/design_primers",
            json={"region_start": 100, "region_end": 400, "mode": "sideways"},
        )
        assert r.status_code == 422
