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


class CharacterResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class AttributeRequest(BaseModel):
    description: str


class AttributeResponse(BaseModel):
    attributes: Optional[dict] = None
    age: str = ""
    race: str = ""
    gender: str = ""
    build: str = ""
    bible: Optional[dict] = None
    costume: Optional[dict] = None
    error: Optional[str] = None


class TextRequest(BaseModel):
    text: str
    operation: str = "enhance"          # enhance, randomize


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
    if req.costume_context:
        prompt += f"\n\n--- Costume Direction ---\n{req.costume_context}"

    return prompt


# ---------------------------------------------------------------------------
# Sync workers
# ---------------------------------------------------------------------------

def _do_generate(req: CharacterGenerateRequest) -> CharacterResponse:
    api_key = core.get_api_key()
    if not api_key:
        return CharacterResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.server import reset_cancel_event, release_cancel_event
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

    style_rules = (
        "STRICT RULES: Realistic 3D-rendered style. NOT illustrated, NOT cartoon, NOT painted. "
        "No text, no labels, no names, no color swatches, no annotations anywhere on the image. "
        "Solid flat single-color background. Full body visible head to toe."
    )

    if req.edit_prompt and req.reference_image_b64:
        contents.append(
            f"{prompt}\n\nApply these changes: {req.edit_prompt}\n\n{style_rules}"
        )
    elif req.view_type != "main" and req.reference_image_b64:
        view_label = req.view_type.replace("_", " ")
        contents.append(
            f"Using the reference character image, generate a {view_label} view of this character. "
            f"Match the exact same character, outfit, and proportions.\n{prompt}\n\n{style_rules}"
        )
    else:
        contents.append(
            f"Generate a full-body character in 3/4 view.\n{prompt}\n\n{style_rules}"
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


def _do_extract_attributes(description: str) -> AttributeResponse:
    api_key = core.get_api_key()
    if not api_key:
        return AttributeResponse(error="No API key")

    try:
        import json
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(
            "Extract character attributes from this description as JSON with these keys:\n"
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
            '- "attributes": object with keys Headwear, Outerwear, Top, Legwear, '
            "Footwear, Gloves, FaceGear, UtilityRig, BackCarry, HandProp, "
            "Accessories, ColorAccents, Detailing, Pose "
            "(each a short string description, or empty string if not mentioned)\n"
            + _BIBLE_COSTUME_PROMPT +
            f"Return ONLY valid JSON.\n\n{description}",
            generation_config={"response_mime_type": "application/json"},
        )
        data = json.loads(resp.text)
        if isinstance(data, list):
            data = data[0] if data else {}
        return AttributeResponse(
            attributes=data.get("attributes"),
            age=data.get("age", ""),
            race=data.get("race", ""),
            gender=data.get("gender", ""),
            build=data.get("build", ""),
            bible=data.get("bible"),
            costume=data.get("costume"),
        )
    except Exception as e:
        return AttributeResponse(error=str(e))


def _do_enhance(text: str) -> RandomizeFullResponse:
    api_key = core.get_api_key()
    if not api_key:
        return RandomizeFullResponse(error="No API key")
    try:
        import json
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(
            "Enhance and expand the following character description with vivid detail. "
            "Keep the core concept but add visual richness. "
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (the enhanced 3-5 sentence description)\n'
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
            '- "attributes": object with keys Headwear, Outerwear, Top, Legwear, '
            "Footwear, Gloves, FaceGear, UtilityRig, BackCarry, HandProp, "
            "Accessories, ColorAccents, Detailing, Pose "
            "(each a short string description, or empty string if none)\n"
            + _BIBLE_COSTUME_PROMPT +
            f"Original description:\n\n{text}",
            generation_config={"response_mime_type": "application/json"},
        )
        data = json.loads(resp.text)
        if isinstance(data, list):
            data = data[0] if data else {}
        return RandomizeFullResponse(**_parse_full_response(data))
    except Exception as e:
        return RandomizeFullResponse(error=str(e))


def _do_randomize() -> TextResponse:
    api_key = core.get_api_key()
    if not api_key:
        return TextResponse(error="No API key")
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(
            "Generate a random, detailed character description for a game character. "
            "Include appearance, clothing, gear, and personality hints. "
            "Be creative and specific. 3-5 sentences."
        )
        return TextResponse(text=resp.text)
    except Exception as e:
        return TextResponse(error=str(e))


def _do_randomize_full() -> RandomizeFullResponse:
    """Generate a random character with description, identity, attributes, bible, and costume."""
    api_key = core.get_api_key()
    if not api_key:
        return RandomizeFullResponse(error="No API key")
    try:
        import json
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(
            "Generate a random, detailed game character for a realistic 3D game. "
            "Return ONLY valid JSON with these keys:\n"
            '- "description": string (3-5 sentences describing physical appearance, clothing, gear, '
            "and personality. Describe as a real person, not a cartoon or illustration.)\n"
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
            '- "attributes": object with keys Headwear, Outerwear, Top, Legwear, '
            "Footwear, Gloves, FaceGear, UtilityRig, BackCarry, HandProp, "
            "Accessories, ColorAccents, Detailing, Pose "
            "(each a short string description, or empty string if none)\n"
            + _BIBLE_COSTUME_PROMPT +
            "Be creative and specific. Return ONLY the JSON, no markdown.",
            generation_config={"response_mime_type": "application/json"},
        )
        data = json.loads(resp.text)
        if isinstance(data, list):
            data = data[0] if data else {}
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
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_extract_attributes, body.description)


@router.post("/enhance", response_model=RandomizeFullResponse)
async def enhance(body: TextRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_enhance, body.text)


@router.post("/randomize", response_model=TextResponse)
async def randomize():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_randomize)


@router.post("/randomize-full", response_model=RandomizeFullResponse)
async def randomize_full():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_randomize_full)
