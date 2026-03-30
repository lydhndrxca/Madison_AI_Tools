"""AI PropLab API routes — prop / environment object generation."""

from __future__ import annotations

import asyncio
import random
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)

# ---------------------------------------------------------------------------
# Prop domain data (ported from OKDo propPrompts.ts)
# ---------------------------------------------------------------------------

PROP_TYPE_OPTIONS = [
    "furniture", "hand tool", "weapon", "vehicle part", "container", "lighting",
    "electronics", "decorative object", "industrial equipment", "food / vessel",
    "textile / soft prop", "architectural element", "toy / game piece",
    "scientific instrument", "other",
]

SETTING_OPTIONS = [
    "contemporary", "near-future", "far-future sci-fi", "medieval", "renaissance",
    "industrial revolution", "art deco", "mid-century modern", "post-apocalyptic",
    "fantasy", "steampunk", "historical (unspecified)", "studio / neutral",
]

CONDITION_OPTIONS = [
    "pristine / mint", "light wear", "moderate wear", "heavy wear",
    "damaged / broken", "weathered / outdoor aged", "restored",
    "unfinished / raw", "stylized clean",
]

SCALE_OPTIONS = [
    "hand-held", "pocket-scale", "tabletop", "furniture-scale",
    "human-scale (wearable)", "room-scale / large", "miniature / maquette",
    "monumental",
]

PROP_ATTRIBUTE_GROUPS = [
    {"label": "Primary Material", "key": "primaryMaterial",
     "common": ["Oiled walnut — tight grain, hand-rubbed satin", "Cast iron — matte black, slight orange peel texture",
                "Brushed aluminum — directional grain, cool grey", "Forged steel — hammer marks, gun-blue patina",
                "Bone dry ceramic — unglazed, light speckle", "Waxed canvas — folded creases, dusty khaki",
                "Full-grain leather — veg tan, natural edge", "Tempered glass — beveled edge, faint green tint"],
     "rare": ["Obsidian glass — conchoidal chips at corners", "Bismuth crystal plating — stepped rainbow facets",
              "Fossil-inlaid resin — amber, trapped botanicals", "Meteoritic iron — Widmanstätten shimmer under raking light"]},
    {"label": "Secondary Materials", "key": "secondaryMaterials",
     "common": ["Brass hardware — satin lacquer, mild tarnish at touch points", "Black oxide fasteners — countersunk, flush",
                "Rubber feet — shore 70A, dust in pores", "Nylon webbing — herringbone weave, fray-sealed ends",
                "Copper rivets — domed, green oxide halos", "PE plastic trim — soft-touch overmold"],
     "rare": ["Mother-of-pearl inlay — thin strips, iridescent shift", "Shagreen wrap — polished ray skin, hex tile pattern",
              "Kevlar weave panel — visible cross-hatch under clear coat"]},
    {"label": "Surface Finish", "key": "surfaceFinish",
     "common": ["Matte powder coat — 10% sheen, even orange peel", "Satin polyurethane — subtle specular tail on edges",
                "Hand-planed wood — faint ripple, open pores", "Machine-sanded metal — 220 grit scratch pattern",
                "Eggshell paint — micro texture, soft highlights"],
     "rare": ["Oil-slick heat treatment — purple/teal interference", "Cerused grain — white paste lodged in open oak pores",
              "Hammer-tone enamel — fine dimpled landscape"]},
    {"label": "Wear & Damage", "key": "wearPattern",
     "common": ["Factory-new — no visible wear", "Light handling polish — high spots slightly brighter",
                "Edge softening — corners gently radiused from use", "Dust in recesses — engraved lines slightly filled",
                "Water rings — pale halos on horizontal wood"],
     "rare": ["Impact dent — paint cracked radially, bare metal peek", "Heat bluing migration — rainbow near exhaust vent",
              "Cable rub scar — braided imprint in lacquer"]},
    {"label": "Color Palette", "key": "colorPalette",
     "common": ["Charcoal, warm grey, bone accent", "Olive drab, rust brown, black trim",
                "Navy, brass, cream paper tone", "Terracotta, sand, dusty black metal",
                "Slate blue, silver, off-white ceramic"],
     "rare": ["Petrol blue, copper oxide green, graphite", "Desaturated plum, aged ivory, gunmetal"]},
    {"label": "Texture Detail", "key": "textureDetail",
     "common": ["Fine pitting across flat panels — uniform micro-dimples", "Directional brush marks — parallel to longest edge",
                "Woven fabric macro — visible thread crossing", "Pebbled leather — irregular grain islands",
                "Sand-cast roughness — chill lines near ribs"],
     "rare": ["Biological growth — faint lichen at underside lip", "Crazed lacquer — hairline web, matte valleys"]},
    {"label": "Functional Elements", "key": "functionalElements",
     "common": ["Hinged lid — gas strut assist, rubber bumper stops", "Keyed lock — brass escutcheon, slight wobble",
                "Drain hole — chamfered, water stain trail below", "Adjustable feet — threaded nylon, one corner raised",
                "Cable grommet — split rubber, dust feathering"],
     "rare": ["Quick-release pins — ball detents, polished heads", "Hidden magnet closure — seam gap < 0.5 mm"]},
    {"label": "Decorative Detail", "key": "decorativeDetail",
     "common": ["Engine-turned ring pattern — concentric on face plate", "Subtle Art Deco fluting — vertical grooves, even spacing",
                "Maker stamp — shallow relief, ink residue in recess", "Painted pinstripe — 1 mm, slightly wavy hand line",
                "No ornament — utilitarian silence"],
     "rare": ["Acid-etched sigil — darkened recess, polished rim", "Kintsugi repair — gold vein across ceramic cheek"]},
    {"label": "Material Response", "key": "lightingEffects",
     "common": ["Diffuse matte — even scatter, low reflectivity across surfaces",
                "Broad specular — soft highlight bloom on curved forms when lit",
                "Subsurface translucency — light passes through thin plastic/wax walls",
                "Micro-satin surface — kills hotspots, very low sheen"],
     "rare": ["Anisotropic reflectance — stretched highlight along brushed grain axis",
              "Thin-film interference — rainbow shift at grazing angles"]},
    {"label": "Context & Story", "key": "contextualStory",
     "common": ["Workshop prop — oil smudges, pencil tick marks", "Museum replica — overly clean, label adhesive ghost",
                "Film set hero — asymmetrical hero-side polish", "Street vendor object — sticker residue, corner tape"],
     "rare": ["Archeological reconstruction — mismatched patina patches", "Heirloom — monogram worn to near illegible"]},
]

ATTR_KEYS = [g["key"] for g in PROP_ATTRIBUTE_GROUPS]
ATTR_LABELS = {g["key"]: g["label"] for g in PROP_ATTRIBUTE_GROUPS}

PROP_VIEW_REQUESTS = {
    "main": (
        "HERO SHOT: Three-quarter front angle, camera slightly above eye-level, rotated about 30 degrees. "
        "The prop fills approximately 70% of the frame. LIGHTING: Completely flat, shadowless, uniform ambient "
        "illumination — like an overcast light-tent. Absolutely NO directional light, NO cast shadows, NO specular "
        "highlights, NO rim light. Solid flat neutral grey background, no environment, no floor shadow. "
        "Show the prop's most visually interesting and recognizable angle."
    ),
    "three_quarter": (
        "THREE-QUARTER VIEW: Camera placed at roughly 30-45 degrees from front, slightly above center height. "
        "Show the prop's dimensional form clearly. LIGHTING: Flat, shadowless, uniform ambient only. "
        "Solid grey background, no floor."
    ),
    "front": (
        "FRONT ELEVATION: Camera placed directly in front of the prop at center height, facing it dead-on. "
        "Orthographic projection, zero perspective distortion. The prop centered in frame, filling 70% vertically. "
        "LIGHTING: Flat, shadowless, uniform ambient only. Solid grey background, no floor."
    ),
    "back": (
        "REAR ELEVATION: Camera placed directly behind the prop at center height, facing the rear dead-on. "
        "Orthographic projection, zero perspective distortion. Only the back surface visible. "
        "LIGHTING: Flat, shadowless, uniform ambient only. Solid grey background, no floor."
    ),
    "side": (
        "SIDE ELEVATION: Camera placed at exactly 90 degrees to the left side, at center height. "
        "Orthographic projection, zero perspective distortion. PURE flat side-profile silhouette. "
        "LIGHTING: Flat, shadowless, uniform ambient only. Solid grey background, no floor."
    ),
    "top": (
        "PLAN VIEW / TOP-DOWN: Camera placed DIRECTLY ABOVE the prop, pointing STRAIGHT DOWN at exactly 90 degrees. "
        "Only the top surface visible — pure flat plan-view. The prop centered in frame. "
        "LIGHTING: Flat, shadowless, uniform ambient only. Solid grey background."
    ),
}

LOCK_DESIGN_BLOCK = (
    "DESIGN LOCK — MANDATORY:\n"
    "• SAME materials, colors, textures, surface finish\n"
    "• SAME wear patterns, damage, dirt, grime\n"
    "• SAME functional elements, handles, buttons, hinges\n"
    "• SAME decorative details, markings, labels\n"
    "• SAME proportions and scale\n"
    "• Do NOT add, remove, or change ANY details\n"
    "• ONLY change the camera angle"
)

PROP_STYLE_NOTES = (
    "Photorealistic product rendering for a AAA game asset pipeline. Real materials with accurate "
    "texture and wear detail. CRITICAL LIGHTING RULE: Completely flat, shadowless, uniform ambient "
    "illumination only — like an overcast light-tent. NO directional light, NO cast shadows, "
    "NO specular highlights, NO rim light, NO bounce light, NO ambient occlusion baked in. "
    "The prop must look like an unlit albedo/diffuse reference so it can be properly lit in-engine."
)


def _build_prop_description(identity: dict, attributes: dict, user_desc: str) -> str:
    parts: list[str] = []
    if user_desc.strip():
        parts.append(f"PROP CONCEPT: {user_desc.strip()}")
        parts.append("")
    ident_parts = [identity.get(k, "") for k in ("propType", "setting", "condition", "scale")]
    ident_parts = [p for p in ident_parts if p]
    if ident_parts:
        parts.append(f"IDENTITY: {', '.join(ident_parts)}")
    attr_lines: list[str] = []
    for g in PROP_ATTRIBUTE_GROUPS:
        val = (attributes.get(g["key"]) or "").strip()
        if val and val.lower() != "none":
            attr_lines.append(f"{g['label']}: {val}")
    if attr_lines:
        parts.append("")
        parts.append("ATTRIBUTES:")
        parts.extend(attr_lines)
    return "\n".join(parts)


def _build_prop_view_prompt(view_key: str, prop_description: str, style_override: str = "") -> str:
    view = PROP_VIEW_REQUESTS.get(view_key, PROP_VIEW_REQUESTS["main"])
    if view_key == "main":
        style_line = (
            f"STYLE: Render in the art style described: {style_override}. This takes priority over photorealism."
            if style_override else
            "STYLE: Photorealistic product rendering for a game asset pipeline — real materials with accurate texture and wear detail."
        )
        lighting_line = (
            "LIGHTING: Flat, shadowless, uniform ambient illumination only. Do NOT bake any directional light, shadows, or specular highlights."
            if style_override else
            "LIGHTING: Completely flat, shadowless, uniform ambient illumination only — like an overcast light-tent. "
            "NO directional light, NO cast shadows, NO specular highlights, NO rim light. "
            "The prop must appear evenly lit from all directions."
        )
        return "\n".join([
            "No text, labels, or watermarks in the image.",
            "",
            style_line,
            lighting_line,
            "BACKGROUND: Solid flat neutral grey (#343434) only. No environment, no floor.",
            "FRAMING: Prop fills ~70% of frame. Generous padding on all sides.",
            "",
            view,
            "",
            prop_description,
        ])
    else:
        style_line = (
            f"Render in the art style: {style_override}. Style takes priority."
            if style_override else
            "Photorealistic game asset rendering — real materials with accurate texture and wear."
        )
        return "\n".join([
            "No text, labels, or watermarks in the image.",
            "",
            style_line,
            "LIGHTING: Completely flat, shadowless, uniform ambient illumination only.",
            "",
            "Recompose the prop to the specified view. Preserve EXACT design, materials, wear, and all details.",
            "",
            view,
            "",
            LOCK_DESIGN_BLOCK,
            "",
            "Background: solid flat neutral grey (#343434). No floor, no environment.",
            "",
            prop_description,
        ])


EXTRACT_PROP_ATTRIBUTES_PROMPT = (
    "You are a forensic-level prop/object analysis tool for AAA game environment art. "
    "Study both the image AND the description below. Produce PRECISE, SPECIFIC attributes — not generic summaries.\n\n"
    "Return JSON only with this exact schema:\n{\n"
    '  "description": string (a rich 2-4 sentence description of this prop/object),\n'
    '  "propType": string,\n'
    '  "setting": string,\n'
    '  "condition": string,\n'
    '  "scale": string,\n'
    + ",\n".join(f'  "{g["key"]}": string' for g in PROP_ATTRIBUTE_GROUPS) + "\n}\n\n"
    "IDENTITY FIELDS — pick the closest match:\n"
    f"- propType: {' | '.join(repr(o) for o in PROP_TYPE_OPTIONS)}\n"
    f"- setting: {' | '.join(repr(o) for o in SETTING_OPTIONS)}\n"
    f"- condition: {' | '.join(repr(o) for o in CONDITION_OPTIONS)}\n"
    f"- scale: {' | '.join(repr(o) for o in SCALE_OPTIONS)}\n\n"
    "FIELD GUIDANCE:\n"
    "- primaryMaterial: exact primary material with finish detail\n"
    "- secondaryMaterials: supporting materials, fasteners, trim\n"
    "- surfaceFinish: surface treatment and sheen level\n"
    "- wearPattern: specific wear marks, scratches, dents — location and severity\n"
    "- colorPalette: 3-5 dominant colors with relationships\n"
    "- textureDetail: surface texture at close inspection\n"
    "- functionalElements: moving parts, mechanisms, interfaces\n"
    "- decorativeDetail: ornament, markings, engravings\n"
    "- lightingEffects: intrinsic material response — reflectivity, translucency, sheen\n"
    "- contextualStory: what the wear/marks tell about its history\n\n"
    "CRITICAL RULES:\n"
    "1. Be HYPER-SPECIFIC. 'Oiled walnut with tight grain and honey brown tone' NOT 'wooden'.\n"
    "2. Look at the IMAGE directly — the image is ground truth.\n"
    "3. Capture EVERY distinctive feature.\n"
    "4. NEVER write 'not visible', 'none', or 'unknown'. Extrapolate from visible style.\n"
    "Return ONLY JSON. No markdown, no extra text."
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PropGenerateRequest(BaseModel):
    description: str = ""
    prop_type: str = ""
    setting: str = ""
    condition: str = ""
    scale: str = ""
    attributes: Optional[dict] = None
    view_type: str = "main"
    reference_image_b64: Optional[str] = None
    ref_images: Optional[list[str]] = None
    edit_prompt: Optional[str] = None
    model_id: Optional[str] = None
    style_context: Optional[str] = None
    fusion_context: Optional[str] = None
    fusion_image_1_b64: Optional[str] = None
    fusion_image_2_b64: Optional[str] = None
    style_guidance: Optional[str] = None
    lock_constraints: Optional[str] = None
    recreate_mode: bool = False
    name: str = ""
    custom_sections_context: Optional[str] = None
    custom_section_images: Optional[list[str]] = None


class PropResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class PropGridResponse(BaseModel):
    cells: Optional[list[str]] = None
    full_grid_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    cell_width: int = 0
    cell_height: int = 0
    error: Optional[str] = None


class PropAttributeRequest(BaseModel):
    description: str = ""
    image_b64: Optional[str] = None


class PropAttributeResponse(BaseModel):
    description: str = ""
    propType: str = ""
    setting: str = ""
    condition: str = ""
    scale: str = ""
    attributes: Optional[dict] = None
    error: Optional[str] = None


class PropContextRequest(BaseModel):
    description: str = ""
    name: str = ""
    propType: str = ""
    setting: str = ""
    condition: str = ""
    scale: str = ""
    attributes: Optional[dict] = None


class PropRandomizeFullResponse(BaseModel):
    description: Optional[str] = None
    name: str = ""
    propType: str = ""
    setting: str = ""
    condition: str = ""
    scale: str = ""
    attributes: Optional[dict] = None
    error: Optional[str] = None


class UpscaleRequest(BaseModel):
    image_b64: str
    scale_factor: str = "x2"
    context: str = ""
    model_id: Optional[str] = None


class RestoreRequest(BaseModel):
    image_b64: str
    context: str = ""
    model_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Sync workers
# ---------------------------------------------------------------------------

def _do_generate(req: PropGenerateRequest) -> PropResponse:
    api_key = core.get_api_key()
    if not api_key:
        return PropResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    identity = {"propType": req.prop_type, "setting": req.setting, "condition": req.condition, "scale": req.scale}
    attrs = req.attributes or {}
    desc_text = req.description
    if req.name:
        desc_text = f"Prop name: {req.name}\n{desc_text}"

    prop_description = _build_prop_description(identity, attrs, desc_text)

    style_override = ""
    if req.style_context:
        style_override = req.style_context
    if req.fusion_context:
        if style_override:
            style_override += f"\n{req.fusion_context}"
        else:
            style_override = req.fusion_context
    if req.style_guidance:
        if style_override:
            style_override += f"\n{req.style_guidance}"
        else:
            style_override = req.style_guidance

    prompt = _build_prop_view_prompt(req.view_type, prop_description, style_override)

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    if req.lock_constraints:
        prompt += (
            f"\n\n--- PRESERVATION CONSTRAINTS (CRITICAL — HIGHEST PRIORITY) ---\n"
            f"{req.lock_constraints}"
        )

    contents: list = []
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
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

    if req.edit_prompt and req.reference_image_b64:
        contents.append(f"{prompt}\n\nApply these changes: {req.edit_prompt}")
    elif req.recreate_mode and req.reference_image_b64:
        contents.append(
            f"{prompt}\n\nRECREATE MODE: Recreate this prop as accurately as possible — "
            f"match materials, colors, wear, proportions, and every visual detail exactly."
        )
    elif req.view_type != "main" and req.reference_image_b64:
        view_label = req.view_type.replace("_", " ")
        contents.append(
            f"{prompt}\n\nUsing the reference prop image, generate a {view_label} view. "
            f"Match the exact same prop, materials, and proportions."
        )
    else:
        contents.append(f"{prompt}\n\nGenerate this prop/object.")

    model_info = core.get_model_info(req.model_id)

    try:
        if model_info["multimodal"]:
            result = core.gemini_generate_image(
                api_key, contents, aspect_ratio="1:1", image_size="4K",
                cancel_event=cancel, model_id=req.model_id,
            )
        else:
            result = core.imagen_generate(
                api_key, contents[-1] if isinstance(contents[-1], str) else prompt,
                aspect_ratio="1:1", image_size="4K",
            )
    except RuntimeError as e:
        return PropResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return PropResponse(error="Generation failed")

    core.save_generated_image(
        result, "AI PropLab", view_name=req.view_type,
        generation_type="generate",
        metadata={"description": req.description, "name": req.name,
                  "propType": req.prop_type, "setting": req.setting},
    )
    return PropResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)


def _do_generate_grid(req: PropGenerateRequest) -> PropGridResponse:
    """Generate a 4×4 sprite sheet of prop variations, then crop into 16 cells."""
    from PIL import Image

    api_key = core.get_api_key()
    if not api_key:
        return PropGridResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    identity = {"propType": req.prop_type, "setting": req.setting, "condition": req.condition, "scale": req.scale}
    attrs = req.attributes or {}
    desc_text = req.description
    if req.name:
        desc_text = f"Prop name: {req.name}\n{desc_text}"
    prop_description = _build_prop_description(identity, attrs, desc_text)

    style_override = ""
    if req.style_context:
        style_override = req.style_context
    if req.fusion_context:
        style_override = f"{style_override}\n{req.fusion_context}" if style_override else req.fusion_context
    if req.style_guidance:
        style_override = f"{style_override}\n{req.style_guidance}" if style_override else req.style_guidance

    base_prompt = _build_prop_view_prompt(req.view_type, prop_description, style_override)
    if req.custom_sections_context:
        base_prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    grid_header = (
        "4×4 prop variation sheet: Generate a single image containing a 4×4 grid "
        "(4 columns, 4 rows = 16 cells) of 16 DIFFERENT prop/object design interpretations.\n\n"
        "WHAT MUST DIFFER between the 16 cells:\n"
        "- Each cell is a UNIQUE design interpretation of the prop described below.\n"
        "- Vary: shape, silhouette, material choices, surface finish, wear level, "
        "decorative elements, proportions, color palette, and construction style.\n"
        "- Every cell should feel like a distinctly different prop that fits the same brief.\n\n"
        "WHAT MUST BE IDENTICAL across ALL 16 cells:\n"
        "- The same camera angle / view for every cell.\n"
        "- Background: solid chroma green #00FF00 behind every cell.\n\n"
        "Layout rules:\n"
        "- Keep all 16 props evenly spaced in a clean 4×4 grid with no overlap and "
        "no grid lines.\n"
        "- Realistic 3D-rendered style. NOT illustrated, NOT cartoon, NOT painted.\n"
        "- No text, labels, or annotations anywhere."
    )

    prompt = f"{grid_header}\n\n--- Prop Description ---\n{base_prompt}"

    contents: list = []
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
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
    contents.append(prompt)

    try:
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="1:1", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return PropGridResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return PropGridResponse(error="Generation failed")

    canvas_w, canvas_h = result.size
    cell_w = canvas_w // 4
    cell_h = canvas_h // 4

    if result.size != (cell_w * 4, cell_h * 4):
        result = result.resize((cell_w * 4, cell_h * 4), Image.Resampling.LANCZOS)

    cells_b64: list[str] = []
    for row in range(4):
        for col in range(4):
            x1, y1 = col * cell_w, row * cell_h
            cell = result.crop((x1, y1, x1 + cell_w, y1 + cell_h)).copy()
            cells_b64.append(core.image_to_b64(cell))
            core.save_generated_image(
                cell, "AI PropLab",
                view_name=f"grid_{row}_{col}",
                generation_type="grid",
                metadata={"description": req.description[:200], "name": req.name},
            )

    return PropGridResponse(
        cells=cells_b64,
        full_grid_b64=core.image_to_b64(result),
        width=canvas_w,
        height=canvas_h,
        cell_width=cell_w,
        cell_height=cell_h,
    )


def _do_extract_attributes(description: str, image_b64: str | None = None) -> PropAttributeResponse:
    api_key = core.get_api_key()
    if not api_key:
        return PropAttributeResponse(error="No API key")

    try:
        import base64
        prompt = EXTRACT_PROP_ATTRIBUTES_PROMPT
        contents: list = []
        if image_b64:
            raw = image_b64.split(",", 1)[-1] if "," in image_b64 else image_b64
            img_bytes = base64.b64decode(raw)
            contents.append({"mime_type": "image/png", "data": img_bytes})
            if description.strip():
                prompt += f"\nThe prop description is: {description}"
            else:
                prompt += "\nAnalyze the prop/object in this image."
        else:
            prompt += f"\n{description}"

        contents.append(prompt)
        data = core.rest_generate_json(api_key, "gemini-2.0-flash", contents, cost_category="extraction")
        if data is None:
            return PropAttributeResponse(error="No response from Gemini")

        attrs = {}
        for key in ATTR_KEYS:
            if key in data:
                attrs[key] = data[key]

        return PropAttributeResponse(
            description=data.get("description", ""),
            propType=data.get("propType", ""),
            setting=data.get("setting", ""),
            condition=data.get("condition", ""),
            scale=data.get("scale", ""),
            attributes=attrs,
        )
    except Exception as e:
        return PropAttributeResponse(error=str(e))


def _build_context_summary(ctx: PropContextRequest | None) -> str:
    if ctx is None:
        return ""
    parts: list[str] = []
    if ctx.name:
        parts.append(f"Name: {ctx.name}")
    if ctx.description.strip():
        parts.append(f"Description: {ctx.description.strip()}")
    if ctx.propType:
        parts.append(f"Prop type: {ctx.propType}")
    if ctx.setting:
        parts.append(f"Setting: {ctx.setting}")
    if ctx.condition:
        parts.append(f"Condition: {ctx.condition}")
    if ctx.scale:
        parts.append(f"Scale: {ctx.scale}")
    if ctx.attributes:
        filled = {k: v for k, v in ctx.attributes.items() if v}
        if filled:
            parts.append("Attributes: " + ", ".join(f"{k}={v}" for k, v in filled.items()))
    return "\n".join(parts)


def _do_enhance(text: str, ctx: PropContextRequest | None = None) -> PropRandomizeFullResponse:
    api_key = core.get_api_key()
    if not api_key:
        return PropRandomizeFullResponse(error="No API key")

    try:
        context_text = _build_context_summary(ctx) if ctx else ""
        has_context = bool(context_text.strip())

        if has_context:
            instruction = (
                "The user has a prop/object with the following details. "
                "Enhance and polish every field — add vivid detail, richer description, "
                "more specific attributes. Keep the same prop concept but make everything "
                "more refined, detailed, and production-ready.\n\n"
                f"CURRENT PROP STATE:\n{context_text}\n\n"
            )
        else:
            instruction = (
                "Enhance and expand the following prop description with vivid detail. "
                "Keep the core concept but add material richness and visual specificity.\n\n"
                f"Original description:\n\n{text}\n\n"
            )

        attr_schema = ",\n".join(f'    "{g["key"]}": string ({g["label"]} — be hyper-specific)' for g in PROP_ATTRIBUTE_GROUPS)
        full_prompt = (
            instruction +
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (2-4 sentence rich visual description)\n'
            '- "name": string (short prop name)\n'
            f'- "propType": string (one of: {", ".join(repr(o) for o in PROP_TYPE_OPTIONS)})\n'
            f'- "setting": string (one of: {", ".join(repr(o) for o in SETTING_OPTIONS)})\n'
            f'- "condition": string (one of: {", ".join(repr(o) for o in CONDITION_OPTIONS)})\n'
            f'- "scale": string (one of: {", ".join(repr(o) for o in SCALE_OPTIONS)})\n'
            '- "attributes": object with:\n'
            f'{attr_schema}\n'
        )

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [full_prompt])
        if data is None:
            return PropRandomizeFullResponse(error="No response from Gemini")

        attrs = {}
        for key in ATTR_KEYS:
            if key in data.get("attributes", {}):
                attrs[key] = data["attributes"][key]
            elif key in data:
                attrs[key] = data[key]

        return PropRandomizeFullResponse(
            description=data.get("description", ""),
            name=data.get("name", ""),
            propType=data.get("propType", ""),
            setting=data.get("setting", ""),
            condition=data.get("condition", ""),
            scale=data.get("scale", ""),
            attributes=attrs,
        )
    except Exception as e:
        return PropRandomizeFullResponse(error=str(e))


def _do_randomize_full(ctx: PropContextRequest | None = None) -> PropRandomizeFullResponse:
    api_key = core.get_api_key()
    if not api_key:
        return PropRandomizeFullResponse(error="No API key")

    try:
        context_text = _build_context_summary(ctx)
        has_context = bool(context_text.strip())

        if has_context:
            instruction = (
                "The user has partially defined a game prop/object. "
                "Use the details they provided as the creative foundation. "
                "Keep everything they specified, and expand all empty or missing fields "
                "to create a fully fleshed-out prop. Be creative with blank parts "
                "but stay true to the existing vision.\n\n"
                f"EXISTING PROP INFO:\n{context_text}\n\n"
            )
        else:
            instruction = (
                "Generate a random, detailed game prop/environment object for a realistic 3D game asset pipeline. "
                "Be creative and specific — this should be a unique, interesting object.\n\n"
            )

        attr_schema = ",\n".join(f'    "{g["key"]}": string ({g["label"]} — be hyper-specific)' for g in PROP_ATTRIBUTE_GROUPS)
        full_prompt = (
            instruction +
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (2-4 sentence rich visual description)\n'
            '- "name": string (short prop name)\n'
            f'- "propType": string (one of: {", ".join(repr(o) for o in PROP_TYPE_OPTIONS)})\n'
            f'- "setting": string (one of: {", ".join(repr(o) for o in SETTING_OPTIONS)})\n'
            f'- "condition": string (one of: {", ".join(repr(o) for o in CONDITION_OPTIONS)})\n'
            f'- "scale": string (one of: {", ".join(repr(o) for o in SCALE_OPTIONS)})\n'
            '- "attributes": object with:\n'
            f'{attr_schema}\n\n'
            "Return ONLY the JSON, no markdown."
        )

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [full_prompt])
        if data is None:
            return PropRandomizeFullResponse(error="No response from Gemini")

        attrs = {}
        for key in ATTR_KEYS:
            if key in data.get("attributes", {}):
                attrs[key] = data["attributes"][key]
            elif key in data:
                attrs[key] = data[key]

        return PropRandomizeFullResponse(
            description=data.get("description", ""),
            name=data.get("name", ""),
            propType=data.get("propType", ""),
            setting=data.get("setting", ""),
            condition=data.get("condition", ""),
            scale=data.get("scale", ""),
            attributes=attrs,
        )
    except Exception as e:
        return PropRandomizeFullResponse(error=str(e))


_DESCRIBE_FOR_RESTORE_PROMPT = (
    "You are a forensic prop analyst. Describe this object/prop with OBSESSIVE precision so it can be exactly recreated. "
    "Cover: overall form and silhouette, every material (primary, secondary, trim), surface finish and sheen, "
    "colors (precise shade names), wear patterns and damage (exact locations), functional elements (hinges, locks, handles), "
    "decorative details (engravings, stamps, inlays), proportions, camera angle, and background. "
    "Write as one continuous dense image generation prompt. No preamble."
)


def _do_upscale(req: UpscaleRequest) -> PropResponse:
    api_key = core.get_api_key()
    if not api_key:
        return PropResponse(error="No API key configured")
    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()
    try:
        source = core.b64_to_image(req.image_b64)
        factor_hint = {"x4": "maximum", "x3": "high"}.get(req.scale_factor, "moderate")
        prompt = (
            f"Reproduce this exact image at {factor_hint} resolution. "
            f"Preserve every detail, color, texture, and composition exactly as-is."
        )
        contents: list = [source, prompt]
        result = core.gemini_generate_image(api_key, contents, cancel_event=cancel, model_id=req.model_id)
        if result is None:
            return PropResponse(error="Upscale failed")
        core.save_generated_image(result, "AI PropLab", view_name="upscale", generation_type="upscale")
        return PropResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except Exception as e:
        return PropResponse(error=str(e))
    finally:
        release_cancel_event(cancel)


def _do_restore(req: RestoreRequest) -> PropResponse:
    api_key = core.get_api_key()
    if not api_key:
        return PropResponse(error="No API key configured")
    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()
    try:
        source = core.b64_to_image(req.image_b64)
        description = core.rest_generate_text_multimodal(
            api_key, "gemini-2.0-flash", [source, _DESCRIBE_FOR_RESTORE_PROMPT],
            cancel_event=cancel, cost_category="editing",
        )
        if not description:
            return PropResponse(error="Restore failed — could not analyze image")
        restore_prompt = (
            "QUALITY RESTORATION — Recreate this prop image at maximum quality.\n\n"
            "WHAT MUST STAY IDENTICAL: Object identity, proportions, composition, "
            "camera angle, color palette, background.\n\n"
            "WHAT MUST BE FRESHLY RENDERED: Crisp edges, clean material textures, "
            "precise details.\n\n"
            f"DETAILED DESCRIPTION:\n{description}"
        )
        contents: list = [source, restore_prompt]
        result = core.gemini_generate_image(api_key, contents, cancel_event=cancel, model_id=req.model_id)
        if result is None:
            return PropResponse(error="Restore failed")
        core.save_generated_image(result, "AI PropLab", view_name="restore", generation_type="restore")
        return PropResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except Exception as e:
        return PropResponse(error=str(e))
    finally:
        release_cancel_event(cancel)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=PropResponse)
async def generate(body: PropGenerateRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating prop image..."})
    result = await loop.run_in_executor(_pool, _do_generate, body)
    await manager.broadcast("status", {"message": result.error or "Prop generated"})
    return result


@router.post("/generate-grid", response_model=PropGridResponse)
async def generate_grid(body: PropGenerateRequest):
    """Generate a 4×4 sprite sheet of prop variations."""
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating 4×4 prop sheet..."})
    result = await loop.run_in_executor(_pool, _do_generate_grid, body)
    await manager.broadcast("status", {"message": result.error or "Grid generated"})
    return result


@router.post("/extract-attributes", response_model=PropAttributeResponse)
async def extract_attributes(body: PropAttributeRequest):
    if not body.description.strip() and not body.image_b64:
        return PropAttributeResponse(error="Provide a description or image")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_extract_attributes, body.description, body.image_b64)


@router.post("/enhance", response_model=PropRandomizeFullResponse)
async def enhance(body: PropContextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_enhance, body.description, body)


@router.post("/randomize-full", response_model=PropRandomizeFullResponse)
async def randomize_full(body: PropContextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_randomize_full, body)


@router.post("/upscale", response_model=PropResponse)
async def upscale(body: UpscaleRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Upscaling prop image..."})
    result = await loop.run_in_executor(_pool, _do_upscale, body)
    await manager.broadcast("status", {"message": result.error or "Prop upscaled"})
    return result


@router.post("/restore", response_model=PropResponse)
async def restore(body: RestoreRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Restoring prop image..."})
    result = await loop.run_in_executor(_pool, _do_restore, body)
    await manager.broadcast("status", {"message": result.error or "Prop restored"})
    return result
