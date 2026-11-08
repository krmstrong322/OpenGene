# Sample plasmids

These files ship inside the engine. A new OpenGene library is seeded with them
the first time the app starts (once per data folder, so samples you delete stay
deleted), and **Add sample plasmids** on the Library screen brings back any
that are missing. They're also handy test data: download any of them and use
**Import…** in the app.

`samples.json` lists each file with its library name and how it is annotated.
On import the app replaces NCBI's own annotations, which are uneven (pBR322
carries dozens of "conflict" / "old_sequence" notes; pUC19 has none), with its
auto-annotation from the feature library. Where the library doesn't know a part,
the manifest's `keep` list carries that feature over from the file under a
short name (GST, tac promoter, thrombin site and lacIq in pGEX-4T-1).

| File | Library name | Size | Topology | Source | Good for testing |
|------|--------------|------|----------|--------|------------------|
| `pET-demo.fasta` | pET-demo (T7/His/GFP) | 919 bp | circular | synthetic | small construct with many short parts |
| `pUC19_L09137.gb` | pUC19 | 2,686 bp | circular | GenBank [L09137](https://www.ncbi.nlm.nih.gov/nuccore/L09137) | a record with no annotations of its own |
| `pBR322_J01749.gb` | pBR322 | 4,361 bp | circular | GenBank [J01749](https://www.ncbi.nlm.nih.gov/nuccore/J01749) | a heavily annotated record (48 NCBI features) |
| `pACYC184_X06403.gb` | pACYC184 | 4,245 bp | circular | GenBank [X06403](https://www.ncbi.nlm.nih.gov/nuccore/X06403) | the p15A origin (not ColE1) |
| `pEGFP-N1_U55762.gb` | pEGFP-N1 | 4,733 bp | circular | GenBank [U55762](https://www.ncbi.nlm.nih.gov/nuccore/U55762) | overlapping features, several origins |
| `pBluescriptII-SK_X52328.gb` | pBluescript II SK(+) | 2,961 bp | circular | GenBank [X52328](https://www.ncbi.nlm.nih.gov/nuccore/X52328) | T7/T3 promoters, f1 origin |
| `pGEX-4T-1_U13853.gb` | pGEX-4T-1 | 4,969 bp | circular | GenBank [U13853](https://www.ncbi.nlm.nih.gov/nuccore/U13853) | features carried over from the file |
| `EGFP_CDS.fasta` | EGFP CDS (linear) | 720 bp | linear | bases 679–1398 of U55762 | linear records, FASTA import |

## Provenance

The `.gb` files are unmodified GenBank records downloaded from NCBI; GenBank
data are freely redistributable. `EGFP_CDS.fasta` is the `egfp` CDS cut from
the pEGFP-N1 record. `pET-demo.fasta` is a synthetic construct assembled from
public parts for this project (it was previously the hard-coded demo in the
frontend).

The four records also serve as ground truth for the auto-annotation tests
(`backend/tests/test_annotation_fixtures.py`), and `backend/tests/test_samples.py`
checks that every sample loads.

## Adding a sample

1. Put the file (GenBank, FASTA, EMBL or SnapGene `.dna`) in this folder.
2. Add an entry to `samples.json`: `file`, `name` (unique; it's how
   **Add sample plasmids** tells which are missing), `description`, and
   optionally `circular` (FASTA has no topology) and `keep`
   (`{"from": "<feature name in the file>", "name": "<short name>", "type": "CDS"}`).
3. Run `pytest -q` in `backend/`.

Existing libraries won't receive a new sample automatically, because seeding
happens once; users get it from **Add sample plasmids**.
