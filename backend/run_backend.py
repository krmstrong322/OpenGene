"""Top-level launcher for the packaged desktop backend.

Uses absolute imports so it works as PyInstaller's ``__main__`` entry (a module
run as ``__main__`` has no parent package, so relative imports fail there).
Electron spawns the built executable of this script with ``--port`` and an
``OPENGENE_DATA_DIR`` environment variable.
"""

from __future__ import annotations

import argparse

import uvicorn

from opengene.api import app


def main() -> None:
    parser = argparse.ArgumentParser(prog="opengene-backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
