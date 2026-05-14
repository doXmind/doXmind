# Sidecar 迁移采用显式一次性策略，不动用户原文件

把 PDF / Excel 的旧 sidecar shape（独立的 `pdf_editor` / `excel_editor` 字段、独立的 endpoints）统一到 markdown sidecar shape（**Synthetic Document** 的形态）有三种迁移路径：

- **(a) 边界翻译**：硬盘永远保留旧 shape，只在 read/write 边界做翻译。
- **(b) 升级即写**：打开旧 sidecar 时按旧 shape 读，下次 save 时写新 shape；迁移是 save 的副作用。
- **(c) 显式迁移**：打开旧 sidecar 时立即原地重写成新 shape；迁移是 open 的独立步骤。

**决定**：选 **(c) 显式一次性迁移**。打开任何旧 PDF/Excel 文件时，立即把它的 `.foo.pdf.doxmind` / `.foo.xlsx.doxmind` 重写成 markdown shape，旧 shape 备份到 `<sidecar>.bak`。

**理由**：

1. **可预测性**：升级后 "打开过的文件 = 已迁移" 是清晰的不变量。
2. **失败处理清晰**：迁移作为独立步骤可以写日志、备份、失败时拒绝打开并报错。混在 save 里则失败原因模糊。
3. **删旧代码的时机明确**：所有用户文件迁移完之后，旧 shape 的 read 路径可以删除。(b) 因为用户可能永远不 save，旧路径必须无限期保留。
4. **延续 ADR-0001**：second-class file 的硬盘表达统一到 Synthetic Document，是 "PDF/Excel 不是 first-class" 这条定位的自然延伸。

**关键边界**：迁移**只动 doXmind 自己写的 sidecar 文件**（例如 `.foo.pdf.doxmind` / `.foo.xlsx.doxmind`），**绝不动用户的 `foo.pdf` / `foo.xlsx` 原文件**。本地 IDE 的硬盘契约是"用户文件不被悄悄改"——sidecar 是 doXmind 的内部状态，不在这条契约里。

**逃生开关**：环境变量 `DOXMIND_SIDECAR_MIGRATE=0` 可以禁用迁移，让用户在新版本里继续用旧 shape（read-only 模式，不能保存）。默认开。

## 新 shape 的具体契约

迁移后的 PDF / Excel 不是新的 first-class Document type。它们是
Second-class file，对应一个 **Synthetic Document**，这个 Synthetic Document
只包含一个 External-reference Custom Block：

- PDF: `<!-- pdf-block id="..." src="foo.pdf" -->`
- Excel: `<!-- excel-block id="..." src="foo.xlsx" -->`

迁移后的状态统一落在：

```text
extras.blocks.<block_id>.editor
extras.blocks.<block_id>.parsedCache
```

旧字段只允许作为迁移输入：

- `pdf_editor`
- `pdf_parsed_cache`
- `excel_editor`
- `excel_parsed_cache`
- `source_path`
- `updated_at_unix_nanos`

新代码不得再写这些 top-level 字段。迁移完成后，sidecar 必须只有
markdown-shape top-level 字段：`version`、`id`、`html`、`markdown_hash`、
`updated_at`、`extras`。

`markdown_hash` 对 Synthetic Document 的含义是"生成的 markdown
frontmatter + 单个 placeholder"的 hash，不是 `foo.pdf` / `foo.xlsx` 原始
二进制的 hash。二进制源文件的解析缓存新鲜度属于
`parsedCache.sourceHash`。

## 失败与恢复路径

`.bak` 是用户恢复路径，不是临时文件：

1. 迁移前先把原始 sidecar bytes 写入 `<sidecar>.bak`。
2. 再原地重写 `<sidecar>` 为 markdown shape。
3. 如果第二步失败，保留 `<sidecar>` 和 `<sidecar>.bak`，报错提示用户可把
   `<sidecar>.bak` rename 回 `<sidecar>`。
4. 如果 `<sidecar>.bak` 已经存在，阻止迁移，要求先人工检查旧备份，避免覆盖
   唯一恢复证据。

corrupt sidecar 不是 legacy sidecar，不能迁移：

- JSON parse 失败、UTF-8 decode 失败、或者 JSON 顶层不是 object 时，原始
  `<sidecar>` bytes 必须原样留在原位置。
- 读取路径写一份 timestamped forensic copy：`<sidecar>.corrupt-*`。
- 报错中带出 forensic copy 路径，供人工检查或手动恢复。

这条规则同时适用于 browser-dev 的 FastAPI workspace route 和 desktop 的
Tauri command path。

## Release validation

发布前用同一组 fixture 验证两个 runtime，不允许 browser-dev 和 desktop
各自形成隐性 contract：

```text
tests/fixtures/sidecar_compat/
├── pdf_legacy.doxmind.json
├── excel_legacy.doxmind.json
├── pdf_markdown_shape.doxmind.json
└── excel_markdown_shape.doxmind.json
```

验证目标：

- legacy fixture 首次打开会迁移到 markdown shape，并创建 `<sidecar>.bak`。
- markdown-shape fixture 的 editor write 和 parsed-cache write 都只更新
  `extras.blocks.<block_id>`。
- 写回后不存在 legacy top-level 字段。
- 原始 `.pdf` / `.xlsx` bytes 没有被迁移或保存路径修改。
- corrupt sidecar 会生成 `<sidecar>.corrupt-*` forensic copy，而不是被覆盖。

对应测试：

- browser-dev: `server/tests/test_sidecar_cross_runtime_compat.py`
- desktop/Tauri: `src-tauri/src/lib.rs` 中 include 同一组 fixture 的 tests
