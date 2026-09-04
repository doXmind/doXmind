# doXmind CLI & MCP server

> Product scope follows [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md). Create
> and edit operations apply to Markdown Pages only. PDF and spreadsheet commands
> are read-only Attachment parsing/conversion surfaces; HTML has no dedicated
> import or conversion command. None establishes an editable document type. The
> current Page storage/editor contract
> follows [ADR-0012](adr/0012-markdown-source-block-editor.md): one portable
> Markdown file is the complete Page state; same-name `.doxmind` files are inert
> legacy artifacts, not active Page state.

doXmind ships two standalone shells over the same workspace (ADR
[0010](adr/0010-cli-and-mcp-share-a-shell-agnostic-core.md)):

- **`doxmind`** — a document toolkit CLI (read, search, export, convert, create,
  edit, and structural ops).
- **`doxmind-mcp`** — a stdio [MCP](https://modelcontextprotocol.io) server that
  exposes the workspace to external agents (Claude Code, Claude Desktop, …).

Both run as their own Python process and operate directly on the filesystem —
the `.md`/`.markdown` file is the source of truth. **The desktop app does not
need to be running.**

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
`--out ~/Desktop/x.html`).

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

````bash
doxmind ls                      # list workspace documents
doxmind search "TODO"           # full-text search markdown
doxmind read notes/idea.md            # print markdown (--html / --json)
doxmind new notes/idea.md --title Idea --content "# Idea\n\n..."
doxmind edit notes/idea.md --content "# Idea\n\nrewritten"   # or pipe via stdin
doxmind export notes/idea.md --to html --out idea.html
doxmind export notes/idea.md --to md --out idea-copy.md
doxmind convert spec.pdf              # parse PDF -> JSON blocks
doxmind mv notes/spec.pdf notes/report.pdf   # move/rename an Attachment (prompts unless --yes)

...and, after the closing ``` of the example block, add:

`mv` moves Attachments only. A Markdown Page or folder target fails closed with
`Page rename/move must use workspace_relocate_page` — relocating a Page needs
the desktop's link-impact preview and transactional repair.
doxmind rm old.md                     # -> system Trash (prompts unless --yes)
doxmind mkdir drafts
doxmind import ~/Downloads/report.pdf --dest inbox
doxmind index rebuild
doxmind --root /path/to/workspace ls  # override the workspace root
````

`doxmind export` supports only `html` and `md` (default: `html`). The `md`
result is a byte-for-byte copy of the complete Page file, including BOM,
frontmatter, comments, line endings, and trailing newlines. HTML is a neutral,
derived projection with no editor schema. Export refuses the Page itself, an
existing destination, or a destination symlink; choose a new output path. PDF
output belongs to the packaged Electron app's printer-independent local export
flow; neither the CLI nor MCP exports PDF.

## MCP server

`doxmind-mcp` speaks MCP over stdio. Its Markdown Page tools are
`list_workspace`, `search_documents`, `read_document`, `create_document`,
`edit_document`, `export_document`, `rename_document`, `move_document`,
`delete_document` (→ system Trash), `create_folder`, and `import_document`.
`rename_document` and `move_document` take Attachments only — a Markdown Page
or folder target fails closed, because relocating one needs the desktop's
link-impact preview. Two further tools, `read_pdf` and `read_excel`, parse a
workspace PDF or spreadsheet read-only into JSON for the calling agent;
doXmind never edits those files.

`export_document` has the same `html`/`md`-only contract and defaults to HTML.

It also exposes resources: `docs://list` (a listing of every document with its
stable id) and `doc:///<id>` (a Page's Markdown source, addressed by id; a
non-Markdown Attachment returns a one-line read-only note instead of content).

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

The shells write to disk directly. doXmind treats external Markdown edits as
authoritative and writes the Markdown file atomically; it does not create or
rebuild any legacy sidecar state. Editing from the CLI/MCP is atomic at the
file-write boundary.
Editing the **same** document simultaneously in the app and a shell can still
lose a write — avoid concurrent edits of one file.
