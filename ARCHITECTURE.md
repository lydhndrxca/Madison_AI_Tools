# Architecture

## Overview

Madison AI Suite is a three-tier desktop application:

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Shell                        │
│  electron/main.js                                       │
│  - Spawns the FastAPI backend as a child process        │
│  - Creates BrowserWindow pointed at Vite dev server     │
│  - Manages app lifecycle (close → kill backend)         │
└────────────────────┬────────────────────────────────────┘
                     │ Loads http://127.0.0.1:5173
┌────────────────────▼────────────────────────────────────┐
│                React SPA (Vite + Tailwind)               │
│  frontend/src/app.tsx                                    │
│                                                          │
│  Providers (hooks/):                                     │
│    ToastContext, SessionContext, ShortcutsProvider,       │
│    VoiceToTextProvider, ArtboardProvider,                 │
│    FavoritesContext, CustomSectionsContext,               │
│    VoiceDirectorProvider, ArtDirectorProvider             │
│                                                          │
│  Tool Pages (components/tools/):                         │
│    CharacterPage, PropPage, EnvironmentPage,             │
│    UILabPage, WeaponPage, GeminiPage, MultiviewPage,     │
│    GeneratedImagesPage, StyleLibraryPage,                │
│    PromptBuilderPage                                     │
│                                                          │
│  Shared (components/shared/):                            │
│    ImageViewer, ArtboardCanvas, GridGallery,             │
│    AnnotationLayer, DeepSearchPanel, EditorToolbar,      │
│    ArtDirectorWidget                                     │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP REST + WebSocket + SSE
                     │ http://127.0.0.1:8420/api/*
┌────────────────────▼────────────────────────────────────┐
│              FastAPI Backend (port 8420)                  │
│  src/pubg_madison_ai_suite/api/server.py                 │
│                                                          │
│  Core:                                                   │
│    core.py    — Gemini API wrapper (call_gemini_*)       │
│    ws.py      — WebSocket progress manager               │
│    cancel.py  — Request cancellation events              │
│                                                          │
│  Routes (19 modules):                                    │
│    system     — Health, settings, key management         │
│    gemini     — General image generation                 │
│    character  — Character lab pipeline                   │
│    prop       — Prop lab pipeline                        │
│    environment— Environment lab pipeline                 │
│    uilab      — UI lab pipeline                          │
│    weapon     — Weapon lab pipeline                      │
│    editor     — Inpaint, erase, outpaint, bg removal     │
│    styles     — Style library CRUD                       │
│    gallery    — Generated images browser                 │
│    artboard   — Board save/load/share                    │
│    history    — Generation audit trail                   │
│    queue      — Batch generation queue                   │
│    export     — ZIP handoff packages                     │
│    director   — Voice art-direction (function calling)   │
│    refsearch  — Deep reference image search (SSE)        │
│    userlib    — Custom sections and user libraries       │
│    prompts    — Prompt overrides                         │
│    palette    — Color palette extraction                 │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────────────┐
│              Google Gemini API                            │
│  Models: gemini-2.0-flash-exp, imagen-3, etc.           │
│  Features:                                               │
│    - generateContent (text + image generation)           │
│    - Google Search grounding (reference search)          │
│    - Function calling (art director voice routing)       │
│    - Audio input (voice transcription)                   │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Image Generation (typical)

1. User configures attributes + style in a Tool Page (e.g., CharacterPage)
2. Frontend builds request body and POSTs to `/api/character/generate`
3. Backend route handler constructs a Gemini prompt from attributes + style references
4. `core.py` sends the prompt to Gemini API, receives base64-encoded image
5. Backend saves image to `ALL GENERATED IMAGES/` with metadata filename
6. Backend returns base64 image + metadata in JSON response
7. Frontend renders image in `ImageViewer`, updates generation history

### Real-time Progress

- Backend sends progress updates via WebSocket (`/ws/progress`)
- `ws.py` manages connected clients; route handlers call `manager.broadcast()`
- Frontend `useApi` hook listens on the WebSocket for progress percentages

### Streaming (SSE)

- Deep Reference Search and Art Director use Server-Sent Events
- Backend yields `text/event-stream` responses
- Frontend `apiFetchSSE()` reads the stream incrementally

### Collaborative Artboard

- WebSocket-based room system in `artboard.py`
- Users join a room code; board state synced on changes
- Remote cursor positions broadcast for presence

## Persistence

All persistence is file-system based — no database.

| Data | Location | Mechanism |
|------|----------|-----------|
| Generated images | `ALL GENERATED IMAGES/<tool>/<date>/` | Backend saves on generation |
| Artboard state | `ARTBOARD_LIBRARY/<board>/board.json` | Frontend saves via API |
| Style references | `style_library/<category>/` | File upload via API |
| User settings | `localStorage` (browser) | Backed up to `config/user_settings_backup.json` |
| API key | `config/keys.json` | Set via Settings panel |
| Favorites | `localStorage` + `favorites/` folder | Context provider + API |

## Key Abstractions

- **`core.py`** — All AI calls go through `call_gemini_image()` or `call_gemini_text()`. This is the single integration point with the Gemini API.
- **`ImageViewer`** — Shared image display component with zoom, pan, inpaint toolbar, annotation layer. Used by all tool pages.
- **`ArtboardContext`** — React context managing multi-board state, selection, undo/redo (50 levels), viewport persistence.
- **`SessionContext`** — Persists per-tool project state (attributes, images, history) across tab switches and sessions.
