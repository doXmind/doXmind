"""Shell-agnostic operation facade for doXmind (ADR 0010).

The FastAPI routes, the `doxmind` CLI, and the MCP server all call into `core`
so the document/workspace operation vocabulary lives in exactly one place.
`core` runs against the filesystem directly — the `.md` file plus its hidden
`.doxmind` sidecar are the source of truth — so no running desktop app or HTTP
sidecar is required.
"""
