"""Generate opengene/data/feature_library.json.

Combines two sources:

1. Canonical short regulatory elements and affinity/epitope tags (exact motifs
   that are standard across molecular biology).
2. Gene sequences extracted from public NCBI reference plasmids whose
   GenBank records are provided on the command line (so the stored sequences
   are verified against primary records rather than typed by hand).

Usage::

    python scripts/build_feature_library.py /path/to/refs/*.gb
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from Bio import SeqIO

# Canonical short parts — exact, well-established sequences.
CANONICAL: list[dict] = [
    # Promoters
    {"name": "T7 promoter", "type": "promoter", "sequence": "TAATACGACTCACTATAG"},
    {"name": "T3 promoter", "type": "promoter", "sequence": "AATTAACCCTCACTAAAGG"},
    {"name": "SP6 promoter", "type": "promoter", "sequence": "ATTTAGGTGACACTATAGAA"},
    {"name": "lac promoter", "type": "promoter",
     "sequence": "TTTACACTTTATGCTTCCGGCTCGTATGTTG"},
    # Operators / regulatory
    {"name": "lac operator", "type": "misc_feature",
     "sequence": "AATTGTGAGCGGATAACAATT"},
    {"name": "CAP binding site", "type": "misc_feature",
     "sequence": "AAATGTGATCTAGATCACATTT"},
    {"name": "RBS (Shine-Dalgarno)", "type": "RBS", "sequence": "AGGAGG"},
    {"name": "Kozak sequence", "type": "misc_feature", "sequence": "GCCACCATGG"},
    # Terminators
    {"name": "T7 terminator", "type": "terminator",
     "sequence": "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG"},
    {"name": "rrnB T1 terminator", "type": "terminator",
     "sequence": "AGAAGGCCATCCTGACGGATGGCCTTTTTGCGTTTCTACAAACTCTT"},
    # Affinity / epitope tags
    {"name": "6xHis tag", "type": "tag", "sequence": "CACCACCACCACCACCAC"},
    {"name": "6xHis tag", "type": "tag", "sequence": "CATCATCATCATCATCAT"},
    {"name": "FLAG tag", "type": "tag", "sequence": "GACTACAAGGACGACGACGACAAG"},
    {"name": "3xFLAG tag", "type": "tag",
     "sequence": "GACTACAAAGACCATGACGGTGATTATAAAGATCATGACATCGATTACAAGGATGACGATGACAAG"},
    {"name": "HA tag", "type": "tag", "sequence": "TACCCATACGATGTTCCAGATTACGCT"},
    {"name": "Myc tag", "type": "tag", "sequence": "GAACAAAAACTCATCTCAGAAGAGGATCTG"},
    {"name": "Strep-tag II", "type": "tag", "sequence": "TGGAGCCACCCGCAGTTCGAAAAA"},
    {"name": "V5 tag", "type": "tag",
     "sequence": "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG"},
    # Protease sites
    {"name": "TEV protease site", "type": "misc_feature",
     "sequence": "GAAAACCTGTATTTTCAGGGC"},
    {"name": "Thrombin site", "type": "misc_feature",
     "sequence": "CTGGTGCCGCGCGGCAGC"},
    {"name": "PreScission site", "type": "misc_feature",
     "sequence": "CTGGAAGTTCTGTTCCAGGGGCCC"},
    # Localization
    {"name": "SV40 NLS", "type": "misc_feature",
     "sequence": "CCAAAAAAGAAGAGAAAGGTA"},
    # Linkers
    {"name": "(GGGGS) linker", "type": "misc_feature",
     "sequence": "GGTGGCGGAGGTTCT"},
]

# Which GenBank features to extract. Each rule matches a needle as a
# whole word against the feature's ``gene`` and ``product`` qualifiers only
# (not free-text notes, which cross-reference other parts and cause false
# hits). ``max_len`` guards against whole-region annotations.
EXTRACT_RULES = [
    # needle, genbank type, library name, library type, max_len
    ("bla", "CDS", "AmpR (bla)", "CDS", 1200),
    ("beta-lactamase", "CDS", "AmpR (bla)", "CDS", 1200),
    ("neomycin phosphotransferase", "CDS", "KanR / NeoR", "CDS", 1200),
    ("egfp", "CDS", "EGFP", "CDS", 900),
    ("enhanced green fluorescent protein", "CDS", "EGFP", "CDS", 900),
    ("mcherry", "CDS", "mCherry", "CDS", 900),
    ("monomeric red fluorescent protein", "CDS", "mCherry", "CDS", 900),
    ("tetracycline resistance protein", "CDS", "TetR (tet)", "CDS", 1400),
    ("rop protein", "CDS", "rop / rom", "CDS", 400),
    ("p15a origin of replication", "rep_origin", "p15A ori", "origin", 1200),
]


def _match_tokens(feature) -> list[str]:
    """Return lowercased gene/product qualifier strings for word matching."""
    vals: list[str] = []
    for key in ("gene", "product"):
        for v in feature.qualifiers.get(key, []):
            vals.append(v.lower())
    return vals


def _whole_word(needle: str, text: str) -> bool:
    import re
    return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", text) is not None


def extract_from_refs(paths: list[Path]) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for path in paths:
        try:
            records = list(SeqIO.parse(str(path), "genbank"))
        except Exception:
            continue
        for rec in records:
            for feat in rec.features:
                tokens = _match_tokens(feat)
                for needle, ftype, libname, libtype, max_len in EXTRACT_RULES:
                    if feat.type != ftype:
                        continue
                    if not any(_whole_word(needle, t) for t in tokens):
                        continue
                    seq = str(feat.extract(rec.seq)).upper()
                    if not (60 <= len(seq) <= max_len):
                        continue
                    key = (libname, seq)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append({
                        "name": libname,
                        "type": libtype,
                        "sequence": seq,
                        "source": rec.id,
                    })
    return out


def load_derived_origins() -> list[dict]:
    """Replication origins recovered from verified vector sequences by
    cross-plasmid conservation (see derived_origins.json for per-origin
    provenance). Kept as data rather than re-derived here, since the
    derivation needs several reference genomes; the `provenance` field is
    dropped from the library (it is documentation, not match data)."""
    path = Path(__file__).resolve().parent / "derived_origins.json"
    if not path.exists():
        return []
    entries = json.loads(path.read_text())
    return [
        {"name": e["name"], "type": e["type"], "sequence": e["sequence"],
         "source": e.get("source", "derived")}
        for e in entries
    ]


def main(argv: list[str]) -> int:
    refs = [Path(p) for p in argv[1:]]
    library = [dict(e) for e in CANONICAL]
    for e in library:
        e.setdefault("source", "canonical")
    library.extend(extract_from_refs(refs))
    library.extend(load_derived_origins())

    out_path = Path(__file__).resolve().parent.parent / "opengene" / "data" / "feature_library.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(library, indent=2) + "\n")
    print(f"wrote {len(library)} features to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
