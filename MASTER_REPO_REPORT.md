# Master Repo Report

| Field | Value |
|-------|-------|
| Project root | `C:\Dev\Madison_AI_Tools` |
| Generated at | 2026-03-29 17:28:58 |
| Includes | Snapshot + Health Audit + Comprehensive Repo Report + TASKS |
| Health | **RED** (report_id: 20260329_172858) |

---

## Repo Snapshot

# Repo Snapshot

| Field | Value |
|-------|-------|
| Generated | 2026-03-29 17:28:58 |
| Report ID | 20260329_172858 |
| Repo root | `C:\Dev\Madison_AI_Tools` |
| Branch | main |
| HEAD | `44a7ff7` — feat: add art table improvements, Edit Prop/Environment panels, and deep search |
| HEAD date | 2026-03-29 17:28:09 -0500 |

---

## Folder Tree (depth 4)

```
Madison_AI_Tools/
├── ALL GENERATED IMAGES/
│   ├── AI PropLab/
│   │   └── 2026-03-29/
│   ├── Character Generator/
│   │   ├── 2026-03-27/
│   │   ├── 2026-03-28/
│   │   └── 2026-03-29/
│   └── Default Gemini/
│       └── 2026-03-29/
├── ARTBOARD_LIBRARY/
│   ├── Art Table/
│   └── Shawn Props/
├── config/
├── electron/
├── frontend/
│   ├── public/
│   └── src/
│       ├── components/
│       │   ├── shared/
│       │   │   └── editor/
│       │   ├── shell/
│       │   ├── tools/
│       │   │   ├── character/
│       │   │   ├── environment/
│       │   │   ├── favorites/
│       │   │   ├── gemini/
│       │   │   ├── generated-images/
│       │   │   ├── history/
│       │   │   ├── multiview/
│       │   │   ├── prompt-builder/
│       │   │   ├── prompt-library/
│       │   │   ├── prop/
│       │   │   ├── style-library/
│       │   │   ├── transcripts/
│       │   │   ├── uilab/
│       │   │   └── weapon/
│       │   └── ui/
│       ├── hooks/
│       └── lib/
├── reference_guns/
├── src/
│   └── pubg_madison_ai_suite/
│       ├── api/
│       │   └── routes/
│       ├── assets/
│       │   └── Weapon_Generator/
│       └── tools/
│           ├── AI_Character_Generator_v1_4/
│           ├── AI_Gun_Generator_v1_3/
│           └── AI_Multitool_v1_1/
├── style_library/
└── .repo_snapshot/
    └── health_reports/
```

---

## Governance Documents

| Document | Status |
|----------|--------|
| README.md | **MISSING** |
| PROJECT.md | MISSING |
| SPEC.md | MISSING |
| ARCHITECTURE.md | MISSING |
| DECISIONS.md | MISSING |
| TASKS.md | EXISTS (788 bytes) |
| AGENT_RULES.md | MISSING |

---

## Dependency Manifests

| Manifest | Location | Notes |
|----------|----------|-------|
| `pyproject.toml` | repo root | Python 3.9+, hatchling build, 9 deps |
| `requirements.txt` | repo root | 9 packages |
| `package.json` | `frontend/` | React 19, Electron 35, Vite 6, Tailwind 4 |

---

## Entry Points

| Entry | File | Command |
|-------|------|---------|
| Launcher | `run.bat` | `run.bat` — starts backend, frontend, Electron |
| Backend | `src/pubg_madison_ai_suite/api/server.py` | `python -m uvicorn pubg_madison_ai_suite.api.server:app --port 8420` |
| Frontend | `frontend/` | `npx vite --host 127.0.0.1` (port 5173) |
| Electron | `electron/main.js` | `npx electron ../electron/main.js` |

---

## Lines of Code by Language

| Extension | Files | Bytes | LOC |
|-----------|------:|------:|----:|
| .tsx | 63 | 1,189,220 | 23,217 |
| .py | 29 | 938,908 | 18,898 |
| .json | 163 | 111,219,461 | 10,159 |
| .md | 7 | 100,666 | 1,406 |
| .ts | 14 | 36,138 | 995 |
| .css | 2 | 6,698 | 255 |
| .js | 2 | 5,220 | 145 |
| .toml | 1 | 804 | 30 |
| .html | 1 | 408 | 12 |
| .txt | 1 | 193 | 9 |
| **TOTAL** | **283** | **113,497,716** | **55,126** |

> Note: JSON bytes are dominated by `ARTBOARD_LIBRARY/Art Table/board.json` (62 MB) and `config/user_settings_backup.json` (40 MB) which contain serialized base64 image data.

---

## Subsystem Hints

| Subsystem | Key Paths |
|-----------|-----------|
| UI (React/Electron) | `frontend/src/components/`, `electron/main.js` |
| API (FastAPI) | `src/pubg_madison_ai_suite/api/` (19 route modules) |
| AI Integration | `api/core.py` (Gemini API wrapper), `api/routes/director.py` |
| Image Pipeline | `api/routes/editor.py`, `api/routes/gallery.py` |
| Search | `api/routes/refsearch.py`, `frontend/src/components/shared/DeepSearchPanel.tsx` |
| Persistence | `api/routes/artboard.py`, `api/routes/styles.py`, `api/routes/userlib.py` |
| Legacy Tools | `src/pubg_madison_ai_suite/tools/` (3 standalone Python tools, dead) |

---

## Duplication Signals

| Signal | Details |
|--------|---------|
| Legacy tools | 3 standalone generators under `tools/` (~12K LOC) superseded by `api/routes/` |
| Page patterns | CharacterPage, PropPage, EnvironmentPage, UILabPage share identical patterns (~9K LOC each) |

---

## Config Hints

| Type | Details |
|------|---------|
| Env vars | `PYTHONPATH`, `PUBG_SUITE_SAVE_ROOT`, `PUBG_SUITE_ROOT` (set in `run.bat`) |
| API key | `config/keys.json` (gitignored, not tracked) |
| User settings | `config/user_settings_backup.json` (**tracked in git** — 40 MB) |
| Ports | Backend: 8420, Frontend: 5173 |

---

## Git Churn

| Metric | Value |
|--------|-------|
| Total commits | 10 |
| Latest | `44a7ff7` 2026-03-29 |
| Branch | main |
| Remote | `origin/main` (up to date) |

---

## Health Report

# Health Report

| Field | Value |
|-------|-------|
| Report ID | `20260329_172858` |
| Date | 2026-03-29 17:28:58 |
| Overall Health | **RED** |
| Primary Issue Type | Hygiene |

---

## Scoring

### RED Triggers

1. **Output-only dirs tracked in git** — `ARTBOARD_LIBRARY/Art Table/board.json` (62 MB) and `config/user_settings_backup.json` (40 MB) are committed. These are user-generated runtime artifacts, not source code. Evidence: `git ls-files -- ARTBOARD_LIBRARY/ config/user_settings_backup.json` returns 3 files.

### YELLOW Triggers

1. **Doc drift** — No README.md exists. `pyproject.toml` describes the project but provides no setup/run instructions. The only runnable entry point is `run.bat` (Windows-only).
2. **Text files > 100 KB** — `CharacterPage.tsx` (188 KB), `UILabPage.tsx` (115 KB), `EnvironmentPage.tsx` (106 KB), `PropPage.tsx` (101 KB).
3. **Portability: Fail** — No `run.sh` or cross-platform launcher. `run.bat` is Windows CMD only. `pywin32` is a Windows-only dependency.
4. **Sustained growth > 15%** — LOC grew from 39,562 → 55,126 (+39.3%) in one audit interval.

---

## Top 3 Risks

1. **Repository bloat from tracked binary blobs** — 102 MB of serialized artboard/settings data makes cloning slow, diffs meaningless for those files, and will only grow. This is the most urgent issue.
2. **Monolithic page components** — Four tool pages (Character, UI Lab, Prop, Environment) each exceed 100 KB / 1,900 LOC in single files. These are difficult to review, test, and maintain.
3. **No README or onboarding docs** — A new contributor cannot set up the project without reading `run.bat` and guessing prerequisites.

---

## Top 3 Recommended Actions

1. **Add `ARTBOARD_LIBRARY/` and `config/user_settings_backup.json` to `.gitignore`** and use `git rm --cached` to untrack them. This immediately removes 102 MB from the repo.
2. **Create `README.md`** with prerequisites (Python 3.9+, Node 18+, Windows), install steps, and how to run.
3. **Delete legacy tools** (`src/pubg_madison_ai_suite/tools/AI_Character_Generator_v1_4/`, `AI_Gun_Generator_v1_3/`, `AI_Multitool_v1_1/`) — 15 files, ~12K LOC of dead code superseded by the API routes.

---

## Findings

### Governance

| Document | Status |
|----------|--------|
| README.md | **MISSING** — no onboarding path |
| PROJECT.md | MISSING |
| SPEC.md | MISSING |
| ARCHITECTURE.md | MISSING |
| DECISIONS.md | MISSING |
| TASKS.md | Present (contains Health Audit Cleanup items) |
| AGENT_RULES.md | MISSING |

### Drift / Bloat

- **Tracked output dirs**: `ARTBOARD_LIBRARY/` (2 board JSON files, 62 MB + smaller), `config/user_settings_backup.json` (40 MB). Neither belongs in version control.
- **.repo_snapshot/** is also tracked — health audit artifacts are committed. Low risk since these are small text files, but ideally should be gitignored.
- **Legacy tools directory**: `src/pubg_madison_ai_suite/tools/` contains 3 old standalone Python generators (15 files, ~12K LOC). These are not imported by any API route and are dead code.

### Doc Drift

| # | Description | Evidence |
|---|-------------|----------|
| 1 | No README despite being a runnable project | `run.bat` exists, README.md does not |
| 2 | `pyproject.toml` includes `tools/` in build but tools are unused | `[tool.hatch.build.targets.wheel]` lists `src/pubg_madison_ai_suite/tools/**` |
| 3 | TASKS.md cleanup items from prior audit still open | All 6 items unchecked |

### Cleanup Candidates

1. `src/pubg_madison_ai_suite/tools/AI_Character_Generator_v1_4/` — 1 file, 6,738 LOC
2. `src/pubg_madison_ai_suite/tools/AI_Gun_Generator_v1_3/` — 12 files, 2,487+ LOC
3. `src/pubg_madison_ai_suite/tools/AI_Multitool_v1_1/` — 2 files, 2,692+ LOC
4. `ARTBOARD_LIBRARY/Art Table/board.json` — 62 MB tracked blob
5. `config/user_settings_backup.json` — 40 MB tracked blob
6. `.repo_snapshot/` files tracked in git — should be gitignored

### Growth & Trajectory

| Metric | Prior (20260329_102917) | Current | Delta |
|--------|------------------------|---------|-------|
| Total LOC | 39,562 | 55,126 | +15,564 (+39.3%) |
| Total text files | 129 | 283 | +154 |
| Largest file LOC | 2,900 | 3,088 | CharacterPage.tsx |

**Top files by LOC:**

| File | LOC | Bytes |
|------|----:|------:|
| CharacterPage.tsx | 3,088 | 188 KB |
| character_generator.py (dead) | 6,738 | 341 KB |
| prop_generator.py (dead) | 2,692 | 137 KB |
| Weapon_Generator_V1_3.py (dead) | 2,487 | 130 KB |
| UILabPage.tsx | 2,133 | 115 KB |
| EnvironmentPage.tsx | 2,012 | 106 KB |
| PropPage.tsx | 1,903 | 101 KB |

### Prompt & Template Surface

- No centralized prompt template system (`src/templates.py` does not exist).
- Prompts are embedded inline in API route handlers (e.g., `character.py`, `prop.py`, `environment.py`, `uilab.py`).
- Each route module contains system instruction strings in generate/edit/extract handlers.
- Near-duplicate prompt patterns exist across the 4 lab route files (character, prop, environment, uilab) — similar style rules, format instructions, and constraints.

### Secrets Status

- `config/keys.json` is properly gitignored and NOT tracked.
- Grep matches for API key patterns in `config/user_settings_backup.json` and `ARTBOARD_LIBRARY/Art Table/board.json` are **false positives** — these are base64-encoded image data strings, not actual API keys.
- **No real secrets found in tracked source code.**

### Duplication Status

- No parallel systems (single API server, single UI framework, single build system).
- Structural duplication exists in the 4 lab page components (very similar patterns) but this is acceptable copy-paste customization, not divergent systems.

---

## Proposed Cleanup Plan

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Untrack `ARTBOARD_LIBRARY/` and `config/user_settings_backup.json`, add to `.gitignore` | 5 min | Removes 102 MB from repo |
| P0 | Create `README.md` | 30 min | Enables onboarding |
| P1 | Delete 3 legacy tool dirs | 5 min | Removes ~12K LOC dead code |
| P1 | Add `.repo_snapshot/` to `.gitignore` | 2 min | Stops tracking audit artifacts |
| P2 | Create `ARCHITECTURE.md` | 1 hr | Documents Electron→FastAPI→Gemini flow |
| P2 | Split CharacterPage.tsx into sub-components | 2-4 hrs | Reduces largest file from 3K LOC |
| P3 | Centralize prompt templates | 2-4 hrs | Reduces near-duplicate prompts |
| P3 | Add `run.sh` for cross-platform support | 30 min | Improves portability |

---

## Tasks

# Tasks

## Health Audit Cleanup

- [ ] Create `README.md` with project description, prerequisites, setup, and run instructions
- [ ] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Character_Generator_v1_4/`
- [ ] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Gun_Generator_v1_3/`
- [ ] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Multitool_v1_1/`
- [ ] Add `ARTBOARD_LIBRARY/` to `.gitignore` and untrack large board JSON files
- [ ] Add `config/user_settings_backup.json` to `.gitignore` and untrack (40 MB blob)
- [ ] Add `.repo_snapshot/` to `.gitignore` and untrack audit artifacts
- [ ] Create `ARCHITECTURE.md` documenting Electron → FastAPI → Gemini data flow
- [ ] Consider splitting `CharacterPage.tsx` (188 KB, ~3,088 LOC) into sub-components
- [ ] Add `run.sh` for cross-platform support (currently Windows-only)
- [ ] Centralize prompt templates to reduce near-duplicate inline prompts

## Done

- [x] Health audit report generated (report_id: 20260329_102917)
- [x] Health audit report generated (report_id: 20260329_172858)

---

## Comprehensive Repo Report

# Comprehensive Repo Report

## 1. Metadata

| Field | Value |
|-------|-------|
| Timestamp | 2026-03-29 17:28:58 |
| Repo root | `C:\Dev\Madison_AI_Tools` |
| Git branch | main |
| HEAD | `44a7ff7` (2026-03-29 17:28:09 -0500) |
| Scan scope | All files excluding `node_modules/`, `.git/`, `__pycache__/`, `.venv/`, `dist/`, `build/` |
| Report ID | 20260329_172858 |

---

## 2. Executive Summary

1. **Madison AI Suite** is a desktop AI art-direction tool for game concept artists, built with Electron + React (frontend) and FastAPI + Gemini API (backend). Evidence: `pyproject.toml:8` — `"PUBG Madison AI Suite – Electron + React frontend with FastAPI backend"`.
2. **19 API route modules** provide image generation, editing, upscaling, style transfer, attribute extraction, and more for characters, props, environments, UI elements, and weapons. Evidence: `server.py:34-52` registers all routers.
3. **The codebase is 55,126 LOC** across 283 text files: 23,217 LOC TypeScript/React, 18,898 LOC Python. Evidence: LOC scan by extension.
4. **Four monolithic page components** each exceed 1,900 LOC (CharacterPage: 3,088, UILabPage: 2,133, EnvironmentPage: 2,012, PropPage: 1,903). Evidence: file size scan.
5. **102 MB of tracked binary blobs** (artboard + settings JSON) inflate the repository. Evidence: `git ls-files` shows `ARTBOARD_LIBRARY/` and `config/user_settings_backup.json`.
6. **12K LOC of dead legacy tools** exist under `src/pubg_madison_ai_suite/tools/`. Evidence: 3 directories with standalone scripts not imported by any API module.
7. **No README.md or onboarding documentation** exists. Evidence: file existence check.
8. **Windows-only launcher** (`run.bat`). No cross-platform equivalent. Evidence: `run.sh` does not exist.
9. **Recent rapid growth**: LOC increased 39.3% (39,562 → 55,126) in one session. Evidence: snapshot diff.
10. **New features added in latest commit**: Deep Reference Search (SSE-based image search), Art Director (voice-driven edits), Edit Prop/Environment panels, artboard crop tool, viewport persistence. Evidence: commit `44a7ff7` message and diff.

---

## 3. What This Repo Is

**Type**: Desktop application (Electron shell wrapping a React SPA with a Python FastAPI backend)

**Languages & Frameworks**:
- **Frontend**: TypeScript/React 19 + Tailwind CSS 4 + Vite 6 + Electron 35 — `frontend/package.json:13-19`
- **Backend**: Python 3.9+ + FastAPI + Uvicorn — `pyproject.toml:9`, `requirements.txt`
- **AI**: Google Gemini API (generative AI for images and text) — `requirements.txt:1-2` (`google-generativeai`, `google-genai`)
- **Image Processing**: Pillow, rembg (background removal) — `requirements.txt:3-4`

**Runtime**: Windows desktop app launched via `run.bat`, which starts:
1. FastAPI backend on port 8420
2. Vite dev server on port 5173
3. Electron main process loading the Vite URL

---

## 4. How to Run

**Prerequisites** (inferred from dependencies):
- Windows 10/11
- Python 3.9+
- Node.js 18+ (for `npx`, `vite`, `electron`)
- A Gemini API key (stored in `config/keys.json`)

**Commands** (from `run.bat:1-56`):
```
# Install Python deps
pip install -r requirements.txt

# Install Node deps
cd frontend && npm install && cd ..

# Launch everything
run.bat
```

**Evidence**: `run.bat` sets `PYTHONPATH=%~dp0src`, starts uvicorn on port 8420, waits for health endpoint, starts vite on 5173, waits, then launches Electron.

**OS Assumption**: Windows only — `run.bat` uses CMD syntax, `pywin32` is Windows-only. No `run.sh` exists.

---

## 5. Feature Inventory

### Image Generation Tools

| Feature | Frontend | Backend | Evidence |
|---------|----------|---------|----------|
| AI Character Lab | `CharacterPage.tsx` (3,088 LOC) | `routes/character.py` (745 LOC) | Generate, edit, extract attributes, randomize, multi-view |
| AI Prop Lab | `PropPage.tsx` (1,903 LOC) | `routes/prop.py` (668 LOC) | Same pipeline for game props |
| AI Environment Lab | `EnvironmentPage.tsx` (2,012 LOC) | `routes/environment.py` (757 LOC) | Environment concept art |
| AI UI Lab | `UILabPage.tsx` (2,133 LOC) | `routes/uilab.py` (837 LOC) | UI element design |
| AI Weapon Lab | `WeaponPage.tsx` (483 LOC) | `routes/weapon.py` (9,868 bytes) | Weapon concept art |
| Default Gemini | `GeminiPage.tsx` (385 LOC) | `routes/gemini.py` (7,461 bytes) | General-purpose image gen |
| Multiview | `MultiviewPage.tsx` | `routes/character.py` | Multi-angle generation |

### Editing & Processing

| Feature | Module | Evidence |
|---------|--------|----------|
| Inpainting / Smart Erase / Outpaint | `routes/editor.py` (375 LOC) | Image editing pipeline |
| Style Transfer | `routes/editor.py` | Apply artistic styles |
| AI Upscale & Restore | `routes/system.py` | `useImageEnhance.ts` hook |
| Background Removal | `routes/editor.py` | Uses rembg |
| Color Palette Extraction | `routes/palette.py` | Dominant color analysis |

### Workspace Tools

| Feature | Module | Evidence |
|---------|--------|----------|
| Art Table (Artboard) | `ArtboardCanvas.tsx` (907 LOC), `ArtboardContext.tsx`, `routes/artboard.py` | Multi-board canvas with collab support |
| Crop Tool | `ArtboardCanvas.tsx` | Click-drag crop with undo |
| Deep Reference Search | `DeepSearchPanel.tsx`, `routes/refsearch.py` (266 LOC) | Gemini-powered image search with SSE streaming |
| Art Director (Voice) | `ArtDirectorWidget.tsx`, `useVoiceDirector.tsx`, `routes/director.py` | Voice-to-command edit pipeline |
| Annotation Layer | `AnnotationLayer.tsx` (560 LOC) | Arrows, shapes, freehand, text overlays |
| Style Library | `StyleLibraryPage.tsx`, `routes/styles.py` | Reusable style references |
| Prompt Builder | `PromptBuilderPage.tsx` | Custom reusable prompts |
| Grid Gallery (4×4) | `GridGallery.tsx` (696 LOC) | Batch variation generation |
| Favorites | `FavoritesPage.tsx`, `FavoritesContext.tsx` | Star/pin generations |
| Generation History | `GeneratedImagesPage.tsx` (686 LOC), `routes/history.py`, `routes/gallery.py` | Browse all generated images with metadata |
| Export / Handoff | `routes/export.py` | ZIP package export |
| Session Save/Load | `SessionContext.tsx` | Persist workspace state |
| Project Tabs | `ProjectTabsWrapper.tsx` | Multi-project per tool |
| Settings | `SettingsPanel.tsx` | API key, model, voice config |

---

## 6. Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                   Electron Shell                  │
│  electron/main.js — spawns backend, loads Vite    │
│  BrowserWindow → http://127.0.0.1:5173            │
└──────────────┬───────────────────────────────────┘
               │ IPC / HTTP
┌──────────────▼───────────────────────────────────┐
│              React SPA (Vite + Tailwind)           │
│  app.tsx → AppShell → [Tool Pages]                 │
│  Providers: Toast, Session, Shortcuts, Voice,      │
│             Artboard, Favorites, CustomSections,   │
│             VoiceDirector, ArtDirector             │
│  Hooks: useApi (fetch + SSE), useClipboardPaste,   │
│         useImageEnhance, useSettingsBackup          │
└──────────────┬───────────────────────────────────┘
               │ HTTP REST + WebSocket + SSE
┌──────────────▼───────────────────────────────────┐
│              FastAPI Backend (port 8420)            │
│  server.py → 19 route modules                      │
│  core.py — Gemini API wrapper (call_gemini_*)      │
│  ws.py — WebSocket progress manager                │
│  cancel.py — Request cancellation                  │
└──────────────┬───────────────────────────────────┘
               │ HTTPS
┌──────────────▼───────────────────────────────────┐
│         Google Gemini API (generativelanguage)     │
│  Models: gemini-2.0-flash-exp, imagen-3, etc.     │
│  Features: generateContent, google_search grounding│
└──────────────────────────────────────────────────┘
```

**Data Flow**: User interacts with React UI → HTTP request to FastAPI → FastAPI calls Gemini API → returns base64 image → displayed in React ImageViewer. Progress updates via WebSocket. SSE for streaming (Deep Search, Art Director).

**Persistence**: File system based. Generated images saved to `ALL GENERATED IMAGES/`. Artboard state in `ARTBOARD_LIBRARY/`. Settings in `config/`. Style library in `style_library/`. No database.

---

## 7. Module Deep Dive

### 7.1 Core API (`src/pubg_madison_ai_suite/api/core.py` — 585 LOC)

Central Gemini API wrapper. Provides `call_gemini_image()`, `call_gemini_text()`, and model listing. All route modules import from here. Evidence: `core.py:1` — all API routes use `from pubg_madison_ai_suite.api.core import ...`.

### 7.2 Character Lab (`routes/character.py` — 745 LOC + `CharacterPage.tsx` — 3,088 LOC)

Full character concept pipeline: generate, edit (with reference images), extract attributes to XML, enhance, randomize, multi-view (front/back/side/3-4). Includes style fusion (blend two reference styles), costume direction, character bible, preservation lock. The frontend is the largest single component.

### 7.3 Prop/Environment/UILab Routes (668-837 LOC each)

Mirror the Character Lab pattern for different asset types. Each has generate, extract-attributes, enhance, randomize endpoints. Prop and Environment now have dedicated Edit panels in the frontend (added in latest commit).

### 7.4 Editor (`routes/editor.py` — 375 LOC)

Image manipulation endpoints: inpaint (mask + prompt), smart-select (AI-driven region selection), smart-erase (remove masked area), outpaint (extend canvas), remove-background (rembg), style-transfer. Used by `ImageViewer.tsx`'s `EditorToolbar`.

### 7.5 Artboard System (`ArtboardCanvas.tsx` — 907 LOC + `ArtboardContext.tsx` + `routes/artboard.py` — 311 LOC)

Multi-board infinite canvas. Items (images, text, frames) with z-ordering, selection, drag-move, resize. Undo/redo stack (50 levels). Annotation layer overlay. WebSocket-based collaborative mode (share room, remote cursors). New: crop tool, viewport persistence across tab switches.

### 7.6 Deep Reference Search (`DeepSearchPanel.tsx` + `routes/refsearch.py` — 266 LOC)

SSE-streaming search tool. Uses Gemini with Google Search grounding to find reference images. Backend scrapes URLs, downloads/validates images (Pillow), streams results to frontend. Configurable search depth and result count.

### 7.7 Art Director (`ArtDirectorWidget.tsx` + `useVoiceDirector.tsx` + `routes/director.py`)

Voice-to-command system. User speaks edit instructions → Gemini interprets as structured tool invocations → applies edits automatically. Uses function calling for routing to inpaint, edit, regenerate pipelines.

### 7.8 Gallery & History (`routes/gallery.py` — 277 LOC + `routes/history.py`)

File-system based image gallery. Scans `ALL GENERATED IMAGES/` directory, reads generation metadata from filenames. Supports browsing by tool and date. History tracks generation parameters for each image.

### 7.9 Style Library (`routes/styles.py` — 383 LOC + `StyleLibraryPage.tsx`)

Folder-based style reference system. Users create folders, upload reference images, system generates guidance text. Categories: general and UI-specific. Used for style fusion in generation.

### 7.10 React Context Providers (`frontend/src/hooks/`)

14 hooks/contexts provide shared state: `ToastContext`, `SessionContext`, `ShortcutsProvider`, `VoiceToTextProvider`, `ArtboardProvider`, `FavoritesContext`, `CustomSectionsProvider`, `VoiceDirectorProvider`, `ArtDirectorProvider`, plus utility hooks (`useApi`, `useClipboardPaste`, `useImageEnhance`, `useSettingsBackup`, `useCustomSectionState`).

---

## 8. External Dependencies & Integrations

### Python (Runtime)

| Package | Purpose | Evidence |
|---------|---------|----------|
| `google-generativeai` | Gemini API client (legacy) | `requirements.txt:1` |
| `google-genai` | Gemini API client (new) | `requirements.txt:2` |
| `pillow` | Image processing | `requirements.txt:3` |
| `rembg` | Background removal | `requirements.txt:4` |
| `PyPDF2` | PDF parsing | `requirements.txt:5` |
| `pywin32` | Windows-specific (Photoshop COM) | `requirements.txt:6` |
| `fastapi` | Web framework | `requirements.txt:7` |
| `uvicorn` | ASGI server | `requirements.txt:8` |
| `requests` | HTTP client (scraping) | `requirements.txt:9` |

### Node.js (Runtime + Dev)

| Package | Purpose | Evidence |
|---------|---------|----------|
| `react` / `react-dom` | UI framework | `package.json:14-15` |
| `lucide-react` | Icons | `package.json:13` |
| `react-resizable-panels` | Split panes | `package.json:16` |
| `tailwind-merge` / `clsx` | CSS utilities | `package.json:12,17` |
| `electron` | Desktop shell (dev) | `package.json:29` |
| `vite` | Build tool (dev) | `package.json:34` |
| `typescript` | Type checking (dev) | `package.json:33` |
| `tailwindcss` | CSS framework (dev) | `package.json:32` |

### External Services

| Service | Purpose | Evidence |
|---------|---------|----------|
| Google Gemini API | Image generation, text generation, search grounding | `core.py`, all route modules |
| Google Search (via Gemini) | Reference image discovery | `refsearch.py` |

---

## 9. Configuration Surface

| File | Type | Key Names |
|------|------|-----------|
| `config/keys.json` | JSON | Gemini API key (gitignored) |
| `run.bat` | Env vars | `PYTHONPATH`, `PUBG_SUITE_SAVE_ROOT`, `PUBG_SUITE_ROOT` |
| `electron/main.js` | Constants | `DEV_URL`, `API_PORT`, `API_URL` |
| `server.py` | Env vars | `MADISON_API_PORT`, `MADISON_BIND_HOST` |
| `frontend/package.json` | Scripts | `dev`, `build`, `electron:dev`, `electron:build` |
| localStorage (browser) | Keys | `madison-shortcuts`, `madison-theme`, `madison-settings`, `madison-artboard-*`, `madison-favorites`, `madison-voice-*` |

---

## 10. Risks / Complexity Hotspots

| Risk | Severity | Details |
|------|----------|---------|
| **Monolithic page components** | High | CharacterPage.tsx (3,088 LOC), UILabPage.tsx (2,133 LOC), EnvironmentPage.tsx (2,012 LOC), PropPage.tsx (1,903 LOC) — each contains all state, handlers, and JSX for an entire tool |
| **Tracked binary blobs** | High | 102 MB of base64 artboard/settings data in git history |
| **Dead legacy code** | Medium | 12K LOC in `tools/` directory never imported or used |
| **No tests** | Medium | No test files found anywhere in the codebase |
| **Tight coupling to Gemini** | Medium | All AI features depend on a single provider with no abstraction layer |
| **Prompt duplication** | Low | Similar system prompts across 4 lab route modules |
| **No README** | Low | But `run.bat` is self-documenting for Windows users |
| **Windows-only** | Low | Acceptable for target audience (game studio) but limits contributors |

---

## 11. Open Questions / Ambiguous Areas

1. **Are the legacy `tools/` directories used by any external tooling?** — They are included in the wheel build (`pyproject.toml:23`), but no API module imports them.
2. **Is `config/user_settings_backup.json` intentionally tracked?** — It's 40 MB of serialized localStorage including base64 images. Likely accidental.
3. **Is the WebSocket collaborative artboard mode production-ready?** — Room management exists but there's no authentication or rate limiting.
4. **What is the deployment model?** — Currently dev-mode only (`vite` dev server + uvicorn). No production build pipeline for the Electron app.
5. **Should `ALL GENERATED IMAGES/` be tracked?** — Currently gitignored (correct), but the pattern suggests it could grow very large on disk.

---

## 12. Appendix: Evidence Index

| Evidence | File | Lines/Notes |
|----------|------|-------------|
| Project description | `pyproject.toml` | Line 8 |
| Entry point | `run.bat` | Lines 1-56 |
| Backend server | `src/pubg_madison_ai_suite/api/server.py` | Lines 1-69 (19 routers) |
| Electron main | `electron/main.js` | Lines 1-40 |
| React app root | `frontend/src/app.tsx` | Lines 1-50 |
| Frontend package | `frontend/package.json` | Lines 1-37 |
| Python deps | `requirements.txt` | Lines 1-9 |
| Python build config | `pyproject.toml` | Lines 1-33 |
| Git ignore rules | `.gitignore` | Lines 1-47 |
| Tasks | `TASKS.md` | Full file |
| LOC statistics | Snapshot scan | By extension table |
| Largest files | File size scan | Top 15 |
| Tracked output dirs | `git ls-files` | ARTBOARD_LIBRARY/, config/, .repo_snapshot/ |
| Legacy tools | `src/pubg_madison_ai_suite/tools/` | 3 directories, 15 files |
| API routes | `src/pubg_madison_ai_suite/api/routes/` | 19 modules |
| Frontend components | `frontend/src/components/` | 63 .tsx files across tools/shared/shell/ui |
| Health history | `.repo_snapshot/health_reports/health_history.csv` | 2 audit rows |

---

## Master Index

* Snapshot: `.repo_snapshot/repo_snapshot.md`
* Snapshot JSON: `.repo_snapshot/repo_snapshot.json`
* Health Report: `HEALTH_REPORT.md`
* Health Metrics: `.repo_snapshot/health_reports/health_metrics__20260329_172858.json`
* Tasks: `TASKS.md`
* Comprehensive Report: `.repo_snapshot/repo_comprehensive_report.md`
* Master Report: `MASTER_REPO_REPORT.md`
