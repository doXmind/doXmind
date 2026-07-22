# ADR-0013: Electron is the only packaged desktop runtime

Status: accepted

Date: 2026-07-22

## Context

doXmind had parallel Electron/Node and Tauri/Rust desktop implementations of
the same workspace command contract. Every storage or security change had to be
implemented and verified twice even though both shells served one Next.js UI
and one local Markdown product.

The duplicate runtime increased release, signing, dependency, test, and command
conformance work without providing a distinct product capability. It also made
the ownership of the canonical desktop implementation unclear.

## Decision

Electron is the sole packaged desktop runtime.

- `electron/` owns the in-process desktop Workspace command implementation.
- The renderer reaches those commands only through the Electron preload/IPC
  boundary.
- The packaged app does not launch or bundle Python/FastAPI.
- Python remains optional for browser development, CLI/MCP, and standalone
  local import/conversion tooling.
- The Tauri shell, Rust Page core, Cargo workspace, Tauri JavaScript packages,
  build scripts, CI jobs, and release configuration are removed.
- Adding another packaged desktop shell requires a new ADR with a concrete
  product capability that cannot be provided through Electron.

## Consequences

- Desktop storage, security, Page export, menus, packaging, and release behavior
  have one Implementation and one release gate.
- Source/frontmatter fixtures continue to align Electron with browser-dev
  Python, but Python is not a desktop runtime dependency.
- Historical ADRs may describe the retired Tauri/Rust implementation. Those
  passages are migration history, not active architecture.
- Electron-specific names no longer need a neutral abstraction unless the
  abstraction also serves browser development or the frontend test boundary.
