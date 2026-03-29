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
