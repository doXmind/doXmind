# doXmind Mini Architecture Documentation

> AI-Powered Markdown Writing Assistant - "Cursor for Writing"

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture Diagrams](#2-system-architecture-diagrams)
3. [Technology Stack](#3-technology-stack)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Architecture](#5-backend-architecture)
6. [Core Feature Interaction Flows](#6-core-feature-interaction-flows)
7. [Data Models](#7-data-models)
8. [External Service Integrations](#8-external-service-integrations)
9. [Security Architecture](#9-security-architecture)
10. [Performance Optimization Strategies](#10-performance-optimization-strategies)

---

## 1. Project Overview

doXmind Mini is an AI-powered Markdown writing assistant that deeply integrates the TipTap rich text editor with Claude AI, providing real-time chat, quick edit actions, autocomplete, RAG knowledge base retrieval, and more.

### Core Features

| Feature | Description |
|---------|-------------|
| **Intelligent Chat** | Real-time streaming conversations with Claude, supporting extended thinking |
| **Quick Edit** | One-click text polishing, translation, expansion, and condensation |
| **Autocomplete** | AI-powered next-word prediction while typing, accept with Tab |
| **Knowledge Base RAG** | Upload documents as conversation context with vector retrieval |
| **Version History** | AI edits automatically saved as versions with rollback support |
| **Multi-format Export** | Support for PDF, DOCX, and Markdown export |
| **Mobile Adaptation** | Responsive design, gesture controls, and voice input |

---

## 2. System Architecture Diagrams

### 2.1 Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Layer                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Desktop   │  │   Mobile    │  │   Tablet    │  │ Public Share │    │
│  │   Browser   │  │   Browser   │  │   Browser   │  │  /shared/*   │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
└─────────┼────────────────┼────────────────┼────────────────┼───────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                                    │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     Next.js 15 (App Router)                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │ │
│  │  │  /editor     │  │  /login      │  │  /shared/[t] │              │ │
│  │  │  Main Editor │  │  Login Page  │  │  Public Share│              │ │
│  │  └──────┬───────┘  └──────────────┘  └──────────────┘              │ │
│  │         │                                                          │ │
│  │  ┌──────┴──────────────────────────────────────────────────────┐   │ │
│  │  │                    Zustand State Stores                     │   │ │
│  │  │  file-store │ chat-store │ editor-store │ kb-store │ ...   │   │ │
│  │  └──────┬──────────────────────────────────────────────────────┘   │ │
│  │         │                                                          │ │
│  │  ┌──────┴──────────────────────────────────────────────────────┐   │ │
│  │  │                    TipTap Editor Engine                      │   │ │
│  │  │  Extensions: Diff Review │ Autocomplete │ Search │ Math     │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ REST API + SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend Layer                                    │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      FastAPI Application                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │ │
│  │  │ /api/    │  │ /api/    │  │ /api/    │  │ /api/    │           │ │
│  │  │ auth     │  │ files    │  │ chat     │  │ kb       │           │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │ │
│  │       │             │             │             │                  │ │
│  │  ┌────┴─────────────┴─────────────┴─────────────┴─────────────┐   │ │
│  │  │                    Services Layer                          │   │ │
│  │  │  LLMService │ RAGService │ AuthService │ ExportService     │   │ │
│  │  └────┬───────────────────────────────────────────────────────┘   │ │
│  │       │                                                           │ │
│  │  ┌────┴──────────────────────────────────────────────────────┐    │ │
│  │  │              WritingAgent (LangGraph)                      │    │ │
│  │  │  Tools: str_replace │ insert │ search_documents │ ...     │    │ │
│  │  └───────────────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │  PostgreSQL  │ │   pgvector   │ │    Claude    │
            │  (SQLAlchemy)│ │  (Embeddings)│ │     API      │
            └──────────────┘ └──────────────┘ └──────────────┘
```

### 2.2 Three-Panel Layout Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Header (Navigation Bar)                      │
│  ┌──────────┐  ┌────────────────────────────────────────┐  ┌──────┐ │
│  │ Sidebar  │  │             File Name                   │  │ User │ │
│  │ Toggle   │  └────────────────────────────────────────┘  └──────┘ │
├──────────────┬───────────────────────────────────┬──────────────────┤
│              │                                   │                  │
│   Sidebar    │            Editor                 │    Chat Panel    │
│              │                                   │                  │
│              │                                   │                  │
│ ┌──────────┐ │  ┌─────────────────────────────┐  │ ┌──────────────┐ │
│ │ File List│ │  │                             │  │ │  History     │ │
│ │          │ │  │    TipTap WYSIWYG Editor    │  │ │              │ │
│ │ - File 1 │ │  │                             │  │ │  User: ...   │ │
│ │ - File 2 │ │  │    Toolbar (Format Buttons) │  │ │  AI: ...     │ │
│ │ - File 3 │ │  │    ────────────────────     │  │ │              │ │
│ └──────────┘ │  │                             │  │ ├──────────────┤ │
│              │  │    Document Content Area    │  │ │  Context     │ │
│ ┌──────────┐ │  │                             │  │ │  [Selection] │ │
│ │Knowledge │ │  │                             │  │ │  [Images]    │ │
│ │Base      │ │  │    Bubble Menu (Selection)  │  │ ├──────────────┤ │
│ │          │ │  │    Quick Edit Menu          │  │ │  Input Box   │ │
│ │ Uploads: │ │  │                             │  │ │  [Send][Set] │ │
│ │ - doc1   │ │  └─────────────────────────────┘  │ └──────────────┘ │
│ │ - doc2   │ │                                   │                  │
│ └──────────┘ │                                   │                  │
│              │                                   │                  │
└──────────────┴───────────────────────────────────┴──────────────────┘
```

### 2.3 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Data Flow Diagram                            │
└─────────────────────────────────────────────────────────────────────┘

User Input           Processing Layer          Storage Layer      External Services
──────────           ────────────────          ─────────────      ─────────────────

┌─────────┐       ┌──────────────┐       ┌──────────────┐    ┌─────────┐
│Edit Doc │──────▶│ editor-store │──────▶│  PostgreSQL  │    │ Claude  │
└─────────┘       └──────────────┘       │    files     │    │   API   │
     │                   │               └──────────────┘    └────▲────┘
     │                   │ debounce 500ms                         │
     ▼                   ▼                                        │
┌─────────┐       ┌──────────────┐       ┌──────────────┐         │
│Send Msg │──────▶│  chat-store  │──────▶│ conversations │         │
└─────────┘       └──────────────┘       │   messages   │         │
     │                   │               └──────────────┘         │
     │                   │ SSE Stream                             │
     ▼                   ▼                                        │
┌─────────┐       ┌──────────────┐       ┌──────────────┐         │
│Upload KB│──────▶│   kb-store   │──────▶│   pgvector   │─────────┤
└─────────┘       └──────────────┘       │  embeddings  │         │
                                         └──────────────┘         │
                                                                  │
┌─────────┐       ┌──────────────┐                                │
│Quick Ed │──────▶│ Quick Edit   │────────────────────────────────┘
└─────────┘       │   Handler    │
                  └──────────────┘
```

---

## 3. Technology Stack

### 3.1 Frontend Technology Stack

| Category | Technology | Version | Purpose |
|----------|------------|---------|---------|
| **Framework** | Next.js | 15 | App Router, RSC |
| **UI Library** | React | 19 | Component-based development |
| **Editor** | TipTap | 2.x | WYSIWYG rich text editing |
| **State Management** | Zustand | 5.x | Lightweight state management |
| **Styling** | Tailwind CSS | 3.x | Utility-first CSS |
| **Animation** | Framer Motion | 11.x | Declarative animations |
| **Types** | TypeScript | 5.x | Type safety |
| **Testing** | Vitest + RTL | - | Unit/component testing |

### 3.2 Backend Technology Stack

| Category | Technology | Version | Purpose |
|----------|------------|---------|---------|
| **Framework** | FastAPI | 0.115+ | Async REST API |
| **Runtime** | Python | 3.12 | Backend language |
| **ORM** | SQLAlchemy | 2.0 | Async database operations |
| **Database** | PostgreSQL | 16 | Primary database |
| **Vector Store** | pgvector | - | Vector retrieval |
| **AI Framework** | Anthropic SDK | - | Claude API integration |
| **Agent** | LangGraph | - | AI workflow orchestration |
| **Testing** | pytest | - | Backend testing |

### 3.3 Infrastructure

| Category | Technology | Purpose |
|----------|------------|---------|
| **Containerization** | Docker Compose | Local development environment |
| **Deployment** | Heroku | Production environment |
| **CI/CD** | GitHub Actions | Automated testing and deployment |
| **Monitoring** | Custom Logger | Structured logging |

---

## 4. Frontend Architecture

### 4.1 Directory Structure

```
src/
├── app/                      # Next.js App Router
│   ├── editor/               # Main editor page
│   │   └── page.tsx          # Entry component
│   ├── login/                # Login page
│   ├── shared/[token]/       # Public share page
│   ├── auth/callback/        # OAuth callback
│   └── layout.tsx            # Root layout
│
├── components/               # React components
│   ├── editor/               # Editor-related
│   │   ├── editor.tsx        # TipTap main editor
│   │   ├── editor-toolbar.tsx# Formatting toolbar
│   │   ├── bubble-menu.tsx   # Selection menu
│   │   ├── diff-review-toolbar.tsx # Diff review bar
│   │   ├── slash-commands.tsx# Slash commands
│   │   └── mindlines/        # Outline view
│   │
│   ├── ai/                   # AI feature components
│   │   ├── chat-panel.tsx    # Chat panel
│   │   ├── chat-message.tsx  # Message rendering
│   │   ├── quick-edit-menu.tsx # Quick edit menu
│   │   ├── thinking-indicator.tsx # Thinking indicator
│   │   └── tool-indicator.tsx# Tool call indicator
│   │
│   ├── mobile/               # Mobile components
│   │   ├── mobile-editor-layout.tsx
│   │   ├── floating-ai-input.tsx
│   │   └── mobile-chat-sheet.tsx
│   │
│   ├── kb/                   # Knowledge base components
│   │   ├── knowledge-base-panel.tsx
│   │   └── kb-upload-zone.tsx
│   │
│   ├── layout/               # Layout components
│   │   ├── app-shell.tsx     # App shell
│   │   ├── sidebar.tsx       # Sidebar
│   │   └── header.tsx        # Top navigation
│   │
│   └── ui/                   # Common UI components
│       ├── button.tsx
│       ├── modal.tsx
│       └── command-palette.tsx
│
├── extensions/               # TipTap extensions
│   ├── autocomplete-extension.ts
│   ├── diff-review-extension.ts
│   ├── search-extension.ts
│   ├── code-block/
│   └── math/
│
├── hooks/                    # Custom hooks
│   ├── use-chat.ts           # Chat logic
│   ├── use-autocomplete.ts   # Autocomplete
│   ├── use-quick-edit.ts     # Quick edit
│   ├── use-diff-review.ts    # Diff review
│   └── use-voice-recording.ts# Voice input
│
├── stores/                   # Zustand state management
│   ├── file-store.ts         # File state
│   ├── chat-store.ts         # Chat state
│   ├── editor-store.ts       # Editor state
│   ├── kb-store.ts           # Knowledge base state
│   └── streaming-store.ts    # Streaming response state
│
├── lib/                      # Utility libraries
│   ├── api.ts                # API client
│   ├── streaming.ts          # SSE parsing
│   ├── diff-utils.ts         # Diff algorithms
│   └── markdown.ts           # Markdown conversion
│
└── types/                    # TypeScript types
    ├── file.ts
    ├── chat.ts
    └── editor.ts
```

### 4.2 State Management Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Zustand Store Architecture                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   file-store    │     │   chat-store    │     │  editor-store   │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ State:          │     │ State:          │     │ State:          │
│ - files[]       │     │ - conversations │     │ - isDirty       │
│ - currentFileId │     │ - activeConvId  │     │ - selection     │
│ - isLoading     │     │ - isStreaming   │     │ - pendingEdits  │
│ - isSynced      │     │                 │     │ - quickEditOpen │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ Actions:        │     │ Actions:        │     │ Actions:        │
│ - createFile()  │     │ - sendMessage() │     │ - setSelection()│
│ - updateFile()  │     │ - clearHistory()│     │ - applyEdit()   │
│ - deleteFile()  │     │ - loadHistory() │     │ - revertEdit()  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │      Persistence        │
                    │    (localStorage)       │
                    └─────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    kb-store     │     │ streaming-store │     │  layout-store   │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ State:          │     │ State:          │     │ State:          │
│ - attachments   │     │ - isStreaming   │     │ - isChatOpen    │
│ - uploadProgress│     │ - currentTool   │     │ - isSidebarOpen │
│ - pollingStatus │     │ - thinking      │     │ - panelWidths   │
├─────────────────┤     │ - todos[]       │     ├─────────────────┤
│ Actions:        │     ├─────────────────┤     │ Actions:        │
│ - uploadFile()  │     │ Actions:        │     │ - toggleChat()  │
│ - deleteFile()  │     │ - setStreaming()│     │ - toggleSidebar()
│ - searchKB()    │     │ - addTodo()     │     │ - setPanelWidth()
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 4.3 Component Hierarchy

```
App (layout.tsx)
└── AuthProvider
    └── AppShell
        ├── Header
        │   ├── SidebarToggle
        │   ├── FileNameInput
        │   └── UserMenu
        │
        ├── Sidebar (collapsible)
        │   ├── FileList
        │   │   └── FileItem[]
        │   └── KnowledgeBasePanel
        │       ├── KBUploadZone
        │       └── KBAttachmentItem[]
        │
        ├── Editor (main content area)
        │   ├── EditorToolbar
        │   │   └── FormatButtons[]
        │   ├── TipTapEditor
        │   │   ├── BubbleMenu
        │   │   ├── SlashCommands
        │   │   └── CustomExtensions
        │   ├── DiffReviewToolbar
        │   └── SearchBar
        │
        └── ChatPanel (collapsible)
            ├── ChatMessages
            │   ├── ChatMessage[]
            │   │   ├── ThinkingIndicator
            │   │   ├── ToolIndicator
            │   │   └── MessageContent
            │   └── StreamingMessage
            ├── ContextPills
            │   └── ContextItem[]
            └── ChatInput
                ├── AttachmentMenu
                └── ChatSettings
```

### 4.4 TipTap Extension Architecture

```
TipTap Editor
├── Core Extensions (Built-in)
│   ├── StarterKit
│   ├── Placeholder
│   ├── Typography
│   └── CharacterCount
│
├── Format Extensions
│   ├── Highlight
│   ├── Underline
│   ├── TextAlign
│   ├── Subscript / Superscript
│   └── TaskList / TaskItem
│
├── Content Extensions
│   ├── Table
│   ├── Image (ResizableImage)
│   ├── Link
│   ├── CodeBlock (syntax highlighting)
│   └── Math (LaTeX formulas)
│
└── Custom Extensions
    ├── DiffReviewExtension
    │   └── Display/manage AI edit diffs
    ├── AutocompleteExtension
    │   └── AI completion suggestions while typing
    ├── SearchExtension
    │   └── In-document search with highlighting
    ├── SpellcheckExtension
    │   └── Spelling/grammar checking
    └── BlockSelectionExtension
        └── Mobile block-level selection
```

---

## 5. Backend Architecture

### 5.1 Directory Structure

```
server/
├── main.py                   # FastAPI entry point
├── config.py                 # Configuration management
│
├── api/                      # API routing layer
│   ├── auth.py               # Authentication routes
│   ├── files.py              # File CRUD
│   ├── chat.py               # Chat routes
│   ├── edit.py               # Quick edit
│   ├── autocomplete.py       # Autocomplete
│   ├── knowledge_base.py     # Knowledge base
│   ├── export.py             # Export
│   ├── import_file.py        # Import
│   ├── shares.py             # Public sharing
│   ├── versions.py           # Version history
│   └── speech.py             # Speech transcription
│
├── services/                 # Service layer
│   ├── llm_service.py        # Claude API wrapper
│   ├── rag_service.py        # Vector retrieval service
│   ├── auth_service.py       # Authentication service
│   ├── oauth_service.py      # OAuth service
│   ├── user_service.py       # User service
│   ├── export_service.py     # Export service
│   └── email_service.py      # Email service
│
├── agents/                   # AI Agent layer
│   ├── writing_agent.py      # Writing assistant agent
│   ├── prompts.py            # System prompts
│   └── tools/
│       ├── definitions.py    # Tool definitions
│       └── handlers.py       # Tool execution
│
├── db/                       # Data layer
│   ├── database.py           # Model definitions
│   └── migrations/           # Database migrations
│
├── prompts/                  # Prompt templates
│   ├── system.txt
│   ├── quick_edit.txt
│   └── autocomplete.txt
│
└── tests/                    # Tests
    ├── unit/
    └── integration/
```

### 5.2 Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          API Layer (Routers)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ auth.py  │ │ files.py │ │ chat.py  │ │  kb.py   │ │export.py │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       │            │            │            │            │         │
└───────┼────────────┼────────────┼────────────┼────────────┼─────────┘
        │            │            │            │            │
        ▼            ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Service Layer (Business Logic)               │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐          │
│  │  AuthService   │ │  LLMService    │ │  RAGService    │          │
│  │  - JWT gen     │ │  - Claude call │ │  - Vector search│         │
│  │  - OAuth       │ │  - Streaming   │ │  - Doc embedding│         │
│  └────────────────┘ └────────────────┘ └────────────────┘          │
│                                                                     │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐          │
│  │  UserService   │ │ ExportService  │ │  EmailService  │          │
│  │  - User CRUD   │ │  - PDF/DOCX    │ │  - Verification│          │
│  └────────────────┘ └────────────────┘ └────────────────┘          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent Layer (AI Orchestration)              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      WritingAgent                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │ │
│  │  │  Tool Loop   │  │   Prompts    │  │  Tool Defs   │         │ │
│  │  │  Execution   │  │  Management  │  │  Definitions │         │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │ │
│  │                                                                │ │
│  │  Tools:                                                        │ │
│  │  ├── view_document       # View document                       │ │
│  │  ├── str_replace_editor  # String replacement                  │ │
│  │  ├── insert_text         # Insert text                         │ │
│  │  ├── replace_document    # Replace entire document             │ │
│  │  ├── search_documents    # Search knowledge base               │ │
│  │  └── read_document       # Read KB document                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Data Layer (Database)                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                   SQLAlchemy 2.0 (Async)                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │ │
│  │  │    Users    │  │    Files    │  │Conversations│            │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │ │
│  │  │  Messages   │  │FileVersions │  │ Attachments │            │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                   pgvector (Vector Store)                      │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  vector_embeddings (chunk_id, embedding, metadata)      │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 API Endpoint Overview

| Module | Endpoint | Method | Description |
|--------|----------|--------|-------------|
| **Auth** | `/api/auth/login` | POST | User login |
| | `/api/auth/register` | POST | User registration |
| | `/api/auth/oauth/{provider}` | GET | OAuth initiation |
| | `/api/auth/oauth/{provider}/callback` | GET | OAuth callback |
| **Files** | `/api/files` | GET | Get file list |
| | `/api/files` | POST | Create file |
| | `/api/files/{id}` | PUT | Update file |
| | `/api/files/{id}` | DELETE | Delete file |
| **Chat** | `/api/chat/stream` | POST | Streaming chat (SSE) |
| | `/api/chat/conversations/{fileId}` | GET | Get conversation history |
| | `/api/chat/messages` | POST | Save message |
| **Edit** | `/api/edit/quick` | POST | Quick edit (SSE) |
| **Autocomplete** | `/api/autocomplete/` | POST | Autocomplete (SSE) |
| **KB** | `/api/kb/{convId}/attachments` | POST | Upload attachment |
| | `/api/kb/{convId}/attachments` | GET | Get attachment list |
| | `/api/kb/search` | POST | Search knowledge base |
| **Export** | `/api/export/` | POST | Export file |
| **Versions** | `/api/versions/{fileId}` | GET | Get version history |
| | `/api/versions/{versionId}/revert` | POST | Revert to version |
| **Shares** | `/api/shares` | POST | Create share |
| | `/api/shares/{token}` | GET | Get shared content |

---

## 6. Core Feature Interaction Flows

### 6.1 AI Chat Streaming Response

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI Chat Streaming Response Flow                   │
└─────────────────────────────────────────────────────────────────────┘

User                    Frontend                 Backend               Claude
────                    ────────                 ───────               ──────

  │                       │                       │                      │
  │  1. Type and send     │                       │                      │
  │     message           │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │                       │  2. POST /api/chat/stream                    │
  │                       │  { message, fileId, contexts }               │
  │                       ├──────────────────────▶│                      │
  │                       │                       │                      │
  │                       │                       │  3. Build Prompt     │
  │                       │                       │  - System prompt     │
  │                       │                       │  - File content      │
  │                       │                       │  - Chat history      │
  │                       │                       │  - KB context        │
  │                       │                       │                      │
  │                       │                       │  4. Claude API call  │
  │                       │                       ├─────────────────────▶│
  │                       │                       │                      │
  │                       │                       │  5. Stream tokens    │
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │  6. SSE: text_chunk   │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  7. Display text      │                       │                      │
  │     in real-time      │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
  │                       │                       │  8. Tool call        │
  │                       │                       │  (str_replace_editor)│
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │  9. SSE: tool_call    │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  10. Show tool call   │                       │                      │
  │      indicator        │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
  │                       │                       │  11. Execute tool    │
  │                       │                       │  - Apply text replace│
  │                       │                       │                      │
  │                       │  12. SSE: tool_result │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  13. Show diff in     │                       │                      │
  │      editor           │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
  │                       │  14. SSE: done        │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  15. Save message     │                       │                      │
  │      to history       │                       │                      │
  │                       ├──────────────────────▶│                      │
  │                       │                       │                      │
```

**SSE Event Types:**

| Event Type | Data Structure | Description |
|------------|----------------|-------------|
| `text_chunk` | `{ content: string }` | Streaming text fragment |
| `tool_call` | `{ name: string, input: object }` | Tool call start |
| `tool_result` | `{ name: string, output: object }` | Tool execution result |
| `thinking` | `{ content: string }` | Extended thinking content |
| `todo_item` | `{ content: string, status: string }` | Task item parsed |
| `edit` | `{ type: string, old_str: string, new_str: string }` | Edit operation |
| `done` | `{}` | Response complete |
| `error` | `{ message: string }` | Error message |

### 6.2 Quick Edit

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Quick Edit Interaction Flow                   │
└─────────────────────────────────────────────────────────────────────┘

User                    Editor                   Backend               Claude
────                    ──────                   ───────               ──────

  │                       │                       │                      │
  │  1. Select text       │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │  2. Right-click       │                       │                      │
  │     Quick Edit        │                       │                      │
  │     Select "Fix       │                       │                      │
  │     Grammar"          │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │                       │  3. POST /api/edit/quick                     │
  │                       │  { text, action: "fix-grammar", context }    │
  │                       ├──────────────────────▶│                      │
  │                       │                       │                      │
  │                       │                       │  4. Build quick edit │
  │                       │                       │     prompt + text    │
  │                       │                       │                      │
  │                       │                       │  5. Claude streaming │
  │                       │                       ├─────────────────────▶│
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │  6. SSE streaming     │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │                       │  7. Real-time preview │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
  │  8. Auto-replace      │                       │                      │
  │     selected text     │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
  │                       │  9. Save to undo stack│                      │
  │                       │     (supports Ctrl+Z) │                      │
  │                       │                       │                      │
```

**Quick Edit Action Types:**

| Action | Action ID | Description |
|--------|-----------|-------------|
| Fix Grammar | `fix-grammar` | Fix grammar and spelling errors |
| Improve | `improve` | Enhance text quality |
| Simplify | `simplify` | Simplify expression |
| Expand | `expand` | Expand with details |
| Shorten | `shorten` | Condense content |
| Professional | `professional` | Convert to formal tone |
| Casual | `casual` | Convert to relaxed tone |
| Translate EN | `translate-en` | Translate to English |
| Translate ZH | `translate-zh` | Translate to Chinese |

### 6.3 Autocomplete

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Autocomplete Interaction Flow                 │
└─────────────────────────────────────────────────────────────────────┘

User                    Editor                   Backend               Claude
────                    ──────                   ───────               ──────

  │                       │                       │                      │
  │  1. Type text         │                       │                      │
  │     "The weather"     │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │                       │  2. Debounce 300ms    │                      │
  │                       │     Check trigger     │                      │
  │                       │     (2+ char word)    │                      │
  │                       │                       │                      │
  │                       │  3. POST /api/autocomplete                   │
  │                       │  { textBefore, textAfter, fileName }         │
  │                       ├──────────────────────▶│                      │
  │                       │                       │                      │
  │                       │                       │  4. Check cache      │
  │                       │                       │  5. Claude completion│
  │                       │                       ├─────────────────────▶│
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │  6. Return suggestion │                      │
  │                       │     "is nice today"   │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  7. Show gray preview │                       │                      │
  │     "The weather|is nice today"               │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
  │  8. Press Tab to      │                       │                      │
  │     accept            │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │  9. Insert completion │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
```

### 6.4 Knowledge Base RAG Retrieval

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Knowledge Base RAG Retrieval Flow                 │
└─────────────────────────────────────────────────────────────────────┘

User                    Frontend                 Backend            External Services
────                    ────────                 ───────            ─────────────────

=== Phase 1: Document Upload ===

  │                       │                       │                      │
  │  1. Drag & drop PDF   │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │                       │  2. FormData POST     │                      │
  │                       │  /api/kb/{convId}/attachments               │
  │                       ├──────────────────────▶│                      │
  │                       │                       │                      │
  │                       │                       │  3. Extract text     │
  │                       │                       │     (Gemini API)     │
  │                       │                       ├─────────────────────▶│
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │                       │  4. Chunk document   │
  │                       │                       │  - Overlap (1000/200)│
  │                       │                       │  - Sentence          │
  │                       │                       │                      │
  │                       │                       │  5. Generate embeddings
  │                       │                       │  (OpenAI API)        │
  │                       │                       ├─────────────────────▶│
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │                       │  6. Store in pgvector│
  │                       │                       │                      │
  │                       │  7. Return attachment_id                     │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  8. Show upload       │                       │                      │
  │     success           │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │

=== Phase 2: Retrieval During Chat ===

  │                       │                       │                      │
  │  9. Send message      │                       │                      │
  │     "According to     │                       │                      │
  │      the doc..."      │                       │                      │
  ├──────────────────────▶│                       │                      │
  │                       │                       │                      │
  │                       │  10. POST /api/chat/stream                   │
  │                       ├──────────────────────▶│                      │
  │                       │                       │                      │
  │                       │                       │  11. Agent calls tool│
  │                       │                       │  search_documents    │
  │                       │                       │                      │
  │                       │                       │  12. Vector similarity│
  │                       │                       │  - Query Embedding   │
  │                       │                       │  - pgvector search   │
  │                       │                       │  - Return Top-K      │
  │                       │                       │                      │
  │                       │                       │  13. Inject results  │
  │                       │                       │      into Prompt     │
  │                       │                       │                      │
  │                       │                       │  14. Claude generates│
  │                       │                       ├─────────────────────▶│
  │                       │                       │◀─────────────────────┤
  │                       │                       │                      │
  │                       │  15. Stream response  │                      │
  │                       │◀──────────────────────┤                      │
  │                       │                       │                      │
  │  16. Show answer      │                       │                      │
  │      with citations   │                       │                      │
  │◀──────────────────────┤                       │                      │
  │                       │                       │                      │
```

**Vector Storage Structure:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                      pgvector Storage Structure                      │
└─────────────────────────────────────────────────────────────────────┘

Table: vector_embeddings
┌────────────┬───────────────┬──────────────────────────────────────┐
│  chunk_id  │   embedding   │              metadata                │
│  (UUID)    │  (vector[1536])│            (JSONB)                  │
├────────────┼───────────────┼──────────────────────────────────────┤
│  abc123    │  [0.1, 0.2...] │ { "conversation_id": "conv1",       │
│            │               │   "attachment_id": "att1",           │
│            │               │   "filename": "report.pdf",          │
│            │               │   "chunk_index": 0,                  │
│            │               │   "text": "Original text..." }       │
├────────────┼───────────────┼──────────────────────────────────────┤
│  def456    │  [0.3, 0.1...] │ { "conversation_id": "conv1",       │
│            │               │   "attachment_id": "att1",           │
│            │               │   "filename": "report.pdf",          │
│            │               │   "chunk_index": 1,                  │
│            │               │   "text": "Original text..." }       │
└────────────┴───────────────┴──────────────────────────────────────┘

Retrieval Process:
1. Query: "How is project progress?"
2. Embed query → [0.2, 0.15, ...]
3. SELECT * FROM vector_embeddings
   WHERE metadata->>'conversation_id' = 'conv1'
   ORDER BY embedding <=> query_embedding
   LIMIT 5
4. Return top 5 most similar text chunks
```

### 6.5 Diff Review and Version Management

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Diff Review and Version Management Flow             │
└─────────────────────────────────────────────────────────────────────┘

User                    Editor                   Backend
────                    ──────                   ───────

=== AI Edit Produces Diff ===

  │                       │                       │
  │  1. AI executes       │                       │
  │     str_replace tool  │                       │
  │                       │◀──────────────────────┤
  │                       │                       │
  │                       │  2. DiffReviewExtension
  │                       │     marks edit region │
  │                       │                       │
  │  3. Show Diff         │                       │
  │     highlighting      │                       │
  │     - Deleted: red bg │                       │
  │     - Added: green bg │                       │
  │◀──────────────────────┤                       │
  │                       │                       │
  │                       │  4. Show Accept/Reject│
  │                       │     toolbar           │
  │◀──────────────────────┤                       │
  │                       │                       │

=== User Accepts Edit ===

  │                       │                       │
  │  5. Click "Accept"    │                       │
  ├──────────────────────▶│                       │
  │                       │                       │
  │                       │  6. Clear diff marks  │
  │                       │     Keep new content  │
  │                       │                       │
  │                       │  7. Create FileVersion│
  │                       │     { diff, summary } │
  │                       ├──────────────────────▶│
  │                       │                       │
  │  8. Show final        │                       │
  │     content           │                       │
  │◀──────────────────────┤                       │
  │                       │                       │

=== User Rejects Edit ===

  │                       │                       │
  │  5. Click "Reject"    │                       │
  ├──────────────────────▶│                       │
  │                       │                       │
  │                       │  6. Restore original  │
  │                       │     Clear diff marks  │
  │                       │                       │
  │  7. Show original     │                       │
  │     content           │                       │
  │◀──────────────────────┤                       │
  │                       │                       │

=== View Version History ===

  │                       │                       │
  │  8. Open version      │                       │
  │     history panel     │                       │
  ├──────────────────────▶│                       │
  │                       │                       │
  │                       │  9. GET /api/versions/{fileId}              │
  │                       ├──────────────────────▶│
  │                       │                       │
  │                       │  10. Return version   │
  │                       │      list             │
  │                       │◀──────────────────────┤
  │                       │                       │
  │  11. Show version     │                       │
  │      timeline         │                       │
  │      - v3: "Fix grammar"                      │
  │      - v2: "Expand para"                      │
  │      - v1: "Initial"  │                       │
  │◀──────────────────────┤                       │
  │                       │                       │
  │  12. Click revert     │                       │
  │      to v2            │                       │
  ├──────────────────────▶│                       │
  │                       │                       │
  │                       │  13. POST /api/versions/{v2}/revert         │
  │                       ├──────────────────────▶│
  │                       │                       │
  │  14. Document reverts │                       │
  │      to v2            │                       │
  │◀──────────────────────┤                       │
  │                       │                       │
```

### 6.6 User Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Authentication Flow                      │
└─────────────────────────────────────────────────────────────────────┘

=== Email/Password Login ===

User                    Frontend                 Backend
────                    ────────                 ───────

  │                       │                       │
  │  1. Enter email       │                       │
  │     and password      │                       │
  ├──────────────────────▶│                       │
  │                       │                       │
  │                       │  2. POST /api/auth/login
  │                       │  { email, password }  │
  │                       ├──────────────────────▶│
  │                       │                       │
  │                       │                       │  3. Verify password
  │                       │                       │     bcrypt compare
  │                       │                       │
  │                       │                       │  4. Generate JWT
  │                       │                       │     { user_id, exp }
  │                       │                       │
  │                       │  5. Return token+user │
  │                       │◀──────────────────────┤
  │                       │                       │
  │                       │  6. Store in localStorage
  │                       │     Set Cookie        │
  │                       │                       │
  │  7. Redirect to       │                       │
  │     /editor           │                       │
  │◀──────────────────────┤                       │
  │                       │                       │


=== OAuth Login (Google) ===

User                    Frontend                 Backend               Google
────                    ────────                 ───────               ──────

  │                       │                       │                    │
  │  1. Click Google      │                       │                    │
  │     Login             │                       │                    │
  ├──────────────────────▶│                       │                    │
  │                       │                       │                    │
  │                       │  2. Redirect to       │                    │
  │                       │  /api/auth/oauth/google                    │
  │                       ├──────────────────────▶│                    │
  │                       │                       │                    │
  │                       │                       │  3. Generate state │
  │                       │                       │     PKCE params    │
  │                       │                       │                    │
  │  4. Redirect to       │                       │                    │
  │     Google            │                       │                    │
  │◀─────────────────────────────────────────────┤                    │
  │                       │                       │                    │
  │  5. Google login      │                       │                    │
  │     authorization     │                       │                    │
  ├────────────────────────────────────────────────────────────────────▶
  │                       │                       │                    │
  │  6. Callback with     │                       │                    │
  │     code              │                       │                    │
  │     /api/auth/oauth/google/callback?code=xxx                       │
  │◀────────────────────────────────────────────────────────────────────
  │                       │                       │                    │
  │                       ├──────────────────────▶│                    │
  │                       │                       │                    │
  │                       │                       │  7. Exchange code  │
  │                       │                       │     for token      │
  │                       │                       ├───────────────────▶│
  │                       │                       │◀───────────────────┤
  │                       │                       │                    │
  │                       │                       │  8. Get user info  │
  │                       │                       ├───────────────────▶│
  │                       │                       │◀───────────────────┤
  │                       │                       │                    │
  │                       │                       │  9. Create/update  │
  │                       │                       │     user, gen JWT  │
  │                       │                       │                    │
  │  10. Redirect to      │                       │                    │
  │      /editor          │                       │                    │
  │      (with token      │                       │                    │
  │       cookie)         │                       │                    │
  │◀──────────────────────┤◀──────────────────────┤                    │
  │                       │                       │                    │
```

### 6.7 Mobile-Specific Feature Interactions

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Mobile Layout Switching                       │
└─────────────────────────────────────────────────────────────────────┘

Desktop (>= 1024px)              Mobile (< 1024px)
─────────────────────            ─────────────────

┌───────┬───────────┬───────┐    ┌─────────────────────┐
│       │           │       │    │       Header        │
│Sidebar│  Editor   │ Chat  │    ├─────────────────────┤
│       │           │       │    │                     │
│ Fixed │   Fixed   │ Fixed │    │      Editor         │
│ Show  │   Show    │ Show  │    │                     │
│       │           │       │    │   (Full Width)      │
│       │           │       │    │                     │
└───────┴───────────┴───────┘    ├─────────────────────┤
                                 │  Floating AI Input  │
                                 └─────────────────────┘

                                 ┌─────────────────────┐
                                 │ Gestures:           │
                                 │ - Swipe right →     │
                                 │   Open sidebar      │
                                 │ - Swipe left →      │
                                 │   Open outline      │
                                 │ - Tap bottom bar →  │
                                 │   AI chat           │
                                 └─────────────────────┘

=== Block Selection Mode ===

┌─────────────────────────────┐
│ ┌─────────────────────────┐ │
│ │  [≡] Paragraph 1        │ │  ← Drag handle
│ │  This is the first...   │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │  [≡] Paragraph 2 ✓      │ │  ← Highlighted selected
│ │  This is the second...  │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │  [≡] Paragraph 3        │ │
│ │  This is the third...   │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │[Improve][Translate][Exp]│ │  ← Quick action bar
│ └─────────────────────────┘ │
└─────────────────────────────┘

=== Voice Input ===

┌─────────────────────────────┐
│                             │
│        🎤 Recording...      │
│                             │
│    ~~~~~~~~~~~~             │  ← Waveform visualization
│                             │
│   [Cancel]        [Done]    │
│                             │
└─────────────────────────────┘
          │
          ▼
POST /api/speech/transcribe
          │
          ▼
  Whisper API → Text transcription
          │
          ▼
    Fill into input or editor
```

---

## 7. Data Models

### 7.1 Database ER Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Database Entity Relationship Diagram              │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│      Users       │       │      Files       │       │  FileVersions    │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │       │ id (PK)          │
│ email (unique)   │       │ user_id (FK)     │───────│ file_id (FK)     │
│ password_hash    │──┐    │ name             │       │ content          │
│ name             │  │    │ content          │       │ diff (JSON)      │
│ avatar           │  │    │ created_at       │       │ edit_type        │
│ oauth_provider   │  │    │ updated_at       │       │ summary          │
│ oauth_id         │  │    └──────────────────┘       │ created_at       │
│ created_at       │  │             │                 └──────────────────┘
└──────────────────┘  │             │
         │            │             │
         │            │    ┌────────┴────────┐
         │            │    │                 │
         │            │    ▼                 ▼
         │            │  ┌──────────────────┐  ┌──────────────────┐
         │            │  │  Conversations   │  │     Shares       │
         │            │  ├──────────────────┤  ├──────────────────┤
         │            └─▶│ id (PK)          │  │ id (PK)          │
         │               │ user_id (FK)     │  │ file_id (FK)     │
         │               │ file_id (FK)     │  │ token (unique)   │
         │               │ created_at       │  │ expires_at       │
         │               └──────────────────┘  │ created_at       │
         │                        │            └──────────────────┘
         │                        │
         │                        ▼
         │               ┌──────────────────┐
         │               │     Messages     │
         │               ├──────────────────┤
         │               │ id (PK)          │
         │               │ conversation_id  │
         │               │ role             │
         │               │ content          │
         │               │ thinking (JSON)  │
         │               │ tool_calls (JSON)│
         │               │ edits (JSON)     │
         │               │ contexts (JSON)  │
         │               │ created_at       │
         │               └──────────────────┘
         │
         │               ┌──────────────────┐
         │               │ConversationAttach│
         │               ├──────────────────┤
         │               │ id (PK)          │
         │               │ conversation_id  │
         │               │ filename         │
         │               │ file_type        │
         │               │ status           │
         │               │ error_message    │
         │               │ created_at       │
         │               └──────────────────┘
         │
         │               ┌──────────────────┐
         │               │ EmailVerification│
         │               ├──────────────────┤
         │               │ id (PK)          │
         └──────────────▶│ user_id (FK)     │
                         │ token (unique)   │
                         │ expires_at       │
                         └──────────────────┘
```

### 7.2 Core TypeScript Types

```typescript
// File
interface FileItem {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Conversation
interface Conversation {
  id: string;
  fileId: string;
  messages: ChatMessage[];
  createdAt: string;
}

// Message
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;          // Extended thinking content
  toolCalls?: ToolCall[];     // Tool call records
  edits?: EditOperation[];    // Edit operations
  contexts?: MessageContext[]; // Context attachments
  createdAt: string;
}

// Tool Call
interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
}

// Edit Operation
interface EditOperation {
  type: 'str_replace' | 'insert' | 'replace_all';
  file_id: string;
  file_name: string;
  old_str?: string;
  new_str?: string;
  new_content?: string;
  success: boolean;
}

// Message Context
type MessageContext =
  | { type: 'selection'; text: string }
  | { type: 'image'; src: string; base64: string; mediaType: string };

// Knowledge Base Attachment
interface KBAttachment {
  id: string;
  conversationId: string;
  filename: string;
  fileType: string;
  status: 'processing' | 'ready' | 'error';
  errorMessage?: string;
  createdAt: string;
}

// File Version
interface FileVersion {
  id: string;
  fileId: string;
  content: string;
  diff: DiffChange[];
  editType: 'ai_edit' | 'manual' | 'revert';
  summary: string;
  createdAt: string;
}
```

### 7.3 Python Pydantic Models

```python
# Request Models
class ChatRequest(BaseModel):
    message: str
    file_id: str
    conversation_id: Optional[str] = None
    contexts: Optional[List[MessageContext]] = None
    images: Optional[List[ImageData]] = None
    mode: Optional[str] = "default"  # default | thinking | web

class QuickEditRequest(BaseModel):
    text: str
    action: str  # fix-grammar, improve, simplify, etc.
    context: Optional[str] = None

class AutocompleteRequest(BaseModel):
    text_before: str
    text_after: str
    file_name: Optional[str] = None

# Response Models
class FileResponse(BaseModel):
    id: str
    name: str
    content: str
    created_at: datetime
    updated_at: datetime

class ConversationResponse(BaseModel):
    id: str
    file_id: str
    messages: List[MessageResponse]
    created_at: datetime

class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    thinking: Optional[str] = None
    tool_calls: Optional[List[Dict]] = None
    edits: Optional[List[Dict]] = None
    contexts: Optional[List[Dict]] = None
    created_at: datetime
```

---

## 8. External Service Integrations

### 8.1 Service Dependency Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    External Service Integrations                     │
└─────────────────────────────────────────────────────────────────────┘

                         doXmind Backend
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │   Anthropic  │    │    OpenAI    │    │    Google    │
   │   Claude API │    │     API      │    │  Gemini API  │
   ├──────────────┤    ├──────────────┤    ├──────────────┤
   │ - Chat gen   │    │ - Embeddings │    │ - Doc convert│
   │ - Tool calls │    │   (1536-dim) │    │ - PDF→MD     │
   │ - Streaming  │    │ - Whisper    │    │ - DOCX→MD    │
   │ - Thinking   │    │   (Speech)   │    │              │
   └──────────────┘    └──────────────┘    └──────────────┘
           │                   │
           │                   │
           │                   ▼
           │           ┌──────────────┐
           │           │ LanguageTool │
           │           ├──────────────┤
           │           │ - Spelling   │
           │           │ - Grammar    │
           │           │ - Multi-lang │
           │           └──────────────┘
           │
           ▼
   ┌──────────────────────────────────────┐
   │              OAuth Providers          │
   │  ┌──────────────┐  ┌──────────────┐  │
   │  │    Google    │  │    GitHub    │  │
   │  │    OAuth     │  │    OAuth     │  │
   │  └──────────────┘  └──────────────┘  │
   └──────────────────────────────────────┘

   ┌──────────────────────────────────────┐
   │              Email Service            │
   │  ┌──────────────┐  ┌──────────────┐  │
   │  │   SendGrid   │  │     SMTP     │  │
   │  │    API       │  │    Server    │  │
   │  └──────────────┘  └──────────────┘  │
   └──────────────────────────────────────┘
```

### 8.2 Environment Variable Configuration

```bash
# === Core AI Services ===
ANTHROPIC_API_KEY=sk-ant-xxx        # Claude API key
OPENAI_API_KEY=sk-xxx               # OpenAI API (Embeddings + Whisper)
GEMINI_API_KEY=xxx                  # Google Gemini (doc conversion)

# === Database ===
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db  # PostgreSQL
# Or for local development
DATABASE_URL=sqlite+aiosqlite:///./doxmind.db

# === Authentication ===
JWT_SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080            # 7 days

# === OAuth ===
GOOGLE_OAUTH_CLIENT_ID=xxx
GOOGLE_OAUTH_CLIENT_SECRET=xxx
GITHUB_OAUTH_CLIENT_ID=xxx
GITHUB_OAUTH_CLIENT_SECRET=xxx

# === Email ===
SENDGRID_API_KEY=SG.xxx             # Or use SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASSWORD=pass

# === Feature Configuration ===
DEBUG=false                         # Debug mode
CORS_ORIGINS=["https://your-domain.com"]
MAX_FILE_SIZE=52428800              # 50MB
WEB_SEARCH_MAX_USES=3               # Web search limit
WEB_FETCH_MAX_USES=3                # Web fetch limit

# === Model Configuration ===
DEFAULT_MODEL=claude-opus-4-5-20251101
FAST_MODEL=claude-3-5-sonnet-20241022
MAX_OUTPUT_TOKENS=4096
EMBEDDING_MODEL=text-embedding-3-small
```

---

## 9. Security Architecture

### 9.1 Authentication and Authorization

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Security Architecture                         │
└─────────────────────────────────────────────────────────────────────┘

                      ┌─────────────────┐
                      │   User Request  │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │   CORS Check    │
                      │ (Origin Whitelist)│
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │  Rate Limiting  │
                      │   (SlowAPI)     │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │ JWT Validation  │
                      │ - Signature     │
                      │ - Expiration    │
                      │ - User extract  │
                      └────────┬────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
         ┌──────────┐   ┌──────────┐   ┌──────────┐
         │ Public   │   │  Auth    │   │  Admin   │
         │ Routes   │   │  Routes  │   │  Routes  │
         │ /shared  │   │ /api/*   │   │ /admin   │
         │ /health  │   │          │   │(not impl)│
         └──────────┘   └──────────┘   └──────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │ Resource Isolat │
                      │ user_id filter  │
                      │ (own data only) │
                      └─────────────────┘
```

### 9.2 Security Measures Checklist

| Layer | Measure | Implementation |
|-------|---------|----------------|
| **Authentication** | JWT Token | HS256 signature, 7-day expiry |
| **Password** | bcrypt hash | 12-round salted hash |
| **Transport** | HTTPS Only | Force HTTPS |
| **CORS** | Origin whitelist | Configured allowed domains |
| **CSP** | Content Security Policy | Prevent XSS attacks |
| **Rate Limiting** | SlowAPI | Per-minute request limits |
| **Data Isolation** | user_id filter | Forced user filtering in queries |
| **Input Validation** | Pydantic | Auto request body validation |
| **SQL Injection** | SQLAlchemy ORM | Parameterized queries |
| **Sensitive Info** | Env variables | No hardcoded secrets |

### 9.3 Middleware Configuration

```python
# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security Headers
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    return response

# Rate Limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

---

## 10. Performance Optimization Strategies

### 10.1 Frontend Optimization

| Strategy | Implementation | Effect |
|----------|----------------|--------|
| **Debounced Saves** | 500ms debounce | Reduce API calls |
| **Stream Rendering** | SSE real-time display | Lower perceived latency |
| **Code Splitting** | Next.js dynamic imports | Reduce initial load |
| **Image Optimization** | Next/Image | Auto compression and lazy load |
| **State Persistence** | Zustand persist | Reduce repeat requests |
| **Optimistic Updates** | Local update first | Instant UI feedback |
| **Virtual Scrolling** | Not implemented (TODO) | Long list performance |

### 10.2 Backend Optimization

| Strategy | Implementation | Effect |
|----------|----------------|--------|
| **Async I/O** | asyncio + aiohttp | High concurrency handling |
| **Connection Pool** | SQLAlchemy pool | Database connection reuse |
| **Streaming Response** | SSE Generator | Memory efficient |
| **Vector Index** | pgvector HNSW | Fast similarity retrieval |
| **Completion Cache** | LRU Cache | Reduce LLM calls |
| **Batch Embedding** | OpenAI batch | Reduce API round trips |

### 10.3 Database Optimization

```sql
-- Index Optimization
CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_updated_at ON files(updated_at DESC);
CREATE INDEX idx_conversations_file_id ON conversations(file_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- pgvector Index (HNSW)
CREATE INDEX ON vector_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

## 11. Deployment Architecture

### 11.1 Docker Compose Development Environment

```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: doxmind
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  backend:
    build: ./server
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@postgres:5432/doxmind
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    depends_on:
      - postgres
    ports:
      - "8000:8000"

  frontend:
    build: .
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    depends_on:
      - backend
    ports:
      - "3000:3000"

volumes:
  postgres_data:
```

### 11.2 Production Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Production Deployment Architecture                │
└─────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────┐
                         │   CDN (Vercel)  │
                         │  Static Assets  │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   Load Balancer │
                         │   (Heroku)      │
                         └────────┬────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
           ┌─────────────────┐         ┌─────────────────┐
           │   Frontend      │         │   Backend       │
           │   (Next.js)     │         │   (FastAPI)     │
           │   Dyno x2       │         │   Dyno x2       │
           └─────────────────┘         └────────┬────────┘
                                                │
                                       ┌────────┴────────┐
                                       ▼                 ▼
                              ┌─────────────────┐  ┌─────────────────┐
                              │   PostgreSQL    │  │   Redis         │
                              │   (Heroku)      │  │   (Session)     │
                              │   + pgvector    │  │   (Optional)    │
                              └─────────────────┘  └─────────────────┘
```

---

## 12. Monitoring and Logging

### 12.1 Logging Architecture

```python
# Structured Logging Configuration
import structlog

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

# Usage Example
logger = structlog.get_logger()
logger.info("chat_request", user_id=user.id, file_id=file_id, mode=mode)
logger.error("llm_error", error=str(e), model=model)
```

### 12.2 Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `chat_latency_ms` | Histogram | Chat response latency |
| `llm_tokens_used` | Counter | LLM token usage |
| `api_requests_total` | Counter | Total API requests |
| `api_errors_total` | Counter | API error count |
| `db_query_duration_ms` | Histogram | Database query duration |
| `rag_search_latency_ms` | Histogram | RAG retrieval latency |
| `active_users` | Gauge | Current active users |

---

## 13. Future Roadmap

### 13.1 Technical Evolution

| Feature | Priority | Description |
|---------|----------|-------------|
| **Real-time Collaboration** | P1 | WebSocket multi-user real-time editing |
| **Hybrid Search** | P1 | BM25 + semantic search combination |
| **Memory System** | P2 | User preferences and writing style learning |
| **Offline Mode** | P2 | Service Worker + IndexedDB |
| **Native App** | P3 | React Native mobile app |
| **Plugin System** | P3 | Extensible editor functionality |

### 13.2 Architecture Improvements

```
Future Architecture Evolution:

1. Microservices Split
   - Auth Service
   - Document Service
   - AI Service
   - RAG Service

2. Message Queue Introduction
   - Async document processing
   - Embedding generation queue
   - Push notifications

3. Cache Layer Optimization
   - Redis session cache
   - CDN static assets
   - Query result caching

4. Observability Enhancement
   - OpenTelemetry distributed tracing
   - Prometheus + Grafana monitoring
   - Sentry error tracking
```

---

## Appendix

### A. Common Commands

```bash
# Frontend Development
npm run dev           # Start dev server
npm run build         # Production build
npm run lint:fix      # Fix code style
npm test              # Run tests

# Backend Development
cd server
python main.py        # Start backend
pytest                # Run tests
ruff format .         # Format code

# Docker
docker-compose up -d  # Start all services
docker-compose logs -f # View logs
```

### B. API Documentation

Available in development mode:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### C. Reference Resources

- [TipTap Documentation](https://tiptap.dev/docs)
- [Zustand Documentation](https://docs.pmnd.rs/zustand)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [Anthropic Claude API](https://docs.anthropic.com)
- [pgvector Documentation](https://github.com/pgvector/pgvector)

---

*Document Version: 1.0.0*
*Last Updated: 2026-01-28*
