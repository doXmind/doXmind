# Sidecar 迁移采用显式一次性策略，不动用户原文件

把 PDF / Excel 的旧 sidecar shape（独立的 `pdf_editor` / `excel_editor` 字段、独立的 endpoints）统一到 markdown sidecar shape（**Synthetic Document** 的形态）有三种迁移路径：

- **(a) 边界翻译**：硬盘永远保留旧 shape，只在 read/write 边界做翻译。
- **(b) 升级即写**：打开旧 sidecar 时按旧 shape 读，下次 save 时写新 shape；迁移是 save 的副作用。
- **(c) 显式迁移**：打开旧 sidecar 时立即原地重写成新 shape；迁移是 open 的独立步骤。

**决定**：选 **(c) 显式一次性迁移**。打开任何旧 PDF/Excel 文件时，立即把它的 `.foo.doxmind` 重写成新 shape，旧 shape 备份到 `.foo.doxmind.bak`。

**理由**：

1. **可预测性**：升级后 "打开过的文件 = 已迁移" 是清晰的不变量。
2. **失败处理清晰**：迁移作为独立步骤可以写日志、备份、失败时拒绝打开并报错。混在 save 里则失败原因模糊。
3. **删旧代码的时机明确**：所有用户文件迁移完之后，旧 shape 的 read 路径可以删除。(b) 因为用户可能永远不 save，旧路径必须无限期保留。
4. **延续 ADR-0001**：second-class file 的硬盘表达统一到 Synthetic Document，是 "PDF/Excel 不是 first-class" 这条定位的自然延伸。

**关键边界**：迁移**只动 doXmind 自己写的 sidecar 文件**（`.foo.doxmind`），**绝不动用户的 `foo.pdf` / `foo.xlsx` 原文件**。本地 IDE 的硬盘契约是"用户文件不被悄悄改"——sidecar 是 doXmind 的内部状态，不在这条契约里。

**逃生开关**：环境变量 `DOXMIND_SIDECAR_MIGRATE=0` 可以禁用迁移，让用户在新版本里继续用旧 shape（read-only 模式，不能保存）。默认开。
