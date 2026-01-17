# doXmind - 架构设计文档

> Think. Write. Publish. — 一个专注于 Markdown AI 辅助编辑的现代化写作工具

---

## 目录

1. [设计理念](#设计理念)
2. [技术栈选择](#技术栈选择)
3. [系统架构总览](#系统架构总览)
4. [前端架构](#前端架构)
5. [后端架构](#后端架构)
6. [AI Agent 架构](#ai-agent-架构)
7. [数据存储架构](#数据存储架构)
8. [与 doXmind 的对比](#与-doxmind-的对比)

---

## 设计理念

### 核心原则

1. **极简主义** - 只保留 AI 写作的核心功能，删除所有非必要的复杂性
2. **AI 优先** - 每个功能都围绕 AI 辅助设计
3. **实时响应** - 流式输出、即时反馈
4. **本地优先** - 支持离线编辑，数据本地存储
5. **开发者友好** - 清晰的代码结构，易于扩展

### 功能范围

| 核心功能 ✅ | 辅助功能 ✅ | 未实现 ❌ |
|-------------|-------------|-----------|
| Markdown 编辑器 | 命令面板 (Ctrl+K) | CSV 数据分析模式 |
| AI 对话（Chat） | 键盘快捷键 (Ctrl+?) | HTML 幻灯片模式 |
| AI 快速编辑（Quick Edit） | 高对比度模式 | 实时协作（Y.js） |
| AI 自动补全（Autocomplete） | 引导教程 | 复杂权限系统 |
| Diff Review（差异审查） | 网络状态指示 | 工作区共享 |
| 版本历史 | 未保存提醒 | 代码执行功能 |
| 文件管理 | 动态标签标题 | 多用户系统 |
| Mindlines（大纲/思维导图） | 加载骨架屏 | |
| 深色/浅色主题 | Framer Motion 动画 | |
| 知识库附件 | 拖放导入 | |

---

## 技术栈选择

### 前端技术栈 (2026 最新)

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Stack                          │
├─────────────────────────────────────────────────────────────┤
│  Framework:      Next.js 15 (App Router + RSC)              │
│  UI Library:     React 19 + TypeScript 5.x                  │
│  Styling:        Tailwind CSS 4.0 + shadcn/ui               │
│  Editor:         TipTap 3.x (with AI extensions)            │
│  State:          Zustand + React Query (TanStack Query)     │
│  Animation:      Framer Motion (流畅 UI 动画)               │
│  Visualization:  ReactFlow (思维导图可视化)                 │
│  Desktop:        Tauri 2.0 (可选，用于桌面版)                │
└─────────────────────────────────────────────────────────────┘
```

### 后端技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                     Backend Stack                           │
├─────────────────────────────────────────────────────────────┤
│  Runtime:        Python 3.12+ / FastAPI                     │
│  AI Framework:   LangGraph 1.0 + LangChain 1.0              │
│  LLM Provider:   Claude API (Anthropic) - 主力              │
│                  Web Tools (search/fetch) - 实时信息        │
│  Vector DB:      PostgreSQL + pgvector                      │
│  Database:       PostgreSQL (生产) / SQLite (开发)          │
│  Embedding:      OpenAI text-embedding-3-small (1536 维)    │
│  File Convert:   Gemini API (PDF/DOCX/PPTX → Markdown)      │
│  Skills:         领域知识系统 (写作/研究/内容)               │
└─────────────────────────────────────────────────────────────┘
```

### 为什么选择这些技术？

| 技术 | 选择理由 |
|------|----------|
| **Next.js 15** | Server Components 减少客户端 JS，App Router 更好的文件组织，内置流式渲染 |
| **TipTap 3.x** | 官方 Markdown 扩展，AI Toolkit 支持，ProseMirror 稳定性 |
| **FastAPI** | 异步原生，自动 OpenAPI 文档，类型提示，比 Flask 更现代 |
| **LangGraph 1.0** | 生产级 Agent 编排，持久化执行，人机协作支持 |
| **Claude API** | 最强的写作能力，200K 上下文，原生工具调用，Web Tools 支持 |
| **pgvector** | PostgreSQL 原生向量扩展，统一数据库，支持精确查询 |
| **OpenAI Embeddings** | text-embedding-3-small 高质量嵌入，1536 维向量 |
| **Gemini API** | 高效的文档转换，支持 PDF/DOCX/PPTX 多格式 |
| **Zustand** | 比 Redux 更简单，比 Context 更高效，完美适配 Next.js |
| **Framer Motion** | 声明式动画 API，优秀的性能，React 生态最佳动画库 |
| **ReactFlow** | 高性能节点图渲染，完美支持思维导图场景 |

---

## 系统架构总览

```
┌────────────────────────────────────────────────────────────────────────────┐
│                               doXmind                                       │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Frontend (Next.js 15)                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │   │
│  │  │   Editor     │  │   AI Chat    │  │   Sidebar    │               │   │
│  │  │  (TipTap)    │  │   Panel      │  │  (Files)     │               │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │   │
│  │         │                 │                  │                       │   │
│  │         └─────────────────┼──────────────────┘                       │   │
│  │                           │                                          │   │
│  │                    ┌──────▼───────┐                                  │   │
│  │                    │  API Client  │                                  │   │
│  │                    │ (React Query)│                                  │   │
│  │                    └──────┬───────┘                                  │   │
│  └───────────────────────────┼──────────────────────────────────────────┘   │
│                              │ HTTP/SSE                                     │
│  ┌───────────────────────────▼──────────────────────────────────────────┐   │
│  │                         Backend (FastAPI)                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │   Chat API   │  │  Edit API    │  │  Files API   │                │   │
│  │  │  (Streaming) │  │ (Quick Edit) │  │   (CRUD)     │                │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │   │
│  │         │                 │                  │                        │   │
│  │         └─────────────────┼──────────────────┘                        │   │
│  │                           │                                           │   │
│  │                    ┌──────▼───────┐                                   │   │
│  │                    │  LangGraph   │                                   │   │
│  │                    │    Agent     │                                   │   │
│  │                    └──────┬───────┘                                   │   │
│  │                           │                                           │   │
│  │         ┌─────────────────┼─────────────────┐                         │   │
│  │         │                 │                 │                         │   │
│  │  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐                │   │
│  │  │  Claude API  │  │  RAG Engine  │  │  File Tools  │                │   │
│  │  │  (LLM+Web)   │  │  (pgvector)  │  │  (Local FS)  │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  │                           │                                          │   │
│  │         ┌─────────────────┼─────────────────┐                        │   │
│  │  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐               │   │
│  │  │   Skills     │  │   Gemini     │  │  Web Tools   │               │   │
│  │  │   System     │  │  Converter   │  │ (Search/Fetch)│               │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Storage Layer                                  │  │
│  │  ┌──────────────────────────────────────┐  ┌──────────────┐           │  │
│  │  │     PostgreSQL + pgvector            │  │  Local FS    │           │  │
│  │  │  (Metadata + Vectors + Embeddings)   │  │  (Content)   │           │  │
│  │  └──────────────────────────────────────┘  └──────────────┘           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 前端架构

### 目录结构

```
src/
├── app/                          # Next.js 15 App Router
│   ├── layout.tsx                # 根布局 (Server Component)
│   ├── page.tsx                  # 首页 (Landing Page)
│   ├── globals.css               # 全局样式 + CSS 变量
│   ├── api/                      # API Route Handlers (可选)
│   │   └── [...proxy]/route.ts   # 代理到 Python 后端
│   └── editor/                   # 编辑器路由
│       └── page.tsx              # 编辑器主页面
│
├── components/                   # React 组件
│   ├── editor/                   # 编辑器相关
│   │   ├── editor.tsx            # TipTap 编辑器主组件
│   │   ├── editor-toolbar.tsx    # 工具栏
│   │   ├── bubble-menu.tsx       # 选中文本浮动菜单 (Framer Motion)
│   │   ├── search-toolbar.tsx    # 浮动搜索工具栏
│   │   ├── diff-review-toolbar.tsx # AI 差异审查工具栏
│   │   ├── editor-skeleton.tsx   # 编辑器加载骨架
│   │   └── mindlines/            # 大纲/思维导图
│   │       ├── mindlines.tsx     # 主组件
│   │       ├── outline-view.tsx  # 大纲视图
│   │       ├── outline-toggle.tsx # 浮动切换按钮
│   │       ├── mindmap-flow.tsx  # ReactFlow 思维导图
│   │       └── flow-nodes/       # 自定义节点
│   │
│   ├── ai/                       # AI 功能组件
│   │   ├── chat-panel.tsx        # AI 对话面板 (Framer Motion 动画)
│   │   ├── chat-input.tsx        # 输入框 (支持 @ 文件引用)
│   │   ├── chat-message.tsx      # 消息气泡
│   │   ├── chat-skeleton.tsx     # 聊天加载骨架
│   │   ├── quick-edit-menu.tsx   # 快速编辑菜单 (spring 动画)
│   │   ├── attachment-menu.tsx   # 统一附件菜单 (图片+文档+KB)
│   │   └── streaming-text.tsx    # 流式文本渲染
│   │
│   ├── sidebar/                  # 侧边栏
│   │   ├── sidebar.tsx           # 侧边栏主组件
│   │   ├── sidebar-skeleton.tsx  # 侧边栏加载骨架
│   │   └── file-tree/            # 文件树组件
│   │
│   ├── onboarding/               # 引导功能
│   │   └── onboarding-tour.tsx   # 新用户引导教程
│   │
│   ├── ui/                       # 基础 UI 组件 (shadcn/ui)
│   │   ├── command-palette.tsx   # 命令面板 (Ctrl+K)
│   │   ├── keyboard-shortcuts-modal.tsx # 快捷键帮助
│   │   ├── network-status-indicator.tsx # 网络状态
│   │   ├── success-animation.tsx # 成功动画
│   │   ├── animated-logo.tsx     # 动画 Logo
│   │   ├── skeleton.tsx          # 骨架屏基础组件
│   │   └── ...                   # 其他 shadcn 组件
│   │
│   ├── layout/                   # 布局组件
│   │   ├── header.tsx            # 顶部导航
│   │   └── theme-toggle.tsx      # 主题切换
│   │
│   ├── loading-screen.tsx        # 加载屏幕 (Logo + 骨架)
│   └── welcome-screen.tsx        # 欢迎页面 (拖放导入)
│
├── extensions/                   # TipTap 扩展
│   ├── diff-review/              # 差异审查扩展
│   │   ├── index.ts              # 主扩展逻辑
│   │   └── diff-widgets.ts       # Diff 装饰器
│   └── search/                   # 搜索扩展
│       └── index.ts              # 搜索高亮 + 导航
│
├── hooks/                        # 自定义 Hooks
│   ├── use-chat.ts               # AI 对话逻辑
│   ├── use-quick-edit.ts         # 快速编辑逻辑
│   ├── use-autocomplete.ts       # 自动补全逻辑
│   ├── use-files.ts              # 文件操作
│   ├── use-stream.ts             # SSE 流式处理
│   ├── use-high-contrast.ts      # 高对比度模式
│   ├── use-network-status.ts     # 网络状态检测
│   └── use-unsaved-changes-warning.ts # 未保存提醒
│
├── lib/                          # 工具函数
│   ├── api.ts                    # API 客户端配置
│   ├── markdown.ts               # Markdown 工具 (turndown-plugin-gfm)
│   ├── diff-utils.ts             # Diff 算法工具
│   ├── diff-algorithms.ts        # Myers diff 实现
│   └── utils.ts                  # 通用工具 + 错误消息映射
│
├── stores/                       # Zustand 状态管理
│   ├── editor-store.ts           # 编辑器状态
│   ├── file-store.ts             # 文件状态
│   ├── chat-store.ts             # 对话状态 (含 contexts)
│   ├── layout-store.ts           # 布局状态 (高对比度等)
│   └── settings-store.ts         # 设置状态
│
└── types/                        # TypeScript 类型
    ├── editor.ts
    ├── file.ts
    ├── chat.ts
    ├── diff.ts                   # Diff 相关类型
    └── turndown-plugin-gfm.d.ts  # 类型声明
```

### 核心组件设计

#### 1. Editor 组件 (TipTap)

```tsx
// components/editor/Editor.tsx
'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Markdown from '@tiptap/extension-markdown';
import { AIAutocomplete } from './extensions/ai-autocomplete';
import { AICommands } from './extensions/ai-commands';

interface EditorProps {
  content: string;
  fileId: string;
  onChange: (content: string) => void;
}

export function Editor({ content, fileId, onChange }: EditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        transformPastedText: true,
      }),
      AIAutocomplete.configure({
        debounceMs: 500,
        onSuggestion: handleSuggestion,
      }),
      AICommands,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown());
    },
  });

  return (
    <div className="editor-container">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} className="prose dark:prose-invert" />
      <BubbleMenu editor={editor} />
    </div>
  );
}
```

#### 2. AI Chat Panel

```tsx
// components/ai/ChatPanel.tsx
'use client';

import { useChatStore } from '@/stores/chat-store';
import { useStream } from '@/hooks/useStream';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';

export function ChatPanel() {
  const { messages, addMessage, updateLastMessage } = useChatStore();

  const { send, isStreaming, cancel } = useStream({
    url: '/api/chat/stream',
    onChunk: (chunk) => updateLastMessage(chunk),
  });

  const handleSend = async (input: string, files: string[]) => {
    addMessage({ role: 'user', content: input, files });
    addMessage({ role: 'assistant', content: '' });
    await send({ message: input, files });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
      </div>
      <ChatInput
        onSend={handleSend}
        isStreaming={isStreaming}
        onCancel={cancel}
      />
    </div>
  );
}
```

#### 3. Quick Edit 菜单

```tsx
// components/ai/QuickEditMenu.tsx
'use client';

import { useQuickEdit } from '@/hooks/useQuickEdit';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

const QUICK_EDIT_OPTIONS = [
  { id: 'fix-grammar', label: '修正语法', icon: '✓' },
  { id: 'improve', label: '改进写作', icon: '✨' },
  { id: 'simplify', label: '简化语言', icon: '📝' },
  { id: 'expand', label: '扩展内容', icon: '📖' },
  { id: 'shorten', label: '精简内容', icon: '✂️' },
  { id: 'translate-en', label: '翻译为英文', icon: '🌐' },
  { id: 'translate-zh', label: '翻译为中文', icon: '🌐' },
  { id: 'professional', label: '更专业', icon: '💼' },
  { id: 'casual', label: '更随意', icon: '😊' },
];

interface QuickEditMenuProps {
  selectedText: string;
  position: { x: number; y: number };
  onApply: (newText: string) => void;
}

export function QuickEditMenu({ selectedText, position, onApply }: QuickEditMenuProps) {
  const { edit, isEditing } = useQuickEdit();

  const handleSelect = async (action: string) => {
    const result = await edit(selectedText, action);
    onApply(result);
  };

  return (
    <DropdownMenu>
      <DropdownMenuContent style={{ left: position.x, top: position.y }}>
        {QUICK_EDIT_OPTIONS.map(option => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => handleSelect(option.id)}
            disabled={isEditing}
          >
            <span className="mr-2">{option.icon}</span>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 状态管理 (Zustand)

```typescript
// stores/editor-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface EditorState {
  currentFileId: string | null;
  content: string;
  isDirty: boolean;
  cursorPosition: { line: number; column: number };
  selection: { from: number; to: number } | null;

  // Actions
  setContent: (content: string) => void;
  setCurrentFile: (fileId: string) => void;
  setSelection: (selection: { from: number; to: number } | null) => void;
  markClean: () => void;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      currentFileId: null,
      content: '',
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      selection: null,

      setContent: (content) => set({ content, isDirty: true }),
      setCurrentFile: (fileId) => set({ currentFileId: fileId }),
      setSelection: (selection) => set({ selection }),
      markClean: () => set({ isDirty: false }),
    }),
    { name: 'editor-store' }
  )
);
```

---

## 后端架构

### 目录结构

```
server/
├── main.py                       # FastAPI 应用入口
├── config.py                     # 配置管理
├── requirements.txt              # Python 依赖
│
├── api/                          # API 路由
│   ├── __init__.py
│   ├── chat.py                   # AI 对话端点 (含 contexts 支持)
│   ├── edit.py                   # 快速编辑端点
│   ├── autocomplete.py           # 自动补全端点
│   ├── files.py                  # 文件操作端点
│   ├── versions.py               # 版本历史端点
│   ├── knowledge_base.py         # 知识库附件 API (file_id 查询)
│   └── import_file.py            # 文件导入 API
│
├── agents/                       # LangGraph Agents
│   ├── __init__.py
│   ├── writing_agent.py          # 主写作 Agent
│   ├── tools/                    # Agent 工具
│   │   ├── __init__.py
│   │   ├── file_tools.py         # 文件读写工具
│   │   ├── search_tools.py       # 内容搜索工具
│   │   └── kb_tools.py           # 知识库搜索工具
│   └── prompts/                  # 系统提示词
│       ├── base.py               # 基础提示词 (指定 markdown 格式)
│       └── prompts.py            # 模式提示词
│
├── services/                     # 业务服务
│   ├── __init__.py
│   ├── llm_service.py            # LLM 调用服务
│   ├── rag_service.py            # pgvector RAG 检索服务
│   ├── gemini_converter.py       # Gemini 文件转换服务
│   ├── skills_service.py         # Skills 领域知识服务
│   ├── file_service.py           # 文件管理服务
│   └── version_service.py        # 版本控制服务
│
├── skills/                       # 领域知识目录
│   ├── essay-writing/            # 论文写作
│   │   ├── SKILL.md              # 技能定义
│   │   ├── templates/            # 模板文件
│   │   └── knowledge/            # 知识文件
│   ├── research-analysis/        # 研究分析
│   └── content-writing/          # 内容创作
│
├── models/                       # 数据模型
│   ├── __init__.py
│   ├── file.py                   # 文件模型
│   ├── message.py                # 消息模型 (含 contexts 字段)
│   └── version.py                # 版本模型
│
├── db/                           # 数据库
│   ├── __init__.py
│   ├── database.py               # PostgreSQL + pgvector 连接
│   ├── init.sql                  # pgvector 初始化脚本
│   └── migrations/               # 数据库迁移
│
├── migrations/                   # 独立迁移脚本
│   └── add_contexts_column.py    # 添加 contexts 列
│
└── utils/                        # 工具函数
    ├── __init__.py
    ├── markdown.py               # Markdown 处理
    └── streaming.py              # SSE 流式响应
```

### 核心 API 设计

#### FastAPI 应用入口

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api import chat, edit, autocomplete, files, versions
from db.database import init_db
from services.rag_service import init_vector_store

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化
    await init_db()
    await init_vector_store()
    yield
    # 关闭时清理

app = FastAPI(
    title="AI Writing Studio API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(edit.router, prefix="/api/edit", tags=["edit"])
app.include_router(autocomplete.router, prefix="/api/autocomplete", tags=["autocomplete"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(versions.router, prefix="/api/versions", tags=["versions"])
```

#### Chat API (流式响应)

```python
# api/chat.py
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import json

from agents.writing_agent import WritingAgent
from services.file_service import FileService

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    file_ids: List[str] = []
    mode: str = "edit"  # "edit" | "analyze"
    conversation_id: Optional[str] = None

@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """流式 AI 对话"""

    # 获取文件上下文
    file_service = FileService()
    context_files = []
    for file_id in request.file_ids:
        file = await file_service.get_file(file_id)
        if file:
            context_files.append({
                "id": file.id,
                "name": file.name,
                "content": file.content[:50000]  # 限制上下文大小
            })

    # 创建 Agent
    agent = WritingAgent(mode=request.mode)

    async def generate():
        async for event in agent.stream(
            message=request.message,
            files=context_files,
            conversation_id=request.conversation_id
        ):
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
```

#### Quick Edit API

```python
# api/edit.py
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

from services.llm_service import LLMService

router = APIRouter()

class QuickEditRequest(BaseModel):
    text: str
    action: str  # "fix-grammar" | "improve" | "simplify" | etc.
    context: str = ""  # 周围文本上下文

EDIT_PROMPTS = {
    "fix-grammar": "修正以下文本的语法和拼写错误，保持原意不变：",
    "improve": "改进以下文本的表达，使其更流畅专业：",
    "simplify": "用更简单的语言重写以下文本：",
    "expand": "扩展以下文本，添加更多细节和解释：",
    "shorten": "精简以下文本，保留核心信息：",
    "translate-en": "将以下文本翻译为英文：",
    "translate-zh": "将以下文本翻译为中文：",
    "professional": "将以下文本改写为更专业的语气：",
    "casual": "将以下文本改写为更轻松随意的语气：",
}

@router.post("/quick")
async def quick_edit(request: QuickEditRequest):
    """快速编辑选中文本"""

    prompt = EDIT_PROMPTS.get(request.action, "改进以下文本：")

    llm = LLMService()

    async def generate():
        async for chunk in llm.stream(
            system="你是一个专业的文字编辑助手。只输出修改后的文本，不要添加任何解释。",
            user=f"{prompt}\n\n{request.text}"
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

#### Autocomplete API

```python
# api/autocomplete.py
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from services.llm_service import LLMService

router = APIRouter()

class AutocompleteRequest(BaseModel):
    text_before: str      # 光标前的文本
    text_after: str = ""  # 光标后的文本
    file_name: str = ""
    max_tokens: int = 100

@router.post("/suggest")
async def suggest(request: AutocompleteRequest):
    """GitHub Copilot 风格的自动补全"""

    llm = LLMService(model="claude-3-haiku-20240307")  # 用快速模型

    prompt = f"""继续写下面的文本。只输出补全内容，不要重复已有内容。

文件: {request.file_name}

已有内容:
{request.text_before[-2000:]}

[在这里继续写]

{request.text_after[:500]}
"""

    suggestion = await llm.complete(
        prompt=prompt,
        max_tokens=request.max_tokens,
        stop=["\n\n", "```"]  # 合适的停止符
    )

    return {"suggestion": suggestion.strip()}
```

---

## AI Agent 架构

### LangGraph 写作 Agent

```python
# agents/writing_agent.py
from typing import Annotated, TypedDict, List
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from .tools.file_tools import read_file, write_file, search_files
from .tools.web_tools import fetch_url
from .prompts.base import get_system_prompt

class AgentState(TypedDict):
    """Agent 状态"""
    messages: List[dict]
    files: List[dict]
    mode: str
    current_file_id: str | None

class WritingAgent:
    """LangGraph 写作 Agent"""

    def __init__(self, mode: str = "edit"):
        self.mode = mode
        self.llm = ChatAnthropic(
            model="claude-sonnet-4-20250514",
            temperature=0.7,
            max_tokens=8192,
            streaming=True
        )
        self.tools = self._get_tools()
        self.graph = self._build_graph()

    def _get_tools(self):
        """根据模式返回可用工具"""
        tools = [read_file, search_files]

        if self.mode == "edit":
            tools.extend([write_file])

        return tools

    def _build_graph(self) -> StateGraph:
        """构建 LangGraph"""

        # 绑定工具到 LLM
        llm_with_tools = self.llm.bind_tools(self.tools)

        def should_continue(state: AgentState) -> str:
            """决定是继续调用工具还是结束"""
            last_message = state["messages"][-1]
            if hasattr(last_message, "tool_calls") and last_message.tool_calls:
                return "tools"
            return END

        def call_model(state: AgentState) -> AgentState:
            """调用 LLM"""
            system = get_system_prompt(
                mode=state["mode"],
                files=state["files"]
            )
            messages = [SystemMessage(content=system)] + state["messages"]
            response = llm_with_tools.invoke(messages)
            return {"messages": state["messages"] + [response]}

        # 构建图
        workflow = StateGraph(AgentState)
        workflow.add_node("agent", call_model)
        workflow.add_node("tools", ToolNode(self.tools))

        workflow.set_entry_point("agent")
        workflow.add_conditional_edges("agent", should_continue)
        workflow.add_edge("tools", "agent")

        return workflow.compile()

    async def stream(self, message: str, files: List[dict], conversation_id: str = None):
        """流式执行 Agent"""

        initial_state = {
            "messages": [HumanMessage(content=message)],
            "files": files,
            "mode": self.mode,
            "current_file_id": files[0]["id"] if files else None
        }

        async for event in self.graph.astream_events(initial_state, version="v2"):
            kind = event["event"]

            if kind == "on_chat_model_stream":
                # 流式输出 LLM 响应
                chunk = event["data"]["chunk"]
                if chunk.content:
                    yield {
                        "type": "text",
                        "content": chunk.content
                    }

            elif kind == "on_tool_start":
                # 工具开始执行
                yield {
                    "type": "tool_start",
                    "tool": event["name"],
                    "input": event["data"]["input"]
                }

            elif kind == "on_tool_end":
                # 工具执行完成
                yield {
                    "type": "tool_end",
                    "tool": event["name"],
                    "output": event["data"]["output"]
                }
```

### Agent 工具定义

```python
# agents/tools/file_tools.py
from langchain_core.tools import tool
from typing import Optional

from services.file_service import FileService

file_service = FileService()

@tool
async def read_file(file_path: str) -> str:
    """读取文件内容。

    Args:
        file_path: 文件路径或文件名

    Returns:
        文件内容
    """
    file = await file_service.get_file_by_path(file_path)
    if not file:
        return f"Error: 文件 '{file_path}' 不存在"
    return file.content

@tool
async def write_file(file_path: str, content: str) -> str:
    """写入或更新文件内容。

    Args:
        file_path: 文件路径
        content: 要写入的内容

    Returns:
        操作结果
    """
    await file_service.save_file(file_path, content)
    return f"成功写入文件: {file_path}"

@tool
async def search_files(query: str, pattern: Optional[str] = None) -> str:
    """在所有文件中搜索内容。

    Args:
        query: 搜索关键词
        pattern: 文件名模式 (可选，如 "*.md")

    Returns:
        匹配的文件和内容片段
    """
    results = await file_service.search(query, pattern)
    if not results:
        return "未找到匹配的内容"

    output = []
    for r in results[:10]:  # 限制结果数量
        output.append(f"📄 {r['file_path']}:\n{r['snippet']}\n")

    return "\n".join(output)
```

### 系统提示词

```python
# agents/prompts/base.py
from typing import List

def get_system_prompt(mode: str, files: List[dict]) -> str:
    """生成系统提示词"""

    base = """你是 AI Writing Studio 的写作助手，专注于帮助用户进行 Markdown 文档的创作和编辑。

## 你的能力

1. **写作辅助**: 帮助用户撰写、改进、扩展文章
2. **编辑润色**: 修正语法、改善表达、调整语气
3. **结构建议**: 提供文章结构和大纲建议
4. **翻译**: 中英文互译

## 输出格式

- 使用 Markdown 格式
- 代码使用代码块包裹
- 保持简洁清晰的表达

"""

    if mode == "edit":
        base += """
## 编辑模式

你可以直接读写用户的文件。当用户要求修改时：
1. 先读取相关文件
2. 进行修改
3. 写回文件
4. 简要说明你做了什么修改

"""

    elif mode == "analyze":
        base += """
## 分析模式

你只能读取文件，不能修改。专注于：
1. 分析文章结构和内容
2. 提供改进建议
3. 回答关于文档的问题

"""

    # 添加文件上下文
    if files:
        base += "\n## 当前上下文文件\n\n"
        for f in files[:5]:  # 限制数量
            base += f"### {f['name']}\n```\n{f['content'][:3000]}\n```\n\n"

    return base
```

---

## 数据存储架构

### SQLite 数据模型

```python
# models/file.py
from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from db.database import Base

class File(Base):
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    path = Column(String(1024), nullable=False)
    content = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联
    versions = relationship("FileVersion", back_populates="file")

class FileVersion(Base):
    __tablename__ = "file_versions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id = Column(String(36), ForeignKey("files.id"), nullable=False)
    content = Column(Text, nullable=False)
    diff = Column(Text)  # JSON 格式的差异
    edit_type = Column(String(50))  # "manual" | "ai_edit" | "ai_quick_edit"
    summary = Column(String(500))  # AI 生成的变更摘要
    created_at = Column(DateTime, default=datetime.utcnow)

    file = relationship("File", back_populates="versions")

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id = Column(String(36), ForeignKey("files.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("Message", back_populates="conversation")

class Message(Base):
    __tablename__ = "messages"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id"))
    role = Column(String(20))  # "user" | "assistant"
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="messages")
```

### RAG 向量存储服务 (pgvector)

```python
# services/rag_service.py
"""RAG Service using PostgreSQL pgvector for vector storage.

This module provides vector search capabilities using pgvector extension:
- Document chunks (for cross-file search)
- Sentence-level chunks (for in-document search)
- Knowledge base attachments (for conversation-scoped search)

Requires: PostgreSQL with pgvector extension enabled
"""

import openai
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from abc import ABC, abstractmethod

# Embedding dimension for text-embedding-3-small
EMBEDDING_DIMENSION = 1536


class ChunkingStrategy(ABC):
    """Abstract base class for text chunking strategies."""

    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        pass


class OverlapChunkingStrategy(ChunkingStrategy):
    """Chunk text with overlapping windows."""

    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk(self, text: str) -> list[str]:
        if not text.strip():
            return []

        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]

            # Try to break at sentence boundary
            if end < len(text):
                for sep in ["\u3002", ".", "\n\n", "\n"]:
                    last_sep = chunk.rfind(sep)
                    if last_sep > self.chunk_size // 2:
                        chunk = chunk[:last_sep + 1]
                        end = start + last_sep + 1
                        break

            chunk = chunk.strip()
            if chunk:
                chunks.append(chunk)

            start = end - self.overlap

        return chunks


class RAGService:
    """基于 pgvector 的 RAG 服务"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.openai_client = openai.AsyncOpenAI()
        self.chunking_strategy = OverlapChunkingStrategy()

    async def _get_embedding(self, text: str) -> list[float]:
        """Get embedding from OpenAI text-embedding-3-small."""
        response = await self.openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    async def index_file(self, file_id: str, content: str, metadata: dict = None):
        """索引文件内容到 pgvector"""
        chunks = self.chunking_strategy.chunk(content)

        for i, chunk in enumerate(chunks):
            embedding = await self._get_embedding(chunk)
            await self.session.execute(
                text("""
                    INSERT INTO document_chunks (file_id, chunk_index, content, embedding, metadata)
                    VALUES (:file_id, :chunk_index, :content, :embedding, :metadata)
                    ON CONFLICT (file_id, chunk_index) DO UPDATE
                    SET content = :content, embedding = :embedding
                """),
                {
                    "file_id": file_id,
                    "chunk_index": i,
                    "content": chunk,
                    "embedding": embedding,
                    "metadata": metadata or {}
                }
            )
        await self.session.commit()

    async def search(self, query: str, file_ids: List[str] = None, top_k: int = 5) -> List[dict]:
        """语义搜索 using pgvector cosine similarity"""
        query_embedding = await self._get_embedding(query)

        sql = """
            SELECT file_id, chunk_index, content, metadata,
                   1 - (embedding <=> :embedding) as similarity
            FROM document_chunks
            WHERE (:file_ids IS NULL OR file_id = ANY(:file_ids))
            ORDER BY embedding <=> :embedding
            LIMIT :top_k
        """

        result = await self.session.execute(
            text(sql),
            {"embedding": query_embedding, "file_ids": file_ids, "top_k": top_k}
        )

        return [
            {
                "file_id": row.file_id,
                "content": row.content,
                "metadata": row.metadata,
                "similarity": row.similarity
            }
            for row in result.fetchall()
        ]

    async def delete_file(self, file_id: str):
        """删除文件的所有向量"""
        await self.session.execute(
            text("DELETE FROM document_chunks WHERE file_id = :file_id"),
            {"file_id": file_id}
        )
        await self.session.commit()
```

---

## 与 doXmind 的对比

### 架构简化对比

| 方面 | doXmind | AI Writing Studio |
|------|---------|-------------------|
| **前端框架** | Vue 3 + Vite | Next.js 15 (RSC) |
| **后端框架** | Flask | FastAPI |
| **AI 框架** | LangChain + LangGraph | LangGraph 1.0 (更专注) |
| **编辑器** | TipTap 2.x | TipTap 3.x (官方 Markdown) |
| **协作** | Y.js (复杂) | 无 (本地优先) |
| **数据库** | SQLite + S3 | PostgreSQL + pgvector |
| **向量库** | 无 | pgvector (统一存储) |
| **嵌入模型** | 无 | OpenAI text-embedding-3-small |
| **文件转换** | MarkItDown | Gemini API |
| **认证** | Google OAuth + JWT | Google OAuth + JWT |
| **Agent 模式** | 4种 (edit/analyze/csv/slides) | 2种 (edit/analyze) |
| **工具数量** | 15+ MCP 工具 | 核心工具 + Web Tools |
| **Skills 系统** | 无 | 3个领域 (写作/研究/内容) |

### 代码量对比 (估算)

```
doXmind:
├── Frontend: ~25,000 行
├── Backend:  ~15,000 行
└── 总计:     ~40,000 行

AI Writing Studio:
├── Frontend: ~8,000 行
├── Backend:  ~4,000 行
└── 总计:     ~12,000 行

减少: ~70%
```

### 功能对比

```
✅ 核心功能:
   - Markdown WYSIWYG 编辑
   - AI 对话 (Chat) + Framer Motion 动画
   - AI 快速编辑 (Quick Edit) + spring 动画
   - AI Diff Review (差异审查) + 跨块替换
   - AI 自动补全 (Autocomplete)
   - Mindlines (大纲 + 思维导图)
   - 文件管理 + 拖放导入
   - 版本历史
   - 知识库附件 (PDF/DOCX/PPTX)
   - 深色/浅色/高对比度主题

✅ 用户体验功能:
   - 命令面板 (Ctrl+K)
   - 键盘快捷键帮助 (Ctrl+?)
   - 新用户引导教程
   - 加载骨架屏 + 动画 Logo
   - 网络状态指示器
   - 未保存更改提醒
   - 动态浏览器标签标题
   - Skip-to-content 无障碍支持

❌ 未实现的功能:
   - 实时协作 (Y.js)
   - 多用户 & 权限系统
   - CSV 数据分析模式
   - HTML 幻灯片模式
   - 代码执行功能

🆕 技术亮点:
   - pgvector 向量搜索 (PostgreSQL 原生)
   - OpenAI text-embedding-3-small 嵌入
   - Gemini API 文件转换 (PDF/DOCX/PPTX)
   - Skills 领域知识系统
   - Web Tools (search/fetch)
   - GFM 表格支持 (turndown-plugin-gfm)
   - 跨块差异替换算法
   - ReactFlow 思维导图可视化
   - Framer Motion 全局动画系统
```

---

## 快速启动指南

### 前端

```bash
# 创建项目
npx create-next-app@latest ai-writing-studio --typescript --tailwind --app

# 安装依赖
cd ai-writing-studio
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-markdown
npm install zustand @tanstack/react-query
npm install lucide-react class-variance-authority clsx tailwind-merge

# 启动开发服务器
npm run dev
```

### 后端

```bash
# 创建项目
mkdir server && cd server
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install fastapi uvicorn[standard] sqlalchemy asyncpg
pip install langchain langchain-anthropic langgraph
pip install openai  # for embeddings
pip install google-genai  # for file conversion

# 启动服务器
uvicorn main:app --reload --port 8000
```

### 环境变量

```env
# .env.local (前端)
NEXT_PUBLIC_API_URL=http://localhost:8000

# .env (后端)
# API Keys (all required)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx          # for embeddings
GOOGLE_API_KEY=xxx             # for file conversion

# Database (PostgreSQL + pgvector)
DATABASE_URL=postgresql+asyncpg://doxmind:doxmind123@localhost:5433/doxmind
PGVECTOR_ENABLED=true
```

---

## 下一步

1. **Phase 1**: 搭建基础框架 (Next.js + FastAPI)
2. **Phase 2**: 实现 TipTap 编辑器 + Markdown 支持
3. **Phase 3**: 集成 Claude API + 流式响应
4. **Phase 4**: 实现 Quick Edit + Autocomplete
5. **Phase 5**: 添加 RAG 功能
6. **Phase 6**: 打包 Tauri 桌面应用 (可选)

---

## 参考资源

- [LangGraph 文档](https://docs.langchain.com/oss/python/langgraph/overview)
- [Claude API 文档](https://platform.claude.com/docs/en/release-notes/overview)
- [TipTap 编辑器](https://tiptap.dev/)
- [Next.js 15 文档](https://nextjs.org/docs/app)
- [pgvector](https://github.com/pgvector/pgvector)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Gemini API](https://ai.google.dev/)
- [Framer Motion](https://www.framer.com/motion/)
- [ReactFlow](https://reactflow.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
