# OpenGene Desktop

An Electron app that wraps OpenGene into a double-click install for
non-technical lab users. No Python, Node, Docker, or terminal required on the
end user's machine.

## How it works

```
┌─────────────────────────── OpenGene.app / .exe ───────────────────────────┐
│  Electron main process                                                     │
│   1. picks a free localhost port                                           │
│   2. spawns the bundled backend (PyInstaller exe) on it, with              │
│      OPENGENE_DATA_DIR = per-user data dir (app.getPath('userData'))       │
│   3. waits for /health, then opens a window on the built UI                │
│   4. preload injects http://127.0.0.1:<port> as the API base              │
│   5. kills the backend on quit                                             │
│                                                                            │
│  resources/backend/   ← standalone Python backend (no Python needed)       │
│  resources/renderer/  ← built React UI                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

A user's plasmids persist in a SQLite file under the OS data directory
(`~/Library/Application Support/OpenGene` on macOS,
`%APPDATA%\OpenGene` on Windows), so work survives quitting and updates.

## Menu, Open… and file associations

The main process (`electron/main.js`) owns what only the OS shell can do:

- **Application menu** — File (New Sequence, Open…, Export As, Show Library),
  Edit (Undo, Redo, Cut, Copy, Paste, Select All, Find), View (show/hide the
  map, linear view and sequence; appearance; zoom), Window and Help. Items
  that act on the open record are sent to the UI as a command string
  (`"undo"`, `"export:genbank"`, `"view:map"` …) and carried out there; the UI
  reports whether a record is open so record-only items grey out.
- **Opening files** — File ▸ Open… (native dialog, multi-select), files passed
  on the command line, a file opened while OpenGene is already running (the
  app is single-instance, so it goes to the existing window), and on macOS the
  `open-file` event (double-click, "Open With", a drop on the dock icon). The
  main process reads the files and hands them to the UI, which imports them
  through the engine exactly like a drag-and-drop import.
- **File associations** — `fileAssociations` in `electron-builder.yml`
  registers GenBank, FASTA, EMBL, SnapGene `.dna` and Sanger trace extensions
  with the installers. On macOS OpenGene is an *alternate* handler: it shows
  under "Open With" without taking any type over from another app.

The bridge is `electron/preload.js` (`window.opengeneDesktop`); its UI side is
`frontend/src/lib/desktop.ts`. Keep the extension lists in `main.js`
(`IMPORT_EXTENSIONS`), `electron-builder.yml` and the UI's file picker in step.

To try it without building an installer (after the two builds below):

```bash
cd desktop
npm start                         # the app
npx electron . path/to/file.gb    # … opening a file
xvfb-run -a npx electron --no-sandbox .   # headless Linux / CI / containers
```

## Getting installers (the normal path)

You don't build these locally per-OS. Push a tag (or run the workflow manually)
and GitHub Actions builds both:

```bash
git tag v0.1.0 && git push origin v0.1.0
# → Actions → "Build desktop installers" → download artifacts:
#     OpenGene-0.1.0-arm64.dmg  (macOS, Apple Silicon — M1 and later)
#     OpenGene-0.1.0-x64.dmg    (macOS, Intel)
#     OpenGene Setup 0.1.0.exe  (Windows x64)
```

Pushing a branch named `release/<version>` (e.g. `release/v0.1.0`) runs the
same build, which helps when you can push branches but not tags.

The workflow is `.github/workflows/desktop-build.yml`. Each macOS architecture
is built on its own runner (`macos-15` for Apple Silicon, `macos-15-intel` for
Intel) because PyInstaller cannot cross-compile the bundled Python backend.
GitHub plans to retire its Intel macOS images with the macOS 15 image in fall
2027; after that, Intel builds need a self-hosted Intel Mac runner.

## Building locally (for development)

Requires Python 3.12, Node 20, and the target OS (you can only build a `.dmg`
on macOS and an `.exe` on Windows).

```bash
# 1. backend → standalone executable
cd backend
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install . pyinstaller
pyinstaller opengene-backend.spec --noconfirm    # → backend/dist/opengene-backend/

# 2. frontend → static build
cd ../frontend && npm ci && npm run build          # → frontend/dist/

# 3. desktop → run or package
cd ../desktop && npm ci
npm start            # run the app (stages + launches Electron)
npm run dist         # package an installer for the current OS → desktop/release/
```

`npm run stage` copies `frontend/dist` → `desktop/renderer` and
`backend/dist/opengene-backend` → `desktop/backend`; `start` and `dist` run it
automatically.

## Code signing (currently off — "decide later")

Installers build **unsigned** today. First-time users will see a warning
(macOS Gatekeeper / Windows SmartScreen); `docs/INSTALL.md` walks them through
it. To remove that warning, add repository secrets (Settings → Secrets and
variables → Actions). The workflow already passes them to the build, and each
platform only sees its own certificate.

**Windows** (no config change)
1. Obtain a code-signing certificate (OV or EV).
2. Add secrets `WIN_CSC_LINK` (the `.pfx`, base64-encoded) and
   `WIN_CSC_KEY_PASSWORD`. The next build is signed.

**macOS** (secrets plus three values in `electron-builder.yml` → `mac`)
1. Enroll in the Apple Developer Program and export your
   *Developer ID Application* certificate as a `.p12`.
2. Add secrets `MAC_CSC_LINK` (the `.p12`, base64-encoded) and
   `MAC_CSC_KEY_PASSWORD`.
3. For notarization, add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
   `APPLE_TEAM_ID`.
4. In `electron-builder.yml` set `identity` to your
   `Developer ID Application: …` name (replacing `null`), `hardenedRuntime: true`
   and `notarize: true`. The entitlements in `build/entitlements.mac.plist` are
   already set up for the bundled Python.

Secrets that aren't set are simply skipped, so the build stays unsigned rather
than failing.

## Icons

No custom icon is set yet, so the default Electron icon is used. Add
`build/icon.icns` (macOS) and `build/icon.ico` (Windows) and electron-builder
picks them up automatically.
