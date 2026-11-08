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

The library starts with the bundled sample plasmids (served by the backend; see
`backend/opengene/data/samples/`). **Add samples** on the start screen restores
any you've deleted. *pET-demo* is a small T7 · 6×His · TEV · EGFP · T7-terminator
construct that exercises the maps, annotation, and sequence view.

## Layout

```
Title bar     Library / record name · undo/redo · new / import / export ▾ · theme
┌───────────────────────────┬──────────────────────┐
│ Map (SVG)                 │  Inspector (tabs):    │
│   overlay toggles, legend │   • Edit   insert / delete / mutate / revcomp
│ Linear view (SVG)         │   • Features  auto-annotate, list, add
│ Sequence viewer           │   • ORFs   6-frame detection
│                           │   • Enzymes  cut-site map & digest
│                           │   • Primers  design pair / analyze oligo
└───────────────────────────┴──────────────────────┘
Status bar    engine status · length · features · GC% · current selection
```

All three views share one `Selection`, so hovering or selecting a feature in any
view highlights it in the others. The maps render directional arrows, stacked
lanes/rings for overlapping features, labelled features with leader lines,
restriction cut sites, and origin-wrapping features (e.g. a terminator shown as
`871–0`).

## Design system

`src/styles.css` defines the look as CSS custom properties (colors, radii,
spacing) with a light and a dark set. The layout is a docked workbench: a
title bar, full-height panes separated by hairlines, an inspector docked on
the right, and a status bar. Controls are neutral; the accent color is kept
for the primary action in a section and the active tab. The theme follows the
OS by default; the title bar's appearance menu overrides it (stored in
`localStorage`, see `lib/theme.ts`). SVG maps take their neutral colors from
the same tokens via classes, so they switch themes too. IBM Plex Sans and Plex
Mono are bundled with `@fontsource` (no network needed, so they work in the
desktop app), and icons come from `lucide-react`.

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
| `components/Toolbar.tsx` | Title bar: breadcrumb, undo/redo, import/export, theme |
| `components/RecordLibrary.tsx` | Start screen: sortable, filterable table of saved plasmids |
| `components/NewRecordDialog.tsx` | Modal for creating a record from pasted DNA |
| `lib/theme.ts` | Light / dark / system theme preference |
