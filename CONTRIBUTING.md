# Contributing to doXmind

Thanks for improving doXmind.

## Good contribution areas

- Reproducible bugs in local file handling, Markdown round-tripping, Block
  interactions, PDF export, updates, accessibility, or performance.
- Documentation, tests, and Markdown compatibility improvements.
- Small, focused fixes that preserve the local-first product boundary.

## Product boundary

doXmind is a fully local Markdown-native workspace. Pages are ordinary
Markdown files; PDF, spreadsheet, and HTML files are read-only Attachments.
Do not add cloud sync, accounts, telemetry, AI runtimes, PDF/Excel editors,
new attachment sidecar writers, or a second desktop runtime without a prior
product decision.

## Before opening a pull request

1. Open or comment on an issue before starting a large change.
2. Keep the diff limited to the problem being solved.
3. Add or update a regression test when behavior changes.
4. Run the relevant checks. At minimum, run `npm run lint`, `npm run type-check`,
   and the focused `npm test` command for the changed area.
5. Describe the user-visible behavior, verification, and any remaining limits
   in the pull request.

By submitting a contribution, you agree that it is licensed under Apache-2.0.
