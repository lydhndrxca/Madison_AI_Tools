"""AI UI Lab API routes — UI element generation (buttons, icons, scrollbars, fonts, numbers)."""

from __future__ import annotations

import asyncio
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np

from fastapi import APIRouter
from pydantic import BaseModel, Field

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)

# ---------------------------------------------------------------------------
# Domain data (ported from AI_UI_Lab spritegen app.py / ui_main.py)
# ---------------------------------------------------------------------------

ELEMENT_TYPES = ["button", "icon", "scrollbar", "font", "number"]

BUTTON_SHAPES = [
    "auto", "rectangle", "rounded_rectangle", "square",
    "circle", "pill", "diamond", "hexagon", "triangle",
]

BORDER_STYLES = ["auto", "thin", "medium", "thick", "none"]

TEXT_SIZES = ["auto", "small", "medium", "large"]

SCROLLBAR_COMPONENTS = ["track", "thumb", "arrows"]

SCROLLBAR_ORIENTATIONS = ["vertical", "horizontal"]

DEFAULT_FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DEFAULT_NUMBER_CHARS = "0123456789"


# ---------------------------------------------------------------------------
# Chroma key background removal
# ---------------------------------------------------------------------------

def _chroma_key_to_alpha(img, green=(0, 255, 0), threshold=50, min_green=70):
    """Remove chroma green background, converting it to transparency."""
    import numpy as np
    from PIL import Image

    arr = np.array(img.convert("RGBA"), dtype=np.float32)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

    gr, gg, gb = float(green[0]), float(green[1]), float(green[2])
    dist = np.sqrt((r - gr) ** 2 + (g - gg) ** 2 + (b - gb) ** 2)
    is_green = (dist < threshold) & (arr[:, :, 1] > min_green)

    a[is_green] = 0
    arr[:, :, 3] = a
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def _flood_fill_transparent(img, tolerance=18):
    """Flood fill from corners to make near-green border pixels transparent."""
    import numpy as np
    from PIL import Image
    from collections import deque

    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()

    corners = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    for cy, cx in corners:
        if arr[cy, cx, 3] == 0:
            queue.append((cy, cx))
            visited[cy, cx] = True

    while queue:
        y, x = queue.popleft()
        for ny, nx in [(y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)]:
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                px = arr[ny, nx]
                if px[3] == 0:
                    visited[ny, nx] = True
                    queue.append((ny, nx))
                elif px[1] > 100 and px[1] > px[0] + tolerance and px[1] > px[2] + tolerance:
                    arr[ny, nx, 3] = 0
                    visited[ny, nx] = True
                    queue.append((ny, nx))

    return Image.fromarray(arr, "RGBA")


def _remove_element_background(img):
    """Full chroma key removal pipeline for single elements."""
    img = _chroma_key_to_alpha(img, green=(0, 255, 0), threshold=50, min_green=70)
    img = _flood_fill_transparent(img, tolerance=18)
    return img


def _is_chroma_greenish(r: float, g: float, b: float, *, strict_dist: float) -> bool:
    """True if pixel reads as chroma / spill green (not neutral gray metal)."""
    dist = (r - 0.0) ** 2 + (g - 255.0) ** 2 + (b - 0.0) ** 2
    if dist < strict_dist * strict_dist:
        return True
    # Anti-aliased / slightly off #00FF00 lime spill
    if g > max(r, b) + 18 and g > 58 and r < 145 and b < 145:
        mid = (r + g + b) / 3.0
        if abs(r - mid) < 22 and abs(g - mid) < 22 and abs(b - mid) < 22 and mid > 45:
            return False
        return True
    return False


def _flood_clear_green_from_edges_rgba(arr) -> None:
    """BFS from image border: clear alpha for chroma-green regions connected to outside (in-place on arr RGBA uint8)."""
    import numpy as np
    from collections import deque

    h, w = arr.shape[:2]
    strict = 100.0
    reachable = np.zeros((h, w), dtype=bool)
    q: deque = deque()

    def try_seed(y: int, x: int) -> None:
        if y < 0 or y >= h or x < 0 or x >= w or reachable[y, x]:
            return
        r, g, b, a = float(arr[y, x, 0]), float(arr[y, x, 1]), float(arr[y, x, 2]), int(arr[y, x, 3])
        if a < 12 or _is_chroma_greenish(r, g, b, strict_dist=strict):
            reachable[y, x] = True
            q.append((y, x))

    for x in range(w):
        try_seed(0, x)
        try_seed(h - 1, x)
    for y in range(h):
        try_seed(y, 0)
        try_seed(y, w - 1)

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if ny < 0 or ny >= h or nx < 0 or nx >= w or reachable[ny, nx]:
                continue
            r, g, b, a = float(arr[ny, nx, 0]), float(arr[ny, nx, 1]), float(arr[ny, nx, 2]), int(arr[ny, nx, 3])
            if a < 12 or _is_chroma_greenish(r, g, b, strict_dist=strict):
                reachable[ny, nx] = True
                q.append((ny, nx))

    arr[reachable, 3] = 0


def _chroma_key_grid_pass(img, *, threshold: float, min_green: float):
    """Slightly looser chroma for grid cells (AI rarely hits exact #00FF00)."""
    import numpy as np
    from PIL import Image

    arr = np.array(img.convert("RGBA"), dtype=np.float32)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    gr, gg, gb = 0.0, 255.0, 0.0
    dist = np.sqrt((r - gr) ** 2 + (g - gg) ** 2 + (b - gb) ** 2)
    is_green = (dist < threshold) & (g > min_green)
    a = np.where(is_green, 0, a)
    arr[:, :, 3] = a
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def _defringe_green_edges(img, neighbor_transparent_lt: int = 38, green_tint_min: int = 18):
    """Remove thin green halos: opaque pixels that are mostly green and border transparency."""
    import numpy as np
    from PIL import Image

    arr = np.array(img.convert("RGBA"), dtype=np.int16)
    h, w = arr.shape[:2]
    a = arr[:, :, 3].copy()
    for y in range(h):
        for x in range(w):
            if a[y, x] < 40:
                continue
            r, g, b = int(arr[y, x, 0]), int(arr[y, x, 1]), int(arr[y, x, 2])
            if g <= max(r, b) + green_tint_min:
                continue
            transparent_neighbors = 0
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if ny < 0 or ny >= h or nx < 0 or nx >= w:
                    transparent_neighbors += 1
                elif arr[ny, nx, 3] < neighbor_transparent_lt:
                    transparent_neighbors += 1
            if transparent_neighbors >= 2:
                a[y, x] = 0
    arr[:, :, 3] = np.clip(a, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def _remove_grid_cell_background(img):
    """Strong chroma + edge flood + defringe so grid cells lose #00FF00 blobs and outlines."""
    from PIL import Image

    img = _chroma_key_grid_pass(img, threshold=115, min_green=35)
    arr = np.array(img.convert("RGBA"), dtype=np.uint8)
    _flood_clear_green_from_edges_rgba(arr)
    img = Image.fromarray(arr, "RGBA")
    img = _chroma_key_grid_pass(img, threshold=95, min_green=45)
    img = _flood_fill_transparent(img, tolerance=32)
    img = _defringe_green_edges(img)
    return img


# ---------------------------------------------------------------------------
# Prompt building helpers
# ---------------------------------------------------------------------------

CHROMA_BG = (
    "BACKGROUND: The background MUST be a perfectly solid, uniform, "
    "flat chroma green — exactly #00FF00 (RGB 0,255,0). "
    "Do NOT use a checkerboard pattern, do NOT use transparency, "
    "do NOT use any gradient or texture on the background. "
    "The entire background area must be one single flat chroma green #00FF00. "
    "Only the element itself should have detail; everything else is flat green."
)

# No extra “plaque” / picture-frame around the whole asset (common model mistake).
NO_OUTER_SPRITE_FRAME = (
    "NO OUTER BORDER / FRAME: Do NOT add a separate enclosing border, picture frame, thick outer stroke, "
    "double-outline box, drop-shadow panel, or decorative rim around the entire graphic before the chroma green. "
    "The keyed background must meet the OUTERMOST silhouette of the control or icon directly — "
    "no halo ring sitting between the art and the green void. "
    "Internal bevels, inset panels, and control chrome that are part of the widget shape are OK."
)


def _build_button_blocking(shape: str, border: str, add_icon: bool,
                            add_text: bool, text_size: str) -> str:
    parts: list[str] = []
    shape_map = {
        "rectangle": "The button shape must be a rectangle.",
        "rounded_rectangle": "The button shape must be a rounded rectangle with smooth corners.",
        "square": "The button shape must be a perfect square.",
        "circle": "The button shape must be a circle or oval.",
        "pill": "The button shape must be a pill / capsule (fully rounded ends).",
        "diamond": "The button shape must be a diamond (rotated square).",
        "hexagon": "The button shape must be a hexagon.",
        "triangle": "The button shape must be a triangle.",
    }
    if shape in shape_map:
        parts.append(shape_map[shape])
    if border != "auto":
        parts.append(f"Border thickness: {border}.")
    if border == "none":
        parts.append("No visible border around the button.")
    if add_icon:
        parts.append("Include an icon graphic area on the button.")
    if add_text:
        parts.append("Include a clear, centered text label zone on the button.")
        if text_size != "auto":
            parts.append(f"Text/label size should be {text_size} relative to button dimensions.")
    else:
        parts.append(
            "CRITICAL: Do NOT include ANY text, labels, letters, numbers, words, "
            "or typographic elements on this button. The button surface must be "
            "purely graphical with NO text whatsoever."
        )
    return " ".join(parts)


def _extract_quoted_text(text: str) -> str:
    return " ".join(re.findall(r'"([^"]+)"', text))


def _build_ui_prompt(
    element_type: str,
    user_prompt: str,
    gen_w: int = 1024,
    gen_h: int = 1024,
    component: str = "",
    reenvision: bool = False,
    strict_adherence: bool = False,
    has_ref: bool = False,
    has_style_lib: bool = False,
    style_guidance: str = "",
    button_shape: str = "auto",
    border_style: str = "auto",
    add_icon: bool = False,
    add_text: bool = True,
    text_size: str = "auto",
    scrollbar_orientation: str = "vertical",
    add_color: bool = False,
    no_color: bool = False,
) -> str:
    """Build the full text prompt for UI element generation."""
    quoted = _extract_quoted_text(user_prompt)

    if element_type == "button":
        blocking = _build_button_blocking(button_shape, border_style, add_icon, add_text, text_size)
        base = (
            f"You are a UI button designer. Generate a high-quality, standalone UI button "
            f"at {gen_w}x{gen_h} pixels. The button should be large and prominent, "
            "filling most of the canvas but leaving a thin margin of green background "
            "around all edges (about 3-5% padding on each side). "
            "Do NOT let the button touch the image edges. "
            "Include appropriate visual details: border, shadow, gradient, highlight, "
            "and surface texture at full resolution. "
            "This must look like a polished, production-ready game/app UI button.\n"
            + CHROMA_BG
        )
        if blocking:
            base += f"\nSTRUCTURAL LAYOUT: {blocking}"
        if quoted and add_text:
            base += f'\nRender the label text "{quoted}" centered on the button face.'

    elif element_type == "icon":
        base = (
            f"You are a UI icon designer. Generate a single, standalone UI icon "
            f"at {gen_w}x{gen_h} pixels. The icon must be centered and large, "
            "filling most of the canvas but leaving a thin margin of green background "
            "around all edges (about 3-5% padding on each side). "
            "Do NOT let the icon touch the image edges. "
            "Crisp, high-resolution, detailed artwork. "
            "No surrounding scene, no text, no extra elements — just the icon. "
            "NO outer frame, NO square plaque, NO thick stroke boxing the icon — only the glyph or graphic. "
            "This must look like a polished, production-ready game/app UI icon.\n"
            + CHROMA_BG
        )

    elif element_type == "scrollbar":
        comp_desc = {
            "track": (
                f"scrollbar track / rail background ({scrollbar_orientation}). "
                "This is the long groove that the thumb slides along. "
                "Generate it as a single piece, large and centered with a thin green margin."
            ),
            "thumb": (
                f"scrollbar thumb / draggable handle ({scrollbar_orientation}). "
                "This is the grabbable piece the user drags to scroll. "
                "Generate it isolated, large and centered with a thin green margin."
            ),
            "arrows": (
                f"scrollbar arrow button ({scrollbar_orientation}). "
                "This is one of the end-cap buttons (up/down or left/right). "
                "Generate a single arrow button, large and centered with a thin green margin."
            ),
        }
        desc = comp_desc.get(component, comp_desc["track"])
        base = (
            f"You are a UI scrollbar designer. Generate a {desc} "
            f"at {gen_w}x{gen_h} pixels. "
            "Crisp, detailed, production-ready UI artwork. "
            "NO separate outer picture-frame or box stroke around the whole component — green meets the widget edge. "
            "This is one component piece of a scrollbar widget.\n"
            + CHROMA_BG
        )

    elif element_type in ("font", "number"):
        char = component or "A"
        kind = "letter" if element_type == "font" else "digit"
        base = (
            f"You are a professional typographic / font designer. "
            f"Generate a single large stylized {kind} character '{char}' "
            f"at {gen_w}x{gen_h} pixels.\n"
            "CRITICAL RULES:\n"
            f"- The character '{char}' must be the ONLY element in the image.\n"
            "- It must be perfectly centered both horizontally and vertically.\n"
            "- It must fill approximately 80% of the canvas height.\n"
            "- Use a consistent, decorative, game-UI-ready font style.\n"
            "- The character should have clear, crisp edges with "
            "appropriate bevels, gradients, outlines, or textures that "
            "make it look like a polished game/app typeface.\n"
            "- NO other text, NO other elements, NO scene, NO background objects.\n"
            + CHROMA_BG
        )

    else:
        base = (
            f"Generate a UI element at {gen_w}x{gen_h} pixels. "
            "The element should be large and centered but must NOT touch the image edges — "
            "leave a thin green margin around all sides.\n"
            + CHROMA_BG
        )

    # Style/content reference rules
    if has_ref and reenvision:
        style_content_rule = (
            "RE-ENVISION MODE:\n"
            "The 'User_reference' image shows the SUBJECT you must work with.\n"
            "Study what it depicts — its concept, theme, and character — then CREATIVELY "
            "REIMAGINE it in the art style of the Style/Trained reference images.\n\n"
            "DO NOT just copy the reference. Instead, create a fresh interpretation:\n"
            "  - Same general subject / concept\n"
            "  - DIFFERENT pose, angle, framing, expression, or details each time\n"
            "  - Fully redrawn in the style of the Style/Trained references\n"
            "  - Add your own creative flair\n\n"
            "Think of it as: 'an artist saw this reference, got inspired, and drew their own version.'\n"
            "No watermark."
        )
    elif has_ref and strict_adherence:
        style_content_rule = (
            "REMAKE MODE (strict — same aspect ratio & general feel, new visual flavor):\n"
            "Treat User_reference (last image before this prompt) as the asset to REMAKE, not a loose suggestion.\n\n"
            "LOCK IN (do not change):\n"
            "- The EXACT same aspect ratio and overall canvas proportions as User_reference.\n"
            "- The same general 'read': how the graphic occupies the frame, margin/padding rhythm, and layout skeleton "
            "(bands, blocks, negative space, major shapes).\n"
            "- The same silhouette and information hierarchy — what is foreground vs background structure.\n\n"
            "CHANGE (visual flavor only):\n"
            "- Re-render in the art direction from USER DIRECTION and from Style/Trained reference images: "
            "palette, line weight, shading, texture, era, polish, and stylistic treatment.\n"
            "- Think: 'the same icon layout and proportions, but art-directed with a new look.'\n\n"
            "FORBIDDEN: Different aspect ratio, stretched proportions, a new composition template, or unrelated content.\n"
            "No watermark."
        )
    elif has_ref:
        style_content_rule = (
            "REFERENCE IMAGES — READ CAREFULLY:\n"
            "Two kinds of reference images are provided:\n\n"
            "1. 'User_reference' = CONTENT reference.\n"
            "   It shows the KIND of element to generate. Follow its subject, shape, "
            "composition, and proportions closely.\n\n"
            "2. 'Style' / 'Trained' images = STYLE references.\n"
            "   These define the MANDATORY visual style you MUST use. "
            "Carefully study and replicate their art style, color palette, line weight, "
            "shading technique, texture, and overall aesthetic.\n\n"
            "FORBIDDEN: Do NOT copy any specific subjects, characters, symbols, emblems, "
            "creatures, text, or motifs from the style references into your output.\n\n"
            "SYNTHESIS: Take the SUBJECT from the user reference and RE-DRAW it "
            "in the EXACT STYLE of the style references.\n"
            "No watermark."
        )
    else:
        style_content_rule = (
            "STYLE vs CONTENT — READ CAREFULLY:\n"
            "The Style reference images are a STYLE PALETTE — treat them as an abstract "
            "mood board, NOT as content to reproduce.\n\n"
            "EXTRACT from style references: rendering technique, color palette, line weight, "
            "shading technique, texture, level of detail, overall aesthetic mood.\n\n"
            "DO NOT TRANSFER from style references: any subjects, logos, symbols, scenes, "
            "compositions, backgrounds, or text.\n\n"
            "You MUST generate EXACTLY what the user describes and NOTHING ELSE.\n"
            "No watermark."
        )

    # Variety rule
    if has_ref and reenvision:
        variety_rule = (
            "VARIETY: Each generation must be a DIFFERENT creative take on the reference subject. "
            "Change the angle, pose, proportions, details, or framing significantly."
        )
    elif has_ref and strict_adherence:
        variety_rule = (
            "VARIETY: Each generation is another REMAKE — same aspect ratio and layout read as User_reference, "
            "but USER DIRECTION (and style refs) may shift nuance of the visual flavor (e.g. crunchier, softer, flatter)."
        )
    elif has_ref:
        variety_rule = (
            "VARIETY: Create a creative variation of the user reference element. "
            "Stay FAITHFUL to the style references — same art style, same palette."
        )
    else:
        variety_rule = (
            "VARIETY: Create a unique, creative variation — each generation should produce "
            "a distinctly different design while maintaining the same element type and style."
        )

    parts: list[str] = []

    # Style adherence priority block
    if has_style_lib:
        parts.append(
            "*** HIGHEST PRIORITY — STYLE ADHERENCE ***\n"
            "BEFORE generating anything, carefully study ALL of the provided Style/Trained "
            "reference images. Your output image MUST be rendered in the SAME art style.\n"
            "Specifically match: rendering technique, color palette, line work, shading, "
            "level of detail, and texture. Your output must look like it belongs in the "
            "SAME game/project as the reference images."
        )
    if style_guidance.strip():
        parts.append(f"STYLE GUIDANCE FROM THE ART DIRECTOR:\n{style_guidance.strip()}")

    parts.append(style_content_rule)
    parts.append(NO_OUTER_SPRITE_FRAME)

    parts.append(
        f"ELEMENT SPEC: You are generating a {element_type}"
        + (f" ({component})" if component else "") + " element.\n"
        f"Output MUST be {gen_w}x{gen_h} pixels. The artwork should be large and centered "
        "but must NOT touch the image edges — leave a thin green margin around all sides.\n\n"
        + base + "\n\n"
        "OUTPUT: exactly ONE image.\n"
        + variety_rule
    )

    if add_color:
        parts.append(
            "COLOR OVERRIDE: The output MUST be rendered in FULL COLOR. Use a rich, "
            "vibrant color palette. Do NOT produce grayscale or monochrome output."
        )
    elif no_color:
        parts.append(
            "COLOR OVERRIDE: The output MUST be rendered in GRAYSCALE / MONOCHROME only. "
            "Do NOT use any chromatic color — only shades of black, white, and gray."
        )

    if user_prompt.strip():
        parts.append(f"USER DIRECTION:\n{user_prompt.strip()}")

    if has_style_lib:
        parts.append(
            "FINAL REMINDER: Your output MUST match the art style of the provided "
            "Style/Trained reference images. The rendering technique, color palette, and "
            "level of detail must be consistent with those references."
        )

    return "\n\n".join(parts)


def _build_grid_prompt(
    element_type: str,
    user_prompt: str,
    cell_w: int = 256,
    cell_h: int = 256,
    reenvision: bool = False,
    strict_adherence: bool = False,
    has_ref: bool = False,
    has_style_lib: bool = False,
    style_guidance: str = "",
    add_color: bool = False,
    no_color: bool = False,
) -> str:
    """Build prompt for 4x4 grid sprite sheet generation.

    Must stay aligned with _build_ui_prompt: same reference order (ref tabs, fusion, custom,
    then User_reference) and style-library priority so grid mode does not ignore refs/style.
    """
    canvas_w = cell_w * 4
    canvas_h = cell_h * 4

    parts: list[str] = []

    if has_ref or has_style_lib or (style_guidance and style_guidance.strip()):
        parts.append(
            "IMAGES BEFORE THIS TEXT (same order as single UI element generation):\n"
            "1) Ref-tab images (optional, extra context)\n"
            "2) Style Fusion slot images (optional, style)\n"
            "3) Custom-section images (optional)\n"
            "4) Dedicated REFERENCE IMAGE slot = User_reference (content / layout / motif — "
            "MUST visibly inform every cell when provided)\n\n"
            "Earlier images define STYLE when present; User_reference defines WHAT to draw "
            "(shape language, proportions, composition, motif). Even abstract references "
            "constrain rhythm, banding, and geometry — do not ignore them."
        )

    if has_style_lib:
        parts.append(
            "*** HIGHEST PRIORITY — STYLE ADHERENCE (4×4 SHEET) ***\n"
            "Study ALL Style/Trained reference images before this prompt. "
            "EVERY ONE of the 16 cells MUST match the same art style: rendering technique, "
            "palette, line weight, shading, texture, and level of detail as those references. "
            "The sprite sheet must look like it came from the same UI kit as the style references."
        )

    if style_guidance.strip():
        parts.append(f"STYLE GUIDANCE FROM THE ART DIRECTOR:\n{style_guidance.strip()}")

    grid_header = (
        f"4\u00d74 sprite sheet: {canvas_w}x{canvas_h}px image, "
        f"16 cells of {cell_w}x{cell_h}px each (invisible borders — draw continuously; the model mentally tiles 4×4).\n"
        f"Background: solid chroma green #00FF00 everywhere outside the single asset in each cell.\n"
        f"Each cell contains EXACTLY ONE {element_type} only — one centered graphic, no grid lines drawn on the image."
    )

    if has_ref and reenvision:
        parts.append(
            f"{grid_header}\n"
            "RE-ENVISION MODE: User_reference (last image before this text) is the subject baseline. "
            "Each of the 16 cells must be a DIFFERENT creative reimagining of that subject in the "
            "mandatory style — vary pose, angle, proportions, and details. "
            "Do NOT copy the reference pixel-for-pixel; stay faithful to its idea and to style references."
        )
    elif has_ref and strict_adherence:
        parts.append(
            f"{grid_header}\n"
            "REMAKE MODE (strict): User_reference defines ONE layout template and aspect logic. "
            "Every cell must keep the SAME aspect ratio and general feel (how the graphic sits in the cell, same skeleton).\n"
            "Across the 16 cells, vary only the VISUAL FLAVOR per USER DIRECTION — different stylistic treatments of the "
            "same remake idea (palette, line, texture, era), not 16 different icons with different proportions or subjects.\n"
            "Style/Trained references + USER DIRECTION supply the new look; User_reference supplies size/layout DNA."
        )
    elif has_ref:
        parts.append(
            f"{grid_header}\n"
            "USER_REFERENCE (last image before this text) is mandatory visual context for CONTENT. "
            "All 16 icons must clearly descend from it: same graphic vocabulary, layout logic, "
            "and motif family (e.g. stripes, bands, grid-of-squares, proportions). "
            "Each cell must still be a distinct variation (different treatment, angle, or detail). "
            "If User_reference is minimal or abstract, echo its geometry and composition — do not "
            "replace it with unrelated subjects like crosses, pills, or hearts unless the user text explicitly asks."
        )
    else:
        parts.append(
            f"{grid_header}\n"
            "IMPORTANT: All 16 must be DIFFERENT — vary the shape, size, angle, detail, and design. "
            "No two cells should look the same."
        )

    parts.append(
        "CRITICAL — ONE ASSET PER CELL (all 16 cells):\n"
        f"- Each cell is {cell_w}×{cell_h} px. Draw EXACTLY ONE single {element_type} in each cell — "
        "one unified silhouette, centered, with chroma green margin around it.\n"
        "- FORBIDDEN: two or more separate widgets in one cell; stacked duplicate bars or buttons; "
        "an upper bar plus a lower bar; side-by-side twins; mini before/after pairs; contact-sheet layouts inside one cell.\n"
        "- FORBIDDEN: repeating the same element twice vertically or horizontally inside one cell.\n"
        "- If the target is a wide button or bar, it is still ONE control: one horizontal strip, one bevel system — "
        "not two parallel strips.\n"
        "- Count mentally: 16 cells = 16 distinct single graphics, never 32+ sub-widgets on the sheet."
    )

    parts.append(
        "CHROMA / KEYING: Only the EMPTY background is flat #00FF00. Do NOT put that green (or bright lime) ON the "
        f"{element_type} — no green rims, outlines, inner glows, shadows, or anti-alias fringe in green. "
        "Use grays, silvers, or darks at UI edges so post-processing can key out only the void behind the asset."
    )
    parts.append(NO_OUTER_SPRITE_FRAME)

    if user_prompt.strip():
        parts.append(f"USER DIRECTION:\n{user_prompt.strip()}")

    if has_style_lib:
        parts.append(
            "FINAL REMINDER: Output MUST match the art style of the provided Style/Trained "
            "reference images in every cell."
        )

    if add_color:
        parts.append("Use FULL COLOR even if style references are monochrome.")
    elif no_color:
        parts.append("GRAYSCALE only — no chromatic color, only black/white/gray shades.")

    return "\n\n".join(parts)


def _build_text_overlay_prompt(text: str, w: int, h: int) -> str:
    return (
        f"You are looking at a UI element image ({w}x{h} px). "
        f'Add the text "{text}" onto this element. '
        "The text must be centered, clearly legible, and styled to match "
        "the element's visual design (color, theme, contrast). "
        "Do NOT change the element's shape, background, or overall design — "
        "only add the text. Return the complete image with text rendered on it."
    )


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class UIGenRequest(BaseModel):
    element_type: str = "button"
    prompt: str = ""
    count: int = 1
    output_width: int = 1024
    output_height: int = 1024
    use_grid: bool = False
    cell_width: int = 256
    cell_height: int = 256
    reference_image_b64: Optional[str] = None
    ref_images: Optional[list[str]] = None
    reenvision: bool = False
    match_ref_dims: bool = False
    strict_reference_adherence: bool = False
    add_color: bool = False
    no_color: bool = False
    button_shape: str = "auto"
    border_style: str = "auto"
    add_icon: bool = False
    add_text: bool = True
    text_size: str = "auto"
    scrollbar_components: Optional[list[str]] = None
    scrollbar_orientation: str = "vertical"
    font_chars: str = ""
    style_guidance: str = ""
    model_id: Optional[str] = None
    style_context: Optional[str] = None
    fusion_context: Optional[str] = None
    fusion_image_1_b64: Optional[str] = None
    fusion_image_2_b64: Optional[str] = None
    edit_prompt: Optional[str] = None
    custom_sections_context: Optional[str] = None
    custom_section_images: Optional[list[str]] = None


class UIGenerateRequest(UIGenRequest):
    pass


class UIScrollbarGenerateRequest(UIGenRequest):
    pass


class UIFontGenerateRequest(UIGenRequest):
    pass


class UIGridGenerateRequest(UIGenRequest):
    pass


class UIGenSingleResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class UIGenGridResponse(BaseModel):
    cells: Optional[list[str]] = None
    full_grid_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    cell_width: int = 0
    cell_height: int = 0
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Sync workers
# ---------------------------------------------------------------------------

def _do_generate_single(req: UIGenRequest) -> UIGenSingleResponse:
    """Generate a single UI element variant, or edit an existing one if edit_prompt is set."""
    api_key = core.get_api_key()
    if not api_key:
        return UIGenSingleResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    # Edit mode: send the reference image + edit prompt directly
    if req.edit_prompt and req.reference_image_b64:
        edit_text = req.edit_prompt
        if req.custom_sections_context:
            edit_text = f"{edit_text}\n\n--- Custom Directions ---\n{req.custom_sections_context}"
        edit_contents: list = [core.b64_to_image(req.reference_image_b64)]
        for b64 in (req.custom_section_images or []):
            if b64:
                edit_contents.append(core.b64_to_image(b64))
        edit_contents.append(edit_text)
        try:
            result = core.gemini_generate_image(
                api_key, edit_contents, aspect_ratio="1:1", image_size="4K",
                cancel_event=cancel, model_id=req.model_id,
            )
        except RuntimeError as e:
            return UIGenSingleResponse(error=str(e))
        finally:
            release_cancel_event(cancel)
        if result is None:
            return UIGenSingleResponse(error="Edit generation failed")
        result = _remove_element_background(result)
        return UIGenSingleResponse(
            image_b64=core.image_to_b64(result),
            width=result.width,
            height=result.height,
        )

    has_ref = req.reference_image_b64 is not None
    has_style = bool(req.style_context or req.fusion_context or req.style_guidance)

    style_guidance_combined = ""
    if req.style_context:
        style_guidance_combined += req.style_context
    if req.fusion_context:
        style_guidance_combined += f"\n{req.fusion_context}" if style_guidance_combined else req.fusion_context
    if req.style_guidance:
        style_guidance_combined += f"\n{req.style_guidance}" if style_guidance_combined else req.style_guidance

    prompt = _build_ui_prompt(
        element_type=req.element_type,
        user_prompt=req.prompt,
        gen_w=req.output_width,
        gen_h=req.output_height,
        component="",
        reenvision=req.reenvision,
        strict_adherence=req.strict_reference_adherence,
        has_ref=has_ref,
        has_style_lib=has_style,
        style_guidance=style_guidance_combined,
        button_shape=req.button_shape,
        border_style=req.border_style,
        add_icon=req.add_icon,
        add_text=req.add_text,
        text_size=req.text_size,
        scrollbar_orientation=req.scrollbar_orientation,
        add_color=req.add_color,
        no_color=req.no_color,
    )

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    contents: list = []
    if req.ref_images:
        for b64 in req.ref_images:
            if b64:
                contents.append(core.b64_to_image(b64))
    for b64 in [req.fusion_image_1_b64, req.fusion_image_2_b64]:
        if b64:
            contents.append(core.b64_to_image(b64))
    for b64 in (req.custom_section_images or []):
        if b64:
            contents.append(core.b64_to_image(b64))
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    contents.append(f"{prompt}\n\nGenerate this UI element.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="1:1", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return UIGenSingleResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return UIGenSingleResponse(error="Generation failed")

    # Text overlay pass for buttons with quoted text
    quoted = _extract_quoted_text(req.prompt)
    if quoted and req.element_type == "button" and req.add_text:
        try:
            overlay_prompt = _build_text_overlay_prompt(quoted, result.width, result.height)
            overlay_contents: list = [result, overlay_prompt]
            cancel2 = reset_cancel_event()
            try:
                overlay_result = core.gemini_generate_image(
                    api_key, overlay_contents, aspect_ratio="1:1", image_size="4K",
                    cancel_event=cancel2, model_id=req.model_id,
                )
                if overlay_result:
                    result = overlay_result
            finally:
                release_cancel_event(cancel2)
        except Exception:
            pass

    result = _remove_element_background(result)

    core.save_generated_image(
        result, "AI UILab",
        view_name=req.element_type,
        generation_type="generate",
        metadata={"element_type": req.element_type, "prompt": req.prompt[:200]},
    )

    return UIGenSingleResponse(
        image_b64=core.image_to_b64(result),
        width=result.width,
        height=result.height,
    )


def _do_generate_scrollbar_component(req: UIGenRequest, component: str) -> UIGenSingleResponse:
    """Generate a single scrollbar component."""
    api_key = core.get_api_key()
    if not api_key:
        return UIGenSingleResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    has_ref = req.reference_image_b64 is not None
    has_style = bool(req.style_context or req.fusion_context or req.style_guidance)

    style_guidance_combined = ""
    if req.style_context:
        style_guidance_combined += req.style_context
    if req.fusion_context:
        style_guidance_combined += f"\n{req.fusion_context}" if style_guidance_combined else req.fusion_context
    if req.style_guidance:
        style_guidance_combined += f"\n{req.style_guidance}" if style_guidance_combined else req.style_guidance

    prompt = _build_ui_prompt(
        element_type="scrollbar",
        user_prompt=req.prompt,
        gen_w=req.output_width,
        gen_h=req.output_height,
        component=component,
        reenvision=req.reenvision,
        strict_adherence=req.strict_reference_adherence,
        has_ref=has_ref,
        has_style_lib=has_style,
        style_guidance=style_guidance_combined,
        scrollbar_orientation=req.scrollbar_orientation,
        add_color=req.add_color,
        no_color=req.no_color,
    )

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    contents: list = []
    if req.ref_images:
        for b64 in req.ref_images:
            if b64:
                contents.append(core.b64_to_image(b64))
    for b64 in [req.fusion_image_1_b64, req.fusion_image_2_b64]:
        if b64:
            contents.append(core.b64_to_image(b64))
    for b64 in (req.custom_section_images or []):
        if b64:
            contents.append(core.b64_to_image(b64))
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    contents.append(f"{prompt}\n\nGenerate this scrollbar component.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="1:1", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return UIGenSingleResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return UIGenSingleResponse(error="Generation failed")

    result = _remove_element_background(result)

    core.save_generated_image(
        result, "AI UILab",
        view_name=f"scrollbar_{component}",
        generation_type="generate",
        metadata={"element_type": "scrollbar", "component": component, "prompt": req.prompt[:200]},
    )

    return UIGenSingleResponse(
        image_b64=core.image_to_b64(result),
        width=result.width,
        height=result.height,
    )


def _do_generate_char(req: UIGenRequest, char: str) -> UIGenSingleResponse:
    """Generate a single font/number character."""
    api_key = core.get_api_key()
    if not api_key:
        return UIGenSingleResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    has_ref = req.reference_image_b64 is not None
    has_style = bool(req.style_context or req.fusion_context or req.style_guidance)

    style_guidance_combined = ""
    if req.style_context:
        style_guidance_combined += req.style_context
    if req.fusion_context:
        style_guidance_combined += f"\n{req.fusion_context}" if style_guidance_combined else req.fusion_context
    if req.style_guidance:
        style_guidance_combined += f"\n{req.style_guidance}" if style_guidance_combined else req.style_guidance

    prompt = _build_ui_prompt(
        element_type=req.element_type,
        user_prompt=req.prompt,
        gen_w=req.output_width,
        gen_h=req.output_height,
        component=char,
        reenvision=req.reenvision,
        strict_adherence=req.strict_reference_adherence,
        has_ref=has_ref,
        has_style_lib=has_style,
        style_guidance=style_guidance_combined,
        add_color=req.add_color,
        no_color=req.no_color,
    )

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    contents: list = []
    if req.ref_images:
        for b64 in req.ref_images:
            if b64:
                contents.append(core.b64_to_image(b64))
    for b64 in [req.fusion_image_1_b64, req.fusion_image_2_b64]:
        if b64:
            contents.append(core.b64_to_image(b64))
    for b64 in (req.custom_section_images or []):
        if b64:
            contents.append(core.b64_to_image(b64))
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    contents.append(f"{prompt}\n\nGenerate this character glyph.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="1:1", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return UIGenSingleResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return UIGenSingleResponse(error="Generation failed")

    result = _remove_element_background(result)

    core.save_generated_image(
        result, "AI UILab",
        view_name=f"{req.element_type}_{char}",
        generation_type="generate",
        metadata={"element_type": req.element_type, "character": char, "prompt": req.prompt[:200]},
    )

    return UIGenSingleResponse(
        image_b64=core.image_to_b64(result),
        width=result.width,
        height=result.height,
    )


def _do_generate_grid(req: UIGenRequest) -> UIGenGridResponse:
    """Generate a 4x4 grid of UI elements and crop into individual cells."""
    from PIL import Image

    api_key = core.get_api_key()
    if not api_key:
        return UIGenGridResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    cell_w = req.cell_width or 256
    cell_h = req.cell_height or 256
    canvas_w = cell_w * 4
    canvas_h = cell_h * 4

    has_ref = req.reference_image_b64 is not None
    has_style = bool(req.style_context or req.fusion_context or req.style_guidance)
    style_guidance_combined = ""
    if req.style_context:
        style_guidance_combined += req.style_context
    if req.fusion_context:
        style_guidance_combined += f"\n{req.fusion_context}" if style_guidance_combined else req.fusion_context
    if req.style_guidance:
        style_guidance_combined += f"\n{req.style_guidance}" if style_guidance_combined else req.style_guidance

    prompt = _build_grid_prompt(
        element_type=req.element_type,
        user_prompt=req.prompt,
        cell_w=cell_w,
        cell_h=cell_h,
        reenvision=req.reenvision,
        strict_adherence=req.strict_reference_adherence,
        has_ref=has_ref,
        has_style_lib=has_style,
        style_guidance=style_guidance_combined,
        add_color=req.add_color,
        no_color=req.no_color,
    )

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    contents: list = []
    if req.ref_images:
        for b64 in req.ref_images:
            if b64:
                contents.append(core.b64_to_image(b64))
    for b64 in [req.fusion_image_1_b64, req.fusion_image_2_b64]:
        if b64:
            contents.append(core.b64_to_image(b64))
    for b64 in (req.custom_section_images or []):
        if b64:
            contents.append(core.b64_to_image(b64))
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    contents.append(f"{prompt}\n\nGenerate this 4x4 sprite sheet.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="1:1", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return UIGenGridResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return UIGenGridResponse(error="Generation failed")

    if result.size != (canvas_w, canvas_h):
        result = result.resize((canvas_w, canvas_h), Image.Resampling.LANCZOS)

    cells_b64: list[str] = []
    for row in range(4):
        for col in range(4):
            x1, y1 = col * cell_w, row * cell_h
            x2, y2 = x1 + cell_w, y1 + cell_h
            cell = result.crop((x1, y1, x2, y2)).copy()
            cell = _remove_grid_cell_background(cell)
            cells_b64.append(core.image_to_b64(cell))
            core.save_generated_image(
                cell, "AI UILab",
                view_name=f"grid_{row}_{col}",
                generation_type="grid",
                metadata={"element_type": req.element_type, "prompt": req.prompt[:200]},
            )

    return UIGenGridResponse(
        cells=cells_b64,
        full_grid_b64=core.image_to_b64(result),
        width=canvas_w,
        height=canvas_h,
        cell_width=cell_w,
        cell_height=cell_h,
    )


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=UIGenSingleResponse)
async def generate(req: UIGenerateRequest):
    """Generate a single UI element."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_generate_single, req)


@router.post("/generate-scrollbar", response_model=UIGenSingleResponse)
async def generate_scrollbar(req: UIScrollbarGenerateRequest, component: str = "track"):
    """Generate a single scrollbar component."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_generate_scrollbar_component, req, component)


@router.post("/generate-char", response_model=UIGenSingleResponse)
async def generate_char(req: UIFontGenerateRequest, char: str = "A"):
    """Generate a single font/number character."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_generate_char, req, char)


@router.post("/generate-grid", response_model=UIGenGridResponse)
async def generate_grid(req: UIGridGenerateRequest):
    """Generate a 4x4 grid of UI elements."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_generate_grid, req)


@router.get("/element-types")
async def get_element_types():
    """Return available element types and their configuration options."""
    return {
        "element_types": ELEMENT_TYPES,
        "button_shapes": BUTTON_SHAPES,
        "border_styles": BORDER_STYLES,
        "text_sizes": TEXT_SIZES,
        "scrollbar_components": SCROLLBAR_COMPONENTS,
        "scrollbar_orientations": SCROLLBAR_ORIENTATIONS,
    }


# ---------------------------------------------------------------------------
# Alpha border adjustment
# ---------------------------------------------------------------------------

def _shrink_alpha_border(img, pixels: int = 1):
    """Erode the alpha channel by N pixels to remove green fringe."""
    import numpy as np
    from PIL import Image, ImageFilter

    arr = np.array(img.convert("RGBA"))
    alpha = Image.fromarray(arr[:, :, 3], "L")
    for _ in range(abs(pixels)):
        if pixels > 0:
            alpha = alpha.filter(ImageFilter.MinFilter(3))
        else:
            alpha = alpha.filter(ImageFilter.MaxFilter(3))
    arr[:, :, 3] = np.array(alpha)
    zero_alpha = arr[:, :, 3] == 0
    arr[zero_alpha, 0] = 0
    arr[zero_alpha, 1] = 0
    arr[zero_alpha, 2] = 0
    return Image.fromarray(arr, "RGBA")


class AlphaTrimRequest(BaseModel):
    image_b64: str
    pixels: int = Field(default=1, ge=-20, le=20)


class UIEnhanceRequest(BaseModel):
    prompt: str = ""
    element_type: str = "button"
    button_shape: str = "auto"
    border_style: str = "auto"
    text_size: str = "auto"
    style_guidance: str = ""


class UIEnhanceResponse(BaseModel):
    prompt: Optional[str] = None
    error: Optional[str] = None


def _do_enhance_prompt(req: UIEnhanceRequest) -> UIEnhanceResponse:
    api_key = core.get_api_key()
    if not api_key:
        return UIEnhanceResponse(error="No API key")
    try:
        instruction = (
            "You are an expert UI/UX designer. The user has provided a prompt describing a UI element. "
            "Enhance and expand the prompt to be more vivid, detailed, and production-ready. "
            "Keep the same core concept but add specificity about visual style, colors, states, "
            "textures, lighting, materials, and micro-interactions.\n\n"
            f"Element type: {req.element_type}\n"
            f"Button shape: {req.button_shape}\n"
            f"Border style: {req.border_style}\n"
            f"Text size: {req.text_size}\n"
        )
        if req.style_guidance:
            instruction += f"Style guidance: {req.style_guidance}\n"
        instruction += (
            f"\nOriginal prompt:\n{req.prompt}\n\n"
            "Return ONLY valid JSON with one key:\n"
            '- "prompt": string (2-4 sentence enhanced prompt for the UI element)\n'
        )
        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [instruction])
        if data is None:
            return UIEnhanceResponse(error="No response from Gemini")
        return UIEnhanceResponse(prompt=data.get("prompt", req.prompt))
    except Exception as e:
        return UIEnhanceResponse(error=str(e))


@router.post("/enhance", response_model=UIEnhanceResponse)
async def enhance(body: UIEnhanceRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_enhance_prompt, body)


@router.post("/trim-alpha")
async def trim_alpha(req: AlphaTrimRequest):
    """Shrink (positive) or expand (negative) the alpha border by N pixels."""
    try:
        raw = req.image_b64.split(",", 1)[-1] if "," in req.image_b64 else req.image_b64
        img = core.b64_to_image(raw)
        result = _shrink_alpha_border(img, req.pixels)
        return {
            "image_b64": core.image_to_b64(result),
            "width": result.width,
            "height": result.height,
        }
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Alpha trim failed: {e}")
