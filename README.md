# doXmind

A fully local, Markdown-native editor. One Page is one `.md` file on your disk,
and that file is the whole document — no database, no account, no cloud sync, no
telemetry.

<p align="center">
  <img src="docs/readme/doxmind-overview.png" width="1100" alt="doXmind editing an ordinary Markdown file" />
</p>

[doxmind.com](https://doxmind.com/) ·
[Download the latest release](https://github.com/doXmind/releases/releases/latest) ·
[User guide](docs/USER_GUIDE.md) · [Product direction](docs/PRODUCT_DIRECTION.md)

## What it is

Markdown is the editor state. You edit blocks — headings, lists, tables, code,
quotes — and every edit is applied to the Markdown source itself. There is no
hidden document model and no companion file beside your Page. Syntax the editor
does not have a block for stays editable as exact raw source, so nothing in your
file is lost by opening it here.

<p align="center">
  <img src="docs/readme/doxmind-editor.png" width="1100" alt="Block editing with the inline format toolbar" />
</p>

- **One file is the Page.** Create, open, edit and save touch exactly one
  `.md` or `.markdown` file. Unknown frontmatter keys, comments and line
  endings survive untouched.
- **Blocks over source.** Split, merge, move, duplicate, delete, undo and
  redo, plus kind changes between text, headings, lists, to-dos and quotes.
- **Portable output.** Everything the editor writes is Markdown another tool
  can read: `# `, `- `, `1. `, `- [ ] `, `> `, ` ``` `, pipe tables, `$$`,
  and Mermaid fences.
- **Local links.** `[[Wiki Links]]` open Pages in the workspace without
  rewriting either file, and `![[Page]]`, `![[Page#Heading]]` and
  `![[Page#^block-id]]` render read-only transclusions from the same sources.
- **Daily notes.** Today's note at `Daily Notes/YYYY-MM-DD.md`, from the local
  calendar date.
- **Local images.** Pasting or dropping an image copies it into `assets/` and
  inserts a relative Markdown reference. Nothing is fetched from the network.

## The block set

Type `/` in a paragraph. Every entry writes ordinary Markdown, which is why the
list is short — if Markdown has no portable form for it, it is not here.

<p align="center">
  <img src="docs/readme/doxmind-blocks.png" width="900" alt="The slash menu and the Markdown each command writes" />
</p>

## Getting started

Download the `.dmg` from [Releases](https://github.com/doXmind/releases/releases/latest),
drag doXmind to Applications, and open a folder as your workspace or a single
Markdown file. The public channel currently ships macOS on Apple silicon.

Files that are not Markdown are left exactly as they are. doXmind does not edit
them and does not write anything beside them.

## Running from source

Node.js 22 or newer is the only requirement:

```bash
npm ci
npm run dist:electron
```

Python is optional and is not used by the packaged app. It backs browser
development and the standalone CLI/MCP tooling:

```bash
python3 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
npm run dev:all
```

Checks:

```bash
npm run type-check
npm run lint
npm run test:ci
npm run test:e2e
```

## How it is put together

```text
Next.js UI + block editor  →  Electron IPC  →  Node file commands  →  your files
```

The packaged app runs workspace commands inside its own desktop process. It does
not start or bundle a server.

```text
src/          UI, the Markdown block editor, stores and adapters
electron/     the desktop shell and its file commands
server/       optional browser-dev, CLI and conversion tooling
docs/         user, architecture and decision documentation
```

## What it does not do

Accounts, teams, sharing, cloud sync, billing, telemetry and built-in AI are all
out of scope, and so is a plugin marketplace. This is not Notion or Obsidian
parity — it is a smaller, portable subset that keeps your files readable
everywhere else.

## Project

Licensed under [Apache-2.0](LICENSE). The doXmind name and logo are not covered
by that licence — see [TRADEMARKS.md](TRADEMARKS.md).

Contributions are welcome for bugs, documentation, tests and Markdown
compatibility; see [CONTRIBUTING.md](CONTRIBUTING.md) for the product boundary
and [SECURITY.md](SECURITY.md) for private vulnerability reporting.
The standalone CLI and MCP server are documented in
[CLI & MCP](docs/cli-and-mcp.md).
