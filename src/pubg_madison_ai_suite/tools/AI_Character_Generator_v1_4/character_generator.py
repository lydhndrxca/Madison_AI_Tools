#!/usr/bin/env python3
from __future__ import annotations
# -*- coding: utf-8 -*-
"""
Character Concept Image Generator (Tkinter + Gemini)
Author: ChatGPT
Description:
  - Editable dropdowns (10 common options each)
  - "Random (less common)" button per field (25 rarer options each)
  - "Randomize All", "Reset Character", "Generate Image"
  - Additional Notes text box
  - Gemini API integration for character concept generation
  - Image viewer instead of XML output
Dependencies: tkinter, Pillow, google-generativeai
"""
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog, Menu
import random
import os
import sys
import io
import threading
from pathlib import Path
from typing import Optional
import shutil
from datetime import datetime
import time

_BAKED_KEY = ""

class ToolTip:
    """Create a tooltip for a given widget with a slight delay."""
    def __init__(self, widget, text='widget info', delay=750):
        self.widget = widget
        self.text = text
        self.delay = delay
        self.widget.bind("<Enter>", self.enter)
        self.widget.bind("<Leave>", self.leave)
        self.tipwindow = None
        self.id = None
        
    def enter(self, event=None):
        self.schedule()
        
    def leave(self, event=None):
        self.unschedule()
        self.hidetip()
        
    def schedule(self):
        self.unschedule()
        self.id = self.widget.after(self.delay, self.showtip)
        
    def unschedule(self):
        id = self.id
        self.id = None
        if id:
            self.widget.after_cancel(id)
        
    def showtip(self):
        if self.tipwindow or not self.text:
            return
        x, y, cx, cy = self.widget.bbox("insert")
        x = x + self.widget.winfo_rootx() + 25
        y = y + cy + self.widget.winfo_rooty() + 25
        self.tipwindow = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry("+%d+%d" % (x, y))
        label = tk.Label(tw, text=self.text, justify=tk.LEFT,
                        background="#222222", foreground="#D0D0D0", relief=tk.SOLID, borderwidth=1,
                        font=("Segoe UI", "9", "normal"))
        label.pack(ipadx=1)
        
    def hidetip(self):
        tw = self.tipwindow
        self.tipwindow = None
        if tw:
            tw.destroy()

# Import Gemini and PIL
try:
    import google.generativeai as genai_text
    from google import genai as genai_images  # type: ignore
    from google.genai import types as genai_types  # type: ignore
    from PIL import Image, ImageTk, ImageDraw, ImageFont, ImageChops, ImageOps, ImageGrab
    GEMINI_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Missing dependencies: {e}")
    print("Install with: pip install Pillow google-generativeai google-genai")
    GEMINI_AVAILABLE = False


def resource_path(*relative_parts: str) -> str:
    """
    Get absolute path to BUNDLED resource (read-only), works in dev and in PyInstaller exe.
    Use for: bundled data files, config templates, etc.
    """
    if hasattr(sys, "_MEIPASS"):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.abspath(os.path.dirname(__file__))
    return os.path.join(base_path, *relative_parts)


def app_data_path(*relative_parts: str) -> str:
    """
    Get absolute path to USER DATA folder (read-write), works in dev and in PyInstaller exe.
    Use for: saved images, logs, user configs, etc.
    
    In EXE mode: uses the folder where the EXE is located.
    In dev mode: uses the script's folder.
    """
    if getattr(sys, 'frozen', False):
        # Running as compiled EXE - use the folder containing the EXE
        base_path = os.path.dirname(sys.executable)
    else:
        # Running as script - use the script's folder
        base_path = os.path.abspath(os.path.dirname(__file__))
    return os.path.join(base_path, *relative_parts)


# Version and app info
APP_NAME = "AI Character Generator"
APP_VERSION = "v2.0"
APP_TITLE = f"{APP_NAME} {APP_VERSION}"
APP_WIDTH = 1800
APP_HEIGHT = 1000

# Lore features disabled
VALOR_LORE_CONTEXT = ""

# Character-specific style and view prompts
CHARACTER_STYLE_NOTES = """
CRITICAL IMAGE FORMAT: 9:16 vertical portrait (1536 x 2816). Show the entire character head-to-toe within frame.

FOLLOW THE DESCRIPTION LITERALLY:
- Wardrobe, props, colors, materials, condition, and wear must match the attribute list.
- Body type, age, and demeanor must match the identity description.
- Include any listed props and accessories. Do not invent extra items.

VISUAL STYLE: High-fidelity documentary character photograph. Proportions must be natural and un-idealized, showing realistic weight distribution without underlying muscular definition. Soft, even studio lighting (diffused softbox), gentle contrast, clean shadows. Visible skin pores and fabric weave. RENDER fabrics as heavy, lived-in materials that sag and wrinkle naturally under the character’s weight. Pose: casual standing, slight 3/4 to camera.

NO TEXT:
- Do not render any text, letters, numbers, logos, labels, or watermarks.

BACKGROUND (REQUIRED):
- Flat solid grey (#D3D3D3) only.
- No floor, no ground plane, no environment, no background objects.
- No ground shadows, reflections, gradients, or lighting effects.

CAMERA & COMPOSITION:
- Eye-level camera, natural perspective, 70-85mm equivalent lens unless overridden.
- Centered full-body framing with visible feet; respect any camera instructions provided by the user.
"""

VIEW_REQUESTS = {
    "main": (
        "Casual standing pose, full body, three-quarter front view of the character. "
        "Camera at chest height, rotated about 9 degrees to the right from the front view. "
        "Primarily front-facing with just a hint of the right side visible. "
        "Keep proportions natural, lens normal, no extreme perspective."
    ),
    "front": (
        "Full-body FRONT orthographic view of the SAME character as the reference. "
        "Camera EXACTLY at eye level, positioned directly in front of the character. "
        "Character's shoulders must be SQUARED TO THE CAMERA - perfectly parallel to the image plane. "
        "Perfectly straight-on view with ZERO rotation, tilt, yaw, or pitch. "
        "Character must be facing DIRECTLY toward camera - completely symmetrical left and right sides. "
        "This is a police mugshot / passport photo pose: standing upright, facing forward, shoulders square. "
        "All clothing, equipment, tools, weapons, accessories, prosthetics, and held objects "
        "must match the reference exactly. Only change the viewing angle. No ground plane or floor."
    ),
    "back": (
        "Full-body BACK orthographic view of the SAME character as the reference. "
        "Camera directly behind the character at exact eye level. "
        "Perfectly straight-on rear view with NO rotation, tilt, or angle whatsoever. "
        "Show the back side of the SAME outfit, gear, and tools (no changes, just the back view). "
        "No ground plane or floor."
    ),
    "side": (
        "Full-body SIDE orthographic profile view of the SAME character as the reference. "
        "Camera exactly perpendicular to the character at chest height. "
        "Character looking straight ahead in their own facing direction. "
        "No three-quarter angle, no visible far-side eye, and minimal perspective foreshortening. "
        "Do not add or remove any clothing, tools, weapons, accessories, or prosthetics."
    ),
}

LOCK_OUTFIT_BLOCK = (
    "IMPORTANT CONSISTENCY RULES (MANDATORY WHEN REFERENCE IMAGE PROVIDED):\n"
    "- Treat the reference image as the single source of truth for the character.\n"
    "- KEEP THE SAME BODY TYPE, height, proportions, weight, and age.\n"
    "- KEEP THE SAME FACE, facial hair, hairstyle, skin tone, and expression style.\n"
    "- KEEP THE SAME CLOTHING: same garments, colors, patterns, textures, logos, patches, and level of wear and dirt.\n"
    "- KEEP THE SAME GEAR AND TOOLS: same tool belt, pouches, holsters, tape measure, weapons, devices, and all other accessories.\n"
    "- KEEP ALL HELD OBJECTS IDENTICAL: same object in the same hand, same size, same design.\n"
    "- DO NOT add, remove, or swap any clothing, tools, weapons, accessories, or held objects.\n"
    "- DO NOT change which leg or arm has prosthetics, armor, pads, or braces.\n"
    "- DO NOT add extra props on the ground or in the background.\n"
    "- Only change the camera angle and pose according to the requested view_type and pose instructions.\n"
)

VIEW_DISPLAY_NAMES = {
    "stage": "Main Stage (3/4)",
    "front": "Front",
    "back": "Back",
    "side": "Side",
    "ref_a": "Ref A",
    "ref_b": "Ref B",
    "ref_c": "Ref C",
}

IMAGEN_MODEL_CANDIDATES = [
    {"name": "models/imagen-4.0-generate-001", "supports_image_size": True},
    {"name": "models/imagen-4.0-fast-generate-001", "supports_image_size": True},
    {"name": "models/imagen-4.0-generate-preview-06-06", "supports_image_size": False},
]

IMAGEN_BACKGROUND_DIRECTIVE = (
    "BACKGROUND REQUIREMENT:\n"
    "Use a flat, solid, uniform grey background (#D3D3D3). No floor, no ground plane, "
    "no environment, and no background objects of any kind. No shadows, reflections, "
    "gradients, or patterns in the background."
)

IMAGEN_REFERENCE_BACKGROUND_OVERRIDE = (
    "REFERENCE BACKGROUND OVERRIDE:\n"
    "Ignore and replace the background from the reference image. Use only a flat, "
    "uniform grey background (#D3D3D3) with nothing else. Do not copy any background "
    "objects, environment, floor reflections, or ground shadows. Preserve only the "
    "character's design, clothing, colors, and details."
)

def build_view_prompt(view_key: str, character_description: str, extra_style: str = None, use_valor_lore: bool = False) -> str:
    """Build prompt for character view generation with specific style notes.
    
    For multi-view ortho generation, character_description should be empty string ''
    so the AI only uses the reference image without text interference.
    """
    view = VIEW_REQUESTS.get(view_key, VIEW_REQUESTS["main"])
    
    # Valor lore context disabled - no longer injecting full text block
    lore_prefix = ""
    
    if view_key == "main":
        # Initial character generation from text description
        base_prompt = (
            f"{character_description}\n\n"
            f"{lore_prefix}Grounded, realistic character study with flat, natural overcast lighting. "
            "No dramatic highlights or hero-lighting on muscles. "
            "Text-only generation; do not rely on any reference images. "
            f"{view}\n\n"
            f"Style Requirements:\n{CHARACTER_STYLE_NOTES}"
        )
    else:
        # Multi-view generation using reference image
        # Combine strict orthographic instructions with identity preservation
        base_prompt = (
            f"{lore_prefix}Using the provided character image as reference, recompose to the specified view, "
            "preserving EXACT character design, body type, materials, colors, clothing, accessories, and all details.\n\n"
            f"CAMERA VIEW REQUIREMENTS:\n{view}\n\n"
            "IDENTITY LOCK - MANDATORY:\n"
            "• SAME body type, height, weight, proportions, age\n"
            "• SAME face, skin tone, hair style/color, facial hair\n"
            "• SAME clothing - every garment, color, pattern, material, damage, dirt\n"
            "• SAME accessories - all gear, tools, weapons, belts, pouches, bags\n"
            "• SAME held objects in same hands\n"
            "• Do NOT add, remove, or change ANY items\n"
            "• ONLY change the camera angle\n\n"
            "BACKGROUND: Solid flat grey (#D3D3D3). No floor, no shadows, no environment.\n\n"
            f"Style Requirements:\n{CHARACTER_STYLE_NOTES}"
        )
    
    if extra_style:
        return f"{base_prompt}\n\nAdditional instructions: {extra_style}"
    
    return base_prompt

_BACKGROUND_KEYWORDS = (
    "background",
    "backdrop",
    "environment",
    "setting",
    "scene",
    "landscape",
    "city",
    "street",
    "alley",
    "forest",
    "jungle",
    "desert",
    "mountain",
    "ocean",
    "beach",
    "ship",
    "space",
    "planet",
    "horizon",
    "skyline",
    "studio",
    "warehouse",
    "ruins",
    "interior",
    "room",
    "corridor",
)

_BACKGROUND_PHRASES = (
    "standing in",
    "standing on",
    "standing at",
    "set in",
    "set against",
    "set inside",
    "set outside",
    "inside a",
    "inside the",
    "outside a",
    "outside the",
    "amid",
    "amidst",
    "surrounded by",
    "beneath the",
    "under the",
    "above the",
    "in front of",
    "behind a",
    "against a",
    "against the",
)


def description_requests_custom_background(text: str) -> bool:
    """Heuristic to detect whether the user asked for a specific background or environment."""
    lowered = (text or "").lower()
    if not lowered:
        return False
    for keyword in _BACKGROUND_KEYWORDS:
        if keyword in lowered:
            return True
    for phrase in _BACKGROUND_PHRASES:
        if phrase in lowered:
            return True
    return False

# -----------------------------
# Identity and Background Options
# -----------------------------
AGE_OPTIONS = [
    "teen (18–19)",
    "young adult (20–29)",
    "adult (30–45)",
    "middle-aged (46–65)",
    "senior (66+)",
]

RACE_OPTIONS = [
    "Black / African descent",
    "White / European descent",
    "East Asian",
    "South Asian",
    "Southeast Asian",
    "Hispanic / Latine",
    "Middle Eastern / North African",
    "Indigenous",
    "Pacific Islander",
    "Mixed",
    "Other / not specified",
]

GENDER_OPTIONS = [
    "male",
    "female",
    "non-binary",
    "genderqueer",
    "trans masc",
    "trans femme",
    "androgynous",
    "unspecified",
]

BUILD_OPTIONS = ["slim", "average", "athletic", "muscular", "curvy", "heavyset", "soft/doughy", "unfit"]

# -----------------------------
# Field Definitions
# -----------------------------
FIELDS = {
    "Headwear": {
        "common": [
            "Ball cap — sun-faded, curved brim",
            "Knit beanie — ribbed cuff",
            "Hood up — jersey-lined",
            "Trucker cap — mesh back",
            "Baseball cap — blank velcro patch",
            "Snapback — flat brim",
            "Watch cap — rolled cuff",
            "Bucket hat — canvas",
            "No visible headwear",
            "Headband — sweat-wicking",
        ],
        "rare": [
            "Boonie hat — ripstop, chin cord",
            "Beret — soft wool, tilted",
            "Ushanka — ear flaps down",
            "Desert shemagh — wrapped crown",
            "Newsboy cap — worn tweed",
            "Hard hat — scuffed ABS",
            "Panama hat — natural straw",
            "Ivy cap — matte leather",
            "Sou'wester rain hat — PVC",
            "Flight cap — vintage leather",
            "Visor — translucent brim",
            "Motor scooter helmet — retro",
            "Climbing helmet — webbing straps",
            "Welding goggles — perched on brow",
            "Bicycle helmet — commuter style",
            "Cowboy hat — modern felt",
            "Trapper hat — faux fur lining",
            "Paramedic cap — reflective trim",
            "Rowing boater hat — rigid straw",
            "Ski helmet — stickered",
            "Painter's cap — splattered",
            "Fishing cap — fly lures on band",
            "Riot helmet — visor up",
            "Night‑vision monocular — stowed",
            "Rain hood — taped seams",
        ],
    },
    "Outerwear": {
        "common": [
            "Bomber jacket — weathered leather",
            "Hooded parka — matte nylon",
            "Field jacket — canvas, patch pockets",
            "Denim trucker — worn seams",
            "Softshell jacket — taped zips",
            "Moto jacket — abrasion panels",
            "Blazer — casual, unstructured",
            "Utility overshirt — heavy twill",
            "Windbreaker — lightweight",
            "Rain shell — packable",
        ],
        "rare": [
            "Fishtail parka — drawcord hem",
            "M65 with liner — olive drab",
            "Flight jacket MA‑1 — reversible",
            "Waxed cotton coat — patinated",
            "Tech cloak — asymmetrical front",
            "Cape jacket — snapped sides",
            "Gorka anorak — reinforced knees/elbows",
            "Varsity jacket — chenille patch",
            "Corduroy chore coat — brass snaps",
            "Trench coat — storm flap",
            "Puffer vest — box baffles",
            "Hybrid fleece — grid interior",
            "Poncho — ripstop, grommets",
            "Coach jacket — snap front",
            "Peacoat — oversized lapel",
            "Rain mac — bonded seams",
            "Firefighter turnout — de-badged",
            "Rugged cardigan — shawl collar",
            "Café racer — minimal seams",
            "Surplus greatcoat — tailored",
            "Shearling trucker — faux shear",
            "Mountaineering shell — pit zips",
            "Shop coat — pencil pocket",
            "Eisenhower jacket — cropped",
            "Quilted liner — onion stitch",
        ],
    },
    "Top": {
        "common": [
            "Crew tee — cotton jersey",
            "Henley — 3‑button placket",
            "Flannel shirt — muted plaid",
            "Oxford shirt — rolled sleeves",
            "Thermal waffle — slim fit",
            "Polo — knit collar",
            "Compression top — long sleeve",
            "Hoodie — kangaroo pocket",
            "Athletic tee — moisture wicking",
            "Turtleneck — fine gauge",
        ],
        "rare": [
            "Work shirt — chain-stitch name tag",
            "Rugby shirt — bold stripe",
            "Chambray shirt — utility stitch",
            "Base layer — merino crew",
            "Mesh practice jersey — perforated",
            "Guayabera — four pockets",
            "Cuban collar shirt — camp style",
            "Western shirt — snap buttons",
            "Painter's smock — speckled",
            "Fencing under-jacket — padded",
            "Quarter‑zip fleece — grid knit",
            "Longline tee — split hem",
            "Cable knit — fisherman style",
            "Tech tee — welded seams",
            "Linen shirt — airy weave",
            "Rash guard — UPF rated",
            "Baseball jersey — blank script",
            "Thermoreg tee — mapped zones",
            "Surplus undershirt — tagged",
            "Motorcross jersey — sublimated",
            "Chainmail motif tee — print",
            "Reinforced tee — shoulder patches",
            "Sailing smock — drawcord hem",
            "Kevlar weave motif — printed",
            "UV-reactive graphic — subtle",
        ],
    },
    "Legwear": {
        "common": [
            "Slim jeans — dark indigo",
            "Straight jeans — faded knee whiskers",
            "Cargo pants — articulated knees",
            "Chinos — tapered fit",
            "Joggers — cuffed hem",
            "Work pants — double knee",
            "Tech pants — zipped pockets",
            "Shorts — utility, knee-length",
            "Biker jeans — ribbed panels",
            "Overalls — single strap dropped",
        ],
        "rare": [
            "Corduroy pants — 8‑wale",
            "Ripstop cargos — gusseted seat",
            "Flight suit bottoms — cuffed",
            "Painter pants — spattered",
            "Softshell mountaineering pants",
            "Moto leather pants — padded thigh",
            "Kilted overskirt — tactical",
            "Convertible pants — zip-off legs",
            "Deck pants — lace front",
            "Climbing pants — diamond gusset",
            "Parachute pants — cinch hem",
            "BDU trousers — modified",
            "Thermal leggings — underlayer",
            "Twist seam jeans — asymmetric",
            "Snow pants — scuffed cuffs",
            "Waxed canvas pants — stiff",
            "Gore-tex bib — suspendered",
            "Track pants — side stripe",
            "Pleated wool trousers — casual",
            "Sashiko-repaired jeans — visible mend",
            "Reinforced moto chinos — knee darts",
            "Flight deck trousers — flame-retardant look",
            "Sailing salopettes — heavy duty",
            "Painter's bib shorts — cropped",
            "Kevlar‑patch cargos — visible grid",
        ],
    },
    "Footwear": {
        "common": [
            "Work boots — full grain leather",
            "Combat-inspired boots — speed laces",
            "Sneakers — low profile, gum sole",
            "High-top sneakers — padded collar",
            "Trail runners — aggressive tread",
            "Chelsea boots — matte leather",
            "Chukka boots — crepe sole",
            "Hiking boots — metal eyelets",
            "Slip‑on sneakers — canvas",
            "Rain boots — rubberized",
        ],
        "rare": [
            "Tactical boots — side zip",
            "Engineer boots — harness ring",
            "Climbing approach shoes — sticky rubber",
            "Paratrooper boots — capped toe",
            "Moto boots — reinforced shin",
            "Ice cleat overshoes — strapped",
            "Barefoot shoes — wide toe box",
            "Deck shoes — salt stained",
            "Skate shoes — ollie wear",
            "Trail gaiters — debris shield",
            "Urban crampons — removable",
            "Split‑toe tabi boots — modern",
            "Welted derby — chunky sole",
            "Service oxfords — mirror toe",
            "Galoshes — translucent",
            "Ski boots — unlatched",
            "Desert boots — suede",
            "Jungle boots — vented shank",
            "Mountaineering boots — crampon welt",
            "Runner spikes — track plate",
            "Motor patrol boots — glossy",
            "Roper boots — roper heel",
            "Side‑zip dress boots — sleek",
            "Water shoes — quick‑drain",
            "Bio‑polymer clogs — vented",
        ],
    },
    "Gloves": {
        "common": [
            "Fingerless gloves — knit",
            "Mechanic gloves — synthetic",
            "Leather gloves — unlined",
            "Tactical gloves — knuckle padding",
            "Fleece gloves — grippy palm",
            "Riding gloves — perforated",
            "Work gloves — suede palm",
            "No gloves",
            "Liner gloves — touchscreen",
            "Gauntlet gloves — extended cuff",
        ],
        "rare": [
            "Archivist gloves — cotton",
            "Welding gloves — heat scuffed",
            "Climbing gloves — half finger",
            "Motor gauntlets — reinforced",
            "Sailing gloves — open finger",
            "Cold‑weather mitts — over‑mitt",
            "Kevlar-lined gloves — subtle",
            "Chemical splash gloves — de-badged",
            "Snowmobile gloves — bulky",
            "Archer tab — leather",
            "Falconry glove — long cuff",
            "Chainmail glove — butcher style",
            "Padded bike gloves — gel",
            "Dress gloves — cashmere lined",
            "Latex-dipped grip gloves",
            "PCR nitrile gloves — crinkled",
            "Nomex flight gloves — thin",
            "Oven mitt — comic prop",
            "Roper gloves — ranch style",
            "Magnetized fingertip gloves",
            "Heated gloves — battery pack",
            "Weighted gloves — training",
            "Carpenter gloves — open index/middle",
            "Firefighter glove — reflective tape",
            "Ski gloves — wrist leash",
        ],
    },
    "FaceGear": {
        "common": [
            "Sunglasses — rectangular, matte frame",
            "Aviators — mirrored lenses",
            "Wraparound shades — sport",
            "Clear safety glasses — anti-fog",
            "Bandana mask — pulled down",
            "Neck gaiter — half raised",
            "No face gear",
            "Half-face respirator — stowed",
            "Ear-bud headset — single",
            "Eyeglasses — thin metal frame",
        ],
        "rare": [
            "Pilot oxygen mask — de-tubed",
            "Transparent face shield — flipped up",
            "Dust goggles — elastic strap",
            "Ski goggles — reflective",
            "Tactical visor — hinged",
            "Rebreather mouthpiece — clipped",
            "Diving mask — forehead rest",
            "VR headset — slung",
            "AR monocle — clipped rim",
            "Night mask — lifted to brow",
            "Balaclava — mouth open",
            "Mesh face mask — breathable",
            "Cloth mask — patterned",
            "Motor half-helmet visor — tinted",
            "Paint respirator — single cartridge",
            "Welding mask — compact",
            "Fencing mask — wire mesh",
            "Shatterproof goggles — yellow tint",
            "Noise‑cancel ear muffs — neck worn",
            "Comms boom mic — cheek",
            "Shooting glasses — amber",
            "Impact mask — composite",
            "Climbing nose clip — quirky",
            "Medical face shield — cut down",
            "Surgical mask — under chin",
        ],
    },
    "UtilityRig": {
        "common": [
            "Nylon belt — quick‑release buckle",
            "Webbing belt — MOLLE loops",
            "Tool belt — modular pouches",
            "Cross‑body sling — compact",
            "Chest rig — minimal",
            "Waist pack — low profile",
            "Holster‑style phone pouch",
            "Key clip — carabiner",
            "Harness straps — subtle",
            "Suspenders — elastic",
        ],
        "rare": [
            "Bandolier‑style strap — blank pouches",
            "Climbing harness — stripped down",
            "Radio chest harness — low‑viz",
            "Courier strap — padded shoulder",
            "Hydration bladder — hose routed",
            "Magnetic tool strip — belt",
            "Elastic thigh strap — utility",
            "Multipurpose yoke — quick adjusters",
            "Accordion pouch — origami",
            "Kevlar strap set — light",
            "AR‑style admin panel — blank",
            "Photographer harness — dual camera",
            "Bike messenger belt — stabilizer",
            "Paramedic shears holster — empty",
            "Surveyor belt — tape holder",
            "Roll‑up organizer — clipped",
            "Drop‑leg panel — minimal",
            "Line belt — repurposed",
            "Skater strap — board clip",
            "Rigger belt — stow loop",
            "Minimal CHL pouch — generic",
            "Mag pouch — repurposed tools",
            "Ratchet belt — micro‑adjust",
            "Velcro wrap — cable management",
            "Clip‑on badge reel — retractable",
        ],
    },
    "BackCarry": {
        "common": [
            "Daypack — 20L, streamlined",
            "Tactical backpack — 24L",
            "Rolltop pack — weatherproof",
            "Messenger bag — cross‑body",
            "Sling bag — compact",
            "Hydration pack — slim",
            "Tool backpack — rugged",
            "No bag",
            "Drawstring pack — lightweight",
            "Laptop backpack — padded",
        ],
        "rare": [
            "Climbing pack — rope strap",
            "Courier tube — blueprint case",
            "Pelican case — side handle",
            "Camera backpack — internal frame",
            "Range bag — modular dividers",
            "Scuba duffel — mesh panels",
            "Guitar gig bag — empty",
            "Tripod strapped outside pack",
            "Skateboard mount — rear",
            "Skis lashed — urban oddity",
            "Snow shovel on pack — clipped",
            "Utility tote — waxed canvas",
            "Medical jump bag — de‑badged",
            "Flight helmet bag — soft",
            "Drone case — compact",
            "Climbers chalk bag — rear clip",
            "Folding chair — bungee lash",
            "Ski boot bag — square",
            "Fishing rod tube — slung",
            "Tactical scabbard — empty",
            "Boom mic pole — collapsed",
            "Painter's kit — strapped",
            "Survey tripod — collapsed",
            "Bicycle pannier — single",
            "Paracord netting — cargo",
        ],
    },
    "HandProp": {
        "common": [
            "Smartphone — active screen",
            "Folded map — creased",
            "Flashlight — compact",
            "Water bottle — stainless",
            "Notebook — elastic band",
            "Walkie — clipped antenna",
            "Umbrella — collapsed",
            "Wrench — medium adjustable",
            "Rope coil — hand carry",
            "Gloves — carried in hand",
        ],
        "rare": [
            "Drone remote — hand strap",
            "Thermal camera — handheld",
            "Climbing carabiner — oversized",
            "Microphone — handheld",
            "Tablet — ruggedized case",
            "Monocular — compact",
            "Signal flare — unlit",
            "Compass — lensatic",
            "Geiger counter — clicking",
            "Polaroid camera — developing",
            "Spray paint can — capped",
            "Duct tape roll — hanging",
            "Lockpick roll — closed",
            "Measuring tape — extended",
            "Sample jar — labeled",
            "Coil of wire — flexible",
            "First‑aid pouch — velcro",
            "Multitool — unfolded",
            "Bolt cutters — small",
            "Tripod — folded",
            "Skateboard — under arm",
            "Climbing ice axe — dull",
            "Fishing reel — detached",
            "Handheld GPS — older model",
            "Binoculars — compact roof prism",
        ],
    },
    "Accessories": {
        "common": [
            "Analog watch — brushed metal",
            "Digital watch — rugged",
            "Dog tags — generic",
            "Leather bracelet — braided",
            "Paracord bracelet — cobra weave",
            "Necklace — simple pendant",
            "Stud earrings — minimal",
            "Ring — signet style",
            "Lanyard — utility key set",
            "Sunglass cord — retainer",
        ],
        "rare": [
            "Clip‑on compass — watch band",
            "Whistle — anodized",
            "Utility pen — bolt action",
            "RFID blocker wallet — slim",
            "Badge holder — clear",
            "Flash drive — on cord",
            "Mini prybar — pocket",
            "Ear cuff — industrial",
            "Spacer ring — titanium",
            "Silicone ring — matte",
            "Braided leather lanyard — knot",
            "Smart ring — understated",
            "Cable organizer — wrap band",
            "Key organizer — swivel",
            "Belt hook — S‑biner",
            "ID coil — retractable",
            "Glow fob — tritium style",
            "Carabiner watch — clipped",
            "Paracord fob — knot",
            "Pendant vial — tiny",
            "Magnetic clasp — quick release",
            "Tactical pen — blunt",
            "Minimal wallet — elastic",
            "Pocket notebook cover — leather",
            "AirTag holder — discreet",
        ],
    },
    "ColorAccents": {
        "common": [
            "Accent — muted red piping",
            "Accent — olive webbing",
            "Accent — charcoal hardware",
            "Accent — tan leather trim",
            "Accent — blacked‑out fasteners",
            "Accent — gunmetal buckles",
            "Accent — navy contrast stitch",
            "Accent — subtle orange tab",
            "Accent — sand zipper pulls",
            "Accent — slate drawcord tips",
        ],
        "rare": [
            "Accent — hi‑viz chartreuse tabs",
            "Accent — safety orange toggles",
            "Accent — cyan bartacks",
            "Accent — reflective piping",
            "Accent — anodized blue hardware",
            "Accent — copper rivets",
            "Accent — bone buttons",
            "Accent — brass keyhole",
            "Accent — crimson edge paint",
            "Accent — forest binding",
            "Accent — marigold stitch",
            "Accent — teal zipper coil",
            "Accent — oxblood laces",
            "Accent — neon paracord",
            "Accent — titanium D‑rings",
            "Accent — white bartacks",
            "Accent — matte silver snaps",
            "Accent — sand heat‑shrink",
            "Accent — violet pullers",
            "Accent — amber toggles",
            "Accent — moss webbing",
            "Accent — scarlet bartacks",
            "Accent — mint zip pull",
            "Accent — graphite clips",
            "Accent — coral aglets",
        ],
    },
    "Detailing": {
        "common": [
            "Material emphasis — leather & canvas mix",
            "Material emphasis — denim & twill",
            "Material emphasis — nylon & mesh",
            "Material emphasis — cotton & rib knit",
            "Material emphasis — suede accents",
            "Wear — lightly worn edges",
            "Wear — scuffed hardware",
            "Finish — matte overall",
            "Finish — mixed matte & satin",
            "Repair — subtle hand stitch",
        ],
        "rare": [
            "Material emphasis — waxed cotton body",
            "Material emphasis — ripstop + spacer mesh",
            "Material emphasis — softshell + knit",
            "Material emphasis — Cordura panelling",
            "Material emphasis — bonded fleece backing",
            "Wear — sun‑bleached shoulders",
            "Wear — oil‑darkened cuffs",
            "Wear — road grit on hems",
            "Wear — salt spray speckling",
            "Wear — paint flecks clustered",
            "Finish — ceramic‑like coating",
            "Finish — stonewashed overall",
            "Repair — sashiko knee patch",
            "Repair — leather elbow patches",
            "Repair — contrast bar‑tack grid",
            "Patina — brass oxidized green",
            "Patina — copper blush",
            "Aging — thread fuzz on seams",
            "Aging — micro cracking on pleather",
            "Stress — honeycomb on sleeves",
            "Reinforcement — bartack map",
            "Edge finish — raw cut",
            "Edge finish — bound seam",
            "Seam detail — flat‑felled",
            "Seam detail — triple‑needle run",
        ],
    },
    "Pose": {
        "common": [
            "Pose — relaxed A‑stance, hands at sides",
            "Pose — hands on hips, grounded",
            "Pose — one hand pocket, casual",
            "Pose — slight contrapposto",
            "Pose — feet shoulder width, neutral",
            "Pose — arms crossed, relaxed",
            "Pose — thumbs hooked on belt",
            "Pose — light step forward",
            "Pose — squared to camera",
            "Pose — head tilt, attentive",
        ],
        "rare": [
            "Pose — checking watch, subtle",
            "Pose — adjusting cuff",
            "Pose — lifting hood slightly",
            "Pose — slinging pack on",
            "Pose — resting hand on prop",
            "Pose — leaning on foot, ready",
            "Pose — securing strap",
            "Pose — wiping brow gesture",
            "Pose — tying lace moment",
            "Pose — tucking hair under cap",
            "Pose — scanning horizon",
            "Pose — shrugging jacket off shoulder",
            "Pose — tapping earpiece",
            "Pose — checking map fold",
            "Pose — wiping lens cloth",
            "Pose — unsnapping pocket",
            "Pose — rolling sleeve",
            "Pose — clipping carabiner",
            "Pose — pocketing multitool",
            "Pose — adjusting glasses",
            "Pose — turning slightly away",
            "Pose — kneeling to check boot",
            "Pose — cinching waist cord",
            "Pose — rehitching backpack",
            "Pose — pinching bridge of nose",
        ],
    },
}

def autocrop_and_resize(img, target_size=(1536, 2816)):
    """Auto-crop borders and LETTERBOX to target dimensions (no body cropping)."""
    target_w, target_h = target_size
    # Detect non-white areas
    try:
        bg_color = (255, 255, 255, 255) if ('A' in img.mode) else (255, 255, 255)
        bg = Image.new(img.mode, img.size, bg_color)
        diff = ImageChops.difference(img, bg)
        bbox = diff.getbbox()
        if bbox:
            img = img.crop(bbox)
    except Exception:
        pass

    # Preserve full body: scale to fit inside target, then pad (no cropping)
    iw, ih = img.size
    scale = min(target_w / iw, target_h / ih)
    new_w, new_h = max(1, int(iw * scale)), max(1, int(ih * scale))
    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Letterbox onto a neutral gray canvas to avoid clipping
    canvas = Image.new("RGB", (target_w, target_h), (48, 48, 48))
    offset = ((target_w - new_w) // 2, (target_h - new_h) // 2)
    canvas.paste(img, offset)
    return canvas


class GeminiClient:
    """Google AI Studio client wrapper for character generation."""
    
    def _build_attribute_system_instruction(self) -> str:
        return (
            "You are a data extraction tool. Always return JSON only with this exact schema:\n"
            "{\n"
            '  "age": string,\n'
            '  "race": string,\n'
            '  "gender": string,\n'
            '  "build": string,\n'
            '  "headwear": string,\n'
            '  "outerwear": string,\n'
            '  "top": string,\n'
            '  "legwear": string,\n'
            '  "footwear": string,\n'
            '  "gloves": string,\n'
            '  "facegear": string,\n'
            '  "utilityrig": string,\n'
            '  "backcarry": string,\n'
            '  "handprop": string,\n'
            '  "accessories": string,\n'
            '  "coloraccents": string,\n'
            '  "detailing": string\n'
            "}\n\n"
            "Allowed options:\n"
            f"- age: one of {', '.join(AGE_OPTIONS)}\n"
            f"- race: one of {', '.join(RACE_OPTIONS)}\n"
            f"- gender: one of {', '.join(GENDER_OPTIONS)}\n"
            f"- build: one of {', '.join(BUILD_OPTIONS)}\n"
            "- headwear, outerwear, top, legwear, footwear, gloves, facegear, utilityrig, backcarry, handprop, accessories: "
            'use a specific item or "none"\n'
            "- For clothing/gear fields, be specific and descriptive: include color, material, pattern, fit, and condition when known.\n"
            "- Avoid generic single words like 'shirt' or 'pants' unless nothing else is known.\n"
            "- coloraccents: 2-5 primary colors, comma-separated\n"
            "- detailing: specific wear, stains, damage, dust, wrinkles, scuffs, repairs, etc.\n"
            "Return ONLY JSON. No markdown, no extra text."
        )

    @staticmethod
    def _selected_image_model() -> str:
        return os.environ.get("PUBG_IMAGE_MODEL", "gemini-3-pro-image-preview")

    @staticmethod
    def _is_gemini_model(model_id: str) -> bool:
        return model_id.startswith("gemini-")

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self._image_client = None
        self._edit_model = None
        self._text_model = None
        self.last_prompt_text = ""
        self.last_prompt_meta = {}
        self.last_validation = {}
        self._attr_system_instruction = self._build_attribute_system_instruction()
        
        if self.api_key and GEMINI_AVAILABLE:
            try:
                genai_text.configure(api_key=self.api_key)
                self._image_client = genai_images.Client(api_key=self.api_key)
                
                text_model_name = "gemini-2.0-flash"
                selected = self._selected_image_model()
                edit_model_name = selected if self._is_gemini_model(selected) else "gemini-3-pro-image-preview"
                
                self._text_model = genai_text.GenerativeModel(
                    text_model_name,
                    system_instruction=self._attr_system_instruction
                )
                self._edit_model = genai_text.GenerativeModel(edit_model_name)
                    
                print(f"DEBUG: Models initialized - image={selected}, edit={edit_model_name}, text={text_model_name}")
            except Exception as e:
                print(f"DEBUG: Failed to initialize models: {e}")
                self._image_client = None
                self._edit_model = None
                self._text_model = None
        else:
            print("DEBUG: No API key or models unavailable - will use placeholder")
    
    # 4K-capable Nano Banana models (Gemini 3 series)
    _4K_MODELS = {"gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"}

    def _gemini_generate_image(self, contents, aspect_ratio="9:16", image_size="4K"):
        """Call google.genai SDK with image_config for full-resolution output.
        
        contents: list of str / PIL.Image items
        Returns PIL.Image or raises RuntimeError.
        """
        model_name = self._selected_image_model()
        if not self._is_gemini_model(model_name):
            model_name = "gemini-3-pro-image-preview"
        effective_size = image_size if model_name in self._4K_MODELS else "1K"

        config = genai_types.GenerateContentConfig(
            temperature=1.0,
            response_modalities=["TEXT", "IMAGE"],
            image_config=genai_types.ImageConfig(
                image_size=effective_size,
                aspect_ratio=aspect_ratio,
            ),
        )
        result = self._image_client.models.generate_content(
            model=model_name,
            contents=contents,
            config=config,
        )
        for part in result.parts:
            if part.inline_data is not None:
                return part.as_image().convert("RGBA")
        raise RuntimeError(f"No image data in {model_name} response")

    def _reset_model_cache(self):
        """Reset the models to clear any cached patterns."""
        if self.api_key and GEMINI_AVAILABLE:
            try:
                print("DEBUG: Resetting model cache...")
                genai_text.configure(api_key=self.api_key)
                
                text_model_name = "gemini-2.0-flash"
                selected = self._selected_image_model()
                edit_model_name = selected if self._is_gemini_model(selected) else "gemini-3-pro-image-preview"
                
                self._image_client = genai_images.Client(api_key=self.api_key)
                self._text_model = genai_text.GenerativeModel(
                    text_model_name,
                    system_instruction=self._attr_system_instruction
                )
                self._edit_model = genai_text.GenerativeModel(edit_model_name)
                    
                print(f"DEBUG: Model cache reset - image={selected}, edit={edit_model_name}")
            except Exception as e:
                print(f"DEBUG: Failed to reset model cache: {e}")
    
    def generate_character(self, character_description: str, width: int = 1536, height: int = 2816, reference_image: Optional[Image.Image] = None, edit_prompt: Optional[str] = None, view_type: str = "main", use_valor_lore: bool = False, lore_context_text: Optional[str] = None, lore_image_paths: Optional[list] = None, ref_a_image: Optional[Image.Image] = None, ref_b_image: Optional[Image.Image] = None, ref_c_image: Optional[Image.Image] = None) -> Image.Image:
        """Generate character concept image using Split Model Workflow.
        
        PATH A - Main Stage (Hero Image):
            Uses Imagen 4 (imagen-4.0-generate-001) at 2K resolution.
            
        PATH B - Ortho Views (Front/Back/Side):
            Uses Gemini 3 (gemini-3-pro-image-preview) with Main Stage as reference.
            Accepts native Gemini resolution (~1024x1792) to preserve identity.
            
        PATH C - Edit Mode:
            Uses Gemini 3 with reference image to apply localized edits.
            
        ref_a_image/ref_b_image/ref_c_image: Optional reference images that are only included
            if the edit_prompt explicitly mentions "ref a", "ref b", or "ref c".
        """
        target_size = (width, height)
        try:
            selected_model = self._selected_image_model()
            use_gemini_for_gen = self._is_gemini_model(selected_model)

            # ═══════════════════════════════════════════════════════════════════
            # PATH A: MAIN STAGE GENERATION
            # ═══════════════════════════════════════════════════════════════════
            if view_type == "main" and reference_image is None:
                
                style_prompt = (
                    "GENERATE IMAGE IN 9:16 PORTRAIT ASPECT RATIO (1536x2816). FULL BODY HEAD-TO-TOE IN FRAME (no cropping, feet visible). "
                    "AAA game character render with subtle stylization: realistic materials, crisp detail, slightly idealized proportions, soft even lighting, gentle contrast, neutral color grading, sharp focus, MAXIMUM 4K RESOLUTION. "
                    "Moderate stylization is OK; no illustration, no concept art look, no dramatic cinematic grading. Obey every user instruction exactly for CHARACTER details; ALWAYS use flat studio background."
                )
                
                prompt_sections = [
                    style_prompt,
                    build_view_prompt(view_type, character_description, use_valor_lore=use_valor_lore),
                    IMAGEN_BACKGROUND_DIRECTIVE,
                ]
                prompt_text = "\n\n".join(section for section in prompt_sections if section.strip())
                self.last_prompt_text = prompt_text
                self.last_prompt_meta = {"view": view_type, "path": "A", "model": selected_model}
                
                # ── Gemini multimodal path (Nano Banana family) ──
                if use_gemini_for_gen:
                    if self._image_client is None:
                        raise RuntimeError("Gemini client unavailable for Main Stage generation")
                    print(f"DEBUG: [PATH A] Main Stage via Gemini model {selected_model} at 4K")
                    image = self._gemini_generate_image(
                        [prompt_text],
                        aspect_ratio="9:16",
                        image_size="4K",
                    )
                    print(f"DEBUG: [PATH A] Gemini returned Main Stage {image.width}x{image.height}")
                    return image
                
                # ── Imagen API path ──
                if self._image_client is None:
                    raise RuntimeError("Imagen client unavailable for Main Stage generation")
                print(f"DEBUG: [PATH A] Main Stage via Imagen model {selected_model}")
                
                candidates = [{"name": f"models/{selected_model}", "supports_image_size": True}]
                if selected_model != "imagen-4.0-fast-generate-001":
                    for c in IMAGEN_MODEL_CANDIDATES:
                        if c["name"] != f"models/{selected_model}":
                            candidates.append(c)
                
                last_error = None
                for candidate in candidates:
                    model_name = candidate.get("name")
                    supports_image_size = candidate.get("supports_image_size", True)
                    try:
                        config_kwargs = {
                            "aspect_ratio": "9:16",
                            "number_of_images": 1,
                        }
                        if supports_image_size:
                            config_kwargs["image_size"] = "2K"
                        
                        response = self._image_client.models.generate_images(
                            model=model_name,
                            prompt=prompt_text,
                            config=genai_types.GenerateImagesConfig(**config_kwargs),
                        )
                        
                        generated_images = getattr(response, "generated_images", None) or []
                        for generated_image in generated_images:
                            image_obj = getattr(generated_image, "image", None)
                            if image_obj and getattr(image_obj, "image_bytes", None):
                                image = Image.open(io.BytesIO(image_obj.image_bytes)).convert("RGBA")
                                print(f"DEBUG: [PATH A] Imagen returned Main Stage {image.width}x{image.height}")
                                image = autocrop_and_resize(image, target_size)
                                return image
                        
                        print(f"DEBUG: No image data from {model_name}")
                    except Exception as model_error:
                        last_error = model_error
                        print(f"DEBUG: Imagen model {model_name} failed: {model_error}")
                        try:
                            status = (
                                getattr(model_error, "args", [{}])[0]
                                .get("error", {})
                                .get("status")
                            )
                        except Exception:
                            status = None
                        if status == "UNAVAILABLE":
                            time.sleep(0.5)
                        continue
                
                if last_error:
                    raise last_error
                raise RuntimeError("No image data returned by any Imagen model candidate")
            
            # ═══════════════════════════════════════════════════════════════════
            # PATH B: ORTHO VIEWS (Gemini 3 with reference - native resolution)
            # ═══════════════════════════════════════════════════════════════════
            elif reference_image is not None and view_type in ("front", "back", "side"):
                if self._image_client is None:
                    raise RuntimeError("Gemini client unavailable for ortho generation")
                
                user_prompt = (
                    f"TURNAROUND RENDER - Using the attached reference image as the SINGLE SOURCE OF TRUTH.\n\n"
                    f"Generate a {view_type.upper()} view of the EXACT SAME character from the reference. FULL BODY HEAD-TO-TOE IN FRAME (no cropping, feet visible).\n\n"
                    f"{build_view_prompt(view_type, character_description, use_valor_lore=use_valor_lore)}\n\n"
                    f"{LOCK_OUTFIT_BLOCK}\n\n"
                    f"{IMAGEN_BACKGROUND_DIRECTIVE}\n\n"
                    f"{IMAGEN_REFERENCE_BACKGROUND_OVERRIDE}"
                )
                self.last_prompt_text = user_prompt
                edit_model_id = selected_model if use_gemini_for_gen else "gemini-3-pro-image-preview"
                self.last_prompt_meta = {"view": view_type, "path": "B", "model": edit_model_id}
                
                print(f"DEBUG: [PATH B] Ortho {view_type} view with {edit_model_id} at 4K (reference-based)")
                image = self._gemini_generate_image(
                    [reference_image, user_prompt],
                    aspect_ratio="9:16",
                    image_size="4K",
                )
                print(f"DEBUG: [PATH B] Gemini returned {view_type} view {image.width}x{image.height}")
                return image
            
            # ═══════════════════════════════════════════════════════════════════
            # PATH C: EDIT MODE (Gemini 3 with reference + edit prompt)
            # ═══════════════════════════════════════════════════════════════════
            elif reference_image is not None and edit_prompt:
                if self._image_client is None:
                    raise RuntimeError("Gemini client unavailable for edit mode")
                
                prompt_lower = edit_prompt.lower()
                use_ref_a = "ref a" in prompt_lower or "ref_a" in prompt_lower
                use_ref_b = "ref b" in prompt_lower or "ref_b" in prompt_lower
                use_ref_c = "ref c" in prompt_lower or "ref_c" in prompt_lower
                
                style_notes = CHARACTER_STYLE_NOTES
                
                ref_context = ""
                if (use_ref_a and ref_a_image is not None) or (use_ref_b and ref_b_image is not None) or (use_ref_c and ref_c_image is not None):
                    ref_instructions = []
                    if use_ref_a and ref_a_image is not None:
                        ref_instructions.append(
                            "REF A is a DESIGN REFERENCE ONLY:\n"
                            "  \u2022 Copy its shape, silhouette, proportions, and overall form\n"
                            "  \u2022 Copy any logos, text, labels, and their exact placement\n"
                            "  \u2022 Copy damage patterns, scratches, wear marks, and details\n"
                            "  \u2022 Do NOT copy its art style, rendering, or illustration look\n"
                            "  \u2022 The RENDERING STYLE must match the main character image (realistic materials, lighting, shading)"
                        )
                    if use_ref_b and ref_b_image is not None:
                        ref_instructions.append(
                            "REF B is a DESIGN REFERENCE ONLY:\n"
                            "  \u2022 Copy its shape, silhouette, proportions, and overall form\n"
                            "  \u2022 Copy any logos, text, labels, and their exact placement\n"
                            "  \u2022 Copy damage patterns, scratches, wear marks, and details\n"
                            "  \u2022 Do NOT copy its art style, rendering, or illustration look\n"
                            "  \u2022 The RENDERING STYLE must match the main character image (realistic materials, lighting, shading)"
                        )
                    if use_ref_c and ref_c_image is not None:
                        ref_instructions.append(
                            "REF C is a DESIGN REFERENCE ONLY:\n"
                            "  \u2022 Copy its shape, silhouette, proportions, and overall form\n"
                            "  \u2022 Copy any logos, text, labels, and their exact placement\n"
                            "  \u2022 Copy damage patterns, scratches, wear marks, and details\n"
                            "  \u2022 Do NOT copy its art style, rendering, or illustration look\n"
                            "  \u2022 The RENDERING STYLE must match the main character image (realistic materials, lighting, shading)"
                        )
                    ref_context = (
                        "\n\n\U0001f3a8 STYLE vs DESIGN TRANSFER RULES:\n"
                        + "\n\n".join(ref_instructions) +
                        "\n\n\u26a0\ufe0f CRITICAL: The main character image defines the TARGET STYLE.\n"
                        "All added elements must be rendered with:\n"
                        "  \u2022 Realistic materials, lighting, and shading\n"
                        "  \u2022 No comic, cartoon, or illustrated outlines\n"
                        "  \u2022 Metal should look like real metal, plastic like real plastic\n"
                        "  \u2022 Match the same lighting, perspective, and resolution as the character\n"
                        "  \u2022 Make it look like it was photographed in the same studio setup\n"
                        "Use REF A, REF B, and REF C exactly as referenced in the prompt."
                    )
                
                user_prompt = (
                    f"VISUAL EDIT TASK:\n\n"
                    f"You are provided with a main character image that defines the TARGET RENDERING STYLE.\n\n"
                    f"\U0001f512 PRESERVATION REQUIREMENTS (MANDATORY):\n"
                    f"\u2022 Preserve 100% of the existing person's face, facial features, skin tone, and expression\n"
                    f"\u2022 Preserve 100% of the existing body type, build, and proportions\n"
                    f"\u2022 Preserve 100% of the existing pose and camera angle\n"
                    f"\u2022 Preserve 100% of all clothing and materials NOT mentioned in the edit\n"
                    f"\u2022 Maintain the exact same person - same individual, same appearance\n"
                    f"\u2022 Maintain the same realistic rendering style throughout\n\n"
                    f"\u270f\ufe0f MODIFICATION TO APPLY:\n"
                    f"{edit_prompt}\n\n"
                    f"Apply ONLY the above modification. Do NOT change anything else.\n\n"
                    f"FULL-BODY FRAMING (NON-NEGOTIABLE):\n"
                    f"\u2022 Character MUST be fully visible head-to-toe. No cropping of feet, hands, or limbs.\n"
                    f"\u2022 Keep entire silhouette comfortably inside frame with margin; do NOT clip edges.\n"
                    f"\u2022 Maintain 9:16 portrait full-body framing.\n\n"
                    f"\U0001f4cb Character Context:\n{character_description}\n\n"
                    f"{style_notes}\n\n"
                    f"{IMAGEN_BACKGROUND_DIRECTIVE}"
                    f"{ref_context}"
                )
                self.last_prompt_text = user_prompt
                edit_model_id = selected_model if use_gemini_for_gen else "gemini-3-pro-image-preview"
                self.last_prompt_meta = {"view": view_type, "path": "C", "model": edit_model_id}
                
                # Build contents: MAIN IMAGE FIRST (establishes style), then refs, then prompt
                contents = [reference_image]
                
                if use_ref_a and ref_a_image is not None:
                    contents.append(ref_a_image)
                    print(f"DEBUG: [PATH C] Including Ref A image (design reference)")
                if use_ref_b and ref_b_image is not None:
                    contents.append(ref_b_image)
                    print(f"DEBUG: [PATH C] Including Ref B image (design reference)")
                if use_ref_c and ref_c_image is not None:
                    contents.append(ref_c_image)
                    print(f"DEBUG: [PATH C] Including Ref C image (design reference)")
                
                contents.append(user_prompt)
                
                print(f"DEBUG: [PATH C] Edit via {edit_model_id} at 4K: '{edit_prompt[:50]}...' (refs: A={use_ref_a}, B={use_ref_b}, C={use_ref_c})")
                image = self._gemini_generate_image(
                    contents,
                    aspect_ratio="9:16",
                    image_size="4K",
                )
                print(f"DEBUG: [PATH C] Gemini returned edited image {image.width}x{image.height}")
                return image
            
            # ═══════════════════════════════════════════════════════════════════
            # FALLBACK: Unexpected combination - treat as main generation
            # ═══════════════════════════════════════════════════════════════════
            else:
                print(f"DEBUG: Unexpected state (view={view_type}, ref={reference_image is not None}, edit={edit_prompt is not None})")
                print(f"DEBUG: Falling back to Main Stage generation path")
                # Recursive call with explicit main view
                return self.generate_character(
                    character_description=character_description,
                    width=width,
                    height=height,
                    reference_image=None,
                    edit_prompt=None,
                    view_type="main",
                    use_valor_lore=use_valor_lore
                )
                
        except Exception as e:
            error_msg = str(e)
            print(f"DEBUG: Generation error: {error_msg}")
        
        # Fallback placeholder
        size = max(width, height)
        if edit_prompt:
            img = self._create_edit_placeholder(character_description, edit_prompt, size)
            return autocrop_and_resize(img, target_size)
        else:
            img = self._create_placeholder(character_description, size)
            return autocrop_and_resize(img, target_size)

    def validate_generated_image(self, image: Image.Image, required_items: list, forbidden_items: list) -> dict:
        """Use the image preview model to validate required/forbidden items."""
        if self._edit_model is None:
            return {"ok": True, "missing_required": [], "found_forbidden": [], "notes": "edit model unavailable"}
        try:
            import json
            import re
            import io

            req_text = "\n".join(f"- {item}" for item in required_items) if required_items else "- (none)"
            forb_text = "\n".join(f"- {item}" for item in forbidden_items) if forbidden_items else "- (none)"

            prompt = (
                "You are a strict visual checker. Analyze the image and verify the character matches the required items and avoids forbidden items.\n\n"
                "REQUIRED ITEMS (must be visible/true):\n"
                f"{req_text}\n\n"
                "FORBIDDEN ITEMS (must NOT appear):\n"
                f"{forb_text}\n\n"
                "Return ONLY JSON with this exact schema:\n"
                '{"ok": true/false, "missing_required": [..], "found_forbidden": [..], "notes": "short reason"}'
            )

            buf = io.BytesIO()
            image.save(buf, format="PNG")
            buf.seek(0)
            parts = [{"mime_type": "image/png", "data": buf.getvalue()}, prompt]
            result = self._edit_model.generate_content(parts)
            data = None
            raw_text = getattr(result, "text", "")
            if raw_text:
                try:
                    data = json.loads(raw_text)
                except Exception:
                    data = None
            if isinstance(data, dict) and "ok" in data:
                self.last_validation = data
                return data
            fallback = {"ok": True, "missing_required": [], "found_forbidden": [], "notes": "validation parse failed"}
            self.last_validation = fallback
            return fallback
        except Exception as e:
            fallback = {"ok": True, "missing_required": [], "found_forbidden": [], "notes": f"validation error: {e}"}
            self.last_validation = fallback
            return fallback
    
    def _create_placeholder(self, description: str, size: int) -> Image.Image:
        """Create a placeholder image with the character description."""
        canvas = Image.new("RGB", (size, size), (52, 52, 52))  # #343434 dark gray
        draw = ImageDraw.Draw(canvas)
        
        # Draw placeholder figure
        figure_color = (100, 100, 100)
        margin = size // 6
        
        # Head
        head_size = size // 8
        head_x = size // 2 - head_size // 2
        head_y = margin
        draw.ellipse([head_x, head_y, head_x + head_size, head_y + head_size], fill=figure_color)
        
        # Body
        body_width = size // 4
        body_height = size // 2
        body_x = size // 2 - body_width // 2
        body_y = head_y + head_size + 10
        draw.rectangle([body_x, body_y, body_x + body_width, body_y + body_height], fill=figure_color)
        
        # Arms
        arm_width = size // 12
        arm_height = size // 3
        # Left arm
        draw.rectangle([body_x - arm_width - 5, body_y + 20, body_x - 5, body_y + 20 + arm_height], fill=figure_color)
        # Right arm
        draw.rectangle([body_x + body_width + 5, body_y + 20, body_x + body_width + arm_width + 5, body_y + 20 + arm_height], fill=figure_color)
        
        # Legs
        leg_width = size // 12
        leg_height = size // 3
        leg_gap = 10
        # Left leg
        draw.rectangle([body_x + body_width//2 - leg_width - leg_gap//2, body_y + body_height, 
                       body_x + body_width//2 - leg_gap//2, body_y + body_height + leg_height], fill=figure_color)
        # Right leg
        draw.rectangle([body_x + body_width//2 + leg_gap//2, body_y + body_height,
                       body_x + body_width//2 + leg_width + leg_gap//2, body_y + body_height + leg_height], fill=figure_color)
        
        # Add text
        try:
            font = ImageFont.truetype("arial.ttf", size // 30)
        except:
            font = ImageFont.load_default()
        
        # Title
        title = "CHARACTER CONCEPT"
        title_bbox = draw.textbbox((0, 0), title, font=font)
        title_width = title_bbox[2] - title_bbox[0]
        draw.text((size // 2 - title_width // 2, 20), title, fill=(60, 60, 60), font=font)
        
        # Add key details from description
        lines = description.split('\n')[:8]  # First 8 lines
        y_offset = size - 200
        for i, line in enumerate(lines):
            if line.strip():
                # Truncate long lines
                if len(line) > 50:
                    line = line[:47] + "..."
                draw.text((20, y_offset + i * 20), line, fill=(80, 80, 80), font=font)
        
        # Add "No API Key" notice
        notice = "Connect API for AI generation"
        notice_bbox = draw.textbbox((0, 0), notice, font=font)
        notice_width = notice_bbox[2] - notice_bbox[0]
        draw.text((size // 2 - notice_width // 2, size - 40), notice, fill=(150, 150, 150), font=font)
        
        return canvas
    
    def _create_edit_placeholder(self, description: str, edit_prompt: str, size: int) -> Image.Image:
        """Create a placeholder image for editing mode."""
        canvas = Image.new("RGB", (size, size), (250, 240, 230))
        draw = ImageDraw.Draw(canvas)
        
        # Draw placeholder figure with edit indication
        figure_color = (120, 100, 80)
        margin = size // 6
        
        # Head
        head_size = size // 8
        head_x = size // 2 - head_size // 2
        head_y = margin
        draw.ellipse([head_x, head_y, head_x + head_size, head_y + head_size], fill=figure_color)
        
        # Body
        body_width = size // 4
        body_height = size // 2
        body_x = size // 2 - body_width // 2
        body_y = head_y + head_size + 10
        draw.rectangle([body_x, body_y, body_x + body_width, body_y + body_height], fill=figure_color)
        
        # Arms
        arm_width = size // 12
        arm_height = size // 3
        draw.rectangle([body_x - arm_width - 5, body_y + 20, body_x - 5, body_y + 20 + arm_height], fill=figure_color)
        draw.rectangle([body_x + body_width + 5, body_y + 20, body_x + body_width + arm_width + 5, body_y + 20 + arm_height], fill=figure_color)
        
        # Legs
        leg_width = size // 12
        leg_height = size // 3
        leg_gap = 10
        draw.rectangle([body_x + body_width//2 - leg_width - leg_gap//2, body_y + body_height, 
                       body_x + body_width//2 - leg_gap//2, body_y + body_height + leg_height], fill=figure_color)
        draw.rectangle([body_x + body_width//2 + leg_gap//2, body_y + body_height,
                       body_x + body_width//2 + leg_width + leg_gap//2, body_y + body_height + leg_height], fill=figure_color)
        
        # Add text
        try:
            font = ImageFont.truetype("arial.ttf", size // 30)
        except:
            font = ImageFont.load_default()
        
        # Title
        title = "CHARACTER EDIT"
        title_bbox = draw.textbbox((0, 0), title, font=font)
        title_width = title_bbox[2] - title_bbox[0]
        draw.text((size // 2 - title_width // 2, 20), title, fill=(60, 60, 60), font=font)
        
        # Edit prompt
        edit_lines = edit_prompt.split('\n')[:3]  # First 3 lines
        y_offset = size - 150
        for i, line in enumerate(edit_lines):
            if line.strip():
                if len(line) > 40:
                    line = line[:37] + "..."
                draw.text((20, y_offset + i * 20), f"Edit: {line}", fill=(100, 80, 60), font=font)
        
        # Add "No API Key" notice
        notice = "Connect API for AI editing"
        notice_bbox = draw.textbbox((0, 0), notice, font=font)
        notice_width = notice_bbox[2] - notice_bbox[0]
        draw.text((size // 2 - notice_width // 2, size - 40), notice, fill=(150, 150, 150), font=font)
        
        return canvas

    def generate_attributes_from_description(self, description: str, use_valor_lore: bool = False) -> dict:
        """Generate character attributes based on user description using AI."""
        if self._text_model is not None:
            try:
                prompt = (
                    "Extract the attributes for this character into the required JSON format.\n\n"
                    f"CHARACTER DESCRIPTION:\n{description}"
                )

                response = self._text_model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                
                if response and response.text:
                    import json
                    attributes = json.loads(response.text)
                    if attributes:
                        print(f"DEBUG: Successfully extracted attributes for {list(attributes.keys())}")
                        return attributes
                
                print(f"DEBUG: AI text model returned no valid data. Raw: {response.text if response else 'None'}")
                return None
                
            except Exception as e:
                print(f"Error in attribute generation: {e}")
                return None
        else:
            # Return placeholder attributes when no AI available
            return {
                "age": "Young adult",
                "race": "Human",
                "gender": "Male",
                "build": "Athletic",
                "headwear": "tactical cap",
                "outerwear": "utility jacket",
                "top": "combat shirt",
                "legwear": "cargo pants",
                "footwear": "combat boots",
                "gloves": "none",
                "facegear": "none",
                "utilityrig": "light chest rig",
                "backcarry": "none",
                "handprop": "none",
                "accessories": "none",
                "coloraccents": "black, gray",
                "detailing": "light wear"
            }

    def enhance_description(self, existing_description: str, use_valor_lore: bool = False) -> str:
        """Enhance an existing character description with more detail and richness."""
        if self._text_model is not None:
            try:
                prompt = f"""IMPORTANT: Respond with TEXT ONLY. Do not generate any images. Do not include any acknowledgments, explanations, labels, or introductory text. Start directly with the enhanced description as a single paragraph. Do NOT output JSON or bullet lists.

TASK: Take the following character description and enhance it with much more detail, depth, and richness while preserving the core identity and elements.

ORIGINAL DESCRIPTION:
{existing_description}

ENHANCEMENT GUIDELINES:
- Keep the same basic character identity, profession, and key traits
- Add more physical details (facial features, build, mannerisms, scars, etc.)
- Expand personality traits with specific examples and quirks  
- Include more specific clothing/gear descriptions with brand names and wear details
- Make the character feel more three-dimensional and lived-in
- Use vivid, specific language instead of generic descriptions

Return a single paragraph that reads like a natural description. Focus on visual elements that would help create a compelling character image. Be much more specific about everything while staying true to the original concept."""

                result = self._text_model.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.7,
                        "candidate_count": 1,
                    },
                )
                
                if result.text:
                    return result.text.strip()
                else:
                    return None
                    
            except Exception as e:
                print(f"Error enhancing description: {e}")
                return None
        return None

    def generate_chaos_description(self, use_valor_lore: bool = False) -> str:
        """Generate an exaggerated, unhinged character description."""
        if self._text_model is not None:
            try:
                prompt = f"""IMPORTANT: Respond with TEXT ONLY. Do not generate any images. Do not include any acknowledgments, explanations, or introductory text. Start directly with the character description.

Generate an exaggerated, GRITTY character description. Make them intense and over-the-top but grounded in harsh reality.

Examples of gritty exaggerated characters:
- A disgraced ex-cop turned strip club bouncer who's spent years getting beaten down, fiercely loyal to family but questioning how much loyalty is worth when survival is on the line
- A washed-up former real estate grifter facing prison time, smooth-talking but desperate, wondering if survival means becoming the monster he once pretended to be
- A bitter ex-day trader living out of his Cadillac, coked-up and resentful toward the system that spat him out, with a gambler's death wish and deep hatred of capitalism
- A failed pro wrestler pushing 40 with busted knees and concussion damage, joining out of stubborn pride and pathetic hope that he can still matter to someone
- A former child star reduced to junkie flophouses and autograph shows, broke and half-crazy, seeking a twisted kind of comeback that might get everyone killed

Make the character:
- GRITTY and weathered by hard work and disappointment
- Exaggerated obsessions, paranoia, or dedication to their work
- Distinctive worn/practical clothing that shows their lifestyle
- Specific habits born from years of routine or hardship
- Realistic blue-collar background with extreme personality traits

Create a detailed character description using this EXACT format:

[Character Name] - [Profession/Role]
Physical Appearance: [Detailed physical description including age, build, facial features, distinctive marks, mannerisms, gait, etc. - emphasize weathered, worn features]
Clothing & Gear: [Specific heavily worn clothing items, patched gear, tools with years of use, brand names with extreme wear details]
Character Essence: [Intense personality, obsessions, paranoia, or extreme dedication that shows in their appearance and body language]

Focus on GRITTY visual elements - scars, stains, patches, worn materials, and the toll of hard work. Be specific about extreme wear patterns and distinctive features."""

                # Use text model for description generation
                result = self._text_model.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.9,
                        "candidate_count": 1,
                    },
                )
                
                if result.text:
                    return result.text.strip()
                else:
                    return None
                    
            except Exception as e:
                print(f"Error generating chaos description: {e}")
                return None
        return None

    def generate_chaos_attributes(self, current_description: str = "", use_valor_lore: bool = False) -> str:
        """Generate exaggerated character attributes based on description."""
        if self._text_model is not None:
            try:
                prompt = f"""Based on this character description, generate exaggerated attributes in JSON format:

{current_description}

Make the attributes wild and over-the-top but matching the character's personality and style.

Generate JSON with these exact keys:
- age: (from: teen, young adult, adult, middle-aged, senior)  
- race: (pick appropriate ethnicity)
- gender: (male, female, or non-binary)
- build: (slim, average, stocky, athletic, heavyset, tall)
- headwear: (exaggerated hat/helmet/headgear or "none")
- outerwear: (wild jacket/coat/cape or "none") 
- top: (crazy shirt/vest/top)
- legwear: (outrageous pants/shorts/skirt)
- footwear: (extreme boots/shoes/footwear)
- gloves: (unusual gloves or "none")
- facegear: (wild glasses/mask/goggles or "none")
- utilityrig: (crazy belt/harness/rig or "none")
- backcarry: (wild backpack/bag/wings or "none")
- handprop: (strange tool/weapon/item or "none")
- accessories: (bizarre jewelry/items or "none")
- coloraccents: (describe wild colors and patterns)
- detailing: (describe exaggerated physical details)

Return ONLY valid JSON format:
{{"age": "value", "race": "value", "gender": "value", "build": "value", "headwear": "value", "outerwear": "value", "top": "value", "legwear": "value", "footwear": "value", "gloves": "value", "facegear": "value", "utilityrig": "value", "backcarry": "value", "handprop": "value", "accessories": "value", "coloraccents": "value", "detailing": "value"}}"""

                # Use text model for JSON generation
                result = self._text_model.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.8,
                        "candidate_count": 1,
                    },
                )

                if result.text:
                    return result.text.strip()
                else:
                    import json
                    return json.dumps({
                        "age": "middle-aged",
                        "race": "White / European descent",
                        "gender": "male",
                        "build": "stocky", 
                        "headwear": "oversized tinfoil hat with antenna",
                        "outerwear": "military surplus jacket covered in conspiracy patches",
                        "top": "t-shirt with aliens and government warnings",
                        "legwear": "cargo pants with excessive pockets",
                        "footwear": "combat boots with hidden compartments",
                        "gloves": "fingerless tactical gloves",
                        "facegear": "thick glasses with multiple magnifying attachments",
                        "utilityrig": "utility belt with surveillance equipment",
                        "backcarry": "backpack full of detection devices",
                        "handprop": "handheld radio scanner",
                        "accessories": "multiple conspiracy theory pins and badges",
                        "coloraccents": "olive drab, black, and warning orange",
                        "detailing": "paranoid expression, always looking over shoulder, multiple pockets bulging with gadgets"
                    })

            except Exception as e:
                print(f"Error generating chaos attributes: {e}")
                import json
                return json.dumps({
                    "age": "adult",
                    "race": "Mixed heritage",
                    "gender": "non-binary",
                    "build": "athletic",
                    "headwear": "wild colorful hat",
                    "outerwear": "eccentric vintage coat",
                    "top": "bizarre patterned shirt", 
                    "legwear": "unconventional pants",
                    "footwear": "outrageous custom boots",
                    "gloves": "artistic fingerless gloves",
                    "facegear": "unique sunglasses",
                    "utilityrig": "creative utility belt",
                    "backcarry": "artistic messenger bag",
                    "handprop": "unusual artistic tool",
                    "accessories": "eclectic jewelry collection",
                    "coloraccents": "vibrant rainbow palette",
                    "detailing": "expressive features, creative styling, artistic flair"
                })
        return None

    def generate_random_description(self, use_valor_lore: bool = False, avoid_patterns: list = None) -> str:
        """Generate a completely random character description using AI."""
        if self._text_model is not None:
            try:
                # Valor lore context disabled - no longer injecting full text block
                lore_context = ""
                demographic_guidance = ""
                # Inject external lore context lightly for text if available on app instance
                try:
                    from inspect import currentframe
                    # Heuristic: attempt to access outer 'self' (App instance) if called from UI thread
                    app_self = None
                    frame = currentframe()
                    while frame and not app_self:
                        loc = frame.f_locals
                        if "self" in loc and hasattr(loc["self"], "get_lore_parts"):
                            app_self = loc["self"]
                            break
                        frame = frame.f_back
                    if app_self:
                        lore_parts = app_self.get_lore_parts(mode="text")
                        if lore_parts:
                            # Prepend a short textual block if present
                            for part in lore_parts:
                                if isinstance(part, dict) and part.get("mime_type") == "text/plain":
                                    try:
                                        lore_text = part.get("data", b"").decode("utf-8", errors="ignore")
                                        lore_context = (lore_context or "") + lore_text + "\n\n"
                                    except Exception:
                                        pass
                                    break
                except Exception:
                    pass
                    demographic_guidance = """
IMPORTANT FOR VALOR LORE: This character should be an American who could realistically be found in Washington State in 1995. Focus on:
- American names (typical of 1990s America)
- BLUE-COLLAR PROFESSIONS: logger, mill worker, fisherman, mechanic, truck driver, construction worker, warehouse worker, factory worker, mining equipment operator, dock worker, electrician, plumber, welder, heavy machinery operator, forest service worker, park ranger, maintenance worker, security guard, delivery driver, railroad worker
- US backgrounds: ex-military, laid-off industrial worker, single parent, rural American, etc.
- American ethnicities: White, Black, Hispanic/Latino, Native American, Asian American
- 1990s American cultural references and economic struggles
- Pacific Northwest regional context (logging, fishing, manufacturing, transportation)

CRITICAL 1990s FASHION/TECH ACCURACY:
- Clothing: Flannel shirts, denim jackets, work boots, heavy canvas workwear, military surplus, plain t-shirts, leather jackets
- NO modern items: no smartphones, GPS, modern tactical gear, athleisure, skinny jeans, high-tech fabrics
- Technology: Portable music players, pagers, basic cell phones, film cameras, analog radios
- Materials: Cotton, wool, basic nylon, leather, canvas - simple, durable fabrics without modern tech features
- Aesthetic: Utilitarian, practical over fashionable, heavier materials, worn and weathered from hard use
- AVOID: Specific pop culture references, team logos, band names, or obvious cultural markers

"""
                
                # Add multiple randomness elements to prevent repetitive characters
                import random
                import time
                import hashlib
                
                # Create multiple random seeds
                time_seed = int(time.time() * 1000) % 100000
                random_seed = random.randint(10000, 99999)
                hash_seed = int(hashlib.md5(str(time.time()).encode()).hexdigest()[:8], 16) % 100000
                
                # Combine for maximum randomness
                combined_seed = time_seed + random_seed + hash_seed
                
                # Add random profession and ethnicity hints to force variety
                professions = ["mechanic", "truck driver", "construction worker", "warehouse worker", "factory worker", "electrician", "plumber", "welder", "maintenance worker", "security guard", "delivery driver", "cook", "retail worker", "nurse", "teacher", "office worker", "janitor", "cashier", "bartender", "carpenter"]
                ethnicities = ["Irish-American", "Mexican-American", "Japanese-American", "Nigerian-American", "Lebanese-American", "Korean-American", "Brazilian-American", "Italian-American", "Polish-American", "Vietnamese-American"]
                
                forced_profession = random.choice(professions)
                forced_ethnicity = random.choice(ethnicities)
                
                randomness_injection = f"RANDOMNESS INJECTION - Seed: {combined_seed} | Consider featuring: {forced_profession} profession, {forced_ethnicity} background (but feel free to deviate creatively)"
                
                # Add recent character avoidance
                avoidance_text = ""
                if avoid_patterns:
                    recent_summaries = "\n".join([f"- {pattern[:100]}..." for pattern in avoid_patterns[-5:]])  # Last 5 patterns
                    avoidance_text = f"\n\nRECENT CHARACTERS TO AVOID REPEATING:\n{recent_summaries}\n\nMake sure this new character is COMPLETELY DIFFERENT from these recent ones."
                
                prompt = f"""{lore_context}{demographic_guidance}IMPORTANT: Respond with TEXT ONLY. Do not generate any images. Do not include any acknowledgments, explanations, or introductory text. Start directly with the character description.

{randomness_injection}{avoidance_text}

CRITICAL: Forget all previous character descriptions you may have generated. This must be a completely fresh, original character that shares NO similarities with any previous responses. Break all patterns and create something genuinely new and unexpected.

AVOID REPETITIVE PATTERNS: 
- Do NOT use common names like "Ren", "Alex", "Sam", "Viktor", "Dmitri", or other frequently used names
- Do NOT default to Ukrainian, Russian, or Eastern European backgrounds unless specifically relevant
- AVOID repetitive professions: not everyone needs to be military, medic, or engineer
- AVOID obvious pop culture references: no specific band names, team logos, movie references, or cultural clichés
- CREATE UNIQUE combinations that haven't been used before

Create a unique character by randomly combining:
- A realistic profession or background (focus on common blue-collar and service jobs: mechanic, construction worker, truck driver, nurse, teacher, retail worker, warehouse worker, security guard, maintenance worker, cook, electrician, plumber, delivery driver, office worker, etc. - avoid exotic professions like clockmaker, circus performer, etc.)
- Personality traits and demeanor  
- Physical appearance details (age, ethnicity, build, distinctive features)
- Backstory elements
- Current situation or motivation
- Unique quirks or characteristics

Create a detailed character description using this EXACT format:

[Character Name] - [Profession/Role]
Physical Appearance: [Detailed physical description including age, build, facial features, distinctive marks, mannerisms, gait, etc.]
Clothing & Gear: [Specific clothing items, accessories, tools, equipment with brand names and wear details when appropriate]
Character Essence: [Personality, demeanor, background that shows in their appearance and body language]

Focus on visual elements that would help create a compelling character image. Be specific about clothing brands, wear patterns, scars, and distinctive features.

Examples of variety to include:
- Different professions: ex-con, disgraced doctor, failed salesperson, laid-off factory worker, washed-up entertainer, corrupt ex-cop, strip club bouncer, truck driver, warehouse worker, security guard, bartender, mechanic, construction worker, janitor, etc.
- Different backgrounds: desperate people with addiction/financial/legal troubles, failed entrepreneurs, displaced workers, people facing bankruptcy or prison, washed-up professionals, small-time criminals trying to go straight, etc.
- Different settings: suburban, rural, coastal, mountain, desert, forest, small town, big city, etc.
- Different personalities: cheerful, grumpy, curious, cautious, adventurous, introverted, extroverted, analytical, creative, etc.
- Different ethnicities and ages: vary widely to create diverse characters
- Different physical builds: petite, tall, stocky, lanky, curvy, muscular, etc.

Make each character truly unique and avoid repetitive patterns. RESPOND WITH TEXT ONLY - NO IMAGES."""

                # Use a text-only model for description generation
                response = self._text_model.generate_content(prompt)
                
                if response.text:
                    return response.text.strip()
                
                return None
                
            except Exception as e:
                print(f"Error generating random description: {e}")
                return None
        else:
            # Return a placeholder description when no AI available
            import random
            sample_descriptions = [
                "A grizzled ex-military engineer turned freelance problem-solver. Weathered face tells stories of desert campaigns and urban conflicts. Practical approach to gear - everything has a purpose. Prefers earth tones and proven equipment over flashy new tech.",
                "A young urban explorer with a background in parkour and photography. Athletic build, always ready to climb or run. Mixes street fashion with technical gear. Has an eye for detail and a collection of vintage accessories from abandoned buildings.",
                "A wilderness survival instructor who left corporate life behind. Calm demeanor masks years of outdoor experience. Favors natural materials and time-tested designs. Every piece of equipment has been field-tested in harsh conditions."
            ]
            return random.choice(sample_descriptions)

class FullScreenImageViewer:
    """Full-screen image viewer with zoom and pan functionality."""
    
    def __init__(self, parent, image):
        self.parent = parent
        self.original_image = image
        self.current_image = image
        self.zoom_factor = 1.0
        self.pan_x = 0
        self.pan_y = 0
        self.last_mouse_x = 0
        self.last_mouse_y = 0
        self.dragging = False
        
        # Create fullscreen window
        self.window = tk.Toplevel(parent)
        self.window.title("Image Viewer - ESC to close")
        self.window.configure(bg='black')
        
        # Make it fullscreen
        self.window.attributes('-fullscreen', True)
        self.window.attributes('-topmost', True)
        
        # Get screen dimensions
        self.screen_width = self.window.winfo_screenwidth()
        self.screen_height = self.window.winfo_screenheight()
        
        # Create canvas for image display
        self.canvas = tk.Canvas(
            self.window, 
            bg='black', 
            highlightthickness=0,
            width=self.screen_width,
            height=self.screen_height
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)
        
        # Bind events
        self.window.bind('<KeyPress-Escape>', self.close_viewer)
        self.window.bind('<Button-1>', self.start_drag)
        self.window.bind('<B1-Motion>', self.drag_image)
        self.window.bind('<ButtonRelease-1>', self.stop_drag)
        self.window.bind('<MouseWheel>', self.zoom_image)
        self.canvas.bind('<MouseWheel>', self.zoom_image)
        
        # Focus the window to receive key events
        self.window.focus_set()
        
        # Initial display
        self.update_display()
    
    def start_drag(self, event):
        """Start dragging the image."""
        self.dragging = True
        self.last_mouse_x = event.x
        self.last_mouse_y = event.y
        self.window.config(cursor="hand2")
    
    def drag_image(self, event):
        """Drag the image around."""
        if self.dragging:
            dx = event.x - self.last_mouse_x
            dy = event.y - self.last_mouse_y
            self.pan_x += dx
            self.pan_y += dy
            self.last_mouse_x = event.x
            self.last_mouse_y = event.y
            self.update_display()
    
    def stop_drag(self, event):
        """Stop dragging the image."""
        self.dragging = False
        self.window.config(cursor="")
    
    def zoom_image(self, event):
        """Zoom in/out with mouse wheel."""
        # Get mouse position relative to canvas
        mouse_x = self.canvas.canvasx(event.x)
        mouse_y = self.canvas.canvasy(event.y)
        
        # Calculate zoom
        if event.delta > 0:  # Zoom in
            zoom_change = 1.1
        else:  # Zoom out
            zoom_change = 0.9
        
        # Update zoom factor with limits
        new_zoom = self.zoom_factor * zoom_change
        if 0.1 <= new_zoom <= 10.0:  # Limit zoom range
            # Adjust pan to zoom toward mouse position
            self.pan_x = mouse_x - (mouse_x - self.pan_x) * zoom_change
            self.pan_y = mouse_y - (mouse_y - self.pan_y) * zoom_change
            self.zoom_factor = new_zoom
            self.update_display()
    
    def update_display(self):
        """Update the image display with current zoom and pan."""
        if not self.original_image:
            return
        
        # Calculate new image size
        orig_width, orig_height = self.original_image.size
        new_width = int(orig_width * self.zoom_factor)
        new_height = int(orig_height * self.zoom_factor)
        
        # Resize image
        if new_width > 0 and new_height > 0:
            resized_image = self.original_image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            self.current_image = ImageTk.PhotoImage(resized_image)
            
            # Clear canvas and display image
            self.canvas.delete("all")
            
            # Calculate image position (center + pan offset)
            img_x = (self.screen_width // 2) - (new_width // 2) + self.pan_x
            img_y = (self.screen_height // 2) - (new_height // 2) + self.pan_y
            
            self.canvas.create_image(img_x, img_y, anchor=tk.NW, image=self.current_image)
            
            # Add instructions text
            instructions = "ESC: Close | Mouse Wheel: Zoom | Click & Drag: Pan"
            self.canvas.create_text(
                self.screen_width // 2, 30, 
                text=instructions, 
                fill="white", 
                font=("Arial", 12)
            )
            
            res_text = f"{orig_width} \u00d7 {orig_height}"
            self.canvas.create_rectangle(4, self.screen_height - 28, len(res_text) * 8 + 20, self.screen_height - 4,
                                         fill="#111111", outline="")
            self.canvas.create_text(12, self.screen_height - 16, text=res_text, fill="#CCCCCC",
                                    font=("Consolas", 10), anchor="w")
    
    def close_viewer(self, event=None):
        """Close the fullscreen viewer."""
        self.window.destroy()


class ProgressDialog:
    """Progress dialog with animated progress bar for AI operations."""
    
    def __init__(self, parent, title="AI Processing", message="Working..."):
        self.dialog = tk.Toplevel(parent)
        self.dialog.title(title)
        self.dialog.geometry("400x150")
        self.dialog.resizable(False, False)
        self.dialog.transient(parent)
        self.dialog.grab_set()
        
        # Center the dialog on screen
        self.dialog.update_idletasks()
        width = self.dialog.winfo_width()
        height = self.dialog.winfo_height()
        x = (self.dialog.winfo_screenwidth() // 2) - (width // 2)
        y = (self.dialog.winfo_screenheight() // 2) - (height // 2)
        self.dialog.geometry(f"{width}x{height}+{x}+{y}")
        
        
        # Main frame
        main_frame = ttk.Frame(self.dialog, padding=20)
        main_frame.pack(fill="both", expand=True)
        
        # Message label
        self.message_label = ttk.Label(main_frame, text=message, font=("Arial", 11))
        self.message_label.pack(pady=(0, 15))
        
        # Progress bar (indeterminate mode)
        self.progress = ttk.Progressbar(main_frame, mode="indeterminate", length=300)
        self.progress.pack(pady=(0, 15))
        self.progress.start(10)  # Start animation
        
        # Status label
        self.status_label = ttk.Label(main_frame, text="Initializing...", font=("Arial", 9), foreground="gray")
        self.status_label.pack()
        
        # Prevent dialog from being closed by user
        self.dialog.protocol("WM_DELETE_WINDOW", lambda: None)
        
        # Update the display
        self.dialog.update()
    
    def update_message(self, message):
        """Update the main message."""
        self.message_label.config(text=message)
        self.dialog.update()
    
    def update_status(self, status):
        """Update the status text."""
        self.status_label.config(text=status)
        self.dialog.update()
    
    def close(self):
        """Close the progress dialog."""
        self.progress.stop()
        self.dialog.destroy()

class EditDialog:
    """Dialog for entering character edit instructions with edit history."""
    
    def __init__(self, parent, edit_history=None):
        self.result = None
        
        # Create dialog window
        self.dialog = tk.Toplevel(parent)
        self.dialog.title("Edit Character")
        self.dialog.geometry("1200x400")
        self.dialog.transient(parent)
        self.dialog.grab_set()
        
        # Center the dialog
        self.dialog.update_idletasks()
        x = (self.dialog.winfo_screenwidth() // 2) - (1200 // 2)
        y = (self.dialog.winfo_screenheight() // 2) - (400 // 2)
        self.dialog.geometry(f"1200x400+{x}+{y}")
        
        # Create main container with two panels
        container = ttk.Frame(self.dialog, padding=10)
        container.pack(fill="both", expand=True)
        
        # Left panel - Edit input
        left_panel = ttk.Frame(container)
        left_panel.pack(side="left", fill="both", expand=True, padx=(0, 5))
        
        # Instructions
        instructions = ttk.Label(left_panel, text="Describe what you want to change about the character:")
        instructions.pack(anchor="w", pady=(0, 10))
        
        # Examples
        examples_text = "Examples:\n• Change the jacket to a red leather jacket\n• Replace boots with sneakers\n• Add sunglasses\n• Change hair color to blonde"
        from dark_theme import DarkTheme
        examples = ttk.Label(left_panel, text=examples_text, foreground=DarkTheme.TEXT_FG)
        examples.pack(anchor="w", pady=(0, 10))
        
        # Text area
        text_frame = ttk.Frame(left_panel)
        text_frame.pack(fill="both", expand=True, pady=(0, 10))
        
        self.text_area = tk.Text(text_frame, wrap="word", height=8)
        scrollbar = ttk.Scrollbar(text_frame, orient="vertical", command=self.text_area.yview)
        self.text_area.configure(yscrollcommand=scrollbar.set)
        
        self.text_area.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Buttons
        button_frame = ttk.Frame(left_panel)
        button_frame.pack(fill="x")
        
        ttk.Button(button_frame, text="Cancel", command=self.cancel).pack(side="right", padx=(10, 0))
        ttk.Button(button_frame, text="Edit Character", command=self.ok).pack(side="right")
        
        # Right panel - Edit history
        right_panel = ttk.LabelFrame(container, text="Edit History", padding=10)
        right_panel.pack(side="right", fill="both", expand=False, padx=(5, 0))
        
        # History text area (read-only)
        history_frame = ttk.Frame(right_panel)
        history_frame.pack(fill="both", expand=True)
        
        self.history_text = tk.Text(history_frame, wrap="word", width=70, height=20, state="disabled")
        history_scrollbar = ttk.Scrollbar(history_frame, orient="vertical", command=self.history_text.yview)
        self.history_text.configure(yscrollcommand=history_scrollbar.set)
        
        self.history_text.pack(side="left", fill="both", expand=True)
        history_scrollbar.pack(side="right", fill="y")
        
        # Populate history
        if edit_history and len(edit_history) > 0:
            self.history_text.configure(state="normal")
            for timestamp, prompt in reversed(edit_history):  # Most recent first
                self.history_text.insert("end", f"[{timestamp}]\n", "timestamp")
                self.history_text.insert("end", f"{prompt}\n\n", "prompt")
            self.history_text.tag_config("timestamp", foreground="#888888", font=("Segoe UI", 9, "bold"))
            self.history_text.tag_config("prompt", foreground=DarkTheme.TEXT_FG)
            self.history_text.configure(state="disabled")
        else:
            self.history_text.configure(state="normal")
            self.history_text.insert("end", "No previous edits yet.", "empty")
            self.history_text.tag_config("empty", foreground="#888888", font=("Segoe UI", 9, "italic"))
            self.history_text.configure(state="disabled")
        
        # Focus and wait
        self.text_area.focus()
        self.dialog.wait_window()
    
    def ok(self):
        self.result = self.text_area.get("1.0", "end-1c").strip()
        self.dialog.destroy()
    
    def cancel(self):
        self.result = None
        self.dialog.destroy()

class FieldRow:
    def __init__(self, parent, field_name, common_options, rare_options, row):
        self.field_name = field_name
        self.var = tk.StringVar()
        self.custom_var = tk.StringVar()
        self.common = common_options
        self.rare = rare_options

        ttk.Label(parent, text=field_name).grid(row=row, column=0, sticky="w", padx=(6, 4), pady=2)

        self.combo = ttk.Combobox(parent, textvariable=self.var, values=self.common, width=35, state="normal")
        self.combo.grid(row=row, column=1, sticky="we", padx=4, pady=2)
        self.combo.set("")  # start blank

        self.random_btn = ttk.Button(parent, text="Random", command=self.randomize, width=8)
        self.random_btn.grid(row=row, column=2, sticky="w", padx=4, pady=2)
        ToolTip(self.random_btn, f"Select a random {field_name.lower()} option from the rare/uncommon list.")

        # Custom text entry
        self.custom_entry = ttk.Entry(parent, textvariable=self.custom_var, width=25)
        self.custom_entry.grid(row=row, column=3, sticky="we", padx=(4, 6), pady=2)

        # Configure column weights
        parent.grid_columnconfigure(1, weight=2)  # Combobox gets more space
        parent.grid_columnconfigure(3, weight=1)  # Custom entry gets some space


    def randomize(self):
        if self.rare:
            self.var.set(random.choice(self.rare))
            # Clear custom text when using random
            self.custom_var.set("")

    def get_value(self):
        """Get the value, prioritizing custom text over dropdown selection."""
        custom_text = self.custom_var.get().strip()
        if custom_text:
            return custom_text
        return self.var.get().strip()

    def clear(self):
        self.var.set("")
        self.custom_var.set("")

class App:
    def __init__(self, root):
        self.root = root
        root.title(APP_TITLE)
        
        # Start maximized/fullscreen
        try:
            root.state('zoomed')  # Windows
        except tk.TclError:
            # Fallback for other platforms
            root.attributes('-zoomed', True)  # Linux
        except:
            # Final fallback - just maximize normally
            root.geometry(f"{APP_WIDTH}x{APP_HEIGHT}")
            root.wm_state('normal')
        
        self.gemini_client = None
        self.current_image = None
        self.generating = False
        self.progress_dialog = None
        
        # Track recent generations to avoid repetition
        self.recent_characters = []  # Store recent character descriptions
        self.max_recent_memory = 10  # Remember last 10 characters
        
        # Multi-view management
        self.current_view = "stage"
        self.view_canvases = {}
        self.view_images = {"stage": None, "main": None}
        self.view_zoom = {}
        self.view_offset = {}
        self.view_last_pos = {}
        self.view_drag_update_pending = {}
        self.view_tk_image = {}
        self.view_context_menu = {}
        self.view_edit_prompts = {
            "stage": "",
            "main": "",
            "front": "",
            "back": "",
            "side": "",
            "ref_a": "",
            "ref_b": "",
            "ref_c": "",
        }
        for view_name in ["front", "back", "side", "ref_a", "ref_b", "ref_c"]:
            self.view_images[view_name] = None
        self.main_character_description = ""
        self.main_reference_image = None  # pixel source for all other views
        self.main_prompt_snapshot = ""    # prompt text used when main was generated
        self.current_character_folder = None  # Track current character folder for individual saves
        
        # Main Stage viewer state (zoom, pan, context menu)
        self.stage_canvas = None
        self.stage_zoom = 1.0
        self.stage_offset = [0, 0]
        self.stage_last_pos = None
        self.stage_drag_update_pending = False
        self.stage_tk_image = None
        self.stage_context_menu = None
        
        # Session log and prompt history
        self.session_log = []
        self.character_history = []  # Track all actions for this character
        self.current_character_name = None  # Track character name for saves
        
        # Persistent edit registry and metadata system
        self.edit_registry = {}  # Maps image_path → list of {timestamp, prompt, image_file, is_original}
        self.image_metadata = {}  # Maps image_path → {identity, attributes, description, notes}
        self.active_edit = None  # Currently selected edit image filename
        self.current_edit_base_path = None  # Track current base path for edit history display
        self.pasted_image_cache = None  # Cache the original pasted image so user can revert to it
        
        # Working state preservation for the latest image
        self.working_state = {}  # Stores temporary UI state when navigating away from latest image
        
        # Auto-save directory for all generated images
        suite_save_root = os.environ.get("PUBG_SUITE_SAVE_ROOT")
        if suite_save_root:
            base_root = Path(suite_save_root)
            if "ALL GENERATED IMAGES" not in str(base_root):
                self.all_generated_dir = base_root / "IMAGES" / "ALL GENERATED IMAGES" / "Character Generator"
            else:
                self.all_generated_dir = base_root / "Character Generator"
        else:
            self.all_generated_dir = Path(app_data_path("IMAGES", "ALL GENERATED IMAGES", "Character Generator"))
        self.all_generated_dir.mkdir(parents=True, exist_ok=True)
        
        # Image history navigation
        self.image_history = []  # List of file paths for generated images in this session
        self.history_index = -1  # Index of currently displayed image in image_history

        # Lore Library Workspace
        self.lore_enabled = False
        self.lore_dir = Path(app_data_path("LORE_LIBRARY"))
        self.lore_dir.mkdir(exist_ok=True)
        self.lore_context = ""
        self.lore_images = []
        self.lore_last_modified = 0
        self.lore_summary_var = tk.StringVar(value="Lore disabled")
        self.lore_weight_var = tk.DoubleVar(value=0.0)

        prompt_dir = Path(os.environ.get("PUBG_SUITE_ROOT", Path(__file__).resolve().parent))
        self.last_prompt_path = prompt_dir / "last_character_prompt.txt"

        # Check for API key on startup
        self.setup_api_key()

        self.fields = {}
        self.setup_ui()
        
        # Initialize edit history display
        self.update_edit_history_display()

        # Initialize lore and start watcher
        if self.lore_enabled:
            try:
                self.refresh_lore_context()
                self.monitor_lore_folder()
            except Exception:
                pass
        
        # Log session start with version info
        self.log_event(f"New session started - {APP_TITLE}")
        
        # Setup exit handler for session log
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

    def setup_api_key(self):
        """Setup Gemini API key - independent from other tools."""
        if not GEMINI_AVAILABLE:
            messagebox.showerror("Missing Dependencies", 
                               "Required packages not found.\n\nInstall with:\npip install Pillow google-generativeai")
            return

        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
        
        # Initialize Gemini client
        if api_key and api_key != "your_key_here":
            self.gemini_client = GeminiClient(api_key)
        else:
            self.gemini_client = GeminiClient(None)

    def log_event(self, message: str):
        """Log a session event with timestamp."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        entry = f"[{timestamp}] {message}"
        self.session_log.append(entry)
        try:
            print(entry)  # Console debug output
        except UnicodeEncodeError:
            # Handle unicode characters that can't be encoded on Windows console
            print(entry.encode('utf-8', errors='replace').decode('utf-8', errors='replace'))

    def save_session_log(self):
        """Save session log to a timestamped text file."""
        if not self.session_log:
            messagebox.showinfo("No Log", "No session activity to save yet.")
            return
        
        logs_dir = Path(app_data_path("logs"))
        logs_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_file = logs_dir / f"session_log_{timestamp}.txt"
        
        try:
            with open(log_file, "w", encoding="utf-8") as f:
                f.write("=" * 80 + "\n")
                f.write(f"{APP_TITLE} - SESSION LOG\n")
                f.write("=" * 80 + "\n\n")
                f.write("\n".join(self.session_log))
                f.write("\n\n" + "=" * 80 + "\n")
                f.write(f"Log saved: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("=" * 80 + "\n")
            
            self.log_event(f"Session log saved to: {log_file.name}")
            messagebox.showinfo("Log Saved", f"Session log saved to:\n{log_file}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Failed to save log:\n{e}")

    def _show_ai_progress(self, title: str, message: str):
        if self.progress_dialog and getattr(self.progress_dialog, "dialog", None):
            try:
                if self.progress_dialog.dialog.winfo_exists():
                    self.progress_dialog.update_message(message)
                    self.progress_dialog.update_status(message)
                    return self.progress_dialog
            except Exception:
                pass
        self.progress_dialog = ProgressDialog(self.root, title, message)
        return self.progress_dialog

    def _update_ai_progress(self, status: str):
        if self.progress_dialog and getattr(self.progress_dialog, "dialog", None):
            try:
                if self.progress_dialog.dialog.winfo_exists():
                    self.progress_dialog.update_status(status)
            except Exception:
                pass

    def _close_ai_progress(self):
        if self.progress_dialog:
            try:
                self.progress_dialog.close()
            except Exception:
                pass
            self.progress_dialog = None

    def open_generated_images_folder(self):
        """Open the generated images root folder."""
        try:
            self.all_generated_dir.mkdir(parents=True, exist_ok=True)
            os.startfile(str(self.all_generated_dir))
            self.status.set("Opened generated images folder.")
        except Exception as e:
            self.status.set(f"Could not open generated images folder: {e}")

    def save_last_prompt(self, prompt_text: str, view_name: str, meta: Optional[dict] = None):
        """Persist the latest full prompt to a single file (overwrites)."""
        try:
            meta = meta or {}
            model = meta.get("model", "")
            path = meta.get("path", "")
            payload = (
                f"VIEW: {view_name}\n"
                f"TIMESTAMP: {datetime.now().isoformat(timespec='seconds')}\n"
                f"MODEL: {model}\n"
                f"PATH: {path}\n\n"
                f"{prompt_text.strip()}\n"
            )
            self.last_prompt_path.write_text(payload, encoding="utf-8")
        except Exception as e:
            self.log_event(f"Failed to save last prompt: {e}")
    
    def on_closing(self):
        """Handle application exit with optional session log save."""
        if self.session_log:
            result = messagebox.askyesnocancel(
                "Save Session Log?",
                "Would you like to save the session log before closing?\n\n"
                "This will export all activity from this session to a text file.",
                icon="question"
            )
            
            if result is None:  # Cancel
                return  # Don't close
            elif result:  # Yes - save log
                self.save_session_log()
        
        # Close the application (destroy toplevel, not just the frame)
        try:
            self.root.winfo_toplevel().destroy()
        except Exception:
            self.root.destroy()
    
    def log_new_base_image(self, image_path, label="Generated Character"):
        """Add a new base image (generation or opened file) to the macro Image History."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # Add to image history for navigation
        self.image_history.append(image_path)
        self.history_index = len(self.image_history) - 1
        
        self.status.set(f"Added new base image to Image History: {label}")
        self.log_event(f"Image History: added {label} ({Path(image_path).name})")
    
    def auto_save_generated_image(self, image: Image.Image, view_name: str, generation_type: str = "generate"):
        """Automatically save all generated images to archive folder with metadata, organized by date."""
        try:
            from uuid import uuid4
            import json
            
            # Ensure the base output directory exists
            self.all_generated_dir.mkdir(parents=True, exist_ok=True)
            
            # Create date-based subfolder (e.g., "2025-12-09")
            date_folder = datetime.now().strftime("%Y-%m-%d")
            date_dir = self.all_generated_dir / date_folder
            date_dir.mkdir(parents=True, exist_ok=True)
            
            # Create unique filename
            unique_id = uuid4().hex[:8]
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            auto_name = f"auto_{timestamp}_{unique_id}_{view_name}_{generation_type}.png"
            
            auto_path = date_dir / auto_name
            
            # Collect metadata for this generation in organized structure
            metadata = {
                "==== FILE INFO ====": {
                    "generated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "image_file": auto_name,
                    "view_type": view_name,
                    "generation_type": generation_type,
                    "app_version": APP_TITLE
                },
                
                "==== CHARACTER IDENTITY ====": {
                    "age": self.age_var.get() or "not specified",
                    "race": self.race_var.get() or "not specified",
                    "gender": self.gender_var.get() or "not specified",
                    "build": self.build_var.get() or "not specified"
                },
                
                "==== CHARACTER ATTRIBUTES ====": {
                    fname: (fr.get_value() or "none")
                    for fname, fr in sorted(self.fields.items())
                },
                
                "==== DESCRIPTION & NOTES ====": {
                    "character_description": self.get_character_description() or "no description provided"
                },
                
                "==== EDIT HISTORY ====": self.edit_registry.get(str(auto_path), [])
            }
            
            # Store metadata for this image
            self.image_metadata[str(auto_path)] = {
                "identity": {
                    "age": self.age_var.get() or "not specified",
                    "race": self.race_var.get() or "not specified",
                    "gender": self.gender_var.get() or "not specified",
                    "build": self.build_var.get() or "not specified"
                },
                "attributes": {fname: (fr.get_value() or "none") for fname, fr in self.fields.items()},
                "description": self.get_character_description() or "no description provided"
            }
            
            metadata_path = auto_path.with_suffix(".json")
            
            # Save in background thread to avoid blocking UI
            def save_thread():
                try:
                    image.save(auto_path)
                    with open(metadata_path, "w", encoding="utf-8") as f:
                        json.dump(metadata, f, indent=4, ensure_ascii=False)
                    self.log_event(f"Auto-saved: {auto_name}")
                    self.log_event(f"Saved metadata: {metadata_path.name}")
                    self.log_event(f"Added to session history ({self.history_index + 1} images total)")
                except Exception as e:
                    print(f"Auto-save failed: {e}")
            
            threading.Thread(target=save_thread, daemon=True).start()
            
            # Return the full path for edit history tracking
            return str(auto_path)
            
        except Exception as e:
            print(f"Auto-save setup failed: {e}")
            return None
    
    def step_back_image(self):
        """Move one image back in session history."""
        if not self.image_history or self.history_index <= 0:
            return

        # Capture current working state if we're on the most recent image
        if self.history_index == len(self.image_history) - 1:
            self.capture_working_state()

        self.history_index -= 1
        image_path = self.image_history[self.history_index]
        self.load_image_from_history(image_path)
        self.load_metadata_for_image(image_path)
        self.update_edit_history_display(image_path)
        self.status.set(f"Showing image {self.history_index + 1}/{len(self.image_history)}")
        self.log_event(f"Stepped back to image {self.history_index + 1}.")

    def step_forward_image(self):
        """Move one image forward in session history."""
        if not self.image_history or self.history_index >= len(self.image_history) - 1:
            return

        self.history_index += 1
        image_path = self.image_history[self.history_index]
        self.load_image_from_history(image_path)
        
        # If at the most recent image, restore user's working state
        if self.history_index == len(self.image_history) - 1:
            self.restore_working_state()
        else:
            # Otherwise load saved metadata
            self.load_metadata_for_image(image_path)
        
        self.update_edit_history_display(image_path)
        self.status.set(f"Showing image {self.history_index + 1}/{len(self.image_history)}")
        self.log_event(f"Stepped forward to image {self.history_index + 1}.")

    def jump_to_start(self):
        """Jump to the first image in session history."""
        if not self.image_history or self.history_index == 0:
            return

        # Capture current working state if we're on the most recent image
        if self.history_index == len(self.image_history) - 1:
            self.capture_working_state()

        self.history_index = 0
        image_path = self.image_history[0]
        self.load_image_from_history(image_path)
        self.load_metadata_for_image(image_path)
        self.update_edit_history_display(image_path)
        self.status.set(f"Jumped to first image (1/{len(self.image_history)})")
        self.log_event("Jumped to first image in history.")

    def jump_to_end(self):
        """Jump to the latest image in session history."""
        if not self.image_history or self.history_index == len(self.image_history) - 1:
            return

        self.history_index = len(self.image_history) - 1
        image_path = self.image_history[-1]
        self.load_image_from_history(image_path)
        
        # Restore user's working state when returning to latest image
        self.restore_working_state()
        
        self.update_edit_history_display(image_path)
        self.status.set(f"Jumped to latest image ({self.history_index + 1}/{len(self.image_history)})")
        self.log_event("Jumped to latest image in history.")

    def quick_generate_character(self):
        """Instantly randomize a new AI character and generate its image."""
        if self.generating:
            return  # avoid overlapping calls

        if (
            not self.gemini_client
            or not self.gemini_client._image_client
            or not self.gemini_client._text_model
        ):
            messagebox.showerror("No AI Client", "Gemini AI client not available.")
            return

        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        self.status.set("⚡ Quick generating random character and image...")
        self.progress_dialog = ProgressDialog(self.root, "Quick Generate", "Creating character + image...")

        def run_quick_gen():
            try:
                # 1️⃣ Generate a random description (training context stays internal in Gemini client)
                self.root.after(0, lambda: self.progress_dialog.update_status("Randomizing character..."))
                desc = self.gemini_client.generate_random_description(use_valor_lore=use_valor_lore)
                
                self.log_event("Generated random character description.")

                # 2️⃣ Generate attributes from description
                self.root.after(0, lambda: self.progress_dialog.update_status("Extracting attributes..."))
                attributes = self.gemini_client.generate_attributes_from_description(desc, use_valor_lore=use_valor_lore)
                
                self.log_event("Generated attributes from description.")

                # 3️⃣ Generate image from that description
                self.root.after(0, lambda: self.progress_dialog.update_status("Generating image..."))
                image = self.gemini_client.generate_character(
                    desc,
                    width=1536,
                    height=2816,
                    view_type="main",
                    use_valor_lore=use_valor_lore
                )

                # 4️⃣ Update UI with generated data
                def finish(image=image, desc=desc, attributes=attributes):
                    # Apply attributes to UI fields FIRST
                    self.apply_generated_attributes(attributes)
                    
                    # Update description (avoid raw JSON)
                    desc_text = desc or ""
                    try:
                        import json
                        if isinstance(desc_text, str) and desc_text.strip().startswith("{"):
                            parsed = json.loads(desc_text)
                            desc_text = self._attributes_to_appearance_description(parsed) or ""
                    except Exception:
                        pass
                    if not desc_text:
                        desc_text = self._attributes_to_appearance_description(attributes) or ""
                    self.character_desc_text.delete("1.0", "end")
                    self.character_desc_text.insert("1.0", desc_text)
                    
                    # THEN save image with metadata (now includes populated fields)
                    self.on_generation_complete(image, "main")  # Quick generate always uses main view
                    
                    self.status.set("⚡ Quick generation complete!")
                    self.log_event("Quick generated random character and image.")

                self.root.after(0, finish)

            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Quick Gen Error", f"Failed: {e}"))
                self.root.after(0, lambda: self.status.set("Quick generation failed."))
            finally:
                def cleanup():
                    self.generating = False
                    if self.progress_dialog:
                        self.progress_dialog.close()
                
                self.root.after(0, cleanup)

        threading.Thread(target=run_quick_gen, daemon=True).start()

    def extract_attributes_from_image(self):
        """Use AI to analyze the current Main Stage image and auto-fill all fields."""
        img = self.view_images.get("stage")
        if not img:
            messagebox.showinfo("No Image", "No image available on Main Stage to analyze.")
            return
        
        if not self.gemini_client or not self.gemini_client._text_model:
            messagebox.showerror("No AI Client", "Gemini AI client not available.")
            return
        
        # Pre-fetch Tkinter values in main thread
        use_valor_lore = self.valor_lore_var.get()
        
        self.status.set("🧠 Analyzing image...")
        self.progress_dialog = ProgressDialog(self.root, "Extracting Attributes", "Analyzing image with AI...")
        
        def run_extraction():
            try:
                # 1) Get description from image
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                buf.seek(0)
                
                self.root.after(0, lambda: self.progress_dialog.update_status("Describing character..."))
                
                desc_prompt = f"""Analyze this image in full detail and write a 1-2 paragraph character appearance summary.
Focus ONLY on visible appearance: age, race, build, face, hair (color, length, texture, style), and clothing/gear (materials, colors, condition).
Do NOT describe actions, pose, or what the person is doing. Do NOT mention background, setting, environment, or props outside the outfit.
IMPORTANT: Explicitly state the body build using ONE of these exact terms: {', '.join(BUILD_OPTIONS)}.
Also describe body size/weight in plain language so it is unmistakable.
Return ONLY the description text, no JSON or formatting."""

                parts = self.get_lore_parts(mode="text")
                parts.append({"mime_type": "image/png", "data": buf.getvalue()})
                parts.append(desc_prompt)
                
                # Use _edit_model for image-to-text as it's the image preview model
                response = self.gemini_client._edit_model.generate_content(parts)
                
                if not hasattr(response, "text") or not response.text:
                    raise RuntimeError("AI failed to describe the image.")
                
                desc = response.text.strip()
                
                # 2) Update description in UI immediately
                def update_desc(d=desc):
                    self.character_desc_text.delete("1.0", "end")
                    self.character_desc_text.insert("1.0", d)
                self.root.after(0, update_desc)
                
                # 3) Generate attributes from that description
                self.root.after(0, lambda: self.progress_dialog.update_status("Extracting identity and attributes..."))
                
                attributes = self.gemini_client.generate_attributes_from_description(desc, use_valor_lore=use_valor_lore)
                
                if attributes and isinstance(attributes, dict):
                    self.root.after(100, lambda a=attributes: self.apply_generated_attributes(a))
                    
                    self.root.after(200, lambda: self.status.set("✅ AI extracted rich character data successfully."))
                    self.log_event("Extracted attributes from image using AI")
                else:
                    self.root.after(0, lambda: self.status.set("⚠️ Description extracted, but attribute parsing failed."))
                    
            except Exception as e:
                import traceback
                traceback.print_exc()
                err_msg = str(e)
                self.root.after(0, lambda msg=err_msg: self.status.set(f"Extraction failed: {msg}"))
                self.root.after(0, lambda msg=err_msg: messagebox.showerror("Extraction Error", f"Failed to extract attributes:\n{msg}"))
            finally:
                self.root.after(0, lambda: self.progress_dialog.close() if self.progress_dialog else None)
        
        threading.Thread(target=run_extraction, daemon=True).start()
    
    # --- Lore Library Manager ---
    def create_lore_menu_button(self, parent):
        # Lore UI removed; backend still available for programmatic use.
        # Keep valor_lore_var for backend logic
        self.valor_lore_var = tk.BooleanVar(value=False)
        return None

    def ensure_lore_dir(self):
        if not hasattr(self, "lore_dir"):
            self.lore_dir = Path(app_data_path("LORE_LIBRARY"))
        self.lore_dir.mkdir(exist_ok=True)
        return self.lore_dir

    def update_lore_information(self):
        """Upload new lore/reference files into the Lore Library."""
        if not self.lore_enabled:
            self.status.set("Lore features are disabled.")
            return
        from pathlib import Path
        import shutil
        from tkinter import filedialog
        self.ensure_lore_dir()
        file_paths = filedialog.askopenfilenames(
            title="Select Lore Documents or Images",
            filetypes=[
                ("Supported Files", "*.txt *.md *.pdf *.png *.jpg *.jpeg"),
                ("All Files", "*.*")
            ]
        )
        if not file_paths:
            return
        for fp in file_paths:
            src = Path(fp)
            dest = self.lore_dir / src.name
            try:
                shutil.copy2(src, dest)
            except Exception as e:
                messagebox.showerror("Copy Failed", f"Could not copy {src.name}:\n{e}")
        self.status.set("Lore files uploaded successfully.")
        self.refresh_lore_context()

    def open_lore_folder(self):
        """Open the Lore Library folder in the system file explorer."""
        if not self.lore_enabled:
            self.status.set("Lore features are disabled.")
            return
        import subprocess, sys, os
        self.ensure_lore_dir()
        try:
            if os.name == "nt":
                os.startfile(self.lore_dir)
            elif sys.platform == "darwin":
                subprocess.call(["open", str(self.lore_dir)])
            else:
                subprocess.call(["xdg-open", str(self.lore_dir)])
            self.status.set("Opened Lore Library folder.")
        except Exception as e:
            messagebox.showerror("Open Error", f"Could not open Lore folder:\n{e}")

    def edit_existing_lore(self):
        """Allow user to select and edit a text-based lore file (txt/md)."""
        if not self.lore_enabled:
            self.status.set("Lore features are disabled.")
            return
        self.ensure_lore_dir()
        files = list(self.lore_dir.glob("*.txt")) + list(self.lore_dir.glob("*.md"))
        if not files:
            messagebox.showinfo("No Text Lore", "No editable text files found in the Lore Library.")
            return
        file_choices = [f.name for f in files]
        selected = simpledialog.askstring(
            "Edit Lore Document",
            "Enter the exact file name to edit:\n\n" + "\n".join(file_choices)
        )
        if not selected or selected not in file_choices:
            return
        file_path = self.lore_dir / selected

        # Open a simple editor window
        editor = tk.Toplevel(self.root)
        editor.title(f"Editing Lore Document: {selected}")
        editor.geometry("700x500")

        text_widget = tk.Text(editor, wrap="word")
        text_widget.pack(fill="both", expand=True)

        try:
            text_widget.insert("1.0", file_path.read_text(encoding="utf-8"))
        except Exception as e:
            messagebox.showerror("Load Error", f"Failed to read file:\n{e}")

        def save_and_close():
            try:
                content = text_widget.get("1.0", "end-1c")
                file_path.write_text(content, encoding="utf-8")
                self.status.set(f"Lore file '{selected}' saved.")
                self.refresh_lore_context()
                editor.destroy()
            except Exception as e:
                messagebox.showerror("Save Error", f"Could not save changes:\n{e}")

        ttk.Button(editor, text="Save", command=save_and_close).pack(pady=6)

    def refresh_lore_context(self):
        """Rebuild AI's lore context from all files in the Lore Library."""
        if not self.lore_enabled:
            self.lore_context = ""
            self.lore_images = []
            self.lore_summary_var.set("Lore disabled")
            return
        self.ensure_lore_dir()
        self.lore_context = ""
        self.lore_images = []
        text_files = 0
        image_files = 0
        lore_texts = []

        latest_mod = 0
        for file in self.lore_dir.iterdir():
            try:
                latest_mod = max(latest_mod, int(file.stat().st_mtime))
            except Exception:
                pass
            ext = file.suffix.lower()
            try:
                if ext in [".txt", ".md"]:
                    lore_texts.append(file.read_text(encoding="utf-8"))
                    text_files += 1
                elif ext == ".pdf":
                    try:
                        import PyPDF2
                        with open(file, "rb") as f:
                            reader = PyPDF2.PdfReader(f)
                            text = "\n".join([(p.extract_text() or "") for p in reader.pages])
                            if text.strip():
                                lore_texts.append(text)
                                text_files += 1
                    except Exception as e:
                        self.log_event(f"Failed to parse PDF {file.name}: {e}")
                elif ext in [".png", ".jpg", ".jpeg", ".webp"]:
                    self.lore_images.append(file)
                    image_files += 1
            except Exception as e:
                self.log_event(f"Failed to load lore file {file.name}: {e}")

        if lore_texts:
            self.lore_context = "\n\n".join(lore_texts)

        self.lore_summary_var.set(f"Active Lore Context: {text_files} text files, {image_files} images loaded")
        self.lore_last_modified = latest_mod
        try:
            self.status.set("Lore context refreshed.")
        except Exception:
            pass
        self.log_event(f"Lore context updated: {text_files} text docs, {image_files} images loaded.")

    def monitor_lore_folder(self):
        """Watch Lore Library for file changes and auto-refresh context."""
        if not self.lore_enabled:
            return
        try:
            self.ensure_lore_dir()
            latest_mod = 0
            for f in self.lore_dir.iterdir():
                try:
                    latest_mod = max(latest_mod, int(f.stat().st_mtime))
                except Exception:
                    continue
            if latest_mod and latest_mod != self.lore_last_modified:
                self.lore_last_modified = latest_mod
                self.refresh_lore_context()
        except Exception as e:
            self.log_event(f"Lore watcher error: {e}")
        # Re-schedule
        try:
            self.root.after(10000, self.monitor_lore_folder)
        except Exception:
            pass

    def get_lore_parts(self, mode="text"):
        """
        Return lore input parts for Gemini calls.
        mode: 'text' = strong influence; 'image' = light tonal reference.
        Only applies if Valor lore is enabled.
        """
        if not self.lore_enabled:
            return []
        parts = []
        try:
            if not getattr(self, "valor_lore_var", None) or not self.valor_lore_var.get():
                return parts
        except Exception:
            return parts

        if not hasattr(self, "lore_context"):
            try:
                self.refresh_lore_context()
            except Exception:
                return parts

        weight = 0.5
        try:
            weight = float(self.lore_weight_var.get())
        except Exception:
            pass

        if mode == "text":
            if self.lore_context.strip():
                cutoff = max(1, int(len(self.lore_context) * max(0.0, min(1.0, weight))))
                effective_lore = self.lore_context[:cutoff]
                parts.append({
                    "mime_type": "text/plain",
                    "data": f"FULL LORE CONTEXT:\n{effective_lore}".encode("utf-8")
                })
            for img_path in getattr(self, "lore_images", []):
                try:
                    with open(img_path, "rb") as f:
                        parts.append({"mime_type": "image/png", "data": f.read()})
                except Exception as e:
                    self.log_event(f"Skipped lore image {img_path.name}: {e}")
        elif mode == "image":
            if self.lore_context.strip():
                summary = self.lore_context[:1000]
                parts.append({
                    "mime_type": "text/plain",
                    "data": f"TONAL BACKGROUND (for mood consistency):\n{summary}".encode("utf-8")
                })
        return parts

    # --- Training Data: editor, watcher, context ---
    def open_training_data_editor(self):
        """User-friendly structured AI Bias & Training Data editor with persistent saving."""
        return
        import json
        from datetime import datetime

        editor = tk.Toplevel(self.root)
        editor.geometry("900x720")

        # Always reload from disk to get current saved values
        try:
            with open(self.training_data_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Show last modified time in title
            mod_time = datetime.fromtimestamp(self.training_data_path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            editor.title(f"AI Bias & Training Data Editor (Last saved: {mod_time})")
        except Exception as e:
            messagebox.showwarning("Load Warning", f"Failed to read training data file. Using defaults.\n{e}")
            data = self.default_training_data.copy()
            editor.title("AI Bias & Training Data Editor (New Configuration)")

        notebook = ttk.Notebook(editor)
        notebook.pack(fill="both", expand=True, padx=6, pady=6)

        def make_section(parent, title, desc):
            """Create a section header with title and explanation."""
            frame = ttk.Frame(parent)
            ttk.Label(frame, text=title, font=("Segoe UI", 10, "bold")).pack(anchor="w", pady=(4, 0))
            ttk.Label(frame, text=desc, font=("Segoe UI", 9), foreground="#AAAAAA", wraplength=820).pack(anchor="w", pady=(0, 10))
            return frame

        # --- Core Biases Tab ---
        core_tab = ttk.Frame(notebook)
        notebook.add(core_tab, text="Core Biases")
        
        # Add scrollbar for core tab
        core_canvas = tk.Canvas(core_tab)
        core_scrollbar = ttk.Scrollbar(core_tab, orient="vertical", command=core_canvas.yview)
        core_scrollable = ttk.Frame(core_canvas)
        core_scrollable.bind("<Configure>", lambda e: core_canvas.configure(scrollregion=core_canvas.bbox("all")))
        core_canvas.create_window((0, 0), window=core_scrollable, anchor="nw")
        core_canvas.configure(yscrollcommand=core_scrollbar.set)
        core_canvas.pack(side="left", fill="both", expand=True)
        core_scrollbar.pack(side="right", fill="y")
        
        core_frame = make_section(core_scrollable,
            "Core Biases",
            "Defines the AI's overall artistic personality — visual style, lighting, and background tone. "
            "Changing these affects how all characters are rendered and described.")

        core_vars = {}
        for key, value in data.get("core_biases", {}).items():
            ttk.Label(core_frame, text=f"{key.replace('_',' ').title()}:").pack(anchor="w", pady=(4, 0))
            text_box = tk.Text(core_frame, height=4, wrap="word", width=95, font=("Segoe UI", 9))
            text_box.insert("1.0", value)
            text_box.pack(anchor="w", pady=(0, 8), fill="x")
            core_vars[key] = text_box
        
        # Add prompt structure fields (also taller text boxes)
        ttk.Label(core_frame, text="Prompt Structure", font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(10, 4))
        prompt_vars = {}
        for key, value in data.get("prompt_structure", {}).items():
            ttk.Label(core_frame, text=f"{key.replace('_',' ').title()}:").pack(anchor="w", pady=(4, 0))
            text_box = tk.Text(core_frame, height=3, wrap="word", width=95, font=("Segoe UI", 9))
            text_box.insert("1.0", value)
            text_box.pack(anchor="w", pady=(0, 8), fill="x")
            prompt_vars[key] = text_box
            
        core_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # --- Text Generation Tab ---
        text_tab = ttk.Frame(notebook)
        notebook.add(text_tab, text="Text Generation")
        
        # Add scrollbar for text tab
        text_canvas = tk.Canvas(text_tab)
        text_scrollbar = ttk.Scrollbar(text_tab, orient="vertical", command=text_canvas.yview)
        text_scrollable = ttk.Frame(text_canvas)
        text_scrollable.bind("<Configure>", lambda e: text_canvas.configure(scrollregion=text_canvas.bbox("all")))
        text_canvas.create_window((0, 0), window=text_scrollable, anchor="nw")
        text_canvas.configure(yscrollcommand=text_scrollbar.set)
        text_canvas.pack(side="left", fill="both", expand=True)
        text_scrollbar.pack(side="right", fill="y")
        
        t_frame = make_section(text_scrollable,
            "Text Generation Weights & Style",
            "Controls how the AI writes — its tone, realism, and creativity. "
            "Values range from 0.0 (no influence) to 1.0 (maximum influence).")

        text_numeric_inputs = {}
        numeric_fields = {
            "tone_weight": "How strongly tone affects writing (0 = none, 1 = full influence)",
            "realism_weight": "Higher = realistic and grounded; lower = stylized or abstract",
            "lore_alignment_weight": "How much the AI considers Lore Library context",
            "creativity_weight": "Higher = more imaginative and descriptive; lower = factual"
        }
        
        for key, helptext in numeric_fields.items():
            row = ttk.Frame(t_frame)
            row.pack(fill="x", pady=4, padx=2)
            ttk.Label(row, text=key.replace('_', ' ').title() + ":", width=25, anchor="w").pack(side="left")
            val = tk.StringVar(value=str(data.get("text_generation", {}).get(key, 0.5)))
            ttk.Entry(row, textvariable=val, width=10, justify="center").pack(side="left", padx=(0, 10))
            ttk.Label(row, text=helptext, font=("Segoe UI", 8), foreground="#888888", wraplength=550).pack(side="left", fill="x", expand=True)
            text_numeric_inputs[key] = val

        ttk.Label(t_frame, text="Description Bias:").pack(anchor="w", pady=(8, 0))
        desc_var = tk.StringVar(value=data.get("text_generation", {}).get("description_bias", ""))
        ttk.Entry(t_frame, textvariable=desc_var, width=100).pack(anchor="w", pady=(0, 8), fill="x")

        ttk.Label(t_frame, text="Style Bias:").pack(anchor="w", pady=(4, 0))
        style_var = tk.StringVar(value=data.get("text_generation", {}).get("style_bias", ""))
        ttk.Entry(t_frame, textvariable=style_var, width=100).pack(anchor="w", pady=(0, 8), fill="x")
        t_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # --- Image Generation Tab ---
        image_tab = ttk.Frame(notebook)
        notebook.add(image_tab, text="Image Generation")
        
        # Add scrollbar for image tab
        img_canvas = tk.Canvas(image_tab)
        img_scrollbar = ttk.Scrollbar(image_tab, orient="vertical", command=img_canvas.yview)
        img_scrollable = ttk.Frame(img_canvas)
        img_scrollable.bind("<Configure>", lambda e: img_canvas.configure(scrollregion=img_canvas.bbox("all")))
        img_canvas.create_window((0, 0), window=img_scrollable, anchor="nw")
        img_canvas.configure(yscrollcommand=img_scrollbar.set)
        img_canvas.pack(side="left", fill="both", expand=True)
        img_scrollbar.pack(side="right", fill="y")
        
        i_frame = make_section(img_scrollable,
            "Image Generation Settings",
            "Adjusts camera angles and how the AI renders visuals. "
            "Fine-tune each view's rotation and tilt for precise character positioning.")

        # Camera Angle Adjustments
        ttk.Label(i_frame, text="Camera Angle Adjustments", font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(4, 2))
        ttk.Label(i_frame, text="Adjust how much each view turns or tilts the character. "
                               "Yaw = left/right rotation (degrees), Pitch = up/down tilt (degrees).", 
                   font=("Segoe UI", 8), foreground="#888888", wraplength=750).pack(anchor="w", pady=(0, 8))

        yaw_vars, pitch_vars = {}, {}
        camera_angle_defaults = {
            "three_quarter": {"yaw": 30.0, "pitch": 0.0},
            "front": {"yaw": 0.0, "pitch": 0.0},
            "side": {"yaw": 90.0, "pitch": 0.0},
            "back": {"yaw": 180.0, "pitch": 0.0}
        }
        
        for view in ["three_quarter", "front", "side", "back"]:
            view_frame = ttk.Frame(i_frame)
            view_frame.pack(fill="x", pady=4)
            
            ttk.Label(view_frame, text=f"{view.replace('_', ' ').title()} View:", width=18, anchor="w", font=("Segoe UI", 9, "bold")).pack(side="left")
            
            # Yaw control
            ttk.Label(view_frame, text="Yaw (°):", width=10).pack(side="left", padx=(10, 0))
            defaults = camera_angle_defaults[view]
            yaw = tk.DoubleVar(value=data.get("image_generation", {}).get("camera_angles", {}).get(view, {}).get("yaw", defaults["yaw"]))
            ttk.Entry(view_frame, textvariable=yaw, width=8, justify="center").pack(side="left", padx=(0, 15))
            
            # Pitch control
            ttk.Label(view_frame, text="Pitch (°):", width=10).pack(side="left")
            pitch = tk.DoubleVar(value=data.get("image_generation", {}).get("camera_angles", {}).get(view, {}).get("pitch", defaults["pitch"]))
            ttk.Entry(view_frame, textvariable=pitch, width=8, justify="center").pack(side="left")
            
            yaw_vars[view] = yaw
            pitch_vars[view] = pitch
        
        # Simplified lighting and materials
        ttk.Label(i_frame, text="Lighting & Materials", font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(16, 4))
        ttk.Label(i_frame, text="Simplified controls for overall visual quality and style.",
                   font=("Segoe UI", 8), foreground="#888888").pack(anchor="w", pady=(0, 6))
        
        lighting_var = tk.StringVar(value=data.get("image_generation", {}).get("lighting_choice", "Studio Three-Point"))
        ttk.Label(i_frame, text="Lighting Preset:").pack(anchor="w", pady=(4, 0))
        lighting_combo = ttk.Combobox(i_frame, textvariable=lighting_var, 
                                      values=["Studio Three-Point", "Natural Soft", "Dramatic Rim"], 
                                      width=30, state="readonly")
        lighting_combo.pack(anchor="w", pady=(0, 8))
        
        materials_var = tk.StringVar(value=data.get("image_generation", {}).get("materials_quality", "High"))
        ttk.Label(i_frame, text="Material Quality:").pack(anchor="w", pady=(4, 0))
        materials_combo = ttk.Combobox(i_frame, textvariable=materials_var,
                                       values=["Low", "Medium", "High", "Ultra"],
                                       width=30, state="readonly")
        materials_combo.pack(anchor="w", pady=(0, 8))
                
        i_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # --- Lore Alignment Tab ---
        lore_tab = ttk.Frame(notebook)
        notebook.add(lore_tab, text="Lore Alignment")
        
        l_frame = make_section(lore_tab,
            "Lore Integration Settings",
            "Toggles how much the AI incorporates your Lore Library documents and imagery. "
            "When enabled, it helps the AI stay consistent with your world's history, tone, and rules.")

        lore_enabled = tk.BooleanVar(value=data.get("lore_alignment", {}).get("enabled", True))
        ttk.Checkbutton(l_frame, text="Enable Lore Alignment", variable=lore_enabled).pack(anchor="w", pady=(2, 8))

        ttk.Label(l_frame, text="Lore Source:").pack(anchor="w", pady=(4, 0))
        lore_source_var = tk.StringVar(value=data.get("lore_alignment", {}).get("lore_source", "LORE_LIBRARY/"))
        ttk.Entry(l_frame, textvariable=lore_source_var, width=100).pack(anchor="w", pady=(0, 8), fill="x")

        ttk.Label(l_frame, text="Lore Description:").pack(anchor="w", pady=(4, 0))
        lore_desc_var = tk.StringVar(value=data.get("lore_alignment", {}).get("lore_description", ""))
        ttk.Entry(l_frame, textvariable=lore_desc_var, width=100).pack(anchor="w", pady=(0, 8), fill="x")
        l_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # --- Raw Text Tab ---
        raw_tab = ttk.Frame(notebook)
        notebook.add(raw_tab, text="Raw Text")
        
        ttk.Label(raw_tab, text="Raw JSON Editor", font=("Segoe UI", 10, "bold")).pack(anchor="w", padx=10, pady=(10, 0))
        ttk.Label(raw_tab, text="Below is the full JSON configuration. You can edit directly if you prefer.\n"
                               "Each section controls a part of the AI's behavior: Core Biases (style, lighting), "
                               "Text Generation (tone, realism, lore use), Image Generation (render behavior), and Lore Alignment (use of lore files).",
                   font=("Segoe UI", 9), foreground="#AAAAAA", wraplength=820).pack(anchor="w", padx=10, pady=(0, 10))
        
        raw_frame = ttk.Frame(raw_tab)
        raw_frame.pack(fill="both", expand=True, padx=10, pady=10)
        
        raw_text = tk.Text(raw_frame, wrap="none", font=("Consolas", 9))
        raw_scrollbar_y = ttk.Scrollbar(raw_frame, orient="vertical", command=raw_text.yview)
        raw_scrollbar_x = ttk.Scrollbar(raw_frame, orient="horizontal", command=raw_text.xview)
        raw_text.configure(yscrollcommand=raw_scrollbar_y.set, xscrollcommand=raw_scrollbar_x.set)
        
        raw_text.grid(row=0, column=0, sticky="nsew")
        raw_scrollbar_y.grid(row=0, column=1, sticky="ns")
        raw_scrollbar_x.grid(row=1, column=0, sticky="ew")
        
        raw_frame.grid_rowconfigure(0, weight=1)
        raw_frame.grid_columnconfigure(0, weight=1)
        
        raw_text.insert("1.0", json.dumps(data, indent=2))

        # --- Button bar ---
        button_frame = ttk.Frame(editor)
        button_frame.pack(fill="x", pady=6)

        def save_changes():
            try:
                # Only use raw JSON if user is currently on the Raw Text tab
                current_tab = notebook.tab(notebook.select(), "text")
                use_raw = (current_tab == "Raw Text")
                
                if use_raw:
                    # User is on Raw Text tab, use that
                    print("DEBUG: Using raw JSON from text editor (user is on Raw Text tab)")
                    try:
                        updated = json.loads(raw_text.get("1.0", "end-1c"))
                    except Exception as raw_err:
                        messagebox.showerror("JSON Error", f"Invalid JSON in Raw Text tab:\n{raw_err}")
                        return
                else:
                    # Build dictionary manually from all variables on UI tabs
                    print("DEBUG: Building from UI fields")
                    print(f"DEBUG: core_vars keys: {list(core_vars.keys())}")
                    print(f"DEBUG: text_numeric_inputs keys: {list(text_numeric_inputs.keys())}")
                    
                    updated = {
                        "core_biases": {k: v.get("1.0", "end-1c").strip() for k, v in core_vars.items()},
                        "prompt_structure": {k: v.get("1.0", "end-1c").strip() for k, v in prompt_vars.items()},
                        "text_generation": {
                            "tone_weight": float(text_numeric_inputs["tone_weight"].get()),
                            "realism_weight": float(text_numeric_inputs["realism_weight"].get()),
                            "lore_alignment_weight": float(text_numeric_inputs["lore_alignment_weight"].get()),
                            "creativity_weight": float(text_numeric_inputs["creativity_weight"].get()),
                            "description_bias": desc_var.get(),
                            "style_bias": style_var.get()
                        },
                        "image_generation": {
                            "lighting_choice": lighting_var.get(),
                            "materials_quality": materials_var.get(),
                            "camera_angles": {
                                "three_quarter": {
                                    "yaw": float(yaw_vars["three_quarter"].get()),
                                    "pitch": float(pitch_vars["three_quarter"].get())
                                },
                                "front": {
                                    "yaw": float(yaw_vars["front"].get()),
                                    "pitch": float(pitch_vars["front"].get())
                                },
                                "side": {
                                    "yaw": float(yaw_vars["side"].get()),
                                    "pitch": float(pitch_vars["side"].get())
                                },
                                "back": {
                                    "yaw": float(yaw_vars["back"].get()),
                                    "pitch": float(pitch_vars["back"].get())
                                }
                            }
                        },
                        "lore_alignment": {
                            "enabled": lore_enabled.get(),
                            "lore_source": lore_source_var.get(),
                            "lore_description": lore_desc_var.get()
                        }
                    }
                
                print(f"DEBUG: Saving to {self.training_data_path}")
                print(f"DEBUG: Data preview: {json.dumps(updated, indent=2)[:500]}")
                
                # Save to disk with explicit file operations
                with open(self.training_data_path, "w", encoding="utf-8") as f:
                    json.dump(updated, f, indent=2)
                
                print(f"DEBUG: File written, size: {self.training_data_path.stat().st_size} bytes")
                
                # Verify the file was written
                with open(self.training_data_path, "r", encoding="utf-8") as f:
                    verify = json.load(f)
                    print(f"DEBUG: Verification read successful, keys: {list(verify.keys())}")
                
                # Reload training context from the saved file
                self.update_training_context()
                self.log_event("Training data updated and reloaded from disk.")
                self.status.set("Training data saved and reloaded successfully.")
                
                messagebox.showinfo("Saved", f"Training data saved successfully to:\n{self.training_data_path}")
                editor.destroy()  # Close editor immediately after successful save
                
            except Exception as e:
                import traceback
                error_details = traceback.format_exc()
                print(f"DEBUG: Save error:\n{error_details}")
                messagebox.showerror("Save Error", f"Failed to save training data:\n{e}\n\nSee console for details.")

        def restore_defaults():
            if messagebox.askyesno("Restore Defaults", "Restore all settings to defaults? This will close the editor."):
                self.training_data_path.write_text(json.dumps(self.default_training_data, indent=2), encoding="utf-8")
                self.update_training_context()
                self.status.set("Restored default training data.")
                editor.destroy()
                messagebox.showinfo("Restored", "Default settings restored. Reopen the editor to see changes.")

        ttk.Button(button_frame, text="💾 Save", command=save_changes).pack(side="left", padx=5)
        ttk.Button(button_frame, text="📋 Copy JSON", command=lambda: (self.root.clipboard_clear(), self.root.clipboard_append(self.training_data_path.read_text()), messagebox.showinfo("Copied", "JSON copied to clipboard."))).pack(side="left", padx=5)
        ttk.Button(button_frame, text="♻️ Restore Defaults", command=restore_defaults).pack(side="left", padx=5)
        ttk.Button(button_frame, text="Close", command=editor.destroy).pack(side="right", padx=5)

    def monitor_training_config(self):
        return
        try:
            current_mod = self.training_data_path.stat().st_mtime if self.training_data_path.exists() else 0
            if getattr(self, "_last_training_mod", 0) != current_mod:
                self._last_training_mod = current_mod
                self.update_training_context()
                self.status.set("Training data reloaded automatically.")
        except Exception as e:
            self.log_event(f"Training config watcher error: {e}")
        self.root.after(10000, self.monitor_training_config)

    def update_training_context(self):
        """Load training data from disk and form a compact context prefix for prompts."""
        return
        import json
        try:
            # Always reload from disk to get latest saved values
            with open(self.training_data_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Store full config for reference
            self.training_config = data
        except Exception as e:
            print(f"Failed to load training data, using defaults: {e}")
            data = self.default_training_data
            self.training_config = data

        biases = data.get("core_biases", {})
        prompt_struct = data.get("prompt_structure", {})
        text_weights = data.get("text_generation", {})

        self.training_context_text = (
            f"VISUAL STYLE: {biases.get('visual_style', '')}\n"
            f"LIGHTING: {biases.get('lighting', '')}\n"
            f"BACKGROUND: {biases.get('background', '')}\n\n"
            f"PERSONA: {prompt_struct.get('persona_bias', '')}\n"
            f"TONE: {prompt_struct.get('tone', '')}\n"
            f"CAMERA RULES: {prompt_struct.get('camera_rules', '')}\n\n"
            f"TEXT STYLE: {text_weights.get('description_bias', '')}\n"
            f"TEXT TONE: {text_weights.get('style_bias', '')}\n"
            f"REALISM WEIGHT: {text_weights.get('realism_weight', '')}\n"
            f"CREATIVITY WEIGHT: {text_weights.get('creativity_weight', '')}\n"
        ).strip()
    def restore_attributes_from_image(self):
        """Fully restore identity, attributes, description, and notes from an image's metadata."""
        import os
        
        # Figure out which image we're restoring from
        current_image_path = None
        if hasattr(self, "image_history") and self.image_history and 0 <= self.history_index < len(self.image_history):
            current_image_path = self.image_history[self.history_index]
        elif hasattr(self, "last_loaded_image_path"):
            current_image_path = self.last_loaded_image_path

        if not current_image_path or not os.path.exists(str(current_image_path)):
            messagebox.showinfo("No Image", "No valid image found to restore attributes from.")
            return

        metadata_path = Path(current_image_path).with_suffix(".json")
        if not metadata_path.exists():
            messagebox.showinfo("No Metadata", "No metadata file found for this image.")
            return

        try:
            # Use the unified metadata loading system
            self.load_metadata_for_image(current_image_path)
            
            # Update edit history display
            self.update_edit_history_display(current_image_path)
            
            self.status.set(f"Restored all attributes from {metadata_path.name}")
            self.log_event(f"Restored attributes from {metadata_path.name}")

            # Treat this as a generation — add to history if not already there
            if current_image_path not in self.image_history:
                self.image_history.append(current_image_path)
                self.history_index = len(self.image_history) - 1
                self.log_event(f"Added restored image to session history: {Path(current_image_path).name}")

        except Exception as e:
            import traceback
            traceback.print_exc()
            messagebox.showerror("Restore Failed", f"Failed to restore attributes:\n{e}")

    def load_image_from_history(self, image_path):
        """Load a specified image from session history into Main Stage."""
        try:
            image = Image.open(image_path)
            
            # Convert if needed (keep original format)
            if image.mode == "RGBA":
                # Keep RGBA if it has transparency
                pass
            elif image.mode != "RGB":
                image = image.convert("RGB")

            self.view_images["stage"] = image
            self.current_image = image
            self.current_view = "stage"
            self.view_notebook.select(self.view_frames["stage"])
            self.display_image(image, "stage")
        except Exception as e:
            messagebox.showerror("Load Error", f"Failed to load image:\n{e}")
    
    def save_prompt_history(self, char_folder: Path, char_name: str, view_name: str):
        """Save detailed prompt history for a specific character view."""
        try:
            prompt_file = char_folder / f"{char_name}_{view_name}_prompt_history.txt"
            
            with open(prompt_file, "w", encoding="utf-8") as f:
                f.write("=" * 80 + "\n")
                f.write(f"CHARACTER PROMPT HISTORY — {char_name} ({view_name.upper()})\n")
                f.write("=" * 80 + "\n")
                f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                
                # Character description
                f.write("CHARACTER DESCRIPTION:\n")
                f.write("-" * 80 + "\n")
                desc = self.get_character_description()
                f.write(desc if desc else "(No description provided)\n")
                f.write("\n\n")
                
                # Character attributes
                f.write("CHARACTER ATTRIBUTES:\n")
                f.write("-" * 80 + "\n")
                f.write(f"Age: {self.age_var.get()}\n")
                f.write(f"Race: {self.race_var.get()}\n")
                f.write(f"Gender: {self.gender_var.get()}\n")
                f.write(f"Build: {self.build_var.get()}\n\n")
                
                for field_name, field_obj in self.fields.items():
                    value = field_obj.get_value()
                    if value:
                        f.write(f"{field_name}: {value}\n")
                f.write("\n")
                
                # Edit history
                if self.edit_history:
                    f.write("EDIT HISTORY:\n")
                    f.write("-" * 80 + "\n")
                    for timestamp, prompt in self.edit_history:
                        f.write(f"[{timestamp}] {prompt}\n\n")
                    f.write("\n")
                
                # Session log
                if self.session_log:
                    f.write("SESSION LOG:\n")
                    f.write("-" * 80 + "\n")
                    for entry in self.session_log:
                        f.write(f"{entry}\n")
                    f.write("\n")
                
                # Character creation timeline
                if self.character_history:
                    f.write("CREATION TIMELINE:\n")
                    f.write("-" * 80 + "\n")
                    for entry in self.character_history:
                        f.write(f"{entry}\n")
                
                f.write("\n" + "=" * 80 + "\n")
            
            return prompt_file
        except Exception as e:
            print(f"Failed to save prompt history: {e}")
            return None

    def setup_ui(self):
        """Setup the user interface."""
        # Main layout: left = controls; middle = edit panel; right = image viewer
        main = ttk.Frame(self.root, padding=8)
        main.pack(fill="both", expand=True)

        left = ttk.Frame(main, width=800)
        middle = ttk.Frame(main, width=400)
        right = ttk.Frame(main)
        
        left.pack(side="left", fill="both", expand=False, padx=(0, 8))
        left.pack_propagate(False)  # Maintain fixed width
        
        middle.pack(side="left", fill="both", expand=False, padx=(0, 8))
        middle.pack_propagate(False)  # Maintain fixed width
        
        right.pack(side="right", fill="both", expand=True)

        # --- LEFT: Controls ---
        # Identity section
        ident = ttk.LabelFrame(left, text="Character Identity")
        ident.pack(fill="x", expand=False, pady=(0, 8))

        # StringVars for identity
        self.age_var = tk.StringVar(value="")
        self.race_var = tk.StringVar(value="")
        self.gender_var = tk.StringVar(value="")
        self.build_var = tk.StringVar(value="")

        # Layout identity controls
        ttk.Label(ident, text="Age").grid(row=0, column=0, sticky="w", padx=(6,4), pady=2)
        ttk.Combobox(ident, textvariable=self.age_var, values=AGE_OPTIONS, width=50).grid(row=0, column=1, sticky="we", padx=4, pady=2)

        ttk.Label(ident, text="Race").grid(row=1, column=0, sticky="w", padx=(6,4), pady=2)
        ttk.Combobox(ident, textvariable=self.race_var, values=RACE_OPTIONS, width=50).grid(row=1, column=1, sticky="we", padx=4, pady=2)

        ttk.Label(ident, text="Gender").grid(row=2, column=0, sticky="w", padx=(6,4), pady=2)
        ttk.Combobox(ident, textvariable=self.gender_var, values=GENDER_OPTIONS, width=50).grid(row=2, column=1, sticky="we", padx=4, pady=2)

        ttk.Label(ident, text="Build").grid(row=3, column=0, sticky="w", padx=(6,4), pady=2)
        ttk.Combobox(ident, textvariable=self.build_var, values=BUILD_OPTIONS, width=50).grid(row=3, column=1, sticky="we", padx=4, pady=2)

        # Character Description text area
        ttk.Label(ident, text="Character Description").grid(row=4, column=0, sticky="nw", padx=(6,4), pady=(8, 2))
        
        desc_frame = ttk.Frame(ident)
        desc_frame.grid(row=4, column=1, sticky="ew", padx=4, pady=(8, 2))
        
        from dark_theme import configure_text_widget
        self.character_desc_text = tk.Text(desc_frame, height=4, wrap="word", font=("Segoe UI", 9))
        configure_text_widget(self.character_desc_text)
        desc_scrollbar = ttk.Scrollbar(desc_frame, orient="vertical", command=self.character_desc_text.yview)
        self.character_desc_text.configure(yscrollcommand=desc_scrollbar.set)
        
        self.character_desc_text.pack(side="left", fill="both", expand=True)
        desc_scrollbar.pack(side="right", fill="y")
        
        # Description action buttons - separate frame below description in ident
        desc_buttons = tk.Frame(ident)
        desc_buttons.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(10, 5))
        
        # Configure grid weights for proper spacing
        desc_buttons.grid_columnconfigure(0, weight=1)
        desc_buttons.grid_columnconfigure(1, weight=1)
        
        # Row 0 - Extract Attributes (Primary Action)
        self.extract_btn = ttk.Button(
            desc_buttons, 
            text="🧠 Extract Attributes", 
            command=self.extract_attributes_from_image
        )
        self.extract_btn.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 10), ipady=5)
        ToolTip(self.extract_btn, "Analyze the current image and auto-fill identity, attributes, and description.")

        # Row 1
        btn1 = ttk.Button(desc_buttons, text="Enhance Description", command=self.enhance_description)
        btn1.grid(row=1, column=0, sticky="ew", padx=(0, 5), pady=(0, 5))
        ToolTip(btn1, "Rewrite the current description with richer details.")
        
        btn2 = ttk.Button(desc_buttons, text="Randomize Full Character", command=self.randomize_description)
        btn2.grid(row=1, column=1, sticky="ew", padx=(5, 0), pady=(0, 5))
        ToolTip(btn2, "Generate a completely random character description and attributes.")
        
        # Row 2  
        btn3 = ttk.Button(desc_buttons, text="OPEN IMAGE", command=self.open_image)
        btn3.grid(row=2, column=0, sticky="ew", padx=(0, 5), pady=(0, 5))
        ToolTip(btn3, "Load an existing image file for editing or generating other views.")
        
        btn4 = ttk.Button(desc_buttons, text="Reset Character", command=self.reset_character)
        btn4.grid(row=2, column=1, sticky="ew", padx=(5, 0), pady=(0, 5))
        ToolTip(btn4, "Clear all fields and reset the character form.")
        
        # Row 3 - Generate Character Image button (full width, double height)
        self.generate_btn = ttk.Button(desc_buttons, text="Generate Character Image", command=self.generate_character)
        self.generate_btn.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(10, 0), ipady=15)
        ToolTip(self.generate_btn, "Generate a new character image using the current description and attributes.")

        ident.grid_columnconfigure(1, weight=1)

        # Character Attributes section immediately after Generate Character
        attr_frame = ttk.LabelFrame(left, text="Character Attributes")
        attr_frame.pack(fill="both", expand=True, pady=(0, 8))

        # Create scrollable frame
        from dark_theme import DarkTheme, configure_canvas_widget
        canvas = tk.Canvas(attr_frame, height=400)
        configure_canvas_widget(canvas)
        scrollbar = ttk.Scrollbar(attr_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
        scrollbar.pack(side="right", fill="y", pady=6)

        # Add field rows to scrollable frame
        current_row = 0
        for fname, data in FIELDS.items():
            fr = FieldRow(scrollable_frame, fname, data["common"], data["rare"], current_row)
            self.fields[fname] = fr
            
            # Set default values for specific fields
            if fname == "Pose":
                fr.var.set("Pose — relaxed A‑stance, hands at sides")
            
            current_row += 1

        # Control buttons
        controls = ttk.Frame(left)
        controls.pack(fill="x", pady=6)
        
        # Multi-View Generation section
        multiview_frame = ttk.LabelFrame(controls, text="Multi-View Generation")
        multiview_frame.pack(fill="x", pady=2)
        
        self.generate_all_btn = ttk.Button(multiview_frame, text="Generate All Views", command=self.generate_all_views, state="disabled")
        self.generate_all_btn.pack(fill="x", pady=2)
        ToolTip(self.generate_all_btn, "Generate all views (3/4, front, back, side) using Main Stage as reference.")
        
        self.generate_selected_btn = ttk.Button(multiview_frame, text="Generate Selected View", command=self.generate_selected_view, state="disabled")
        self.generate_selected_btn.pack(fill="x", pady=2)
        ToolTip(self.generate_selected_btn, "Generate only the currently selected view tab.")
        
        # Save buttons (2-row grid layout)
        save_frame = ttk.LabelFrame(controls, text="Save Options")
        save_frame.pack(fill="x", pady=2)
        
        # Row 0
        save_current_btn = ttk.Button(save_frame, text="Save Current", command=self.save_current_image)
        save_current_btn.grid(row=0, column=0, sticky="ew", padx=2, pady=2)
        ToolTip(save_current_btn, "Save the currently displayed image to a file.")
        
        photoshop_btn = ttk.Button(save_frame, text="Send to PS", command=self.send_to_photoshop)
        photoshop_btn.grid(row=0, column=1, sticky="ew", padx=2, pady=2)
        ToolTip(photoshop_btn, "Send the current image directly to Photoshop for editing.")
        
        self.send_all_btn = ttk.Button(save_frame, text="Send ALL to PS", command=self.send_all_to_photoshop, state="disabled")
        self.send_all_btn.grid(row=0, column=2, sticky="ew", padx=2, pady=2)
        ToolTip(self.send_all_btn, "Send Main, Front, Back, and Side views to Photoshop.")
        
        # Row 1
        xml_btn = ttk.Button(save_frame, text="Show XML", command=self.show_xml)
        xml_btn.grid(row=1, column=0, sticky="ew", padx=2, pady=2)
        ToolTip(xml_btn, "Display the current character configuration as XML text.")
        
        cache_btn = ttk.Button(save_frame, text="Clear AI Cache", command=self.clear_ai_cache)
        cache_btn.grid(row=1, column=1, sticky="ew", padx=2, pady=2)
        ToolTip(cache_btn, "Clear AI memory to prevent repetitive character generation patterns.")
        
        save_log_btn = ttk.Button(save_frame, text="Save Session Log", command=self.save_session_log)
        save_log_btn.grid(row=1, column=2, sticky="ew", padx=2, pady=2)
        ToolTip(save_log_btn, "Export all session activity and prompts to a text file.")

        open_gen_btn = ttk.Button(save_frame, text="Open Generated Images", command=self.open_generated_images_folder)
        open_gen_btn.grid(row=2, column=0, columnspan=3, sticky="ew", padx=2, pady=2)
        ToolTip(open_gen_btn, "Open the folder with all generated image dates.")
        
        # Configure grid columns to expand equally
        save_frame.grid_columnconfigure(0, weight=1)
        save_frame.grid_columnconfigure(1, weight=1)
        save_frame.grid_columnconfigure(2, weight=1)

        # --- MIDDLE: Edit Character Panel ---
        # Add top padding to align text box with Character Description text box
        edit_panel = ttk.LabelFrame(middle, text="Edit Character")
        edit_panel.pack(fill="both", expand=True, pady=(170, 0))  # Top padding to align text input with character description
        
        # Edit prompt input
        prompt_label = ttk.Label(edit_panel, text="Describe changes to apply:")
        prompt_label.pack(anchor="w", padx=8, pady=(8, 2))
        
        from dark_theme import configure_text_widget
        
        # Text input frame with scrollbar
        edit_text_frame = ttk.Frame(edit_panel)
        edit_text_frame.pack(fill="both", expand=False, padx=8, pady=(0, 8))
        
        self.edit_prompt_text = tk.Text(edit_text_frame, height=14, wrap="word", font=("Segoe UI", 9))
        configure_text_widget(self.edit_prompt_text)
        
        edit_scrollbar = ttk.Scrollbar(edit_text_frame, orient="vertical", command=self.edit_prompt_text.yview)
        self.edit_prompt_text.configure(yscrollcommand=edit_scrollbar.set)
        
        self.edit_prompt_text.pack(side="left", fill="both", expand=True)
        edit_scrollbar.pack(side="right", fill="y")
        
        # Enter = generate selected view, Shift+Enter = newline
        def _on_edit_prompt_return(event):
            if event.state & 0x0001:  # Shift held
                return  # allow default newline
            self.apply_edit_from_panel()
            return "break"
        self.edit_prompt_text.bind("<Return>", _on_edit_prompt_return)
        
        # Apply Edit button
        apply_edit_btn = ttk.Button(edit_panel, text="Apply Changes", command=self.apply_edit_from_panel)
        apply_edit_btn.pack(fill="x", padx=8, pady=(0, 8))
        ToolTip(apply_edit_btn, "Apply changes to active view (Ref tabs default to Main Stage).")
        
        # Edit History section — list sits directly beneath label
        history_label = ttk.Label(edit_panel, text="Edit History (most recent first):")
        history_label.pack(anchor="w", padx=8, pady=(4, 2))

        # Create container frame to hold canvas and scrollbar side by side
        edit_history_container = ttk.Frame(edit_panel)
        edit_history_container.pack(fill="x", expand=False, padx=8, pady=(0, 4))

        # Create scrollable area for edit history
        self.edit_history_canvas = tk.Canvas(edit_history_container, height=180, highlightthickness=0, bg="#4F4F4F")
        self.edit_history_scrollbar = ttk.Scrollbar(edit_history_container, orient="vertical", command=self.edit_history_canvas.yview)
        self.edit_history_frame = ttk.Frame(self.edit_history_canvas)

        # Pack scrollbar first (right side), then canvas fills remaining space
        self.edit_history_scrollbar.pack(side="right", fill="y")
        self.edit_history_canvas.pack(side="left", fill="both", expand=True)

        # Create window for the frame inside canvas
        self._edit_history_window_id = self.edit_history_canvas.create_window((0, 0), window=self.edit_history_frame, anchor="nw")
        self.edit_history_canvas.configure(yscrollcommand=self.edit_history_scrollbar.set)

        # Keep scrollregion and frame width in sync with content/canvas
        def _eh_update_scrollregion(event=None):
            if self.edit_history_canvas and self.edit_history_canvas.winfo_exists():
                # Update frame width to match canvas width
                canvas_width = self.edit_history_canvas.winfo_width()
                if canvas_width > 1:
                    self.edit_history_canvas.itemconfig(self._edit_history_window_id, width=canvas_width)
                self.edit_history_canvas.configure(scrollregion=self.edit_history_canvas.bbox("all"))

        self.edit_history_frame.bind("<Configure>", _eh_update_scrollregion)
        self.edit_history_canvas.bind("<Configure>", _eh_update_scrollregion)

        # --- RIGHT: Image Viewer ---
        viewer_frame = ttk.LabelFrame(right, text="Character Concept")
        viewer_frame.pack(fill="both", expand=True)
        
        # Toolbar frame above viewer
        history_frame = ttk.Frame(viewer_frame)
        history_frame.pack(fill="x", pady=(2, 4))
        
        # Quick Generate button on the right side
        quick_gen_btn = ttk.Button(
            history_frame,
            text="⚡ Quick Generate",
            width=16,
            command=self.quick_generate_character
        )
        quick_gen_btn.pack(side="right", padx=(5, 2))
        ToolTip(quick_gen_btn, "Instantly randomize and generate a new AI character image.")
        
        self.quick_gen_btn = quick_gen_btn

        # Bottom-right utility buttons container
        bottom_right_frame = ttk.Frame(history_frame)
        bottom_right_frame.pack(side="right", anchor="se", pady=(0, 0))

        # Lore Library manager dropdown
        self.create_lore_menu_button(bottom_right_frame)

        # View selection tabs
        self.view_notebook = ttk.Notebook(viewer_frame)
        self.view_notebook.pack(fill="both", expand=True, padx=5, pady=5)
        
        # Create tabs for each view (Main Stage first, then other views, then reference tabs)
        self.view_frames = {}
        
        for view_name, display_name in [("stage", "Main Stage (3/4)"), ("front", "Front"), ("back", "Back"), ("side", "Side"), ("ref_a", "Ref A"), ("ref_b", "Ref B"), ("ref_c", "Ref C")]:
            frame = ttk.Frame(self.view_notebook)
            self.view_notebook.add(frame, text=display_name)
            self.view_frames[view_name] = frame
            
            if view_name == "stage":
                # Dedicated canvas with zoom/pan/context menu controls for Main Stage
                container = ttk.Frame(frame)
                container.pack(fill="both", expand=True, padx=10, pady=(10, 5))
                
                self.stage_canvas = tk.Canvas(container, bg="#222222", highlightthickness=0)
                self.stage_canvas.pack(side="top", fill="both", expand=True)
                self.stage_canvas.bind("<Configure>", lambda e: self._stage_update_display(force_update=False))
                self.stage_canvas.bind("<Double-Button-1>", lambda e, view=view_name: self.open_fullscreen_viewer(view))
                self.stage_canvas.bind("<ButtonPress-1>", self._stage_on_press)
                self.stage_canvas.bind("<B1-Motion>", self._stage_on_drag)
                self.stage_canvas.bind("<ButtonRelease-1>", self._stage_on_release)
                self.stage_canvas.bind("<ButtonPress-2>", self._stage_on_press)
                self.stage_canvas.bind("<B2-Motion>", self._stage_on_drag)
                self.stage_canvas.bind("<ButtonRelease-2>", self._stage_on_release)
                self.stage_canvas.bind("<MouseWheel>", self._stage_on_scroll)
                self.stage_canvas.bind("<Button-4>", lambda e: self._stage_zoom(1.1))
                self.stage_canvas.bind("<Button-5>", lambda e: self._stage_zoom(0.9))
                self.stage_canvas.bind("<Button-3>", self._stage_show_context_menu)
                self.stage_canvas.bind("<Control-v>", lambda e: self._on_canvas_paste(e, "stage"))
                self.stage_canvas.bind_all("<Escape>", lambda e: self._stage_reset_view())
                
                self.stage_context_menu = Menu(self.stage_canvas, tearoff=0)
                self.stage_context_menu.add_command(label="💾 Save Image", command=self._stage_save_image)
                self.stage_context_menu.add_command(label="📋 Copy Image", command=self._stage_copy_image)
                self.stage_context_menu.add_command(label="📥 Paste Image", command=self._stage_paste_image)
                self.stage_context_menu.add_command(label="📂 Open Image...", command=lambda: self.open_image_file_for_view("stage"))
                self.stage_context_menu.add_separator()
                self.stage_context_menu.add_command(label="🔍 Reset View", command=self._stage_reset_view)
                
                self._stage_clear_display("No main stage image loaded")
            else:
                # Image display for secondary views (canvas with future zoom/pan support)
                canvas = tk.Canvas(
                    frame,
                    highlightthickness=0,
                    borderwidth=0
                )
                configure_canvas_widget(canvas)
                canvas.pack(fill="both", expand=True, padx=10, pady=10)
                self.view_canvases[view_name] = canvas
                canvas.bind("<Configure>", lambda e, view=view_name: self._view_update_display(view, force_update=False))
                canvas.bind("<Double-Button-1>", lambda e, view=view_name: self.open_fullscreen_viewer(view))
                canvas.bind("<Control-v>", lambda e, view=view_name: self._on_canvas_paste(e, view))
                canvas.bind("<MouseWheel>", lambda e, v=view_name: self._view_on_scroll(v, e))
                canvas.bind("<ButtonPress-1>", lambda e, v=view_name: self._view_on_press(v, e))
                canvas.bind("<B1-Motion>", lambda e, v=view_name: self._view_on_drag(v, e))
                canvas.bind("<ButtonRelease-1>", lambda e, v=view_name: self._view_on_release(v, e))
                canvas.bind("<ButtonPress-2>", lambda e, v=view_name: self._view_on_press(v, e))
                canvas.bind("<B2-Motion>", lambda e, v=view_name: self._view_on_drag(v, e))
                canvas.bind("<ButtonRelease-2>", lambda e, v=view_name: self._view_on_release(v, e))
                canvas.bind("<Button-4>", lambda e, v=view_name: self._view_zoom_factor(v, 1.1))
                canvas.bind("<Button-5>", lambda e, v=view_name: self._view_zoom_factor(v, 0.9))
                
                view_menu = Menu(canvas, tearoff=0)
                view_menu.add_command(label="💾 Save Image", command=lambda v=view_name: self._view_save_image(v))
                view_menu.add_command(label="📋 Copy Image", command=lambda v=view_name: self._view_copy_image(v))
                view_menu.add_command(label="📥 Paste Image", command=lambda v=view_name: self.paste_image_from_clipboard(v))
                view_menu.add_command(label="📂 Open Image...", command=lambda v=view_name: self.open_image_file_for_view(v))
                view_menu.add_separator()
                view_menu.add_command(label="🔍 Reset View", command=lambda v=view_name: self._view_reset_view(v))
                # Add "Clear Image Ref" only for Ref A, Ref B, and Ref C tabs
                if view_name in ("ref_a", "ref_b", "ref_c"):
                    view_menu.add_separator()
                    view_menu.add_command(label="🗑️ Clear Image Ref", command=lambda v=view_name: self.clear_reference_image(v))
                self.view_context_menu[view_name] = view_menu
                canvas.bind("<Button-3>", lambda e, view=view_name: self._view_show_context_menu(view, e))
                self._view_reset_state(view_name)
                self._view_update_display(view_name)
            
        for view_name in ["front", "back", "side", "ref_a", "ref_b", "ref_c"]:
            self.view_images[view_name] = None
            self._view_reset_state(view_name)
            self.view_tk_image[view_name] = None
            if view_name not in self.view_context_menu:
                self.view_context_menu[view_name] = None
        
        # Bind tab selection
        self.view_notebook.bind("<<NotebookTabChanged>>", self.on_view_tab_changed)

        # Progress bar
        self.progress = ttk.Progressbar(right, mode='indeterminate')
        self.progress.pack(fill="x", pady=(5, 0))

        # Status bar
        self.status = tk.StringVar(value="Ready. Configure character and click Generate.")
        status_bar = ttk.Label(self.root, textvariable=self.status, anchor="w", relief="sunken", padding=(6, 2))
        status_bar.pack(fill="x", side="bottom")

    def build_character_description(self) -> str:
        """Build character description from form inputs."""
        import re
        description_parts = []
        
        primary_description = self.get_character_description()
        if primary_description:
            desc = primary_description.strip()
            # Strip pose-like sentences so Pose attribute takes precedence
            pose_patterns = [
                r"\bpose\b[^.]*\.",                # sentences mentioning 'pose'
                r"hands?\s+(at|in|on)\s+[^.]*\.",  # sentences describing hand placement
            ]
            for pat in pose_patterns:
                desc = re.sub(pat, "", desc, flags=re.IGNORECASE)
            desc = " ".join(desc.split())
            if desc:
                # Always put required description at the absolute top
                description_parts.append("[REQUIRED DESCRIPTION]")
                description_parts.append(desc)
                description_parts.append("")
                description_parts.append("## CHARACTER IDENTITY (PRIMARY)")

        # Identity
        age = self.age_var.get().strip()
        race = self.race_var.get().strip()
        gender = self.gender_var.get().strip()
        build = self.build_var.get().strip()

        # Build identity line
        identity_parts = [p for p in [age, race, gender, build] if p]
        if identity_parts:
            description_parts.append("[IDENTITY]")
            description_parts.append(", ".join(identity_parts))
            description_parts.append("")

        # Clothing & gear (strict adherence)
        description_parts.append("## CLOTHING & GEAR (STRICT ADHERENCE)")
        for item in self._collect_required_items():
            description_parts.append(item)
        description_parts.append("")

        # Add Pose with override wording
        pose_value = ""
        if "Pose" in self.fields:
            pose_value = self.fields["Pose"].get_value().strip()
        if pose_value:
            description_parts.append(f"Pose: {pose_value}")
            description_parts.append("")

        # Add a compact forbidden list to prevent default leather/hero gear
        forbidden = self._collect_forbidden_items()
        # Visual style & lighting
        description_parts.append("## VISUAL STYLE & LIGHTING")
        description_parts.append("- Style: AAA game character render with subtle stylization (realistic materials, slightly idealized), full-body shot.")
        description_parts.append("- Lighting: Soft, even studio lighting with neutral color grading. Gentle contrast, no dramatic shadows or cinematic glows.")
        description_parts.append("- Quality: Natural color grading, sharp focus, 85mm portrait lens, neutral tones.")
        description_parts.append("- Texture: Visible skin pores and fabric weave. Render fabrics exactly as described (cotton, wool, fleece). NO LEATHER unless specified.")
        description_parts.append("- Moderate stylization is OK; no illustration, no concept art look.")
        description_parts.append("- Background: Flat solid grey (#D3D3D3) only. No floor, no environment.")
        description_parts.append("")

        # Camera & composition
        description_parts.append("## CAMERA & COMPOSITION")
        description_parts.append("- Aspect Ratio: 9:16 portrait.")
        description_parts.append("- Framing: Full body, head-to-toe, feet visible in frame.")
        description_parts.append("- Lens: 85mm portrait lens, eye-level, no extreme perspective.")
        description_parts.append("")

        # Negative constraints
        description_parts.append("## NEGATIVE CONSTRAINTS")
        if forbidden:
            description_parts.append(f"{', '.join(forbidden)}.")
        description_parts.append("- NO TEXT, LOGOS, OR WATERMARKS.")
        description_parts.append("- NO TACTICAL GEAR, NO HEROIC PROPS, NO SUNGLASSES UNLESS REQUESTED.")

        return "\n".join(description_parts)

    def _attributes_to_appearance_description(self, attributes: dict) -> str:
        """Build a concise appearance-only description from attributes."""
        if not isinstance(attributes, dict):
            return ""

        def _clean(val: str) -> str:
            return (val or "").strip()

        def _is_none(val: str) -> bool:
            return self._is_none_value(val)

        age = _clean(attributes.get("age", ""))
        race = _clean(attributes.get("race", ""))
        gender = _clean(attributes.get("gender", ""))
        build = _clean(attributes.get("build", ""))

        identity_bits = [bit for bit in [age, race, gender, build] if bit]
        identity = " ".join(identity_bits).strip()

        outfit_fields = [
            ("headwear", "Headwear"),
            ("outerwear", "Outerwear"),
            ("top", "Top"),
            ("legwear", "Legwear"),
            ("footwear", "Footwear"),
            ("gloves", "Gloves"),
            ("facegear", "Face gear"),
            ("utilityrig", "Utility rig"),
            ("backcarry", "Back carry"),
            ("handprop", "Hand prop"),
            ("accessories", "Accessories"),
        ]

        outfit_bits = []
        for key, label in outfit_fields:
            val = _clean(attributes.get(key, ""))
            if val and not _is_none(val):
                outfit_bits.append(f"{label}: {val}")

        coloraccents = _clean(attributes.get("coloraccents", ""))
        detailing = _clean(attributes.get("detailing", ""))

        lines = []
        if identity:
            lines.append(f"{identity}.")
        if outfit_bits:
            lines.append(" ".join(outfit_bits) + ".")
        if coloraccents and not _is_none(coloraccents):
            lines.append(f"Color accents: {coloraccents}.")
        if detailing and not _is_none(detailing):
            lines.append(f"Detailing: {detailing}.")

        return " ".join(lines).strip()

    def _is_none_value(self, value: str) -> bool:
        val = (value or "").strip().lower()
        return val in ("", "none", "n/a", "na", "null", "no")

    def _collect_required_items(self) -> list:
        field_order = [
            "Top",
            "Outerwear",
            "Legwear",
            "Footwear",
            "Headwear",
            "Gloves",
            "FaceGear",
            "UtilityRig",
            "BackCarry",
            "HandProp",
            "Accessories",
            "ColorAccents",
            "Detailing",
        ]
        required = []
        for fname in field_order:
            if fname not in self.fields:
                continue
            val = self.fields[fname].get_value()
            if val and not self._is_none_value(val):
                required.append(f"{fname}: {val}")
        return required

    def _collect_forbidden_items(self) -> list:
        forbidden = []
        if "Headwear" in self.fields and self._is_none_value(self.fields["Headwear"].get_value()):
            forbidden.append("hats, caps, helmets")
        if "Outerwear" in self.fields and self._is_none_value(self.fields["Outerwear"].get_value()):
            forbidden.append("jackets, coats, leather outerwear, trench coats")
        if "Gloves" in self.fields and self._is_none_value(self.fields["Gloves"].get_value()):
            forbidden.append("gloves")
        if "FaceGear" in self.fields and self._is_none_value(self.fields["FaceGear"].get_value()):
            forbidden.append("sunglasses, goggles, masks")
        if "UtilityRig" in self.fields and self._is_none_value(self.fields["UtilityRig"].get_value()):
            forbidden.append("chest rigs, armor vests, tactical harnesses")
        if "BackCarry" in self.fields and self._is_none_value(self.fields["BackCarry"].get_value()):
            forbidden.append("backpacks, rifles slung, shoulder bags")
        if "HandProp" in self.fields and self._is_none_value(self.fields["HandProp"].get_value()):
            forbidden.append("weapons or tools in hands")
        if "Accessories" in self.fields and self._is_none_value(self.fields["Accessories"].get_value()):
            forbidden.append("bandoliers, chest straps, flashy jewelry")
        return forbidden

    def get_character_description(self):
        """Get the character description text."""
        return self.character_desc_text.get("1.0", "end-1c").strip()

    def randomize_identity(self):
        """Randomize all identity fields."""
        import random
        self.age_var.set(random.choice(AGE_OPTIONS))
        self.race_var.set(random.choice(RACE_OPTIONS))
        self.gender_var.set(random.choice(GENDER_OPTIONS))
        self.build_var.set(random.choice(BUILD_OPTIONS))
        self.status.set("Randomized character identity.")

    def randomize_description(self):
        """Use AI to generate a completely random character description."""
        if not self.gemini_client or not self.gemini_client._text_model:
            messagebox.showerror("No AI Client", "Gemini AI client is not available.")
            return
        
        if self.generating:
            return
        
        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()
        recent_chars = list(self.recent_characters)

        self.generating = True
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Random Description", "Creating a random character concept...")
        self.progress_dialog.update_status("Resetting AI cache...")
        
        # Run generation in background thread
        def generate_description():
            try:
                # Reset Gemini cache/model to prevent repetitive patterns
                self.root.after(0, lambda: self.progress_dialog.update_status("Clearing AI memory..."))
                self.gemini_client._reset_model_cache()
                
                self.root.after(0, lambda: self.progress_dialog.update_status("Crafting character description..."))
                description = self.gemini_client.generate_random_description(use_valor_lore=use_valor_lore, avoid_patterns=recent_chars)
                self.root.after(0, lambda: self.on_description_generated(description))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self.on_description_error(err))

        threading.Thread(target=generate_description, daemon=True).start()

    def on_description_generated(self, description):
        """Handle successful description generation."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        if description:
            # Store in recent memory to avoid repetition
            self.recent_characters.append(description)
            if len(self.recent_characters) > self.max_recent_memory:
                self.recent_characters.pop(0)  # Remove oldest
            
            # Clear placeholder text and insert generated description
            from dark_theme import DarkTheme
            self.character_desc_text.delete("1.0", "end")
            self.character_desc_text.insert("1.0", description)
            self.character_desc_text.config(foreground=DarkTheme.INPUT_FG)
            
            # Track in character history
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.character_history.append(f"[{timestamp}] AI randomized full character description")
            
            self.log_event("Generated random character description.")
            self.status.set("AI generated random character description! Now generating attributes...")
            
            # Automatically generate attributes from the new description
            self.root.after(100, self.auto_generate_from_description)  # Small delay to let UI update
        else:
            self.log_event("Random description generation failed.")
            messagebox.showerror("Generation Failed", "AI failed to generate character description.")

    def on_description_error(self, error_msg):
        """Handle description generation error."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        self.status.set(f"Description generation failed: {error_msg}")
        messagebox.showerror("Generation Error", f"Failed to generate description:\n{error_msg}")

    def enhance_description(self):
        """Enhance the current description text with AI."""
        if self.generating:
            return
            
        # Get current description
        current_desc = self.get_character_description()
        if not current_desc or current_desc.strip() == "":
            messagebox.showwarning("No Description", "Please enter a character description first.")
            return
            
        if not self.gemini_client:
            messagebox.showerror("API Error", "AI models not available. Please check your API key.")
            return
            
        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Enhancing Description")
        self.progress_dialog.update_status("AI is enhancing your character description...")
        
        def enhance_description():
            try:
                # Training context stays internal in Gemini client
                enhanced = self.gemini_client.enhance_description(current_desc, use_valor_lore=use_valor_lore)
                self.root.after(0, lambda res=enhanced: self.on_description_enhanced(res))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self.on_enhance_error(err))
                
        threading.Thread(target=enhance_description, daemon=True).start()
    
    def on_description_enhanced(self, enhanced_description):
        """Handle successful description enhancement."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        if enhanced_description:
            # If model returned JSON by mistake, apply attributes and build a clean description
            if isinstance(enhanced_description, str):
                cleaned_text = enhanced_description.strip()
                if cleaned_text.startswith("```"):
                    cleaned_text = cleaned_text.strip("`").strip()
                if cleaned_text.lower().startswith("json"):
                    cleaned_text = cleaned_text[4:].strip()
                if cleaned_text.startswith("{"):
                    try:
                        import json
                        parsed = json.loads(cleaned_text)
                        if isinstance(parsed, dict):
                            self.apply_generated_attributes(parsed)
                            cleaned = self._attributes_to_appearance_description(parsed)
                            if cleaned:
                                enhanced_description = cleaned
                    except Exception:
                        pass

            # Store in recent memory
            self.recent_characters.append(enhanced_description)
            if len(self.recent_characters) > self.max_recent_memory:
                self.recent_characters.pop(0)
            
            # Replace the description text
            from dark_theme import DarkTheme
            self.character_desc_text.delete("1.0", "end")
            self.character_desc_text.insert("1.0", enhanced_description)
            self.character_desc_text.config(foreground=DarkTheme.INPUT_FG)
            
            # Track in character history
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.character_history.append(f"[{timestamp}] AI enhanced character description")
            
            self.log_event("Enhanced character description with AI.")
            self.status.set("AI enhanced your character description! Generating attributes...")
            # Auto-fill identity and attributes from the enhanced description
            self.root.after(100, self.generate_attributes_from_text)
        else:
            self.log_event("Description enhancement failed.")
            messagebox.showerror("Enhancement Failed", "AI failed to enhance the description.")
            self.status.set("Description enhancement failed.")
    
    def on_enhance_error(self, error_msg):
        """Handle description enhancement error."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        messagebox.showerror("Enhancement Error", f"Failed to enhance description: {error_msg}")
        self.status.set("Description enhancement failed.")
    
    def generate_attributes_from_text(self):
        """Generate identity and attributes from description. If no description, prompt user to fill it out."""
        if self.generating:
            return
            
        # Get current description
        current_desc = self.get_character_description()
        if not current_desc or current_desc.strip() == "":
            messagebox.showwarning("No Description", "Please enter a character description first before generating identity and attributes.\n\nYou can:\n• Type your own description\n• Use 'Randomize Full Character' to generate one\n• Use 'Enhance Description' to improve an existing one")
            return
            
        if not self.gemini_client:
            messagebox.showerror("API Error", "AI models not available. Please check your API key.")
            return
            
        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Generating Attributes")
        self.progress_dialog.update_status("AI is analyzing your description and generating attributes...")
        
        def generate_attributes():
            try:
                # Training context stays internal in Gemini client
                attributes = self.gemini_client.generate_attributes_from_description(current_desc, use_valor_lore=use_valor_lore)
                self.root.after(0, lambda res=attributes: self.on_text_attributes_generated(res))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self.on_text_attributes_error(err))
                
        threading.Thread(target=generate_attributes, daemon=True).start()
    
    def on_text_attributes_generated(self, attributes_json):
        """Handle successful attribute generation from text."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        if attributes_json:
            try:
                self.apply_generated_attributes(attributes_json)
                self.log_event("Generated attributes from character description.")
                self.status.set("AI generated attributes from your description!")
            except Exception as e:
                self.log_event("Attribute generation failed.")
                messagebox.showerror("Attribute Error", f"Failed to apply generated attributes: {e}")
                self.status.set("Attribute generation failed.")
        else:
            self.log_event("Attribute generation failed.")
            messagebox.showerror("Generation Failed", "AI failed to generate attributes from description.")
            self.status.set("Attribute generation failed.")
    
    def on_text_attributes_error(self, error_msg):
        """Handle attribute generation error."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        messagebox.showerror("Generation Error", f"Failed to generate attributes: {error_msg}")
        self.status.set("Attribute generation failed.")

    def auto_generate_from_description(self):
        """Automatically generate attributes from description (used by Randomize Description)."""
        # This is the same as generate_from_description but without user validation
        description = self.get_character_description()
        if not description:
            # This shouldn't happen since we just generated a description
            self.status.set("Random description generated successfully!")
            return
        
        if not self.gemini_client or not self.gemini_client._text_model:
            self.status.set("Random description generated successfully!")
            return
        
        if self.generating:
            return
        
        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Auto-Generating Attributes", "Analyzing the random description...")
        self.progress_dialog.update_status("Processing description with AI...")
        
        # Run generation in background thread
        def generate_attributes():
            try:
                self.root.after(0, lambda: self.progress_dialog.update_status("Generating attributes..."))
                result = self.gemini_client.generate_attributes_from_description(description, use_valor_lore=use_valor_lore)
                self.root.after(0, lambda res=result: self.on_auto_attributes_generated(res))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self.on_attributes_error(err))

        threading.Thread(target=generate_attributes, daemon=True).start()

    def on_auto_attributes_generated(self, result):
        """Handle successful auto-attribute generation from random description."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        if result:
            # Parse and apply the generated attributes
            self.apply_generated_attributes(result)
            self.status.set("Random character generated! Description and attributes created by AI.")
        else:
            self.status.set("Random description generated successfully! (Attributes generation failed)")

    def generate_from_description(self):
        """Use AI to generate all attributes based on character description."""
        description = self.get_character_description()
        if not description:
            messagebox.showwarning("No Description", "Please enter a character description first.")
            return
        
        if not self.gemini_client or not self.gemini_client._text_model:
            messagebox.showerror("No AI Client", "Gemini AI client is not available.")
            return
        
        if self.generating:
            return
        
        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Generate from Description", "Analyzing your character description...")
        self.progress_dialog.update_status("Processing description with AI...")
        
        # Run generation in background thread
        def generate_attributes():
            try:
                self.root.after(0, lambda: self.progress_dialog.update_status("Generating attributes..."))
                result = self.gemini_client.generate_attributes_from_description(description, use_valor_lore=use_valor_lore)
                self.root.after(0, lambda res=result: self.on_attributes_generated(res))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self.on_attributes_error(err))

        threading.Thread(target=generate_attributes, daemon=True).start()

    def on_attributes_generated(self, result):
        """Handle successful attribute generation from description."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        self.status.set("AI generated attributes from description!")
        
        if result:
            # Parse and apply the generated attributes
            self.apply_generated_attributes(result)
        else:
            messagebox.showerror("Generation Failed", "AI failed to generate attributes from description.")

    def on_attributes_error(self, error_msg):
        """Handle attribute generation error."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        self.status.set(f"Attribute generation failed: {error_msg}")
        messagebox.showerror("Generation Error", f"Failed to generate attributes:\n{error_msg}")

    def apply_generated_attributes(self, attributes_dict):
        """Apply AI-generated attributes to the form, handling nested JSON structure."""
        try:
            def _norm_key(key):
                return "".join(ch for ch in str(key).lower() if ch.isalnum())

            # Create a flattened map of all leaf nodes (strings/numbers) in the dict
            flat_map = {}
            def _walk(obj):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        nk = _norm_key(k)
                        # Only store leaf nodes in the flat map for matching
                        if isinstance(v, (str, int, float, bool)):
                            if v is not None and v != "":
                                flat_map[nk] = v
                        _walk(v)
                elif isinstance(obj, list):
                    for item in obj:
                        _walk(item)

            _walk(attributes_dict)

            def _get_value(key):
                return flat_map.get(_norm_key(key))

            # Update UI on main thread
            def do_update():
                # Apply identity attributes
                identity_fields = {
                    "age": self.age_var,
                    "race": self.race_var,
                    "gender": self.gender_var,
                    "build": self.build_var
                }
                
                for key, var in identity_fields.items():
                    val = _get_value(key)
                    if val is not None:
                        var.set(str(val).strip())

                # Apply character attributes
                for field_name, field_obj in self.fields.items():
                    val = _get_value(field_name)
                    if val is not None:
                        # NEVER allow AI to change Pose - it stays locked to defaults
                        if field_name in ["Pose"]:
                            continue
                        
                        text_val = str(val).strip()
                        if text_val:
                            # Set the custom text field
                            from dark_theme import DarkTheme
                            field_obj.custom_var.set(text_val)
                            field_obj.custom_entry.config(foreground=DarkTheme.INPUT_FG)
                            # Clear dropdown selection so custom text takes precedence
                            field_obj.var.set("")
                
                self.status.set("✅ AI character identity and attributes populated successfully.")

            self.root.after(0, do_update)
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.root.after(0, lambda: messagebox.showerror("Apply Error", f"Error applying character data:\n{str(e)}"))

    def randomize_all(self):
        """Randomize all identity and attribute fields using preset options, but preserve defaults."""
        # Randomize identity fields
        self.randomize_identity()
        
        # Randomize attribute fields but skip Pose to preserve defaults
        for field_name, field_row in self.fields.items():
            if field_name not in ["Pose"]:  # Preserve default pose
                field_row.randomize()
        
        self.status.set("Randomized all identity and attributes (preserving pose defaults).")

    def chaos_generator(self):
        """Create an unhinged AI generation for all Identity, Attributes, and character description - for fun!"""
        if (
            not self.gemini_client
            or not self.gemini_client._image_client
            or not self.gemini_client._text_model
        ):
            messagebox.showerror("No AI Client", "Gemini AI client is not available.")
            return
            
        # Warning dialog
        result = messagebox.askyesno(
            "AI Chaos Generator", 
            "This will overwrite all current character settings.\n\n"
            "AI will generate an exaggerated, unhinged character with wild attributes.\n\n"
            "Continue?",
            icon="warning"
        )
        
        if not result:
            return
        
        if self.generating:
            return
            
        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "AI Chaos Generator")
        self.progress_dialog.update_status("Generating character description...")
        
        def generate_chaos():
            try:
                # First generate an exaggerated character description (training context stays internal in Gemini client)
                self.root.after(0, lambda: self.progress_dialog.update_status("Creating character description..."))
                chaos_description = self.gemini_client.generate_chaos_description(use_valor_lore=use_valor_lore)
                
                # Then generate matching attributes
                self.root.after(0, lambda: self.progress_dialog.update_status("Generating character attributes..."))
                chaos_attributes = self.gemini_client.generate_chaos_attributes(chaos_description or "", use_valor_lore=use_valor_lore)
                
                self.root.after(0, lambda: self.on_chaos_complete(chaos_description, chaos_attributes))
            except Exception as error:
                error_msg = str(error)
                self.root.after(0, lambda msg=error_msg: self.on_chaos_error(msg))
                
        threading.Thread(target=generate_chaos, daemon=True).start()
    
    def on_chaos_complete(self, chaos_description, chaos_attributes):
        """Handle successful chaos generation."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        try:
            # Set the chaos description
            from dark_theme import DarkTheme
            if chaos_description:
                self.character_desc_text.delete("1.0", "end")
                self.character_desc_text.insert("1.0", chaos_description)
                self.character_desc_text.config(foreground=DarkTheme.INPUT_FG)
            
            # Apply chaos attributes
            if chaos_attributes:
                import json
                try:
                    # Handle both JSON string and dict
                    if isinstance(chaos_attributes, str):
                        # Try to extract just the JSON part if there's extra text
                        chaos_text = chaos_attributes
                        # Remove markdown code blocks if present
                        if '```json' in chaos_text:
                            start_idx = chaos_text.find('{')
                            end_idx = chaos_text.rfind('}') + 1
                            chaos_text = chaos_text[start_idx:end_idx]
                        elif '{' in chaos_text:
                            start_idx = chaos_text.find('{')
                            end_idx = chaos_text.rfind('}') + 1
                            chaos_text = chaos_text[start_idx:end_idx]
                        chaos_dict = json.loads(chaos_text)
                    else:
                        chaos_dict = chaos_attributes
                    
                    print(f"DEBUG: Parsed chaos dict keys: {list(chaos_dict.keys())}")
                    
                    # Apply to identity fields (these exist in the identity section)
                    identity_mapping = {
                        "age": self.age_var,
                        "race": self.race_var, 
                        "gender": self.gender_var,
                        "build": self.build_var
                    }
                    
                    for key, var in identity_mapping.items():
                        if key in chaos_dict and chaos_dict[key]:
                            var.set(chaos_dict[key])
                            print(f"DEBUG: Set identity {key} to {chaos_dict[key]}")
                    
                    # Apply to attribute fields using custom text
                    for field_name, field_obj in self.fields.items():
                        chaos_key = field_name.lower()
                        if chaos_key in chaos_dict:
                            chaos_value = chaos_dict[chaos_key]
                            if chaos_value and chaos_value.strip():
                                # Set custom text field with chaos description
                                field_obj.custom_var.set(chaos_value)
                                field_obj.custom_entry.config(foreground=DarkTheme.INPUT_FG)
                                # Clear dropdown so custom text takes precedence
                                field_obj.var.set("")
                                print(f"DEBUG: Set attribute {field_name} to {chaos_value}")
                
                except json.JSONDecodeError as e:
                    print(f"DEBUG: JSON parse error: {e}")
                    print(f"DEBUG: Raw response: {chaos_attributes}")
                    # Fall back to using the existing generate_attributes_from_description method
                    try:
                        print("DEBUG: Falling back to standard attribute generation")
                        attributes_result = self.gemini_client.generate_attributes_from_description(chaos_description, use_valor_lore=self.valor_lore_var.get())
                        if attributes_result:
                            self.apply_generated_attributes(attributes_result)
                            print("DEBUG: Applied fallback attributes")
                    except Exception as fallback_error:
                        print(f"DEBUG: Fallback also failed: {fallback_error}")
            
            # Track in character history
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.character_history.append(f"[{timestamp}] Chaos generator created random character")
            
            self.log_event("Chaos generator created a random character.")
            self.status.set("AI Chaos Generator complete! Character generated.")
            
        except Exception as e:
            self.log_event("Chaos generator encountered errors.")
            messagebox.showerror("Chaos Error", f"Chaos generation partially failed: {e}")
            self.status.set("Chaos generation encountered some turbulence.")
    
    def on_chaos_error(self, error_msg):
        """Handle chaos generation error."""
        self.generating = False
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        messagebox.showerror("Chaos Failed", f"AI chaos generation failed: {error_msg}\n\nThe universe resisted maximum chaos.")
        self.status.set("Chaos generation failed - reality remained stable.")


    def generate_character(self):
        """Generate character concept image."""
        if self.generating:
            return
        
        if not self.gemini_client:
            messagebox.showerror("API Error", "AI models not available. Please check your API key.")
            return
            
        description = self.build_character_description()
        if not any(fr.get_value() for fr in self.fields.values()) and not self.get_character_description().strip():
            messagebox.showwarning("Empty Character", "Please configure at least some character attributes before generating.")
            return

        # Pre-fetch values for thread safety
        use_valor_lore = self.valor_lore_var.get()
        lore_ctx = self.lore_context[:1000] if self.lore_context else ""
        lore_imgs = [str(p) for p in self.lore_images]
        curr_view = self.current_view
        stage_img_exists = self.view_images["stage"] is not None

        self.generating = True
        self.generate_btn.configure(text="Generating...", state="disabled")
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Character Generation", "Creating your character concept...")
        self.progress_dialog.update_status("Preparing AI prompt...")

        # Run generation in background thread
        def generate():
            try:
                self.root.after(0, lambda: self.progress_dialog.update_status("Generating with Gemini AI..."))
                # Default to 3/4 view if no Main Stage image exists, otherwise use current view
                base_view_type = "main" if not stage_img_exists else curr_view
                if curr_view == "stage":
                    base_view_type = "main"  # Default Main Stage generation to 3/4 view
                
                # Build light lore influence for image generation
                lore_text_summary = ""
                lore_image_paths = []
                if use_valor_lore and lore_ctx.strip():
                    lore_text_summary = f"TONAL BACKGROUND (for mood consistency):\n{lore_ctx}"
                    lore_image_paths = lore_imgs

                # Training context stays internal in Gemini client, don't prepend to user-facing description
                image = self.gemini_client.generate_character(
                    description,
                    width=1536,
                    height=2816,
                    view_type=base_view_type,
                    use_valor_lore=use_valor_lore,
                    lore_context_text=lore_text_summary if lore_text_summary else None,
                    lore_image_paths=lore_image_paths if lore_image_paths else None
                )
                # Save the exact prompt used by the model
                try:
                    prompt_text = self.gemini_client.last_prompt_text or description
                    meta = self.gemini_client.last_prompt_meta if hasattr(self.gemini_client, "last_prompt_meta") else {}
                    self.save_last_prompt(prompt_text, base_view_type, meta)
                except Exception:
                    pass
                self.root.after(0, lambda res=image, view=base_view_type: self.on_generation_complete(res, view))
            except Exception as e:
                # Save prompt even if generation fails
                try:
                    prompt_text = self.gemini_client.last_prompt_text or description
                    meta = self.gemini_client.last_prompt_meta if hasattr(self.gemini_client, "last_prompt_meta") else {}
                    self.save_last_prompt(prompt_text, base_view_type, meta)
                except Exception:
                    pass
                self.root.after(0, lambda err=str(e): self.on_generation_error(err))

        threading.Thread(target=generate, daemon=True).start()

    def open_image(self):
        """Open an existing image file and load it into Main Stage."""
        if self.generating:
            return
        
        # Open file dialog
        filename = filedialog.askopenfilename(
            title="Open Character Image",
            filetypes=[
                ("Image files", "*.png *.jpg *.jpeg *.bmp *.gif *.tiff"),
                ("PNG files", "*.png"),
                ("JPEG files", "*.jpg *.jpeg"),
                ("All files", "*.*")
            ]
        )
        
        if not filename:
            return
        
        try:
            # Load and process the image
            image = Image.open(filename)
            
            # Convert to RGB if necessary
            if image.mode in ("RGBA", "P"):
                # Create white background for transparency
                rgb_image = Image.new("RGB", image.size, (255, 255, 255))
                if image.mode == "RGBA":
                    rgb_image.paste(image, mask=image.split()[-1])
                else:
                    rgb_image.paste(image)
                image = rgb_image
            elif image.mode != "RGB":
                image = image.convert("RGB")
            
            # Resize to standard portrait size (1536x2816 for full-body characters)
            image = image.resize((1536, 2816), Image.Resampling.LANCZOS)
            
            # Set as Main Stage image
            self.view_images["stage"] = image
            self.current_image = image
            self.current_view = "stage"
            
            # Switch to Main Stage tab and display
            self.view_notebook.select(self.view_frames["stage"])
            self.display_image(image, "stage")
            
            # Enable all relevant buttons
            self.generate_all_btn.configure(state="normal")
            self.generate_selected_btn.configure(state="normal")
            self.send_all_btn.configure(state="normal")
            
            # Store reference image and description for multi-view generation
            self.main_reference_image = image
            self.main_prompt_snapshot = self.build_character_description()
            self.main_character_description = "Character loaded from image file"
            
            # Add this opened image to Image History (macro timeline)
            image_path = Path(filename)
            self.last_loaded_image_path = image_path
            self.log_new_base_image(image_path, label="Opened Image")
            
            # Update edit history display for this opened image
            self.update_edit_history_display(image_path)
            
            # Check for metadata (don't auto-restore, let user click button)
            metadata_path = image_path.with_suffix(".json")
            if metadata_path.exists():
                self.status.set(f"Loaded image into Main Stage: {filename} — Metadata found!")
            else:
                self.status.set(f"Loaded image into Main Stage: {filename}")
            
            # Reset working state when opening a new image
            self.working_state = {}
            
        except Exception as e:
            messagebox.showerror("Open Error", f"Could not open image:\n{str(e)}")
            self.status.set("Failed to open image")

    def reset_character(self):
        """Reset everything including all form settings after user confirmation."""
        # Show confirmation dialog with detailed warning
        result = messagebox.askyesno(
            "Reset Everything", 
            "⚠️ WARNING: This will completely reset ALL character data:\n\n" +
            "• All generated/loaded images will be deleted\n" +
            "• All form settings (identity, attributes) will be reset to defaults\n" +
            "• Character description will be cleared\n" +
            "• Additional notes will be cleared\n\n" +
            "🚫 This action cannot be undone!\n\n" +
            "Are you absolutely sure you want to reset everything?",
            icon="warning"
        )
        
        if not result:
            return
        
        # Clear canonical reference character state FIRST
        self.main_reference_image = None
        self.main_character_description = ""
        self.main_prompt_snapshot = ""
        self.current_edit_base_path = None  # Clear edit history tracking
        self.pasted_image_cache = None  # Clear cached pasted image
        
        # Clear all stored view images
        for view_name in ["stage", "main", "front", "back", "side", "ref_a", "ref_b", "ref_c"]:
            self.view_images[view_name] = None
        
        # Reset view canvas states
        for view_name in ["front", "back", "side", "ref_a", "ref_b", "ref_c"]:
            self._view_reset_state(view_name)
            self.view_tk_image[view_name] = None
        
        # Clear current state
        self.current_image = None
        self.current_view = "stage"
        self.current_character_folder = None
        self.last_loaded_image_path = None
        
        # Reset all view displays to blank state
        for view_name, display_name in [("stage", "Main Stage (3/4)"), ("front", "Front"), ("back", "Back"), ("side", "Side"), ("ref_a", "Ref A"), ("ref_b", "Ref B"), ("ref_c", "Ref C")]:
            if view_name == "stage":
                self._stage_clear_display(f"No {display_name.lower()} image loaded")
            else:
                self._view_update_display(view_name)
        
        # Disable multi-view buttons
        self.generate_all_btn.configure(state="disabled")
        self.generate_selected_btn.configure(state="disabled")
        self.send_all_btn.configure(state="disabled")
        
        # Switch to main tab
        self.view_notebook.select(0)
        
        # Reset ALL form fields to defaults
        for field_name, field_row in self.fields.items():
            # Reset dropdown to first option (blank)
            field_row.var.set("")
            
            # Reset custom text field to blank
            field_row.custom_var.set("")
        
        # Reset identity fields to defaults
        self.age_var.set("")  # Start blank
        self.race_var.set("")  # Start blank  
        self.gender_var.set("")  # Start blank
        self.build_var.set("")  # Start blank
        
        # Set specific defaults for Pose
        if "Pose" in self.fields:
            self.fields["Pose"].var.set("Pose — relaxed A‑stance, hands at sides")
            self.fields["Pose"].custom_var.set("")
        
        # Clear character description text box
        from dark_theme import DarkTheme
        self.character_desc_text.delete('1.0', tk.END)
        self.character_desc_text.config(foreground=DarkTheme.INPUT_FG)
        
        # Clear edit prompt text box (if present)
        if hasattr(self, "edit_prompt_text"):
            self.edit_prompt_text.delete("1.0", "end")
        
        # Reset working state and transient variables
        self.working_state = {}
        self.active_edit = None
        self.recent_characters = []
        self.character_history = []
        self.image_history = []
        self.history_index = -1
        self.session_log = []
        
        # Clear edit history (memory + UI)
        try:
            self.edit_registry.clear()
        except Exception:
            self.edit_registry = {}
        
        # Refresh the edit history panel to show empty state
        try:
            self.update_edit_history_display(None)
        except Exception:
            pass
        
        self.status.set("Ready. Configure character and click Generate.")
        self.log_event("Session reset to initial state.")

    def clear_ai_cache(self):
        """Clear the AI model cache and reset randomization patterns to prevent repetitive results."""
        if not self.gemini_client:
            messagebox.showinfo("No AI Client", "Gemini AI client is not available.")
            return
        
        # Ask for confirmation
        result = messagebox.askyesno(
            "Clear AI Cache", 
            "This will reset the AI model and clear recent character patterns to help prevent repetitive generation.\n\n"
            "This includes:\n"
            "• Resetting the AI model instance\n"
            "• Clearing recent character history\n"
            "• Resetting randomization seeds\n\n"
            "Continue?"
        )
        
        if result:
            try:
                # Reset the Gemini model cache
                self.gemini_client._reset_model_cache()
                
                # Clear recent character patterns (if they exist)
                if hasattr(self, 'recent_characters'):
                    self.recent_characters.clear()
                
                # Reset any stored patterns or seeds
                import random
                import time
                random.seed(int(time.time()))  # Reset random seed based on current time
                
                self.status.set("AI cache and patterns cleared - next generation should be more varied.")
                messagebox.showinfo("Cache Cleared", 
                    "AI cache has been cleared successfully!\n\n"
                    "✓ Model instance reset\n"
                    "✓ Recent patterns cleared\n" 
                    "✓ Randomization seeds reset\n\n"
                    "The next character generation should have more variety.")
            except Exception as e:
                self.status.set(f"Failed to clear AI cache: {e}")
                messagebox.showerror("Cache Clear Failed", f"Failed to clear AI cache:\n{e}")

    def update_edit_history_display(self, current_image_path=None):
        """Update the edit history list directly under the label (no extra bottom space)."""
        from dark_theme import DarkTheme

        # Ensure widgets exist (created in setup_ui). If not, bail out gracefully.
        if not hasattr(self, "edit_history_frame") or not self.edit_history_frame:
            return

        # Clear any previous rows instead of recreating the canvas (prevents TclError callbacks)
        for child in list(self.edit_history_frame.winfo_children()):
            try:
                child.destroy()
            except Exception:
                pass

        # Determine which image's history to show
        if current_image_path is None:
            # First check if we have a tracked edit base path
            if hasattr(self, 'current_edit_base_path') and self.current_edit_base_path:
                current_image_path = self.current_edit_base_path
            elif self.image_history and self.history_index >= 0:
                current_image_path = self.image_history[self.history_index]
        
        current_path = str(current_image_path) if current_image_path else None
        history_entries = self.edit_registry.get(current_path, []) if current_path else []

        # After repopulating, the existing bindings in setup_ui will handle scrollregion
        
        # Show which base image these edits are for
        if current_path:
            base_name = Path(current_path).stem
            # Truncate if too long
            if len(base_name) > 40:
                base_name = base_name[:37] + "..."
            header = ttk.Label(
                self.edit_history_frame,
                text=f"Edits for: {base_name}", 
                foreground="#B0B0B0", 
                font=("Segoe UI", 9, "bold")
            )
            header.pack(anchor="w", padx=4, pady=(2, 6))
        
        # Show edit entries
        if not history_entries:
            empty_label = ttk.Label(
                self.edit_history_frame,
                text="No edits for this image yet.\nDescribe changes above and click 'Apply Changes'.",
                foreground="#888888",
                font=("Segoe UI", 9, "italic")
            )
            empty_label.pack(anchor="w", padx=4, pady=4)
        else:
            # Show most recent first
            for i, entry in enumerate(reversed(history_entries)):
                # Get entry data (new format is dict)
                if isinstance(entry, dict):
                    timestamp = entry.get("timestamp", "")
                    prompt = entry.get("prompt", "")
                    filename = entry.get("image_file", "")
                    image_path = entry.get("image_path", "")  # Full path for loading
                    is_original = entry.get("is_original", False)
                else:
                    # Old tuple format compatibility
                    if len(entry) == 3:
                        timestamp, prompt, filename = entry
                    else:
                        timestamp, prompt = entry
                        filename = None
                    image_path = ""
                    is_original = False
                
                # Check if this is the active edit
                is_active = (filename and filename == self.active_edit)
                
                # Create row frame
                row = ttk.Frame(self.edit_history_frame)
                row.pack(fill="x", pady=1, padx=4)
                
                # Add background color to row if active
                if is_active:
                    row.configure(style="ActiveEdit.TFrame")
                
                # Create clickable button for loading the image
                # Use full path if available, otherwise just filename
                load_path = image_path if image_path else filename
                if load_path:
                    btn = ttk.Button(
                        row,
                        text="🖼",
                        width=3,
                        command=lambda p=load_path: self.load_edit_image(p)
                    )
                    btn.pack(side="left", padx=(4, 2))
                
                # Create label with timestamp and prompt
                prompt_text = f"[{timestamp}] {prompt}"
                if is_original:
                    prompt_text += " (original)"
                
                label = ttk.Label(
                    row, 
                    text=prompt_text, 
                    anchor="w",
                    foreground="#B0B0B0" if is_original else DarkTheme.TEXT_FG
                )
                label.pack(side="left", fill="x", expand=True)
        
        # Bind mousewheel scrolling only when hovering over the canvas (set once)
        def _eh_on_enter(event):
            def _eh_on_mousewheel(e):
                if self.edit_history_canvas and self.edit_history_canvas.winfo_exists():
                    self.edit_history_canvas.yview_scroll(int(-1*(e.delta/120)), "units")
            self.edit_history_canvas.bind("<MouseWheel>", _eh_on_mousewheel)
        def _eh_on_leave(event):
            if self.edit_history_canvas and self.edit_history_canvas.winfo_exists():
                self.edit_history_canvas.unbind("<MouseWheel>")
        # Ensure bindings are present
        try:
            self.edit_history_canvas.bind("<Enter>", _eh_on_enter)
            self.edit_history_canvas.bind("<Leave>", _eh_on_leave)
        except Exception:
            pass
    
    def load_metadata_for_image(self, image_path):
        """Load all identity, attributes, description, and notes for a given image."""
        import json
        
        # First check our in-memory cache
        str_path = str(image_path)
        if str_path in self.image_metadata:
            meta = self.image_metadata[str_path]
            
            # Apply identity fields
            identity = meta.get("identity", {})
            self.age_var.set(identity.get("age", ""))
            self.race_var.set(identity.get("race", ""))
            self.gender_var.set(identity.get("gender", ""))
            self.build_var.set(identity.get("build", ""))
            
            # Apply attributes
            attributes = meta.get("attributes", {})
            for name, fr in self.fields.items():
                value = attributes.get(name, "")
                if value and value != "none":
                    fr.custom_var.set(value)
                    fr.var.set("")
                else:
                    fr.custom_var.set("")
                    fr.var.set("")
            
            # Apply description and notes
            self.character_desc_text.delete("1.0", "end")
            desc = meta.get("description", "")
            if desc and desc != "no description provided":
                self.character_desc_text.insert("1.0", desc)
            
            return
        
        # Otherwise try to load from disk
        meta_path = Path(image_path).with_suffix(".json")
        if not meta_path.exists():
            # No metadata available - clear fields
            self.age_var.set("")
            self.race_var.set("")
            self.gender_var.set("")
            self.build_var.set("")
            for name, fr in self.fields.items():
                fr.custom_var.set("")
                fr.var.set("")
            self.character_desc_text.delete("1.0", "end")
            return
        
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            # Load from organized JSON structure
            identity_section = data.get("==== CHARACTER IDENTITY ====", {})
            attrs_section = data.get("==== CHARACTER ATTRIBUTES ====", {})
            desc_section = data.get("==== DESCRIPTION & NOTES ====", {})
            
            # Apply identity
            self.age_var.set(identity_section.get("age", ""))
            self.race_var.set(identity_section.get("race", ""))
            self.gender_var.set(identity_section.get("gender", ""))
            self.build_var.set(identity_section.get("build", ""))
            
            # Apply attributes
            for name, fr in self.fields.items():
                value = attrs_section.get(name, "")
                if value and value != "none":
                    fr.custom_var.set(value)
                    fr.var.set("")
                else:
                    fr.custom_var.set("")
                    fr.var.set("")
            
            # Apply description and notes
            self.character_desc_text.delete("1.0", "end")
            desc = desc_section.get("character_description", "")
            if desc and desc != "no description provided":
                self.character_desc_text.insert("1.0", desc)
            
            # Load edit history into registry
            edit_history_data = data.get("==== EDIT HISTORY ====", [])
            if edit_history_data:
                self.edit_registry[str_path] = edit_history_data
            
        except Exception as e:
            print(f"Failed to load metadata for {image_path}: {e}")
    
    def capture_working_state(self):
        """Capture all editable fields into a working-state cache."""
        try:
            self.working_state = {
                "character_description": self.character_desc_text.get("1.0", "end-1c"),
                "edit_prompt": self.edit_prompt_text.get("1.0", "end-1c") if hasattr(self, "edit_prompt_text") else "",
                "identity": {
                    "age": self.age_var.get(),
                    "race": self.race_var.get(),
                    "gender": self.gender_var.get(),
                    "build": self.build_var.get(),
                },
                "attributes": {
                    name: fr.get_value() for name, fr in self.fields.items()
                }
            }
            self.log_event("Captured working state for latest image.")
        except Exception as e:
            print(f"Failed to capture working state: {e}")

    def restore_working_state(self):
        """Restore all editable fields from the cached working state."""
        if not self.working_state:
            return

        try:
            ws = self.working_state
            
            # Restore character description
            self.character_desc_text.delete("1.0", "end")
            self.character_desc_text.insert("1.0", ws.get("character_description", ""))

            # Restore edit prompt
            if hasattr(self, "edit_prompt_text"):
                self.edit_prompt_text.delete("1.0", "end")
                self.edit_prompt_text.insert("1.0", ws.get("edit_prompt", ""))

            # Restore identity fields
            identity = ws.get("identity", {})
            self.age_var.set(identity.get("age", ""))
            self.race_var.set(identity.get("race", ""))
            self.gender_var.set(identity.get("gender", ""))
            self.build_var.set(identity.get("build", ""))

            # Restore attributes
            attributes = ws.get("attributes", {})
            for name, fr in self.fields.items():
                if name in attributes and attributes[name]:
                    fr.custom_var.set(attributes[name])
                    fr.var.set("")  # prefer custom entry

            self.log_event("Restored working state for latest image.")
        except Exception as e:
            print(f"Failed to restore working state: {e}")
    
    def load_edit_image(self, path_or_filename):
        """Load the image linked to a specific edit entry and mark as active."""
        try:
            # Special case: "pasted_image" means load from the cached original pasted image
            if path_or_filename == "pasted_image":
                if self.pasted_image_cache is not None:
                    image = self.pasted_image_cache.copy()
                    
                    # Update Main Stage with the cached pasted image
                    self.view_images["stage"] = image
                    self.view_images["main"] = image
                    self.current_image = image
                    self.current_view = "stage"
                    self.view_notebook.select(self.view_frames["stage"])
                    self.display_image(image, "stage")
                    
                    # Update canonical reference
                    self.main_reference_image = image
                    
                    # Mark this as the active edit
                    self.active_edit = "pasted_image"
                    
                    # Update edit history display
                    self.update_edit_history_display("pasted_image")
                    
                    self.status.set("Loaded original pasted image.")
                    self.log_event("Loaded original pasted image from cache.")
                    return
                else:
                    messagebox.showwarning("No Cached Image", "Original pasted image is no longer available.")
                    self.status.set("Original pasted image not in cache.")
                    return
            
            # Check if it's a full path or just a filename
            candidate_path = Path(path_or_filename)
            
            if not candidate_path.is_absolute():
                # It's just a filename - try to find it
                candidate_path = self.all_generated_dir / path_or_filename
            
            if not candidate_path.exists():
                # Try searching in date subfolders
                found = False
                for date_folder in self.all_generated_dir.iterdir():
                    if date_folder.is_dir():
                        potential_path = date_folder / Path(path_or_filename).name
                        if potential_path.exists():
                            candidate_path = potential_path
                            found = True
                            break
                
                if not found:
                    messagebox.showwarning("Missing Image", f"Cannot find image:\n{Path(path_or_filename).name}")
                    self.status.set(f"Image not found: {Path(path_or_filename).name}")
                    return

            image = Image.open(candidate_path)
            
            # Convert if needed
            if image.mode == "RGBA":
                pass  # Keep RGBA if it has transparency
            elif image.mode != "RGB":
                image = image.convert("RGB")

            # Update Main Stage with the loaded image
            self.view_images["stage"] = image
            self.current_image = image
            self.current_view = "stage"
            self.view_notebook.select(self.view_frames["stage"])
            self.display_image(image, "stage")
            
            # Mark this as the active edit (store just the filename for matching)
            self.active_edit = candidate_path.name
            
            # Don't add to Image History - edits stay in Edit History only
            # Just get the current base image path for edit history display
            base_image_path = self.image_history[self.history_index] if self.image_history and self.history_index >= 0 else None
            
            # Update edit history display with active highlight
            if base_image_path:
                self.update_edit_history_display(base_image_path)
            elif hasattr(self, 'current_edit_base_path') and self.current_edit_base_path:
                self.update_edit_history_display(self.current_edit_base_path)
            
            self.status.set(f"Loaded edit: {candidate_path.name}")
            self.log_event(f"Loaded edit image: {candidate_path.name}")
        except Exception as e:
            import traceback
            traceback.print_exc()
            messagebox.showerror("Load Failed", f"Could not load image:\n{e}")
    
    def apply_edit_from_panel(self):
        """Apply edit from the edit panel to the active view (ref tabs default to Main Stage)."""
        # Determine target view: use current view unless it's a ref tab
        target_view = self.current_view
        if target_view in ("ref_a", "ref_b", "ref_c"):
            target_view = "stage"  # Ref tabs always edit Main Stage
        
        # Get the target image
        target_image = self.view_images.get(target_view)
        if not target_image:
            view_display = VIEW_DISPLAY_NAMES.get(target_view, target_view)
            messagebox.showwarning("No Image", f"No image in {view_display}. Generate, load, or paste an image first.")
            return
        
        if self.generating:
            return
        
        # Get edit prompt from panel
        edit_prompt = self.edit_prompt_text.get("1.0", "end-1c").strip()
        
        if not edit_prompt:
            messagebox.showwarning("No Edit Prompt", "Please describe what changes you want to make.")
            return
        
        # Pre-fetch values for thread safety
        use_valor_lore = self.valor_lore_var.get()
        ref_a = self.view_images.get("ref_a")
        ref_b = self.view_images.get("ref_b")
        ref_c = self.view_images.get("ref_c")

        # Get the base image path if available (for history tracking)
        # Note: Pasted images may not have a path in history, and that's OK
        base_image_path = self.image_history[self.history_index] if self.image_history and self.history_index >= 0 else "pasted_image"
        
        # Save this prompt - will be added to registry after image generation
        timestamp = datetime.now().strftime("%H:%M:%S")
        view_display = VIEW_DISPLAY_NAMES.get(target_view, target_view)
        self.pending_edit_entry = {
            "timestamp": timestamp,
            "prompt": edit_prompt,
            "base_image_path": str(base_image_path),
            "target_view": target_view
        }
        self.character_history.append(f"[{timestamp}] EDIT ({view_display}): {edit_prompt}")
        self.log_event(f"Edit {view_display} with prompt: {edit_prompt}")
        
        # Get current character description for context
        original_description = self.build_character_description()
        
        self.generating = True
        self.generate_btn.configure(state="disabled")
        
        # Show progress dialog
        self.progress_dialog = ProgressDialog(self.root, "Character Editing", f"Applying visual edit to {view_display}...")
        self.progress_dialog.update_status("Preserving character identity...")

        # Run editing in background thread
        def edit():
            try:
                self.root.after(0, lambda: self.progress_dialog.update_status("Applying localized changes while preserving visual identity..."))
                # Use target view's image as reference and apply ONLY the specific changes in edit_prompt
                # Pass Ref A/B/C images - they will only be used if mentioned in the prompt
                edited_image = self.gemini_client.generate_character(
                    character_description=original_description, 
                    width=1536,
                    height=2816,
                    reference_image=target_image,  # Use target view's image as reference
                    edit_prompt=edit_prompt,  # Only apply these specific changes
                    view_type=target_view if target_view != "stage" else "main",
                    use_valor_lore=use_valor_lore,
                    ref_a_image=ref_a,
                    ref_b_image=ref_b,
                    ref_c_image=ref_c
                )
                self.root.after(0, lambda res=edited_image, target=target_view: self.on_edit_complete(res, target))
            except Exception as e:
                self.root.after(0, lambda err=str(e): self.on_edit_error(err))

        threading.Thread(target=edit, daemon=True).start()

    def on_edit_complete(self, image: Image.Image, target_view: str = "stage"):
        """Handle successful character edit - updates the target view."""
        self.generating = False
        self.generate_btn.configure(state="normal")
        self.generate_all_btn.configure(state="normal")
        self.generate_selected_btn.configure(state="normal")
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        view_display = VIEW_DISPLAY_NAMES.get(target_view, target_view)
        
        if image:
            # Auto-save to ALL GENERATED IMAGES folder
            save_view_type = "main" if target_view == "stage" else target_view
            saved_filename = self.auto_save_generated_image(image, save_view_type, "edit")
            
            # Track the base path for edit history display
            edit_base_path = None
            
            # Complete the edit history entry and add to registry
            if hasattr(self, 'pending_edit_entry') and saved_filename:
                pending = self.pending_edit_entry
                base_path = pending["base_image_path"]
                edit_base_path = base_path  # Store for later display update
                
                # Initialize registry for this base image if needed
                if base_path not in self.edit_registry:
                    self.edit_registry[base_path] = []
                
                # Add baseline "original" entry on first edit
                if not any(e.get("is_original") for e in self.edit_registry[base_path]):
                    original_entry = {
                        "timestamp": pending["timestamp"],
                        "prompt": "Original image",
                        "image_file": Path(base_path).name if base_path != "pasted_image" else "pasted_image",
                        "is_original": True
                    }
                    self.edit_registry[base_path].append(original_entry)
                    self.log_event(f"Logged original image as baseline for edit history")
                
                # Add this new edit entry (image_file stores just the filename for display)
                edit_entry = {
                    "timestamp": pending["timestamp"],
                    "prompt": pending["prompt"],
                    "image_file": Path(saved_filename).name if saved_filename else None,
                    "image_path": saved_filename,  # Full path for loading
                    "is_original": False,
                    "target_view": target_view
                }
                self.edit_registry[base_path].append(edit_entry)
                self.log_event(f"Added edit to registry: '{pending['prompt'][:50]}'")
                
                # Save metadata immediately with edit history (only for file-based images)
                if base_path != "pasted_image":
                    try:
                        import json
                        base_metadata_path = Path(base_path).with_suffix(".json")
                        if base_metadata_path.exists():
                            with open(base_metadata_path, "r", encoding="utf-8") as f:
                                base_metadata = json.load(f)
                        else:
                            base_metadata = {}
                        
                        base_metadata["==== EDIT HISTORY ===="] = self.edit_registry[base_path]
                        
                        with open(base_metadata_path, "w", encoding="utf-8") as f:
                            json.dump(base_metadata, f, indent=4, ensure_ascii=False)
                    except Exception as e:
                        self.log_event(f"Could not save edit metadata: {e}")
                
                # Store the current edit base path for the UI
                self.current_edit_base_path = base_path
                
                delattr(self, 'pending_edit_entry')
            
            # Update target view with the edited image
            self.view_images[target_view] = image
            if target_view == "stage":
                self.view_images["main"] = image  # Link both for consistency
            self.current_image = image
            
            # Update reference image for multi-view generation (only if editing Main Stage)
            if target_view == "stage":
                self.main_reference_image = image
                self.main_prompt_snapshot = self.build_character_description()
                self.main_character_description = self.main_prompt_snapshot
            
            # Switch to target view tab and display the edited image
            self.current_view = target_view
            self.view_notebook.select(self.view_frames[target_view])
            self.display_image(image, target_view)
            
            # Enable save all button
            if any(img is not None for img in self.view_images.values()):
                self.send_all_btn.configure(state="normal")
            
            # Update edit history display immediately using the correct base path
            if edit_base_path:
                self.update_edit_history_display(edit_base_path)
            elif self.image_history and self.history_index >= 0:
                self.update_edit_history_display(self.image_history[self.history_index])
            else:
                # Force refresh even without a path to show "pasted_image" edits
                self.update_edit_history_display(getattr(self, 'current_edit_base_path', None))
            
            # Clear the edit prompt text box
            self.edit_prompt_text.delete("1.0", "end")
            
            # Reset working state since this is now the most recent image
            self.working_state = {}
            
            edit_summary = saved_filename[:50] if saved_filename else "unknown"
            self.log_event(f"{view_display} edit completed: '{edit_summary}' - Character identity preserved")
            self.status.set(f"{view_display} edited successfully! Character identity preserved.")
        else:
            self.log_event("Character edit failed - no image returned.")
            self.status.set("Edit failed - no image returned")

    def on_edit_error(self, error: str):
        """Handle edit error."""
        self.generating = False
        self.generate_btn.configure(state="normal")
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        self.status.set(f"Edit failed: {error}")
        messagebox.showerror("Edit Error", f"Failed to edit character:\n{error}")

    def on_generation_complete(self, image: Image.Image, view_type: str = None):
        """Handle successful image generation."""
        self.generating = False
        self.generate_btn.configure(text="Generate Character", state="normal")
        self.generate_all_btn.configure(state="normal")
        self.generate_selected_btn.configure(state="normal")
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        # Use the actual view type that was generated, not just current_view
        save_view_name = view_type if view_type else self.current_view
        if save_view_name == "stage":
            save_view_name = "main"  # Save Main Stage generations as "main" view
        
        # Auto-save to ALL GENERATED IMAGES folder
        saved_filename = self.auto_save_generated_image(image, save_view_name, "generate")
        
        # Store the image - always save to "stage" for Main Stage renders
        if self.current_view == "stage" or view_type == "main":
            self.view_images["stage"] = image
            self.view_images["main"] = image  # Link both for consistency
            # Capture reference image and prompt for multi-view generation
            self.main_reference_image = image
            self.main_prompt_snapshot = self.build_character_description()
            self.main_character_description = self.main_prompt_snapshot
        else:
            self.view_images[self.current_view] = image
        self.current_image = image
        self.display_image(image, self.current_view)
        
        # Add this new base image to Image History (macro timeline)
        if saved_filename:
            # saved_filename is now the full path
            saved_path = Path(saved_filename)
            self.log_new_base_image(saved_path, label="Generated Character")
            
            # Set current edit base path for edit history tracking
            if self.current_view == "stage" or view_type == "main":
                self.current_edit_base_path = str(saved_path)
                self.update_edit_history_display(str(saved_path))
            
        # Enable save all button if we have any images
        if any(img is not None for img in self.view_images.values()):
            self.send_all_btn.configure(state="normal")
            
        # Track character creation in history
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.character_history.append(f"[{timestamp}] Generated {self.current_view} view")
        
        # Reset working state since this is now the most recent image
        self.working_state = {}
        
        self.log_event(f"Generated character image for {self.current_view} view.")
        self.status.set("Character concept generated successfully!")

    def on_generation_error(self, error: str):
        """Handle generation error."""
        self.generating = False
        self.generate_btn.configure(text="Generate Character", state="normal")
        
        # Close progress dialog
        if self.progress_dialog:
            self.progress_dialog.close()
            self.progress_dialog = None
        
        self.status.set(f"Generation failed: {error}")
        messagebox.showerror("Generation Error", f"Failed to generate character:\n{error}")


    def on_view_tab_changed(self, event):
        """Handle view tab change."""
        selected_tab = self.view_notebook.select()
        tab_index = self.view_notebook.index(selected_tab)
        view_names = ["stage", "front", "back", "side", "ref_a", "ref_b", "ref_c"]
        self.current_view = view_names[tab_index]
        
        # Update current_image to match selected view
        if self.view_images[self.current_view]:
            self.current_image = self.view_images[self.current_view]
        
        # Edit prompt text is shared across all views - do not clear or sync per-view
    
    def get_current_view_edit_prompt(self) -> str:
        """Get the edit prompt for the current view."""
        return self.view_edit_prompts.get(self.current_view, "")
    
    def send_to_main_stage(self, source_view):
        """Copy an existing view's image to the Main Stage."""
        if not self.view_images.get(source_view):
            messagebox.showinfo("No Image", f"No image found in {source_view} view.")
            return
        
        image = self.view_images[source_view]
        self.view_images["stage"] = image
        self.display_image(image, "stage")
        self.view_notebook.select(self.view_frames["stage"])
        
        self.status.set(f"Copied {source_view} view -> Main Stage.")
        self.log_event(f"Set {source_view} view as Main Stage reference.")
    
    def assign_stage_to_view(self, target_view):
        """Assign the current Main Stage image to a specific view tab."""
        image = self.view_images.get("stage")
        if not image:
            messagebox.showinfo("No Image", "No image in Main Stage to assign.")
            return
        
        self.view_images[target_view] = image
        self.display_image(image, target_view)
        
        self.status.set(f"Main Stage assigned as {target_view.capitalize()} view.")
        self.log_event(f"Assigned Main Stage -> {target_view} view.")

    def open_fullscreen_viewer(self, view_name):
        """Open fullscreen viewer for the specified view."""
        if view_name in self.view_images and self.view_images[view_name]:
            # Get the original PIL image
            pil_image = self.view_images[view_name]
            # Open fullscreen viewer
            FullScreenImageViewer(self.root, pil_image)
        else:
            messagebox.showinfo("No Image", f"No {view_name} view has been generated yet.")
            
    def _view_reset_state(self, view_name: str):
        self.view_zoom[view_name] = 1.0
        self.view_offset[view_name] = [0, 0]
        self.view_last_pos[view_name] = None
        self.view_drag_update_pending[view_name] = False

    def _view_update_display(self, view_name: str, image=None, force_update: bool = True):
        canvas = self.view_canvases.get(view_name)
        if not canvas:
            return

        if image is None:
            image = self.view_images.get(view_name)

        canvas.delete("all")

        if image is None:
            cw = canvas.winfo_width() or 800
            ch = canvas.winfo_height() or 600
            canvas.create_text(
                cw // 2,
                ch // 2,
                text=f"No {view_name} image loaded",
                fill="#B0B0B0",
                font=("Segoe UI", 12, "italic")
            )
            canvas.image = None
            if force_update:
                canvas.update_idletasks()
            return

        cw = canvas.winfo_width() or 800
        ch = canvas.winfo_height() or 600

        img_width, img_height = image.size
        if img_width == 0 or img_height == 0:
            return

        base_scale = min(cw / img_width, ch / img_height)
        zoom = self.view_zoom.get(view_name, 1.0)
        scale = base_scale * zoom

        new_width = max(1, int(img_width * scale))
        new_height = max(1, int(img_height * scale))

        display_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        tk_image = ImageTk.PhotoImage(display_image, master=canvas)
        self.view_tk_image[view_name] = tk_image

        ox, oy = self.view_offset.get(view_name, [0, 0])
        cx = (cw // 2) + ox
        cy = (ch // 2) + oy

        canvas.create_image(cx, cy, image=tk_image, anchor="center")

        canvas.create_rectangle(6, 6, 340, 32, fill="#111111", outline="")
        canvas.create_text(
            12, 18,
            text="Scroll: Zoom  |  Drag: Pan  |  Right-click: Options",
            fill="#FFFFFF",
            font=("Segoe UI", 9, "bold"),
            anchor="w"
        )

        res_text = f"{img_width} \u00d7 {img_height}"
        canvas.create_rectangle(4, ch - 24, len(res_text) * 7 + 18, ch - 4, fill="#111111", outline="")
        canvas.create_text(10, ch - 14, text=res_text, fill="#CCCCCC",
                           font=("Consolas", 9), anchor="w")

        if force_update:
            canvas.update_idletasks()

    def _view_zoom_factor(self, view_name: str, factor: float):
        z = self.view_zoom.get(view_name, 1.0) * factor
        z = max(0.1, min(z, 12.0))
        self.view_zoom[view_name] = z
        self._view_update_display(view_name, force_update=False)

    def _view_on_scroll(self, view_name: str, event):
        try:
            delta = event.delta
        except AttributeError:
            delta = 120 if getattr(event, "num", None) == 4 else -120
        factor = 1.1 if delta > 0 else 0.9
        self._view_zoom_factor(view_name, factor)
        return "break"  # Prevent scroll from propagating to parent widgets

    def _view_on_press(self, view_name: str, event):
        self.view_last_pos[view_name] = (event.x, event.y)
        self.root.config(cursor="fleur")

    def _view_do_drag_update(self, view_name: str):
        self._view_update_display(view_name, force_update=False)
        self.view_drag_update_pending[view_name] = False

    def _view_on_drag(self, view_name: str, event):
        last = self.view_last_pos.get(view_name)
        if last:
            dx = event.x - last[0]
            dy = event.y - last[1]
            off = self.view_offset.get(view_name, [0, 0])
            off[0] += dx
            off[1] += dy
            self.view_offset[view_name] = off
            self.view_last_pos[view_name] = (event.x, event.y)
            if not self.view_drag_update_pending.get(view_name, False):
                self.view_drag_update_pending[view_name] = True
                self.root.after(16, lambda vn=view_name: self._view_do_drag_update(vn))

    def _view_on_release(self, view_name: str, event):
        self.view_last_pos[view_name] = None
        self.root.config(cursor="")
        self.view_drag_update_pending[view_name] = False
        self._view_update_display(view_name, force_update=True)

    def _view_reset_view(self, view_name: str):
        self._view_reset_state(view_name)
        self._view_update_display(view_name)
        self.status.set(f"🔍 {view_name.capitalize()} view reset.")

    def clear_reference_image(self, view_name: str) -> None:
        """Clear the reference image from Ref A / Ref B / Ref C so it is not used in generation."""
        if view_name not in ("ref_a", "ref_b", "ref_c"):
            return
        
        # Clear stored PIL image
        self.view_images[view_name] = None
        
        # Clear the canvas visuals
        canvas = self.view_canvases.get(view_name)
        if canvas is not None:
            canvas.delete("all")
            self.view_tk_image[view_name] = None
            # Show placeholder text
            cw = canvas.winfo_width() or 800
            ch = canvas.winfo_height() or 600
            display_name = {"ref_a": "Ref A", "ref_b": "Ref B", "ref_c": "Ref C"}.get(view_name, view_name)
            canvas.create_text(
                cw // 2, ch // 2,
                text=f"No {display_name} image loaded\nPaste or load an image to use as reference",
                fill="#888888",
                font=("Segoe UI", 11, "italic"),
                justify="center"
            )
        
        # Reset zoom/pan state
        self._view_reset_state(view_name)
        
        # Update status bar
        display_name = {"ref_a": "Ref A", "ref_b": "Ref B", "ref_c": "Ref C"}.get(view_name, view_name)
        self.status.set(f"🗑️ Cleared reference image for {display_name}.")
        self.log_event(f"Cleared reference image: {display_name}")

    def _view_show_context_menu(self, view_name, event):
        """Display the context menu for a secondary view."""
        menu = self.view_context_menu.get(view_name)
        if not menu:
            return
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()
    
    def _on_canvas_paste(self, event, view_name):
        """Handle Ctrl+V paste on a view canvas."""
        self.paste_image_from_clipboard(view_name)
        return "break"
    
    def paste_image_from_clipboard(self, target_view: Optional[str] = None) -> bool:
        """Paste an image from the clipboard into the specified view."""
        if target_view is None:
            target_view = self.current_view or "stage"
        
        # Normalize main stage identifiers
        if target_view == "main":
            target_view = "stage"
        
        pasted = None
        try:
            # 1) Try win32clipboard for PNG/DIB first (with retries and multi-format support)
            if sys.platform == "win32":
                try:
                    import win32clipboard, win32con
                    import time
                    
                    for _ in range(5):
                        try:
                            win32clipboard.OpenClipboard()
                            try:
                                # Try PNG first (higher fidelity)
                                for fmt_name in ["PNG", "Portable Network Graphics"]:
                                    try:
                                        png_fmt = win32clipboard.RegisterClipboardFormat(fmt_name)
                                        if win32clipboard.IsClipboardFormatAvailable(png_fmt):
                                            data = win32clipboard.GetClipboardData(png_fmt)
                                            if isinstance(data, bytes):
                                                pasted = Image.open(io.BytesIO(data))
                                                break
                                    except Exception:
                                        continue
                                
                                # Fallback to DIB
                                if pasted is None and win32clipboard.IsClipboardFormatAvailable(win32con.CF_DIB):
                                    data = win32clipboard.GetClipboardData(win32con.CF_DIB)
                                    if isinstance(data, bytes):
                                        header_size = int.from_bytes(data[0:4], "little") if len(data) >= 4 else 40
                                        off_bits = 14 + header_size
                                        bmp_header = b"BM" + (len(data) + 14).to_bytes(4, "little") + b"\x00\x00\x00\x00" + off_bits.to_bytes(4, "little")
                                        pasted = Image.open(io.BytesIO(bmp_header + data))
                            finally:
                                win32clipboard.CloseClipboard()
                            
                            if pasted:
                                break
                        except Exception:
                            time.sleep(0.05)
                except Exception as e:
                    print(f"[DEBUG] win32clipboard error: {e}")
            
            # 2) Fallback to standard ImageGrab
            if pasted is None:
                grabbed = ImageGrab.grabclipboard()
                if isinstance(grabbed, Image.Image):
                    pasted = grabbed
                elif isinstance(grabbed, (list, tuple)) and grabbed:
                    try:
                        path = str(grabbed[0])
                        if os.path.exists(path):
                            pasted = Image.open(path)
                    except Exception:
                        pass
        except Exception as e:
            print(f"[DEBUG] Clipboard access error: {e}")
        
        if pasted is None:
            messagebox.showinfo("No Image", "Clipboard does not contain a valid image or file path.")
            return False
        
        pasted = pasted.convert("RGBA")
        display_name = VIEW_DISPLAY_NAMES.get(target_view, target_view.title())
        
        if target_view == "stage":
            self.view_images["stage"] = pasted
            self.view_images["main"] = pasted  # Link both for consistency
            self.current_view = "stage"
            self.current_image = pasted
            
            # Set canonical reference state so edits and ortho generation work
            self.main_reference_image = pasted
            self.main_character_description = self.build_character_description() or "Character from pasted image"
            self.main_prompt_snapshot = self.main_character_description
            
            # Cache the original pasted image so user can revert to it in edit history
            self.pasted_image_cache = pasted.copy()
            
            # Track edit base path for pasted images
            self.current_edit_base_path = "pasted_image"
            self.update_edit_history_display("pasted_image")
            
            self.display_image(pasted, "stage")
            self.generate_all_btn.configure(state="normal")
            self.generate_selected_btn.configure(state="normal")
            self.send_all_btn.configure(state="normal")
            self.status.set("✅ Pasted image into Main Stage from clipboard.")
            try:
                self.log_event("Pasted image into Main Stage from clipboard.")
            except Exception:
                pass
        else:
            self.view_images[target_view] = pasted
            self.current_view = target_view
            self.current_image = pasted
            self.display_image(pasted, target_view)
            if any(img is not None for img in self.view_images.values()):
                self.send_all_btn.configure(state="normal")
            self.status.set(f"✅ Pasted image into {display_name} view from clipboard.")
            try:
                self.log_event(f"Pasted image into {display_name} view from clipboard.")
            except Exception:
                pass
        
        return True

    def open_image_file_for_view(self, view_name: str) -> None:
        """Let the user pick an image file from disk and load it into the given view."""
        # Normalize main stage identifiers
        if view_name == "main":
            view_name = "stage"

        filetypes = [
            ("Image files", "*.png *.jpg *.jpeg *.webp *.bmp"),
            ("All files", "*.*"),
        ]
        
        path = filedialog.askopenfilename(
            title="Open Image",
            filetypes=filetypes,
        )
        if not path:
            return  # user cancelled
        
        try:
            img = Image.open(path).convert("RGBA")
        except Exception as e:
            messagebox.showerror("Open Error", f"Failed to open image:\n{e}")
            return
        
        display_name = VIEW_DISPLAY_NAMES.get(view_name, view_name.replace("_", " ").title())
        
        # Use same logic as paste to set the image into the view
        if view_name == "stage":
            self.view_images["stage"] = img
            self.view_images["main"] = img  # Link both for consistency
            self.current_view = "stage"
            self.current_image = img
            
            # Set canonical reference state so edits and ortho generation work
            self.main_reference_image = img
            self.main_character_description = self.build_character_description() or "Character from loaded image"
            self.main_prompt_snapshot = self.main_character_description
            
            # Track edit base path for loaded images
            self.current_edit_base_path = str(path)
            self.update_edit_history_display(str(path))
            
            self.display_image(img, "stage")
            self.generate_all_btn.configure(state="normal")
            self.generate_selected_btn.configure(state="normal")
            self.send_all_btn.configure(state="normal")
        else:
            self.view_images[view_name] = img
            self.current_view = view_name
            self.current_image = img
            self.display_image(img, view_name)
            if any(im is not None for im in self.view_images.values()):
                self.send_all_btn.configure(state="normal")
        
        filename = Path(path).name
        self.status.set(f"📂 Loaded {filename} into {display_name}.")
        try:
            self.log_event(f"Opened image file into {display_name}: {filename}")
        except Exception:
            pass

    def _view_save_image(self, view_name):
        image = self.view_images.get(view_name)
        if image is None:
            display_name = VIEW_DISPLAY_NAMES.get(view_name, view_name.title())
            messagebox.showwarning("No Image", f"No {display_name.lower()} image to save.")
            return
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        default_filename = f"{view_name}_{timestamp}.png"
        path = filedialog.asksaveasfilename(
            title=f"Save {view_name.title()} Image",
            defaultextension=".png",
            initialfile=default_filename,
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        if not path:
            return
        try:
            image.save(path)
            display_name = VIEW_DISPLAY_NAMES.get(view_name, view_name.title())
            self.status.set(f"Saved {display_name} to {Path(path).name}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Could not save image:\n{e}")

    def _view_copy_image(self, view_name):
        image = self.view_images.get(view_name)
        if image is None:
            display_name = VIEW_DISPLAY_NAMES.get(view_name, view_name.title())
            self.status.set(f"No {display_name.lower()} image to copy.")
            return
        try:
            import win32clipboard  # type: ignore
            import win32con  # type: ignore
            import time
            
            # Prepare DIB data (standard BMP without file header)
            output = io.BytesIO()
            image.convert("RGB").save(output, "BMP")
            dib_data = output.getvalue()[14:]
            output.close()
            
            # Prepare PNG data (modern format support)
            png_output = io.BytesIO()
            image.save(png_output, "PNG")
            png_data = png_output.getvalue()
            png_output.close()
            
            # Attempt to open clipboard with retries
            for _ in range(5):
                try:
                    win32clipboard.OpenClipboard()
                    win32clipboard.EmptyClipboard()
                    
                    # Set standard DIB for wide compatibility
                    win32clipboard.SetClipboardData(win32con.CF_DIB, dib_data)
                    
                    # Set PNG for higher fidelity/alpha support in modern apps
                    for fmt_name in ["PNG", "Portable Network Graphics"]:
                        try:
                            png_fmt = win32clipboard.RegisterClipboardFormat(fmt_name)
                            win32clipboard.SetClipboardData(png_fmt, png_data)
                        except Exception:
                            continue
                        
                    win32clipboard.CloseClipboard()
                    
                    display_name = VIEW_DISPLAY_NAMES.get(view_name, view_name.title())
                    self.status.set(f"✅ {display_name} image copied to clipboard (DIB + PNG).")
                    return
                except Exception:
                    try: win32clipboard.CloseClipboard()
                    except: pass
                    time.sleep(0.05)
                    
        except Exception as e:
            print(f"[DEBUG] win32 copy failed: {e}")
        
        try:
            temp_path = Path(app_data_path(f"temp_{view_name}_clipboard.png"))
            image.save(temp_path, "PNG")
            display_name = VIEW_DISPLAY_NAMES.get(view_name, view_name.title())
            self.status.set(f"Clipboard copy unavailable. Saved to {temp_path.name}")
        except Exception as e:
            self.status.set(f"Clipboard copy failed: {e}")
    
    # --- Main Stage viewer helpers -------------------------------------------------
    def _stage_clear_display(self, message="No main stage image loaded"):
        if not self.stage_canvas:
            return
        self.stage_zoom = 1.0
        self.stage_offset = [0, 0]
        self.stage_last_pos = None
        self.stage_canvas.delete("all")
        cw = self.stage_canvas.winfo_width() or 800
        ch = self.stage_canvas.winfo_height() or 600
        self.stage_canvas.create_text(
            cw // 2,
            ch // 2,
            text=message,
            fill="#B0B0B0",
            font=("Segoe UI", 12, "italic")
        )
        self.stage_canvas.image = None

    def _stage_update_display(self, image=None, force_update=True):
        if not self.stage_canvas:
            return
        if image is None:
            image = self.view_images.get("stage")
        canvas = self.stage_canvas
        canvas.delete("all")
        if image is None:
            self._stage_clear_display()
            if force_update:
                canvas.update_idletasks()
            return

        cw = canvas.winfo_width() or 800
        ch = canvas.winfo_height() or 600

        img_width, img_height = image.size
        if img_width == 0 or img_height == 0:
            return

        base_scale = min(cw / img_width, ch / img_height)
        scale = base_scale * self.stage_zoom
        new_width = max(1, int(img_width * scale))
        new_height = max(1, int(img_height * scale))

        display_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        self.stage_tk_image = ImageTk.PhotoImage(display_image, master=canvas)

        cx = (cw // 2) + self.stage_offset[0]
        cy = (ch // 2) + self.stage_offset[1]
        canvas.create_image(cx, cy, image=self.stage_tk_image, anchor="center")

        # Overlay helper text
        canvas.create_rectangle(6, 6, 340, 32, fill="#111111", outline="")
        canvas.create_text(
            12, 18,
            text="Scroll: Zoom  |  Drag: Pan  |  Right-click: Options",
            fill="#FFFFFF",
            font=("Segoe UI", 9, "bold"),
            anchor="w"
        )

        res_text = f"{img_width} \u00d7 {img_height}"
        canvas.create_rectangle(4, ch - 24, len(res_text) * 7 + 18, ch - 4, fill="#111111", outline="")
        canvas.create_text(10, ch - 14, text=res_text, fill="#CCCCCC",
                           font=("Consolas", 9), anchor="w")

        if force_update:
            canvas.update_idletasks()

    def _stage_zoom(self, factor):
        self.stage_zoom = max(0.1, min(self.stage_zoom * factor, 12.0))
        self._stage_update_display(force_update=False)

    def _stage_on_scroll(self, event):
        try:
            delta = event.delta
        except AttributeError:
            delta = 120 if event.num == 4 else -120
        factor = 1.1 if delta > 0 else 0.9
        self._stage_zoom(factor)
        return "break"  # Prevent scroll from propagating to parent widgets

    def _stage_on_press(self, event):
        self.stage_last_pos = (event.x, event.y)
        self.root.config(cursor="fleur")

    def _stage_on_drag(self, event):
        if self.stage_last_pos:
            dx = event.x - self.stage_last_pos[0]
            dy = event.y - self.stage_last_pos[1]
            self.stage_offset[0] += dx
            self.stage_offset[1] += dy
            self.stage_last_pos = (event.x, event.y)
            if not self.stage_drag_update_pending:
                self.stage_drag_update_pending = True
                self.root.after(16, self._stage_do_drag_update)

    def _stage_do_drag_update(self):
        self._stage_update_display(force_update=False)
        self.stage_drag_update_pending = False

    def _stage_on_release(self, event):
        self.stage_last_pos = None
        self.root.config(cursor="")
        self.stage_drag_update_pending = False
        self._stage_update_display(force_update=True)

    def _stage_reset_view(self):
        self.stage_zoom = 1.0
        self.stage_offset = [0, 0]
        self.stage_last_pos = None
        self._stage_update_display()
        self.status.set("🔍 Main Stage view reset.")

    def _stage_show_context_menu(self, event):
        if not self.stage_context_menu:
            return
        try:
            self.stage_context_menu.tk_popup(event.x_root, event.y_root)
        finally:
            self.stage_context_menu.grab_release()

    def _stage_copy_image(self):
        image = self.view_images.get("stage")
        if image is None:
            self.status.set("No Main Stage image to copy.")
            return
        try:
            import win32clipboard  # type: ignore
            import win32con  # type: ignore
            import time
            
            # Prepare DIB data
            output = io.BytesIO()
            image.convert("RGB").save(output, "BMP")
            dib_data = output.getvalue()[14:]
            output.close()
            
            # Prepare PNG data
            png_output = io.BytesIO()
            image.save(png_output, "PNG")
            png_data = png_output.getvalue()
            png_output.close()
            
            # Attempt to open clipboard with retries
            for _ in range(5):
                try:
                    win32clipboard.OpenClipboard()
                    win32clipboard.EmptyClipboard()
                    
                    # Set standard DIB
                    win32clipboard.SetClipboardData(win32con.CF_DIB, dib_data)
                    
                    # Set PNG for higher fidelity
                    try:
                        png_fmt = win32clipboard.RegisterClipboardFormat("PNG")
                        win32clipboard.SetClipboardData(png_fmt, png_data)
                    except Exception:
                        pass
                        
                    win32clipboard.CloseClipboard()
                    self.status.set("✅ Main Stage image copied to clipboard (DIB + PNG).")
                    return
                except Exception:
                    try: win32clipboard.CloseClipboard()
                    except: pass
                    time.sleep(0.05)
                    
        except Exception as e:
            print(f"[DEBUG] Stage copy failed: {e}")

        try:
            temp_path = Path(app_data_path("temp_clipboard.png"))
            image.save(temp_path, "PNG")
            self.status.set(f"Clipboard copy unavailable. Saved to {temp_path.name}")
        except Exception as e:
            self.status.set(f"Clipboard copy failed: {e}")

    def _stage_save_image(self):
        image = self.view_images.get("stage")
        if image is None:
            messagebox.showwarning("No Image", "No Main Stage image to save.")
            return
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        default_filename = f"main_stage_{timestamp}.png"
        path = filedialog.asksaveasfilename(
            title="Save Main Stage Image",
            defaultextension=".png",
            initialfile=default_filename,
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        if not path:
            return
        try:
            image.save(path)
            self.status.set(f"Saved Main Stage to {Path(path).name}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Could not save image:\n{e}")

    def _stage_paste_image(self):
        self.paste_image_from_clipboard("stage")

    def display_image(self, image, view_name: str):
        """Display an image in the specified view tab, showing full extent."""
        # Normalize main stage identifiers
        if view_name == "main":
            view_name = "stage"

        if view_name == "stage":
            if image is None:
                self._stage_clear_display()
            else:
                self.stage_zoom = 1.0
                self.stage_offset = [0, 0]
                self.stage_last_pos = None
                self._stage_update_display(image=image)
            return

        # Non-stage views: use shared canvas-based zoom/pan logic
        self.view_images[view_name] = image
        if view_name not in self.view_zoom:
            self._view_reset_state(view_name)
        self._view_update_display(view_name, image=image)

    def generate_all_views(self):
        """Generate all ortho views (front, back, side) using Main Stage (3/4) as the single source of truth."""
        if self.generating:
            return

        # REQUIRE frozen Main Stage reference
        if self.main_reference_image is None:
            messagebox.showwarning("No Main Stage Image", "Generate, load, or paste a Main Stage image first.")
            return

        # Use FROZEN description - fallback once if somehow empty
        base_description = self.main_character_description.strip()
        if not base_description:
            base_description = self.build_character_description().strip()
            self.main_character_description = base_description
        
        reference_image = self.main_reference_image

        # Pre-fetch Tkinter values for thread safety
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        self.generate_all_btn.configure(text="Generating All Views...", state="disabled")
        self.generate_selected_btn.configure(state="disabled")
        self.progress.start()
        self.status.set("Generating all ortho views from Main Stage (3/4)...")
        self._show_ai_progress("Generating Views", "Generating all views from Main Stage...")

        # Generate front, back, side views - Main Stage already has 3/4 view
        views_to_generate = ["front", "back", "side"]

        def worker():
            try:
                for view in views_to_generate:
                    try:
                        self.root.after(0, lambda v=view: self.status.set(f"Generating {v} view from Main Stage..."))
                        self.root.after(0, lambda v=view: self._update_ai_progress(f"Rendering {v} view..."))
                        print(f"DEBUG: Starting {view} view generation (reference image: {reference_image.size if reference_image else 'None'})")
                        img = self.gemini_client.generate_character(
                            character_description=base_description,
                            width=1536,
                            height=2816,
                            reference_image=reference_image,  # ALWAYS frozen Main Stage
                            edit_prompt=None,
                            view_type=view,
                            use_valor_lore=use_valor_lore
                        )
                        if img:
                            print(f"DEBUG: Successfully generated {view} view ({img.size})")
                            self.view_images[view] = img
                            self.root.after(0, lambda v=view, im=img: self.display_image(im, v))
                        else:
                            print(f"DEBUG: {view} view returned None")
                    except Exception as e:
                        import traceback
                        print(f"ERROR: Failed to generate {view} view: {e}")
                        traceback.print_exc()
            finally:
                self.root.after(0, self._on_generate_all_views_done)

        threading.Thread(target=worker, daemon=True).start()

    def _on_generate_all_views_done(self):
        self.generating = False
        self.generate_all_btn.configure(text="Generate All Views", state="normal")
        self.generate_selected_btn.configure(state="normal")
        self.progress.stop()
        self._close_ai_progress()
        self.status.set("All views updated from Main Stage.")

    def generate_selected_view(self):
        """Generate or edit ONLY the current view, always based on frozen Main Stage reference."""
        if self.generating:
            return

        # Block regenerating main/stage via this function
        if self.current_view in ("main", "stage"):
            messagebox.showinfo("Use Main Generate", "Use 'Generate Character' to regenerate the Main Stage view.")
            return

        # REQUIRE frozen Main Stage reference
        if self.main_reference_image is None:
            messagebox.showwarning("No Main Stage Image", "Generate, load, or paste a Main Stage image first.")
            return

        # Use FROZEN description - fallback once if somehow empty
        base_description = self.main_character_description.strip()
        if not base_description:
            base_description = self.build_character_description().strip()
            self.main_character_description = base_description
        
        reference_image = self.main_reference_image
        
        # Get edit prompt for this view (optional text edits)
        edit_prompt = self.get_current_view_edit_prompt().strip() or None

        if edit_prompt:
            action = "Editing"
            status_msg = f"Applying changes to {self.current_view} view (based on Main Stage)."
        else:
            action = "Regenerating"
            status_msg = f"Regenerating {self.current_view} view from Main Stage."

        # Pre-fetch ref images for thread safety
        ref_a = self.view_images.get("ref_a")
        ref_b = self.view_images.get("ref_b")
        ref_c = self.view_images.get("ref_c")
        use_valor_lore = self.valor_lore_var.get()

        self.generating = True
        self.generate_selected_btn.configure(text=f"{action}...", state="disabled")
        self.generate_all_btn.configure(state="disabled")
        self.progress.start()
        self.status.set(status_msg)
        self._show_ai_progress("Generating View", status_msg)

        current_view = self.current_view

        def worker():
            try:
                # Pass Ref A/B images - they will only be used if mentioned in the edit_prompt
                img = self.gemini_client.generate_character(
                    character_description=base_description,
                    width=1536,
                    height=2816,
                    reference_image=reference_image,  # ALWAYS frozen Main Stage
                    edit_prompt=edit_prompt,
                    view_type=current_view,
                    use_valor_lore=use_valor_lore,
                    ref_a_image=ref_a,
                    ref_b_image=ref_b,
                    ref_c_image=ref_c
                )
                if img:
                    self.view_images[current_view] = img
                    self.root.after(0, lambda: self.display_image(img, current_view))
            finally:
                self.root.after(0, self._on_generate_selected_done)

        threading.Thread(target=worker, daemon=True).start()

    def _on_generate_selected_done(self):
        self.generating = False
        self.generate_selected_btn.configure(text="Generate Selected View", state="normal")
        self.generate_all_btn.configure(state="normal")
        self.progress.stop()
        self._close_ai_progress()
        self.status.set("Selected view updated from Main Stage.")

    def on_all_views_complete(self):
        """Handle completion of all views generation."""
        self.generating = False
        self.generate_all_btn.configure(text="Generate All Views", state="normal")
        self.generate_selected_btn.configure(state="normal")
        self.send_all_btn.configure(state="normal")
        self.progress.stop()
        self.status.set("All character views generated successfully!")

    def on_selected_view_complete(self):
        """Handle completion of selected view generation."""
        self.generating = False
        self.generate_selected_btn.configure(text="Generate Selected View", state="normal")
        self.generate_all_btn.configure(state="normal")
        self.send_all_btn.configure(state="normal")
        self.progress.stop()
        self.status.set(f"{self.current_view.title()} view generated successfully!")

    def save_current_image(self):
        """Save the currently displayed image with smart overwrite/versioning logic."""
        if self.current_image is None:
            messagebox.showinfo("No Image", "No image to save in current view.")
            return
        
        # If no character folder exists, prompt for character name
        if self.current_character_folder is None:
            char_name = simpledialog.askstring(
                "Save Character", 
                "Enter character name:",
                parent=self.root
            )
            
            if not char_name or not char_name.strip():
                return  # User cancelled
            
            # Sanitize name
            import re
            char_name = re.sub(r'[<>:"/\\|?*]', '_', char_name.strip())
            
            # Create character folder under IMAGES/
            images_dir = Path(app_data_path("IMAGES"))
            images_dir.mkdir(exist_ok=True)
            
            char_folder = images_dir / char_name
            char_folder.mkdir(parents=True, exist_ok=True)
            
            self.current_character_folder = char_folder
            self.current_character_name = char_name
        
        # Use existing character folder
        char_folder = self.current_character_folder
        char_name = getattr(self, 'current_character_name', char_folder.name)
        
        # Determine view suffix
        view_names = {"stage": "stage", "main": "main", "front": "front", "back": "back", "side": "side"}
        view_suffix = view_names.get(self.current_view, self.current_view)
        
        # Create base filename
        base_filename = char_folder / f"{char_name}_{view_suffix}.png"
        final_save_path = base_filename
        
        try:
            # Check if file already exists - prompt for overwrite or version
            if base_filename.exists():
                response = messagebox.askyesnocancel(
                    "File Exists",
                    f"A save already exists for this character.\n\n"
                    f"Yes = Overwrite existing file\n"
                    f"No = Save as new version\n"
                    f"Cancel = Abort save",
                    icon="question"
                )
                
                if response is None:
                    # User clicked Cancel
                    self.status.set("Save cancelled")
                    return
                elif not response:
                    # User chose No - save as new version
                    version_folder = char_folder / "Previous Versions"
                    version_folder.mkdir(exist_ok=True)
                    
                    # Find next version number
                    existing_versions = list(version_folder.glob(f"{char_name}_{view_suffix}_v*.png"))
                    if existing_versions:
                        version_numbers = []
                        for vf in existing_versions:
                            import re
                            match = re.search(r'_v(\d+)\.png$', vf.name)
                            if match:
                                version_numbers.append(int(match.group(1)))
                        next_version = max(version_numbers) + 1 if version_numbers else 2
                    else:
                        next_version = 2
                    
                    final_save_path = version_folder / f"{char_name}_{view_suffix}_v{next_version}.png"
                    self.log_event(f"Saving as new version: v{next_version}")
                else:
                    # User chose Yes - overwrite existing
                    # Move old version to Previous Versions
                    previous_dir = char_folder / "Previous Versions"
                    previous_dir.mkdir(exist_ok=True)
                    
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    backup_name = f"{char_name}_{view_suffix}_{timestamp}.png"
                    shutil.move(str(base_filename), str(previous_dir / backup_name))
                    self.log_event(f"Archived previous version to: Previous Versions/{backup_name}")
            
            # Save the image
            self.current_image.save(final_save_path, format="PNG")
            
            # Save prompt history
            prompt_file = self.save_prompt_history(char_folder, char_name, view_suffix)
            if prompt_file:
                self.log_event(f"Saved prompt history: {prompt_file.name}")
            
            self.log_event(f"Saved {self.current_view} view image: {final_save_path.name}")
            self.status.set(f"Character saved: {char_name}/{final_save_path.name}")
            
            messagebox.showinfo(
                "Save Complete",
                f"Saved to: {char_folder.name}/\n\n"
                f"Image: {final_save_path.name}\n"
                f"History: {prompt_file.name if prompt_file else 'N/A'}"
            )
            
        except Exception as e:
            self.log_event(f"Failed to save image: {e}")
            messagebox.showerror("Save Error", f"Could not save image:\n{e}")

    def _send_image_to_photoshop(self, image: Image.Image, label: str):
        """Save image to temp folder and open in Photoshop."""
        try:
            import tempfile
            import subprocess
            import os
            from pathlib import Path
            
            # Create temporary file
            temp_dir = tempfile.gettempdir()
            temp_filename = f"AI_Character_{label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            temp_path = Path(temp_dir) / temp_filename
            
            # Save image to temp location
            image.save(temp_path)
            
            # Try to find and launch Photoshop
            photoshop_paths = [
                # Common Photoshop installation paths
                "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
                "C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe", 
                "C:\\Program Files\\Adobe\\Adobe Photoshop 2022\\Photoshop.exe",
                "C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe",
                "C:\\Program Files\\Adobe\\Adobe Photoshop CC 2018\\Photoshop.exe",
                "C:\\Program Files (x86)\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
                "C:\\Program Files (x86)\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe",
                "C:\\Program Files (x86)\\Adobe\\Adobe Photoshop 2022\\Photoshop.exe",
            ]
            
            photoshop_exe = None
            for path in photoshop_paths:
                if Path(path).exists():
                    photoshop_exe = path
                    break
            
            if photoshop_exe:
                # Launch Photoshop with the image
                subprocess.Popen([photoshop_exe, str(temp_path)], shell=False)
                self.status.set(f"Sent {label} view to Photoshop: {temp_filename}")
            else:
                # Photoshop not found, try to open with default image editor
                try:
                    os.startfile(str(temp_path))
                    self.status.set(f"Opened {label} view with default image editor: {temp_filename}")
                except Exception:
                    self.status.set(f"Could not open image. Saved to: {temp_path}")
        except Exception as e:
            self.status.set(f"Could not send {label} to Photoshop: {e}")

    def send_to_photoshop(self):
        """Send current view image to Photoshop."""
        if self.current_image is None:
            self.status.set("No image to send to Photoshop in current view.")
            return
        self._send_image_to_photoshop(self.current_image, self.current_view)

    def send_all_to_photoshop(self):
        """Send Main, Front, Back, and Side views to Photoshop."""
        main_image = self.view_images.get("main") or self.view_images.get("stage")
        view_order = [
            ("main", main_image),
            ("front", self.view_images.get("front")),
            ("back", self.view_images.get("back")),
            ("side", self.view_images.get("side")),
        ]
        
        sent_any = False
        for label, image in view_order:
            if image is not None:
                self._send_image_to_photoshop(image, label)
                sent_any = True
        
        if not sent_any:
            self.status.set("No Main/Front/Back/Side images to send to Photoshop.")

    def save_all_views(self):
        """Save all generated views with character folder system and prompt histories."""
        # Check if we have any images to save
        if not any(self.view_images.values()):
            messagebox.showwarning("No Images", "No generated views to save.")
            return
        
        # If no character folder exists, prompt for character name
        if self.current_character_folder is None:
            char_name = simpledialog.askstring(
                "Save All Views",
                "Enter character name:",
                parent=self.root
            )
            
            if not char_name or not char_name.strip():
                return  # User cancelled
            
            # Sanitize name
            import re
            char_name = re.sub(r'[<>:"/\\|?*]', '_', char_name.strip())
            
            # Create character folder under IMAGES/
            images_dir = Path(app_data_path("IMAGES"))
            images_dir.mkdir(exist_ok=True)
            
            char_folder = images_dir / char_name
            char_folder.mkdir(parents=True, exist_ok=True)
            
            self.current_character_folder = char_folder
            self.current_character_name = char_name
        else:
            # Use existing character folder
            char_folder = self.current_character_folder
            char_name = getattr(self, 'current_character_name', char_folder.name)
        
        saved_count = 0
        view_names = {"stage": "stage", "main": "main", "front": "front", "back": "back", "side": "side"}
        
        # Save each view
        for view_name, image in self.view_images.items():
            if image is not None:
                try:
                    view_suffix = view_names.get(view_name, view_name)
                    image_filename = char_folder / f"{char_name}_{view_suffix}.png"
                    
                    # Archive previous version if it exists
                    if image_filename.exists():
                        previous_dir = char_folder / "Previous Images"
                        previous_dir.mkdir(exist_ok=True)
                        
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        backup_name = f"{char_name}_{view_suffix}_{timestamp}.png"
                        shutil.move(str(image_filename), str(previous_dir / backup_name))
                        self.log_event(f"Archived previous {view_name} to: Previous Images/{backup_name}")
                    
                    # Save image
                    image.save(image_filename)
                    
                    # Save prompt history for this view
                    prompt_file = self.save_prompt_history(char_folder, char_name, view_suffix)
                    if prompt_file:
                        self.log_event(f"Saved prompt history: {prompt_file.name}")
                    
                    saved_count += 1
                    
                except Exception as e:
                    print(f"Failed to save {view_name} view: {e}")
                    self.log_event(f"Failed to save {view_name} view: {e}")
        
        if saved_count > 0:
            self.log_event(f"Saved {saved_count} views to: {char_folder.name}")
            self.status.set(f"Saved {saved_count} views to: {char_folder.name}")
            messagebox.showinfo(
                "Save Complete", 
                f"Saved {saved_count} character views to:\n{char_folder.name}/\n\n"
                f"Each view has its own prompt history file."
            )
        else:
            self.log_event("Failed to save views.")
            messagebox.showwarning("Save Failed", "Failed to save views.")

    def show_xml(self):
        """Display the character configuration as XML."""
        xml_content = self.generate_xml()
        
        # Create XML display window
        xml_window = tk.Toplevel(self.root)
        xml_window.title("Character XML Configuration")
        xml_window.geometry("800x600")
        xml_window.transient(self.root)
        
        # Center the window
        xml_window.update_idletasks()
        x = (xml_window.winfo_screenwidth() // 2) - (800 // 2)
        y = (xml_window.winfo_screenheight() // 2) - (600 // 2)
        xml_window.geometry(f"800x600+{x}+{y}")
        
        # Create main frame
        main_frame = ttk.Frame(xml_window, padding=10)
        main_frame.pack(fill="both", expand=True)
        
        # Instructions
        ttk.Label(main_frame, text="Character Configuration XML", font=("Segoe UI", 12, "bold")).pack(anchor="w", pady=(0, 10))
        
        # Text area with scrollbar
        text_frame = ttk.Frame(main_frame)
        text_frame.pack(fill="both", expand=True, pady=(0, 10))
        
        xml_text = tk.Text(text_frame, wrap="none", font=("Consolas", 9))
        v_scrollbar = ttk.Scrollbar(text_frame, orient="vertical", command=xml_text.yview)
        h_scrollbar = ttk.Scrollbar(text_frame, orient="horizontal", command=xml_text.xview)
        xml_text.configure(yscrollcommand=v_scrollbar.set, xscrollcommand=h_scrollbar.set)
        
        xml_text.grid(row=0, column=0, sticky="nsew")
        v_scrollbar.grid(row=0, column=1, sticky="ns")
        h_scrollbar.grid(row=1, column=0, sticky="ew")
        
        text_frame.grid_rowconfigure(0, weight=1)
        text_frame.grid_columnconfigure(0, weight=1)
        
        # Insert XML content
        xml_text.insert("1.0", xml_content)
        xml_text.config(state="normal")  # Keep editable for copying
        
        # Buttons
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(fill="x")
        
        def copy_xml():
            xml_window.clipboard_clear()
            xml_window.clipboard_append(xml_content)
            self.status.set("XML copied to clipboard!")
        
        def save_xml():
            filename = filedialog.asksaveasfilename(
                defaultextension=".xml",
                filetypes=[("XML files", "*.xml"), ("All files", "*.*")],
                title="Save Character XML"
            )
            if filename:
                try:
                    with open(filename, 'w', encoding='utf-8') as f:
                        f.write(xml_content)
                    self.status.set(f"XML saved: {filename}")
                except Exception as e:
                    messagebox.showerror("Save Error", f"Could not save XML:\n{e}")
        
        ttk.Button(button_frame, text="Copy to Clipboard", command=copy_xml).pack(side="left", padx=(0, 5))
        ttk.Button(button_frame, text="Save XML File", command=save_xml).pack(side="left", padx=5)
        ttk.Button(button_frame, text="Close", command=xml_window.destroy).pack(side="right")

    def generate_xml(self):
        """Generate XML representation of the character configuration."""
        import xml.etree.ElementTree as ET
        import xml.dom.minidom as minidom
        
        # Create root element
        root = ET.Element("CharacterConcept")
        
        # Character Identity
        identity = ET.SubElement(root, "Identity")
        ET.SubElement(identity, "Age").text = self.age_var.get() or "Not specified"
        ET.SubElement(identity, "Race").text = self.race_var.get() or "Not specified"
        ET.SubElement(identity, "Gender").text = self.gender_var.get() or "Not specified"
        ET.SubElement(identity, "Build").text = self.build_var.get() or "Not specified"
        
        # Character Description
        char_desc = self.get_character_description()
        if char_desc:
            ET.SubElement(identity, "Description").text = char_desc
        
        # Character Attributes
        attributes = ET.SubElement(root, "Attributes")
        for field_name, field_obj in self.fields.items():
            value = field_obj.get_value()
            if value:
                # Clean field name for XML element
                clean_name = field_name.replace(" ", "").replace("-", "")
                ET.SubElement(attributes, clean_name).text = value
        
        # Generation Info
        generation_info = ET.SubElement(root, "GenerationInfo")
        ET.SubElement(generation_info, "HasMainImage").text = "true" if self.view_images["main"] else "false"
        ET.SubElement(generation_info, "HasFrontView").text = "true" if self.view_images["front"] else "false"
        ET.SubElement(generation_info, "HasBackView").text = "true" if self.view_images["back"] else "false"
        ET.SubElement(generation_info, "HasSideView").text = "true" if self.view_images["side"] else "false"
        
        from datetime import datetime
        ET.SubElement(generation_info, "CreatedDate").text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Pretty print XML
        rough_string = ET.tostring(root, encoding='unicode')
        reparsed = minidom.parseString(rough_string)
        return reparsed.toprettyxml(indent="  ")

    def save_image(self):
        """Save the current image to file."""
        if self.current_image is None:
            messagebox.showinfo("No Image", "Generate a character first.")
            return
        
        filename = filedialog.asksaveasfilename(
            defaultextension=".png",
            filetypes=[("PNG files", "*.png"), ("JPEG files", "*.jpg"), ("All files", "*.*")],
            title="Save Character Image"
        )
        
        if filename:
            try:
                # Convert RGBA to RGB for JPEG
                if filename.lower().endswith(('.jpg', '.jpeg')):
                    rgb_image = Image.new("RGB", self.current_image.size, (255, 255, 255))
                    rgb_image.paste(self.current_image, mask=self.current_image.split()[-1] if self.current_image.mode == "RGBA" else None)
                    rgb_image.save(filename, quality=95)
                else:
                    self.current_image.save(filename)
                self.status.set(f"Image saved: {filename}")
            except Exception as e:
                messagebox.showerror("Save Error", f"Could not save image:\n{e}")

def main():
    root = tk.Tk()
    # Apply Photoshop-style dark theme
    try:
        from dark_theme import setup_dark_theme
        setup_dark_theme(root)
    except ImportError:
        # Fallback to basic theme if dark_theme module not found
        style = ttk.Style(root)
        try:
            style.theme_use("clam")
        except Exception:
            pass
    
    app = App(root)
    root.mainloop()

if __name__ == "__main__":
    main()
