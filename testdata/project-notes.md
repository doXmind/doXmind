---
id: testdata-project-notes
title: Project Notes
---

# Project Notes — Q2 Planning

Working draft of doXmind sidecar migration milestones. Use this file to
exercise the markdown editor end-to-end: headings, lists, tables, code,
links, and inline formatting all in one place.

## Milestones

1. Land the **sidecar storage** boundary so `.md` and `.doxmind` always
   travel together.
2. Wire the editor to read sidecar HTML when `markdown_hash` matches.
3. Move database-block data into `extras.databases`.

## Open questions

- Do we keep SQLite as a runtime cache or drop it entirely?
- How do we surface stale sidecars when the user edits Markdown externally?
- _Stretch:_ versioned snapshots of `extras.databases`.

## Sample table

| Area     | Owner   | Status      |
| -------- | ------- | ----------- |
| Sidecar  | @alex   | In progress |
| Importer | @priya  | Done        |
| Exporter | @jordan | Blocked     |

## Code snippet

```ts
function sidecarPathFor(markdownPath: string): string {
  const dir = dirname(markdownPath);
  const base = basename(markdownPath).replace(/\.(md|markdown)$/i, "");
  return `${dir}/.${base}.doxmind`;
}
```

## Reference

See [the local README](../README.md) for build commands. Telemetry, cloud
sync, and AI features remain out of scope for this branch.
