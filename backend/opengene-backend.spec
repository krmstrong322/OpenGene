# PyInstaller spec — bundles the OpenGene FastAPI backend into a standalone
# one-directory executable named "opengene-backend". Build with:
#     pyinstaller opengene-backend.spec --noconfirm
#
# Produces dist/opengene-backend/ containing the launcher + all dependencies.
# Electron ships this directory as extraResources and spawns the launcher.

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

datas = []
binaries = []
hiddenimports = []

# Our package data (feature_library.json).
datas += collect_data_files("opengene")

# uvicorn resolves loop/protocol implementations dynamically at runtime.
hiddenimports += collect_submodules("uvicorn")
hiddenimports += [
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "anyio._backends._asyncio",
]

# Biopython and primer3 carry compiled extensions and/or data tables.
for pkg in ("Bio", "primer3"):
    p_datas, p_binaries, p_hidden = collect_all(pkg)
    datas += p_datas
    binaries += p_binaries
    hiddenimports += p_hidden

block_cipher = None

a = Analysis(
    ["run_backend.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide2"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="opengene-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="opengene-backend",
)
