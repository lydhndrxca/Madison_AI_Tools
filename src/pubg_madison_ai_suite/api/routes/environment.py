"""AI Environment Lab API routes — video game environment concept art."""

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
# Environment domain data
# ---------------------------------------------------------------------------

BIOME_OPTIONS = [
    "urban", "suburban", "industrial", "rural", "forest", "jungle", "desert",
    "arctic", "mountain", "coastal", "underground", "interior", "rooftop",
    "wasteland", "sci-fi",
]

GAME_CONTEXT_OPTIONS = [
    "battle royale open world", "close-quarters CQB", "linear corridor",
    "verticality-focused", "vehicle-friendly", "sniper overwatch",
    "mixed engagement",
]

TIME_OF_DAY_OPTIONS = [
    "dawn", "golden hour", "midday", "overcast", "dusk", "blue hour",
    "night (moonlit)", "night (artificial)", "storm",
]

SEASON_WEATHER_OPTIONS = [
    "clear spring", "summer heat haze", "autumn fog", "winter snow",
    "rain", "dust storm", "overcast", "dynamic mixed",
]

SCALE_OPTIONS = [
    "small POI", "medium compound", "large landmark", "vista / panorama",
    "interior room", "interior complex",
]

ENV_ATTRIBUTE_GROUPS = [
    {"label": "Architecture Style", "key": "architectureStyle",
     "common": ["Brutalist concrete high-rises, exposed rebar, repetitive window grid",
                "Prefab modular housing, corrugated metal siding, flat roofs",
                "Colonial brick facades, arched windows, wrought-iron railings",
                "Industrial steel frame, riveted beams, gantry walkways",
                "Mid-century modern, clean lines, large glass panels"],
     "rare": ["Deconstructivist angles, clashing geometries, cantilevered volumes",
              "Vernacular earth-built, rammed earth walls, thatch roofing"]},
    {"label": "Ground / Terrain", "key": "groundTerrain",
     "common": ["Cracked asphalt with weed pushthrough, puddle reflections, tire marks",
                "Packed dirt road, wheel ruts, gravel shoulders",
                "Concrete sidewalk, expansion joints, gum stains, cracks",
                "Forest floor — leaf litter, exposed roots, moss patches",
                "Sandy terrain, wind ripples, sparse scrub tufts"],
     "rare": ["Volcanic basalt flow, rope lava texture, steam vents",
              "Frozen lake surface, pressure cracks, trapped air bubbles"]},
    {"label": "Vegetation", "key": "vegetation",
     "common": ["Overgrown ivy on east walls, dead grass patches, sparse birch trees",
                "Manicured hedgerows gone wild, clipped privet reverting to shape",
                "Palm trees lining boulevard, brown fronds hanging",
                "Dense underbrush, ferns, fallen logs with shelf fungus",
                "Dry prairie grass, waist-high, seed heads catching light"],
     "rare": ["Bioluminescent moss colonies on cave walls",
              "Mangrove root system, tidal waterline, barnacle crust"]},
    {"label": "Atmospheric Effects", "key": "atmosphericEffects",
     "common": ["Volumetric fog in alleys, dust motes in light shafts, distant haze",
                "Heat shimmer off asphalt, compressed horizon",
                "Low-hanging cloud cover, muted colors, flat light",
                "Morning mist lifting from river, dew on surfaces",
                "Smoke drifting from structure fires, reduced visibility"],
     "rare": ["Aurora borealis shimmer through broken ceiling",
              "Ash fall — grey flakes drifting slowly, thin layer on all surfaces"]},
    {"label": "Lighting Mood", "key": "lightingMood",
     "common": ["Warm low sun raking across facades, deep shadow corridors, bounce light",
                "Harsh midday overhead, minimal shadows, washed surfaces",
                "Cold blue overcast, even diffuse light, muted reflections",
                "Golden hour backlight, long shadows, warm edge highlights",
                "Artificial mixed — sodium street lamps, fluorescent interiors, neon signs"],
     "rare": ["God rays through cathedral-scale breach in ceiling",
              "Infrared-style false color, surveillance aesthetic"]},
    {"label": "Color Palette", "key": "colorPalette",
     "common": ["Desaturated olive, rust orange, concrete grey, muted teal sky",
                "Warm earth tones — sienna, ochre, terracotta, dusty cream",
                "Cool urban — slate blue, charcoal, steel grey, dirty white",
                "Military — olive drab, khaki, dark brown, black accent",
                "Tropical — deep green, sky blue, bleached coral, wet dark wood"],
     "rare": ["Neon-contrast — deep black shadows, hot pink, electric cyan accents",
              "Monochrome ash grey with single warm accent (fire, rust, signal red)"]},
    {"label": "Material Focus", "key": "materialFocus",
     "common": ["Peeling paint on metal, wet concrete, corrugated steel roofing, rotting wood",
                "Brick and mortar, crumbling pointing, efflorescence stains",
                "Glass and steel curtain wall, reflections, spider-crack damage",
                "Timber cladding, weathered silver, split grain",
                "Tile and plaster, Mediterranean, chipped edges revealing substrate"],
     "rare": ["Kevlar and carbon fiber military fortification panels",
              "Ice and frost buildup on metal, condensation drip trails"]},
    {"label": "Props / Clutter", "key": "propsClutter",
     "common": ["Abandoned vehicles, overturned furniture, sandbag barricades, graffiti",
                "Shopping carts, scattered newspapers, fast-food litter, traffic cones",
                "Military — ammo crates, razor wire, radio equipment, tarp shelters",
                "Construction — scaffolding, pallets, cement mixers, orange fencing",
                "Domestic — laundry lines, potted plants, bicycles, mailboxes"],
     "rare": ["Makeshift memorial — flowers, candles, photos, teddy bears",
              "Collapsed infrastructure — fallen power lines, buckled road plates"]},
    {"label": "Sightlines / Composition", "key": "sightlinesComposition",
     "common": ["Strong leading lines from road converging to vanishing point",
                "Framed vista through archway or doorway",
                "Layered depth — foreground clutter, midground structures, distant skyline",
                "Symmetrical corridor, forced perspective, narrowing walls",
                "Open clearing with 360-degree exposure, central landmark"],
     "rare": ["Vertigo composition — looking down stairwell or elevator shaft",
              "Split level — half underground, half above, cross-section feel"]},
    {"label": "Narrative Elements", "key": "narrativeElements",
     "common": ["Signs of recent evacuation — open doors, running water, dropped belongings",
                "Military checkpoint — concrete barriers, guard booth, tire spikes",
                "Civilian life interrupted — set dinner table, TV on static, toys on floor",
                "Industrial accident — chemical spill, caution tape, hazmat signs",
                "Overgrowth reclaiming — nature taking back abandoned structures"],
     "rare": ["Cult or faction territory markers — spray-painted symbols, totem stacks",
              "Time-frozen disaster — clock stopped, calendar on event date"]},
]

ATTR_KEYS = [g["key"] for g in ENV_ATTRIBUTE_GROUPS]

# ---------------------------------------------------------------------------
# View prompts
# ---------------------------------------------------------------------------

ENV_VIEW_REQUESTS = {
    "main": (
        "HERO SHOT: Dramatic establishing angle showing the environment at its most visually compelling. "
        "Camera placed at roughly player height (~170cm), angled to create strong depth with foreground, "
        "midground, and background layers. The environment fills the entire frame. Show a human-scale "
        "reference (silhouette, vehicle, or familiar object) to establish scale. "
        "Cinematic composition with leading lines drawing the eye into the scene."
    ),
    "player_pov": (
        "PLAYER POV: First-person camera at exactly 170cm height, natural gameplay perspective. "
        "The view should feel like a player standing in this environment looking at the most "
        "interesting direction. Show what a player would see during gameplay — paths, cover, "
        "landmarks for navigation. Natural field of view (~90 degrees). Ground visible at bottom."
    ),
    "birds_eye": (
        "BIRD'S EYE: Camera placed directly above the environment, pointing straight down at 90 degrees. "
        "Show the full layout — paths, buildings, open areas, cover positions, chokepoints. "
        "Like a tactical overhead map but rendered photorealistically. "
        "All structures visible as rooftops/canopy. Scale reference included."
    ),
    "panoramic": (
        "PANORAMIC: Ultra-wide cinematic establishing shot, 2.39:1 aspect feel even in 16:9 frame. "
        "Camera pulled back to show the full scope and scale of the environment. "
        "Epic vista composition with sky taking upper third, environment filling lower two-thirds. "
        "Emphasize the vastness and mood of the location."
    ),
    "detail": (
        "DETAIL CLOSE-UP: Tight crop on the most distinctive material/architectural detail of this "
        "environment. Show surface textures, weathering, wear patterns at near-macro level. "
        "This should demonstrate the material quality and production value — grout lines in brick, "
        "rust blooms on metal, paint peeling, concrete aggregate. Fill the frame with texture."
    ),
}

ENV_STYLE_NOTES = (
    "AAA video game environment concept art for an FPS / battle-royale title. "
    "Unreal Engine 5 quality — photorealistic PBR materials, ray-traced global illumination, "
    "volumetric atmospherics, high-detail mesh density. Realistic scale and proportions. "
    "Playable space — this must look like a real game environment a player can navigate, "
    "with clear paths, cover, verticality, and tactical interest. "
    "No text, labels, watermarks, UI elements, or annotations in the image."
)

LOCK_DESIGN_BLOCK = (
    "DESIGN LOCK — MANDATORY:\n"
    "- SAME architecture style, building shapes, proportions\n"
    "- SAME materials, colors, weathering, damage patterns\n"
    "- SAME vegetation placement and density\n"
    "- SAME props, clutter, and environmental storytelling\n"
    "- SAME atmospheric conditions and lighting mood\n"
    "- SAME scale and spatial relationships\n"
    "- ONLY change the camera angle/position"
)


def _build_env_description(identity: dict, attributes: dict, user_desc: str) -> str:
    parts: list[str] = []
    if user_desc.strip():
        parts.append(f"ENVIRONMENT CONCEPT: {user_desc.strip()}")
        parts.append("")
    ident_parts = [identity.get(k, "") for k in ("biome", "gameContext", "timeOfDay", "seasonWeather", "scale")]
    ident_parts = [p for p in ident_parts if p]
    if ident_parts:
        parts.append(f"IDENTITY: {', '.join(ident_parts)}")
    attr_lines: list[str] = []
    for g in ENV_ATTRIBUTE_GROUPS:
        val = (attributes.get(g["key"]) or "").strip()
        if val and val.lower() != "none":
            attr_lines.append(f"{g['label']}: {val}")
    if attr_lines:
        parts.append("")
        parts.append("ATTRIBUTES:")
        parts.extend(attr_lines)
    return "\n".join(parts)


def _build_env_view_prompt(view_key: str, env_description: str, style_override: str = "") -> str:
    view = ENV_VIEW_REQUESTS.get(view_key, ENV_VIEW_REQUESTS["main"])
    style_line = (
        f"STYLE: {style_override}" if style_override
        else f"STYLE: {ENV_STYLE_NOTES}"
    )
    if view_key == "main":
        return "\n".join([
            "No text, labels, or watermarks in the image.",
            "",
            style_line,
            "ASPECT RATIO: 16:9 landscape.",
            "",
            view,
            "",
            env_description,
        ])
    else:
        return "\n".join([
            "No text, labels, or watermarks in the image.",
            "",
            style_line,
            "",
            "Recompose the environment to the specified camera angle. "
            "Preserve EXACT design, materials, atmosphere, and all details.",
            "",
            view,
            "",
            LOCK_DESIGN_BLOCK,
            "",
            env_description,
        ])


EXTRACT_ENV_ATTRIBUTES_PROMPT = (
    "You are a forensic-level environment analysis tool for AAA game level art. "
    "Study both the image AND the description below. Produce PRECISE, SPECIFIC attributes.\n\n"
    "Return JSON only with this exact schema:\n{\n"
    '  "description": string (a rich 3-5 sentence description of this environment),\n'
    '  "biome": string,\n'
    '  "gameContext": string,\n'
    '  "timeOfDay": string,\n'
    '  "seasonWeather": string,\n'
    '  "scale": string,\n'
    + ",\n".join(f'  "{g["key"]}": string' for g in ENV_ATTRIBUTE_GROUPS) + "\n}\n\n"
    "IDENTITY FIELDS — pick the closest match:\n"
    f"- biome: {' | '.join(repr(o) for o in BIOME_OPTIONS)}\n"
    f"- gameContext: {' | '.join(repr(o) for o in GAME_CONTEXT_OPTIONS)}\n"
    f"- timeOfDay: {' | '.join(repr(o) for o in TIME_OF_DAY_OPTIONS)}\n"
    f"- seasonWeather: {' | '.join(repr(o) for o in SEASON_WEATHER_OPTIONS)}\n"
    f"- scale: {' | '.join(repr(o) for o in SCALE_OPTIONS)}\n\n"
    "FIELD GUIDANCE:\n"
    "- architectureStyle: exact building/structure style with construction details\n"
    "- groundTerrain: surface materials, damage, organic growth\n"
    "- vegetation: specific plant types, density, placement\n"
    "- atmosphericEffects: fog, haze, particles, weather effects\n"
    "- lightingMood: light direction, quality, color temperature, shadow behavior\n"
    "- colorPalette: 4-6 dominant colors with relationships\n"
    "- materialFocus: key surface materials with wear/texture detail\n"
    "- propsClutter: specific objects, placement, density\n"
    "- sightlinesComposition: camera angles, depth layers, framing\n"
    "- narrativeElements: environmental storytelling, signs of activity/history\n\n"
    "CRITICAL RULES:\n"
    "1. Be HYPER-SPECIFIC. Describe exact materials, colors, damage patterns.\n"
    "2. The IMAGE is ground truth.\n"
    "3. Think like a game level artist describing this to a 3D team.\n"
    "4. NEVER write 'not visible', 'none', or 'unknown'.\n"
    "Return ONLY JSON. No markdown."
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class EnvGenerateRequest(BaseModel):
    description: str = ""
    name: str = ""
    biome: str = ""
    game_context: str = ""
    time_of_day: str = ""
    season_weather: str = ""
    env_scale: str = ""
    attributes: Optional[dict] = None
    view_type: str = "main"
    reference_image_b64: Optional[str] = None
    ref_images: Optional[list[str]] = None
    edit_prompt: Optional[str] = None
    model_id: Optional[str] = None
    fusion_context: Optional[str] = None
    fusion_image_1_b64: Optional[str] = None
    fusion_image_2_b64: Optional[str] = None
    style_guidance: Optional[str] = None
    lock_constraints: Optional[str] = None
    recreate_mode: bool = False
    custom_sections_context: Optional[str] = None
    custom_section_images: Optional[list[str]] = None


class EnvResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class EnvGridResponse(BaseModel):
    cells: Optional[list[str]] = None
    full_grid_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    cell_width: int = 0
    cell_height: int = 0
    error: Optional[str] = None


class EnvAttributeRequest(BaseModel):
    description: str = ""
    image_b64: Optional[str] = None


class EnvAttributeResponse(BaseModel):
    description: str = ""
    biome: str = ""
    gameContext: str = ""
    timeOfDay: str = ""
    seasonWeather: str = ""
    scale: str = ""
    attributes: Optional[dict] = None
    error: Optional[str] = None


class EnvContextRequest(BaseModel):
    description: str = ""
    name: str = ""
    biome: str = ""
    gameContext: str = ""
    timeOfDay: str = ""
    seasonWeather: str = ""
    scale: str = ""
    attributes: Optional[dict] = None


class EnvRandomizeFullResponse(BaseModel):
    description: Optional[str] = None
    name: str = ""
    biome: str = ""
    gameContext: str = ""
    timeOfDay: str = ""
    seasonWeather: str = ""
    scale: str = ""
    attributes: Optional[dict] = None
    error: Optional[str] = None


class ReimagineRequest(BaseModel):
    image_b64: str
    context: str = ""
    style_direction: str = "photorealistic concept art"
    model_id: Optional[str] = None


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

def _do_generate(req: EnvGenerateRequest) -> EnvResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnvResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    identity = {
        "biome": req.biome, "gameContext": req.game_context,
        "timeOfDay": req.time_of_day, "seasonWeather": req.season_weather,
        "scale": req.env_scale,
    }
    attrs = req.attributes or {}
    desc_text = req.description
    if req.name:
        desc_text = f"Environment name: {req.name}\n{desc_text}"

    env_description = _build_env_description(identity, attrs, desc_text)

    style_override = ""
    if req.fusion_context:
        style_override = req.fusion_context
    if req.style_guidance:
        style_override = f"{style_override}\n{req.style_guidance}" if style_override else req.style_guidance

    prompt = _build_env_view_prompt(req.view_type, env_description, style_override)

    if req.custom_sections_context:
        prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    if req.lock_constraints:
        prompt += f"\n\n--- PRESERVATION CONSTRAINTS (HIGHEST PRIORITY) ---\n{req.lock_constraints}"

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
            f"{prompt}\n\nRECREATE MODE: Recreate this environment as accurately as possible — "
            f"match composition, architecture, materials, lighting, atmosphere, and every detail exactly."
        )
    elif req.view_type != "main" and req.reference_image_b64:
        view_label = req.view_type.replace("_", " ")
        contents.append(
            f"{prompt}\n\nUsing the reference environment image, generate a {view_label} view. "
            f"Match the exact same environment, materials, and atmosphere."
        )
    else:
        contents.append(f"{prompt}\n\nGenerate this game environment.")

    model_info = core.get_model_info(req.model_id)

    try:
        if model_info["multimodal"]:
            result = core.gemini_generate_image(
                api_key, contents, aspect_ratio="16:9", image_size="4K",
                cancel_event=cancel, model_id=req.model_id,
            )
        else:
            result = core.imagen_generate(
                api_key, contents[-1] if isinstance(contents[-1], str) else prompt,
                aspect_ratio="16:9", image_size="4K",
            )
    except RuntimeError as e:
        return EnvResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return EnvResponse(error="Generation failed")

    core.save_generated_image(
        result, "AI Environment Lab", view_name=req.view_type,
        generation_type="generate",
        metadata={"description": req.description, "name": req.name, "biome": req.biome},
    )
    return EnvResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)


def _do_generate_grid(req: EnvGenerateRequest) -> EnvGridResponse:
    """Generate a 4×4 sprite sheet of environment variations, then crop into 16 cells."""
    from PIL import Image

    api_key = core.get_api_key()
    if not api_key:
        return EnvGridResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    identity = {
        "biome": req.biome, "gameContext": req.game_context,
        "timeOfDay": req.time_of_day, "seasonWeather": req.season_weather,
        "scale": req.env_scale,
    }
    attrs = req.attributes or {}
    desc_text = req.description
    if req.name:
        desc_text = f"Environment name: {req.name}\n{desc_text}"
    env_description = _build_env_description(identity, attrs, desc_text)

    style_override = ""
    if req.fusion_context:
        style_override = req.fusion_context
    if req.style_guidance:
        style_override = f"{style_override}\n{req.style_guidance}" if style_override else req.style_guidance

    base_prompt = _build_env_view_prompt(req.view_type, env_description, style_override)
    if req.custom_sections_context:
        base_prompt += f"\n\n--- Custom Directions ---\n{req.custom_sections_context}"

    grid_header = (
        "4×4 environment variation sheet: Generate a single image containing a 4×4 grid "
        "(4 columns, 4 rows = 16 cells) of environment/scene variations.\n"
        "Each cell shows ONE environment scene based on the description below, but each "
        "of the 16 MUST be a DIFFERENT creative variation — vary the camera angle, "
        "time of day, weather, lighting mood, season, composition, and atmospheric effects. "
        "No two cells should look the same.\n"
        "Keep all 16 scenes evenly spaced in a clean grid with no overlap or grid lines.\n"
        "Realistic 3D-rendered game environment style. NOT illustrated, NOT cartoon, NOT painted.\n"
        "No text, labels, or annotations anywhere."
    )

    prompt = f"{grid_header}\n\n--- Environment Description ---\n{base_prompt}"

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
            api_key, contents, aspect_ratio="16:9", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
    except RuntimeError as e:
        return EnvGridResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return EnvGridResponse(error="Generation failed")

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
                cell, "AI Environment Lab",
                view_name=f"grid_{row}_{col}",
                generation_type="grid",
                metadata={"description": req.description[:200], "name": req.name},
            )

    return EnvGridResponse(
        cells=cells_b64,
        full_grid_b64=core.image_to_b64(result),
        width=canvas_w,
        height=canvas_h,
        cell_width=cell_w,
        cell_height=cell_h,
    )


def _do_extract_attributes(description: str, image_b64: str | None = None) -> EnvAttributeResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnvAttributeResponse(error="No API key")

    try:
        import base64
        prompt = EXTRACT_ENV_ATTRIBUTES_PROMPT
        contents: list = []
        if image_b64:
            raw = image_b64.split(",", 1)[-1] if "," in image_b64 else image_b64
            img_bytes = base64.b64decode(raw)
            contents.append({"mime_type": "image/png", "data": img_bytes})
            if description.strip():
                prompt += f"\nThe environment description is: {description}"
            else:
                prompt += "\nAnalyze the environment in this image."
        else:
            prompt += f"\n{description}"

        contents.append(prompt)
        data = core.rest_generate_json(api_key, "gemini-2.0-flash", contents, cost_category="extraction")
        if data is None:
            return EnvAttributeResponse(error="No response from Gemini")

        attrs = {}
        for key in ATTR_KEYS:
            if key in data:
                attrs[key] = data[key]

        return EnvAttributeResponse(
            description=data.get("description", ""),
            biome=data.get("biome", ""),
            gameContext=data.get("gameContext", ""),
            timeOfDay=data.get("timeOfDay", ""),
            seasonWeather=data.get("seasonWeather", ""),
            scale=data.get("scale", ""),
            attributes=attrs,
        )
    except Exception as e:
        return EnvAttributeResponse(error=str(e))


def _build_context_summary(ctx: EnvContextRequest | None) -> str:
    if ctx is None:
        return ""
    parts: list[str] = []
    if ctx.name:
        parts.append(f"Name: {ctx.name}")
    if ctx.description.strip():
        parts.append(f"Description: {ctx.description.strip()}")
    if ctx.biome:
        parts.append(f"Biome: {ctx.biome}")
    if ctx.gameContext:
        parts.append(f"Game context: {ctx.gameContext}")
    if ctx.timeOfDay:
        parts.append(f"Time of day: {ctx.timeOfDay}")
    if ctx.seasonWeather:
        parts.append(f"Season/weather: {ctx.seasonWeather}")
    if ctx.scale:
        parts.append(f"Scale: {ctx.scale}")
    if ctx.attributes:
        filled = {k: v for k, v in ctx.attributes.items() if v}
        if filled:
            parts.append("Attributes: " + ", ".join(f"{k}={v}" for k, v in filled.items()))
    return "\n".join(parts)


def _do_enhance(text: str, ctx: EnvContextRequest | None = None) -> EnvRandomizeFullResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnvRandomizeFullResponse(error="No API key")

    try:
        context_text = _build_context_summary(ctx) if ctx else ""
        has_context = bool(context_text.strip())

        if has_context:
            instruction = (
                "The user has a game environment concept with the following details. "
                "Enhance and polish every field — add vivid environmental detail, richer atmosphere, "
                "more specific material callouts, stronger narrative elements. "
                "Keep the same environment concept but make everything production-ready for a AAA FPS.\n\n"
                f"CURRENT ENVIRONMENT STATE:\n{context_text}\n\n"
            )
        else:
            instruction = (
                "Enhance this game environment description with vivid detail for AAA FPS production.\n\n"
                f"Original:\n\n{text}\n\n"
            )

        attr_schema = ",\n".join(f'    "{g["key"]}": string ({g["label"]})' for g in ENV_ATTRIBUTE_GROUPS)
        full_prompt = (
            instruction +
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (3-5 sentence rich environment description)\n'
            '- "name": string (short environment name)\n'
            f'- "biome": string (one of: {", ".join(repr(o) for o in BIOME_OPTIONS)})\n'
            f'- "gameContext": string (one of: {", ".join(repr(o) for o in GAME_CONTEXT_OPTIONS)})\n'
            f'- "timeOfDay": string (one of: {", ".join(repr(o) for o in TIME_OF_DAY_OPTIONS)})\n'
            f'- "seasonWeather": string (one of: {", ".join(repr(o) for o in SEASON_WEATHER_OPTIONS)})\n'
            f'- "scale": string (one of: {", ".join(repr(o) for o in SCALE_OPTIONS)})\n'
            '- "attributes": object with:\n'
            f'{attr_schema}\n'
        )

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [full_prompt])
        if data is None:
            return EnvRandomizeFullResponse(error="No response from Gemini")

        attrs = {}
        for key in ATTR_KEYS:
            if key in data.get("attributes", {}):
                attrs[key] = data["attributes"][key]
            elif key in data:
                attrs[key] = data[key]

        return EnvRandomizeFullResponse(
            description=data.get("description", ""),
            name=data.get("name", ""),
            biome=data.get("biome", ""),
            gameContext=data.get("gameContext", ""),
            timeOfDay=data.get("timeOfDay", ""),
            seasonWeather=data.get("seasonWeather", ""),
            scale=data.get("scale", ""),
            attributes=attrs,
        )
    except Exception as e:
        return EnvRandomizeFullResponse(error=str(e))


def _do_randomize_full(ctx: EnvContextRequest | None = None) -> EnvRandomizeFullResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnvRandomizeFullResponse(error="No API key")

    try:
        context_text = _build_context_summary(ctx)
        has_context = bool(context_text.strip())

        if has_context:
            instruction = (
                "The user has partially defined a game environment. "
                "Use the details they provided as the creative foundation. "
                "Keep everything they specified, and expand all empty fields "
                "to create a fully realized environment for a AAA FPS / battle-royale title.\n\n"
                f"EXISTING ENVIRONMENT:\n{context_text}\n\n"
            )
        else:
            instruction = (
                "Generate a random, detailed game environment for a realistic AAA FPS / battle-royale title. "
                "Be creative and specific — this should feel like a real playable level location.\n\n"
            )

        attr_schema = ",\n".join(f'    "{g["key"]}": string ({g["label"]} — be hyper-specific)' for g in ENV_ATTRIBUTE_GROUPS)
        full_prompt = (
            instruction +
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (3-5 sentence rich environment description)\n'
            '- "name": string (short environment name, e.g. "Harbor District", "Outpost Ridge")\n'
            f'- "biome": string (one of: {", ".join(repr(o) for o in BIOME_OPTIONS)})\n'
            f'- "gameContext": string (one of: {", ".join(repr(o) for o in GAME_CONTEXT_OPTIONS)})\n'
            f'- "timeOfDay": string (one of: {", ".join(repr(o) for o in TIME_OF_DAY_OPTIONS)})\n'
            f'- "seasonWeather": string (one of: {", ".join(repr(o) for o in SEASON_WEATHER_OPTIONS)})\n'
            f'- "scale": string (one of: {", ".join(repr(o) for o in SCALE_OPTIONS)})\n'
            '- "attributes": object with:\n'
            f'{attr_schema}\n\n'
            "Return ONLY the JSON, no markdown."
        )

        data = core.rest_generate_json(api_key, "gemini-2.0-flash", [full_prompt])
        if data is None:
            return EnvRandomizeFullResponse(error="No response from Gemini")

        attrs = {}
        for key in ATTR_KEYS:
            if key in data.get("attributes", {}):
                attrs[key] = data["attributes"][key]
            elif key in data:
                attrs[key] = data[key]

        return EnvRandomizeFullResponse(
            description=data.get("description", ""),
            name=data.get("name", ""),
            biome=data.get("biome", ""),
            gameContext=data.get("gameContext", ""),
            timeOfDay=data.get("timeOfDay", ""),
            seasonWeather=data.get("seasonWeather", ""),
            scale=data.get("scale", ""),
            attributes=attrs,
        )
    except Exception as e:
        return EnvRandomizeFullResponse(error=str(e))


def _do_reimagine(req: ReimagineRequest) -> EnvResponse:
    """Take a game screenshot and reimagine it as finished environment concept art."""
    api_key = core.get_api_key()
    if not api_key:
        return EnvResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    try:
        source = core.b64_to_image(req.image_b64)

        style_map = {
            "photorealistic concept art": (
                "Photorealistic AAA game environment concept art — Unreal Engine 5 quality, "
                "ray-traced GI, PBR materials at max fidelity, volumetric atmospherics, "
                "cinematic color grading. Production-ready concept painting."
            ),
            "stylized painterly": (
                "Stylized painterly environment concept — visible brush strokes, "
                "rich color harmony, atmospheric perspective, art-directed lighting. "
                "Like a AAA game's key art or loading screen painting."
            ),
            "moody cinematic": (
                "Moody cinematic environment — dramatic film-grade lighting, deep shadows, "
                "desaturated palette with selective color pops, anamorphic lens feel, "
                "atmospheric fog/haze. Like a movie establishing shot."
            ),
            "clean architectural viz": (
                "Clean architectural visualization — crisp lines, accurate materials, "
                "neutral studio-like lighting, clear spatial relationships, "
                "minimal atmospheric effects. Technical concept for level design review."
            ),
        }

        style_desc = style_map.get(req.style_direction, style_map["photorealistic concept art"])
        context_block = f"\nCONTEXT: {req.context.strip()}" if req.context.strip() else ""

        prompt = (
            "GAME SCREENSHOT REIMAGINE — Transform this in-game screenshot into finished environment concept art.\n\n"
            f"TARGET STYLE: {style_desc}\n\n"
            "CRITICAL RULES:\n"
            "1. PRESERVE the composition, camera angle, spatial layout, and architectural forms exactly.\n"
            "2. PRESERVE the general color mood and time-of-day feeling.\n"
            "3. UPGRADE all materials to photorealistic quality — add surface detail, weathering, "
            "proper PBR response, subsurface scattering where needed.\n"
            "4. UPGRADE vegetation to realistic foliage with proper leaf density and variation.\n"
            "5. ADD atmospheric depth — haze, volumetric light, ambient particles.\n"
            "6. ADD environmental storytelling details — wear, damage, human traces.\n"
            "7. REMOVE any game UI, HUD elements, debug info, or text overlays.\n"
            "8. REMOVE any obvious low-poly artifacts, texture seams, or LOD pop.\n"
            "9. The result must look like a AAA concept painting that a 3D team would build from.\n"
            "10. No text, labels, or watermarks in the output.\n"
            f"{context_block}\n\n"
            "Reimagine this screenshot as a polished, production-quality environment concept."
        )

        contents: list = [source, prompt]
        result = core.gemini_generate_image(
            api_key, contents, aspect_ratio="16:9", image_size="4K",
            cancel_event=cancel, model_id=req.model_id,
        )
        if result is None:
            return EnvResponse(error="Reimagine failed — no image returned")

        core.save_generated_image(
            result, "AI Environment Lab", view_name="reimagine",
            generation_type="reimagine",
            metadata={"context": req.context, "style": req.style_direction},
        )
        return EnvResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except RuntimeError as e:
        return EnvResponse(error=str(e))
    except Exception as e:
        return EnvResponse(error=f"Reimagine failed: {e}")
    finally:
        release_cancel_event(cancel)


def _do_upscale(req: UpscaleRequest) -> EnvResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnvResponse(error="No API key configured")
    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()
    try:
        source = core.b64_to_image(req.image_b64)
        factor_hint = {"x4": "maximum", "x3": "high"}.get(req.scale_factor, "moderate")
        prompt = (
            f"Reproduce this exact environment image at {factor_hint} resolution. "
            f"Preserve every detail, color, texture, and composition exactly as-is."
        )
        contents: list = [source, prompt]
        result = core.gemini_generate_image(api_key, contents, aspect_ratio="16:9", cancel_event=cancel, model_id=req.model_id)
        if result is None:
            return EnvResponse(error="Upscale failed")
        core.save_generated_image(result, "AI Environment Lab", view_name="upscale", generation_type="upscale")
        return EnvResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except Exception as e:
        return EnvResponse(error=str(e))
    finally:
        release_cancel_event(cancel)


def _do_restore(req: RestoreRequest) -> EnvResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnvResponse(error="No API key configured")
    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()
    try:
        source = core.b64_to_image(req.image_b64)
        description = core.rest_generate_text_multimodal(
            api_key, "gemini-2.0-flash",
            [source, "Describe this environment with obsessive precision for exact recreation. "
             "Cover architecture, materials, vegetation, lighting, atmosphere, color palette, "
             "props, and composition. Write as one continuous dense prompt. No preamble."],
            cancel_event=cancel, cost_category="editing",
        )
        if not description:
            return EnvResponse(error="Restore failed — could not analyze image")
        restore_prompt = (
            "QUALITY RESTORATION — Recreate this environment image at maximum quality.\n\n"
            "WHAT MUST STAY IDENTICAL: Composition, architecture, spatial layout, "
            "color palette, lighting direction, atmosphere.\n\n"
            "WHAT MUST BE FRESHLY RENDERED: Crisp material textures, clean edges, "
            "proper atmospheric depth, detailed vegetation.\n\n"
            f"DETAILED DESCRIPTION:\n{description}"
        )
        contents: list = [source, restore_prompt]
        result = core.gemini_generate_image(api_key, contents, aspect_ratio="16:9", cancel_event=cancel, model_id=req.model_id)
        if result is None:
            return EnvResponse(error="Restore failed")
        core.save_generated_image(result, "AI Environment Lab", view_name="restore", generation_type="restore")
        return EnvResponse(image_b64=core.image_to_b64(result), width=result.width, height=result.height)
    except Exception as e:
        return EnvResponse(error=str(e))
    finally:
        release_cancel_event(cancel)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=EnvResponse)
async def generate(body: EnvGenerateRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating environment concept..."})
    result = await loop.run_in_executor(_pool, _do_generate, body)
    await manager.broadcast("status", {"message": result.error or "Environment generated"})
    return result


@router.post("/generate-grid", response_model=EnvGridResponse)
async def generate_grid(body: EnvGenerateRequest):
    """Generate a 4×4 sprite sheet of environment variations."""
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating 4×4 environment sheet..."})
    result = await loop.run_in_executor(_pool, _do_generate_grid, body)
    await manager.broadcast("status", {"message": result.error or "Grid generated"})
    return result


@router.post("/extract-attributes", response_model=EnvAttributeResponse)
async def extract_attributes(body: EnvAttributeRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_extract_attributes, body.description, body.image_b64)


@router.post("/enhance", response_model=EnvRandomizeFullResponse)
async def enhance(body: EnvContextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_enhance, body.description, body)


@router.post("/randomize-full", response_model=EnvRandomizeFullResponse)
async def randomize_full(body: EnvContextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_randomize_full, body)


@router.post("/reimagine", response_model=EnvResponse)
async def reimagine(body: ReimagineRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Reimagining screenshot..."})
    result = await loop.run_in_executor(_pool, _do_reimagine, body)
    await manager.broadcast("status", {"message": result.error or "Screenshot reimagined"})
    return result


@router.post("/upscale", response_model=EnvResponse)
async def upscale(body: UpscaleRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Upscaling environment..."})
    result = await loop.run_in_executor(_pool, _do_upscale, body)
    await manager.broadcast("status", {"message": result.error or "Environment upscaled"})
    return result


@router.post("/restore", response_model=EnvResponse)
async def restore(body: RestoreRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Restoring environment..."})
    result = await loop.run_in_executor(_pool, _do_restore, body)
    await manager.broadcast("status", {"message": result.error or "Environment restored"})
    return result
