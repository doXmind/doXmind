# doXmind CLI & MCP server

doXmind ships two standalone shells over the same workspace (ADR
[0010](adr/0010-cli-and-mcp-share-a-shell-agnostic-core.md)):

- **`doxmind`** — a document toolkit CLI (read, search, export, convert, create,
  edit, and structural ops).
- **`doxmind-mcp`** — a stdio [MCP](https://modelcontextprotocol.io) server that
  exposes the workspace to external agents (Claude Code, Claude Desktop, …).

Both run as their own Python process and operate directly on the filesystem —
the `.md` file plus its hidden `.doxmind` sidecar are the source of truth. **The
desktop app does not need to be running.**

## Workspace root

Workspace-relative commands resolve their root in this order:

1. an explicit `--root` (CLI only),
2. `$DOXMIND_WORKSPACE_ROOT`,
3. the default `~/Documents/doXmind`.

**Confinement.** The **MCP server** confines every agent-supplied path to the
workspace root — `..` escapes, absolute paths outside the root, and symlinks
pointing outside are all rejected. This is the security boundary for untrusted
agents.

The **CLI** is a trusted local tool run by the file's owner, so it is _not_ a
confinement boundary. Its workspace commands (`ls`/`new`/`mv`/`rm`/…) are
root-relative; the file commands (`read`/`export`/`convert`) take a relative
path resolved against the root (`..` is rejected) **or** an absolute path used
as-is, so a human can read or write anywhere they own (e.g.
`--out ~/Desktop/x.pdf`).

## Install

Both shells live in `server/`. Pick one of:

### pipx / uvx / pip (developer-friendly)

```bash
pipx install ./server          # exposes `doxmind` and `doxmind-mcp`
# or, without installing:
uvx --from ./server doxmind --help
```

### PyInstaller binaries (no Python required)

```bash
cd server
.venv/bin/pip install pyinstaller
.venv/bin/pyinstaller --clean --noconfirm packaging/doxmind-cli.spec   # -> dist/doxmind
.venv/bin/pyinstaller --clean --noconfirm packaging/doxmind-mcp.spec   # -> dist/doxmind-mcp
```

Set `DOXMIND_CODESIGN_IDENTITY` to code-sign the macOS binaries.

## CLI

```bash
doxmind ls                      # list workspace documents
doxmind search "TODO"           # full-text search markdown
doxmind read notes/idea.md            # print markdown (--html / --json)
doxmind new notes/idea.md --title Idea --content "# Idea\n\n..."
doxmind edit notes/idea.md --content "# Idea\n\nrewritten"   # or pipe via stdin
doxmind export notes/idea.md --to pdf --out idea.pdf
doxmind convert spec.pdf              # parse PDF -> JSON blocks
doxmind mv a.md sub/a.md              # move/rename (prompts unless --yes)
doxmind rm old.md                     # -> system Trash (prompts unless --yes)
doxmind mkdir drafts
doxmind import ~/Downloads/report.pdf --dest inbox
doxmind index rebuild
doxmind --root /path/to/workspace ls  # override the workspace root
```

## MCP server

`doxmind-mcp` speaks MCP over stdio and exposes these tools: `list_workspace`,
`search_documents`, `read_document`, `read_pdf`, `read_excel`,
`export_document`, `create_document`, `edit_document`, `rename_document`,
`move_document`, `delete_document` (→ system Trash), `create_folder`,
`import_document`.

It also exposes resources: `docs://list` (a listing of every document with its
stable id) and `doc:///<id>` (a document's markdown content, addressed by id).

### Claude Code

```bash
claude mcp add doxmind --env DOXMIND_WORKSPACE_ROOT=/Users/you/Documents/doXmind -- doxmind-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "doxmind": {
      "command": "doxmind-mcp",
      "env": { "DOXMIND_WORKSPACE_ROOT": "/Users/you/Documents/doXmind" }
    }
  }
}
```

Use the absolute path to the PyInstaller binary (e.g.
`server/dist/doxmind-mcp`) as `command` if you did not `pipx install`.

### Inspect

```bash
npx @modelcontextprotocol/inspector doxmind-mcp
```

## Concurrency caveat

The shells write to disk directly. doXmind treats external markdown edits as
authoritative (a `markdown_hash` mismatch regenerates the sidecar) and writes
atomically, so editing markdown from the CLI/MCP while the app is open is safe.
Editing the **same** document simultaneously in the app and a shell can still
lose a write — avoid concurrent edits of one file.
