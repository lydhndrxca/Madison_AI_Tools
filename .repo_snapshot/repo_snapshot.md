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

## Governance Docs

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

## Dependency Manifests

| File | Purpose |
|------|---------|
| `pyproject.toml` | Python package (hatchling), v3.0.0 |
| `requirements.txt` | Python deps (google-generativeai, fastapi, pillow, rembg…) |
| `frontend/package.json` | Node/React deps (react 19, vite, electron 35, tailwindcss 4) |
| `frontend/package-lock.json` | Lockfile |

---

## Entry Points

| Entry | Type | Description |
|-------|------|-------------|
| `run.bat` | Primary | Sets env vars, builds frontend if needed, launches Electron |
| `electron/main.js` | Electron | Spawns FastAPI backend, loads frontend |
| `src/pubg_madison_ai_suite/api/server.py` | Backend | FastAPI/Uvicorn on port 8420 |

---

## Lines of Code by Language

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

## Subsystem Hints

| Subsystem | Location | Technology |
|-----------|----------|------------|
| UI / Frontend | `frontend/src/` | React 19, TypeScript, Tailwind CSS 4 |
| Desktop Shell | `electron/` | Electron 35 |
| API / Backend | `src/pubg_madison_ai_suite/api/` | FastAPI, Uvicorn |
| AI Generation | API routes + Gemini SDK | google-generativeai, google-genai |
| Image Processing | Backend routes | Pillow, rembg |
| Legacy Tools | `src/pubg_madison_ai_suite/tools/` | Standalone Python scripts (unused) |

---

## Duplication Signals

| Signal | Evidence |
|--------|----------|
| Legacy generators vs API routes | `tools/AI_Character_Generator_v1_4/character_generator.py` (333 KB) duplicates logic now in `api/routes/character.py` (40 KB). Same for prop and weapon. **No imports reference legacy tools.** |

---

## Config Hints

| Config | Location |
|--------|----------|
| `GEMINI_API_KEY` | env var, also stored in `config/keys.json` (gitignored) |
| `GOOGLE_API_KEY` | env var fallback |
| `PUBG_IMAGE_MODEL` | env var for model selection |
| `MADISON_API_PORT` | set in `run.bat` (default 8420) |
| `PUBG_SUITE_ROOT` | set in `run.bat` |
| `PUBG_SUITE_SAVE_ROOT` | set in `run.bat` |

---

## Git Churn (top 10 most-changed files)

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
