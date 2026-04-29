"""Default doXmind user guide seeded for new users."""

import markdown

GUIDE_FILENAME = "doXmind 使用指南.md"

GUIDE_MARKDOWN = """# doXmind 使用指南

欢迎使用 doXmind。本地桌面版专注于文件管理、结构化写作、数据库、演示和导出，所有核心工作都在本机完成。

## 1. 快速开始

- 在首页新建空白文档，或从模板直接开始。
- 支持导入 `.md`、`.docx`、`.pdf` 文件继续编辑。
- 用文件夹管理项目，用收藏固定高频文档。

## 2. 编辑器核心能力

### 斜杠命令

输入 `/` 可快速插入标题、列表、引用、代码块、表格、数学公式、Mermaid 图表等常用内容块。

### 基础编辑与查找

- 支持常用文本格式与块级操作。
- 可通过右键菜单快速操作当前内容。
- 按 `Ctrl/Cmd + F` 在文档内快速查找。

### 文档管理与回溯

- **版本历史**：查看并恢复历史版本。
- **大纲 / Mindlines**：快速定位章节结构。
- **文档内搜索**：快速找到关键词位置。

## 3. 数据库与结构化内容

- 在文档中插入表格型数据库，管理任务、资料、联系人或清单。
- 支持表格、看板、属性、排序和筛选。
- 可从 CSV 导入数据并在本地继续整理。

## 4. 搜索与导航

- `Ctrl/Cmd + K`：打开命令面板。
- `Ctrl/Cmd + Tab`：快速切换最近文档。
- `Ctrl/Cmd + F`：文档内查找。
- `Ctrl/Cmd + Shift + O`：切换大纲侧栏。

## 5. 演示模式（Presentation Mode）

- 按 `F5` 或点击工具栏按钮进入演示模式。
- 使用 `---` 分隔线控制幻灯片切分。
- 方向键切换页面，按 `Esc` 退出演示。

## 6. 导入、导出与本地资料

- 支持导入 Markdown、Word、PDF。
- 支持导出为 **Markdown**、**PDF**、**Word**。
- 图片与附件保存在本机应用数据目录中。

## 7. 个性化

- 可自定义主题、排版、编辑器宽度与拼写检查。
- 按 `F11` 进入专注模式，减少干扰。

## 8. 常用快捷键

- `Ctrl/Cmd + K`：打开命令面板。
- `Ctrl/Cmd + F`：文档内搜索。
- `Ctrl/Cmd + /`：查看快捷键面板。
- `F5`：开始演示。
- `F11`：切换专注模式。

## 9. 推荐写作流程

1. 先列出大纲和资料清单。
2. 用标题、引用、表格和数据库组织内容。
3. 通过版本历史保存关键节点。
4. 用大纲和 Mindlines 检查结构。
5. 选择演示、导出或分享。

---

这篇指南会自动出现在文件列表中，你可以随时保留或删除。
"""


def guide_markdown_to_html() -> str:
    """Convert guide markdown to HTML for TipTap storage."""
    return markdown.markdown(GUIDE_MARKDOWN, extensions=["tables", "fenced_code"])
