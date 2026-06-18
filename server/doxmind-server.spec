# PyInstaller spec — FastAPI sidecar for the desktop bundle.
#
# Usage:
#   server/.venv/bin/pyinstaller --clean --noconfirm server/doxmind-server.spec
#
# The build script (scripts/build-sidecar.mjs) wraps this and renames the
# resulting binary to `doxmind-server-<target-triple>` so Tauri's externalBin
# lookup finds it.
#
# Set DOXMIND_CODESIGN_IDENTITY to sign the binary during PyInstaller's EXE
# step (macOS); unsigned otherwise. Electron release builds let electron-builder
# import the certificate and sign the packaged app bundle in its own phase.

# ruff: noqa
# pyright: ignore

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

hiddenimports: list[str] = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("aiosqlite")
hiddenimports += collect_submodules("sqlalchemy.dialects.sqlite")
hiddenimports += collect_submodules("email_validator")
# orjson is a Rust-extension import inside a try/except in excel_workbook.py.
# PyInstaller's static analyzer normally picks it up, but the conditional
# import has bitten us before — list it explicitly. Falling back to stdlib
# json works at runtime, but the JSON round-trip hot path on the workbook
# cache assumes orjson is present (~2x faster on multi-MB DTOs).
hiddenimports += ["orjson"]
# Local packages — collect everything so dynamic imports (router glob,
# middleware) resolve at runtime.
hiddenimports += collect_submodules("api")
hiddenimports += collect_submodules("services")
hiddenimports += collect_submodules("db")
hiddenimports += collect_submodules("utils")
hiddenimports += collect_submodules("lib")

datas: list[tuple[str, str]] = []
# Lightweight release bundle:
#
# Keep the base app focused on local Markdown, workspace IO, DOCX/PPTX import,
# and native-text PDF import. Scanned-PDF OCR is a large optional path; do not
# bundle marker/surya/torch/transformers into every installer. Those packages
# are loaded only when the user explicitly installs/runs OCR.
for _pkg in ("pymupdf4llm", "pymupdf", "mammoth", "pptx"):
    try:
        datas += collect_data_files(_pkg)
    except Exception:
        pass

# Be explicit only for the lightweight converter stack. Pulling marker/surya
# here would also pull torch, transformers, sklearn, pandas, and friends.
for _pkg in ("pymupdf4llm", "mammoth", "pptx"):
    try:
        hiddenimports += collect_submodules(_pkg)
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
        "marker",
        "surya",
        "torch",
        "transformers",
        "tensorflow",
        "sklearn",
        "scipy",
        "pandas",
        "boto3",
        "botocore",
        "onnxruntime",
        "cv2",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "pytest_asyncio",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

# Two layouts from one spec:
#   onefile (default)            — Tauri externalBin wants a single binary.
#   onedir  (DOXMIND_SIDECAR_ONEDIR=1) — Electron extraResources; no cold
#   self-extraction, and nested .so files notarize as regular bundle members.
import os

_onedir = os.environ.get("DOXMIND_SIDECAR_ONEDIR", "").lower() in ("1", "true", "yes", "on")

_exe_payload = [] if _onedir else [a.binaries, a.datas]

exe = EXE(
    pyz,
    a.scripts,
    *_exe_payload,
    [],
    exclude_binaries=_onedir,
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
    codesign_identity=os.environ.get("DOXMIND_CODESIGN_IDENTITY") or None,
    entitlements_file=None,
)

if _onedir:
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=False,
        name="doxmind-server",
    )
