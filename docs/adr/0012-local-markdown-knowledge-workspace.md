# ADR-0012：本地 Markdown 知识工作区

Status: accepted
Date: 2026-07-20

Update (2026-07-21): [ADR-0012](0012-markdown-source-block-editor.md) refines
decision 6 from “Sidecar may be a replaceable Page cache” to “normal Page
operations do not use a Sidecar”; existing Sidecars remain legacy artifacts, and
[ADR-0015](0015-legacy-sidecars-are-inert.md) confirms nothing reads them.

## 背景

doXmind 已经在 ADR-0001 中决定 Markdown 是唯一 first-class Document，但产品
表面仍同时提供 Markdown、PDF、Excel 三套新建和编辑体验；ADR-0006 又把
backlinks 和 database views 排除在边界之外。结果是架构、产品文案和工程投入
指向三个不同方向：Markdown 本地工作区、Office/PDF 编辑器，以及介于 Typora
和 Notion 之间的富文本编辑器。

PDF 与 Excel 编辑都是没有自然终点的兼容性工程。继续扩展它们会占用本应投入
本地知识组织、链接和可携带数据模型的资源。同时，直接删除已有编辑器会困住只
存在于旧 `.doxmind` sidecar 中、尚未导出的用户修改。

## 决定

1. doXmind 的唯一一级内容是 **Page**；Page 的可携带表达是 `.md` 或
   `.markdown`。
2. 产品方向是“Notion 式编辑与组织 + Obsidian 式本地文件、链接与可重建索引”。
   这不包含 Notion 的云协作系统，也不要求先复制 Obsidian 的插件市场。
3. 当前工作区扫描和原生打开支持的非 Markdown 文档（PDF、spreadsheet、HTML）
   统一建模为 **Attachment**。Attachment 可以显示在文件树中，被预览、引用、
   搜索元数据、Reveal 或 Open Externally，但不拥有独立的新建、编辑、保存和导出
   产品栈。未知格式抵达共享 surface 时可使用 `other` 安全只读 fallback，但这不
   扩张扫描或原生打开白名单。插入 Page 的图片保持为 Markdown assets，不承诺把
   独立图片文件列为 workspace document。
4. 立即移除空白 PDF/Excel 的主导航入口，并把 primary create contract 收缩为
   Page 或 Folder。后端遗留命令在兼容桥完成前可以保留，但不再是产品 API。
5. PDF/Excel 编辑器进入 legacy compatibility：冻结功能；先提供旧 sidecar 的
   检测与显式导出/恢复，再删除编辑器、写端点、parser cache 和专属依赖。任何
   清理都不得静默删除或覆盖源文件、sidecar、`.bak` 或 `.lock`。恢复门禁通过前，
   Attachment 只提供 Open Externally 和 Reveal，不提供可能分离证据的 move、rename、
   delete 或同名 replace。
6. Page 的正文、properties、tags、aliases 和 links 必须位于 Markdown 或 YAML
   frontmatter。Sidecar 只能保存 lossless editor HTML、cache 和可替代 UI state，
   不能是知识内容的唯一副本。
7. Backlinks、search、graph edges 和 collection membership 都由 workspace 文件
   构建，可通过删除索引并全量扫描得到相同结果。
8. Collection 的一行是一篇 Page，Table/Board/Calendar 是基于 frontmatter
   properties 的视图。停止扩展以 `extras.databases` 为唯一数据源的旧
   DatabaseBlock；在 portable Collection 模型落地后迁移或导出旧数据。
9. 文件树继续映射真实目录和确定性排序。Notion 风格的任意 sibling order 不在
   当前边界内。

详细能力表、导航目标、数据模型、迁移门禁和依赖路线图见
[`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md)。

## 与既有 ADR 的关系

- **延续 ADR-0001**：Markdown 仍是唯一 first-class Document；本 ADR 进一步把
  “Second-class editable file”收缩为 Attachment。
- **取代 ADR-0006 的产品上限**：backlinks、Wiki Links、properties 和 portable
  collections 现在属于核心方向。ADR-0006 中关于 Markdown round-trip、math
  gating 等具体兼容性约束仍然有效。
- **保留 ADR-0007**：真实文件树和非手动排序的决定不变。
- **冻结 ADR-0002/0003/0004 中 PDF/Excel 的扩张路径**：其格式、迁移、correlation
  规则继续作为 legacy recovery contract 使用，但不得成为新功能基础。
- **收缩 ADR-0010 的 PDF/Excel surface**：CLI/MCP 可以读取附件或触发显式转换，
  不再承诺 PDF/Excel 编辑能力。

## 后果

### 正面

- 工程投入集中到一个编辑器和一个知识模型。
- Page 在 doXmind 之外仍可被 Obsidian、VS Code、Git 和普通 Markdown 工具读取。
- Backlinks 与 Collections 可以建立在同一份可重建 workspace index 上。
- 不再承担完整 PDF 或 Excel 兼容层的无限范围。

### 代价

- 需要为旧 PDF/Excel sidecar 建立一次明确的恢复桥，不能立即物理删除代码。
- 旧 DatabaseBlock 不能直接扩建，必须先解决 portable data representation。
- `page-link` 需要从 sidecar/标题驱动的节点迁移到可见 Markdown link 语法。
- 过渡期代码仍会包含 legacy editor、endpoint 和测试；它们是数据恢复表面，不是
  路线图承诺。

## 验证

- 新建菜单只有 Page、Folder 和 Template。
- primary frontend create type 不接受 PDF/Excel discriminator 或 binary payload。
- 删除 sidecar 与 workspace index 后，Page 正文、properties、links 和 collection
  rows 不丢失。
- 普通 Attachment 打开不修改源文件；兼容桥完成后也不创建新编辑 sidecar。
- 删除 legacy editor 前，带用户编辑的 PDF/Excel fixture 可以显式导出，且原始
  source 与 sidecar bytes 保持不变。
