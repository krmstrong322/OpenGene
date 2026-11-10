"""DNA and protein search."""

import random

import pytest
from fastapi.testclient import TestClient

from opengene.api import app
from opengene.core import search as SR
from opengene.core.sequence import SequenceError, reverse_complement
from opengene.models import Feature, PlasmidRecord, Segment
from opengene.session import store


def _rec(seq: str, circular: bool = True, features=()) -> PlasmidRecord:
    return PlasmidRecord(name="t", sequence=seq, is_circular=circular, features=list(features))


def _spans(result):
    return [(h.start, h.end, h.strand) for h in result.hits]


# --------------------------------------------------------------------------
# DNA
# --------------------------------------------------------------------------

def test_exact_hits_on_both_strands():
    seq = "TTTTGATCAAATTTTTTTGCCGTTTTT"
    rec = _rec(seq + "CCCCCCTGACGCCCC", circular=False)
    hits = _spans(SR.search_dna(rec, "CGTCA"))
    # CGTCA's reverse complement TGACG sits at 33 on the top strand.
    assert (33, 38, -1) in hits


def test_palindrome_reported_once():
    rec = _rec("AAAAGAATTCAAAAAAAAAA", circular=False)
    assert _spans(SR.search_dna(rec, "GAATTC")) == [(4, 10, 1)]


def test_match_across_the_origin():
    seq = "CCCC" + "A" * 30 + "GGAT"  # GGAT + CCCC wraps the origin
    hits = _spans(SR.search_dna(_rec(seq), "GGATCC"))
    assert (len(seq) - 4, 2, 1) in hits
    assert not SR.search_dna(_rec(seq, circular=False), "GGATCC").hits


def test_degenerate_query_and_ambiguous_sequence():
    rec = _rec("AAAACTGGAAAAATTGGAAAANTGGAAAA", circular=False)
    assert _spans(SR.search_dna(rec, "YTGG")) == [(4, 8, 1), (13, 17, 1)]
    # A query N covers a sequence N; a definite base doesn't.
    assert _spans(SR.search_dna(rec, "NTGG")) == [(4, 8, 1), (13, 17, 1), (21, 25, 1)]


def _brute(seq: str, q: str, k: int, circular: bool):
    n, m = len(seq), len(q)
    hay = seq + seq[: m - 1] if circular else seq
    out = set()
    for strand, qq in ((1, q), (-1, reverse_complement(q))):
        if strand == -1 and qq == q:
            break
        for s in range(n if circular else n - m + 1):
            mism = sum(1 for i in range(m) if hay[s + i] not in SR._COVERS[qq[i]])
            if mism <= k:
                e = s + m
                out.add((s, e % n if e > n else e, strand))
    return out


@pytest.mark.parametrize("seed", range(6))
def test_mismatch_search_matches_brute_force(seed):
    rng = random.Random(seed)
    seq = "".join(rng.choice("ACGT") for _ in range(600))
    for k in (0, 1, 2, 3):
        q = seq[100:112] if seed % 2 else "".join(rng.choice("ACGTRY") for _ in range(10))
        circular = bool(seed % 3)
        got = set(_spans(SR.search_dna(_rec(seq, circular), q, k)))
        assert got == _brute(seq, q, k, circular)


def test_mismatch_counts_reported():
    rec = _rec("AAAAACGTACGTAAAAAAACGTTCGTAAAA", circular=False)
    hits = {h.start: h.mismatches for h in SR.search_dna(rec, "ACGTACGT", 1).hits}
    assert hits == {4: 0, 18: 1}


def test_bad_dna_queries():
    rec = _rec("ACGT" * 10)
    with pytest.raises(SequenceError):
        SR.search_dna(rec, "ACGX")
    with pytest.raises(SequenceError):
        SR.search_dna(rec, "ACG", 2)  # too short for 2 mismatches
    with pytest.raises(SequenceError):
        SR.search_dna(rec, "")


def test_hits_are_capped():
    res = SR.search_dna(_rec("A" * 3000, circular=False), "A")
    assert len(res.hits) == SR.MAX_HITS and res.truncated


# --------------------------------------------------------------------------
# Protein
# --------------------------------------------------------------------------

CDS = "ATGGCTAAAGGTTGGCACTAA"  # M A K G W H *


def test_protein_found_on_each_strand():
    rec = _rec("CC" + CDS + "GGGGG", circular=False)
    assert _spans(SR.search_protein(rec, "KGWH")) == [(8, 20, 1)]
    flipped = _rec("CCCCC" + reverse_complement(CDS) + "GG", circular=False)
    # The reverse strand reads CC + CDS + GGGGG, so KGWH is at 8-20 there;
    # on forward coordinates that's [n - 20, n - 8).
    n = flipped.length
    assert _spans(SR.search_protein(flipped, "KGWH")) == [(n - 20, n - 8, -1)]


def test_protein_x_wildcard_and_stop():
    rec = _rec("CC" + CDS + "GGGGG", circular=False)
    assert _spans(SR.search_protein(rec, "MXK")) == [(2, 11, 1)]
    assert _spans(SR.search_protein(rec, "WH*")) == [(14, 23, 1)]


def test_protein_across_the_origin():
    seq = CDS[9:] + "A" * 30 + CDS[:9]  # MAK at the end, GWH* from the start
    hits = _spans(SR.search_protein(_rec(seq), "AKGW"))
    assert (len(seq) - 6, 6, 1) in hits


def test_protein_in_a_spliced_cds():
    exon1, intron, exon2 = "ATGGCTAAAG", "GTAAGTCCCCCCCCCCAG", "GTTGGCACTAA"
    seq = "CCC" + exon1 + intron + exon2 + "CCC"
    a = 3
    b = a + len(exon1)
    c = b + len(intron)
    d = c + len(exon2)
    f = Feature(name="spl", type="CDS", start=a, end=d,
                segments=[Segment(start=a, end=b), Segment(start=c, end=d)])
    hits = SR.search_protein(_rec(seq, False, [f]), "KGWH").hits
    spliced = [h for h in hits if h.feature == "spl"]
    # KGWH is coding bases 6-17: 6-9 in exon 1, then 10-17 = exon 2's first 8.
    assert [(h.start, h.end, h.strand) for h in spliced] == [(a + 6, c + 8, 1)]


def test_bad_protein_query():
    with pytest.raises(SequenceError):
        SR.search_protein(_rec("ACGT" * 10), "MAK1")


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

@pytest.fixture
def client():
    store.clear()
    yield TestClient(app)
    store.clear()


def test_api_search(client):
    rec = client.post("/records", json={"name": "t", "sequence": "CC" + CDS + "GGGGG", "isCircular": False}).json()
    url = f"/records/{rec['id']}/search"
    dna = client.get(url, params={"query": "aaa ggt"}).json()
    assert dna["hits"][0]["start"] == 8 and not dna["truncated"]
    prot = client.get(url, params={"query": "kgwh", "kind": "protein"}).json()
    assert prot["hits"][0]["start"] == 8 and prot["hits"][0]["frame"] == 2
    assert client.get(url, params={"query": "ACGZ"}).status_code == 422
    assert client.get(url, params={"query": "ACG", "kind": "rna"}).status_code == 422
