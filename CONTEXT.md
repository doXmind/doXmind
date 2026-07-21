# doXmind domain context

doXmind 是一个完全本地、Markdown 原生的知识工作区。用户硬盘上的文件是真相
来源。本文件定义代码与架构讨论中的承重概念；产品边界和路线图见
[`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md)，不可逆决定见
[`ADR-0012`](docs/adr/0012-local-markdown-knowledge-workspace.md)。

## Language

**Page**（代码中的 `Document`）：
用户在 doXmind 中编辑的一级内容。硬盘表达是 `.md` 或 `.markdown` 加同名隐藏
`.doxmind` Sidecar。UI 文案使用 Page；现有内部类型可以继续使用 Document，避免
无价值的全仓改名。

**Attachment**：
Workspace 当前支持扫描和原生打开的非 Markdown 文档：PDF、XLSX/XLSM/CSV、
HTML/HTM。Attachment 可以被列出、预览、引用、索引元数据、Reveal 或 Open
Externally，但不拥有独立的新建、编辑、保存和导出产品栈。原文件始终是唯一权威
内容。未知格式即使通过兼容路径抵达共享 surface，也只能使用 `other` 安全只读
fallback；这不代表该格式会被扫描、列出或注册为原生打开类型。插入 Page 的图片是
Markdown assets，不承诺把独立图片文件列为 workspace document。
_Avoid_: PDF Document、Excel Document、Second-class editable file。

**Workspace**：
用户选择的真实根目录。doXmind 扫描其中的 Page、文件夹和受支持 Attachment，并
维护可删除、可重建的本地索引。文件树映射受支持文档所在的真实目录，不维护一套
隐藏的云端层级，也不是通用文件浏览器。

**Sidecar**：
和 Page 同目录、同名、隐藏的 `.doxmind` JSON 文件。它保存 lossless editor HTML、
cache 和可替代的 UI state。Sidecar 不是真相；删除它不能丢失 Page 正文、
properties、tags、aliases、links 或 collection rows。
_Avoid_: knowledge database、content store。

**Block**：
Page 内的编辑单元，包括段落、标题、列表、任务、代码、表格、图片，以及 math、
Mermaid、callout、toggle 等富块。Block 必须有可见、可恢复的 Markdown 表达；纯
编辑器装饰可以只存在 Sidecar。

**Custom Block**：
需要专属 Markdown ↔ editor HTML 转换的 Block。新的 Custom Block 默认必须是
**Self-contained**：用户语义全部在 Markdown 中，Sidecar HTML 只是 lossless cache。

**Legacy External-reference Block**：
旧 PDF/Excel 集成留下的兼容结构。Markdown 中使用带稳定 id 和 `src` 的 HTML 注释
placeholder，编辑状态位于 `extras.blocks.<id>`。它只为已有文件的读取、迁移、
correlation 和恢复保留；不得用于新的 Attachment 编辑功能。

**Properties**：
Page 的结构化字段，保存在 YAML frontmatter。Tags、aliases、日期和 Collection
字段都是 Properties。外部工具修改 frontmatter 后，doXmind 必须以文件为准。

**Page Link**：
写在 Markdown 正文中的 `[[target]]` 或标准 Markdown link。内部 stable id 可以帮助
索引和 rename repair，但 link 关系不能只存在 Sidecar 或 TipTap node attribute 中。

**Workspace Index**：
从 Page 和受支持 Attachment 文件派生的搜索、path/id、properties、links、
backlinks、unresolved links 与 collection membership 索引。它不是事实源；删除
后全量扫描必须得到等价结果。

**Collection**：
基于 Page Properties 的 query 和 view。一行/卡片/事件是一篇普通 Page；Table、
Board 和 Calendar 只是同一批 Page 的不同视图。Saved view 可以是可替代 workspace
state，但不能保存唯一一份 row 或 property 数据。

**Legacy DatabaseBlock**：
把数据放在 `extras.databases` 的旧实现。它已冻结，未来由 portable Collection
取代。在迁移或导出完成前不得静默删除已有数据，也不得继续扩建其 schema。

**Stale Sidecar**：
Sidecar 的 `markdown_hash` 与当前 Page 文件不一致，说明文件被外部工具修改。
Markdown 永远胜出；旧 HTML cache 失效。只允许 salvage 不改变 Page 语义的 cache
或 legacy recovery state。

**Legacy Synthetic Document**：
旧版本打开 PDF/Excel 时在内存中合成的单-block Document。它的 markdown-shaped
Sidecar、迁移、`.bak`、`.lock` 和 block correlation 规则继续作为恢复契约存在，
但 Synthetic Document 不再是新产品模型。

**Delete**：
通过操作系统 Trash/Recycle Bin 删除真实文件。Page 和同名 Sidecar 成对移动；带
legacy sidecar 的 Attachment 必须连同 `.bak`、`.lock` 和 forensic copies 保留成套
证据，因此当前 Attachment surface 不提供 move、rename 或 delete，只提供 Open
Externally 和 Reveal。doXmind 不维护第二套软删除库，也绝不把 scope reduction 当作
删除用户 sidecar 的理由。

## Storage relationships

```text
Workspace/
├── Project Plan.md                 # Page truth: body + frontmatter + links
├── .Project Plan.doxmind           # disposable editor cache/UI state
├── Research/
│   └── Notes.md
├── attachments/
│   ├── spec.pdf                    # Attachment truth
│   └── budget.xlsx
└── .doxmind/
    ├── index.json                  # rebuildable derived index
    └── workspace.json              # replaceable workspace/view UI state
```

- 一个 Page = 一个 Markdown 文件 + 可选 Sidecar。
- 一个 Page 由多个 Block 组成。
- Properties 与 links 属于 Markdown/frontmatter，不属于 Sidecar。
- Backlinks、search、graph 和 Collection membership 属于 Workspace Index。
- 一个 Attachment = 一个普通用户文件；新打开不得产生编辑 sidecar。
- Legacy PDF/Excel sidecar、`.bak`、`.lock` 与 forensic copy 始终是用户恢复
  证据；一次成功尝试也不是删除信号。

## Page open/save contract

Open：

1. 读取 `.md`/`.markdown` 并拆分 frontmatter 与 body。
2. 查找同名隐藏 Sidecar。
3. Sidecar 不存在时，从 Markdown 生成 editor HTML。
4. `markdown_hash` 匹配时可复用 Sidecar HTML。
5. hash 不匹配时外部 Markdown 胜出，旧 HTML 失效。

Save：

1. 把 editor Markdown 写回 Page 文件。
2. 对刚写入的完整 Markdown 计算 hash。
3. 写 Sidecar 的 `{ html, markdown_hash, id, extras }`。
4. 更新或失效化可重建 Workspace Index。

任何新语义特性都要通过“删除 Sidecar 与 Index 后能否从 Page 恢复”这一测试。

## Product boundary

核心方向是：Notion 式的 block editing、properties、templates、collections，结合
Obsidian 式的本地文件所有权、Wiki Links、backlinks 和可重建知识网络。

这不包括：

- PDF annotation/text editor 或 Excel workbook editor 的继续开发；
- HTML 作为第二种可编辑 Page 格式；
- 云账号、同步、分享、权限、评论、通知或实时协作；
- 内置 AI runtime、provider、billing 或 telemetry；
- 在 link/index/storage contract 稳定前建设插件市场。

Markdown → PDF export 属于 Page 输出，不属于 PDF editor。Attachment → Markdown
conversion 必须是用户显式触发的单向导入，不得悄悄修改原文件。

## Legacy compatibility rules

1. 新建入口只创建 Page、Folder 或 Template。
2. 旧 PDF/Excel editor、endpoint 和 state type 在过渡期只是恢复表面，不是产品 API。
3. 在统一 Attachment surface 和 legacy export/recovery 完成前，不直接断开旧编辑结果。
4. 普通 Attachment 的最终行为是 read-only preview / reveal / open externally。
5. 只有当 ADR-0012 的 removal gate 全部通过，才能物理删除 editor、writer、parser
   cache 和依赖。
6. `.bak`、`.lock`、corrupt forensic copies 和 sidecar 不得被自动清理。

## Flagged ambiguities

- `WorkspaceDocumentType` 目前仍叫 Document，是 wire/compatibility 名称；其
  `pdf | excel | html` 值对应当前受支持 Attachment format；`other` 只是在未知格式
  已抵达共享 surface 时防止误入 Markdown editor 的只读 fallback，不扩张扫描或
  原生打开白名单。这些值都不表示可编辑能力。
- UI 使用 Page，内部可以继续使用 `Document`。不要为了术语一致性做全仓机械改名。
- 冻结的 legacy PDF/Excel editor bundle 与 writer 仍待 removal gate 后删除，但
  正常路由已经不能挂载它们。
- 当前 `page-link` 和 `extras.databases` 不满足 portable truth 原则；两者必须按
  `docs/PRODUCT_DIRECTION.md` 的 LINK/COLL 任务迁移后才能继续扩展。
