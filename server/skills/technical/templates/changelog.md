# Changelog Template

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- [Feature or capability that is new]

### Changed
- [Existing functionality that has been modified]

### Deprecated
- [Features that will be removed in future versions]

### Removed
- [Features that have been removed]

### Fixed
- [Bug fixes]

### Security
- [Security vulnerability fixes]

---

## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature description ([#123](https://github.com/org/repo/issues/123))
- Another new feature with more details
  - Sub-detail about the feature
  - Another sub-detail

### Changed
- Updated dependency `package-name` from v1.0.0 to v2.0.0
- Improved performance of `functionName()` by 50%
- Modified default configuration for `setting`

### Deprecated
- `oldFunction()` is deprecated and will be removed in v3.0.0. Use `newFunction()` instead.

### Removed
- Removed support for Node.js 14 ([#456](https://github.com/org/repo/issues/456))
- Deleted unused `legacyModule`

### Fixed
- Fixed issue where [specific problem description] ([#789](https://github.com/org/repo/issues/789))
- Resolved memory leak in `Component` when [condition]
- Corrected typo in error message

### Security
- Updated `vulnerable-package` to patch CVE-XXXX-XXXXX
- Fixed XSS vulnerability in user input handling

---

## [X.Y.Z-beta.1] - YYYY-MM-DD

### Added
- Beta feature for testing: [Feature description]

### Known Issues
- [Known issue 1 that users should be aware of]
- [Known issue 2]

---

## [1.0.0] - YYYY-MM-DD

### Added
- Initial release
- Core feature 1
- Core feature 2
- Core feature 3

---

## Guidelines for Changelog Entries

### Entry Format

Each entry should follow this format:
- Start with a verb in past tense (Added, Changed, Fixed, etc.)
- Be concise but descriptive
- Reference related issues/PRs when applicable
- Group related changes together

### Good Entry Examples

```
- Added `--verbose` flag to CLI for detailed output (#123)
- Fixed crash when processing files larger than 2GB (#456)
- Changed default timeout from 30s to 60s for slow networks
- Removed deprecated `legacyAuth()` function
```

### Bad Entry Examples

```
- Fixed bug (too vague)
- Updated stuff (not descriptive)
- Changes (no verb, no description)
```

### Categories Explained

- **Added**: New features or capabilities
- **Changed**: Changes to existing functionality
- **Deprecated**: Features marked for future removal
- **Removed**: Features that have been removed
- **Fixed**: Bug fixes
- **Security**: Security-related changes

### Version Numbering (SemVer)

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backwards compatible
- **PATCH** (0.0.X): Bug fixes, backwards compatible

### Links Section (Bottom of File)

```markdown
[Unreleased]: https://github.com/org/repo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/org/repo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/org/repo/releases/tag/v1.0.0
```

---

[Unreleased]: https://github.com/org/repo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/org/repo/releases/tag/v1.0.0
