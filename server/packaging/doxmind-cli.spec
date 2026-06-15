# PyInstaller spec — single-file `doxmind` CLI (ADR 0010, S9).
#
# Usage (CWD must be server/ so pathex=["."] resolves):
#   cd server
#   .venv/bin/pyinstaller --clean --noconfirm packaging/doxmind-cli.spec
#   # -> server/dist/doxmind
#
# Set DOXMIND_CODESIGN_IDENTITY to sign the binary (macOS); unsigned otherwise.

# ruff: noqa
# pyright: ignore

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# `db`, aiosqlite, sqlalchemy, and uvicorn are pulled in for the `doxmind serve`
# command (it boots the full FastAPI sidecar via run_sidecar -> main -> db). The
# document commands don't need them, but a single binary must cover serve too.
hiddenimports: list[str] = ["orjson"]
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("aiosqlite")
hiddenimports += collect_submodules("sqlalchemy.dialects.sqlite")
for _pkg in ("api", "services", "core", "cli", "db", "lib"):
    hiddenimports += collect_submodules(_pkg)

datas: list[tuple[str, str]] = []
try:
    datas += collect_data_files("pymupdf")
except Exception:
    pass

a = Analysis(
    ["cli/__main__.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "torch",
        "transformers",
        "tensorflow",
        "sklearn",
        "scipy",
        "pandas",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "pytest_asyncio",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="doxmind",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=os.environ.get("DOXMIND_CODESIGN_IDENTITY") or None,
    entitlements_file=None,
)
