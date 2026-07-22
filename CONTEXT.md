# doXmind domain context

doXmind 是一个完全本地、Markdown 原生的知识工作区。用户硬盘上的文件是真相
来源。本文件定义代码与架构讨论中的承重概念；产品边界和路线图见
[`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md)，不可逆决定见
[`ADR-0011`](docs/adr/0011-local-markdown-knowledge-workspace.md) 与
[`ADR-0012`](docs/adr/0012-markdown-source-block-editor.md)；唯一 Electron
桌面 Runtime 的决定见
[`ADR-0013`](docs/adr/0013-electron-only-desktop-runtime.md)。

## Language

**Page**（代码中的 `Document`）：
用户在 doXmind 中编辑的一级内容。硬盘表达是一个完整的 `.md` 或 `.markdown`
文件；正常生命周期没有伴生文件。UI 文案使用 Page；现有内部类型可以继续使用
Document，避免无价值的全仓改名。

**Attachment**：
Workspace 内的非 Markdown 文件，例如 PDF、XLSX、CSV、HTML 或图片。Attachment
可以被列出、预览、引用、索引元数据、Reveal 或 Open Externally，但不拥有独立的
新建、编辑、保存和导出产品栈。原文件始终是唯一权威内容。
_Avoid_: PDF Document、Excel Document、Second-class editable file。

**Workspace**：
用户选择的真实根目录。doXmind 扫描其中的 Page、文件夹和 Attachment，并维护
可删除、可重建的本地索引。文件树映射真实目录，不维护一套隐藏的云端层级。

**Desktop Runtime**：
Electron 是唯一打包桌面 Runtime，通过 preload/IPC 调用进程内 Node Workspace
commands。Tauri 与 Rust Page core 已退役；Python/FastAPI 仅属于 browser development、
CLI/MCP 和独立本地工具，不进入打包应用生命周期。

**Legacy Sidecar**：
旧版本在 Page 或 PDF/Excel Attachment 旁创建的隐藏 `.doxmind` JSON。正常 Page
open/save 不再读取或写入它；只由 read-only inventory/recovery Adapter 检测和导出。
已有 Sidecar、`.bak`、`.lock` 与 corrupt copy 在恢复门禁完成前必须保持原 bytes。
_Avoid_: Page cache、current editor state、knowledge database、content store。

**Block**：
Page 内的编辑单元，包括段落、标题、列表、任务、代码、表格、图片，以及 math、
Mermaid、callout、toggle 等富块。Block 是 canonical Markdown source 的 span/view；
其操作直接 patch source，而不是编辑一棵并行 HTML/JSON 文档树。会话 selection 和
drag id 可以只存在内存。

**Toggle Block**：
标准 `<details>` / `<summary>` source，内容仍是 Markdown。折叠状态由 portable `open`
attribute 表达；不得用 editor-only node attrs 保存 Toggle state。

**Slash Command**：
只在 active paragraph 中提供的 source-command Adapter。它把 `/...` paragraph 替换为
heading/list/task/toggle/collection 等 canonical Markdown template，不创建隐藏 command
record、node schema 或第二份 editor state。

**Custom Block**：
需要专属 Markdown parser、source command 和 UI Adapter 的 Block。用户语义必须
全部在 Markdown 中；尚未支持的语法作为 raw block 原样保留。

**Legacy External-reference Block**：
旧 PDF/Excel 集成留下的兼容结构。Markdown 中使用带稳定 id 和 `src` 的 HTML 注释
placeholder，编辑状态位于 `extras.blocks.<id>`。它只为已有文件的读取、迁移、
correlation 和恢复保留；不得用于新的 Attachment 编辑功能。

**Properties**：
Page 的结构化字段，保存在 YAML frontmatter。Tags、aliases、日期和 Collection
字段都是 Properties。当前 UI/Collection v1 只投影 top-level string、finite number、
boolean 或 string array；未知/复杂 YAML 仍保留 source。外部工具修改 frontmatter 后，
doXmind 必须以文件为准。

**Daily Note**：
以本机 local calendar date 选择的普通 Page：`Daily Notes/YYYY-MM-DD.md`。folder、Page、
save 和 navigation 都走正常 Workspace Interface；没有 journal database 或 sidecar。

**Page Link**：
写在 Markdown 正文中的 `[[target]]`、`![[target]]` 或标准 Markdown link。内部 stable id 可以帮助
索引和 relocation repair，但 link 关系不能只存在 Sidecar 或 TipTap node attribute 中。
Page/Folder rename 或 move 必须先基于完整 workspace Page snapshot 生成可预览的 exact
source patch，再由本地 Workspace Adapter 做 revision-checked transaction；歧义或无法
保真改写的 link 只报告，不猜测。旧 rename/move Interface 只允许 Attachment；无法
提供同一 preview 的 CLI/MCP 对 Page/Folder 必须 fail closed，不能静默绕过。

**Transclusion**：
占满一个 paragraph Block 的 `![[Page]]` 或 `![[Page#Heading]]`。表达式保持 canonical
Markdown；目标 Page 或唯一 ATX heading section 由零写入 source index 递归只读投影。
歧义、缺失、cycle、depth limit 与 block-id fragment 显式 fail closed，不能生成第二份
可编辑文档状态。

**Workspace Index**：
从 Page 和 Attachment 文件派生的搜索、path/id、properties、links、backlinks、
unresolved links、unlinked mentions、transclusion source-page projection 与 collection
membership 索引。它不是事实源；删除后全量扫描必须得到等价结果。

**Collection**：
基于 Page Properties 的 query 和 view。一行/卡片/事件是一篇普通 Page；Table、
Board 和 Calendar 只能是同一批 Page 的不同视图。当前 v1 是 Page 内 exact
`doxmind-collection` fenced JSON，只有 read-only Table，ANDed
`equals`/`contains`/`exists` filters、columns 与 deterministic multi-sort。Board、
Calendar、relation、formula、rollup 未实现。view 不能保存唯一一份 row 或 property。

**Knowledge Graph**：
从同一 zero-write Page Catalog 的 resolved links 派生的 bounded deterministic view。
当前 Page 居中，node 可导航；nodes、edges、layout 都不是持久内容，refresh/rebuild
不得写 Workspace。

**Local Image Projection**：
standalone CommonMark image 对已有 workspace-relative raster asset 的只读 preview。
Workspace Adapter 拒绝 scheme/absolute/query/fragment/escape/symlink path，限制 20 MiB，
验证 file signature，再把 bytes 交给 UI 建立可撤销 Blob URL。它不表示 paste/drag
import、asset writer、remote fetch、resize/crop 或 binary editor 已实现。

**Legacy DatabaseBlock**：
把数据放在 `extras.databases` 的旧实现。它已冻结，未来由 portable Collection
取代。在迁移或导出完成前不得静默删除已有数据，也不得继续扩建其 schema。

**Stale Sidecar**：
仅用于 legacy recovery 的历史术语：Sidecar `markdown_hash` 与当前文件不一致。
正常 Page read 不再做 freshness 协调；Markdown 永远是唯一当前状态。

**Legacy Synthetic Document**：
旧版本打开 PDF/Excel 时在内存中合成的单-block Document。它的 markdown-shaped
Sidecar、迁移、`.bak`、`.lock` 和 block correlation 规则继续作为恢复契约存在，
但 Synthetic Document 不再是新产品模型。

**Delete**：
通过操作系统 Trash/Recycle Bin 删除真实文件。Page 本身是唯一当前文件；如果旁边
已有 Legacy Sidecar，过渡期必须把这个 recovery artifact 一起送入 Trash。doXmind
不维护第二套软删除库，也绝不把 scope reduction 当作删除旧 Sidecar 的理由。

## Storage relationships

```text
Workspace/
├── Project Plan.md                 # Page truth: body + frontmatter + links
├── Research/
│   └── Notes.md
├── attachments/
│   ├── spec.pdf                    # Attachment truth
│   └── budget.xlsx
└── assets/
    └── diagram.png                 # ordinary local asset; read-only projection

~/.doxmind/workspaces/<workspace-key>/
├── index.json                      # rebuildable derived index
└── workspace.json                  # replaceable workspace/view UI state
```

- 一个 Page = 一个 Markdown 文件。
- 一个 Page 由多个 Block 组成。
- Properties、links 与 transclusion expressions 属于 Markdown/frontmatter，不属于 Sidecar。
- Backlinks、unlinked mentions、transclusion projections、search、graph 和 Collection membership 属于 Workspace Index。
- Toggle 与 Collection definition 属于 Markdown source；graph layout、Collection rows 与 local-image Blob URL 是可删除 projection。
- 一个 Attachment = 一个普通用户文件；新打开不得产生编辑 sidecar。
- Legacy Page/PDF/Excel Sidecar 是用户恢复数据；显式报告已可导出，但原始 artifact family 仍不得自动删除或重写。

## Page open/save contract

Open：

1. 读取 `.md`/`.markdown`，保留完整 raw source，并解析 frontmatter/body view。
2. 从 source 建立 block spans；未支持的语法保持 raw。
3. 新建 Page 的 stable id 来自 frontmatter；外部无 id 文件使用 path identity，open
   不写盘。
4. HTML 只按需派生为 preview/export，不参与 editor hydration。

Save：

1. 把 block commands 应用到 canonical Markdown source。
2. 原子写回一个 Page 文件；未修改 source bytes 与未知 frontmatter 保持不变。
3. 更新或失效化 app data 中可重建的 Workspace Index。

任何新语义特性都要通过“只复制一个 Page 文件、删除全部 derived cache 后能否恢复”
这一测试。

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
2. 旧 PDF/Excel editor、endpoint 和 state type 已从活动产品删除；现有旧编辑结果只通过
   明确触发、零写入的恢复报告读取。
3. 恢复报告必须保留旧状态的完整信息，且不得修改 Attachment、sidecar 或其时间戳。
4. 普通 Attachment 的最终行为是 read-only preview / reveal / open externally。
5. 只有当 ADR-0011 的 removal gate 全部通过，才能物理删除 editor、writer、parser
   cache 和依赖。
6. `.bak`、`.lock`、corrupt forensic copies 和 sidecar 不得被自动清理。

## Flagged ambiguities

- `WorkspaceDocumentType` 目前仍叫 Document，是 wire/compatibility 名称；其
  `pdf | excel | html` 值只表示 Attachment format，不表示可编辑能力。
- UI 使用 Page，内部可以继续使用 `Document`。不要为了术语一致性做全仓机械改名。
- 当前代码不会路由到 legacy PDF/Excel editor；Attachment 只有只读表面和显式恢复。
- `extras.databases` 已退出活动 Page 模型。Wiki link 已使用可携带 Markdown 语法；
  Wiki/标准 Markdown link、backlink 与 unresolved occurrence 可从文件零写入重建，
  unlinked mentions 与 Page/Folder relocation repair 也已由完整 Page snapshot 派生；
  独立 `![[Page]]` / `![[Page#Heading]]` Block 已从同一零写入 source index 递归投影；
  同一 Page Catalog 也已提供 v1 Collection Table 和 Page graph。block-id fragment、
  Board/Calendar 与 relation/rollup 仍须按 `docs/PRODUCT_DIRECTION.md` 深化。
- 所有 Page 只使用 native `MarkdownBlockDocument`；尚未深化的 syntax 以 exact raw
  Block 编辑。任何新 Page feature 都必须有 portable Markdown grammar，不得重新增加
  TipTap/ProseMirror 或第二套 editor schema。
