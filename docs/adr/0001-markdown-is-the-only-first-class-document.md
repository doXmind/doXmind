# Markdown 是唯一的 first-class document type

doXmind 的产品核心是富文本编辑。PDF 和 Excel 在用户视角下是两种**可以被打开和编辑的文件**，但在架构语义上它们是 **Second-class file**——等价于一个只包含一个对应 Custom Block（PDF 块 / Excel 块）的合成 Document。

之所以记录这条决定，是因为代码现状（独立的 PDF/Excel 编辑器、独立的 sidecar shape、独立的 workspace endpoints）会持续诱导维护者把它们当作和 Markdown 平起平坐的三种 first-class document type 来扩展。每次加一条横切功能（外部编辑检测、版本迁移、recents、search）都会被复制三遍。

**决定**：Markdown 是 first-class。所有其他文档形态都是 Second-class file，并且都通过"内部合成一个只包一个 Custom Block 的 Document"的方式复用 markdown 的读写、sidecar 协调、`extras` 槽位机制。横切功能只在 Markdown 路径上实现一次。

**后果**：今天独立存在的 `read_pdf_editor_state` / `read_excel_editor_state` / `pdf_parsed_cache` 等端点和它们专属的 sidecar 字段是**过渡实现**，长期会被合并进 markdown sidecar 的 `extras` 槽位。任何"再加一种 first-class 文档类型"的提案应该先来订正这条 ADR。
