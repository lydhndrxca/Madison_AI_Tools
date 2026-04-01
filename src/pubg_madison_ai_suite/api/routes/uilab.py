"""AI UI Lab API routes — UI element generation (buttons, icons, scrollbars, fonts, numbers)."""

from __future__ import annotations

import asyncio
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import numpy as np

from fastapi import APIRouter
from pydantic import BaseModel, Field

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)
log = logging.getLogger("uilab")


def _load_style_library_images(folder_name: str, max_images: int = 6) -> list:
    """Load actual images from a style library folder on disk.

    Returns a list of [label_text, PIL.Image, ...] suitable for prepending
    to Gemini contents so the model can visually reference the style.
    """
    from pubg_madison_ai_suite.api.routes.styles import _lib_dir, _image_files, _read_meta

    folder_path = _lib_dir() / folder_name
    if not folder_path.is_dir():
        return []

    meta = _read_meta(folder_name)
    disabled = set(meta.get("disabled_images", {}).get("__root__", []))

    image_paths = [p for p in _image_files(folder_path) if p.name not in disabled]
    if not image_paths:
        return []

    from PIL import Image
    contents: list = []
    contents.append(
        f"STYLE LIBRARY REFERENCE IMAGES (from folder \"{folder_name}\"):\n"
        "Study these images carefully. ALL generated output must match this visual style — "
        "same rendering technique, color palette, textures, level of detail, and artistic feel."
    )
    loaded = 0
    for p in image_paths[:max_images]:
        try:
            img = Image.open(p).convert("RGB")
            # Downscale large style images to save tokens
            if max(img.size) > 512:
                ratio = 512 / max(img.size)
                img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.Resampling.LANCZOS)
            contents.append(img)
            loaded += 1
        except Exception:
            continue
    if loaded:
        log.info("Loaded %d style library images from '%s'", loaded, folder_name)
    return contents

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


def _detect_grid_cells(img, expected_cols: int = 4, expected_rows: int = 4):
    """Auto-detect grid cell boundaries from an image with green (#00FF00) separators.

    Returns a list of (x1, y1, x2, y2) bounding boxes for each cell,
    row-major order. Falls back to uniform expected_cols × expected_rows
    if detection fails.
    """
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]

    # Green mask: pixels close to #00FF00
    g_mask = (arr[:, :, 0] < 80) & (arr[:, :, 1] > 180) & (arr[:, :, 2] < 80)

    # Find column separators: columns where >60% of pixels are green
    col_green = g_mask.mean(axis=0)
    threshold = 0.55

    # Find contiguous runs of green columns
    is_sep_col = col_green > threshold
    col_edges = [0]
    in_sep = False
    sep_start = 0
    for x in range(w):
        if is_sep_col[x] and not in_sep:
            in_sep = True
            sep_start = x
        elif not is_sep_col[x] and in_sep:
            in_sep = False
            mid = (sep_start + x) // 2
            if mid > 8 and mid < w - 8:
                col_edges.append(mid)
    col_edges.append(w)

    # Find row separators similarly
    row_green = g_mask.mean(axis=1)
    is_sep_row = row_green > threshold
    row_edges = [0]
    in_sep = False
    for y in range(h):
        if is_sep_row[y] and not in_sep:
            in_sep = True
            sep_start = y
        elif not is_sep_row[y] and in_sep:
            in_sep = False
            mid = (sep_start + y) // 2
            if mid > 8 and mid < h - 8:
                row_edges.append(mid)
    row_edges.append(h)

    # Filter out edges that are too close together (less than 5% of dimension)
    def filter_edges(edges, total):
        if len(edges) <= 2:
            return edges
        min_gap = total * 0.05
        filtered = [edges[0]]
        for e in edges[1:]:
            if e - filtered[-1] >= min_gap:
                filtered.append(e)
        if filtered[-1] != edges[-1]:
            filtered[-1] = edges[-1]
        return filtered

    col_edges = filter_edges(col_edges, w)
    row_edges = filter_edges(row_edges, h)

    num_cols = len(col_edges) - 1
    num_rows = len(row_edges) - 1

    # If detection found a reasonable grid, use it; otherwise fall back
    if num_cols < 2 or num_rows < 2 or num_cols > 8 or num_rows > 8:
        # Fallback to uniform grid
        num_cols = expected_cols
        num_rows = expected_rows
        cw = w // num_cols
        ch = h // num_rows
        cells = []
        for r in range(num_rows):
            for c in range(num_cols):
                cells.append((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        return cells

    cells = []
    for r in range(num_rows):
        for c in range(num_cols):
            cells.append((col_edges[c], row_edges[r], col_edges[c + 1], row_edges[r + 1]))
    return cells


def _trim_and_resize_cell(img, target_w: int, target_h: int):
    """Trim transparent/empty borders from a cell and resize to target dimensions."""
    from PIL import Image

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # Find the bounding box of non-transparent pixels
    bbox = img.getbbox()
    if bbox is None:
        return img.resize((target_w, target_h), Image.Resampling.LANCZOS)

    cropped = img.crop(bbox)

    # Resize to target dimensions, preserving aspect ratio within the target
    cw, ch = cropped.size
    target_aspect = target_w / max(1, target_h)
    crop_aspect = cw / max(1, ch)

    if abs(crop_aspect - target_aspect) < 0.1:
        return cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Fit within target, then place on transparent canvas
    if crop_aspect > target_aspect:
        new_w = target_w
        new_h = max(1, int(target_w / crop_aspect))
    else:
        new_h = target_h
        new_w = max(1, int(target_h * crop_aspect))

    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    ox = (target_w - new_w) // 2
    oy = (target_h - new_h) // 2
    canvas.paste(resized, (ox, oy))
    return canvas


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
    riff_mode: bool = False,
    **kwargs,
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

    elif element_type == "colorize":
        palette_note = ""
        if kwargs.get("has_color_palette"):
            palette_note = (
                "\n- A COLOR PALETTE reference image has been provided (separate from the source sketch). "
                "Use the hues, tones, and color relationships from that palette image to guide your "
                "colorization. Match the palette's mood and feeling while still keeping the source's "
                "structure intact.\n"
            )
        base = (
            f"You are an expert digital colorist. You are given a sketch, line art, or "
            f"monochrome image as the reference. Produce a FULL-COLOR version at "
            f"{gen_w}x{gen_h} pixels that faithfully preserves the original structure, "
            "proportions, linework, and composition — while adding a rich, professional "
            "color palette with natural shading, highlights, gradients, and material textures.\n\n"
            "CRITICAL RULES:\n"
            "- Do NOT alter the shape, pose, layout, or proportions of the input.\n"
            "- Do NOT add new elements, remove existing elements, or change the composition.\n"
            "- Do NOT simplify or re-draw — preserve the original detail level.\n"
            "- Apply color naturally based on what the subject depicts (skin tones for characters, "
            "metal for weapons, wood/stone for environments, etc.).\n"
            + palette_note +
            "- If a Style Library reference is provided, draw color palette and mood inspiration "
            "from it while keeping the original sketch's structure intact.\n"
            "- The result should look like a polished, production-ready colored version of the input.\n"
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
    if riff_mode and has_ref:
        style_content_rule = (
            "RIFF MODE — Faithful Variations:\n"
            "The 'User_reference' image is the ANCHOR. Study it carefully:\n"
            "- Its exact silhouette, proportions, aspect ratio, and spatial layout are SACRED.\n"
            "- Its visual identity (what it depicts, its function, its 'read') must be preserved.\n\n"
            "Your job: generate a VARIATION that keeps the heart and soul of the original "
            "while exploring a new creative direction guided by the user prompt.\n\n"
            "Rules:\n"
            "- MATCH the aspect ratio and general dimensions of the reference.\n"
            "- KEEP the same silhouette, pose/layout, and information hierarchy.\n"
            "- PRESERVE the functional identity (a health bar stays a health bar, a sword stays a sword).\n"
            "- VARY: artistic treatment, detail work, surface textures, embellishments, color palette "
            "(unless color mode is constrained), decorative elements, stylistic era.\n"
            "- If a Style Library is provided, adopt its visual language while keeping the reference structure.\n"
            "- The result should look like 'the same icon/element, reimagined by a different artist.'\n"
            "No watermark."
        )
    elif has_ref and reenvision:
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
    if riff_mode and has_ref:
        variety_rule = (
            "VARIETY: Each generation must be a DISTINCT variation — same core structure and identity, "
            "but different artistic treatment, embellishments, textures, or color palette. "
            "Think: 'the same element as drawn by a different artist in a different mood.'"
        )
    elif has_ref and reenvision:
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
    grid_cols: int = 4,
    grid_rows: int = 4,
    reenvision: bool = False,
    strict_adherence: bool = False,
    has_ref: bool = False,
    has_style_lib: bool = False,
    style_guidance: str = "",
    add_color: bool = False,
    no_color: bool = False,
    riff_mode: bool = False,
    has_color_palette: bool = False,
    ref_original_width: int = 0,
    ref_original_height: int = 0,
    grid_intent: str = "ideas",
) -> str:
    """Build prompt for grid sprite sheet generation.

    Must stay aligned with _build_ui_prompt: same reference order (ref tabs, fusion, custom,
    then User_reference) and style-library priority so grid mode does not ignore refs/style.
    """
    canvas_w = cell_w * grid_cols
    canvas_h = cell_h * grid_rows

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

    total_cells = grid_cols * grid_rows

    if has_style_lib:
        parts.append(
            f"*** HIGHEST PRIORITY — STYLE ADHERENCE ({grid_cols}×{grid_rows} SHEET) ***\n"
            "Study ALL Style/Trained reference images before this prompt. "
            f"EVERY ONE of the {total_cells} cells MUST match the same art style: rendering technique, "
            "palette, line weight, shading, texture, and level of detail as those references. "
            "The sprite sheet must look like it came from the same UI kit as the style references."
        )

    if style_guidance.strip():
        parts.append(f"STYLE GUIDANCE FROM THE ART DIRECTOR:\n{style_guidance.strip()}")

    ar_str = core.detect_aspect_ratio(canvas_w, canvas_h)
    grid_header = (
        f"DIMENSIONS: Generate the image at EXACTLY {canvas_w}x{canvas_h} pixels. "
        f"The aspect ratio MUST be {ar_str}. "
        f"Do NOT generate a square image and stretch it — generate natively at "
        f"{canvas_w} wide by {canvas_h} tall. Fill the entire {canvas_w}x{canvas_h} canvas.\n\n"
        f"{grid_cols}\u00d7{grid_rows} sprite sheet: {canvas_w}x{canvas_h}px image, "
        f"{total_cells} cells of {cell_w}x{cell_h}px each ({grid_cols} columns, {grid_rows} rows — "
        f"draw continuously; the model mentally tiles {grid_cols}\u00d7{grid_rows}).\n"
        f"Background: MANDATORY solid bright chroma-key green RGB(0,255,0) hex #00FF00 everywhere "
        f"outside the single asset in each cell. The background MUST be PURE VIVID GREEN — "
        f"not olive, not dark green, not muted green — EXACTLY the color #00FF00 (R=0, G=255, B=0).\n"
        f"Each cell contains EXACTLY ONE {element_type} only — one centered graphic, no grid lines drawn on the image."
    )

    if element_type == "colorize" and has_ref:
        palette_note = ""
        if has_color_palette:
            palette_note = (
                "\nA COLOR PALETTE reference image has been provided separately. "
                "Use its hues, tones, and color relationships as inspiration for the "
                f"color variations — create {total_cells} different interpretations drawing from that palette.\n"
            )
        parts.append(
            f"{grid_header}\n"
            f"COLORIZE MODE ({total_cells} color variations):\n"
            "User_reference (last image before this text) is a sketch, line art, or monochrome image.\n"
            f"Each of the {total_cells} cells must be a FULL-COLOR rendition of that SAME sketch — preserving "
            "the identical structure, proportions, linework, and composition in every cell.\n"
            f"CRITICAL: The element MUST fill each {cell_w}x{cell_h}px cell EDGE-TO-EDGE. "
            f"Stretch or adapt the element to occupy the FULL cell area. "
            "Do NOT leave empty green space inside the cell where the element should be.\n\n"
            + palette_note +
            f"VARY ONLY THE COLOR TREATMENT across the {total_cells} cells:\n"
            "- Different color palettes (warm, cool, earthy, neon, muted, vibrant, etc.)\n"
            "- Different moods and lighting (day, night, sunset, dramatic, soft)\n"
            "- Different material/surface interpretations (metallic, organic, painterly, cel-shaded)\n\n"
            "Do NOT change the shape, pose, layout, or proportions between cells — "
            "the structure must be identical, only the colors and rendering style differ.\n"
            "If Style Library references are provided, use their palette and mood as the "
            f"baseline, then create {total_cells} variations branching from that aesthetic."
        )
    elif element_type == "colorize":
        parts.append(
            f"{grid_header}\n"
            f"COLORIZE MODE ({total_cells} color variations):\n"
            f"Generate {total_cells} different color palette explorations of the described subject. "
            "Each cell should depict the SAME composition and structure, but rendered with "
            "a distinctly different color scheme, mood, or material treatment."
        )
    elif riff_mode and has_ref:
        parts.append(
            f"{grid_header}\n"
            f"EXPLORE VARIATIONS MODE ({total_cells} faithful variations):\n\n"
            "*** ABSOLUTE RULE — REFERENCE FIDELITY ***\n"
            "The User_reference image (labeled '=== YOUR SOURCE ELEMENT ===' above) is the "
            f"ANCHOR element. Look at it carefully. Every single one of the {total_cells} cells MUST:\n"
            "  1) Depict the SAME type of element (if the reference is a horizontal bar, "
            f"ALL {total_cells} cells must be horizontal bars — not shields, not circles, not icons)\n"
            "  2) Preserve the SAME overall shape, proportions, and silhouette\n"
            "  3) Preserve the SAME internal structure (if it has segments, bands, or "
            "patterns, the variations must also have similar segments/bands/patterns)\n"
            "  4) Preserve the SAME aspect ratio and orientation (horizontal stays horizontal)\n\n"
            f"Each variation MUST fill the ENTIRE {cell_w}x{cell_h}px cell EDGE-TO-EDGE. "
            f"No empty green space inside cell boundaries.\n\n"
            f"WHAT TO VARY across the {total_cells} cells (while keeping structure identical):\n"
            "- Artistic rendering style (painterly, pixel art, cel-shaded, realistic, etc.)\n"
            "- Surface textures and materials (metal, wood, glass, stone, neon, organic)\n"
            "- Embellishments and decorative details (borders, rivets, glows, runes)\n"
            "- Color palette (unless constrained by user)\n"
            "- Stylistic era (modern, retro, fantasy, sci-fi, steampunk, etc.)\n\n"
            "NEVER invent a completely different element type. If the reference is a simple "
            f"health bar, do NOT generate ornate shields or circular icons — generate {total_cells} "
            "different artistic takes on a health bar with the same proportions.\n\n"
            "If Style Library reference images are provided, use their visual style as the "
            f"baseline aesthetic, then branch into {total_cells} distinct variations from that starting point."
        )
    elif has_ref and reenvision:
        parts.append(
            f"{grid_header}\n"
            "RE-ENVISION MODE: User_reference (last image before this text) is the subject baseline. "
            f"Each of the {total_cells} cells must be a DIFFERENT creative reimagining of that subject in the "
            "mandatory style — vary pose, angle, proportions, and details. "
            "Do NOT copy the reference pixel-for-pixel; stay faithful to its idea and to style references."
        )
    elif has_ref and strict_adherence:
        parts.append(
            f"{grid_header}\n"
            "REMAKE MODE (strict): User_reference defines ONE layout template and aspect logic. "
            "Every cell must keep the SAME aspect ratio and general feel (how the graphic sits in the cell, same skeleton).\n"
            f"Across the {total_cells} cells, vary only the VISUAL FLAVOR per USER DIRECTION — different stylistic treatments of the "
            f"same remake idea (palette, line, texture, era), not {total_cells} different icons with different proportions or subjects.\n"
            "Style/Trained references + USER DIRECTION supply the new look; User_reference supplies size/layout DNA."
        )
    elif has_ref:
        parts.append(
            f"{grid_header}\n"
            "USER_REFERENCE (last image before this text) is mandatory visual context for CONTENT. "
            f"All {total_cells} icons must clearly descend from it: same graphic vocabulary, layout logic, "
            "and motif family (e.g. stripes, bands, grid-of-squares, proportions). "
            "Each cell must still be a distinct variation (different treatment, angle, or detail). "
            "If User_reference is minimal or abstract, echo its geometry and composition — do not "
            "replace it with unrelated subjects like crosses, pills, or hearts unless the user text explicitly asks."
        )
    else:
        parts.append(
            f"{grid_header}\n"
            f"IMPORTANT: All {total_cells} must be DIFFERENT — vary the shape, size, angle, detail, and design. "
            "No two cells should look the same."
        )

    # --- Grid intent: animation sequence vs many ideas ---
    if grid_intent == "animation":
        parts.append(
            f"*** ANIMATION SEQUENCE MODE ***\n"
            f"The {total_cells} cells form a LEFT-TO-RIGHT, TOP-TO-BOTTOM animation sequence "
            f"(read like a comic strip: row 1 left→right, then row 2 left→right, etc.).\n"
            f"Cell 1 is the first frame; cell {total_cells} is the last frame.\n\n"
            "RULES FOR ANIMATION SEQUENCE:\n"
            "- The SAME single element appears in EVERY cell — identical shape and proportions.\n"
            "- Each cell shows the element at a DIFFERENT stage of its animation/state change.\n"
            "- The progression must be smooth and logical (like sprite-sheet animation frames).\n"
            "- Examples: a health bar filling up, a button being pressed, an icon rotating, "
            "a chest opening, a coin spinning, a sword swinging, a power-up activating.\n"
            "- DO NOT create different elements — show ONE element evolving across frames.\n"
            "- Maintain consistent size, position, and centering across all cells.\n"
            "- If a reference image is provided, use it as the element and animate it."
        )

    parts.append(
        f"CRITICAL — ONE ASSET PER CELL (all {total_cells} cells):\n"
        f"- Each cell is {cell_w}×{cell_h} px. Draw EXACTLY ONE single {element_type} in each cell — "
        "one unified silhouette, centered, with chroma green margin around it.\n"
        "- FORBIDDEN: two or more separate widgets in one cell; stacked duplicate bars or buttons; "
        "an upper bar plus a lower bar; side-by-side twins; mini before/after pairs; contact-sheet layouts inside one cell.\n"
        "- FORBIDDEN: repeating the same element twice vertically or horizontally inside one cell.\n"
        "- If the target is a wide button or bar, it is still ONE control: one horizontal strip, one bevel system — "
        "not two parallel strips.\n"
        f"- Count mentally: {total_cells} cells = {total_cells} distinct single graphics, never {total_cells * 2}+ sub-widgets on the sheet."
    )

    parts.append(
        "CHROMA / KEYING RULES:\n"
        "1) The ENTIRE background MUST be PURE BRIGHT GREEN #00FF00 (RGB 0,255,0). "
        "NOT dark green, NOT olive, NOT teal — exactly #00FF00, the standard chroma key color.\n"
        "2) Do NOT put that green ON the element itself — no green rims, outlines, inner glows, "
        f"shadows, or anti-alias fringe in green on the {element_type}.\n"
        "3) Use grays, silvers, or darks at UI edges so post-processing can key out only the void behind the asset.\n"
        "4) Every single pixel of background between and around the assets MUST be #00FF00."
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
    riff_mode: bool = False
    grid_layout: str = "square"  # "square" | "horizontal" | "vertical"
    grid_intent: str = "ideas"  # "ideas" | "animation"
    color_palette_b64: Optional[str] = None
    ref_original_width: Optional[int] = None
    ref_original_height: Optional[int] = None


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
    grid_cols: int = 4
    grid_rows: int = 4
    error: Optional[str] = None


class UIAnimFrameRequest(UIGenRequest):
    frame_count: int = 16
    source_image_b64: Optional[str] = None


class UIAnimRegenRequest(BaseModel):
    before_frame_b64: Optional[str] = None
    after_frame_b64: Optional[str] = None
    source_image_b64: Optional[str] = None
    prompt: str = ""
    frame_index: int = 0
    total_frames: int = 16
    model_id: Optional[str] = None
    style_context: Optional[str] = None


class UIAnimFrameResponse(BaseModel):
    frames: Optional[list[str]] = None
    frame_width: int = 256
    frame_height: int = 256
    error: Optional[str] = None


class UIAnimRegenResponse(BaseModel):
    frame_b64: Optional[str] = None
    width: int = 256
    height: int = 256
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

    ar = core.detect_aspect_ratio(req.output_width, req.output_height)

    # Edit mode: send the reference image + edit prompt directly
    if req.edit_prompt and req.reference_image_b64:
        edit_text = req.edit_prompt
        if req.custom_sections_context:
            edit_text = f"{edit_text}\n\n--- Custom Directions ---\n{req.custom_sections_context}"
        edit_contents: list = []
        if req.style_context:
            edit_contents.extend(_load_style_library_images(req.style_context))
        edit_contents.append(core.b64_to_image(req.reference_image_b64))
        for b64 in (req.custom_section_images or []):
            if b64:
                edit_contents.append(core.b64_to_image(b64))
        edit_contents.append(edit_text)
        try:
            result = core.gemini_generate_image(
                api_key, edit_contents, aspect_ratio=ar, image_size="4K",
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

    force_match_dims = req.match_ref_dims or req.riff_mode

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
        add_color=True if req.element_type == "colorize" else req.add_color,
        no_color=False if req.element_type == "colorize" else req.no_color,
        riff_mode=req.riff_mode,
        has_color_palette=bool(req.color_palette_b64),
    )

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    contents: list = []
    # 1) Style library images (actual images from disk)
    if req.style_context:
        contents.extend(_load_style_library_images(req.style_context))
    # 2) Additional ref-tab images
    if req.ref_images:
        for b64 in req.ref_images:
            if b64:
                contents.append(core.b64_to_image(b64))
    # 3) Fusion slot images
    for b64 in [req.fusion_image_1_b64, req.fusion_image_2_b64]:
        if b64:
            contents.append(core.b64_to_image(b64))
    # 4) Custom section images
    for b64 in (req.custom_section_images or []):
        if b64:
            contents.append(core.b64_to_image(b64))
    # 5) Main reference image with clear label
    if req.reference_image_b64:
        if req.riff_mode:
            contents.append(
                "=== YOUR SOURCE ELEMENT (User_reference) ===\n"
                "THIS is the element you MUST base the variation on. "
                "Preserve its exact shape, proportions, and structure:"
            )
        elif req.element_type == "colorize":
            contents.append(
                "=== SOURCE IMAGE TO COLORIZE (User_reference) ===\n"
                "Preserve its exact structure and add color:"
            )
        else:
            contents.append("=== REFERENCE IMAGE (User_reference) ===")
        contents.append(core.b64_to_image(req.reference_image_b64))
    # 6) Color palette
    if req.color_palette_b64 and req.element_type == "colorize":
        contents.append("COLOR PALETTE REFERENCE (use these colors/hues as inspiration):")
        contents.append(core.b64_to_image(req.color_palette_b64))
    contents.append(f"{prompt}\n\nGenerate this UI element.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio=ar, image_size="4K",
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
                    api_key, overlay_contents, aspect_ratio=ar, image_size="4K",
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
    ar = core.detect_aspect_ratio(req.output_width, req.output_height)

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
    if req.style_context:
        contents.extend(_load_style_library_images(req.style_context))
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
        contents.append("=== REFERENCE IMAGE (User_reference) ===")
        contents.append(core.b64_to_image(req.reference_image_b64))
    contents.append(f"{prompt}\n\nGenerate this scrollbar component.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio=ar, image_size="4K",
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
    ar = core.detect_aspect_ratio(req.output_width, req.output_height)

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
    if req.style_context:
        contents.extend(_load_style_library_images(req.style_context))
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
        contents.append("=== REFERENCE IMAGE (User_reference) ===")
        contents.append(core.b64_to_image(req.reference_image_b64))
    contents.append(f"{prompt}\n\nGenerate this character glyph.")

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio=ar, image_size="4K",
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


def _normalize_bg_to_chroma_green(img) -> "Image.Image":
    """If the background isn't close to pure #00FF00, recolor it.

    Detects the actual bg color from edges.  If it's far from chroma green,
    replaces all bg-colored pixels with exact #00FF00 so the rest of the
    pipeline (detection + removal) always works against a clean bright green.
    """
    from PIL import Image

    bg_color = _detect_background_color(img)
    bg_r, bg_g, bg_b = bg_color
    dist_from_green = ((bg_r - 0)**2 + (bg_g - 255)**2 + (bg_b - 0)**2)**0.5

    if dist_from_green < 60:
        return img  # Already close enough to chroma green

    log.info("=== normalizing bg RGB(%d,%d,%d) (dist=%.0f) → #00FF00 ===",
             bg_r, bg_g, bg_b, dist_from_green)

    arr = np.array(img.convert("RGB"), dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    dist = np.sqrt((r - bg_r)**2 + (g - bg_g)**2 + (b - bg_b)**2)

    # Auto-calibrate threshold from edge spread
    h, w = arr.shape[:2]
    edge = 4
    edge_samples = np.concatenate([
        arr[:edge, :, :].reshape(-1, 3),
        arr[h-edge:, :, :].reshape(-1, 3),
        arr[:, :edge, :].reshape(-1, 3),
        arr[:, w-edge:, :].reshape(-1, 3),
    ], axis=0)
    edge_dist = np.sqrt(
        (edge_samples[:, 0] - bg_r)**2 +
        (edge_samples[:, 1] - bg_g)**2 +
        (edge_samples[:, 2] - bg_b)**2
    )
    spread = float(np.percentile(edge_dist, 90))
    thresh = max(40.0, min(100.0, spread * 2.0))

    mask = dist < thresh
    out = arr.copy()
    out[mask, 0] = 0
    out[mask, 1] = 255
    out[mask, 2] = 0

    return Image.fromarray(out.astype(np.uint8), "RGB")


def _detect_background_color(img) -> tuple[int, int, int]:
    """Sample image edges to determine the actual background color Gemini used.

    Returns (R, G, B) median of the border pixels.  Works regardless of
    whether Gemini produced #00FF00, sage-green, olive, or anything else.
    """
    arr = np.array(img.convert("RGB"), dtype=np.uint8)
    h, w, _ = arr.shape
    edge_px = 4
    samples = np.concatenate([
        arr[:edge_px, :, :].reshape(-1, 3),
        arr[h - edge_px:, :, :].reshape(-1, 3),
        arr[:, :edge_px, :].reshape(-1, 3),
        arr[:, w - edge_px:, :].reshape(-1, 3),
    ], axis=0)
    bg_r = int(np.median(samples[:, 0]))
    bg_g = int(np.median(samples[:, 1]))
    bg_b = int(np.median(samples[:, 2]))
    log.info("=== detected background color: RGB(%d, %d, %d) ===", bg_r, bg_g, bg_b)
    return bg_r, bg_g, bg_b


def _find_content_ranges(frac, total, min_size=20, sep_thresh=0.65):
    """Find runs of non-separator pixels (= content cells).

    After the initial scan, a smart merge pass combines ranges separated by
    suspiciously thin gaps.  Instead of a fixed pixel threshold it looks at
    the actual gap widths: if there is a clear size jump between thin gaps
    (internal notches, 1–4 px) and wide gaps (real separators, 10+ px) it
    merges only the thin ones.  Falls back to merging gaps < 5 px.
    """
    is_sep = frac >= sep_thresh
    ranges: list[tuple[int, int]] = []
    start = None
    for i in range(total):
        if not is_sep[i] and start is None:
            start = i
        elif is_sep[i] and start is not None:
            if i - start >= min_size:
                ranges.append((start, i))
            start = None
    if start is not None and total - start >= min_size:
        ranges.append((start, total))

    if len(ranges) <= 1:
        return ranges

    # Collect gap widths between consecutive content ranges
    gaps = [ranges[i + 1][0] - ranges[i][1] for i in range(len(ranges) - 1)]
    if not gaps:
        return ranges

    # Smart merge: only merge gaps that are clearly thinner than real
    # separators.  Real grid separators are consistent width; internal
    # features (health-bar notches, icon details) produce much thinner gaps.
    max_gap = max(gaps)
    min_gap = min(gaps)
    log.debug("_find_content_ranges: %d initial ranges, gaps=%s max=%d min=%d",
              len(ranges), gaps, max_gap, min_gap)

    # Only merge if there's a large ratio between biggest and smallest gap
    # (indicating two distinct populations: notches vs separators).
    if max_gap >= 8 and min_gap < max_gap * 0.30:
        merge_below = min_gap  # merge gaps up to the size of the smallest
        merged: list[tuple[int, int]] = [ranges[0]]
        for s, e in ranges[1:]:
            prev_s, prev_e = merged[-1]
            if s - prev_e <= merge_below:
                merged[-1] = (prev_s, e)
            else:
                merged.append((s, e))
        ranges = merged
        log.debug("_find_content_ranges: after merge (merge_below=%d) → %d ranges",
                  merge_below, len(ranges))

    return ranges


def _detect_cells_by_projection(img) -> tuple[list, int, int, tuple[int, int, int]]:
    """Detect actual grid cell boundaries by analyzing background-colored bands.

    Adaptive multi-pass: tries progressively looser distance thresholds and
    auto-computes the separator threshold from the projection data itself,
    validating that the resulting grid is reasonable each time.

    Returns (cell_images, detected_cols, detected_rows, bg_color).
    On failure returns ([], 0, 0, bg_color).
    """
    bg_color = _detect_background_color(img)
    bg_r, bg_g, bg_b = float(bg_color[0]), float(bg_color[1]), float(bg_color[2])

    arr = np.array(img.convert("RGB"), dtype=np.uint8)
    h, w, _ = arr.shape

    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    dist = np.sqrt((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2)

    min_cell = max(12, min(h, w) // 30)
    best = None

    for bg_thresh in (55.0, 80.0, 110.0, 145.0):
        is_bg = dist < bg_thresh
        row_frac = is_bg.mean(axis=1)
        col_frac = is_bg.mean(axis=0)

        def _auto_sep_thresh(frac_arr):
            # Separator rows/cols are nearly all-background (frac ~0.9-1.0).
            # Content rows/cols have significant non-background (frac < 0.6).
            # Threshold should sit between these two populations.
            high = frac_arr[frac_arr > 0.85]
            low = frac_arr[frac_arr < 0.60]
            if len(high) == 0:
                return 0.50
            sep_median = float(np.median(high))
            content_max = float(np.max(low)) if len(low) > 0 else 0.0
            # Place threshold between content max and separator median
            thresh = (content_max + sep_median) / 2.0
            return max(0.40, min(0.92, thresh))

        sep_r = _auto_sep_thresh(row_frac)
        sep_c = _auto_sep_thresh(col_frac)

        row_ranges = _find_content_ranges(row_frac, h, min_size=min_cell, sep_thresh=sep_r)
        col_ranges = _find_content_ranges(col_frac, w, min_size=min_cell, sep_thresh=sep_c)

        nr, nc = len(row_ranges), len(col_ranges)
        if nr < 2 or nc < 2 or nr > 12 or nc > 12:
            log.debug("bg_thresh=%.0f  sep_r=%.2f sep_c=%.2f → %d rows, %d cols — skipping",
                      bg_thresh, sep_r, sep_c, nr, nc)
            continue

        avg_cw = sum(ce - cs for cs, ce in col_ranges) / nc
        avg_ch = sum(re - rs for rs, re in row_ranges) / nr
        if avg_cw < 30 or avg_ch < 20:
            log.debug("bg_thresh=%.0f → avg cell %.0fx%.0f too small — skipping",
                      bg_thresh, avg_cw, avg_ch)
            continue

        best = (row_ranges, col_ranges, bg_thresh, sep_r, sep_c)
        log.info("=== projection pass bg_thresh=%.0f sep_r=%.2f sep_c=%.2f → %d cols × %d rows (cell ~%.0f×%.0f) ===",
                 bg_thresh, sep_r, sep_c, nc, nr, avg_cw, avg_ch)
        break

    if best is None:
        log.warning("Projection detection failed at all thresholds")
        return [], 0, 0, bg_color

    row_ranges, col_ranges, used_thresh, _, _ = best
    cells = []
    for rs, re in row_ranges:
        for cs, ce in col_ranges:
            cells.append(img.crop((cs, rs, ce, re)).copy())

    det_cols = len(col_ranges)
    det_rows = len(row_ranges)
    log.info("=== projection detection final: %d cols × %d rows = %d cells (bg_thresh=%.0f) ===",
             det_cols, det_rows, len(cells), used_thresh)
    return cells, det_cols, det_rows, bg_color


def _remove_bg_adaptive(img, bg_color: tuple[int, int, int]):
    """Remove background using the actual detected color, not just #00FF00.

    Pipeline:
      1. Distance-based keying from the detected bg_color (generous)
      2. BFS flood from edges to catch any remaining bg connected to outside
      3. Second tighter keying pass
      4. Defringe to remove halo artifacts
    """
    from PIL import Image

    bg_r, bg_g, bg_b = float(bg_color[0]), float(bg_color[1]), float(bg_color[2])

    # Auto-calibrate distance thresholds: measure how "clean" the background is
    # by checking the cell edges.  A tight BG needs smaller thresholds; a noisy
    # or gradient BG needs larger ones.
    arr_probe = np.array(img.convert("RGB"), dtype=np.float32)
    h_p, w_p = arr_probe.shape[:2]
    edge_strip = 3
    edge_samples = np.concatenate([
        arr_probe[:edge_strip, :, :].reshape(-1, 3),
        arr_probe[h_p - edge_strip:, :, :].reshape(-1, 3),
        arr_probe[:, :edge_strip, :].reshape(-1, 3),
        arr_probe[:, w_p - edge_strip:, :].reshape(-1, 3),
    ], axis=0)
    edge_dist = np.sqrt(
        (edge_samples[:, 0] - bg_r) ** 2 +
        (edge_samples[:, 1] - bg_g) ** 2 +
        (edge_samples[:, 2] - bg_b) ** 2
    )
    bg_spread = float(np.percentile(edge_dist, 90))
    # Generous pass: threshold = spread * 2, clamped between 60 and 140
    pass1_thresh = max(60.0, min(140.0, bg_spread * 2.5))
    pass3_thresh = max(45.0, min(100.0, bg_spread * 1.8))
    flood_tol = max(55.0, min(120.0, bg_spread * 2.2))

    # --- Pass 1: distance-based key from detected colour (generous) ---
    arr = np.array(img.convert("RGBA"), dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    dist = np.sqrt((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2)
    arr[:, :, 3] = np.where(dist < pass1_thresh, 0, arr[:, :, 3])
    img = Image.fromarray(arr.astype(np.uint8), "RGBA")

    # --- Pass 2: BFS flood from edges to remove connected bg remnants ---
    arr2 = np.array(img, dtype=np.uint8)
    _flood_clear_bg_from_edges(arr2, bg_color, tolerance=flood_tol)
    img = Image.fromarray(arr2, "RGBA")

    # --- Pass 3: tighter keying to clean up anti-aliased fringe ---
    arr3 = np.array(img.convert("RGBA"), dtype=np.float32)
    r3, g3, b3 = arr3[:, :, 0], arr3[:, :, 1], arr3[:, :, 2]
    dist3 = np.sqrt((r3 - bg_r) ** 2 + (g3 - bg_g) ** 2 + (b3 - bg_b) ** 2)
    arr3[:, :, 3] = np.where(dist3 < pass3_thresh, 0, arr3[:, :, 3])
    img = Image.fromarray(arr3.astype(np.uint8), "RGBA")

    # --- Pass 4: defringe any bg-colored halos ---
    img = _defringe_bg_edges(img, bg_color)
    return img


def _flood_clear_bg_from_edges(arr, bg_color: tuple[int, int, int], tolerance: float = 65) -> None:
    """BFS from image border: clear alpha for pixels close to bg_color connected to outside."""
    from collections import deque

    h, w = arr.shape[:2]
    bg_r, bg_g, bg_b = float(bg_color[0]), float(bg_color[1]), float(bg_color[2])
    tol_sq = tolerance * tolerance
    reachable = np.zeros((h, w), dtype=bool)
    q: deque = deque()

    def _is_bg_like(y: int, x: int) -> bool:
        r, g, b, a = float(arr[y, x, 0]), float(arr[y, x, 1]), float(arr[y, x, 2]), int(arr[y, x, 3])
        if a < 12:
            return True
        d = (r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2
        return d < tol_sq

    for x in range(w):
        for y in (0, h - 1):
            if not reachable[y, x] and _is_bg_like(y, x):
                reachable[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not reachable[y, x] and _is_bg_like(y, x):
                reachable[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not reachable[ny, nx]:
                if _is_bg_like(ny, nx):
                    reachable[ny, nx] = True
                    q.append((ny, nx))

    arr[reachable, 3] = 0


def _defringe_bg_edges(img, bg_color: tuple[int, int, int], halo_dist: float = 70.0):
    """Remove thin halos: opaque pixels close to bg_color that border transparency."""
    from PIL import Image

    arr = np.array(img.convert("RGBA"), dtype=np.int16)
    h, w = arr.shape[:2]
    a = arr[:, :, 3].copy()
    bg_r, bg_g, bg_b = bg_color
    halo_sq = halo_dist * halo_dist
    for y in range(h):
        for x in range(w):
            if a[y, x] < 40:
                continue
            r, g, b = int(arr[y, x, 0]), int(arr[y, x, 1]), int(arr[y, x, 2])
            d = (r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2
            if d > halo_sq:
                continue
            transparent_neighbors = 0
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if ny < 0 or ny >= h or nx < 0 or nx >= w:
                    transparent_neighbors += 1
                elif arr[ny, nx, 3] < 38:
                    transparent_neighbors += 1
            if transparent_neighbors >= 2:
                a[y, x] = 0
    arr[:, :, 3] = np.clip(a, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def _make_square_cell(img, output_size: int = 256) -> "Image.Image":
    """Tight-crop to content, pad to a square, and resize to output_size×output_size.

    Guarantees a square RGBA image regardless of the icon's aspect ratio.
    """
    from PIL import Image

    img = img.convert("RGBA")
    bbox = img.getbbox()
    if bbox is None:
        return Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))

    content = img.crop(bbox)
    cw, ch = content.size

    # Pad to a square canvas with a small margin (4% each side)
    side = max(cw, ch)
    margin = max(4, int(side * 0.04))
    canvas_side = side + margin * 2
    square = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    paste_x = (canvas_side - cw) // 2
    paste_y = (canvas_side - ch) // 2
    square.paste(content, (paste_x, paste_y), content)

    if canvas_side != output_size:
        square = square.resize((output_size, output_size), Image.Resampling.LANCZOS)
    return square


def _do_generate_grid(req: UIGenRequest) -> UIGenGridResponse:
    """Generate a grid of UI elements and crop into individual cells."""
    from PIL import Image

    api_key = core.get_api_key()
    if not api_key:
        return UIGenGridResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    cell_w = req.cell_width or 256
    cell_h = req.cell_height or 256

    layout = req.grid_layout or "square"
    if layout == "horizontal":
        grid_cols, grid_rows = 4, 5
    elif layout == "vertical":
        grid_cols, grid_rows = 5, 4
    else:
        grid_cols, grid_rows = 4, 4

    canvas_w = cell_w * grid_cols
    canvas_h = cell_h * grid_rows
    total_cells = grid_cols * grid_rows

    log.info("=== generate-grid START: element=%s riff=%s layout=%s grid=%dx%d cell=%dx%d canvas=%dx%d ===",
             req.element_type, req.riff_mode, layout, grid_cols, grid_rows,
             cell_w, cell_h, canvas_w, canvas_h)

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
        grid_cols=grid_cols,
        grid_rows=grid_rows,
        reenvision=req.reenvision,
        strict_adherence=req.strict_reference_adherence,
        has_ref=has_ref,
        has_style_lib=has_style,
        style_guidance=style_guidance_combined,
        add_color=True if req.element_type == "colorize" else req.add_color,
        no_color=False if req.element_type == "colorize" else req.no_color,
        riff_mode=req.riff_mode,
        has_color_palette=bool(req.color_palette_b64),
        ref_original_width=req.ref_original_width or 0,
        ref_original_height=req.ref_original_height or 0,
        grid_intent=req.grid_intent or "ideas",
    )

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    contents: list = []
    if req.style_context:
        contents.extend(_load_style_library_images(req.style_context))
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
        if req.riff_mode:
            contents.append(
                "=== YOUR SOURCE ELEMENT (User_reference) ===\n"
                f"THIS is the element you MUST base all {total_cells} variations on. "
                "Preserve its exact shape, proportions, structure, and layout. "
                "Every cell must be clearly recognizable as THIS element:"
            )
        elif req.element_type == "colorize":
            contents.append(
                "=== SOURCE IMAGE TO COLORIZE (User_reference) ===\n"
                "THIS is the sketch/image to add color to. Preserve its exact structure:"
            )
        else:
            contents.append("=== REFERENCE IMAGE (User_reference) ===")
        contents.append(core.b64_to_image(req.reference_image_b64))
    if req.color_palette_b64 and req.element_type == "colorize":
        contents.append("COLOR PALETTE REFERENCE (use these colors/hues as inspiration):")
        contents.append(core.b64_to_image(req.color_palette_b64))
    contents.append(f"{prompt}\n\nGenerate this {grid_cols}x{grid_rows} sprite sheet.")

    grid_ar = core.detect_aspect_ratio(canvas_w, canvas_h)
    log.info("=== generate-grid calling Gemini API (model=%s canvas=%dx%d ar=%s grid=%dx%d, %d content parts) ===",
             req.model_id, canvas_w, canvas_h, grid_ar, grid_cols, grid_rows, len(contents))
    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio=grid_ar, image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        log.error("=== generate-grid Gemini error: %s ===", e)
        return UIGenGridResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        log.error("=== generate-grid Gemini returned None ===")
        return UIGenGridResponse(error="Generation failed")
    log.info("=== generate-grid Gemini returned %dx%d image (requested %dx%d) ===",
             result.width, result.height, canvas_w, canvas_h)

    # --- Normalize muted backgrounds (Flash model) to bright chroma green ---
    result = _normalize_bg_to_chroma_green(result)

    # --- Smart cropping: detect actual cell positions via green-band projection ---
    detected_cells, det_cols, det_rows, bg_color = _detect_cells_by_projection(result)

    sq_size = max(cell_w, cell_h, 256)

    if detected_cells and det_cols >= 2 and det_rows >= 2:
        log.info("=== Using projection-detected grid: %d cols × %d rows (%d cells), bg=RGB%s ===",
                 det_cols, det_rows, len(detected_cells), bg_color)
        actual_cols, actual_rows = det_cols, det_rows
        cells_b64: list[str] = []
        for idx, cell in enumerate(detected_cells):
            cell = _remove_bg_adaptive(cell, bg_color)
            cell = _make_square_cell(cell, output_size=sq_size)
            cells_b64.append(core.image_to_b64(cell))
            r_idx, c_idx = divmod(idx, actual_cols)
            core.save_generated_image(
                cell, "AI UILab",
                view_name=f"grid_{r_idx}_{c_idx}",
                generation_type="grid",
                metadata={"element_type": req.element_type, "prompt": req.prompt[:200]},
            )
    else:
        # Fallback: detect BG, resize to expected canvas, uniformly slice
        bg_color = _detect_background_color(result)
        log.warning("=== Projection detection failed — falling back to uniform %dx%d slicing, bg=RGB%s ===",
                    grid_cols, grid_rows, bg_color)
        actual_cols, actual_rows = grid_cols, grid_rows
        if result.size != (canvas_w, canvas_h):
            result = result.resize((canvas_w, canvas_h), Image.Resampling.LANCZOS)
        cells_b64 = []
        for row in range(grid_rows):
            for col in range(grid_cols):
                x1, y1 = col * cell_w, row * cell_h
                x2, y2 = x1 + cell_w, y1 + cell_h
                cell = result.crop((x1, y1, x2, y2)).copy()
                cell = _remove_bg_adaptive(cell, bg_color)
                cell = _make_square_cell(cell, output_size=sq_size)
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
        width=result.width,
        height=result.height,
        cell_width=sq_size,
        cell_height=sq_size,
        grid_cols=actual_cols,
        grid_rows=actual_rows,
    )


# ---------------------------------------------------------------------------
# Animation helpers
# ---------------------------------------------------------------------------

def _auto_grid_shape(frame_count: int) -> tuple[int, int]:
    """Pick a cols×rows layout for a given number of animation frames."""
    import math
    sqrt = math.isqrt(frame_count)
    if sqrt * sqrt == frame_count:
        return sqrt, sqrt
    cols = sqrt + 1
    rows = math.ceil(frame_count / cols)
    return cols, rows


def _do_generate_animation_frames(req: UIAnimFrameRequest) -> UIAnimFrameResponse:
    """Generate animation sprite sheet, split into individual frames."""
    from PIL import Image

    api_key = core.get_api_key()
    if not api_key:
        return UIAnimFrameResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    frame_count = max(2, min(req.frame_count, 64))
    grid_cols, grid_rows = _auto_grid_shape(frame_count)
    total_cells = grid_cols * grid_rows
    cell_w = 256
    cell_h = 256

    canvas_w = cell_w * grid_cols
    canvas_h = cell_h * grid_rows

    log.info("=== generate-animation-frames START: frames=%d grid=%dx%d canvas=%dx%d ===",
             frame_count, grid_cols, grid_rows, canvas_w, canvas_h)

    has_ref = req.source_image_b64 is not None or req.reference_image_b64 is not None
    has_style = bool(req.style_context)
    style_guidance_combined = ""
    if req.style_context:
        style_guidance_combined += req.style_context
    if req.style_guidance:
        style_guidance_combined += f"\n{req.style_guidance}" if style_guidance_combined else req.style_guidance

    prompt = _build_grid_prompt(
        element_type=req.element_type or "icon",
        user_prompt=req.prompt,
        cell_w=cell_w,
        cell_h=cell_h,
        grid_cols=grid_cols,
        grid_rows=grid_rows,
        reenvision=False,
        strict_adherence=True,
        has_ref=has_ref,
        has_style_lib=has_style,
        style_guidance=style_guidance_combined,
        add_color=req.add_color,
        no_color=req.no_color,
        riff_mode=True,
        ref_original_width=req.ref_original_width or 0,
        ref_original_height=req.ref_original_height or 0,
        grid_intent="animation",
    )

    contents: list = []
    if req.style_context:
        contents.extend(_load_style_library_images(req.style_context))

    source_b64 = req.source_image_b64 or req.reference_image_b64
    if source_b64:
        contents.append(
            "=== YOUR SOURCE ELEMENT (User_reference) ===\n"
            f"THIS is the element to ANIMATE across {total_cells} frames. "
            "Preserve its exact shape, proportions, structure, and identity. "
            "Every frame must be clearly recognizable as THIS element:"
        )
        contents.append(core.b64_to_image(source_b64))
    contents.append(f"{prompt}\n\nGenerate this {grid_cols}x{grid_rows} animation sprite sheet.")

    grid_ar = core.detect_aspect_ratio(canvas_w, canvas_h)
    log.info("=== generate-animation-frames calling Gemini (model=%s canvas=%dx%d ar=%s) ===",
             req.model_id, canvas_w, canvas_h, grid_ar)
    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio=grid_ar, image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        log.error("=== generate-animation-frames Gemini error: %s ===", e)
        return UIAnimFrameResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return UIAnimFrameResponse(error="Generation failed — no image returned")

    result = _normalize_bg_to_chroma_green(result)
    detected_cells, det_cols, det_rows, bg_color = _detect_cells_by_projection(result)

    sq_size = 256
    frames_b64: list[str] = []

    if detected_cells and det_cols >= 2 and det_rows >= 2:
        log.info("=== animation: projection detected %d cols × %d rows (%d cells) ===",
                 det_cols, det_rows, len(detected_cells))
        for cell in detected_cells[:frame_count]:
            cell = _remove_bg_adaptive(cell, bg_color)
            cell = _make_square_cell(cell, output_size=sq_size)
            frames_b64.append(core.image_to_b64(cell))
    else:
        bg_color = _detect_background_color(result)
        if result.size != (canvas_w, canvas_h):
            result = result.resize((canvas_w, canvas_h), Image.Resampling.LANCZOS)
        for row in range(grid_rows):
            for col in range(grid_cols):
                idx = row * grid_cols + col
                if idx >= frame_count:
                    break
                x1, y1 = col * cell_w, row * cell_h
                cell = result.crop((x1, y1, x1 + cell_w, y1 + cell_h)).copy()
                cell = _remove_bg_adaptive(cell, bg_color)
                cell = _make_square_cell(cell, output_size=sq_size)
                frames_b64.append(core.image_to_b64(cell))

    log.info("=== generate-animation-frames done: %d frames extracted ===", len(frames_b64))
    return UIAnimFrameResponse(frames=frames_b64, frame_width=sq_size, frame_height=sq_size)


def _do_regenerate_animation_frame(req: UIAnimRegenRequest) -> UIAnimRegenResponse:
    """Regenerate a single animation frame with neighbor-frame context."""
    api_key = core.get_api_key()
    if not api_key:
        return UIAnimRegenResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    contents: list = []

    if req.style_context:
        contents.extend(_load_style_library_images(req.style_context))

    if req.source_image_b64:
        contents.append(
            "=== ORIGINAL SOURCE ELEMENT ===\n"
            "This is the original icon/element being animated:"
        )
        contents.append(core.b64_to_image(req.source_image_b64))

    if req.before_frame_b64:
        contents.append(
            f"=== PREVIOUS FRAME (frame {req.frame_index}) ===\n"
            "The animation frame immediately before the one to generate:"
        )
        contents.append(core.b64_to_image(req.before_frame_b64))

    if req.after_frame_b64:
        contents.append(
            f"=== NEXT FRAME (frame {req.frame_index + 2}) ===\n"
            "The animation frame immediately after the one to generate:"
        )
        contents.append(core.b64_to_image(req.after_frame_b64))

    prompt_text = (
        f"Generate frame {req.frame_index + 1} of {req.total_frames} in an animation sequence.\n"
        "Background: MANDATORY solid bright chroma-key green RGB(0,255,0) #00FF00.\n"
        "Generate EXACTLY ONE icon/element centered on a 256×256 bright green background.\n"
    )
    if req.before_frame_b64 and req.after_frame_b64:
        prompt_text += (
            "This frame must smoothly transition between the previous and next frames shown above. "
            "Match the style, proportions, and identity of the element exactly.\n"
        )
    elif req.before_frame_b64:
        prompt_text += "Continue the animation naturally from the previous frame.\n"
    elif req.after_frame_b64:
        prompt_text += "Lead naturally into the next frame.\n"
    if req.prompt:
        prompt_text += f"\nAnimation description: {req.prompt}\n"

    contents.append(prompt_text)

    log.info("=== regenerate-animation-frame: idx=%d/%d ===", req.frame_index, req.total_frames)
    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="1:1", image_size="1024x1024",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        log.error("=== regenerate-animation-frame error: %s ===", e)
        return UIAnimRegenResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return UIAnimRegenResponse(error="Regeneration failed — no image returned")

    result = _normalize_bg_to_chroma_green(result)
    bg_color = _detect_background_color(result)
    result = _remove_bg_adaptive(result, bg_color)
    result = _make_square_cell(result, output_size=256)

    return UIAnimRegenResponse(frame_b64=core.image_to_b64(result), width=256, height=256)


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


@router.post("/generate-animation-frames", response_model=UIAnimFrameResponse)
async def generate_animation_frames(req: UIAnimFrameRequest):
    """Generate animation sprite sheet frames."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_generate_animation_frames, req)


@router.post("/regenerate-animation-frame", response_model=UIAnimRegenResponse)
async def regenerate_animation_frame(req: UIAnimRegenRequest):
    """Regenerate a single animation frame with context from neighboring frames."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_regenerate_animation_frame, req)


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
