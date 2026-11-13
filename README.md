# OpenGene

An open-source, AI-native plasmid editor — a free alternative to SnapGene.

This repository implements **Phase 1** of the OpenBioMap specification: a
deterministic sequence-editing engine with a REST API, and a React/TypeScript
canvas that renders synchronized circular and linear plasmid maps.

> **Architecture principle — the Sequence Invariant.** All biological sequence
> manipulation is handled by deterministic Python backend services and validated
> through Biopython. The UI (and, in Phase 2, any AI layer) only ever issues
> structured operations against that engine; no component edits raw sequence
> strings directly.

![OpenGene editor](docs/screenshot.png)

## Repository layout

```
backend/    FastAPI + Biopython engine, feature library, tests   (see backend/README.md)
frontend/   React 18 + TypeScript, custom-SVG maps               (see frontend/README.md)
desktop/    Electron app — double-click install for labs         (see desktop/README.md)
```

## For non-technical lab users (desktop app)

Scientists don't need Python, Node, or a terminal. The `desktop/` package builds
a signed-ready **macOS `.dmg`** and **Windows `.exe`** that bundle the engine and
UI into one double-click app; plasmids persist locally in SQLite. Installers are
produced by GitHub Actions (`.github/workflows/desktop-build.yml`) — push a `v*`
tag and download the artifacts. End-user steps are in [docs/INSTALL.md](docs/INSTALL.md);
build/signing details in [desktop/README.md](desktop/README.md).

## Quick start

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest -q
uvicorn opengene.api:app --port 8000   # API + /docs

# Frontend (new terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

Before opening a pull request, run what CI runs (`.github/workflows/ci.yml`):

```bash
cd backend  && pytest -q
cd frontend && npm run check           # lint, type-check + build, unit tests
cd frontend && npm run e2e             # end-to-end, in a browser
```

Open the app: the library starts with eight sample plasmids (pUC19, pBR322,
pEGFP-N1, pGEX-4T-1 and others). They live in
[`backend/opengene/data/samples/`](backend/opengene/data/samples/), which also
makes them handy test files to import.

## What's implemented (Phase 1)

- **File I/O** — import and export GenBank, FASTA, EMBL and SnapGene `.dna`; open Sanger
  traces (ABI `.ab1`/`.abi`, SCF v2/v3 `.scf`).
  Multi-part features (`join(...)`, e.g. exons) keep their parts, origin-spanning
  joins stay one wrapping feature, every GenBank feature key (`gene`, `exon`,
  `polyA_signal`, `regulatory` …) and repeated qualifier (several `/note`s) survives
  an import/export round trip. Sequences may contain IUPAC ambiguity codes
  (R, Y, S, W, K, M, B, D, H, V, N)
- **Visualization** — synchronized circular + linear maps and a colored sequence
  view, with directional feature arrows, restriction cut sites, and
  origin-wrapping features
- **Sequence view** — both strands, translations under every CDS (minus-strand and
  spliced CDSs included), feature bars and enzyme cut sites on each line; click for a
  cursor, drag / shift-click / shift-arrows to select; type bases at the cursor or over
  a selection; copy, copy reverse complement, paste (inserts or replaces through the
  engine), delete; right-click for a menu (new feature from selection, design primers,
  edit or remove a feature); the selection shows length,
  GC, Tm, molecular weight and its translation (a selected feature is translated on its
  own strand). Only on-screen lines are drawn, so 100 kb+ constructs stay responsive
- **Chromatograms** — a trace opens as a linear read with its four channels, base calls,
  quality bars and low-quality (<Q20) shading; zoom, peak height, click/drag to select
  in step with the other views. Correcting calls, inserts, deletes and
  reverse-complement keep the trace aligned (the trace flips with the read)
- **Map images** — save the circular or linear map as SVG (fonts embedded), PNG (3×) or
  vector PDF, or print it; exports always use the light theme and leave out the
  current selection
- **Find** (Ctrl/⌘+F) — DNA on both strands and across the origin, with IUPAC codes and
  up to 3 mismatches; protein in all six frames and through spliced CDSs (`X` = any);
  feature and primer names; go to a position. Hits are marked in the sequence view and
  stepped through with Enter / Shift+Enter
- **Editing** — insert / delete / mutate / replace / reverse-complement, with
  correct feature-coordinate maintenance and circular boundary wrap-around
- **Records** — rename, switch between circular and linear (refused while a feature
  spans the origin), duplicate; drag-and-drop or multi-file import; the last open record
  reopens on launch
- **Reading frame** — an edit that shifts a CDS's frame is applied with a warning by
  default; the Edit tab can instead block such edits or pad inserts with N
- **Undo / redo** — every edit is reversible (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z);
  the full record state steps back and forth, and a rejected edit is a no-op
- **Feature editing** — edit an existing feature's name, type, strand,
  coordinates, and color inline (not just add / delete)
- **Map overlays** — toggle designed primers and 6-frame ORFs as directional
  tracks on both the circular and linear maps
- **ORF detection** across all 6 reading frames (including origin-crossing ORFs)
- **Restriction** — an enzyme picker over the commercial catalog (search, filter by
  supplier, ready-made sets: unique cutters, unique + 2-cutters, 6+ bp, blunt), digest
  fragment sizes, the overhang (5′/3′/blunt and its bases) at each cut site, and a flag
  where a site overlaps a Dam/Dcm/CpG methylation motif
- **Primers** — Tm / GC / hairpin / dimer analysis and PCR primer-pair design (primer3).
  Primers are saved with their sequence and listed under it in the library; their binding
  sites are re-located after every edit (a primer with a 5′ tail binds by its 3′ end), and
  they can be imported and exported as CSV or FASTA
- **Auto-annotation** — pure-Python seed-and-extend matching against a bundled
  feature library (promoters, terminators, tags, resistance genes, fluorescent
  proteins, and replication origins — ColE1/pUC, f1, SV40, p15A) on both strands
  and across the origin;
  tolerates substitutions and indels, finds partial parts, and reports identity
  and coverage per hit

## Design decisions

These were chosen for this build (see the specification for the full menu):

| Area | Choice |
|------|--------|
| Map rendering | Custom SVG components (not OpenVectorEditor) for full control of sync + wrap-around |
| Feature matching | Pure-Python library matching; optional NCBI BLAST+ hook when `blastn` is on `PATH` |
| `.dna` files | Read with Biopython's reader (plus feature colors); written by OpenGene's own packet writer (`backend/opengene/io/snapgene.py`) |

## Not in this phase

Phase 2 — the AI intent-parsing / function-calling layer (`insert_sequence_at_feature`,
`simulate_gibson_assembly`, etc.) — is intentionally out of scope here. The REST
API in `backend/` is exactly the deterministic tool surface those agents will call,
so the AI layer can be added without touching the engine. The intended wiring is a
LangChain tool layer with every LLM output passing through the engine's validation
before any state mutation.

## License

MIT
