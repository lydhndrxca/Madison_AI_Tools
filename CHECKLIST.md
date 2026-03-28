# Madison AI Suite — Feature Checklist (TLDR)

**Printable reference for QA / walkthrough**
**Generated: March 27, 2026**

---

## 1. UI Framework & Shell

- [ ] App launches via `run.bat` (Electron + React + Python FastAPI backend)
- [ ] Dark theme matching old Python Tkinter color palette
- [ ] Sidebar with **Style Library** and **Tools** sections
- [ ] Sidebar collapse button is 52px wide (same collapsed and expanded)
- [ ] Top menu bar shows **File**, **Edit**, **Session Templates** dropdown
- [ ] Default page on launch: **Character Generator**
- [ ] Status bar at bottom with console toggle

---

## 2. File Menu

- [ ] **Save Session** — saves entire app state to a file
- [ ] **Open Session** — restores full app state from a file
- [ ] **Set Save Folder...** — user picks where generated images are saved
- [ ] **Reset Save Folder to Default** — reverts to default save path
- [ ] **Reset App** — clears all cache/storage and reloads

---

## 3. Session Templates (top menu bar)

- [ ] Dropdown appears to the right of "Edit" in the top bar
- [ ] Save current tool state as a named template (text, toggles, etc.)
- [ ] Load a template (resets images but restores all settings)
- [ ] Rename / Delete templates
- [ ] Templates persist across app restarts (localStorage)

---

## 4. Image Viewers (all tools)

- [ ] Mouse wheel zoom, middle-click pan (hand cursor while panning)
- [ ] Default pointer cursor, grabbing hand only when panning
- [ ] Zoom in/out buttons, percentage display, Fit to View (F key)
- [ ] Image resolution shown in bottom-left
- [ ] Left/right arrows to navigate gallery when multiple images exist
- [ ] **Right-click context menu**: Copy, Paste, Open, Save, Fit to View, Clear, Clear All Generated
- [ ] Context menu hover state visible
- [ ] Paste from clipboard works (images copied from Chrome, Snipping Tool, etc.)
- [ ] **Locked during generation** — overlay with "Generating..." message, tools disabled
- [ ] Zoom level preserved when switching between history states

---

## 5. Inpainting / Editing Tools (Image Viewer toolbar)

- [ ] **Brush** (B) — paints selection mask, `[` `]` to resize, visual size circle follows cursor
- [ ] **Eraser** (E) — erases mask, `[` `]` to resize, visual size circle follows cursor
- [ ] **Shift+click** with brush = erase
- [ ] **Marquee** (M) — rectangle selection
- [ ] **Lasso** (L) — freehand selection, shows outline while drawing, combines without stacking
- [ ] **Smart Select** (W) — type subject, AI draws accurate mask (not just bounding box)
- [ ] **Smart Erase** — AI removes masked object
- [ ] **Outpaint** — extend canvas with direction/px controls
- [ ] **Remove BG** — removes background (rembg or Gemini fallback)
- [ ] **Style Transfer** — presets (Oil, Watercolor, Anime, etc.) + custom
- [ ] Clear Mask button
- [ ] All tool buttons always visible (not toggled)
- [ ] Icons next to each tool button
- [ ] Brush size slider color: dark grey
- [ ] All inpainting action buttons use pulsing animation
- [ ] All tools disabled when viewer is locked

---

## 6. Edit History (per image)

- [ ] Tied to each specific image (front, back, side views — not refs)
- [ ] "Current (live)" entry always at top
- [ ] Click entry to restore image + settings
- [ ] **Clear History** button with "Are you sure?" confirmation
- [ ] History persists to disk (JSON sidecar alongside PNG)
- [ ] Loading a saved image restores its history

---

## 7. Pulsing Button Animation

- [ ] Any button making an API call glows/pulses while active
- [ ] Button text changes during operation (e.g., "Generating...", "Extracting...")
- [ ] Effect is clearly visible

---

## 8. Character Generator — Left Panel Sections

### General Layout
- [ ] All sections are **draggable and reorderable**
- [ ] **"Set Active Layout as Default"** button saves order + collapse states
- [ ] Layout restored on app start
- [ ] All sections (except "Generate Character Image") are **collapsible**
- [ ] Sections expand downward without jumping scroll position

### Section ON/OFF Toggles
- [ ] ON/OFF button on: Identity, Attributes, Bible, Costume, Style Fusion, Environment Placement, Preservation Lock
- [ ] Middle-click toggles ON/OFF
- [ ] OFF sections are dimmed (opacity)
- [ ] OFF sections excluded from generation prompts
- [ ] All toggleable sections **default to OFF**

### Lock Icons
- [ ] Lock icon (lucide-react SVG, light grey) on: Identity, Attributes, Bible, Costume
- [ ] Locked = AI can't change fields; user can still edit manually
- [ ] Tooltip explains lock behavior in plain language

### Extract Targets (under Extract Attributes button)
- [ ] Four checkboxes: Identity, Attributes, Bible, Costume
- [ ] All checked by default
- [ ] Controls which sections Extract / Enhance / Randomize populate
- [ ] Works alongside lock system (lock overrides if both present)

---

## 9. Character Generator — Sections Detail

### Character Identity
- [ ] Age, Race, Gender, Build dropdowns
- [ ] Character Description textarea
- [ ] Lock icon + ON/OFF toggle
- [ ] Placeholder text: artist-friendly description example

### Generate Character Image (not collapsible)
- [ ] **Extract Attributes** button (with extract target checkboxes below)
- [ ] **Style Library** dropdown (populated from Style Library page)
- [ ] **Enhance Attributes** / **Randomize Full Character** buttons
- [ ] **Open Image** / **Reset Character** buttons
- [ ] **Generate Character Image** button (primary, large)
- [ ] **Count** stepper (+/- only, no native spinners)
- [ ] **Model selector** dropdown (truncates cleanly, doesn't overflow)

### Character Attributes
- [ ] Full attribute list from original app (Hair, Eyes, Skin, Pose, etc.)
- [ ] Pose defaults to "A pose" unless manually overridden
- [ ] Each field: dropdown + custom text input
- [ ] Lock icon + ON/OFF toggle

### Character Bible
- [ ] Character Name, Role/Archetype, Backstory, World Context, Design Intent
- [ ] Production Style tags (show ~3 presets, "Show more" toggle, "+" for custom)
- [ ] Custom Production Note
- [ ] Tone/Quality tags
- [ ] All fields have descriptive placeholder text
- [ ] Lock icon + ON/OFF toggle

### Costume Director
- [ ] Costume Style tags, Material tags
- [ ] Primary / Secondary / Accent Color — each with text input, color swatch (color wheel), eyedropper
- [ ] Hardware Color dropdown
- [ ] Hardware Details tags, Costume Origin tags
- [ ] Costume Notes textarea
- [ ] Lock icon + ON/OFF toggle

### Style Fusion
- [ ] Reference 1 + Reference 2 with label inputs and "Take" dropdowns
- [ ] Blend slider (0–100%) between the two
- [ ] ON/OFF toggle

### Environment Placement
- [ ] **Defaults to OFF** with info banner explaining what it does
- [ ] **Character Images** — add multiple with per-image notes
- [ ] **Reference Images** — add multiple with per-image notes
- [ ] **Location** — 14 presets + Custom text input
- [ ] **Time of Day** — 8 presets + custom text input
- [ ] **Lighting** — 11 presets + custom text input
- [ ] **Pose** — 10 presets + custom text input; switches to free text when multiple characters
- [ ] **Props** — free text
- [ ] **Camera** — 9 presets + custom text input
- [ ] **Output Format** — 6 presets (1:1, 3:4, 4:3, 9:16, 16:9, 2.39:1) + custom
- [ ] When ON: characters placed in real environment (not flat background)
- [ ] Output format overrides default aspect ratio when ON
- [ ] ON/OFF toggle (no lock — AI doesn't extract to this section)

### Preservation Lock
- [ ] Global ON/OFF toggle + Reset button
- [ ] **Preserve** list: Keep face, Keep hairstyle, Keep hair color, Keep pose, etc.
- [ ] Checkboxes to enable/disable each preserve rule
- [ ] "+ Add Preserve" button for custom rules
- [ ] **Negative Constraints** list: No crown, No fantasy elements, etc.
- [ ] "+ Add Negative" button for custom negatives
- [ ] Remove buttons (hover to reveal) on each item
- [ ] ON/OFF toggle

### Multi-View Generation
- [ ] Generate All Views / Generate Selected View buttons
- [ ] Count stepper
- [ ] Collapsible

### Save Options
- [ ] Save Current, Send to PS, Send ALL to PS
- [ ] Show XML (modal with copy + save)
- [ ] Clear Cache, Save Log, Open Generated Images
- [ ] Collapsible

---

## 10. Character Generator — Middle Panel (Edit)

- [ ] Edit Character textarea with descriptive placeholder
- [ ] **Apply Changes** button (pulsing animation)
- [ ] Edit History panel (per-image, collapsible)

---

## 11. Character Generator — Right Panel (Viewer)

- [ ] "Character Concept" header with Cancel + Quick Generate buttons
- [ ] **Tab groups**: Stage (Main Stage, 3/4), Views (Front, Back, Side), Refs (Ref A–C, + button)
- [ ] Tab groups visually differentiated
- [ ] Right-click on View tabs → "Edit Prompt" modal
- [ ] Right-click on Ref tabs → "Remove"
- [ ] No "+" button next to Side view (no custom ortho views)
- [ ] "+" button on Refs to add more reference tabs

---

## 12. Tag Picker Behavior (all tag sections)

- [ ] ~3 presets visible by default, "Show more" toggle for all
- [ ] "+" button to add custom tags (label + prompt)
- [ ] Tags show checkmark when ON, muted when OFF
- [ ] Hover tooltip shows tag name + prompt + "Right-click for more options"
- [ ] Right-click → "Edit Prompt" or "Delete"

---

## 13. Gemini Page

- [ ] Quality / Speed mode radio buttons
- [ ] Prompt textarea with descriptive placeholder
- [ ] Generate Image button (pulsing animation)
- [ ] Cancel button during generation
- [ ] Send to PS, Save Image, Open Generated Images
- [ ] Image viewer with all standard controls
- [ ] Locked during generation

---

## 14. Multiview Page

- [ ] Prompt textarea with descriptive placeholder
- [ ] Dimension selector
- [ ] Generate Image, Isolate Image, Generate Selected View, Generate All Views
- [ ] Count stepper, Model selector
- [ ] Send to PS, Save All Images, Open Generated Images
- [ ] Locked during generation

---

## 15. Weapon Generator

- [ ] Weapon Name input with descriptive placeholder
- [ ] Extract Attributes, Enhance Description
- [ ] Open Image, Reset Weapon
- [ ] Edit Instructions textarea with descriptive placeholder
- [ ] Generate / Apply Edit button
- [ ] Weapon Components (Barrel, Grip, Stock, etc.) with inputs
- [ ] Material Finish / Condition dropdowns
- [ ] Generate All Views, Send to PS, Send ALL to PS
- [ ] Show XML, Clear Cache, Open Images
- [ ] Quick Generate button
- [ ] All inputs disabled during extraction
- [ ] Locked viewer during generation

---

## 16. Style Library Page

- [ ] Three-column layout: Folders | Trained Elements | Image Grid + Guidance
- [ ] Create / Rename / Delete folders
- [ ] Add / Remove images
- [ ] Toggle image disabled state (middle-click)
- [ ] Guidance text editor (debounced auto-save)
- [ ] Double-click image for full-screen preview
- [ ] Style Library folders appear in Character Page "Style Library" dropdown

---

## 17. Concurrency

- [ ] All API calls are concurrent
- [ ] Start generation in one tool, switch to another, start another
- [ ] Return to first tool — results are there
- [ ] State persists across tab switches
- [ ] Each button has independent loading state

---

## 18. Image Saving

- [ ] All generated images auto-saved to: `<SaveFolder>/<ToolName>/<YYYY-MM-DD>/`
- [ ] JSON metadata saved alongside each image
- [ ] Custom save folder via File → Set Save Folder
- [ ] Sub-folder structure honored regardless of root path

---

## 19. Photoshop Integration

- [ ] "Send to PS" opens current image in Photoshop (or default viewer)
- [ ] "Send ALL to PS" opens all view images
- [ ] Works across Character, Gemini, Multiview, Weapon pages

---

## 20. Tooltips / Hover Text

- [ ] Every button, dropdown, toggle, tool, and section header has a tooltip
- [ ] All tooltips written in plain, artist-friendly language (no tech jargon)
- [ ] Lock icons explain: "AI won't change these fields... You can still edit them yourself."
- [ ] ON/OFF toggles explain: "This section is ON — its info will shape your generated images."
- [ ] Inpainting tools explain what they do + keyboard shortcuts
- [ ] Tag pickers show prompt text + "Right-click for more options"

---

*End of checklist — 20 sections, ~180 items*
