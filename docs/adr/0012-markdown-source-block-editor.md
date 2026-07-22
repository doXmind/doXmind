# ADR-0012：Markdown 单文件 Page 与 source-backed block editor

Status: accepted
Date: 2026-07-21

Implementation update (2026-07-21): the transition Adapter has been removed.
Every Page now uses `MarkdownBlockRuntime`; syntax without native semantics is
kept editable as exact raw Markdown. Production source and package dependencies
contain no TipTap or ProseMirror runtime. The current native editor operates on
the Markdown body and does not expose frontmatter as a source Block; supported
metadata actions apply revision-guarded minimal patches. Tags and aliases were
the first Page Properties surface; the current broader v1 grammar is recorded
in the implementation update below. Wiki and relative Markdown links,
backlinks, ambiguity, and unresolved occurrences can be rebuilt through a
zero-write Page scan.

Implementation update (2026-07-22): backlinks now include derived unlinked
mentions. Page and Folder rename/move first build a zero-write source-backed
preview, then apply the approved path mapping through one revision-checked
workspace transaction. Electron and browser-dev Python both verify the
complete workspace Page path/revision snapshot immediately before mutation,
move any existing Legacy Sidecar family as opaque bytes, repair only exact link
target spans, and roll back the Page/folder move plus every repair write on
failure. Unsafe or ambiguous targets are reported instead of guessed.
Legacy `doc_rename`/`doc_move` commands are Attachment-only, and the obsolete
`workspace_rename_folder` command is removed. CLI/MCP Page or Folder relocation
fails closed until it can expose the same preview/approval Interface.

Implementation update (2026-07-22): a standalone paragraph containing
`![[Page]]` or `![[Page#Heading]]` now projects from the same zero-write source
index. Targets resolve by path, title, or alias; heading projection requires one
unique ATX section and preserves its exact raw source. Projection is recursive
and read-only, nested links use the target Page as their relative context, and
cycle/depth/ambiguity/missing states fail closed. An Obsidian-compatible
`![[Page#^block-id]]` fragment projects exactly one source Block whose trailing
anchor matches `[A-Za-z0-9][A-Za-z0-9_-]*`; fenced code, Mermaid, and block math
are excluded, and missing/duplicate matches fail closed. Activating the Block
edits the original expression, and local PDF export waits until recursive
projections are stable.

Implementation update (2026-07-22): the native editor now recognizes portable
`<details>` / `<summary>` Toggle Blocks and a slash menu that replaces one
paragraph with canonical Markdown templates. The Page Properties Interface
patches arbitrary top-level string, finite-number, boolean, or string-array YAML
values in addition to tags and aliases. A shared zero-write Page Catalog feeds
strict read-only `doxmind-collection` v1/v2 Table, Board, and Calendar Blocks and
a bounded Page graph; Daily Notes remain ordinary local-date Pages at
`Daily Notes/YYYY-MM-DD.md`. Collection v2 can resolve exact Wiki-Link relation
properties and derive safe formula-AST/rollup values in memory before query/view
projection. Standalone relative local image Blocks read existing assets through
a workspace-confined, size/signature-checked, symlink-free command and render a
revocable in-memory Blob URL. Electron paste/drop additionally copies verified
raster bytes into `assets/` without overwrite and inserts a relative Markdown
reference; remote fetch and binary image editing remain absent.

## 背景

ADR-0011 已经把 doXmind 收敛为本地 Markdown 知识工作区，但旧实现仍有两个会反向
定义产品的核心依赖：

1. Page 以 `.md + .doxmind` 双文件运行，Sidecar HTML 参与打开、保存、identity 和
   Custom Block hydration。只要正常编辑依赖 Sidecar，Markdown 就不是完整 Page。
2. TipTap/ProseMirror 的 HTML/JSON model 是编辑时的事实源，Markdown 只是 save 时
   导出的表达。编辑器 schema 能表达但 Markdown 不能表达的状态会不断进入 Sidecar。

这两个依赖共同造成三类问题：外部编辑与应用内编辑之间需要 hash/correlation 协议；
Page move/delete/rename 必须管理隐藏伴生文件；block、link、property 和 collection
容易获得不可携带的第二份事实源。

产品目标不是“给富文本编辑器加一个 Markdown exporter”，而是：

> 一个 Markdown 文件就是一篇完整 Page；Notion 式 block 操作直接修改 Markdown
> source，Obsidian 式 links、properties 和知识索引全部可以从文件重建。

## 决定

### 1. Page 是单文件模型

- 一篇 Page 只由一个 `.md` 或 `.markdown` 文件构成。
- 正常 create/open/edit/save 不创建、解析、更新或要求同名 `.doxmind` Page Sidecar。
- rename/move/delete 可以 inventory 已存在的 legacy family，但只能把原 bytes 随 source
  一起移动或送入系统 Trash，不能把 Sidecar 内容作为 Page state 读取或重写。
- Page body、properties、tags、aliases、links、transclusion source 和 collection row
  data 必须存在于 Markdown body 或 YAML frontmatter。
- 新建 Page 在 frontmatter 写入稳定 `id`。打开没有 `id` 的外部 Markdown 必须是
  zero-write；在显式添加 property 前使用规范化 workspace-relative path 作为临时
  identity，不能只为分配 id 改写文件。
- 保存必须保留未被用户修改的 frontmatter 和不支持的 Markdown source；禁止通过
  `Markdown -> HTML -> Markdown` 全文往返重写文件。

### 2. Markdown source 是唯一编辑状态

编辑核心公开一个与 React、DOM、TipTap、HTML 和存储实现无关的深接口：

```ts
interface MarkdownBlockDocument {
  snapshot(): { revision: number; markdown: string; blocks: SourceBlock[] };
  apply(command: BlockCommand): ApplyResult;
  undo(): Snapshot;
  redo(): Snapshot;
}

interface SourceBlock {
  sessionId: string;
  kind: BlockKind;
  from: number;
  to: number;
  raw: string;
}
```

- `markdown` 是 canonical state；block 是 source span/view，不是第二份文档树。
- `sessionId` 仅用于当前编辑会话的 selection、drag 和 React key，不写入用户文件。
- text replace、split、merge、move、duplicate、delete、change kind、undo/redo 都以
  source command 表达，并产生新的 Markdown revision。
- 修改一个 block 时，未修改 block 的原始 bytes 必须保持不变。对尚未理解的语法，
  editor 将其作为 `unsupported/raw` block 原样保留，不能降级为 HTML 或丢弃。
- UTF-16 DOM selection 与 source byte/code-point offset 的转换必须在 Adapter 边界完成，
  并由 CJK、emoji、组合字符 fixture 守护。

### 3. 编辑器 UI 是 Adapter

`DocumentWorkspace -> PageEditorHost` 只挂载一个 Page editor：

- `MarkdownBlockEditorAdapter`：semantic preview 与 focus textarea/content
  surface 都只投影 `MarkdownBlockDocument`；autosave 只提交 Markdown。
- `unsupported/raw` Block：尚无 semantic control 的 syntax 仍在同一 Adapter 内直接编辑
  exact source；move/duplicate/delete 保持可用，危险的结构变换明确拒绝。
- Toggle 使用标准 `<details>` / `<summary>` source；open/closed state 是 portable `open`
  attribute。slash command 只把当前 paragraph 替换为 canonical Markdown template，不创建
  command-owned node 或第二份 state。
- standalone relative Markdown image 的 preview 只接收经 Workspace Interface 验证的
  本地 bytes，并用可撤销 Blob URL 显示；它不直接读取任意 filesystem URL，也不发起
  remote fetch。Electron paste/drop 是单独的窄写入 Seam：验证 raster bytes 后以 exclusive
  create 写入 workspace `assets/`，遇到同名生成确定性后缀，再向 canonical Markdown
  插入安全相对路径；不创建 asset manifest 或 Sidecar。

深化采用纵向切片：每增加一种 Markdown syntax，先添加 source round-trip 和 block
command tests，再把 raw projection 深化为 semantic Block。不能为补功能重新引入第二个
editor document model。

### 4. Page 存储 Interface 只接受 Markdown

桌面 Electron/Node、browser-dev Python 和前端 adapter 对 Page 使用同一个语义：

```ts
interface MarkdownPageStore {
  create(path: string, markdown: string, id: string): Page;
  read(path: string): Page;
  write(path: string, markdown: string, expectedRevision?: string): Page;
}
```

- Page write payload 不包含 `html`、`extras`、editor JSON 或 block slots。
- write 原子替换 Markdown 文件，并携带 read 返回的 source revision；revision 不匹配时
  拒绝覆盖、强制重读磁盘版本并暂停保存。该保护是 optimistic revision guard，不宣称
  提供操作系统级原子 compare-and-swap。
- Markdown -> HTML 仅是 preview/export 的可删除派生函数，不参与 hydration 或保存。
- Electron/Python 的 conformance 基线从“HTML 输出相同”改为“Page raw source、
  frontmatter、block spans 和 edits 相同”。

### 5. Sidecar 只属于 legacy recovery

- 新代码不得创建 Page Sidecar、Page slot 或 `extras.databases`。
- 已存在的 Markdown Page Sidecar、PDF/Excel Sidecar、`.bak`、`.lock` 和 corrupt copy
  必须保持原 bytes，直到 recovery/export gate 完成；scope reduction 不是删除授权。
- 正常 Page read 不信任 legacy Sidecar HTML、id 或 extras。独立的 read-only recovery
  inventory/adapter 负责检测并导出其中无法从 Markdown 恢复的旧状态。
- Page rename/move/delete 在过渡期仍需把已存在的 legacy Sidecar 作为 recovery artifact
  一起移动或送入系统 Trash；这不是 Page data model 的一部分。
- ADR-0002/0003/0004/0005 中的 Sidecar、correlation 和 migration 规则仅约束 legacy
  recovery 路径，不得被新 Page feature 调用。

### 6. 知识层全部由文件派生

- Properties：YAML frontmatter，保留未知 key、注释和用户格式；UI edit 做最小 patch。
  当前 portable v1 value grammar 是 string、finite number、boolean 或 string array；key
  必须匹配 `[A-Za-z_][A-Za-z0-9_.-]*`，identity/system key 不作为 custom field 编辑。
  Relation UI 复用 string/string-array grammar，只写无 extension 的 exact `[[Page]]` targets；
  label、heading/block fragment、ambiguous 或 unresolved target 不成为隐藏关系记录。
- Page Link：正文中的 `[[target]]`、`[[target|label]]` 或标准 Markdown link。parser 必须
  处理 escaping、heading/block fragment 和 unresolved target，不能用 title-only node
  attribute 作为关系源。
- Backlinks/search/graph/unlinked mentions：包含 occurrence/source range 的派生 index。
  当前 Page graph 是 resolved links 的 bounded deterministic projection；node navigation
  不写 graph state。
- Page/Folder rename 与 move：Knowledge Index Module 先读取全部 Page，模拟新的 path
  topology，并只规划 link target token 的 source patch；Workspace Adapter 在任何写入前
  精确核验完整 Page 集合和每个 raw-source revision。目标歧义、无法保真表达或不安全的
  occurrence 必须进入 preview warning，不得静默猜测。提交时 source、Legacy Sidecar
  family 和所有 link repair 属于同一个 rollback scope。
- Transclusion：只有占满一个 paragraph Block 的 `![[Page]]` 或
  `![[Page#Heading]]` 才进入语义投影；表达式本身仍是 canonical Markdown。投影复用同一
  zero-write source index，以目标 Page 为相对链接上下文递归只读渲染，并对 ambiguity、
  missing fragment、cycle 与 depth limit fail closed。Heading 匹配只选择唯一 ATX section，
  返回其 exact raw source。Block fragment 只接受 `![[Page#^id]]`（parser 亦兼容 `Page^id`）
  和目标 Block 末尾 ` ^id`；id grammar 是 `[A-Za-z0-9][A-Za-z0-9_-]*`，fenced code、
  Mermaid、block math 不参与匹配，缺失或重复均 fail closed。激活 Block 时编辑原始表达式，
  PDF 导出等待所有递归投影进入稳定状态。
- Collection：query/view 定义位于普通 Markdown Page 的 exact
  `doxmind-collection` fenced JSON block；v1 保持 `view: "table"` compatibility，v2 接受
  Table、带 `groupBy` 的 Board、带 `dateBy` 的 Calendar。所有 view 共享 AND filters
  (`equals` / `contains` / `exists`)、columns 与 deterministic multi-sort；Calendar 只接收
  real `YYYY-MM-DD` 并显式保留 Unscheduled bucket。v2 可内嵌 computed-properties v1：
  relation 解析同名 frontmatter exact Wiki Link；formula 使用 bounded、non-executable JSON
  AST；rollup 通过已声明 relation 执行 `count/sum/min/max/join/unique`。计算先于 query/view，
  diagnostics 确定且 fail closed，结果不写回。preview 只读，row/card/event 是 Page，不是
  `extras.databases` record。
- Daily Notes：使用本地 calendar date，open/create `Daily Notes/YYYY-MM-DD.md`。folder 与
  Page 都是普通 workspace 文件，没有 journal database 或专用 sidecar。
- Local image：只对 standalone CommonMark image + relative workspace path 建立 semantic
  projection；absolute/scheme/query/fragment/workspace escape/symlink 路径 fail closed。
  Workspace Adapter 限制 20 MiB 并验证受支持 raster signature。Electron paste/drop import
  接受 APNG/AVIF/BMP/GIF/ICO/JPEG/PNG/WebP，以 `wx` 语义写入 `assets/`，不覆盖同名文件，
  并插入最短 URI-encoded relative Markdown destination。browser-dev 没有这个 writer；
  resize/crop/delete、binary editor 与 remote-image fetch 仍不提供。
- Derived cache 最终存放于 app data (`~/.doxmind/...`) 而非 workspace；删除 cache 后
  全量扫描必须得到等价结果，scan/open 不得向 workspace 写文件。

## 迁移顺序与门禁

1. **Page storage cut**：create/save/reopen 在 Electron/Node、Python、frontend 都只读写 `.md`；
   legacy Sidecar bytes 不变。
2. **Native block kernel**：paragraph、ATX heading 和 raw fallback 的 source commands、
   undo/redo、autosave 闭环。
3. **Syntax coverage**：list/task/quote/code/table/link/local-image/math/Mermaid/callout/toggle
   已按 exact-source fixtures 从 raw Block 深化；新的 slice 继续遵守同一门禁。
4. **Knowledge layer**：lossless frontmatter/relations、Wiki Link parser、occurrence index、
   backlinks、unlinked mentions、relocation repair 与 Page/heading/block-id transclusion。
5. **Portable collections**：strict v1 compatibility、v2 Table/Board/Calendar 及
   relation/formula/rollup computed grammar 已落地；旧 DatabaseBlock row migration 仍需
   独立门禁。
6. **Legacy recovery**：PDF/Excel Sidecar inventory/export 与 PAGELEG-1 的 Page
   artifact-family 原始字节 export 均已完成。
7. **Deletion**：删除 Page Sidecar writers/readers、TipTap runtime/dependencies、旧 HTML
   conformance 和不可达 adapters。每次删除必须通过真实依赖搜索，而不是只隐藏入口。

完成门禁：

- 删除 workspace 内所有 doXmind derived files 后，Page 的全部知识语义保持不变。
- 删除 derived index 后，Page/heading/block-id embeds、Collection membership、computed
  values 与 graph edges 可由同一 Page snapshot 零写入重建。
- 新建、打开、编辑、重命名和删除 Page 不产生 `.doxmind`。
- 对 fixture 做任意受支持 block 操作后，未触及 source bytes 不变。
- 外部 Markdown、不支持语法、frontmatter comments 和 legacy artifacts 不被静默覆盖。
- 生产 bundle 没有 TipTap/ProseMirror import，Page API 没有 HTML/Extras 字段。

## 与既有 ADR 的关系

- **深化 ADR-0011**：从“Sidecar 可替代”收敛为“Page 不使用 Sidecar”。
- **取代 ADR-0008 的 Page read model**：Page 不再区分 Sidecar editor HTML 与 browsing
  HTML；二者都是从当前 Markdown 派生的 Adapter view。ADR-0008 仅作历史记录。
- **取代 ADR-0009 的权威目标**：历史 Rust/Python/marked HTML conformance 不再是 Page core
  的终点；source conformance 才是。HTML renderer 可因 preview/export 场景不同而不同。
- **限制 ADR-0002/0003/0004/0005**：只适用于 legacy recovery artifact。
- **保留 ADR-0007**：真实文件树与确定性排序不变。

## 后果

### 正面

- 用户复制、Git commit、同步或用任意 Markdown 工具打开一个文件，就拥有完整 Page。
- block editing、external editing 与 knowledge indexing 共享一份 source，不再做三方
  correlation。
- UI editor 和 storage 可以独立替换；删除 TipTap 不需要再次迁移用户文档。
- hidden recovery files 和 derived cache 不再污染正常 Page 生命周期。

### 代价

- 需要自行实现 selection mapping、IME、clipboard、accessibility 和复杂 block command，
  不能免费继承完整 ProseMirror transaction model。
- lossless frontmatter、CommonMark/GFM 与扩展语法需要明确 grammar 和 conformance corpus。
- raw fallback 的体验不如专用 semantic control，但它始终编辑 canonical Markdown，且
  不会让整个 Page 切换到第二套文档模型。
- 旧 Sidecar 中独有的颜色、alignment、DatabaseBlock 或 attachment edit state 必须先
  inventory/export，不能假装已经迁移成功。
