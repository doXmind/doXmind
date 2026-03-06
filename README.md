# doXmind

> Think. Write. Publish.  
> AI-native writing workspace for Markdown creators.

doXmind 是一个面向写作场景的 AI 工作台：把结构化文档编辑、对话式协作、知识检索与发布分享放进同一套工作流里。你可以把它理解为「面向写作者的 Cursor」。

## 为什么是 doXmind

- AI 写作主链路完整：`Chat -> Tool Call -> Diff Review -> Apply`，支持流式输出和可审阅修改。
- 编辑器不是“聊天外挂”：基于 TipTap 3 深度集成，支持块级编辑、选区快速改写、自动补全、结构大纲。
- 文档能力覆盖全生命周期：创建、版本、导入、导出、分享、社区互动一体化。
- 多源上下文：当前文档、会话附件、图片、数据文件、技能模板可同时参与推理。
- 工程可扩展：前端 Zustand 模块化状态，后端 FastAPI 分层 + Agent 工具体系。

## 核心能力

### 写作与编辑

- TipTap 3 富文本/Markdown 双向编辑
- Quick Edit（润色、扩写、缩写、改语气、翻译等）
- AI 自动补全（短上下文/长上下文策略）
- Diff Review（逐条接受/拒绝 AI 修改）
- Mindlines（文档大纲与结构导航）
- 版本历史与回滚

### AI 协作

- 流式对话（SSE）
- 工具调用可视化（tool start/end、thinking、usage）
- Skills 领域技能系统（academic/business/content/technical 等）
- 全局 Agent / KB Agent（跨文档问答与检索）
- Web Search / Web Fetch 能力（可配置开关）

### 资产与内容流转

- 导入：`PDF / DOCX / PPTX / MD`
- 导出：`Markdown / DOCX / PDF`
- 会话知识库附件（文档转换 + 检索）
- 数据文件分析入口（CSV/Excel/JSON 等）
- 分享链接、社区发布、评论、收藏、通知

## 最新架构概览

### 前端

- **Framework**: Next.js 15 (App Router) + React 19 + TypeScript
- **Editor**: TipTap 3 + 自定义扩展（diff-review/search/autocomplete/spellcheck/block-selection）
- **State**: Zustand（按域拆分 store）
- **UI**: Tailwind CSS + Framer Motion

关键状态域（部分）：

- `file-store` / `editor-store` / `chat-store`
- `streaming-store` / `diff-review-store` / `outline-store`
- `kb-store` / `data-files-store` / `global-agent-store`
- `auth-store` / `settings-store` / `telemetry-store`

### 后端

- **Framework**: FastAPI + SQLAlchemy 2.0 (async)
- **Agent Runtime**: 基于 OpenRouter 的工具调用循环（非黑盒）
- **AI 接入**: OpenRouter（支持服务端 Key + 用户 BYOK）
- **Auth**: JWT 双 token（access + refresh）+ OAuth（Google）
- **Storage**: PostgreSQL + Redis（限流/缓存）+ S3/Local 文件存储

关键模块：

- `server/api/`：路由层（chat/files/auth/kb/export/import/community...）
- `server/services/`：业务层（llm/auth/export/skills/data_parser...）
- `server/agents/`：Agent 与工具执行器（document/kb/web/community/data_files）
- `server/db/`：模型与连接，`server/alembic/` 负责迁移

## 目录结构

```text
doxmind/
├─ src/                      # 前端源码
│  ├─ app/                   # Next.js 路由
│  ├─ components/            # UI 与业务组件
│  ├─ hooks/                 # 业务 hooks
│  ├─ stores/                # Zustand 状态
│  ├─ extensions/            # TipTap 扩展
│  └─ lib/                   # API 客户端与工具函数
├─ server/                   # 后端源码
│  ├─ api/                   # FastAPI routers
│  ├─ agents/                # Agent + tools
│  ├─ services/              # 业务服务
│  ├─ db/                    # SQLAlchemy models
│  └─ alembic/               # DB migrations
├─ docs/                     # 架构与部署文档
├─ docker-compose.yml        # 开发容器编排
└─ docker-compose.prod.yml   # 生产容器编排
```

## 快速开始

### 方式 A：本地开发（推荐）

1. 安装依赖

```bash
npm install

cd server
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

2. 配置后端环境变量

```bash
copy server/.env.example server/.env
```

至少建议设置：

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `OPENROUTER_API_KEY`（若使用服务端 AI）
- `API_KEY_ENCRYPTION_KEY`（若启用用户 BYOK 存储）

3. 启动服务

```bash
# 项目根目录（前后端同时）
npm run dev:all

# 或分别启动
npm run dev
cd server && python main.py
```

4. 访问

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`

### 方式 B：Docker 开发环境

```bash
copy .env.example .env
docker-compose up -d
```

服务：

- `frontend` (3000)
- `backend` (8000)
- `postgres` (5433 -> 5432)
- `redis` (6379)

## 开发命令

### Frontend（项目根目录）

```bash
npm run dev
npm run build
npm run lint
npm run lint:fix
npm run type-check
npm run test
npm run test:ci
npm run test:coverage
npm run format
```

### Backend（`server/`）

```bash
python main.py
pytest
pytest --cov
pytest -v -m unit
ruff check .
ruff format .
```

## 数据库迁移（Alembic）

当你修改数据库结构时，不要只改模型，必须走迁移：

```bash
cd server
alembic revision --autogenerate -m "your migration message"
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

常用命令：

```bash
alembic current
alembic history
alembic upgrade head
```

## API 文档

`DEBUG=true` 时可访问：

- Swagger: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 工程质量

- Frontend: ESLint + Prettier + Vitest + TypeScript strict
- Backend: Ruff + pytest
- Git hooks: Husky + lint-staged（提交前自动检查/格式化）

## 部署

- 开发容器：`docker-compose.yml`
- 生产容器：`docker-compose.prod.yml`
- 生产版包含 Nginx / Postgres(pgvector image) / Redis / Backend / Frontend 分层部署

## License

MIT
