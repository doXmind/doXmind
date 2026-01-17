# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

doXmind Mini is an AI-powered markdown writing assistant ("Cursor for Writing"). It combines a TipTap-based WYSIWYG editor with Claude AI assistance, featuring real-time chat, quick edit actions, autocomplete, RAG search, and a knowledge base system.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TipTap editor, Zustand state management, Tailwind CSS, Framer Motion
- **Backend:** FastAPI, Python 3.12, LangGraph agents, SQLAlchemy 2.0 (async), ChromaDB for vector search
- **Database:** PostgreSQL (production/Docker) or SQLite (local development)

## Commands

### Frontend (from project root)

```bash
npm run dev           # Start Next.js dev server (port 3000)
npm run build         # Production build
npm run lint          # Run ESLint
npm run lint:fix      # Auto-fix ESLint issues
npm run type-check    # TypeScript validation
npm test              # Run Vitest in watch mode
npm run test:ci       # Run tests with coverage
npm run format        # Prettier format
npm run dev:all       # Run both frontend and backend concurrently
```

### Backend (from server/ directory)

```bash
python main.py                              # Run FastAPI server (port 8000)
pytest                                      # Run all tests
pytest --cov                                # Run with coverage
pytest -v -m unit                           # Run only unit tests
pytest tests/unit/test_specific.py::test_name  # Run single test
ruff check .                                # Lint Python code
ruff format .                               # Format Python code
```

### Docker

```bash
docker-compose up -d          # Start all services (postgres, chroma, backend, frontend)
docker-compose logs -f        # View logs
docker-compose down -v        # Stop and remove volumes (resets database)
```

## Architecture

### Frontend Structure

The frontend uses a Zustand-based state management pattern with custom hooks for business logic:

- **Stores** (`src/stores/`): Global state for files, chat, editor, auth, knowledge base, layout
- **Hooks** (`src/hooks/`): Business logic encapsulation (chat streaming, edit operations, autocomplete, diff review)
- **Extensions** (`src/extensions/`): Custom TipTap extensions for diff-review, search, autocomplete, spellcheck

Key data flow: User Input → TipTap/AI components → Zustand stores → API calls → SSE stream processing → State update → UI re-render

Entry point: `src/app/editor/page.tsx`

### Backend Structure

The backend follows a layered architecture:

- **API routes** (`server/api/`): Thin FastAPI routers handling HTTP
- **Services** (`server/services/`): Business logic (LLM, RAG, auth, export)
- **Agents** (`server/agents/`): LangGraph orchestration with tool definitions for document editing and KB operations
- **Database** (`server/db/`): SQLAlchemy models with async support

Entry point: `server/main.py`

### AI Integration

- **Chat streaming:** Server-Sent Events (SSE) for real-time Claude responses
- **Tool system:** Document tools (`str_replace`, `insert`, `replace_all`) and KB tools (`search_documents`, `read_document`)
- **Extended thinking:** Optional deep reasoning mode for complex requests
- **Vision:** Multimodal support for image analysis (up to 10 images per message)

### RAG System

ChromaDB-based vector search with two chunking strategies:
- Overlap chunking for general content
- Sentence chunking for precise retrieval

Collections exist for documents, KB attachments, and conversation-scoped data.

## Environment Variables

Backend requires `ANTHROPIC_API_KEY` in `server/.env`. For local development, `DATABASE_URL` defaults to SQLite. See `server/.env.example` for all options.

## Code Quality

- **Pre-commit hooks:** ESLint and Prettier run on staged files via Husky
- **Frontend:** TypeScript strict mode with `@/*` path aliases
- **Backend:** Ruff for linting/formatting (line length 100, double quotes)

## API Documentation

When running locally with DEBUG=true:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
