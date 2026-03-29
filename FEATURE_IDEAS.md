# Madison AI Suite - Feature Ideas & Roadmap

Collected feature gaps and improvement ideas for the suite. Each item includes context on why it matters for a game studio concept art workflow.

---

## 1. Batch Generation Queue

You can generate one image at a time (or a 4x4 grid), but there's no way to queue up multiple generation jobs and let them run sequentially. A concept artist would want to say "generate 5 different characters with these settings" and walk away. A simple job queue with progress tracking would be high value.

**Priority:** Medium
**Scope:** Backend queue system + frontend queue panel

---

## 2. Image Comparison / Before-After View

Edit history exists per-image, but there's no side-by-side or slider-based comparison between two versions. This is table stakes for any iterative visual tool -- a split-view or draggable slider showing "before edit" vs "after edit" on the same image.

**Priority:** High
**Scope:** New shared component, integrate into ImageViewer

---

## 3. Prompt Templates / Prompt Library

There's a Style Library for visual references, but no equivalent for prompts. Concept artists develop go-to prompts that work well ("cinematic lighting, dramatic angle, painterly style..."). A saveable, taggable prompt library that you can one-click inject into any tool would save enormous repetition.

**Priority:** High
**Scope:** New backend route + new frontend page/panel, integrate into all tool sidebar sections

---

## 4. Generation History / Audit Trail

Individual tool history exists, but there's no global "everything I've generated today" timeline view. The Generated Images browser shows files on disk, but a timeline-style history with the prompt, settings, and model used for each generation (like a lab notebook) would be invaluable for recreating or iterating on past results.

**Priority:** Medium
**Scope:** Backend logging of all generation calls + new frontend timeline view

---

## 5. Color Palette Extraction & Direction

Attribute extraction exists for characters/props/environments, but there's no color palette extraction from an image, or a way to say "use this palette" as a constraint. Being able to extract dominant colors from a reference image and feed them as direction to the AI would be extremely useful for art direction workflows.

**Priority:** Medium
**Scope:** Backend palette extraction endpoint (PIL/numpy) + frontend palette UI component + integration into prompt building

---

## 6. Turntable / Consistency Sheet

For characters and props, a common deliverable is a turntable -- generating front/back/side/3-4 views that are consistent with each other. Multi-view generation exists, but a dedicated "consistency sheet" mode that composes the views into a single sheet layout (like a character model sheet) ready for handoff to a 3D modeler would be a natural next step.

**Implementation note:** Add this as part of the export/save settings in the save side menu for both PropLab and CharacterLab tools.

**Priority:** Medium
**Scope:** Image compositing logic (backend or frontend canvas) + UI in save options panel

---

## 7. Text-to-3D Placeholder

The `3d` page ID is already stubbed in `app.tsx` with "3D GEN AI -- Coming Soon." With Gemini's evolving multimodal capabilities and tools like TripoSR/InstantMesh, this is the obvious next frontier. Even just "generate a 3D mesh from this 2D concept" as a one-click export would be significant.

**Priority:** Lower (dependent on external model availability)
**Scope:** New tool page, new backend integration with 3D generation API

---

## 8. Team / Project Organization

Everything is currently per-session. For a studio setting, you'd want:
- Named projects (e.g., "Battle Royale Map 3 - Desert Environment")
- All generations, styles, artboards, and prompts grouped under a project
- Switch between projects cleanly

The artboard multi-board feature is a step toward this, but it's not project-scoped yet.

**Priority:** Medium
**Scope:** Project metadata system, scoped storage, project switcher UI

---

## 9. Annotation / Markup on Generated Images

Artists often need to mark up AI output -- "make this part bigger," "wrong color here," "add detail here." Inpainting exists, but there's no lightweight annotation layer (arrows, circles, text callouts) that could then be fed back as direction to the AI or exported as feedback for art directors or team members.

**Priority:** Medium
**Scope:** Annotation toolbar + canvas overlay in ImageViewer, export annotations as image or feed to AI

---

## 10. Export Package / Handoff

A "package this character for handoff" button that exports as a single ZIP:
- All view images (front, back, side, 3/4)
- The XML data
- Color palette swatch
- The prompt/settings used
- A reference sheet composite (consistency sheet)

Right now images can be saved and XML viewed individually, but a one-click handoff package for art directors or 3D modelers is missing.

**Implementation note:** Add this to the same save side menu as the consistency sheet (item 6).

**Priority:** High
**Scope:** Backend ZIP assembly endpoint + frontend trigger in save options

---

## 11. Favorites / Pinning

Across all tools, there's no way to "star" or "pin" a particular generation as a keeper. When iterating through dozens of variations, being able to quickly flag the good ones and then review just the flagged set would streamline the workflow.

Additionally, in the 4x4 grid view, starring an image should crop it from the grid and save it as its own standalone image.

**Priority:** High
**Scope:** Favorites state in context/localStorage, star UI on ImageViewer + GridGallery cells, favorites filter view

---

## 12. AI-Powered Image Description (Reverse Prompt)

Attribute extraction from images exists, but there's no general "describe this image" feature that produces a prompt you could use to recreate it. Gemini can do this trivially. Useful when someone provides a reference image and you want to generate variations -- have the AI describe it first, then modify the description.

**Priority:** Medium
**Scope:** New backend endpoint using Gemini vision, frontend button in ImageViewer toolbar
