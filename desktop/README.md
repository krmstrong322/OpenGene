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
it. To remove that warning later, add secrets — no YAML or config change is
needed beyond flipping the two noted values:

**macOS** (`electron-builder.yml` → `mac`)
1. Enroll in the Apple Developer Program.
2. CI secrets: `CSC_LINK` (base64 of your Developer ID `.p12`), `CSC_KEY_PASSWORD`.
3. For notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
   and set `mac.notarize: true`.
4. Set `identity` to your `Developer ID Application: …` name (remove `null`) and
   `hardenedRuntime: true` (the entitlements in `build/entitlements.mac.plist`
   are already wired for the bundled Python).

**Windows** (`electron-builder.yml` → `win`)
1. Obtain a code-signing certificate (OV/EV, or Azure Trusted Signing).
2. CI secrets: `CSC_LINK`, `CSC_KEY_PASSWORD` — electron-builder uses them
   automatically.

Until those secrets exist, `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI keeps the
build unsigned instead of failing.

## Icons

No custom icon is set yet, so the default Electron icon is used. Add
`build/icon.icns` (macOS) and `build/icon.ico` (Windows) and electron-builder
picks them up automatically.
