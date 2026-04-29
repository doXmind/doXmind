# PyInstaller spec — single-file FastAPI sidecar for the Tauri bundle.
#
# Usage:
#   server/.venv/bin/pyinstaller --clean --noconfirm server/doxmind-server.spec
#
# The build script (scripts/build-sidecar.mjs) wraps this and renames the
# resulting binary to `doxmind-server-<target-triple>` so Tauri's externalBin
# lookup finds it.

# ruff: noqa
# pyright: ignore

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

hiddenimports: list[str] = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("aiosqlite")
hiddenimports += collect_submodules("sqlalchemy.dialects.sqlite")
hiddenimports += collect_submodules("email_validator")
# Local packages — collect everything so dynamic imports (router glob,
# middleware, agents) resolve at runtime.
hiddenimports += collect_submodules("api")
hiddenimports += collect_submodules("services")
hiddenimports += collect_submodules("db")
hiddenimports += collect_submodules("utils")
hiddenimports += collect_submodules("lib")

datas: list[tuple[str, str]] = []
# markitdown ships data files for some converters; pull them in if installed.
try:
    datas += collect_data_files("markitdown")
except Exception:
    pass

a = Analysis(
    ["run_sidecar.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Trim the bundle: nothing in the desktop edition needs these.
        "tkinter",
        "matplotlib",
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
    name="doxmind-server",
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
    codesign_identity=None,
    entitlements_file=None,
)
