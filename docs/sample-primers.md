# Example primers for the sample plasmids

A primer pair for each bundled sample ([`backend/opengene/data/samples/`](../backend/opengene/data/samples/)),
for exercising the **Primers** tab. Every pair here was produced by OpenGene's
own designer over the named feature, so selecting that feature and clicking
**Design primers for …** reproduces it, and pasting either oligo into
**Analyze an oligo** reports the Tm and GC shown below.

Coordinates are 0-indexed, half-open. Tm is the primer3 nearest-neighbour value
at the default 60 °C target; the product is the length of the amplified feature.

| Plasmid | Target feature | Primer | Sequence (5'→3') | Tm | GC | Binds | Product |
|---------|----------------|--------|------------------|----|----|-------|---------|
| pET-demo (T7/His/GFP) | EGFP | Fwd | `ATGGTGAGCAAGGGCGAGG` | 62.3 °C | 63% | 144–163 | 720 bp |
| | | Rev | `TTACTTGTACAGCTCGTCCATGC` | 60.9 °C | 48% | 841–864 | |
| pUC19 | AmpR (bla) | Fwd | `TTACCAATGCTTAATCAGTGAGGCA` | 60.8 °C | 40% | 1625–1650 | 861 bp |
| | | Rev | `ATGAGTATTCAACATTTCCGTGTCGC` | 62.3 °C | 42% | 2460–2486 | |
| pBR322 | TetR (tet) | Fwd | `ATGAAATCTAACAATGCGCTCATCG` | 60.6 °C | 40% | 85–110 | 1191 bp |
| | | Rev | `TCAGGTCGAGGTGGCCCG` | 63.8 °C | 72% | 1258–1276 | |
| pACYC184 | p15A ori | Fwd | `GCGCTAGCGGAGTGTATACTG` | 60.7 °C | 57% | 580–601 | 913 bp |
| | | Rev | `ACAACTTATATCGTATGGGGCTGAC` | 60.5 °C | 44% | 1468–1493 | |
| pEGFP-N1 | EGFP | Fwd | `ATGGTGAGCAAGGGCGAGG` | 62.3 °C | 63% | 678–697 | 720 bp |
| | | Rev | `TTACTTGTACAGCTCGTCCATGC` | 60.9 °C | 48% | 1375–1398 | |
| pBluescript II SK(+) | f1 ori | Fwd | `AAATTGTAAGCGTTAATATTTTGTTAAAAT` | 55.5 °C | 17% | 2–32 | 457 bp |
| | | Rev | `GACGCGCCCTGTAGCGGC` | 66.4 °C | 78% | 441–459 | |
| pGEX-4T-1 | GST | Fwd | `ATGTCCCCTATACTAGGTTATTGGAAAATT` | 60.4 °C | 33% | 257–287 | 720 bp |
| | | Rev | `TCAGTCACGATGCGGCCG` | 62.8 °C | 67% | 959–977 | |
| EGFP CDS (linear) | EGFP | Fwd | `ATGGTGAGCAAGGGCGAGG` | 62.3 °C | 63% | 0–19 | 720 bp |
| | | Rev | `TTACTTGTACAGCTCGTCCATGC` | 60.9 °C | 48% | 697–720 | |

## Primers that trip the warnings

The **Analyze an oligo** box flags primers outside the usual design window. These
all raise at least one warning, so they're useful for checking that path:

| Oligo | Sequence | Reported issues |
|-------|----------|-----------------|
| EGFP forward (above) | `ATGGTGAGCAAGGGCGAGG` | GC 63% (>60%); GC clamp too strong (≥4 G/C in last 5 nt); hairpin |
| pBluescript f1 forward | `AAATTGTAAGCGTTAATATTTTGTTAAAAT` | 30 nt long and GC 17% (<40%): a weak, AT-rich end of the f1 origin |
| pBR322 tet reverse | `TCAGGTCGAGGTGGCCCG` | GC 72% (>60%) |

The f1-ori and GST forward primers above are also deliberately imperfect: those
features start in AT-rich sequence, so the designer returns the best primer it
can and the Tm/GC sit outside the ideal band — a realistic case to inspect.
