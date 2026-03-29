# Health Report

| Field | Value |
|-------|-------|
| **Report ID** | `20260329_102917` |
| **Date** | 2026-03-29 10:29:17 |
| **Overall Health** | **YELLOW** |
| **Primary Issue Type** | Hygiene |

---

## Scoring

### RED Triggers — None Active

| Trigger | Status | Evidence |
|---------|--------|----------|
| Secrets in source code | ✅ Pass | Regex scan found false positive in `electron/main.js` (`disk-cache` matched `sk-` pattern). No actual API keys, tokens, or credentials in tracked code. |
| Broken/missing run entrypoint | ✅ Pass | `run.bat` exists, sets env vars, builds frontend if needed, launches Electron. |
| Parallel systems detected | ✅ Pass | Legacy `tools/` directory exists but is completely unreferenced by `api/` code. No conflicting active systems. Classified as dead code, not parallel. |
| Output-only dirs tracked in git | ✅ Pass | `git ls-files` shows only `ARTBOARD_LIBRARY/Shawn Props/board.json` (8.3 MB user data file). This is a user workspace file, not build output. `ALL GENERATED IMAGES/`, `output/`, `saves/` are all properly gitignored. |

### YELLOW Triggers — 3 Active

| Trigger | Status | Evidence |
|---------|--------|----------|
| Doc drift present | ⚠️ **YELLOW** | Zero governance documents exist (no README, ARCHITECTURE, PROJECT, SPEC, DECISIONS, TASKS, or AGENT_RULES). No documentation describes how to set up, run, or contribute. |
| Any text file > 100 KB | ⚠️ **YELLOW** | 7 text files exceed 100 KB: `board.json` (8.3 MB), `character_generator.py` (333 KB), `package-lock.json` (263 KB), `CharacterPage.tsx` (167 KB), `prop_generator.py` (134 KB), `Weapon_Generator_V1_3.py` (127 KB), `UILabPage.tsx` (112 KB). |
| Portability not satisfied | ⚠️ **YELLOW** | No README with setup/run instructions. `run.bat` is Windows-only. No cross-platform equivalent. Node and Python required but not documented. |
| Misleading README claims | N/A | No README exists. |
| Output dirs not in .gitignore | ✅ Pass | `ALL GENERATED IMAGES/`, `output/`, `saves/` are all in `.gitignore`. `ARTBOARD_LIBRARY/` and `STYLE_LIBRARY/` are intentionally tracked user workspace dirs. |

---

## Top 3 Risks

1. **Zero documentation** — No README, no architecture doc, no setup guide. A new developer cannot onboard without tribal knowledge. This is the single biggest risk to the project's longevity and maintainability.

2. **593 KB of dead legacy code** — Three standalone generator scripts (`character_generator.py`, `prop_generator.py`, `Weapon_Generator_V1_3.py`) totaling 593 KB are completely unreferenced. They inflate the repo, confuse contributors, and accumulate tech debt.

3. **Oversized frontend components** — `CharacterPage.tsx` (167 KB, ~2,900 LOC), `UILabPage.tsx` (112 KB), `EnvironmentPage.tsx` (94 KB), and `PropPage.tsx` (90 KB) are extremely large single-file components. High cognitive load and merge conflict risk.

---

## Top 3 Recommended Actions

1. **Create README.md** with project description, prerequisites (Python ≥3.9, Node ≥18, Electron), setup steps (`pip install -r requirements.txt`, `cd frontend && npm install`), and run instructions (`run.bat` or manual steps).

2. **Remove or archive legacy tools/** — Delete `tools/AI_Character_Generator_v1_4/`, `tools/AI_Gun_Generator_v1_3/`, `tools/AI_Multitool_v1_1/` (or move to a `_legacy/` branch). They are dead code with no references.

3. **Add `ARTBOARD_LIBRARY/` to `.gitignore`** — The 8.3 MB `board.json` is user workspace data that shouldn't be version-controlled. Each user's artboard state is local.

---

## Findings

### Governance

No governance documents exist. The project relies entirely on commit messages and code comments for institutional knowledge. The `pyproject.toml` provides project name and version (`pubg-madison-ai-suite` v3.0.0) but no description of architecture or contribution workflow.

### Drift / Bloat

| Item | Size | Issue |
|------|------|-------|
| `tools/AI_Character_Generator_v1_4/` | 333 KB | Dead code — standalone character generator superseded by `api/routes/character.py` |
| `tools/AI_Gun_Generator_v1_3/` | 127 KB | Dead code — standalone weapon generator superseded by `api/routes/weapon.py` |
| `tools/AI_Multitool_v1_1/` | 134 KB | Dead code — standalone prop generator superseded by `api/routes/prop.py` |
| `ARTBOARD_LIBRARY/Shawn Props/board.json` | 8.3 MB | User workspace data tracked in git |
| `ALL GENERATED IMAGES/.history/` | On-disk | History JSONL file (270 KB), properly gitignored |

### Doc Drift

| Area | Expected | Actual |
|------|----------|--------|
| How to run | README with instructions | Only `run.bat` exists — no text docs |
| Architecture | ARCHITECTURE.md | None — must read code to understand Electron → FastAPI → Gemini flow |
| API reference | API docs or docstrings | Route files have minimal docstrings |

### Cleanup Candidates

| # | Item | Action |
|---|------|--------|
| 1 | `tools/AI_Character_Generator_v1_4/` | Delete (dead code, 333 KB) |
| 2 | `tools/AI_Gun_Generator_v1_3/` | Delete (dead code, 127 KB) |
| 3 | `tools/AI_Multitool_v1_1/` | Delete (dead code, 134 KB) |
| 4 | `ARTBOARD_LIBRARY/Shawn Props/board.json` | Add to `.gitignore`, remove from tracking |
| 5 | `tools/AI_Character_Generator_v1_4/LORE_LIBRARY/` | Delete with parent |

### Growth & Trajectory

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

### Prompt & Template Surface

Large multi-line string literals are concentrated in backend API routes:
- `character.py`: character prompt builder (~50 lines), style rules, preservation constraints
- `environment.py`: environment prompt builder, biome rules
- `prop.py`: prop prompt builder, material rules
- `uilab.py`: UI generation prompts
- `system.py`: transcription prompt, AI review prompt

No near-duplicate prompts detected above 0.85 similarity threshold. Each tool's prompt builder is domain-specific. No `src/templates.py` exists.

---

## Proposed Cleanup Plan

| Priority | Task | Impact |
|----------|------|--------|
| P0 | Create `README.md` with setup/run guide | Unblocks onboarding |
| P1 | Delete `tools/` legacy directory | -593 KB dead code |
| P1 | Add `ARTBOARD_LIBRARY/` to `.gitignore` | -8.3 MB from repo |
| P2 | Create `ARCHITECTURE.md` documenting Electron → FastAPI → Gemini flow | Knowledge preservation |
| P3 | Consider splitting `CharacterPage.tsx` (2,900 LOC) into sub-components | Maintainability |
