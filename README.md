# OpenGene

**A free, open-source plasmid viewer and editor.** Open and edit GenBank, FASTA,
EMBL and SnapGene files, view synchronized circular and linear maps, design and
save primers, plan restriction digests, and read Sanger traces — all on your own
computer, with nothing uploaded.

![The OpenGene editor showing a circular map, the sequence view and the inspector](docs/screenshot.png)

OpenGene runs entirely on your machine. Your plasmids are saved locally; there is
no account and no server.

## Contents

- [Install](#install)
- [A quick tour](#a-quick-tour)
- [Features](#features)
- [Build from source](#build-from-source)
- [How it works](#how-it-works)
- [Roadmap and contributing](#roadmap-and-contributing)
- [License](#license)

## Install

### Desktop app (recommended)

No Python, Node, or terminal needed — download one file and open it.

1. Go to the [**Releases**](https://github.com/krmstrong322/OpenGene/releases) page.
2. Download the file for your system:
   - **macOS (Apple Silicon)**: `OpenGene-x.y.z-arm64.dmg`
   - **macOS (Intel)**: `OpenGene-x.y.z-x64.dmg`
   - **Windows**: `OpenGene Setup x.y.z.exe`
3. Open it. Step-by-step instructions, including the one-time "unidentified
   developer" prompt on each OS, are in [docs/INSTALL.md](docs/INSTALL.md).

The app opens with a few sample plasmids to explore. Everything you do is saved
on your computer automatically.

> The installers are not yet code-signed, so your OS shows a one-time warning the
> first time you open the app. [docs/INSTALL.md](docs/INSTALL.md) explains how to
> get past it.

### Run in a browser (for developers)

See [Build from source](#build-from-source).

## A quick tour

These short tours use the bundled sample plasmids. If your library is empty,
click **Add samples** on the start screen.

### 1. Open a plasmid and look around

1. Click **pUC19** in the library.
2. The workspace shows three linked views: the **circular map**, the **linear
   map**, and the **sequence** below them. Hover a feature in any view and it
   highlights in the others.
3. Zoom a map with **Ctrl/⌘ + scroll** (or the − / + buttons in its corner), and
   drag to pan. Drag the divider between the maps and the sequence to resize them,
   or use the **Map / Linear / Sequence** toggles in the title bar to hide a view.
4. Press **Ctrl/⌘ + F**, type `GAATTC`, and press Enter to jump to the EcoRI
   site. The find bar also searches protein (all six frames) and feature names.

### 2. Plan a restriction digest

1. With pUC19 open, select the **Enzymes** tab on the right.
2. Click **Unique cutters** to pick every enzyme that cuts pUC19 exactly once.
   Their sites appear on both maps and in the sequence view.
3. Click **Digest** to see the fragment sizes. Each site also shows its overhang
   (5′, 3′ or blunt) and flags any overlap with a Dam/Dcm methylation motif.

### 3. Design a pair of primers

1. Open **pGEX-4T-1** and select the **Features** tab.
2. Click the **GST** feature to select its coding region in every view.
3. Switch to the **Primers** tab and click **Amplify exactly**. OpenGene hands
   the region to primer3, which scores candidate primers on Tm, GC, 3′ stability,
   hairpins and dimers, and saves the best forward/reverse pair.
4. The pair is listed with its Tm, GC and binding site. If no pair meets the
   usual criteria, the best available one is saved and flagged with what's wrong.

### 4. Save and reuse your own primers

1. In the **Primers** tab, type a name and a sequence (for example the M13
   forward primer `GTAAAACGACGGCCAGT`) and click **Save primer** — or **Check** to
   see its Tm and warnings without saving.
2. Saved primers stay with the sequence and follow it through edits: insert a few
   bases upstream and the binding site moves with it. A primer whose site you edit
   away is kept in the list, marked "doesn't bind", until it matches again.
3. Back on the library screen, the twisty beside each sequence opens it out to its
   primers. Click a primer there to open its sequence with the binding site
   selected. **Import** a list (FASTA or `name, sequence` per line) or **Export**
   to CSV or FASTA.

### 5. Annotate an unknown sequence

1. Import a plasmid with no annotations — `pUC19_L09137.gb` from
   [`backend/opengene/data/samples/`](backend/opengene/data/samples/) is a good
   test — using **Import…**.
2. In the **Features** tab, click **Auto-annotate**. OpenGene matches the sequence
   against a bundled library of promoters, terminators, tags, resistance genes,
   fluorescent proteins and origins, tolerating substitutions and indels, and
   reports the identity and coverage of each hit.

### 6. Edit, then export

1. Click in the sequence to place the cursor and **type** bases to insert them, or
   select a range and type to replace it. Right-click a selection for a menu (new
   feature, design primers, copy, delete). Everything is reversible — the
   **History** tab lists every change, and **Ctrl/⌘ + Z** steps back.
2. Save a map as an image from the **Image** menu above it (SVG, PNG or PDF), or
   **Export** the record as GenBank, FASTA, EMBL or SnapGene `.dna` from the title
   bar.

## Features

**Files**
- Import and export GenBank, FASTA, EMBL and SnapGene `.dna`.
- Open Sanger traces (ABI `.ab1`/`.abi`, SCF v2/v3 `.scf`) as chromatograms.
- Multi-part features (`join(...)`, e.g. exons), origin-spanning features, every
  GenBank feature key and repeated qualifiers all survive an import/export round
  trip. IUPAC ambiguity codes (R, Y, S, W, …) are supported throughout.
- Drag and drop files onto the window, or import several at once.

**Viewing**
- Synchronized circular and linear maps and a colored sequence view, all sharing
  one selection, with directional feature arrows, stacked lanes for overlapping
  features, restriction cut sites and origin-wrapping features.
- Zoom and pan both maps; the sequence view draws only on-screen lines, so
  100 kb+ constructs stay responsive.
- The sequence view shows both strands, translations under every CDS, feature
  bars and enzyme sites per line. A selection reports its length, GC, Tm,
  molecular weight and translation.
- Save maps as SVG, PNG (3×) or vector PDF, or print them.
- Light and dark themes, following the OS or set explicitly.

**Editing**
- Type to insert or replace bases directly in the sequence; insert, delete,
  mutate, replace and reverse-complement, with feature coordinates maintained and
  circular wrap-around handled.
- Edit a feature's name, type, strand, coordinates and color; add features from a
  selection.
- A reading-frame guard warns about (or blocks, or N-pads) an edit that would
  shift a CDS's frame — your choice, remembered.
- Full undo/redo with a history list; rename, duplicate, and switch records
  between circular and linear.

**Analysis**
- **Find** DNA (both strands, across the origin, up to 3 mismatches, IUPAC
  codes), protein in all six frames, and feature or primer names.
- **Restriction**: an enzyme picker over the commercial catalog (search, filter
  by supplier, ready-made sets), digest fragment sizes, per-site overhangs, and
  methylation flags.
- **Primers**: Tm / GC / hairpin / dimer analysis, and primer3-backed pair design
  (amplify exactly or across a region). Primers are saved with their sequence,
  re-located after every edit, and importable/exportable as CSV or FASTA.
- **ORF detection** across all six reading frames, including origin-crossing ORFs.
- **Auto-annotation** against a bundled feature library, tolerant of mismatches
  and indels, with an optional NCBI BLAST+ hook when `blastn` is on `PATH`.
- **Chromatograms**: four channels, base calls, quality bars and low-quality
  shading, kept aligned to the read through edits.

## Build from source

OpenGene is a Python engine (FastAPI + Biopython) and a React/TypeScript
frontend. The desktop app bundles both; you can also run them directly.

```bash
# Engine (terminal 1)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn opengene.api:app --port 8000      # API + /docs

# Frontend (terminal 2)
cd frontend
npm install
npm run dev                               # http://localhost:5173
```

Component docs: [`backend/README.md`](backend/README.md),
[`frontend/README.md`](frontend/README.md),
[`desktop/README.md`](desktop/README.md). Sample plasmids and how to add more:
[`backend/opengene/data/samples/README.md`](backend/opengene/data/samples/README.md).

Before opening a pull request, run what CI runs:

```bash
cd backend  && pytest -q
cd frontend && npm run check              # lint, type-check + build, unit tests
cd frontend && npm run e2e                # end-to-end, in a browser
```

The desktop installers are built by GitHub Actions
(`.github/workflows/desktop-build.yml`) when a `v*` tag is pushed.

## How it works

All sequence manipulation goes through the deterministic Python engine, which
validates every operation with Biopython. The interface never edits raw sequence
strings directly; it issues structured operations (insert, delete, annotate,
design primers, …) against the engine, which keeps features, primers and traces
consistent. The REST API is that same operation surface, so new tools — including
the planned AI assistant ([#17](https://github.com/krmstrong322/OpenGene/issues/17))
— can be built on it without touching the core.

Maps are custom SVG components (for full control of synchronization and
origin wrap-around), and SnapGene `.dna` files are read with Biopython and
written by OpenGene's own packet writer.

## Roadmap and contributing

Planned work is tracked in the [**Roadmap**
(#14)](https://github.com/krmstrong322/OpenGene/issues/14) and its linked issues —
cloning simulation, Sanger alignment, an AI assistant, and more. Comment on an
item you care about, or [open an
issue](https://github.com/krmstrong322/OpenGene/issues/new) to report a bug or
suggest a feature. Pull requests are welcome; run the checks above first.

## License

[MIT](LICENSE).
