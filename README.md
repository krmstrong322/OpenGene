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
pytest -q                              # 47 tests
uvicorn opengene.api:app --port 8000   # API + /docs

# Frontend (new terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

Open the app and click **Load demo**.

## What's implemented (Phase 1)

- **File I/O** — import GenBank, FASTA, EMBL, SnapGene `.dna`; export GenBank/FASTA/EMBL
- **Visualization** — synchronized circular + linear maps and a colored sequence
  view, with directional feature arrows, restriction cut sites, and
  origin-wrapping features
- **Editing** — insert / delete / mutate / replace / reverse-complement, with
  correct feature-coordinate maintenance and circular boundary wrap-around
- **ORF detection** across all 6 reading frames (including origin-crossing ORFs)
- **Restriction** — cut-site mapping, digest fragment sizes, unique cutters (NEB set)
- **Primers** — Tm / GC / hairpin / dimer analysis and PCR primer-pair design (primer3)
- **Auto-annotation** — pure-Python seed-and-extend matching against a bundled
  feature library (promoters, terminators, tags, resistance genes, fluorescent
  proteins; no replication origins yet) on both strands and across the origin;
  tolerates substitutions and indels, finds partial parts, and reports identity
  and coverage per hit

## Design decisions

These were chosen for this build (see the specification for the full menu):

| Area | Choice |
|------|--------|
| Map rendering | Custom SVG components (not OpenVectorEditor) for full control of sync + wrap-around |
| Feature matching | Pure-Python library matching; optional NCBI BLAST+ hook when `blastn` is on `PATH` |
| `.dna` files | Import-only (Biopython has no SnapGene writer); export via GenBank |

## Not in this phase

Phase 2 — the AI intent-parsing / function-calling layer (`insert_sequence_at_feature`,
`simulate_gibson_assembly`, etc.) — is intentionally out of scope here. The REST
API in `backend/` is exactly the deterministic tool surface those agents will call,
so the AI layer can be added without touching the engine. The intended wiring is a
LangChain tool layer with every LLM output passing through the engine's validation
before any state mutation.

## License

MIT
