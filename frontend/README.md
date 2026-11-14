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

## Checks

```bash
npm run lint         # ESLint: TypeScript + React Hooks rules
npm run build        # type-check + production build
npm test             # unit and component tests (Vitest; src/**/*.test.ts[x])
npm run check        # the three above, as CI's frontend job runs them
npm run e2e          # end-to-end: the real UI against the real engine (Playwright)
```

`npm run e2e` starts the engine and the dev server itself (the backend must be
installed: `pip install -e ../backend`), gives the engine a throwaway library,
and drives a browser through the main flows in `e2e/`. Run
`npx playwright install chromium` once if Playwright has no browser yet.
Unit tests cover the logic in `src/lib` (coordinates, selection, edit
helpers, sequence-view layout, map keyboard control); component tests cover the
context menu, splitter, zoom controls and history tab. `.github/workflows/ci.yml`
runs all of it, plus the backend suite, on every pull request.

## Layout

```
Title bar     Library / record name · view toggles (Map | Linear | Sequence) · undo/redo · new / import / export ▾ · theme
┌──────────────────┬──────────────────┬──────────────────────┐
│ Map (SVG)        ║ Sequence viewer  │  Inspector (tabs):    │
│   overlays,      ║                  │   • Edit   insert / delete / mutate / revcomp
│   legend         ║                  │   • Features  auto-annotate, list, add
│──────────────────║                  │   • ORFs   6-frame detection
│ Linear view      ║                  │   • Enzymes  cut-site map & digest
│                  ║                  │   • Primers  design pair / analyze oligo
└──────────────────┴──────────────────┴──────────────────────┘
Status bar    engine status · length · features · GC% · current selection
```

The workspace never scrolls as a whole: the maps and the sequence sit side by
side (stacked when the window is narrow), each scrolling inside its own pane,
with a draggable divider (`║`) between them — arrow keys nudge it, double-click
resets it. The title-bar toggles show or hide each view. The divider position
and open views are remembered in `localStorage` (`lib/layout.ts`). Below 860 px
the app falls back to a single scrolling column.

All three views share one `Selection`, so hovering or selecting a feature in any
view highlights it in the others and scrolls the sequence to it. The maps render
directional arrows, stacked lanes/rings for overlapping features, labelled
features with leader lines, restriction cut sites, and origin-wrapping features.

**Zoom and pan.** Both maps zoom with Ctrl/⌘ + scroll (which is also a
trackpad pinch) about the pointer, or with the − / + / fit buttons in the map's
corner, and pan by dragging; a drag never counts as a click on a feature. The
linear map zooms up to 12 px per base, scrolls sideways, re-spaces its ruler
for the zoom, and brings a selection made elsewhere into view. The circular
map magnifies the drawing up to 8× while holding text at its normal size, so
zooming separates crowded labels. Zoom resets when another record is opened.
A map image is exported as shown (the linear map in full at its current zoom,
the circular map's visible area).

**Map labels.** On the linear map enzyme names sit above the axis, in as many
rows as they need (up to eight; a site that still can't be named keeps its
mark and tooltip), and the ruler's numbers sit below it, so the two can't
collide. The circular map names cut sites only up to 40 of them.

**Designing a pair.** "Amplify exactly" (the product is the selection) and
"amplify across" (the product contains it; primers may sit outside) both call
primer3's own pair designer, which scores Tm, GC, 3′ stability, hairpins,
self-dimers and cross-dimers. When nothing meets the usual limits the best
available pair is returned with warnings. Each saved primer shows its own
quality warnings and, for a 5′-tailed primer, the melting temperature of the
part that anneals (`annealTm`) alongside the whole-oligo Tm.

**Saved primers.** A primer is an oligo saved with a sequence: its name and
bases are the user's, and where it binds is looked up by the engine after
every edit (the whole oligo first, then its 3′ end, so a 5′ tail doesn't stop
it binding). Primers are never dropped: one whose site moves follows it, one
whose site is edited away stays in the list as "doesn't bind". The Primers tab
lists them with Tm, GC and site, and adds, edits, removes, imports (FASTA or
one `name, sequence` per line) and exports (CSV, FASTA) them; all of it is
undoable. `lib/primers.ts` words the binding for display.

**Library tree.** The library lists each sequence with a twisty that opens it
out to its primers. A primer row opens the sequence at that primer's site. The
filter matches sequence names, primer names and primer bases; which sequences
are opened out is remembered. Every primer in the library can be exported to
one file.

**Records.** The open record's name in the title bar is editable in place;
the menu beside it changes topology (circular ↔ linear) and duplicates the
record. Rename and topology changes are undoable. Files dropped anywhere on the
window are imported — one file opens, several go to the library — and the
import button accepts several files too. The record that was open is reopened
on the next launch (`opengene.lastRecord` in `localStorage`).

**Keyboard.** Everything reachable with the mouse is reachable without it.
Library rows are buttons (Enter opens) and the column headers sort. Each map is
one tab stop: the arrow keys step through its features in sequence order
(Home / End for the first and last), Enter or the menu key opens the selected
feature's menu, and + / − / 0 zoom (`lib/mapKeys.ts`). The inspector's tabs
follow the usual tab pattern (arrow keys move between them). The status bar's
selection read-out is a live region, so each selection is announced with the
feature's name.

**History.** The inspector's History tab lists every change that can be
undone, newest first, with any warning the engine raised, and has Undo / Redo
buttons. After undo or redo the cursor returns to where the sequence changed.

**Messages.** One toast at a time: errors stay until dismissed; engine
warnings (a frameshift that was allowed, primers dropped) and confirmations
clear themselves. Actions that leave no visible trace confirm themselves
("Copied 720 bases", "Added 3 features from the feature library").

**Direct editing.** With a cursor in the sequence view, typing a base
(A/C/G/T or an IUPAC code) inserts it; typed over a selection it replaces the
selection. Keystrokes are buffered and sent to the engine in order, so each
burst of typing is one undo step. Right-click in the sequence view, or on a
feature in any view, for a menu: copy / copy reverse complement / paste /
delete, *New feature from selection…*, *Design primers for selection*, and for
a feature *Edit feature…* / *Remove feature*. The menu items that belong to the
inspector are sent to it as an `InspectorCommand`, which opens the right tab.
The shared edit helpers live in `lib/edits.ts`; they only ever call the engine.

**Coordinates.** State and the API use 0-based, half-open spans; everything the
user reads or types is 1-based and inclusive, GenBank-style (a feature stored as
`[182, 211)` shows as `183–211`; a cursor shows the two bases it sits between,
`182 | 183`). All conversion goes through `lib/coords.ts` — don't format a
position by hand.

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
| `components/SequencePane.tsx` | Sequence pane: toolbar, find bar, selection read-out |
| `components/SequenceViewer.tsx` | The sequence view: drawing, selection, typing, clipboard |
| `lib/seqLayout.ts` | What goes on each sequence line and how tall it is (pure) |
| `components/EditPanel.tsx` | The inspector's tab strip; hands menu commands to the tabs |
| `components/inspector/*` | One file per inspector tab (Edit, Features, ORFs, Enzymes, Primers, History) |
| `components/Toolbar.tsx` | Title bar: breadcrumb, undo/redo, import/export, theme |
| `components/RecordLibrary.tsx` | Start screen: sortable, filterable table of saved plasmids |
| `components/NewRecordDialog.tsx` | Modal for creating a record from pasted DNA |
| `components/ContextMenu.tsx` | Right-click menu (keyboard-operable, stays on screen) |
| `lib/edits.ts` | Type / paste / delete at the selection, via the engine |
| `components/ZoomControls.tsx` | Zoom buttons shared by the two maps, and wheel-to-zoom scaling |
| `components/Splitter.tsx` | Draggable, keyboard-operable divider between maps and sequence |
| `lib/coords.ts` | 0-based internal spans ↔ 1-based positions shown to the user |
| `lib/layout.ts` | Open views + divider position (persisted) |
| `lib/theme.ts` | Light / dark / system theme preference |
