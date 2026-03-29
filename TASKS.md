# Tasks

## Health Audit Cleanup

- [x] Create `README.md` with project description, prerequisites, setup, and run instructions
- [x] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Character_Generator_v1_4/`
- [x] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Gun_Generator_v1_3/`
- [x] Delete dead legacy tools directory: `src/pubg_madison_ai_suite/tools/AI_Multitool_v1_1/`
- [x] Add `ARTBOARD_LIBRARY/` to `.gitignore` and untrack large board JSON files
- [x] Add `config/user_settings_backup.json` to `.gitignore` and untrack (40 MB blob)
- [x] Add `.repo_snapshot/` to `.gitignore` and untrack audit artifacts
- [x] Create `ARCHITECTURE.md` documenting Electron → FastAPI → Gemini data flow
- [x] Remove `tools/**` from `pyproject.toml` build targets (dead reference)
- [ ] Consider splitting `CharacterPage.tsx` (188 KB, ~3,088 LOC) into sub-components
- [ ] Add `run.sh` for cross-platform support (currently Windows-only)
- [ ] Centralize prompt templates to reduce near-duplicate inline prompts

## Done

- [x] Health audit report generated (report_id: 20260329_102917)
- [x] Health audit report generated (report_id: 20260329_172858)
