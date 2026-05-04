# doXmind

doXmind 是一个完全本地化的桌面文档 IDE。用户硬盘上的文件就是真相来源。这份文档定义产品里那些**承重的概念**和**它们之间的关系**——任何架构讨论都应该用这里的词。

## Language

**Document**:
一篇 markdown 文档。doXmind 里唯一的 first-class document type。在硬盘上是一个 `.md` 文件 + 一个同名的隐藏 `.doxmind` sidecar。
_Avoid_: file（太泛），note（太轻），page。

**Sidecar**:
和一个 Document 同目录、同名、隐藏的 `.doxmind` JSON 文件，存放编辑器侧 state（HTML、`extras`、id、`markdown_hash` 等）。Sidecar 不是真相，`.md` 才是；sidecar 只是富表达的缓存与扩展。
_Avoid_: state file，meta file，cache。

**Block**:
一个 Document 内部的可编辑单元。包括标准富文本块（段落、标题、列表、代码、表格）和自定义块（math、mermaid、callout、database、page-link，以及 PDF 块、Excel 块）。
_Avoid_: node（TipTap 内部术语），element，widget。

**Custom Block**:
非标准富文本的 Block，需要专属的序列化、渲染。分两类：

- **Self-contained Custom Block**：所有数据都在 markdown 文本里，不需要 **Extras** 槽位。HTML 只是 markdown 的渲染视图。例：mermaid、callout、math、toggle、page-link。注册时只需声明 markdown ↔ HTML 转换。
- **External-reference Custom Block**：markdown 里只放一个**指针**（带稳定 id 的占位符 + 引用的外部文件路径），编辑状态住在 **Extras** 槽位 `extras.blocks.<id>`。例：PDF 块、Excel 块。注册时除了转换规则，还要声明 **Hydration mode**、**Salvage** 规则、id 提取规则、孤儿和重复 id 的处理策略。

Database 块（早期版本里曾是 External-reference 类）计划移除，未来 doXmind 不再支持。

**Hydration mode**:
一个 **External-reference Custom Block** 类型的属性，决定它的 **Extras** 状态什么时候从 Sidecar 加载到内存：

- **Eager**（默认）：打开 Document 时一次性加载所有该类型块的状态。保存走 replace。
- **Lazy**：只在该块进入视口或被用户激活时加载。保存走 slot-aware merge（只覆盖 dirty 槽位，不动未加载的）。

PDF 块、Excel 块默认是 **Lazy**。**Self-contained Custom Block** 没有 hydration mode 概念（它们没有 extras）。

调用方不能选择模式——模式由块类型决定。

**Extras**:
Sidecar 里 `extras` 字段下的命名子树，每个 Custom Block 类型可以认领一个 key 来存自己的状态（如 `extras.databases`、`extras.blocks.<blockId>`）。Extras 是 Custom Block 状态的唯一合法栖身处。

**Stale sidecar**:
当 Sidecar 存在但它记录的 `markdown_hash` 不再等于当前 `.md` body 的 hash 时，说明用户在 doXmind 之外编辑过 `.md`（vim、git pull、Obsidian 等）。`.md` 永远是真相，所以 Sidecar 里的 `html` 必须丢弃；但 **Extras** 可能还能被抢救。
_Avoid_: dirty sidecar，outdated sidecar。

**Salvage**:
当 Sidecar 处于 Stale 状态时，把仍然有效的 **Extras** 槽位从旧 Sidecar 搬到新生成的 Document 上的过程。Salvage 规则是**每个 Custom Block 类型自己声明的**——有的块（如 database 的纯数据）始终可 salvage，有的块（如绑定到段落 id 的 annotation）可能在 body 改了之后失效。

**Second-class file (PDF / Excel)**:
用户拖一个 `.pdf` 或 `.xlsx` 进 doXmind 时打开的视图。在产品语义上，它**等价于一个只包含一个对应 Custom Block 的 Document**——不是新的 first-class document type。在内存里通过 **Synthetic Document** 实现。
_Avoid_: PDF document，Excel document，PDF editor（这些会让人误以为它们和 Document 平起平坐）。

**Synthetic Document**:
打开一个 **Second-class file** 时在内存里临时合成的 Document：body 只包含一个对应类型的 Custom Block，Extras 槽位装这个块的状态。Synthetic Document 在硬盘上对应一个 markdown shape 的 Sidecar（`.foo.doxmind`），但**没有对应的 `.md` 文件**——原始 `.pdf` / `.xlsx` 二进制就是它的 body 替身。
_Avoid_: PDF wrapper，Excel wrapper，virtual document。

**Sidecar migration**:
打开一个旧版 doXmind 写出的 PDF/Excel sidecar（旧 shape：`{ pdf_editor, pdf_parsed_cache }` 等）时，**原地重写成新的 markdown sidecar shape**（**Synthetic Document** 的形态）的过程。迁移只动 `.foo.doxmind`，**绝不动用户的 `.pdf` / `.xlsx` 原文件**。迁移前会备份到 `.foo.doxmind.bak`。

**Block placeholder**:
**External-reference Custom Block** 在 markdown 里的占位符表达，固定为 HTML 注释格式：`<!-- {block_type} id="{uuid}" src="{relative_path}" [...其他属性] -->`。`id` 是该块实例的稳定标识（UUID v4），跨 rename / move 不变；`src` 是被引用文件相对于 Document 所在目录的路径。占位符在 GitHub / pandoc 等 markdown 渲染下不可见——**它是 doXmind 的内部状态表达，不是文档内容**。
规范详见 [docs/sidecar-format.md](docs/sidecar-format.md)。

**Block correlation**:
一个 External-reference Custom Block 实例在 **Block placeholder**（markdown）、TipTap node（HTML/编辑器）、**Extras** slot（sidecar）三处的对应关系，靠 `id` 串联。每次 `MarkdownDocumentState.read` 都会扫一遍并产出一份 **Correlation report**，列出三种破裂事件：

- **Orphan slot** —— Extras 里有 slot，markdown 里找不到对应 placeholder。
- **Duplicate id** —— markdown 里出现 ≥2 条相同 id 的 placeholder。
- **New id** —— markdown 里有 placeholder，Extras 里没有对应 slot。

每个 External-reference 块类型在注册时声明这三种事件的默认处理策略（discard / keep / error / empty），模块按策略自动跑出 resolved extras；同时把 report 放进 ReadOutcome，调用方可以选择消费（UI 提示、telemetry）或忽略。

**用户文件 vs doXmind 文件**:
两类硬盘内容，待遇完全不同：

- **用户文件**（`.md`、`.pdf`、`.xlsx`、用户写的资源）—— 用户的真相，doXmind 只在用户明确编辑时写。
- **doXmind 文件**（`.doxmind` sidecar、`.doxmind/` 目录下的 index 等）—— doXmind 的内部状态，版本演化和迁移是合理的。

**Sidecar migration** 只动后者，不动前者。

**Workspace**:
用户选择的根目录。doXmind 扫描这个目录下的 Document 和 Second-class file，并维护一个 `.doxmind/index.json` 的 id 索引。

**Delete**:
把一个 Document（或 Second-class file）从 Workspace 移到操作系统的回收站（macOS Trash / Windows Recycle Bin）。`.md` 和它的 Sidecar **作为一对**一起搬，由 doXmind 在删除瞬间分别调用 OS trash API 完成。doXmind 自身**不持有**任何"已删除"状态——没有 `.trash/` 目录，没有 Settings → Trash UI。
恢复路径完全外包给 OS：用户从废纸篓里把 `.md` 拖回原位置时，需要**同时把同名隐藏 Sidecar 也拖回**——这一约定在删除前的 ConfirmModal 文案里点出。如果用户只 restore 了 `.md`，下次打开会走正常的"missing sidecar"路径（按 Stale-sidecar 规则丢弃 HTML、从 `.md` 重建；Extras 不可恢复）。
_Avoid_: trash document，soft delete，archive。删除就是删除，恢复是 OS 的事。

## Relationships

- 一个 **Document** 在硬盘上 = 一个 `.md` 文件 + 一个 **Sidecar**
- 一个 **Document** 由多个 **Block** 组成
- 每个 **Custom Block** 类型可以认领一个 **Extras** 槽位来存自己的状态
- 一个 **Second-class file** = 一个内部合成的 **Document**，里面只有一个对应的 **Custom Block**
- **Sidecar** 永远是 **Document** 的附属；没有"PDF sidecar"或"Excel sidecar"这种独立概念
- 当 **Sidecar** 进入 **Stale** 状态时，每个 **Custom Block** 类型的 **Salvage** 规则决定它的 **Extras** 槽位能否被保留
- 一个 **External-reference Custom Block** 实例 = 一个 **Block placeholder** + 一个 TipTap node + 一个 **Extras** slot，三处用同一个 `id` 关联，关系由 **Block correlation** 守护
- **Self-contained Custom Block** 没有 **Extras** slot，也不参与 **Block correlation**——它的全部状态都在 markdown 文本里
- **Delete** 同时移动 `.md` 和它的 **Sidecar** 到 OS 回收站；恢复需要用户把两个文件都拖回，否则 Extras 丢失（详见 [docs/adr/0005-delete-uses-os-trash.md](docs/adr/0005-delete-uses-os-trash.md)）

## 核心定位

**Markdown 是 first-class，PDF 和 Excel 是 second-class。** 产品的承重柱是富文本编辑——PDF 和 Excel 的存在是为了"能在富文本里嵌入它们"以及"用户已有的 PDF/Excel 文件能被打开和编辑"。它们不是平起平坐的三种文档类型。

任何把 PDF / Excel 建模成和 Markdown 同级 first-class file type 的设计都和这个定位冲突。详见 [docs/adr/0001-markdown-is-the-only-first-class-document.md](docs/adr/0001-markdown-is-the-only-first-class-document.md)。

## Flagged ambiguities

- **"document"** 早期被用来同时指 markdown、PDF、Excel 三种文件——已解决：只有 markdown 是 **Document**，PDF/Excel 是 **Second-class file**。
- **"sidecar"** 早期被用来指 markdown、PDF、Excel 各自的状态文件，每种 shape 不同——已解决：**Sidecar** 永远只属于 markdown **Document**，PDF/Excel 块的状态住在 **Extras** 里。
- `CLAUDE.md` 里 "Three document types are first-class citizens" 描述的是**当时的实现**，不是目标定位。代码逐步深化时该字面会被订正。
