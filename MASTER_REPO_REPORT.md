# Master Repo Report

| Field | Value |
|-------|-------|
| Project root | `C:\Dev\Madison_AI_Tools` |
| Generated at | 2026-03-29 10:29:17 |
| Includes | Snapshot + Health Audit + Comprehensive Repo Report + TASKS |
| Health | **Yellow** (report_id: 20260329_102917) |

---

## Repo Snapshot

# Repo Snapshot

| Field | Value |
|-------|-------|
| **Project** | PUBG Madison AI Suite |
| **Root** | `C:\Dev\Madison_AI_Tools` |
| **Scanned** | 2026-03-29 10:29:17 |
| **Branch** | `main` |
| **Last Commit** | `f8d6f7e` — feat: add Prompt Builder, custom sections, section colors… (2026-03-29) |
| **Working Tree** | Clean |

---

## Folder Tree (depth 4)

```
C:\Dev\Madison_AI_Tools\
├── ALL GENERATED IMAGES/         (runtime output, gitignored)
│   ├── .history/
│   ├── AI UILab/
│   ├── Character Generator/
│   ├── Gemini/
│   ├── Multiview/
│   └── Weapon Generator/
├── ARTBOARD_LIBRARY/             (user data, partially tracked)
│   └── Shawn Props/
├── config/                       (runtime config, gitignored keys)
├── electron/                     (Electron shell)
├── frontend/                     (React + TypeScript SPA)
│   ├── dist/                     (build output, gitignored)
│   └── src/
│       ├── components/
│       │   ├── shared/           (ImageViewer, ArtboardCanvas, etc.)
│       │   ├── shell/            (AppShell, Sidebar, Settings)
│       │   ├── tools/            (character, prop, env, uilab, etc.)
│       │   └── ui/               (Button, Select, Card, etc.)
│       ├── hooks/                (contexts, custom hooks)
│       └── lib/                  (utilities)
├── output/                       (runtime, gitignored)
├── PROMPT_LIBRARY/               (user prompt templates)
├── saves/                        (runtime, gitignored)
├── src/
│   └── pubg_madison_ai_suite/
│       ├── api/
│       │   └── routes/           (FastAPI endpoints)
│       ├── assets/               (icons, weapon reference PNGs)
│       └── tools/                (legacy standalone generators)
│           ├── AI_Character_Generator_v1_4/
│           ├── AI_Gun_Generator_v1_3/
│           └── AI_Multitool_v1_1/
├── STYLE_LIBRARY/                (user style references)
└── USER_LIBRARY/                 (user custom lib)
```

---

### Governance Docs

| Document | Present |
|----------|---------|
| README.md | ❌ |
| PROJECT.md | ❌ |
| SPEC.md | ❌ |
| ARCHITECTURE.md | ❌ |
| DECISIONS.md | ❌ |
| TASKS.md | ❌ |
| AGENT_RULES.md | ❌ |

---

### Dependency Manifests

| File | Purpose |
|------|---------|
| `pyproject.toml` | Python package (hatchling), v3.0.0 |
| `requirements.txt` | Python deps (google-generativeai, fastapi, pillow, rembg…) |
| `frontend/package.json` | Node/React deps (react 19, vite, electron 35, tailwindcss 4) |
| `frontend/package-lock.json` | Lockfile |

---

### Entry Points

| Entry | Type | Description |
|-------|------|-------------|
| `run.bat` | Primary | Sets env vars, builds frontend if needed, launches Electron |
| `electron/main.js` | Electron | Spawns FastAPI backend, loads frontend |
| `src/pubg_madison_ai_suite/api/server.py` | Backend | FastAPI/Uvicorn on port 8420 |

---

### Lines of Code by Language

| Language | LOC |
|----------|-----|
| TypeScript/TSX | 20,770 |
| Python | 18,058 |
| JavaScript | 467 |
| CSS | 255 |
| HTML | 12 |
| **Total** | **39,562** |

Git-tracked files: 129 | On-disk files (excl. node_modules, .git): 515 | Total on-disk: ~998 MB

---

### Subsystem Hints

| Subsystem | Location | Technology |
|-----------|----------|------------|
| UI / Frontend | `frontend/src/` | React 19, TypeScript, Tailwind CSS 4 |
| Desktop Shell | `electron/` | Electron 35 |
| API / Backend | `src/pubg_madison_ai_suite/api/` | FastAPI, Uvicorn |
| AI Generation | API routes + Gemini SDK | google-generativeai, google-genai |
| Image Processing | Backend routes | Pillow, rembg |
| Legacy Tools | `src/pubg_madison_ai_suite/tools/` | Standalone Python scripts (unused) |

---

### Duplication Signals

| Signal | Evidence |
|--------|----------|
| Legacy generators vs API routes | `tools/AI_Character_Generator_v1_4/character_generator.py` (333 KB) duplicates logic now in `api/routes/character.py` (40 KB). Same for prop and weapon. **No imports reference legacy tools.** |

---

### Config Hints

| Config | Location |
|--------|----------|
| `GEMINI_API_KEY` | env var, also stored in `config/keys.json` (gitignored) |
| `GOOGLE_API_KEY` | env var fallback |
| `PUBG_IMAGE_MODEL` | env var for model selection |
| `MADISON_API_PORT` | set in `run.bat` (default 8420) |
| `PUBG_SUITE_ROOT` | set in `run.bat` |
| `PUBG_SUITE_SAVE_ROOT` | set in `run.bat` |

---

### Git Churn (top 10 most-changed files)

| Changes | File |
|---------|------|
| 6 | `frontend/src/components/tools/character/CharacterPage.tsx` |
| 6 | `frontend/src/components/shell/Sidebar.tsx` |
| 6 | `frontend/src/app.tsx` |
| 6 | `frontend/src/components/shell/AppShell.tsx` |
| 5 | `frontend/src/components/shared/ImageViewer.tsx` |
| 5 | `src/pubg_madison_ai_suite/api/server.py` |
| 5 | `src/pubg_madison_ai_suite/api/core.py` |
| 5 | `frontend/src/components/shared/TabBar.tsx` |
| 4 | `src/pubg_madison_ai_suite/api/routes/character.py` |
| 4 | `frontend/src/app.css` |

---

## Health Report

# Health Report

| Field | Value |
|-------|-------|
| **Report ID** | `20260329_102917` |
| **Date** | 2026-03-29 10:29:17 |
| **Overall Health** | **YELLOW** |
| **Primary Issue Type** | Hygiene |

---

### Scoring

#### RED Triggers — None Active

| Trigger | Status | Evidence |
|---------|--------|----------|
| Secrets in source code | ✅ Pass | Regex scan found false positive in `electron/main.js` (`disk-cache` matched `sk-` pattern). No actual API keys, tokens, or credentials in tracked code. |
| Broken/missing run entrypoint | ✅ Pass | `run.bat` exists, sets env vars, builds frontend if needed, launches Electron. |
| Parallel systems detected | ✅ Pass | Legacy `tools/` directory exists but is completely unreferenced by `api/` code. No conflicting active systems. Classified as dead code, not parallel. |
| Output-only dirs tracked in git | ✅ Pass | `git ls-files` shows only `ARTBOARD_LIBRARY/Shawn Props/board.json` (8.3 MB user data file). This is a user workspace file, not build output. `ALL GENERATED IMAGES/`, `output/`, `saves/` are all properly gitignored. |

#### YELLOW Triggers — 3 Active

| Trigger | Status | Evidence |
|---------|--------|----------|
| Doc drift present | ⚠️ **YELLOW** | Zero governance documents exist (no README, ARCHITECTURE, PROJECT, SPEC, DECISIONS, TASKS, or AGENT_RULES). No documentation describes how to set up, run, or contribute. |
| Any text file > 100 KB | ⚠️ **YELLOW** | 7 text files exceed 100 KB: `board.json` (8.3 MB), `character_generator.py` (333 KB), `package-lock.json` (263 KB), `CharacterPage.tsx` (167 KB), `prop_generator.py` (134 KB), `Weapon_Generator_V1_3.py` (127 KB), `UILabPage.tsx` (112 KB). |
| Portability not satisfied | ⚠️ **YELLOW** | No README with setup/run instructions. `run.bat` is Windows-only. No cross-platform equivalent. Node and Python required but not documented. |
| Misleading README claims | N/A | No README exists. |
| Output dirs not in .gitignore | ✅ Pass | `ALL GENERATED IMAGES/`, `output/`, `saves/` are all in `.gitignore`. `ARTBOARD_LIBRARY/` and `STYLE_LIBRARY/` are intentionally tracked user workspace dirs. |

---

### Top 3 Risks

1. **Zero documentation** — No README, no architecture doc, no setup guide. A new developer cannot onboard without tribal knowledge. This is the single biggest risk to the project's longevity and maintainability.

2. **593 KB of dead legacy code** — Three standalone generator scripts (`character_generator.py`, `prop_generator.py`, `Weapon_Generator_V1_3.py`) totaling 593 KB are completely unreferenced. They inflate the repo, confuse contributors, and accumulate tech debt.

3. **Oversized frontend components** — `CharacterPage.tsx` (167 KB, ~2,900 LOC), `UILabPage.tsx` (112 KB), `EnvironmentPage.tsx` (94 KB), and `PropPage.tsx` (90 KB) are extremely large single-file components. High cognitive load and merge conflict risk.

---

### Top 3 Recommended Actions

1. **Create README.md** with project description, prerequisites (Python ≥3.9, Node ≥18, Electron), setup steps (`pip install -r requirements.txt`, `cd frontend && npm install`), and run instructions (`run.bat` or manual steps).

2. **Remove or archive legacy tools/** — Delete `tools/AI_Character_Generator_v1_4/`, `tools/AI_Gun_Generator_v1_3/`, `tools/AI_Multitool_v1_1/` (or move to a `_legacy/` branch). They are dead code with no references.

3. **Add `ARTBOARD_LIBRARY/` to `.gitignore`** — The 8.3 MB `board.json` is user workspace data that shouldn't be version-controlled. Each user's artboard state is local.

---

### Findings

#### Governance

No governance documents exist. The project relies entirely on commit messages and code comments for institutional knowledge. The `pyproject.toml` provides project name and version (`pubg-madison-ai-suite` v3.0.0) but no description of architecture or contribution workflow.

#### Drift / Bloat

| Item | Size | Issue |
|------|------|-------|
| `tools/AI_Character_Generator_v1_4/` | 333 KB | Dead code — standalone character generator superseded by `api/routes/character.py` |
| `tools/AI_Gun_Generator_v1_3/` | 127 KB | Dead code — standalone weapon generator superseded by `api/routes/weapon.py` |
| `tools/AI_Multitool_v1_1/` | 134 KB | Dead code — standalone prop generator superseded by `api/routes/prop.py` |
| `ARTBOARD_LIBRARY/Shawn Props/board.json` | 8.3 MB | User workspace data tracked in git |
| `ALL GENERATED IMAGES/.history/` | On-disk | History JSONL file (270 KB), properly gitignored |

#### Doc Drift

| Area | Expected | Actual |
|------|----------|--------|
| How to run | README with instructions | Only `run.bat` exists — no text docs |
| Architecture | ARCHITECTURE.md | None — must read code to understand Electron → FastAPI → Gemini flow |
| API reference | API docs or docstrings | Route files have minimal docstrings |

#### Cleanup Candidates

| # | Item | Action |
|---|------|--------|
| 1 | `tools/AI_Character_Generator_v1_4/` | Delete (dead code, 333 KB) |
| 2 | `tools/AI_Gun_Generator_v1_3/` | Delete (dead code, 127 KB) |
| 3 | `tools/AI_Multitool_v1_1/` | Delete (dead code, 134 KB) |
| 4 | `ARTBOARD_LIBRARY/Shawn Props/board.json` | Add to `.gitignore`, remove from tracking |
| 5 | `tools/AI_Character_Generator_v1_4/LORE_LIBRARY/` | Delete with parent |

#### Growth & Trajectory

| Metric | Value |
|--------|-------|
| Total code LOC | 39,562 |
| Total code files | 103 |
| Total code bytes | 1.9 MB |
| Largest file | `CharacterPage.tsx` (167 KB, ~2,900 LOC) |
| Git commits | 10 (rapid feature velocity) |
| Avg LOC per commit | ~3,956 |

**Top files by size:**

| File | Size | LOC (est.) |
|------|------|------------|
| `CharacterPage.tsx` | 167 KB | ~2,900 |
| `UILabPage.tsx` | 112 KB | ~2,000 |
| `EnvironmentPage.tsx` | 94 KB | ~1,600 |
| `PropPage.tsx` | 90 KB | ~1,550 |
| `ArtboardCanvas.tsx` | 49 KB | ~900 |
| `character.py` (API) | 40 KB | ~830 |
| `ImageViewer.tsx` | 40 KB | ~750 |

#### Prompt & Template Surface

Large multi-line string literals are concentrated in backend API routes:
- `character.py`: character prompt builder (~50 lines), style rules, preservation constraints
- `environment.py`: environment prompt builder, biome rules
- `prop.py`: prop prompt builder, material rules
- `uilab.py`: UI generation prompts
- `system.py`: transcription prompt, AI review prompt

No near-duplicate prompts detected above 0.85 similarity threshold. Each tool's prompt builder is domain-specific. No `src/templates.py` exists.

---

### Proposed Cleanup Plan

| Priority | Task | Impact |
|----------|------|--------|
| P0 | Create `README.md` with setup/run guide | Unblocks onboarding |
| P1 | Delete `tools/` legacy directory | -593 KB dead code |
| P1 | Add `ARTBOARD_LIBRARY/` to `.gitignore` | -8.3 MB from repo |
| P2 | Create `ARCHITECTURE.md` documenting Electron → FastAPI → Gemini flow | Knowledge preservation |
| P3 | Consider splitting `CharacterPage.tsx` (2,900 LOC) into sub-components | Maintainability |

---

## Tasks

# Tasks

## Health Audit Cleanup

- [ ] Create `README.md` with project description, prerequisites, setup, and run instructions
- [ ] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Character_Generator_v1_4/`
- [ ] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Gun_Generator_v1_3/`
- [ ] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Multitool_v1_1/`
- [ ] Add `ARTBOARD_LIBRARY/` to `.gitignore` and untrack `ARTBOARD_LIBRARY/Shawn Props/board.json`
- [ ] Create `ARCHITECTURE.md` documenting Electron → FastAPI → Gemini data flow
- [ ] Consider splitting `CharacterPage.tsx` (167 KB, ~2,900 LOC) into sub-components

## Done

- [x] Health audit report generated (report_id: 20260329_102917)

---

## Comprehensive Repo Report

# Comprehensive Repo Report

---

### 1. Metadata

| Field | Value |
|-------|-------|
| Timestamp | 2026-03-29 10:29:17 |
| Repo Root | `C:\Dev\Madison_AI_Tools` |
| Branch | `main` |
| Last Commit | `f8d6f7e` — "feat: add Prompt Builder, custom sections, section colors, and multi-feature improvements" |
| Working Tree | Clean |
| Scan Scope | All files excluding `node_modules/`, `.git/`, `__pycache__/`, `.venv/`, `dist/`, `build/` |
| Report ID | `20260329_102917` |

---

### 2. Executive Summary

1. **PUBG Madison AI Suite** is an internal concept-art generation tool built for PUBG/Krafton's art team. It wraps Google Gemini image generation models behind a polished desktop UI.
   *Evidence: `pyproject.toml:6-8` — name: "pubg-madison-ai-suite", description: "PUBG Madison AI Suite"*

2. The stack is **Electron 35 + React 19 (TypeScript) + Tailwind CSS 4** on the frontend, with a **FastAPI/Uvicorn** backend on `localhost:8420`.
   *Evidence: `frontend/package.json:13-19` (react 19, electron 35, tailwindcss 4), `requirements.txt` (fastapi, uvicorn), `run.bat:20` (MADISON_API_PORT=8420)*

3. **17 API route modules** handle distinct domains: character/prop/environment/weapon/UI generation, image editing, style management, artboards, galleries, prompt templates, history, queue, palette extraction, and export packaging.
   *Evidence: `src/pubg_madison_ai_suite/api/server.py:23-50` — all 17 router imports and mounts*

4. **7 specialized tool pages** (Character Lab, Prop Lab, Environment Lab, UI Lab, Weapon Lab, Gemini Generate, Multiview) plus 6 library/utility pages (Style Library, Prompt Builder, Generated Images, Favorites, Prompt Library, History).
   *Evidence: `frontend/src/app.tsx:25` — PageId type union; lines 35-52 — page rendering*

5. The codebase is **39,562 LOC** across 103 code files, split roughly 53% TypeScript/TSX (20,770 LOC) and 46% Python (18,058 LOC).

6. **Zero governance documentation** — no README, ARCHITECTURE, SPEC, or TASKS files exist. This is the project's most significant hygiene gap.

7. **593 KB of dead legacy code** in `src/pubg_madison_ai_suite/tools/` — three standalone Python scripts that predate the API refactoring and are unreferenced.
   *Evidence: Grep for `from.*tools` in `api/` returns zero matches*

8. The project uses **7 Google AI models** (Gemini 3 Pro, 3.1 Flash, 2.5 Flash, Imagen 4 Ultra, Imagen 4, Imagen 3 Fast, Veo 2) registered in `core.py:25-56`.

9. **State management** uses React Context extensively — 7 context providers wrap the app: Toast, Shortcuts, VoiceToText, Artboard, Favorites, PromptOverrides, and CustomSections.
   *Evidence: `frontend/src/app.tsx:60-74` — nested provider tree*

10. Real-time progress updates flow via a **WebSocket** at `/ws/progress`.
    *Evidence: `server.py:53-60` — WebSocket endpoint*

11. An **8.3 MB artboard file** (`ARTBOARD_LIBRARY/Shawn Props/board.json`) is tracked in git — should be gitignored.
    *Evidence: `git ls-files -- ARTBOARD_LIBRARY/` returns this file*

12. The frontend build output (`frontend/dist/`) is properly gitignored and built on-demand by `run.bat`.

---

### 3. What This Repo Is

| Aspect | Detail | Evidence |
|--------|--------|----------|
| **Type** | Desktop application (internal tool) | `electron/main.js` — Electron shell; `run.bat` — desktop launcher |
| **Domain** | AI-assisted concept art generation for game development | Tool pages: CharacterLab, PropLab, EnvironmentLab, WeaponLab, UILab |
| **Languages** | TypeScript (53%), Python (46%), JavaScript (1%) | LOC analysis |
| **Frontend** | React 19, TypeScript 5.8, Tailwind CSS 4, Vite 6.3 | `frontend/package.json` |
| **Desktop** | Electron 35 | `frontend/package.json:29` |
| **Backend** | FastAPI 0.115+, Uvicorn, Python 3.9+ | `pyproject.toml:9`, `requirements.txt` |
| **AI Engine** | Google Gemini (generativeai + genai SDKs), Imagen models | `requirements.txt:1-2`, `core.py:25-98` |
| **Image Processing** | Pillow, rembg (background removal) | `requirements.txt:3-4` |
| **Runtime** | Windows-primary (run.bat, pywin32) | `run.bat`, `requirements.txt:6` |

---

### 4. How to Run

#### Prerequisites

- Python 3.9+ with pip
- Node.js 18+ with npm
- Windows 10/11 (primary target; `run.bat` is Windows-only)
- Google Gemini API key

#### Steps (extracted from `run.bat` and `electron/main.js`)

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Install Node dependencies
cd frontend
npm install

# 3. Build frontend (or let run.bat do it)
npx vite build

# 4. Run
# Option A: via run.bat (sets env vars, launches Electron)
cd ..
run.bat

# Option B: manual
set PYTHONPATH=src
set MADISON_API_PORT=8420
# Start backend:
python src/pubg_madison_ai_suite/api/server.py
# In another terminal, start Electron:
cd frontend
npx electron ../electron/main.js
```

**Evidence**: `run.bat:1-28` sets `PYTHONPATH`, `MADISON_API_PORT`, checks for `dist/index.html`, and launches Electron. `electron/main.js:36-49` spawns the Python backend. `server.py:63-67` starts Uvicorn.

**API key**: Set via the Settings panel in the UI → stored in `config/keys.json` (gitignored). Alternatively, set `GEMINI_API_KEY` environment variable.

**OS Assumption**: Windows. The `run.bat` is a batch file; `pywin32` is a Windows-only dependency. `electron/main.js:37` conditionally uses `python` vs `python3`.

---

### 5. Feature Inventory

#### Generation Tools

| Feature | Frontend | Backend | Description |
|---------|----------|---------|-------------|
| **Character Lab** | `CharacterPage.tsx` (167 KB) | `routes/character.py` (40 KB) | Multi-view character generation with attributes, costumes, style fusion, custom sections |
| **Prop Lab** | `PropPage.tsx` (90 KB) | `routes/prop.py` (34 KB) | Prop/item generation with similar sidebar controls |
| **Environment Lab** | `EnvironmentPage.tsx` (94 KB) | `routes/environment.py` (38 KB) | Environment/scene generation |
| **UI Lab** | `UILabPage.tsx` (112 KB) | `routes/uilab.py` (37 KB) | Game UI element generation (scrollbars, fonts, grids) |
| **Weapon Lab** | `WeaponPage.tsx` | `routes/weapon.py` (10 KB) | Gun/weapon generation with reference images |
| **Gemini Generate** | `GeminiPage.tsx` | `routes/gemini.py` (7 KB) | Free-form Gemini image generation |
| **Multiview** | `MultiviewPage.tsx` | API reuse | Multi-angle view generation |

#### Library & Utility Pages

| Feature | Module | Description |
|---------|--------|-------------|
| **Style Library** | `StyleLibraryPage.tsx`, `routes/styles.py` | Manage visual style references |
| **Prompt Builder** | `PromptBuilderPage.tsx` | Visual builder for custom sidebar sections |
| **Generated Images** | `GeneratedImagesPage.tsx`, `routes/gallery.py` | Browse all generated images by tool and date |
| **Favorites** | `FavoritesPage.tsx`, `FavoritesContext.tsx` | Star/pin generations across tools |
| **Prompt Library** | `PromptLibraryPage.tsx`, `routes/prompts.py` | Saveable, taggable prompt templates |
| **Generation History** | `HistoryTimeline.tsx`, `routes/history.py` | Global timeline of all generations |

#### Shared Capabilities

| Feature | Module(s) | Description |
|---------|-----------|-------------|
| **Artboard / Canvas** | `ArtboardCanvas.tsx` (49 KB), `ArtboardContext.tsx`, `routes/artboard.py` | Infinite canvas for compositing images |
| **Image Viewer** | `ImageViewer.tsx` (40 KB) | Full-screen viewer with zoom, pan, annotations, inpainting |
| **Grid Gallery** | `GridGallery.tsx` (21 KB) | Thumbnail grid with favorites, context menus |
| **Annotation Layer** | `AnnotationLayer.tsx` (14 KB) | Drawing overlay for markup on images |
| **Style Fusion** | `StyleFusionPanel.tsx` (10 KB) | Blend two style references with image support |
| **Color Palette** | `ColorPalette.tsx`, `routes/palette.py` | Extract and apply color palettes |
| **Batch Queue** | `QueuePanel.tsx`, `routes/queue.py` | Queue multiple generation jobs |
| **Export Package** | `routes/export.py` | ZIP export with images, XML, palette, reference sheets |
| **Inpainting / Editing** | `editor/EditorToolbar.tsx`, `routes/editor.py` | Brush-based inpainting with AI fill |
| **Voice-to-Text** | `useVoiceToText.tsx` (16 KB) | Gemini or native Speech Recognition input |
| **Custom Sections** | `CustomSectionsContext.tsx`, `CustomSectionRenderer.tsx`, `useCustomSectionState.ts` | User-created prompt sidebar sections |
| **Prompt Overrides** | `PromptOverridesContext.tsx`, `EditPromptModal.tsx` | Edit the prompt text of built-in sections |
| **Multi-Project Tabs** | `ProjectTabsWrapper.tsx` (10 KB) | Multiple independent project instances per tool |
| **Session Save/Load** | `SessionContext.tsx`, Electron IPC | Save/load workspace as `.madison` files |
| **Keyboard Shortcuts** | `useShortcuts.tsx` (13 KB) | Customizable hotkeys with visual overlay |

---

### 6. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Shell                           │
│  electron/main.js                                            │
│  ┌──────────────────────┐  ┌─────────────────────────────┐  │
│  │  Python Backend       │  │  Renderer (React SPA)       │  │
│  │  (child process)      │  │  frontend/dist/index.html   │  │
│  │                       │  │                             │  │
│  │  FastAPI on :8420     │◄─┤  fetch('/api/...')          │  │
│  │  ┌─────────────────┐ │  │  WebSocket /ws/progress     │  │
│  │  │ 17 Route Modules│ │  │                             │  │
│  │  │ (character, prop,│ │  │  7 Context Providers        │  │
│  │  │  env, uilab, ... │ │  │  13 Tool Pages              │  │
│  │  │  gallery, queue, │ │  │  18 Shared Components       │  │
│  │  │  export, etc.)   │ │  │  10 UI Primitives           │  │
│  │  └─────────────────┘ │  │                             │  │
│  │  ┌─────────────────┐ │  │  State: React Context +     │  │
│  │  │ core.py          │ │  │        localStorage         │  │
│  │  │ (model registry, │ │  │                             │  │
│  │  │  image gen,      │ │  │  Styles: Tailwind 4 +       │  │
│  │  │  history, save)  │ │  │         CSS tokens          │  │
│  │  └─────────────────┘ │  │                             │  │
│  │  ┌─────────────────┐ │  └─────────────────────────────┘  │
│  │  │ Gemini API       │ │                                   │
│  │  │ (google-genai)   │ │  IPC: clipboard, session,         │
│  │  └─────────────────┘ │  │  save-folder, console            │
│  └──────────────────────┘  └─────────────────────────────┘  │
│                                                              │
│  Disk I/O:                                                   │
│  ├── ALL GENERATED IMAGES/<tool>/<date>/*.png                │
│  ├── STYLE_LIBRARY/*.{png,jpg}                               │
│  ├── PROMPT_LIBRARY/*.json                                   │
│  ├── ARTBOARD_LIBRARY/<name>/board.json                      │
│  └── config/keys.json (API key)                              │
└──────────────────────────────────────────────────────────────┘
```

#### Data Flow

1. **User action** in React UI → `apiFetch()` call (custom wrapper around `fetch`) to `http://127.0.0.1:8420/api/<route>`
2. **FastAPI route** receives request → builds prompt text → calls Google Gemini API via `google-genai` SDK
3. **Progress updates** sent via WebSocket at `/ws/progress` to update UI progress bars
4. **Generated image** (base64) returned → saved to `ALL GENERATED IMAGES/<tool>/<date>/` by `core.py`
5. **History entry** appended to `.history/log.jsonl` by `core._append_history_entry()`
6. **Frontend** displays image in `ImageViewer` or `GridGallery`, with options to favorite, annotate, export

#### Key Abstractions

- **`core.py`** (631 lines): Central image generation logic, model registry, history logging, file saving. All route modules delegate to `core.generate_from_model()`.
- **`ImageViewer.tsx`** (40 KB): Reusable image display component with zoom, pan, annotations, editor, clipboard paste. Used by every tool page.
- **Context Providers**: 7 providers in `app.tsx` provide cross-cutting concerns (toast notifications, keyboard shortcuts, voice input, artboard state, favorites, prompt overrides, custom sections).

---

### 7. Module Deep Dive

#### 7.1 API Core (`src/pubg_madison_ai_suite/api/core.py`)

**Purpose**: Shared image generation engine. Wraps Google Gemini/Imagen API calls with retry, cancellation, model selection, and save-to-disk logic.

**Key files**: `core.py` (631 LOC)

**Key responsibilities**:
- Model registry: 7 models defined with capabilities, resolution, latency
- `generate_from_model()`: Accepts prompt + images → calls Gemini → returns base64 + saves PNG
- `_append_history_entry()`: Logs every generation to `.history/log.jsonl`
- `b64_to_image()` / `image_to_b64()`: Conversion utilities
- `get_api_key()` / `set_api_key()`: API key management via `config/keys.json`

**Interactions**: Every generation route (`character.py`, `prop.py`, `environment.py`, etc.) imports and calls `core.generate_from_model()`.

---

#### 7.2 Character Generation (`routes/character.py` + `CharacterPage.tsx`)

**Purpose**: Full character concept art pipeline — attribute specification, multi-view generation, style fusion, custom sections.

**Key files**:
- `routes/character.py` (40 KB, ~830 LOC) — Pydantic models, prompt builder, generation endpoint
- `CharacterPage.tsx` (167 KB, ~2,900 LOC) — **Largest file in repo.** Full tool page with sidebar sections, tab system, viewer, grid, artboard.

**Key interactions**:
- Builds multi-part prompts from sidebar sections (Character Name, Body Type, Costume, Accessories, Style Fusion, Environment, Preservation Lock, plus custom sections)
- Sends up to 6+ images to Gemini (reference images, fusion refs, custom section images)
- Supports multi-view generation (Front, Side, Back, 3/4)
- State persisted per project instance via `ProjectTabsWrapper`

**Complexity hotspot**: `CharacterPage.tsx` at 2,900 LOC is the most complex single file. Contains all sidebar section definitions, prompt building logic, generation handlers, state management, and UI rendering.

---

#### 7.3 Image Viewer & Editor (`shared/ImageViewer.tsx`, `shared/AnnotationLayer.tsx`, `shared/editor/`)

**Purpose**: Full-featured image viewer with annotations, inpainting, clipboard integration.

**Key files**:
- `ImageViewer.tsx` (40 KB, ~750 LOC)
- `AnnotationLayer.tsx` (14 KB)
- `editor/EditorToolbar.tsx`

**Capabilities**: Zoom/pan, brush/eraser/fill tools, AI inpainting, annotation export, clipboard paste, keyboard shortcuts, favorites toggle.

---

#### 7.4 Artboard System (`shared/ArtboardCanvas.tsx`, `hooks/ArtboardContext.tsx`, `routes/artboard.py`)

**Purpose**: Infinite canvas for compositing and arranging multiple generated images.

**Key files**:
- `ArtboardCanvas.tsx` (49 KB, ~900 LOC) — Canvas rendering, drag/resize/select/copy/paste
- `ArtboardContext.tsx` (16 KB) — State management, undo/redo, load/save
- `routes/artboard.py` (12 KB) — Backend persistence (load/save/list/create boards)

**Capabilities**: Multi-item selection, grouping, clipboard copy/paste, auto-fit-to-extents, WebSocket sync for collaborative editing.

---

#### 7.5 Style & Prompt System

**Purpose**: Manage visual references, prompt templates, and custom prompt sections.

**Key files**:
- `routes/styles.py` (12 KB) — Style library CRUD
- `routes/prompts.py` (2.5 KB) — Prompt template CRUD
- `PromptOverridesContext.tsx` (3.2 KB) — Per-section prompt customization
- `CustomSectionsContext.tsx` (9.5 KB) — User-built sidebar sections
- `useCustomSectionState.ts` (3.7 KB) — Runtime state for custom sections per tool
- `CustomSectionRenderer.tsx` (13 KB) — Block type renderers (text, image, dropdown, slider, etc.)
- `PromptBuilderPage.tsx` — Visual section builder with AI gut-check

---

#### 7.6 Gallery & History (`routes/gallery.py`, `routes/history.py`)

**Purpose**: Browse generated images and view generation audit trail.

**Key files**:
- `routes/gallery.py` (9.2 KB) — Parallel thumbnail generation, JPEG caching, lazy-load endpoints
- `routes/history.py` (2.5 KB) — JSONL history parsing
- `GeneratedImagesPage.tsx` — Date/tool browser with lazy thumbnail loading
- `HistoryTimeline.tsx` — Chronological generation timeline

---

#### 7.7 Batch Queue & Export (`routes/queue.py`, `routes/export.py`)

**Purpose**: Queue multiple generation jobs; package outputs for handoff.

**Key files**:
- `routes/queue.py` (5.6 KB) — Async job queue with worker
- `routes/export.py` (6.8 KB) — ZIP packaging with consistency sheets
- `QueuePanel.tsx` (7.2 KB) — Floating queue UI

---

#### 7.8 Electron Shell (`electron/main.js`)

**Purpose**: Desktop wrapper that spawns the Python backend and loads the React SPA.

**Key responsibilities** (476 LOC):
- Single-instance lock
- Backend process lifecycle (spawn, health check, wait)
- Custom Electron menu (File: Save/Open Session, Set Save Folder, Reset App; Edit: Paste with clipboard image)
- IPC bridge for clipboard reading, session save/load, save folder management
- Console window for backend log viewing

---

#### 7.9 Voice-to-Text (`hooks/useVoiceToText.tsx`)

**Purpose**: Voice input using Gemini transcription or native Web Speech API.

**Key file**: `useVoiceToText.tsx` (16 KB)

**Capabilities**: Dual engine support (Gemini AI vs Windows native), context-aware transcription, duplicate/hallucination detection, real-time streaming, configurable settings.

---

#### 7.10 UI Primitives (`components/ui/`)

**Purpose**: Reusable form elements and layout components.

**Files**: `Button.tsx`, `Card.tsx`, `ColorField.tsx`, `Input.tsx`, `NumberStepper.tsx`, `PanelSection.tsx`, `Select.tsx`, `TagPicker.tsx`, `Textarea.tsx`, `index.ts`

**Design system**: CSS custom properties defined in `lib/tokens.css` (3.3 KB) with dark theme defaults. Tailwind 4 for utility classes.

---

### 8. External Dependencies & Integrations

#### Python (Runtime)

| Package | Purpose | Evidence |
|---------|---------|----------|
| `google-generativeai >=0.8.0` | Gemini model access (legacy SDK) | `requirements.txt:1` |
| `google-genai >=0.6.0` | Gemini model access (new SDK) | `requirements.txt:2` |
| `pillow >=10.0.0` | Image manipulation, thumbnails | `requirements.txt:3` |
| `rembg >=2.0.50` | Background removal | `requirements.txt:4` |
| `PyPDF2 >=3.0.0` | PDF reading (style library) | `requirements.txt:5` |
| `pywin32 >=306` | Windows COM (save folder dialog) | `requirements.txt:6` |
| `fastapi >=0.115.0` | HTTP API framework | `requirements.txt:7` |
| `uvicorn[standard] >=0.34.0` | ASGI server | `requirements.txt:8` |
| `requests >=2.31.0` | HTTP client (model API calls) | `requirements.txt:9` |

#### Node (Runtime)

| Package | Purpose | Evidence |
|---------|---------|----------|
| `react ^19.1.0` | UI framework | `package.json:14` |
| `react-dom ^19.1.0` | React DOM renderer | `package.json:15` |
| `lucide-react ^0.468.0` | Icon library | `package.json:13` |
| `react-resizable-panels ^2.1.7` | Panel layout | `package.json:16` |
| `clsx ^2.1.1` + `tailwind-merge ^3.5.0` | CSS class utilities | `package.json:12,17` |

#### Node (Dev)

| Package | Purpose |
|---------|---------|
| `electron ^35.1.2` | Desktop wrapper |
| `vite ^6.3.2` | Build tool |
| `typescript ^5.8.3` | Type checking |
| `@tailwindcss/vite ^4.1.0` | Tailwind CSS integration |
| `electron-builder ^26.0.12` | Desktop packaging |
| `concurrently ^9.1.2` | Parallel dev commands |

#### External Services

| Service | Usage | Evidence |
|---------|-------|----------|
| Google Gemini API | Image generation, text transcription, AI review | All generation routes + `system.py` |

---

### 9. Configuration Surface

#### Files

| File | Content |
|------|---------|
| `config/keys.json` | API key storage (gitignored) |
| `frontend/vite.config.ts` | Vite build configuration (not present in root, implied by `package.json` scripts) |
| `pyproject.toml` | Python package metadata |
| `frontend/package.json` | Node package metadata |
| `.gitignore` | Version control exclusions |

#### Environment Variables (no values shown)

| Variable | Set By | Purpose |
|----------|--------|---------|
| `GEMINI_API_KEY` | User | Gemini API authentication |
| `GOOGLE_API_KEY` | User | Fallback API key |
| `PUBG_IMAGE_MODEL` | User | Override default model |
| `MADISON_API_PORT` | `run.bat` | Backend port (default: 8420) |
| `PUBG_SUITE_ROOT` | `run.bat` | Project root path |
| `PUBG_SUITE_SAVE_ROOT` | `run.bat` | Image save directory |
| `PUBG_WEAPON_ASSETS_DIR` | `run.bat` | Weapon reference images |
| `MADISON_BIND_HOST` | Optional | Backend bind address (default: 127.0.0.1) |
| `VITE_DEV_SERVER_URL` | Dev only | Dev server URL for Electron |

---

### 10. Risks / Complexity Hotspots

#### Oversized Components

| File | Size | LOC (est.) | Risk |
|------|------|------------|------|
| `CharacterPage.tsx` | 167 KB | 2,900 | Merge conflicts, cognitive load, untestable monolith |
| `UILabPage.tsx` | 112 KB | 2,000 | Same as above |
| `EnvironmentPage.tsx` | 94 KB | 1,600 | Same |
| `PropPage.tsx` | 90 KB | 1,550 | Same |
| `ArtboardCanvas.tsx` | 49 KB | 900 | Complex interaction logic |
| `ImageViewer.tsx` | 40 KB | 750 | Feature-rich but large |

#### Dead Code (593 KB)

The entire `tools/` directory contains three legacy generators that are unreferenced:
- `character_generator.py` (333 KB)
- `prop_generator.py` (134 KB)
- `Weapon_Generator_V1_3.py` (127 KB)

These inflate repo size and may mislead contributors.

#### Duplication Across Tool Pages

`CharacterPage.tsx`, `PropPage.tsx`, `EnvironmentPage.tsx`, and `UILabPage.tsx` share substantial structural patterns: sidebar section rendering (`wrapSection`), context menu handling, custom section integration, generation request building. This is not extracted into shared abstractions.

#### Single-Platform Runtime

`run.bat` and `pywin32` dependency make this Windows-only. No macOS/Linux entry point exists.

#### CORS Wide Open

`server.py:27-32` sets `allow_origins=["*"]` — acceptable for localhost-only use but would be a security issue if exposed to a network.

#### Large Git-Tracked Data

`ARTBOARD_LIBRARY/Shawn Props/board.json` (8.3 MB) is tracked in git. Each edit creates a large diff.

---

### 11. Open Questions / Ambiguous Areas

1. **Are the legacy `tools/` scripts intentionally kept?** They're 100% unreferenced. If preserved for historical reference, they should be moved to a `_legacy/` branch.

2. **Is `ARTBOARD_LIBRARY/` intended to be shared or local?** Currently git-tracked but contains user-specific data. The artboard collaboration feature (WebSocket sync in `artboard.py`) suggests it should be backend-managed, not git-tracked.

3. **What is the deployment model?** The app appears to be distributed as a source checkout (developers clone and run `run.bat`). No installer or packaged Electron binary is in the repo (despite `electron-builder` being a dev dependency).

4. **Is the `google-generativeai` package still needed alongside `google-genai`?** Both are declared. If the codebase has migrated to `google-genai`, the older package may be removable.

5. **What is the purpose of `LORE_LIBRARY/` inside the legacy character generator?** It may contain valuable reference data that should be preserved even if the generator script is deleted.

6. **How is `rembg` used?** It's in `requirements.txt` but the API routes importing it aren't obvious from route filenames — likely used within `editor.py` or `core.py` for background removal.

7. **The `3d` page ID is defined but renders "Coming Soon".** Is this planned?

---

### 12. Appendix: Evidence Index

| Claim | File | Lines / Notes |
|-------|------|---------------|
| Project name & version | `pyproject.toml` | Lines 6-8 |
| React 19, Electron 35 | `frontend/package.json` | Lines 14, 29 |
| FastAPI, Uvicorn | `requirements.txt` | Lines 7-8 |
| 17 API routes | `server.py` | Lines 23-50 |
| WebSocket progress | `server.py` | Lines 53-60 |
| Model registry | `core.py` | Lines 25-98 |
| Entry point (run.bat) | `run.bat` | Full file (28 lines) |
| Electron lifecycle | `electron/main.js` | Lines 36-49, 450-475 |
| Page routing | `frontend/src/app.tsx` | Lines 25-56 |
| Context providers | `frontend/src/app.tsx` | Lines 60-74 |
| Dead legacy code | `tools/AI_Character_Generator_v1_4/` | 333 KB, zero imports found |
| Git-tracked artboard | `git ls-files -- ARTBOARD_LIBRARY/` | Returns `board.json` |
| CORS config | `server.py` | Lines 27-32 |
| API key storage | `core.py` | `get_api_key()` reads `config/keys.json` |
| Voice-to-text dual engine | `useVoiceToText.tsx` | `VoiceEngine` type, `startNative`/`startGemini` |
| Custom sections | `CustomSectionsContext.tsx` | 8 block types, import/export |
| Prompt overrides | `PromptOverridesContext.tsx` | localStorage persistence |
| Thumbnail caching | `routes/gallery.py` | `.thumbs/` JPEG cache, parallel generation |
| Batch queue | `routes/queue.py` | Async worker with `asyncio` |
| Export packaging | `routes/export.py` | ZIP with consistency sheet |

---

## Master Index

* Snapshot: `.repo_snapshot/repo_snapshot.md`
* Snapshot JSON: `.repo_snapshot/repo_snapshot.json`
* Health Report: `HEALTH_REPORT.md`
* Health Metrics: `.repo_snapshot/health_reports/health_metrics__20260329_102917.json`
* Tasks: `TASKS.md`
* Comprehensive Report: `.repo_snapshot/repo_comprehensive_report.md`
* Master Report: `MASTER_REPO_REPORT.md`
