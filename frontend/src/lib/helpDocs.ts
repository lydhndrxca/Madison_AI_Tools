/**
 * Extensive documentation for Madison AI Suite.
 * Each section has an id, title, and markdown-like body text.
 * The HelpPage renders these and the backend /help/ask endpoint uses them as context.
 */

export interface DocSection {
  id: string;
  title: string;
  category: string;
  body: string;
}

export const HELP_DOCS: DocSection[] = [
  // ─── Getting Started ──────────────────────────────────────────
  {
    id: "getting-started",
    title: "Getting Started",
    category: "Overview",
    body: `Madison AI Suite is an AI-powered creative toolkit for game artists, concept designers, and content creators. It uses Google Gemini to generate, edit, and iterate on characters, props, weapons, environments, UI elements, and more.

**First Launch**
When you open the app for the first time, the Welcome Modal walks you through:
1. An overview of the navigation sidebar.
2. Setting up your Google Gemini API key (required).
3. Optional API keys for Deep Search (Pexels, Pixabay) and 3D generation (Meshy, Hitem3D).

You can revisit this at any time from Settings.

**System Requirements**
- A valid Google Gemini API key (free tier works).
- A modern browser or the Electron desktop app.
- Internet connection for AI generation calls.`,
  },
  {
    id: "api-keys",
    title: "API Keys & Configuration",
    category: "Overview",
    body: `**Google Gemini API Key** (Required)
Powers all AI features — image generation, text generation, extraction, enhancement, Art Director, and Deep Search. Get a free key at https://aistudio.google.com/apikey.

**Pexels API Key** (Optional)
Used by Deep Search to find stock reference photos from Pexels. Get a key at https://www.pexels.com/api/.

**Pixabay API Key** (Optional)
Used by Deep Search for additional stock photo results from Pixabay. Get a key at https://pixabay.com/api/docs/.

**Meshy AI API Key** (Optional)
Enables 3D model generation from 2D images via the Meshy service. Get a key at https://www.meshy.ai/.

**Hitem3D Access & Secret Keys** (Optional)
Enables 3D model generation via Hitem3D. Requires both an access key and a secret key.

All keys are stored locally on your machine and are never sent to any server other than their respective API endpoints. You can manage all keys from Settings > API Keys.`,
  },
  {
    id: "navigation",
    title: "App Navigation",
    category: "Overview",
    body: `The app is organized into a left sidebar and a top menu bar.

**Left Sidebar** — Tool navigation grouped into categories:
- **Style Library** — Save, manage, and apply visual styles.
- **Generated Images** — Browse and favorite everything you've created.
- **Tools** — AI Labs for Characters, Weapons, Props, Environments, UI Elements, 3D Models, Multiview, and Default Gemini.
- **Creative** — Idea Brainstorming and the Writing Room.
- **Utilities** — Art Direction Logs, Prompt Builder, and Help.

**Top Menu Bar** includes:
- **File** — Save/Open sessions, audio settings, save folder configuration.
- **Edit** — Undo, Redo, Cut, Copy, Paste, Select All.
- **Templates** — Save and load session templates for quick switching.
- **Dictate** — Voice-to-text input (click then speak into any text field).
- **Deep Search** — Quick access to the Deep Search panel.
- **Quick Generate** — One-click generation with current settings.
- **Help** — Opens this interactive wiki.
- **Cost Counter** — Shows estimated API usage cost for the session.

**Keyboard Shortcuts**
- Ctrl+S — Save session
- Ctrl+O — Open session
- Ctrl+G — Quick generate
- Ctrl+Shift+D — Toggle dictation
- Middle-click — Pan in Art Table`,
  },

  // ─── AI Labs ──────────────────────────────────────────────────
  {
    id: "character-lab",
    title: "Character Lab",
    category: "AI Labs",
    body: `The Character Lab is the primary tool for designing game characters, NPCs, and humanoid concepts.

**Left Sidebar Sections** (draggable to reorder):
- **Generate** — Main generation controls: description textarea, Extract/Enhance/Randomize buttons, Style Library dropdown, model selector, and the Generate button.
- **Edit Character** — Apply iterative edits to the current image by typing what to change.
- **Identity** — Name, age, race, gender, and body build.
- **Attributes** — Detailed character attributes (pose, expression, accessories, distinguishing features).
- **Character Bible** — Backstory and lore for consistent generation.
- **Costume** — Clothing description, style presets, material tags, hardware detail tags.
- **Style Fusion** — Blend two style references.
- **Environment Placement** — Place the character into a specific scene/environment.
- **Preservation Locks** — Lock specific aspects (face, colors, silhouette) during edits.
- **Upscale & Restore** — Enlarge images or fix AI artifacts.
- **Multiview** — Generate front, back, side, 3/4, top, and bottom views.
- **3D Gen AI** — Send to Meshy or Hitem3D for 3D model generation.
- **Save Options** — Export, favorite, and manage images.

**Main Stage Tabs:**
- **Mainstage** — Primary generated image with zoom, pan, and history.
- **4×4 Grid** — 16 different design interpretations at once.
- **Style Library** — Browse and select style folders.
- **Art Table** — Infinite canvas to arrange and compare images.
- **Ref A / B / C** — Reference image slots.
- **Deep Search** — Search for reference images online.

**Key Features:**
- **Extract Attributes** — Analyzes the current image and auto-fills all attribute fields.
- **Enhance Description** — AI enriches your text with professional detail.
- **Randomize** — Fills all fields with creative random attributes.
- **4×4 Grid Mode** — Generates 16 distinct character designs in one image with consistent pose and camera angle.
- **Style Library** — Select a style folder from the dropdown to guide the visual style of generations.

**Tips:**
- Right-click on any generated image for a context menu (send to Art Table, save, copy, set as reference).
- Drag sidebar sections to reorder, then use "Save Default Layout" to persist.
- Use the Edit Character section for iterative refinements without regenerating from scratch.`,
  },
  {
    id: "weapon-lab",
    title: "Weapon Lab",
    category: "AI Labs",
    body: `Design detailed weapon concepts with per-component customization.

**Sidebar Sections:**
- **Generate** — Description, Extract/Enhance buttons, Style Library dropdown, and Generate Weapon button.
- **Weapon Library** — A pre-built library of weapon types (rifles, SMGs, pistols, melee, etc.). Click to select a base weapon. Customize the library via the Edit button.
- **Identity** — Weapon name, finish (Blued Steel, Chrome, etc.), and condition (Factory New through Battle-Scarred).
- **Components** — Per-part customization: Barrel, Stock, Grip, Magazine, Sight/Optic, Muzzle, Handguard, Trigger, Receiver, Accessory Rail.
- **3D Gen AI** — Convert to 3D model.
- **Multiview** — Generate all standard views.
- **Save Options** — Export and management.

**Features:**
- Component-level descriptions allow fine-grained control over each weapon part.
- Extract Attributes reads an existing weapon image and fills all component fields.
- Supports edit mode — load a generated image and describe what to change.
- Style Library support applies visual guidance from your saved styles.`,
  },
  {
    id: "prop-lab",
    title: "Prop Lab",
    category: "AI Labs",
    body: `Create detailed props and objects for games — items, furniture, artifacts, tools, treasures, etc.

**Sidebar Sections:**
- **Generate** — Prop description, name, type, setting, condition, scale, Extract/Enhance/Randomize, and Style Library dropdown.
- **Edit Prop** — Iterative editing with text prompts.
- **Attributes** — Detailed prop attributes.
- **Style Fusion** — Blend two style references.
- **Preservation Locks** — Lock aspects during edits.
- **Upscale & Restore** — Enhance image quality.
- **Multiview** — Full turnaround views.
- **3D Gen AI** — Convert to 3D.
- **Save Options** — Export and management.

**Main Stage Tabs:**
- Mainstage, 4×4 Grid, Style Library, Art Table, Ref A/B/C, Deep Search.

**4×4 Grid** generates 16 unique prop design interpretations with consistent camera angle and chroma-green background for easy extraction.`,
  },
  {
    id: "environment-lab",
    title: "Environment Lab",
    category: "AI Labs",
    body: `Generate game environments, landscapes, interiors, and scenes.

**Sidebar Sections:**
- **Generate** — Environment description, name, biome, game context, time of day, season/weather, scale, and Style Library dropdown.
- **Edit Environment** — Iterative modification of generated scenes.
- **Attributes** — Detailed environment attributes.
- **Style Fusion** — Blend two style references.
- **Preservation Locks** — Lock certain visual elements.
- **Upscale & Restore** — Enhance quality.
- **Multiview** — Multiple camera angles.
- **3D Gen AI** — Convert to 3D.
- **Save Options** — Export and management.

**Main Stage Tabs:**
- Mainstage, 4×4 Grid, Style Library, Art Table, Ref A/B/C, Deep Search.

**Tips:**
- Use the time-of-day and season/weather controls to rapidly iterate on lighting and mood.
- Biome presets include Forest, Desert, Arctic, Urban, Dungeon, Underwater, Space, and more.`,
  },
  {
    id: "ui-lab",
    title: "UI Lab",
    category: "AI Labs",
    body: `Generate styled UI elements for game interfaces — buttons, icons, scrollbars, font characters, and numbers.

**Sidebar Sections:**
- **Generate UI Element** — Element type selector, prompt, output size, color options, grid/cell settings, Style Library dropdown, model selector, and generation count.
- **Reference Image** — Upload or paste a reference to guide style.
- **Button Layout** — Shape (rectangle, pill, hexagon, etc.), border style, icon toggle, text toggle, text size.
- **Scrollbar Components** — Track, thumb, and arrow toggles. Orientation selector.
- **Character Generation** — Input specific characters/digits to generate as styled glyphs.
- **Style Fusion** — Blend two visual styles.
- **3D Gen AI** — Convert UI elements to 3D.
- **Save Options** — Export and management.

**Tabs:**
- Mainstage, 4×4 Grid, **Style Library** (UI-specific), **User Library**, Art Table, Ref A/B/C, Deep Search.

**Important:** The UI Lab pulls styles from the **UI** category in the Style Library, while all other labs pull from the **General** category. This keeps game-UI styles separate from character/prop styles.

**Features:**
- "Use Grid" generates multiple elements in a tiled grid layout.
- "Cell Size" controls individual element dimensions within the grid.
- "Re-envision" mode reimagines the reference image in a new style.
- "Match Ref Dims" outputs at the same dimensions as your reference image.`,
  },
  {
    id: "3d-gen",
    title: "3D Gen AI",
    category: "AI Labs",
    body: `Convert 2D concept art into 3D models using Meshy AI or Hitem3D.

**Standalone Page:**
- Upload images directly or receive them from any lab's sidebar.
- Choose between Meshy and Hitem3D backends.
- Monitor generation progress in the Generation Queue.

**Tabs:**
- **New Generation** — Upload/select an image and start 3D conversion.
- **Generation Queue** — Track in-progress and completed jobs.
- **Model Workshop** — Auto-loads completed models. Provides a full suite of editing tools:
  - Transform (move, rotate, scale)
  - Free-Form Deformation (FFD) lattice editing
  - Snapping and alignment tools
  - Reference block overlays for scale comparison
- **Material Workshop** — Edit materials and textures on completed models.

**Requirements:** Meshy API key or Hitem3D Access + Secret keys (configured in Settings).

**Tips:**
- Best results come from clean, isolated subjects on plain backgrounds.
- Front-facing views typically produce the most accurate 3D reconstructions.
- Use the Model Workshop to refine poses and proportions after generation.`,
  },
  {
    id: "multiview",
    title: "Multiview Generator",
    category: "AI Labs",
    body: `Generate consistent multi-angle views of any subject from a single reference image.

**Views available:** Front, Back, Left Side, Right Side, 3/4 Front, Top, Bottom.

**How to use:**
1. Navigate to the Multiview page or use the Multiview section in any lab sidebar.
2. Provide a reference image (generated or uploaded).
3. Click "Generate All Views" for a complete turnaround, or "Generate Selected View" for a specific angle.

**Tips:**
- The model selector lets you choose between speed and quality.
- Generated views maintain character/prop consistency by using the reference as context.
- Works best with isolated subjects on clean backgrounds.`,
  },
  {
    id: "default-gemini",
    title: "Default Gemini",
    category: "AI Labs",
    body: `A direct interface to the Gemini AI model for freeform image generation and text queries.

**Use cases:**
- Quick one-off image generations without lab-specific controls.
- Text-based queries and AI conversations.
- Testing prompts before using them in a specific lab.

This is a straightforward chat-style interface — type a prompt, get a result. No sidebar controls or presets.`,
  },

  // ─── Smart Features ───────────────────────────────────────────
  {
    id: "art-director",
    title: "Art Director",
    category: "Smart Features",
    body: `The Art Director is an AI assistant that lives in the bottom-left corner of every lab page.

**Turning it ON:**
- Click the green "ON" button on the collapsed widget, or
- Expand the widget and click the ON/OFF pill toggle in the header.

**What it does:**
- Reviews your current image and provides professional art feedback.
- Suggests specific improvements for composition, color, detail, and style.
- Can trigger Deep Searches based on your conversation (say "deep search more hat ideas" and it will analyze your current image and search for relevant references).
- Suggestions can be applied directly: click "Apply All to Edit Prompt" to populate the edit textarea.

**Modes:**
- **Fast Mode** (Gemini 2.0 Flash) — Quick, responsive feedback.
- **Deep Mode** (Gemini 2.5 Pro) — More thoughtful, detailed analysis.

**Chat Features:**
- Attach images to your messages (paste or use the image button).
- Quick context buttons: "Critique this", "Suggest improvements", "Color analysis".
- Conversation history is preserved per session.
- Save transcripts to the Art Direction Logs.

**Tips:**
- The Art Director automatically sees whatever image is on your current lab's mainstage.
- Say "deep search [topic]" to have it analyze your image and trigger an intelligent reference search.
- Use "Apply All to Edit Prompt" after getting feedback to quickly iterate.`,
  },
  {
    id: "deep-search",
    title: "Deep Search",
    category: "Smart Features",
    body: `Deep Search finds reference images across the web using AI-powered queries.

**How to access:**
- Click the "Deep Search" button in the top menu bar.
- Switch to the Deep Search tab in any lab.
- Ask the Art Director to "deep search" a topic.

**Search Settings (left panel):**
- **Query** — Describe what you're looking for.
- **Number of Images** — How many results to find (1-40).
- **Depth** — Quick, Medium, or Deep (more rounds = more results but slower).
- **Search Sources** — Toggle individual sources on/off:
  - Gemini AI Search (grounded web search)
  - Pexels (stock photos)
  - Pixabay (stock photos)
  - Google Images (direct scraping)
- **Reference Images** — Paste or upload images. When a reference image is provided, the AI analyzes it to generate descriptive search queries, ensuring results match the visual style.

**How it works:**
1. If a reference image is provided, Gemini first analyzes it to create descriptive search terms.
2. Stock APIs (Pexels, Pixabay) are queried with the enriched terms.
3. Gemini grounded search finds additional results from the web.
4. Google Images is scraped for supplementary results.
5. All candidate URLs are downloaded and validated.

**Source Toggle Persistence:**
Your source on/off settings are saved to localStorage and persist across sessions. When the Art Director triggers a deep search, it respects your current source settings.

**Tips:**
- Providing a reference image dramatically improves result relevance.
- For niche styles, disable stock sources and rely on Gemini AI Search + Google Images.
- Results can be sent to the Art Table or saved to the Style Library.`,
  },
  {
    id: "style-library",
    title: "Style Library",
    category: "Smart Features",
    body: `The Style Library lets you save, organize, and apply visual styles across all labs.

**Two Categories:**
- **General** — Styles for Character, Weapon, Prop, and Environment labs.
- **UI** — Styles specifically for the UI Lab.

**Folder Management (left panel):**
- Create folders with the "+ New" button (inline name input).
- Rename, Delete, and toggle category (GEN ↔ UI) via the action toolbar.
- Prominent category tabs let you quickly filter between General and UI libraries.
- "Show All" displays both categories.

**Adding Images:**
- **Open** — Select images from disk.
- **Paste** — Paste from clipboard (or use Ctrl+V anywhere on the page).
- **Drag & Drop** — Drag image files directly onto the image grid.

**Using Styles:**
- In any lab, find the "Style Library" dropdown in the Generate section.
- Select a folder to apply its visual guidance to all generations.
- Character/Prop/Environment/Weapon labs pull from **General** styles.
- UI Lab pulls from **UI** styles.

**Trained Elements:**
- Sub-folders appear automatically when generation creates styled elements.
- Navigate via the "Trained Elements" column in the middle.

**Image Controls:**
- Click to select, double-click to preview full-size.
- Middle-click to toggle enabled/disabled (disabled images are excluded from style guidance).
- Right-click for context menu (preview, enable/disable, delete).

**Guidance Text:**
Each folder has an editable guidance text field. This text is sent to the AI as part of the generation prompt when the folder is selected as the active style.`,
  },
  {
    id: "style-fusion",
    title: "Style Fusion",
    category: "Smart Features",
    body: `Style Fusion blends two visual style references into a unique hybrid.

**How to use:**
1. In any lab sidebar, find the "Style Fusion" section.
2. Upload or paste images into Slot A and Slot B.
3. For each slot, describe what to "take" from that style (e.g., "color palette", "material & texture", "silhouette").
4. Adjust the blend ratio if desired.
5. Generate — the AI will merge both style references into your output.

**Take Options:**
- Overall vibe
- Silhouette
- Material & texture
- Color palette
- Detail work & hardware
- Cultural reference
- Attitude & energy

**Tips:**
- Style Fusion works in combination with Style Library — you can have both active.
- Use dramatic contrast between slots for the most interesting results (e.g., cyberpunk + medieval).`,
  },
  {
    id: "grid-generation",
    title: "4×4 Grid Generation",
    category: "Smart Features",
    body: `Generate 16 different design interpretations in a single image.

**How to use:**
1. In any lab, change the "Generation View" dropdown from "Single Image" to "4×4 Grid".
2. The UI automatically switches to the Grid tab.
3. Click Generate — you'll see a loading spinner while the grid is created.
4. The result is a single image with 16 cells, each showing a unique interpretation.

**What varies across cells:**
- Facial features, hairstyle, body proportions (characters)
- Shape, silhouette, material choices, decorative elements (props)
- Color palette, costume details, accessories, overall silhouette

**What stays consistent:**
- The exact pose specified in attributes (default: relaxed standing, arms at sides)
- Camera angle / view
- Background (as specified, or solid grey/green if not specified)

**Tips:**
- This is a cost-effective way to explore many design directions at once.
- Click any cell in the grid gallery to expand it for a closer look.
- The expanded overlay auto-formats to match the image's aspect ratio.`,
  },
  {
    id: "art-table",
    title: "Art Table",
    category: "Smart Features",
    body: `An infinite canvas for arranging, comparing, and annotating your generated images.

**Controls:**
- **Middle-click + drag** — Pan the canvas.
- **Scroll wheel** — Zoom in/out.
- **Left-click** — Select and move items.
- **Right-click** — Context menu for item actions.

**How to add images:**
- Right-click on any generated image in a lab → "Send to Art Table".
- Drag images from the Deep Search results.
- Use the Art Table tab in any lab.

**Features:**
- Unlimited canvas area.
- Arrange multiple images side-by-side for comparison.
- Each lab has its own Art Table tab.

**Tips:**
- Use Art Table to build mood boards from your Deep Search results.
- Compare different iterations of a character or prop by arranging them in a row.`,
  },

  // ─── Creative Tools ───────────────────────────────────────────
  {
    id: "brainstorm",
    title: "Idea Brainstorming",
    category: "Creative Tools",
    body: `A collaborative AI brainstorming tool for generating creative concepts.

**How to use:**
1. Navigate to Idea Brainstorming from the sidebar (Creative section).
2. Type a prompt or topic — e.g., "fantasy RPG character classes" or "sci-fi weapon designs".
3. The AI generates a range of creative ideas, concepts, and directions.

**Use cases:**
- Exploring design directions before committing to a lab.
- Generating lore, faction ideas, or game mechanics concepts.
- Breaking creative blocks with AI-assisted ideation.

**Tips:**
- Use brainstorming output as input for lab descriptions.
- Ask follow-up questions to refine and narrow down ideas.`,
  },
  {
    id: "writing-room",
    title: "Writing Room",
    category: "Creative Tools",
    body: `A collaborative AI writing environment for lore, backstories, design documents, and creative text.

**How to use:**
1. Navigate to Writing Room from the sidebar (Creative section).
2. Start typing or provide a prompt for AI-assisted writing.
3. The AI can continue your text, suggest edits, or rewrite sections.

**Use cases:**
- Character backstories and bios.
- World-building documents.
- Item descriptions and flavor text.
- Design briefs and art direction documents.

**Tips:**
- Write a rough draft and ask the AI to polish or expand it.
- Use output from Idea Brainstorming as a starting point.`,
  },

  // ─── Utilities ────────────────────────────────────────────────
  {
    id: "prompt-builder",
    title: "Prompt Builder",
    category: "Utilities",
    body: `A dedicated tool for constructing and refining AI prompts.

**How to use:**
1. Navigate to Prompt Builder from the sidebar (Utilities section).
2. Build prompts using structured fields and templates.
3. Preview the assembled prompt before copying it to a lab.

**Use cases:**
- Crafting complex multi-part prompts with consistent structure.
- Experimenting with prompt engineering techniques.
- Building reusable prompt templates.`,
  },
  {
    id: "transcripts",
    title: "Art Direction Logs",
    category: "Utilities",
    body: `View saved Art Director conversation transcripts.

**How to use:**
1. In the Art Director widget, click the save button to save the current conversation.
2. Navigate to Art Direction Logs from the sidebar to review past sessions.

**Use cases:**
- Reviewing AI feedback from previous sessions.
- Tracking design decisions and rationale over time.
- Referencing specific suggestions the Art Director made.`,
  },
  {
    id: "generated-images",
    title: "Generated Images Browser",
    category: "Utilities",
    body: `Browse, search, and manage all images generated across all labs.

**Tabs:**
- **Browse** — All generated images, sorted by date.
- **Favorites** — Images you've starred/favorited.

**Features:**
- Thumbnail grid with infinite scroll.
- Click to preview full-size.
- Favorite/unfavorite images.
- Filter and search capabilities.

**Tips:**
- Favorite your best results so you can quickly find them later.
- Use Browse to see your full generation history.`,
  },

  // ─── Voice & Input ────────────────────────────────────────────
  {
    id: "dictation",
    title: "Voice Dictation",
    category: "Voice & Input",
    body: `Voice-to-text input available across all text fields in the app.

**How to use:**
1. Click the "Dictate" button in the top menu bar (or press Ctrl+Shift+D).
2. Click into any text field.
3. Speak — your words are transcribed and inserted at the cursor.
4. Click the button again (or press the shortcut) to stop.

**Engines:**
- **Native (Windows)** — Uses the browser's built-in speech recognition. Faster, works offline.
- **Gemini (AI)** — Uses Gemini for transcription. More accurate, handles accents better, but requires internet.

Right-click the Dictate button to switch engines.

**Visual Indicators:**
- Red pulsing dot + "Recording in progress..." when actively recording.
- Yellow spinner + "Processing..." when audio is being transcribed after stopping.

**Tips:**
- Speak clearly and at a moderate pace for best results.
- The Gemini engine is better at filtering out background noise.
- Works in every text field: descriptions, edit prompts, brainstorming, writing room, etc.`,
  },
  {
    id: "clipboard",
    title: "Clipboard & Drag-Drop",
    category: "Voice & Input",
    body: `Madison AI Suite supports multiple ways to get images into the app.

**Ctrl+V (Paste):**
- Works globally — paste images from your clipboard into the active tool.
- In Style Library, pastes directly into the selected folder.
- In labs, pastes into reference image slots or pending image attachments.

**Drag & Drop:**
- Drag image files from your desktop directly into the Style Library.
- Drop zone highlights when dragging over a valid target.

**Right-Click Context Menus:**
- Right-click on any generated image for options:
  - Send to Art Table
  - Save to disk
  - Copy to clipboard
  - Set as reference image
  - Add to Style Library folder`,
  },

  // ─── Sessions & Projects ──────────────────────────────────────
  {
    id: "sessions",
    title: "Sessions & Templates",
    category: "Sessions & Projects",
    body: `Madison AI Suite automatically preserves your workspace state.

**Sessions:**
- **Save Session (Ctrl+S)** — Saves all current state to a file: every lab's settings, images, history, and layout.
- **Open Session (Ctrl+O)** — Loads a previously saved session file, restoring everything.

**Templates:**
- Templates are lightweight session snapshots saved to the Templates dropdown in the top menu bar.
- Use "Save as Template" from the Templates dropdown.
- Click any template name to load it instantly.
- Rename or delete templates via the hover buttons.

**Auto-Persistence:**
- Each lab's state is registered with the session system.
- Layout preferences (section order, collapsed states) are saved per-lab.
- Style Library folder selection, model choices, and toggle states all persist.

**Tips:**
- Save templates for different project contexts (e.g., "Fantasy RPG Characters", "Sci-Fi UI Pack").
- Use session files for archiving completed work or sharing setups between machines.`,
  },

  // ─── Preservation & Editing ───────────────────────────────────
  {
    id: "preservation",
    title: "Preservation Locks",
    category: "Advanced Features",
    body: `Preservation Locks let you protect specific aspects of an image during edits.

**Available Locks:**
- Face / Head
- Color Palette
- Silhouette
- Costume Details
- Background / Environment
- Pose

**How to use:**
1. In a lab's sidebar, find the "Preservation Locks" section.
2. Toggle on the aspects you want to preserve.
3. Add negative constraints (things to avoid).
4. When you make an edit, the AI will try to change only what you asked while keeping locked aspects intact.

**Negatives:**
You can also add explicit negatives — things the AI should avoid in the output (e.g., "no blur", "no cartoon style").`,
  },
  {
    id: "upscale-restore",
    title: "Upscale & Restore",
    category: "Advanced Features",
    body: `Enhance image quality after generation.

**Upscale:**
- Makes images bigger and sharper.
- Choose scale factor (2x, 4x).
- Supports batch processing of multiple images.

**Restore:**
- Fixes common AI artifacts: blurriness, distortion, strange textures.
- Cleans up fine details like hands, faces, and text.

**How to use:**
1. In a lab sidebar, find the "Upscale & Restore" section.
2. Toggle between Upscale and Restore modes.
3. Optionally add reference images for context.
4. Click Generate.

**Tips:**
- Always generate at the AI model's native resolution first, then upscale.
- Restore works best on images with obvious artifacts — it won't dramatically change a clean image.`,
  },
  {
    id: "extract-enhance",
    title: "Extract & Enhance",
    category: "Advanced Features",
    body: `Two complementary AI-powered text tools available in every lab.

**Extract Attributes:**
- Analyzes the current image and fills in all attribute fields automatically.
- Works for characters (age, race, costume, etc.), props (material, condition), weapons (components), and environments (biome, time of day).
- Great for reverse-engineering a reference image into editable parameters.

**Enhance Description:**
- Takes your existing text and enriches it with professional detail.
- Adds specific materials, textures, colors, and design terminology.
- Maintains your original intent while making the prompt more effective.

**Randomize (Character Lab):**
- Fills all fields with creative random attributes for quick exploration.
- Each randomization is completely different.
- Use as a starting point and refine what you like.

**Tips:**
- Use Extract on a reference image, then tweak the auto-filled attributes to create variations.
- Enhance works best when you provide at least a basic description — it builds on your input.`,
  },

  // ─── Settings & Customization ─────────────────────────────────
  {
    id: "settings",
    title: "Settings",
    category: "Settings & Customization",
    body: `Access Settings from the sidebar (gear icon at the bottom).

**Sections:**
- **API Keys** — Manage all API keys (Gemini, Pexels, Pixabay, Meshy, Hitem3D).
- **Models** — Configure which Gemini models are available and their display names.
- **Appearance** — Theme and visual preferences.
- **Audio** — Voice dictation engine selection and audio input device.
- **Advanced** — Developer options and debugging tools.

**Tips:**
- Changes are applied immediately — no restart needed.
- API keys are stored locally and never shared.`,
  },
  {
    id: "custom-sections",
    title: "Custom Sidebar Sections",
    category: "Settings & Customization",
    body: `Each lab's sidebar supports customization:

**Reordering:**
- Drag sections by their grip handle (⋮⋮) to reorder.
- Click "Save Default Layout" to persist your arrangement.

**Collapsing:**
- Click the section header to collapse/expand.
- Collapsed state is preserved in your layout.

**Section Toggles:**
- Some sections have an ON/OFF toggle (the small button in the header).
- Disabled sections are excluded from generation prompts.

**Tips:**
- Put your most-used sections at the top.
- Collapse sections you rarely change to reduce visual clutter.
- Layout is saved per-lab and per-project.`,
  },

  // ─── Cost & Performance ───────────────────────────────────────
  {
    id: "cost",
    title: "Cost Counter & API Usage",
    category: "Settings & Customization",
    body: `The Cost Counter in the top-right of the menu bar shows estimated API usage cost for the current session.

**How it works:**
- Tracks all Gemini API calls made during the session.
- Estimates cost based on token usage and model pricing.
- Resets when you restart the app.

**Tips for reducing costs:**
- Use Fast mode in the Art Director instead of Deep mode for routine feedback.
- Use the Quick depth in Deep Search when you don't need exhaustive results.
- The 4×4 Grid uses one API call to generate 16 variations — very cost-effective.
- Disable unused Deep Search sources to avoid redundant API calls.
- Native speech recognition (dictation) is free; Gemini transcription costs tokens.`,
  },
];

/**
 * Build the full documentation as a single string for use as Gemini context.
 */
export function buildDocsContext(): string {
  return HELP_DOCS.map(
    (s) => `## ${s.title} [${s.category}]\n\n${s.body}`
  ).join("\n\n---\n\n");
}
