# OpenGene Frontend

React 18 + TypeScript interface for the OpenGene plasmid engine (Phase 1 UI).
Custom SVG rendering — no heavyweight editor dependency.

## Stack

- **React 18 + TypeScript**, built with **Vite**
- Custom **SVG** circular map, linear map, and sequence viewer (no OpenVectorEditor)
- No runtime state library — React hooks + a shared `Selection` drive view sync

## Run

The frontend talks to the backend through a dev proxy (`/api` → `http://localhost:8000`).

```bash
# 1) start the backend (see ../backend/README.md)
cd ../backend && . .venv/bin/activate && uvicorn opengene.api:app --port 8000

# 2) start the frontend
cd ../frontend
npm install
npm run dev          # http://localhost:5173

npm run build        # type-check + production build to dist/
```

Click **Load demo** on the empty state for a T7 · 6×His · TEV · EGFP · T7-terminator
construct that exercises the maps, annotation, and sequence view.

## Layout

```
Toolbar            new / import (.gb/.fasta/.embl/.dna) / export (GenBank, FASTA)
┌───────────────────────────┬──────────────────────┐
│ Circular map (SVG)        │  Edit panel (tabs):   │
│ Linear map (SVG)          │   • Edit   insert / delete / mutate / revcomp
│ Sequence viewer           │   • Features  auto-annotate, add, list
│                           │   • ORFs   6-frame detection
│                           │   • Enzymes  cut-site map & digest
│                           │   • Primers  design pair / analyze oligo
└───────────────────────────┴──────────────────────┘
```

All three views share one `Selection`, so hovering or selecting a feature in any
view highlights it in the others. The maps render directional arrows, stacked
lanes/rings for overlapping features, restriction cut sites, and origin-wrapping
features (e.g. a terminator shown as `871–0`).

## Components

| File | Role |
|------|------|
| `lib/types.ts` | TypeScript mirror of the backend models |
| `lib/api.ts` | Typed REST client |
| `lib/geometry.ts` | Polar / SVG-arc math for the circular map (directional, wrap-aware) |
| `components/CircularMap.tsx` | Circular plasmid map |
| `components/LinearMap.tsx` | Linear feature track with lanes |
| `components/SequenceViewer.tsx` | Colored sequence with click/shift-click selection |
| `components/EditPanel.tsx` | Tabbed editing + analysis panel |
| `components/Toolbar.tsx` | File I/O and record creation |
