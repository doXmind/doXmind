# Delete 走 OS 回收站，doXmind 不维护内部 Trash

## 背景

doXmind 早期带过一个 DB 模型，**Trashed Document** 是一个有意义的内部状态，配套 Settings → Trash UI、`useFileStore.trashFiles`、四个 store 方法（`loadTrash` / `restoreFile` / `permanentDeleteFile` / `emptyTrash`）。在向"用户硬盘 = 真相来源"模型迁移的过程中，backend 实现了一种 workspace 内 trash 的妥协方案：`doc_delete` 把 `.md` + Sidecar 移到 `<workspace>/.trash/`，scan 排除该目录。前端 store 方法保留为 stub，从未接通。

这个夹生状态产生了三个真实问题：

1. **用户的真相被悄悄移动**：`.trash/` 目录里装的是用户的 `.md` 文件，但用户在 doXmind UI 里看不到它的存在。git/Spotlight/grep 时会突然撞见，违反"用户文件 vs doXmind 文件"的清晰边界。
2. **恢复路径不工作**：Settings → Trash 列表永远空（前端 stub），用户手滑删除后**实际无法在 doXmind 内恢复**，但 backend 表现得像有 trash。
3. **完成 Settings → Trash 的代价不成比例**：要做的事包括决定 `.trash` 内的保留策略、处理跨 Workspace 的 Trash 视图、Sidecar 与 Document 的原子性维护、Trash 内 ID 索引、Empty Trash 的进度 UX 等等——一整套企业 SaaS 形态的功能，跟"本地桌面 IDE，轻量化"的产品调性正面冲突。

## 决定

**Delete = 移到 OS 回收站。doXmind 不维护任何内部 Trash 概念。**

具体地：

- `doc_delete`（Tauri + Python fallback）调用平台的回收站 API（macOS `NSWorkspace recycleURLs:` / Windows `IFileOperation::DeleteItem` / 通过 Tauri `trash` crate 抽象），**不再**写 `<workspace>/.trash/`。
- `.md` 和它的 Sidecar **作为一对**移到 OS 回收站——两个独立的回收站条目，但删除瞬间一并完成。
- Workspace 里删除 `.trash/` 目录、`unique_trash_path` / `unique_trash_dir_path` 辅助函数、scan 排除规则、写入防护规则、相关 Tauri 测试。
- 前端删除 `useFileStore.trashFiles` 字段、四个 stub 方法、Settings → Trash 整个 tab、对应 i18n strings。
- ConfirmModal **保留**——OS trash 是恢复路径，但二次确认是廉价的 defense-in-depth，并且是告知用户"伴生 Sidecar 也会被移动"的承载点。

恢复完全外包给 OS：用户在 macOS Finder Trash / Windows Recycle Bin 里看到 `Project Plan.md` 和 `.Project Plan.doxmind` **两条**，需要把两个都拖回原位置。

## 为什么 sidecar 要跟着进 OS trash（A），而不是硬删（B）

考虑过另一个方案：`.md` 进 OS trash，Sidecar 直接 `unlink`（理由是 Sidecar 是"doXmind 文件"，可以从 `.md` 重建）。这个方案被否决，因为：

**Sidecar 包含不可从 `.md` 重建的用户状态**：

- `extras.blocks.<id>` —— 每个 External-reference Custom Block 的实际状态。对 PDF/Excel **Synthetic Document** 来说，**所有用户编辑都住在这里**——硬删 Sidecar = 永久丢失所有 PDF 标注 / Excel 公式编辑。
- `extras.databases` —— database 块的实际数据。
- 各种自定义块未来可能挂上的 annotation 状态。

行业惯例支持 A：

- **Adobe Lightroom Classic** 把 `.raw` + `.xmp` 都送进 OS trash，官方文档明确告诉用户 "restore the photo and its .xmp sidecar from the Trash and re-import"。
- **IMatch DAM** 的 buddy file management 自动让伴生文件跟着主文件一起 move/delete。
- **Capture One** 的 sidecar 里不含编辑（编辑在 catalog DB 里），所以删 sidecar 无所谓——这跟我们模型不一样，doXmind 没有 catalog。

A 的代价是 macOS Finder Trash 里出现 `.<name>.doxmind` 这样的隐藏伴生条目（视觉上有点丑，但概念诚实）。在 ConfirmModal 文案里一次说清，用户建立心智模型。

## 为什么不选其他方案

**workspace 内 `.trash/`（保留 backend、修前端）**：违反"用户文件 vs doXmind 文件"边界——`.trash` 里装的是用户的真相。会产生幽灵目录。

**workspace 内 `.trash/` + 完整的 Settings → Trash UI**：等于把 DB 时代的 Trash 模型重建一遍。需要决定保留策略、原子性、跨 workspace 视图、容量上限……一整套企业 SaaS 形态的工作。跟产品调性不符。

**Sidecar 静默归档到 `<workspace>/.doxmind/orphan-sidecars/`，restore 时按 id 配回**：等于 workspace `.trash/` 改头换面回来，并且引入新的"孤儿 sidecar 缓存"概念，复杂度比直接走 A 更高。

**让用户在删除时选 "Move to system Trash / Permanently delete"（Obsidian 模式）**：在我们场景下永远没有第二个有意义的选项（我们已经否决了 doXmind 内部 trash），变成单一选项的多余 dropdown。

**OS trash 在 Linux 没配置时 fallback 到硬删**：违反"用户的真相只在用户明确编辑时写"原则。但 Linux 不是当前目标平台，这个分支不存在。

## 后果

- 删除是**真删**（从 Workspace 角度看）+ **可恢复**（从 OS 角度看）。doXmind 不在两个角色之间假装提供第三种"软删除"。
- 误删的恢复需要用户主动去 OS 回收站，且需要知道"还要 restore 一个隐藏的 `.<name>.doxmind`"。这个约定通过 ConfirmModal 文案传达。
- 跨 Workspace、跨设备的删除一致性问题不存在（OS trash 各机器独立，doXmind 不参与）。
- 如果未来需要恢复"应用内 Trash"功能（比如做 cloud sync 时需要），这个 ADR 应该被订正，不是悄悄绕过。

## 关联

- 触发这次决定的 issue: [#7](https://github.com/doXmind/local-desk/issues/7)
- CONTEXT.md 新增 **Delete** 术语
