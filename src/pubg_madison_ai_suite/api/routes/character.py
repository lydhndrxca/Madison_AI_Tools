"""Character Generator API routes."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CharacterGenerateRequest(BaseModel):
    description: str
    age: str = ""
    race: str = ""
    gender: str = ""
    build: str = ""
    view_type: str = "main"             # main, front, back, side
    reference_image_b64: Optional[str] = None
    edit_prompt: Optional[str] = None
    ref_a_b64: Optional[str] = None
    ref_b_b64: Optional[str] = None
    ref_c_b64: Optional[str] = None
    mode: str = "quality"
    model_id: Optional[str] = None
    bible_context: Optional[str] = None
    costume_context: Optional[str] = None
    fusion_context: Optional[str] = None
    fusion_image_1_b64: Optional[str] = None
    fusion_image_2_b64: Optional[str] = None
    style_guidance: Optional[str] = None
    env_context: Optional[str] = None
    lock_constraints: Optional[str] = None
    recreate_mode: bool = False
    custom_sections_context: Optional[str] = None
    custom_section_images: Optional[list[str]] = None
    variation_hint: Optional[str] = None


class CharacterResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class CharacterGridResponse(BaseModel):
    cells: Optional[list[str]] = None
    full_grid_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    cell_width: int = 0
    cell_height: int = 0
    error: Optional[str] = None


class AttributeRequest(BaseModel):
    description: str = ""
    image_b64: Optional[str] = None


class AttributeResponse(BaseModel):
    description: str = ""
    attributes: Optional[dict] = None
    age: str = ""
    race: str = ""
    gender: str = ""
    build: str = ""
    bible: Optional[dict] = None
    costume: Optional[dict] = None
    environment: Optional[dict] = None
    error: Optional[str] = None


class TextRequest(BaseModel):
    text: str
    operation: str = "enhance"          # enhance, randomize


class CharacterContextRequest(BaseModel):
    """Existing character state passed for context-aware randomize / enhance."""
    description: str = ""
    age: str = ""
    race: str = ""
    gender: str = ""
    build: str = ""
    attributes: Optional[dict] = None
    bible: Optional[dict] = None
    costume: Optional[dict] = None


class TextResponse(BaseModel):
    text: Optional[str] = None
    error: Optional[str] = None


class RandomizeFullResponse(BaseModel):
    description: Optional[str] = None
    age: str = ""
    race: str = ""
    gender: str = ""
    build: str = ""
    attributes: Optional[dict] = None
    bible: Optional[dict] = None
    costume: Optional[dict] = None
    environment: Optional[dict] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Shared prompt fragments for Bible + Costume
# ---------------------------------------------------------------------------

_BIBLE_COSTUME_PROMPT = (
    '- "bible": object with keys:\n'
    '    "characterName": string (a fitting character name),\n'
    '    "roleArchetype": string (role/archetype, e.g. "Villain, warrior queen"),\n'
    '    "backstory": string (2-3 sentences of backstory),\n'
    '    "worldContext": string (world/setting description),\n'
    '    "designIntent": string (creative design goal),\n'
    '    "productionStyle": array of strings (pick 1-3 from: "Clive Barker", "A24", '
    '"Tim Burton", "Zack Snyder", "Quentin Tarantino", "Daniel Warren Johnson", '
    '"David Fincher", "Denis Villeneuve", "Ridley Scott", "Christopher Nolan", '
    '"George Miller", "Jordan Peele", "Wes Anderson", "James Cameron"),\n'
    '    "customDirector": string (custom production note or empty),\n'
    '    "toneTags": array of strings (pick relevant from: "Feminine", "Masculine", '
    '"Powerful", "Bold", "Wicked", "Modern", "Cutting edge", "High fashion", '
    '"Blockbuster movie quality", "Iconic", "Timeless", "Grounded in reality", "Cinematic")\n'
    '- "costume": object with keys:\n'
    '    "costumeStyles": array of strings (pick relevant from: "Heavy metal", '
    '"Punk rock", "Industrial", "Gothic", "Art nouveau", "Techwear", "Rockabilly", '
    '"Outlaw biker", "Pro wrestling", "Streetwear", "High fashion", "Military surplus", '
    '"Thrift store DIY", "Cyberpunk", "Noir", "Western", "Samurai", "Victorian", '
    '"Afrofuturism", "Brutalism", "Anti-establishment", "Blood magic", '
    '"Racing leathers", "Demolition derby"),\n'
    '    "costumeCustomStyles": string (additional custom style notes or empty),\n'
    '    "costumeMaterials": array of strings (pick relevant from: "Matte leather", '
    '"Patent leather", "Distressed leather", "Satin", "Bronze metal", "Chrome metal", '
    '"Blackened metal", "Canvas", "Mesh", "Vinyl", "Fur", "Rubber", "Wool", "Chainmail"),\n'
    '    "primaryColor": string (primary color description),\n'
    '    "secondaryColor": string (secondary color),\n'
    '    "accentColor": string (accent color),\n'
    '    "hardwareColor": string (one of: "bronze", "chrome", "gold", "blackened", '
    '"copper", "pewter", "gunmetal"),\n'
    '    "hwDetails": array of strings (pick relevant from: "buckles", "snaps", '
    '"zippers", "rivets", "grommets", "chains", "studs", "clasps", "armor plates", '
    '"trim/edging"),\n'
    '    "origin": array of strings (pick relevant from: "Custom fabrication", '
    '"Hardware/thrift", "Found/assembled", "Military surplus", "Haute couture", '
    '"Stage/performance", "Ceremonial"),\n'
    '    "costumeNotes": string (additional costume direction or empty)\n'
)

_ENVIRONMENT_PROMPT = (
    '- "environment": object with keys:\n'
    '    "location": string (a vivid, specific environment description e.g. '
    '"Abandoned summer camp", "Urban alley — night", "Industrial warehouse", '
    '"Gothic cathedral interior", "Rooftop — city skyline", or custom),\n'
    '    "timeOfDay": string (one of: "Dawn — cold blue", "Golden hour — warm amber", '
    '"Midday — harsh direct", "Overcast — soft diffused", "Dusk — purple-orange", '
    '"Night — moonlit", "Night — artificial light", "Twilight — blue hour", or custom),\n'
    '    "lighting": string (one of: "Dappled forest light", "Harsh direct sun", '
    '"Soft diffused overcast", "Rim-lit from behind", "Campfire / torch light", '
    '"Neon mixed color", "Studio three-point", "Dramatic chiaroscuro", '
    '"Volumetric fog", "Underwater caustics", "Fluorescent industrial", or custom),\n'
    '    "pose": string (scene-appropriate pose e.g. "Standing — relaxed", '
    '"Crouching — ready", "Action — mid-combat", or custom pose description),\n'
    '    "props": string (environmental props/objects near the character, or empty),\n'
    '    "camera": string (one of: "Full body", "Waist up (cowboy)", '
    '"Portrait — head & shoulders", "Wide establishing", '
    '"Low angle — heroic", "High angle — vulnerable", or custom),\n'
    '    "outputFormat": string (aspect ratio like "3:4 — portrait", "16:9 — cinematic wide", etc.)\n'
)


def _parse_full_response(data: dict) -> dict:
    """Extract standard fields from a parsed JSON response dict."""
    return dict(
        description=data.get("description", ""),
        age=data.get("age", ""),
        race=data.get("race", ""),
        gender=data.get("gender", ""),
        build=data.get("build", ""),
        attributes=data.get("attributes"),
        bible=data.get("bible"),
        costume=data.get("costume"),
        environment=data.get("environment"),
    )


# ---------------------------------------------------------------------------
# Character description builder
# ---------------------------------------------------------------------------

def _build_character_prompt(req: CharacterGenerateRequest) -> str:
    parts = []
    if req.age:
        parts.append(f"Age: {req.age}")
    if req.race:
        parts.append(f"Race: {req.race}")
    if req.gender:
        parts.append(f"Gender: {req.gender}")
    if req.build:
        parts.append(f"Build: {req.build}")
    if parts:
        header = ", ".join(parts)
        prompt = f"{header}\n\n{req.description}"
    else:
        prompt = req.description

    if req.bible_context:
        prompt += f"\n\n--- Character Bible ---\n{req.bible_context}"

    has_costume = bool(req.costume_context)
    has_fusion = bool(req.fusion_context)
    if has_costume and has_fusion:
        prompt += (
            f"\n\n--- Costume Direction + Style Fusion (MERGE THESE) ---\n"
            f"The Costume Director defines the base outfit — materials, colors, hardware, and construction:\n"
            f"{req.costume_context}\n\n"
            f"The Style Fusion layer adds an aesthetic/fashion influence on top:\n"
            f"{req.fusion_context}\n\n"
            f"IMPORTANT: Blend both seamlessly. Use the Costume Director's specific garment details, "
            f"materials, and colors as the foundation, then apply the Style Fusion's aesthetic "
            f"influence to the overall look and feel. Where they conflict, favor the Costume Director's "
            f"concrete details (specific colors, materials, hardware) and the Style Fusion's broader "
            f"mood and style sensibility."
        )
    else:
        if has_costume:
            prompt += f"\n\n--- Costume Direction ---\n{req.costume_context}"
        if has_fusion:
            prompt += f"\n\n--- Style Fusion ---\n{req.fusion_context}"

    if req.style_guidance:
        prompt += f"\n\n--- Style Library Guidance ---\n{req.style_guidance}"
    if req.env_context:
        prompt += f"\n\n--- Environment & Placement ---\nPlace the character in a real scene/environment as described below. Do NOT use a flat or solid-color background.\n{req.env_context}"
    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"
    if req.lock_constraints:
        prompt += (
            f"\n\n--- PRESERVATION CONSTRAINTS (CRITICAL — HIGHEST PRIORITY, DO NOT VIOLATE) ---\n"
            f"The following constraints OVERRIDE all other instructions above. "
            f"If any costume, style fusion, environment, or other direction conflicts with these "
            f"constraints, the constraints WIN. Do not deviate from these under any circumstances.\n"
            f"{req.lock_constraints}"
        )

    if req.variation_hint:
        prompt += f"\n\n--- Creative Direction ---\n{req.variation_hint}"

    return prompt


# ---------------------------------------------------------------------------
# Sync workers
# ---------------------------------------------------------------------------

def _do_generate(req: CharacterGenerateRequest) -> CharacterResponse:
    api_key = core.get_api_key()
    if not api_key:
        return CharacterResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    prompt = _build_character_prompt(req)
    aspect = "9:16"
    image_size = "4K" if req.mode == "quality" else "1K"

    contents: list = []

    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    for label, b64 in [("ref_a", req.ref_a_b64), ("ref_b", req.ref_b_b64), ("ref_c", req.ref_c_b64)]:
        if b64:
            contents.append(core.b64_to_image(b64))
    for b64 in [req.fusion_image_1_b64, req.fusion_image_2_b64]:
        if b64:
            contents.append(core.b64_to_image(b64))
    for b64 in (req.custom_section_images or []):
        if b64:
            contents.append(core.b64_to_image(b64))

    if req.env_context:
        style_rules = (
            "STRICT RULES: Realistic 3D-rendered style. NOT illustrated, NOT cartoon, NOT painted. "
            "No text, no labels, no names, no color swatches, no annotations anywhere on the image. "
            "Place the character in the described environment. Full body visible head to toe."
        )
        pose_rule = ""
    else:
        style_rules = (
            "ABSOLUTE MANDATORY BACKGROUND RULE — THIS OVERRIDES EVERYTHING ELSE IN THE PROMPT: "
            "The background MUST be a solid flat single-color backdrop with the EXACT hex color #343434 (dark grey). "
            "There must be ZERO environmental elements — NO ground textures, NO floor tiles, NO wooden planks, "
            "NO dirt, NO concrete, NO grass, NO rocks, NO props, NO furniture, NO traffic cones, NO vehicles, "
            "NO buildings, NO scenery, NO shadows on the ground, NO horizon line, NO anything except the character "
            "standing on the plain solid #343434 dark grey backdrop. Even if the character description mentions a setting, "
            "job, or environment — IGNORE that for the background. The character floats on a flat #343434 color.\n\n"
            "STYLE RULES: Realistic 3D-rendered style. NOT illustrated, NOT cartoon, NOT painted. "
            "No text, no labels, no names, no color swatches, no annotations anywhere on the image. "
            "Full body visible head to toe."
        )
        pose_rule = (
            "\nPOSE RULE: The character MUST be in a relaxed standing pose with arms resting "
            "naturally at their sides (NOT an A-pose, NOT arms spread). Arms hang down loosely, "
            "hands relaxed by their hips/thighs, shoulders at ease, feet about shoulder-width "
            "apart, weight evenly distributed — like a person standing casually at rest. "
            "UNLESS the prompt explicitly specifies a different pose. Do NOT add any action "
            "poses, leaning, crouching, or interaction with objects unless the user specifically "
            "asked for it."
        )

    if req.edit_prompt and req.reference_image_b64:
        contents.append(
            f"{style_rules}{pose_rule}\n\n{prompt}\n\nApply these changes: {req.edit_prompt}"
        )
    elif req.recreate_mode and req.reference_image_b64:
        contents.append(
            f"{style_rules}{pose_rule}\n\n"
            f"RECREATE MODE: You are given a reference image of a character. "
            f"Recreate this character as accurately as possible — match the face, body type, "
            f"hairstyle, clothing, accessories, colors, materials, and every visual detail exactly. "
            f"The result should look like the same character rendered fresh, not a copy/paste. "
            f"Use the following description and attributes to guide any details not clearly visible "
            f"in the reference:\n{prompt}"
        )
    elif req.view_type != "main" and req.reference_image_b64:
        view_label = req.view_type.replace("_", " ")
        # Main stage is often already a 3/4 hero shot; without an explicit identity lock, models may
        # "re-interpret" instead of matching. Other views (front/back/side) read as clear rotations.
        identity_lock = ""
        if req.view_type == "three_quarter":
            identity_lock = (
                "CRITICAL — SAME CHARACTER AS REFERENCE: The first image is the canonical main-stage design. "
                "Output must be the SAME individual — identical face, hairstyle, hair color, skin tone, "
                "body type, costume, materials, colors, and accessories. Do not substitute or redesign a "
                "different character. Only adjust camera to a clear standard three-quarter (3/4) view "
                "(full body, neutral pose per rules below); preserve every identity detail from the reference.\n\n"
            )
        contents.append(
            f"{style_rules}{pose_rule}\n\n"
            f"{identity_lock}"
            f"Using the reference character image, generate a {view_label} view of this character. "
            f"Match the exact same character, outfit, and proportions.\n{prompt}"
        )
    else:
        contents.append(
            f"{style_rules}{pose_rule}\n\nGenerate a full-body character.\n{prompt}"
        )

    model_info = core.get_model_info(req.model_id)

    try:
        if model_info["multimodal"]:
            result = core.gemini_generate_image(
                api_key, contents,
                aspect_ratio=aspect, image_size=image_size, cancel_event=cancel,
                model_id=req.model_id,
            )
        else:
            result = core.imagen_generate(
                api_key, contents[-1] if isinstance(contents[-1], str) else prompt,
                aspect_ratio=aspect, image_size=image_size,
            )
    except RuntimeError as e:
        return CharacterResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return CharacterResponse(error="Generation failed")

    gen_type = "edit" if req.edit_prompt else "generate"
    core.save_generated_image(
        result, "Character Generator", view_name=req.view_type,
        generation_type=gen_type,
        metadata={"description": req.description, "age": req.age,
                  "race": req.race, "gender": req.gender, "build": req.build},
    )

    return CharacterResponse(
        image_b64=core.image_to_b64(result),
        width=result.width,
        height=result.height,
    )


def _do_generate_grid(req: CharacterGenerateRequest) -> CharacterGridResponse:
    """Generate a 4×4 sprite sheet of character variations, then crop into 16 cells."""
    from PIL import Image

    api_key = core.get_api_key()
    if not api_key:
        return CharacterGridResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    base_prompt = _build_character_prompt(req)

    # Detect whether the description specifies an environment/background.
    has_env = bool(req.env_context)

    bg_instruction = (
        "Each cell uses the EXACT background/environment described in the character "
        "description below — do NOT override it."
        if has_env else
        "Background: solid dark grey #343434 behind every cell — no environments, "
        "no scenery, no props on the ground."
    )

    grid_header = (
        "4×4 character variation sheet: Generate a single image containing a 4×4 grid "
        "(4 columns, 4 rows = 16 cells) of 16 DIFFERENT character design interpretations.\n\n"
        "WHAT MUST DIFFER between the 16 cells:\n"
        "- Each cell is a UNIQUE character design / interpretation of the spec below.\n"
        "- Vary: facial features, hairstyle, body proportions, costume design choices, "
        "color palette, material finishes, accessories, detailing, and overall silhouette.\n"
        "- Every cell should feel like a distinctly different character that fits the same brief.\n\n"
        "WHAT MUST BE IDENTICAL across ALL 16 cells:\n"
        "- The EXACT pose described in the character attributes below. If the attributes say "
        "'relaxed standing, arms at sides' every character must be in a relaxed standing pose "
        "with arms resting naturally at their sides. Do NOT change the pose per cell.\n"
        "- The same camera angle / view for every cell.\n"
        f"- {bg_instruction}\n\n"
        "Layout rules:\n"
        "- Keep all 16 characters evenly spaced in a clean 4×4 grid with no overlap and "
        "no grid lines.\n"
        "- Realistic 3D-rendered style. NOT illustrated, NOT cartoon, NOT painted.\n"
        "- No text, labels, or annotations anywhere."
    )

    prompt = f"{grid_header}\n\n--- Character Description ---\n{base_prompt}"

    contents: list = []
    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    for b64 in [req.ref_a_b64, req.ref_b_b64, req.ref_c_b64]:
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
            api_key, contents, aspect_ratio="3:4", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return CharacterGridResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return CharacterGridResponse(error="Generation failed")

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
                cell, "Character Generator",
                view_name=f"grid_{row}_{col}",
                generation_type="grid",
                metadata={"description": req.description[:200]},
            )

    return CharacterGridResponse(
        cells=cells_b64,
        full_grid_b64=core.image_to_b64(result),
        width=canvas_w,
        height=canvas_h,
        cell_width=cell_w,
        cell_height=cell_h,
    )


def _do_extract_attributes(description: str, image_b64: str | None = None) -> AttributeResponse:
    api_key = core.get_api_key()
    if not api_key:
        return AttributeResponse(error="No API key")

    try:
        import base64

        prompt = (
            "You are a character design analyst for film and game production. "
            "Extract extremely detailed character attributes as JSON with these keys:\n\n"
            '- "description": string \u2014 A rich 3-5 sentence visual description. Include physique, '
            "face shape, distinguishing marks (scars, tattoos, freckles), skin tone, "
            "expression/mood, hair length/style/color, and overall silhouette.\n\n"
            '- "age": string (best match from: "teen (18\u201319)", "young adult (20\u201329)", '
            '"adult (30\u201345)", "middle-aged (46\u201365)", "senior (66+)", or empty string)\n'
            '- "race": string (best match from: "Black / African descent", '
            '"White / European descent", "East Asian", "South Asian", "Southeast Asian", '
            '"Hispanic / Latine", "Middle Eastern / North African", "Indigenous", '
            '"Pacific Islander", "Mixed", "Other / not specified", or empty string)\n'
            '- "gender": string (best match from: "male", "female", "non-binary", '
            '"genderqueer", "trans masc", "trans femme", "androgynous", "unspecified", '
            'or empty string)\n'
            '- "build": string (best match from: "slim", "average", "athletic", '
            '"muscular", "curvy", "heavyset", "soft/doughy", "unfit", or empty string)\n\n'
            '- "attributes": object \u2014 Be very specific and descriptive for each. '
            "If something is not visible or mentioned, use empty string.\n"
            '    "Headwear": string (e.g. "black wool beanie, slightly slouched", "none")\n'
            '    "Outerwear": string (e.g. "distressed brown leather bomber jacket, collar popped, patches on left arm")\n'
            '    "Top": string (e.g. "faded grey henley shirt, rolled sleeves to elbows, buttons undone")\n'
            '    "Legwear": string (e.g. "dark indigo slim-cut cargo pants, reinforced knee panels")\n'
            '    "Footwear": string (e.g. "scuffed black combat boots, steel toe, laced halfway")\n'
            '    "Gloves": string (e.g. "fingerless black tactical gloves, worn leather")\n'
            '    "FaceGear": string (e.g. "round dark aviator sunglasses", "gas mask", or "none")\n'
            '    "UtilityRig": string (e.g. "canvas chest harness with ammo pouches", "leather tool belt")\n'
            '    "BackCarry": string (e.g. "military rucksack, olive drab, straps frayed")\n'
            '    "HandProp": string (e.g. "baseball bat wrapped in barbed wire", or "none")\n'
            '    "Accessories": string (e.g. "silver dog tags, braided leather wristband, ear cuff")\n'
            '    "ColorAccents": string (e.g. "red lining in jacket, orange stitching on boots")\n'
            '    "Detailing": string (e.g. "oil stains on pants, frayed cuffs, brass rivets on jacket")\n'
            '    "Pose": string \u2014 ALWAYS set to "Relaxed standing, arms at sides" (standing casually, arms hanging naturally by sides, hands relaxed at hips/thighs, feet shoulder-width apart). Do NOT infer any other pose.\n\n'
            + _BIBLE_COSTUME_PROMPT
            + _ENVIRONMENT_PROMPT +
            "\nReturn ONLY valid JSON. Be as detailed and specific as possible \u2014 "
            "imagine you are writing notes for a 3D modeler and costume department.\n\n"
        )

        contents: list = []
        if image_b64:
            raw = image_b64.split(",", 1)[-1] if "," in image_b64 else image_b64
            img_bytes = base64.b64decode(raw)
            contents.append({"mime_type": "image/png", "data": img_bytes})
            if description.strip():
                prompt += f"The character description is: {description}\n"
            else:
                prompt += "Analyze the character in this image.\n"
        else:
            prompt += description

        contents.append(prompt)

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", contents, cost_category="extraction")
        if data is None:
            return AttributeResponse(error="No response from Gemini")
        return AttributeResponse(
            description=data.get("description", ""),
            attributes=data.get("attributes"),
            age=data.get("age", ""),
            race=data.get("race", ""),
            gender=data.get("gender", ""),
            build=data.get("build", ""),
            bible=data.get("bible"),
            costume=data.get("costume"),
            environment=data.get("environment"),
        )
    except Exception as e:
        return AttributeResponse(error=str(e))


def _do_enhance(text: str, ctx: CharacterContextRequest | None = None) -> RandomizeFullResponse:
    api_key = core.get_api_key()
    if not api_key:
        return RandomizeFullResponse(error="No API key")
    try:
        context_text = _build_context_summary(ctx) if ctx else ""
        has_full_context = bool(context_text.strip())

        if has_full_context:
            instruction = (
                "The user has a character with the following details. "
                "Enhance and polish every field - add vivid detail, richer description, "
                "more specific attributes, and deeper lore. Keep the same character concept "
                "and identity, but make everything more refined, detailed, and production-ready. "
                "Do NOT change the fundamental nature of what the user specified - only improve it.\n\n"
                f"CURRENT CHARACTER STATE:\n{context_text}\n\n"
            )
        else:
            instruction = (
                "Enhance and expand the following character description with vivid detail. "
                "Keep the core concept but add visual richness.\n\n"
                f"Original description:\n\n{text}\n\n"
            )

        full_prompt = (
            instruction +
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (a rich 3-5 sentence visual description including physique, '
            "face, distinguishing features, skin tone, hair, expression, and silhouette)\n"
            '- "age": string (best match from: "teen (18\u201319)", "young adult (20\u201329)", '
            '"adult (30\u201345)", "middle-aged (46\u201365)", "senior (66+)", or empty string)\n'
            '- "race": string (best match from: "Black / African descent", '
            '"White / European descent", "East Asian", "South Asian", "Southeast Asian", '
            '"Hispanic / Latine", "Middle Eastern / North African", "Indigenous", '
            '"Pacific Islander", "Mixed", "Other / not specified", or empty string)\n'
            '- "gender": string (best match from: "male", "female", "non-binary", '
            '"genderqueer", "trans masc", "trans femme", "androgynous", "unspecified", '
            'or empty string)\n'
            '- "build": string (best match from: "slim", "average", "athletic", '
            '"muscular", "curvy", "heavyset", "soft/doughy", "unfit", or empty string)\n'
            '- "attributes": object \u2014 Be very specific and descriptive for each:\n'
            '    "Headwear": string (material, color, style, condition)\n'
            '    "Outerwear": string (jacket/coat type, material, color, details)\n'
            '    "Top": string (shirt/vest type, color, fit, details)\n'
            '    "Legwear": string (pants/skirt type, color, fit, details)\n'
            '    "Footwear": string (shoe/boot type, color, condition)\n'
            '    "Gloves": string (type, material, style)\n'
            '    "FaceGear": string (glasses, mask, goggles, etc.)\n'
            '    "UtilityRig": string (belts, holsters, harnesses)\n'
            '    "BackCarry": string (backpack, quiver, etc.)\n'
            '    "HandProp": string (weapon, tool, item held)\n'
            '    "Accessories": string (jewelry, wristbands, etc.)\n'
            '    "ColorAccents": string (notable color details)\n'
            '    "Detailing": string (wear, damage, stitching, etc.)\n'
            '    "Pose": ALWAYS "Relaxed standing, arms at sides" \u2014 do NOT change this\n'
            + _BIBLE_COSTUME_PROMPT
            + _ENVIRONMENT_PROMPT
        )

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [full_prompt])
        if data is None:
            return RandomizeFullResponse(error="No response from Gemini")
        return RandomizeFullResponse(**_parse_full_response(data))
    except Exception as e:
        return RandomizeFullResponse(error=str(e))


def _do_randomize() -> TextResponse:
    api_key = core.get_api_key()
    if not api_key:
        return TextResponse(error="No API key")
    try:
        text = core.rest_generate_text(
            api_key, "gemini-2.0-flash",
            "Generate a random, detailed character description for a game character. "
            "Include appearance, clothing, gear, and personality hints. "
            "Be creative and specific. 3-5 sentences."
        )
        return TextResponse(text=text or "")
    except Exception as e:
        return TextResponse(error=str(e))


def _build_context_summary(ctx: CharacterContextRequest | None) -> str:
    """Build a human-readable summary of existing character fields for the AI prompt."""
    if ctx is None:
        return ""
    parts: list[str] = []
    if ctx.description.strip():
        parts.append(f"Description: {ctx.description.strip()}")
    if ctx.age:
        parts.append(f"Age: {ctx.age}")
    if ctx.race:
        parts.append(f"Race: {ctx.race}")
    if ctx.gender:
        parts.append(f"Gender: {ctx.gender}")
    if ctx.build:
        parts.append(f"Build: {ctx.build}")
    if ctx.attributes:
        filled = {k: v for k, v in ctx.attributes.items() if v}
        if filled:
            parts.append("Attributes: " + ", ".join(f"{k}={v}" for k, v in filled.items()))
    if ctx.bible:
        filled = {k: v for k, v in ctx.bible.items() if v and v != "[]"}
        if filled:
            parts.append("Bible: " + ", ".join(f"{k}={v}" for k, v in filled.items()))
    if ctx.costume:
        filled = {k: v for k, v in ctx.costume.items() if v and v != "[]"}
        if filled:
            parts.append("Costume: " + ", ".join(f"{k}={v}" for k, v in filled.items()))
    return "\n".join(parts)


def _do_randomize_full(ctx: CharacterContextRequest | None = None) -> RandomizeFullResponse:
    """Generate a random character with description, identity, attributes, bible, and costume."""
    api_key = core.get_api_key()
    if not api_key:
        return RandomizeFullResponse(error="No API key")
    try:
        context_text = _build_context_summary(ctx)
        has_context = bool(context_text.strip())

        if has_context:
            instruction = (
                "The user has already partially defined a game character. "
                "Use the details they provided as the creative foundation. "
                "Keep everything they specified, and expand/extrapolate all empty or missing fields "
                "to create a fully fleshed-out character that is consistent with what they gave you. "
                "Be creative with the parts they left blank, but stay true to the existing vision.\n\n"
                f"EXISTING CHARACTER INFO:\n{context_text}\n\n"
            )
        else:
            instruction = (
                "Generate a random, detailed game character for a realistic 3D game. "
                "Be creative and specific.\n\n"
            )

        full_prompt = (
            instruction +
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string \u2014 A rich 3-5 sentence visual description. Include physique, '
            "face shape, distinguishing marks (scars, tattoos, freckles), skin tone, "
            "expression/mood, hair length/style/color, and overall silhouette. "
            "Describe as a real person, not a cartoon or illustration.\n"
            '- "age": string (one of: "teen (18\u201319)", "young adult (20\u201329)", '
            '"adult (30\u201345)", "middle-aged (46\u201365)", "senior (66+)")\n'
            '- "race": string (one of: "Black / African descent", '
            '"White / European descent", "East Asian", "South Asian", "Southeast Asian", '
            '"Hispanic / Latine", "Middle Eastern / North African", "Indigenous", '
            '"Pacific Islander", "Mixed", "Other / not specified")\n'
            '- "gender": string (one of: "male", "female", "non-binary", '
            '"genderqueer", "trans masc", "trans femme", "androgynous", "unspecified")\n'
            '- "build": string (one of: "slim", "average", "athletic", '
            '"muscular", "curvy", "heavyset", "soft/doughy", "unfit")\n'
            '- "attributes": object \u2014 Be very specific and descriptive for each:\n'
            '    "Headwear": string (material, color, style, condition \u2014 or empty)\n'
            '    "Outerwear": string (jacket/coat type, material, color, details \u2014 or empty)\n'
            '    "Top": string (shirt/vest type, color, fit, details \u2014 or empty)\n'
            '    "Legwear": string (pants/skirt type, color, fit, details \u2014 or empty)\n'
            '    "Footwear": string (shoe/boot type, color, condition \u2014 or empty)\n'
            '    "Gloves": string (type, material, style \u2014 or empty)\n'
            '    "FaceGear": string (glasses, mask, goggles \u2014 or empty)\n'
            '    "UtilityRig": string (belts, holsters, harnesses \u2014 or empty)\n'
            '    "BackCarry": string (backpack, quiver, etc. \u2014 or empty)\n'
            '    "HandProp": string (weapon, tool, item held \u2014 or empty)\n'
            '    "Accessories": string (jewelry, wristbands, etc. \u2014 or empty)\n'
            '    "ColorAccents": string (notable color details \u2014 or empty)\n'
            '    "Detailing": string (wear, damage, stitching, etc. \u2014 or empty)\n'
            '    "Pose": ALWAYS "Relaxed standing, arms at sides" \u2014 do NOT use any other pose\n'
            + _BIBLE_COSTUME_PROMPT
            + _ENVIRONMENT_PROMPT +
            "Return ONLY the JSON, no markdown. "
            "Be as detailed and specific as possible for every field."
        )

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [full_prompt])
        if data is None:
            return RandomizeFullResponse(error="No response from Gemini")
        return RandomizeFullResponse(**_parse_full_response(data))
    except Exception as e:
        return RandomizeFullResponse(error=str(e))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=CharacterResponse)
async def generate(body: CharacterGenerateRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating character..."})
    result = await loop.run_in_executor(_pool, _do_generate, body)
    await manager.broadcast("status", {"message": result.error or "Character generated"})
    return result


@router.post("/generate-grid", response_model=CharacterGridResponse)
async def generate_grid(body: CharacterGenerateRequest):
    """Generate a 4×4 sprite sheet of character variations."""
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating 4×4 character sheet..."})
    result = await loop.run_in_executor(_pool, _do_generate_grid, body)
    await manager.broadcast("status", {"message": result.error or "Grid generated"})
    return result


@router.post("/edit", response_model=CharacterResponse)
async def edit(body: CharacterGenerateRequest):
    """Apply edits to existing character (same pipeline, edit_prompt required)."""
    if not body.edit_prompt:
        return CharacterResponse(error="edit_prompt required")
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Applying edits..."})
    result = await loop.run_in_executor(_pool, _do_generate, body)
    await manager.broadcast("status", {"message": result.error or "Edit applied"})
    return result


@router.post("/extract-attributes", response_model=AttributeResponse)
async def extract_attributes(body: AttributeRequest):
    if not body.description.strip() and not body.image_b64:
        return AttributeResponse(error="Provide a description or image")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_extract_attributes, body.description, body.image_b64)


@router.post("/enhance", response_model=RandomizeFullResponse)
async def enhance(body: CharacterContextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_enhance, body.description, body)


@router.post("/randomize", response_model=TextResponse)
async def randomize():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_randomize)


@router.post("/randomize-full", response_model=RandomizeFullResponse)
async def randomize_full(body: CharacterContextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_randomize_full, body)


# ---------------------------------------------------------------------------
# Upscale & Restore
# ---------------------------------------------------------------------------

class UpscaleRequest(BaseModel):
    image_b64: str
    scale_factor: str = "x2"
    context: str = ""
    model_id: Optional[str] = None


class RestoreRequest(BaseModel):
    image_b64: str
    context: str = ""
    model_id: Optional[str] = None


_DESCRIBE_FOR_RESTORE_PROMPT = (
    "You are a forensic character analyst. Describe this image with OBSESSIVE precision so it can be exactly recreated. "
    "Ignore any blur, artifacts, noise, or compression \u2014 describe what the character ACTUALLY looks like underneath the degradation.\n\n"
    "Cover EVERY aspect in this exact order:\n"
    "1. POSE & STANCE: Exact body position \u2014 which leg bears weight, arm positions, hand positions (open/fist/relaxed), head tilt, gaze direction, torso angle\n"
    "2. FACE: Exact features \u2014 eye shape/color, brow shape, nose shape, lip shape/color, jaw shape, skin tone (precise shade), expression, any facial hair\n"
    "3. HAIR: Style, length, color (precise shade), texture (straight/wavy/curly), how it falls, any accessories in hair\n"
    "4. HEAD-TO-TOE CLOTHING \u2014 describe each garment separately:\n"
    "   \u2022 Headwear/masks/helmets\n"
    "   \u2022 Upper body: collar type, sleeve length, fit, closures, layering order\n"
    "   \u2022 Lower body: type, fit, length\n"
    "   \u2022 Footwear: type, height, closures, sole\n"
    "5. MATERIALS for each garment: exact material (leather, denim, silk, etc.), surface finish (matte/glossy/worn), texture pattern, color (precise shade like \"oxblood leather\" not \"red\")\n"
    "6. ACCESSORIES: Every single item \u2014 belts, buckles, chains, jewelry, weapons, pouches, straps \u2014 exact placement on body, material, color\n"
    "7. MARKINGS: Any tattoos, scars, face paint, body paint \u2014 exact location, design, colors\n"
    "8. PROPORTIONS: Body type, height impression, shoulder width relative to hips\n"
    "9. CAMERA: Framing (full body/3-quarter), angle (eye-level/low/high), approximate focal length feel\n"
    "10. BACKGROUND: Describe exactly what is behind the character\n\n"
    "Write as one continuous, dense image generation prompt. No preamble, no commentary. Be surgically specific."
)


def _do_upscale(req: UpscaleRequest) -> CharacterResponse:
    api_key = core.get_api_key()
    if not api_key:
        return CharacterResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    try:
        source = core.b64_to_image(req.image_b64)
        ar = core.detect_aspect_ratio(source.width, source.height)
        factor_hint = {"x4": "maximum", "x3": "high"}.get(req.scale_factor, "moderate")

        if req.context.strip():
            prompt = (
                f"Reproduce this exact image at higher resolution. "
                f"CONTEXT: These are \"{req.context.strip()}\". "
                f"Preserve the original art style, pixel density, and visual characteristics exactly — "
                f"only increase clarity and detail fidelity. Do not smooth, blur, or anti-alias stylistic "
                f"features that are intentional (e.g. hard pixel edges in pixel art). "
                f"Preserve every detail, color, texture, and composition exactly as-is."
            )
        else:
            prompt = (
                f"Reproduce this exact image at {factor_hint} resolution. "
                f"Preserve every detail, color, texture, and composition exactly as-is. "
                f"Do not alter the content, style, or framing in any way. "
                f"Only increase clarity, sharpness, and detail fidelity."
            )

        contents: list = [source, prompt]
        result = core.gemini_generate_image(api_key, contents, aspect_ratio=ar, cancel_event=cancel, model_id=req.model_id)
        if result is None:
            return CharacterResponse(error="Upscale failed — no image returned")
        core.save_generated_image(result, "Character Generator", view_name="upscale", generation_type="upscale")
        return CharacterResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except RuntimeError as e:
        return CharacterResponse(error=str(e))
    except Exception as e:
        return CharacterResponse(error=f"Upscale failed: {e}")
    finally:
        release_cancel_event(cancel)


def _do_restore(req: RestoreRequest) -> CharacterResponse:
    api_key = core.get_api_key()
    if not api_key:
        return CharacterResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    try:
        source = core.b64_to_image(req.image_b64)
        ar = core.detect_aspect_ratio(source.width, source.height)

        # Step 1: Forensic description via fast vision model
        description = core.rest_generate_text_multimodal(
            api_key, "gemini-2.0-flash", [source, _DESCRIBE_FOR_RESTORE_PROMPT],
            cancel_event=cancel, cost_category="editing",
        )
        if not description:
            return CharacterResponse(error="Restore failed — could not analyze image")

        # Step 2: Regenerate at full fidelity with the reference image
        user_context = req.context.strip() if req.context else ""
        context_block = ""
        if user_context:
            context_block = (
                f"\nIMPORTANT CONTEXT: The source is \"{user_context}\". You MUST preserve this art style exactly — "
                "if these are pixel art, keep hard pixel edges and limited palette; if these are game UI icons, keep flat colors "
                "and sharp silhouettes; if these are screenshots, restore to the native rendering style. "
                "Do NOT smooth, anti-alias, or photorealize stylistic features that are intentional.\n\n"
            )

        restore_prompt = (
            "QUALITY RESTORATION — RECREATE THIS EXACT IMAGE AT MAXIMUM FIDELITY.\n\n"
            "The reference image has suffered quality degradation (blur, artifacts, noise, compression). "
            "Your job: recreate this SAME EXACT subject in the SAME EXACT composition — but rendered fresh "
            "with full resolution detail.\n\n"
            f"{context_block}"
            "WHAT MUST STAY IDENTICAL:\n"
            "- Subject identity, face, expression, gaze direction\n"
            "- Exact pose — every limb position, weight distribution, hand positions\n"
            "- Camera angle, framing, composition, and all spatial relationships\n"
            "- Color palette and lighting direction\n"
            "- Background content and depth\n"
            "- All accessories, weapons, and held items in their exact positions\n\n"
            "WHAT MUST BE FRESHLY RENDERED:\n"
            "- Crisp edges on every surface and silhouette\n"
            "- Clean material textures (leather grain, fabric weave, metal sheen)\n"
            "- Sharp facial features with natural skin detail\n"
            "- Precise clothing details (stitching, buttons, folds, patterns)\n"
            "- Clean background without noise or compression artifacts\n"
            "- Fine details like hair strands, jewelry, belt buckles at full clarity\n\n"
            "ZERO TEXT: Do not add any text, labels, watermarks, or annotations.\n\n"
            f"DETAILED DESCRIPTION (recreate this exactly):\n{description}"
        )

        contents: list = [source, restore_prompt]
        result = core.gemini_generate_image(api_key, contents, aspect_ratio=ar, cancel_event=cancel, model_id=req.model_id)
        if result is None:
            return CharacterResponse(error="Restore failed — regeneration returned no image")
        core.save_generated_image(result, "Character Generator", view_name="restore", generation_type="restore")
        return CharacterResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except RuntimeError as e:
        return CharacterResponse(error=str(e))
    except Exception as e:
        return CharacterResponse(error=f"Restore failed: {e}")
    finally:
        release_cancel_event(cancel)


@router.post("/upscale", response_model=CharacterResponse)
async def upscale(body: UpscaleRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Upscaling image..."})
    result = await loop.run_in_executor(_pool, _do_upscale, body)
    await manager.broadcast("status", {"message": result.error or "Image upscaled"})
    return result


@router.post("/restore", response_model=CharacterResponse)
async def restore(body: RestoreRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Restoring image quality..."})
    result = await loop.run_in_executor(_pool, _do_restore, body)
    await manager.broadcast("status", {"message": result.error or "Image quality restored"})
    return result
