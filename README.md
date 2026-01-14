# doXmind Mini

> AI-powered writing assistant for markdown editing - "Cursor for Writing"

A minimalist, modern AI writing tool that combines a powerful markdown editor with Claude AI assistance.

<img width="1355" height="859" alt="880c13120803e0339a8c8c2b0105486" src="https://github.com/user-attachments/assets/581ae1e0-b96a-4654-abc3-9fe5e49b2ae3" />


## Features

### Core Editor
- **Rich Markdown Editor** - TipTap-based WYSIWYG editor with full markdown support
- **Version History** - Track changes and restore previous versions
- **Dark/Light Mode** - Beautiful UI with theme support

### AI Capabilities
- **AI Chat** - Conversational AI assistance powered by Claude
- **Quick Edit** - Select text and instantly improve, translate, or simplify
- **Autocomplete** - GitHub Copilot-style AI text completion
- **RAG Search** - Semantic search across your documents

### Knowledge Base
- **Document Attachments** - Attach PDF, DOCX, PPTX files to conversations
- **AI Document Analysis** - AI can search and read your attached documents
- **Vector Search** - Semantic search across your knowledge base

### Multimodal Support
- **Image Upload** - Paste or upload images in chat (up to 10 images per message)
- **Vision Analysis** - Claude analyzes images using Anthropic Vision API
- **Supported Formats** - JPEG, PNG, GIF, WebP (max 5MB per image)

### File Import
- **PDF Import** - Convert PDF documents to editable Markdown
- **Word Import** - Import DOCX files with formatting preserved
- **Markdown Import** - Direct import of .md files
- **Auto Indexing** - Imported files are automatically indexed for RAG search

### Mobile Experience
- **Responsive Design** - Optimized UI for phones and tablets
- **Bottom Navigation** - iOS-style navigation bar on mobile
- **Swipe Gestures** - Drag-up panels for chat and outline
- **Touch-Friendly** - Large touch targets (44-48px) for comfortable interaction

## Tech Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **React 19** - Latest React with Server Components
- **TipTap** - Headless rich text editor
- **Tailwind CSS** - Utility-first styling
- **Zustand** - Lightweight state management
- **React Query** - Data fetching and caching

### Backend
- **FastAPI** - Modern Python web framework
- **LangGraph** - Agent orchestration framework
- **Claude API** - Anthropic's AI models (including Vision)
- **ChromaDB** - Vector database for RAG
- **MarkItDown** - PDF/DOCX to Markdown conversion
- **PostgreSQL** - Production database (Docker)
- **SQLite** - Local development database

## Quick Start

### Option 1: Docker (Recommended)

The easiest way to run the full stack with PostgreSQL and ChromaDB.

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Add your Anthropic API key to .env
# ANTHROPIC_API_KEY=sk-ant-xxx

# 3. Start all services
docker-compose up -d

# 4. Open the app
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# ChromaDB: http://localhost:8001
```

**Docker Services:**
- `postgres` - PostgreSQL 16 database
- `chroma` - ChromaDB vector database  
- `backend` - FastAPI server
- `frontend` - Next.js app

### Option 2: Local Development

For development without Docker.

#### Prerequisites

- Node.js 20+
- Python 3.12+
- Anthropic API Key

#### Installation

1. **Install dependencies**

```bash
cd doxmind-mini

# Frontend
npm install

# Backend
cd server
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

2. **Configure environment**

```bash
# Create server/.env
cp server/.env.example server/.env
# Edit and add ANTHROPIC_API_KEY
```

3. **Start development servers**

```bash
# Option A: Run both together
npm run dev:all

# Option B: Run separately
# Terminal 1 - Frontend
npm run dev

# Terminal 2 - Backend
cd server
python main.py
```

4. **Open the app**

Navigate to [http://localhost:3000](http://localhost:3000)

## Project Structure

```
doxmind-mini/
├── src/                      # Frontend source
│   ├── app/                  # Next.js App Router
│   ├── components/           # React components
│   │   ├── editor/          # TipTap editor
│   │   ├── ai/              # AI chat & quick edit
│   │   ├── kb/              # Knowledge base components
│   │   ├── mobile/          # Mobile-responsive components
│   │   ├── sidebar/         # File management
│   │   ├── layout/          # App layout
│   │   └── ui/              # Base UI components
│   ├── hooks/               # Custom React hooks
│   ├── stores/              # Zustand stores
│   ├── lib/                 # Utilities
│   └── types/               # TypeScript types
│
├── server/                   # Backend source
│   ├── api/                 # API routes
│   │   ├── knowledge_base.py # KB attachments API
│   │   └── import_file.py   # File import API
│   ├── agents/              # LangGraph agents
│   ├── services/            # Business logic
│   │   └── rag_service.py   # Vector search service
│   ├── db/                  # Database
│   ├── main.py              # FastAPI app
│   └── config.py            # Configuration
│
├── docker-compose.yml        # Docker orchestration
├── Dockerfile.frontend       # Frontend Docker image
└── server/Dockerfile         # Backend Docker image
```

## Environment Variables

### Docker (.env)

```env
# Database
POSTGRES_USER=doxmind
POSTGRES_PASSWORD=doxmind123
POSTGRES_DB=doxmind

# API Key
ANTHROPIC_API_KEY=sk-ant-xxx

# Debug
DEBUG=true
```

### Backend (server/.env)

```env
# For PostgreSQL (Docker)
DATABASE_URL=postgresql+asyncpg://doxmind:doxmind123@localhost:5432/doxmind

# For SQLite (Local)
DATABASE_URL=sqlite+aiosqlite:///./data/app.db

# Chroma (Docker)
CHROMA_HOST=localhost
CHROMA_PORT=8001

# API Key
ANTHROPIC_API_KEY=sk-ant-xxx
```

## AI Features

### Chat Assistant
- Ask questions about your document
- Request writing help and suggestions
- Get summaries and explanations
- @ mention files for context
- Attach images for visual analysis
- Upload documents to knowledge base for reference

### Knowledge Base
Attach documents to your conversation for AI to reference:
- **Supported Formats** - PDF, DOCX, PPTX (max 50MB)
- **Drag & Drop** - Simply drag files into the chat
- **AI Tools** - AI can search, read, and list your documents
- **Status Tracking** - See upload progress and indexing status

### Image Analysis
Send images to Claude for visual understanding:
- **Paste or Upload** - Ctrl+V to paste, or click to upload
- **Multiple Images** - Up to 10 images per message
- **Format Support** - JPEG, PNG, GIF, WebP (max 5MB each)

### Quick Edit
Select text and choose from:
- **Fix Grammar** - Correct spelling and grammar
- **Improve** - Enhance writing quality
- **Simplify** - Use simpler language
- **Expand** - Add more detail
- **Shorten** - Make concise
- **Translate** - English/Chinese translation
- **Tone** - Professional or casual

### Autocomplete
Press Tab to accept AI suggestions as you type.

### File Import
Import external documents directly into the editor:
- **PDF** - Extract text and convert to Markdown
- **DOCX** - Preserve formatting from Word documents
- **Markdown** - Direct import of .md files
- **Auto-Index** - Imported files are indexed for RAG search

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/stream` | Stream AI chat response |
| POST | `/api/edit/quick` | Quick edit actions |
| POST | `/api/autocomplete/suggest` | Get text suggestion |
| GET | `/api/files` | List files |
| POST | `/api/files` | Create file |
| PUT | `/api/files/:id` | Update file |
| DELETE | `/api/files/:id` | Delete file |
| POST | `/api/files/search` | RAG search |
| POST | `/api/import` | Import PDF/DOCX/MD file |
| GET | `/api/versions/:fileId` | List versions |
| POST | `/api/versions/:fileId/:versionId/restore` | Restore version |
| POST | `/api/kb/:conversationId/attachments` | Upload KB attachment |
| GET | `/api/kb/:conversationId/attachments` | List KB attachments |
| DELETE | `/api/kb/:conversationId/attachments/:id` | Delete KB attachment |
| POST | `/api/kb/:conversationId/search` | Search knowledge base |

## Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Rebuild after changes
docker-compose up -d --build

# Reset database
docker-compose down -v
docker-compose up -d
```

## License

MIT

## Credits

Built with:
- [Next.js](https://nextjs.org/)
- [TipTap](https://tiptap.dev/)
- [FastAPI](https://fastapi.tiangolo.com/)
- [LangGraph](https://langchain-ai.github.io/langgraph/)
- [Claude](https://anthropic.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [ChromaDB](https://www.trychroma.com/)
