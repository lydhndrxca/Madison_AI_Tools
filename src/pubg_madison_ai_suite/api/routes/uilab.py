"""AI UI Lab API routes — UI element generation (buttons, icons, scrollbars, fonts, numbers)."""

from __future__ import annotations

import asyncio
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

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


def _remove_grid_cell_background(img):
    """Aggressive green removal for grid cells (wider tolerances)."""
    img = _chroma_key_to_alpha(img, green=(0, 255, 0), threshold=70, min_green=50)
    img = _flood_fill_transparent(img, tolerance=40)
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
    has_ref: bool = False,
    add_color: bool = False,
    no_color: bool = False,
) -> str:
    """Build prompt for 4x4 grid sprite sheet generation."""
    canvas_w = cell_w * 4
    canvas_h = cell_h * 4

    parts: list[str] = []

    grid_header = (
        f"4\u00d74 sprite sheet: {canvas_w}x{canvas_h}px image, "
        f"16 cells of {cell_w}x{cell_h}px each.\n"
        f"Background: solid chroma green #00FF00 everywhere.\n"
        f"Each cell: one {element_type}, centered, no overlap between cells, no grid lines."
    )
    if has_ref and reenvision:
        parts.append(
            f"{grid_header}\n"
            f"RE-ENVISION MODE: The User_reference shows the subject. "
            f"Each of the 16 cells must be a DIFFERENT creative reimagining of that subject "
            f"in the chosen style — vary pose, angle, proportions, expression, and details. "
            f"Do NOT copy the reference literally."
        )
    else:
        parts.append(
            f"{grid_header}\n"
            f"IMPORTANT: All 16 must be DIFFERENT — vary the shape, size, angle, detail, and design. "
            f"No two cells should look the same."
        )

    if user_prompt.strip():
        parts.append(user_prompt.strip())

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

    prompt = _build_grid_prompt(
        element_type=req.element_type,
        user_prompt=req.prompt,
        cell_w=cell_w,
        cell_h=cell_h,
        reenvision=req.reenvision,
        has_ref=has_ref,
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
    pixels: int = 1


@router.post("/trim-alpha")
async def trim_alpha(req: AlphaTrimRequest):
    """Shrink (positive) or expand (negative) the alpha border by N pixels."""
    raw = req.image_b64.split(",", 1)[-1] if "," in req.image_b64 else req.image_b64
    img = core.b64_to_image(raw)
    result = _shrink_alpha_border(img, req.pixels)
    return {
        "image_b64": core.image_to_b64(result),
        "width": result.width,
        "height": result.height,
    }
