"""Help / Wiki Q&A endpoint — uses Gemini to answer user questions about the app."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pubg_madison_ai_suite.api.core import get_api_key, rest_generate_text_multimodal

router = APIRouter()

DOCS_CONTEXT = r"""
## Getting Started [Overview]
Madison AI Suite is an AI-powered creative toolkit for game artists, concept designers, and content creators using Google Gemini.
First launch shows a Welcome Modal for API key setup. Requires a Google Gemini API key (free). Optional keys: Pexels, Pixabay (Deep Search), Meshy, Hitem3D (3D generation).

## API Keys & Configuration [Overview]
Google Gemini API Key (Required) — powers all AI features. Pexels/Pixabay (Optional) — stock photo search in Deep Search. Meshy AI (Optional) — 3D model generation. Hitem3D Access+Secret (Optional) — alternative 3D generation. All keys stored locally, managed in Settings > API Keys.

## App Navigation [Overview]
Left Sidebar: Style Library, Generated Images, Tools (Character/Weapon/Prop/Environment/UI/3D/Multiview/Gemini), Creative (Brainstorm/Writing Room), Utilities (Logs/Prompt Builder/Help).
Top Menu Bar: File, Edit, Templates, Dictate, Deep Search, Quick Generate, Help, Cost Counter.
Shortcuts: Ctrl+S save, Ctrl+O open, Ctrl+G quick generate, Ctrl+Shift+D dictate, Middle-click pan Art Table.

## Character Lab [AI Labs]
Design game characters. Sidebar: Generate, Edit Character, Identity (name/age/race/gender/build), Attributes (pose/expression/accessories), Character Bible, Costume (clothing/style presets/materials), Style Fusion, Environment Placement, Preservation Locks, Upscale & Restore, Multiview, 3D Gen AI, Save Options. Tabs: Mainstage, 4x4 Grid, Style Library, Art Table, Ref A/B/C, Deep Search. Features: Extract Attributes (auto-fill from image), Enhance Description (AI enrichment), Randomize (random attributes), 4x4 Grid (16 variations).

## Weapon Lab [AI Labs]
Design weapons with per-component customization. Sidebar: Generate, Weapon Library (pre-built weapons), Identity (name/finish/condition), Components (Barrel/Stock/Grip/Magazine/Sight/Muzzle/Handguard/Trigger/Receiver/Accessory Rail), 3D Gen AI, Multiview, Save Options. Style Library support.

## Prop Lab [AI Labs]
Create props/objects. Sidebar: Generate, Edit Prop, Attributes, Style Fusion, Preservation, Upscale & Restore, Multiview, 3D Gen AI, Save. Tabs: Mainstage, 4x4 Grid, Style Library, Art Table, Refs, Deep Search. 4x4 Grid uses chroma-green background.

## Environment Lab [AI Labs]
Generate environments/landscapes. Controls: description, biome, game context, time of day, season/weather, scale. Tabs: Mainstage, 4x4 Grid, Style Library, Art Table, Refs, Deep Search.

## UI Lab [AI Labs]
Generate styled UI elements (buttons, icons, scrollbars, fonts, numbers). Uses UI-category styles from Style Library (separate from General). Features: grid mode, cell size, re-envision mode, match ref dims. Tabs: Mainstage, 4x4 Grid, Style Library (UI), User Library, Art Table, Refs, Deep Search.

## 3D Gen AI [AI Labs]
Convert 2D concepts to 3D models via Meshy or Hitem3D. Tabs: New Generation, Generation Queue, Model Workshop (transform/FFD/snapping/reference blocks), Material Workshop. Upload images directly or send from any lab.

## Multiview Generator [AI Labs]
Generate consistent multi-angle views from a single reference: Front, Back, Left, Right, 3/4 Front, Top, Bottom. Available as standalone page or lab sidebar section.

## Default Gemini [AI Labs]
Direct Gemini interface for freeform generation and chat. No sidebar controls — just type and get results.

## Art Director [Smart Features]
AI assistant in bottom-left corner. Toggle ON via green button. Reviews current image, suggests improvements. Modes: Fast (Flash) and Deep (Pro). Can trigger Deep Searches ("deep search more ideas"). "Apply All to Edit Prompt" sends suggestions to edit textarea. Saves transcripts to Art Direction Logs.

## Deep Search [Smart Features]
AI-powered reference image search. Settings: query, num images, depth (quick/medium/deep), source toggles (Gemini/Pexels/Pixabay/Google Images). Reference images are analyzed by AI for descriptive queries. Source settings persist in localStorage. Triggered manually or via Art Director.

## Style Library [Smart Features]
Two categories: General (for all labs except UI) and UI (for UI Lab only). Folder management: create, rename, delete, toggle category. Add images via Open/Paste/Drag-Drop. Select style from dropdown in any lab. Images can be enabled/disabled (middle-click). Each folder has editable guidance text.

## Style Fusion [Smart Features]
Blend two style references. Slot A + Slot B with "take" options (vibe, silhouette, material, color, detail, cultural reference, attitude). Works alongside Style Library.

## 4x4 Grid Generation [Smart Features]
16 unique design interpretations in one image. Consistent pose/camera/background. Varies: features, proportions, materials, colors, silhouette. Auto-switches to grid tab. Cost-effective exploration.

## Art Table [Smart Features]
Infinite canvas. Middle-click pan, scroll zoom. Send images from labs, Deep Search, or drag. Compare iterations side-by-side.

## Idea Brainstorming [Creative Tools]
AI brainstorming for creative concepts. Type a topic, get diverse ideas. Good for pre-lab exploration.

## Writing Room [Creative Tools]
Collaborative AI writing for lore, backstories, design docs, item descriptions. AI continues, edits, or rewrites text.

## Prompt Builder [Utilities]
Structured prompt construction tool. Build, preview, and copy prompts.

## Art Direction Logs [Utilities]
Saved Art Director conversation transcripts for review.

## Generated Images Browser [Utilities]
Browse all generated images. Tabs: Browse (all, sorted by date), Favorites (starred).

## Voice Dictation [Voice & Input]
Click Dictate in top bar, speak into any text field. Engines: Native (Windows, offline) or Gemini (AI, more accurate). Right-click to switch. Visual indicators: red=recording, yellow=processing.

## Clipboard & Drag-Drop [Voice & Input]
Ctrl+V pastes images globally. Drag-drop into Style Library. Right-click on images for context menus (Art Table, save, copy, reference, Style Library).

## Sessions & Templates [Sessions & Projects]
Save/Open sessions (Ctrl+S/O). Templates for quick switching. Auto-persistence of all lab states.

## Preservation Locks [Advanced Features]
Lock face, colors, silhouette, costume, background, pose during edits. Add negatives to avoid.

## Upscale & Restore [Advanced Features]
Upscale: bigger/sharper (2x/4x). Restore: fix AI artifacts. Batch support.

## Extract & Enhance [Advanced Features]
Extract Attributes: auto-fill fields from image. Enhance Description: AI enriches text. Randomize: random attributes (Character Lab).

## Settings [Settings & Customization]
API Keys, Models, Appearance, Audio, Advanced. Changes applied immediately.

## Custom Sidebar Sections [Settings & Customization]
Drag to reorder, collapse/expand, ON/OFF toggles. Save Default Layout persists.

## Cost Counter [Settings & Customization]
Shows estimated API cost for session. Tips: use Fast mode, Quick depth, 4x4 Grid (cost-effective), disable unused sources, Native dictation is free.
"""


class HelpAskRequest(BaseModel):
    question: str
    conversation: list[dict] | None = None


class HelpAskResponse(BaseModel):
    answer: str
    relevant_sections: list[str] = []
    error: Optional[str] = None


@router.post("/ask")
async def help_ask(req: HelpAskRequest):
    """Answer a user question about Madison AI Suite using Gemini + docs context."""
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(400, "No API key configured")

    loop = asyncio.get_event_loop()

    def _do():
        model = "gemini-2.0-flash"

        system_prompt = (
            "You are the Madison AI Suite help assistant. "
            "Answer the user's question using ONLY the documentation below. "
            "Be concise, accurate, and helpful. Use bullet points for clarity. "
            "If the question is about a specific tool or feature, mention the section name "
            "so the user can navigate to it.\n\n"
            "At the end of your answer, on a new line, write SECTIONS: followed by a "
            "comma-separated list of the most relevant documentation section IDs "
            "(the bracketed category names and section titles from the docs). "
            "For example: SECTIONS: character-lab, art-director, deep-search\n\n"
            "Available section IDs: getting-started, api-keys, navigation, character-lab, "
            "weapon-lab, prop-lab, environment-lab, ui-lab, 3d-gen, multiview, default-gemini, "
            "art-director, deep-search, style-library, style-fusion, grid-generation, "
            "art-table, brainstorm, writing-room, prompt-builder, transcripts, "
            "generated-images, dictation, clipboard, sessions, preservation, "
            "upscale-restore, extract-enhance, settings, custom-sections, cost\n\n"
            "--- DOCUMENTATION ---\n" + DOCS_CONTEXT
        )

        contents: list = []
        if req.conversation:
            for msg in req.conversation[-6:]:
                role = msg.get("role", "user")
                text = msg.get("text", "")
                if role == "user":
                    contents.append(f"User: {text}")
                else:
                    contents.append(f"Assistant: {text}")

        contents.append(f"User question: {req.question}")

        result = rest_generate_text_multimodal(
            api_key, model,
            [{"text": system_prompt}] + [{"text": c} for c in contents],
            timeout=30, cost_category="help",
        )

        answer = (result or "I couldn't find an answer. Try rephrasing your question.").strip()

        sections: list[str] = []
        if "SECTIONS:" in answer:
            parts = answer.split("SECTIONS:", 1)
            answer = parts[0].strip()
            raw = parts[1].strip().split("\n")[0]
            sections = [s.strip() for s in raw.split(",") if s.strip()]

        return answer, sections

    answer, sections = await loop.run_in_executor(None, _do)
    return HelpAskResponse(answer=answer, relevant_sections=sections)
