# PyInstaller spec — single-file `doxmind-mcp` stdio server (ADR 0010, S9).
#
# Usage (CWD must be server/ so pathex=["."] resolves):
#   cd server
#   .venv/bin/pyinstaller --clean --noconfirm packaging/doxmind-mcp.spec
#   # -> server/dist/doxmind-mcp
#
# Set DOXMIND_CODESIGN_IDENTITY to sign the binary (macOS); unsigned otherwise.

# ruff: noqa
# pyright: ignore

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

hiddenimports: list[str] = ["orjson"]
hiddenimports += collect_submodules("mcp")
# The MCP server never touches the SQLite db (it has no `serve` command), so
# db / aiosqlite / sqlalchemy are intentionally not collected here.
for _pkg in ("api", "services", "core", "doxmind_mcp", "lib"):
    hiddenimports += collect_submodules(_pkg)

datas: list[tuple[str, str]] = []
for _pkg in ("pymupdf", "mcp"):
    try:
        datas += collect_data_files(_pkg)
    except Exception:
        pass

a = Analysis(
    ["doxmind_mcp/server.py"],
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
    name="doxmind-mcp",
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
