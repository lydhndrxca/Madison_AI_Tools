#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations
import json
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import subprocess, platform, os, sys

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk
from dark_theme import DarkTheme, setup_dark_theme, configure_text_widget, configure_canvas_widget, add_hover_effect

APP_TITLE = "PUBG Madison AI Weapon Generator v2.0"

_BAKED_KEY = ""

_BASE_DIR = Path(__file__).resolve().parent
_DIST_ROOT = Path(sys.executable).parent if getattr(sys, "frozen", False) else _BASE_DIR
_SUITE_ROOT = Path(os.environ.get("PUBG_SUITE_ROOT") or _DIST_ROOT)
_EXTERNAL_ASSETS = Path(os.environ.get("PUBG_WEAPON_ASSETS_DIR", _SUITE_ROOT / "Add or Remove Gun Images Here"))
ASSETS_DIR = _EXTERNAL_ASSETS if _EXTERNAL_ASSETS.exists() else (_BASE_DIR / "assets" / "reference_guns")
_DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "IMAGES" / "ALL GENERATED IMAGES" / "Weapon Generator"
NO_TEXT_DIRECTIVE = "No text, labels, numbers, UI overlays, or watermarks."
def _find_app_root() -> Path | None:
    for parent in [Path(__file__).resolve()] + list(Path(__file__).resolve().parents):
        if (parent / "run.bat").exists():
            return parent
    return None


def _get_output_root() -> Path:
    app_root = _find_app_root()
    if app_root:
        output_root = app_root / "ALL GENERATED IMAGES" / "Weapon Generator"
    else:
        suite_root = os.environ.get("PUBG_SUITE_SAVE_ROOT")
        if suite_root:
            base_root = Path(suite_root)
            if "ALL GENERATED IMAGES" not in str(base_root):
                output_root = base_root / "IMAGES" / "ALL GENERATED IMAGES" / "Weapon Generator"
            else:
                output_root = base_root / "Weapon Generator"
        else:
            output_root = _DEFAULT_OUTPUT_ROOT
    output_root.mkdir(parents=True, exist_ok=True)
    return output_root


OUTPUT_ROOT = _get_output_root()

# ---------- Photoshop Integration ----------
def send_to_photoshop(image):
    """Send image to Photoshop using COM or file launch."""
    import tempfile
    
    # Save to temp file
    temp_path = Path(tempfile.gettempdir()) / "weapon_gen_temp.png"
    try:
        image.save(temp_path)
    except Exception as e:
        print(f"[Photoshop] Failed to save temp image: {e}")
        return False
    
    # Try COM automation first (fastest)
    try:
        import win32com.client
        ps = win32com.client.Dispatch("Photoshop.Application")
        ps.Open(str(temp_path))
        print(f"[Photoshop] Opened via COM: {temp_path}")
        return True
    except Exception as e:
        print(f"[Photoshop] COM failed: {e}")
    
    # Fallback: Find Photoshop.exe and launch it
    ps_paths = [
        r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe",
    ]
    
    for ps_path in ps_paths:
        if Path(ps_path).exists():
            try:
                subprocess.Popen([ps_path, str(temp_path)])
                print(f"[Photoshop] Launched via path: {ps_path}")
                return True
            except Exception as e:
                print(f"[Photoshop] Launch failed for {ps_path}: {e}")
    
    print("[Photoshop] ⚠️ Could not find Photoshop installation.")
    return False

# ---------- Gemini Client ----------
import google.generativeai as genai

# ---------- Gemini Clients ----------
import google.generativeai as genai

class GeminiClientText:
    """Text reasoning client (Gemini 2.5 Pro)."""
    def __init__(self):
        import os
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("⚠️ No GEMINI_API_KEY – text model stub mode.")
            self._model = None
            return
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel("gemini-2.5-pro")

    def run(self, prompt: str, base_img=None):
        if not self._model:
            return "Text-analysis stub mode."
        parts = [prompt]
        try:
            if base_img:
                import io
                buf = io.BytesIO()
                base_img.save(buf, format="PNG")
                buf.seek(0)
                # Use the correct method for current google-generativeai version
                parts.insert(0, {
                    "mime_type": "image/png",
                    "data": buf.getvalue()
                })
            result = self._model.generate_content(parts)
            text = getattr(result, "text", "")
            if text:
                return text.strip()
            else:
                return "No response from AI model."
        except Exception as e:
            print(f"[TextClient] {e}")
            return "Analysis failed."


_4K_CAPABLE = {"gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"}


def _weapon_gen_gemini_image(api_key, contents, aspect_ratio="16:9", image_size="4K"):
    """Generate image using google.genai SDK with image_config for full resolution."""
    from google import genai as _genai
    from google.genai import types as _types

    selected = os.environ.get("PUBG_IMAGE_MODEL", "gemini-3-pro-image-preview")
    model_name = selected if selected.startswith("gemini-") else "gemini-3-pro-image-preview"
    effective_size = image_size if model_name in _4K_CAPABLE else "1K"

    client = _genai.Client(api_key=api_key)
    config = _types.GenerateContentConfig(
        temperature=1.0,
        response_modalities=["TEXT", "IMAGE"],
        image_config=_types.ImageConfig(
            image_size=effective_size,
            aspect_ratio=aspect_ratio,
        ),
    )
    result = client.models.generate_content(
        model=model_name,
        contents=contents,
        config=config,
    )
    for part in result.parts:
        if part.inline_data is not None:
            return part.as_image()
    return None


class GeminiClientImage:
    """Image generation client using google.genai SDK with 4K support."""
    def __init__(self):
        self._api_key = os.getenv("GEMINI_API_KEY")
        if not self._api_key:
            print("\u26a0\ufe0f No GEMINI_API_KEY \u2013 image model stub mode.")
        else:
            selected = os.environ.get("PUBG_IMAGE_MODEL", "gemini-3-pro-image-preview")
            model_name = selected if selected.startswith("gemini-") else "gemini-3-pro-image-preview"
            print(f"[WeaponGen] Image model: {model_name} (4K={'yes' if model_name in _4K_CAPABLE else 'no'})")

    def generate(self, prompt, base_img=None):
        from PIL import Image
        if not self._api_key:
            return Image.new("RGB", (1400, 800), (40, 40, 40))

        contents = []
        if base_img:
            contents.append(base_img)
        contents.append(prompt)

        try:
            img = _weapon_gen_gemini_image(self._api_key, contents, aspect_ratio="16:9", image_size="4K")
            if img is not None:
                return img.convert("RGBA")
        except Exception as e:
            print(f"[ERROR] Image generation failed: {e}")
            import traceback
            traceback.print_exc()

        if base_img:
            return base_img
        return Image.new("RGB", (1400, 800), (40, 40, 40))

    def generate_with_refs(self, prompt, base_img=None, ref_images=None):
        """Generate using Gemini with optional reference images at 4K."""
        from PIL import Image
        if not self._api_key:
            return Image.new("RGB", (1400, 800), (40, 40, 40))

        contents = []
        if base_img:
            contents.append(base_img)
        for ref in ref_images or []:
            contents.append(ref)
        contents.append(prompt)

        try:
            img = _weapon_gen_gemini_image(self._api_key, contents, aspect_ratio="16:9", image_size="4K")
            if img is not None:
                return img.convert("RGBA")
        except Exception as e:
            print(f"[ERROR] Image generation failed: {e}")
            import traceback
            traceback.print_exc()

        if base_img:
            return base_img
        return Image.new("RGB", (1400, 800), (40, 40, 40))



# ---------- Data structures ----------
@dataclass
class EditSnapshot:
    timestamp: str
    label: str
    image_path: str
    is_original: bool = False

# ---------- Utilities ----------
from PIL import Image

def safe_open_image(path: Path) -> Optional[Image.Image]:
    try:
        return Image.open(path).convert("RGBA")
    except Exception as e:
        print(f"[IMG] Failed to open {path}: {e}")
        return None

def autosave_image(img: Image.Image, view_key: str = "main", meta: dict = None) -> Path:
    d = datetime.now().strftime("%m-%d-%y")
    t = datetime.now().strftime("%H-%M-%S")
    out_dir = _get_output_root() / d
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{t}_{view_key}.png"
    try:
        img.save(out_path)
    except Exception:
        img.convert("RGB").save(out_path)
    
    if meta:
        with open(out_path.with_suffix(".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
    
    return out_path

class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(APP_TITLE)
        self.root.configure(bg=DarkTheme.WINDOW_BG)
        self.root.geometry("1600x900")
        self.root.state("zoomed")  # Auto full-screen on load

        # state
        self.text_ai = GeminiClientText()
        self.image_ai = GeminiClientImage()
        self._imagen_client = None
        try:
            from google import genai as genai_images
            import os
            api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            if api_key:
                self._imagen_client = genai_images.Client(api_key=api_key)
        except Exception:
            self._imagen_client = None
        self.current_weapon: Optional[str] = None
        self.status = tk.StringVar(value="Ready.")
        self._progress_win = None
        self._progress_label = None

        # images per view
        self.images: Dict[str, Optional[Image.Image]] = {
            "main": None, "three_quarter": None, "front": None, "back": None, "side": None, "top": None, "bottom": None,
            "ref_a": None, "ref_b": None, "ref_c": None
        }

        # Store per-view edit data
        self.view_edit_data = {
            key: {
                "edit_text": "",
                "components": {name: "" for name in ["Receiver", "Barrel", "Stock", "Grip", "Magazine", "Optic", "Muzzle", "Markings", "Material Finish", "Condition"]},
                "finish_dropdown": "",
                "condition_dropdown": ""
            }
            for key in ["main", "three_quarter", "front", "back", "side", "top", "bottom", "ref_a", "ref_b", "ref_c"]
        }

        # edit history (runtime only)
        self.edit_history: List[EditSnapshot] = []
        self.current_snapshot: Optional[EditSnapshot] = None

        # Track unsaved text before user clicks history
        self.unsaved_edit_text = ""
        self.unsaved_components = {}

        # Undo/Redo stacks
        self._undo_stack = []
        self._redo_stack = []

        # Initialize zoom/pan state
        self._zoom_factors = {v: 1.0 for v in ["main", "three_quarter", "front", "back", "side", "top", "bottom", "ref_a", "ref_b", "ref_c"]}
        self._pan_offsets = {v: [0, 0] for v in ["main", "three_quarter", "front", "back", "side", "top", "bottom", "ref_a", "ref_b", "ref_c"]}

        # build UI + load weapons
        self._build_ui()
        self._populate_weapons()

    def _build_ui(self):
        self.main_pane = tk.PanedWindow(self.root, orient="horizontal", sashwidth=4, bg=DarkTheme.WINDOW_BG, bd=0, sashrelief="flat")
        self.main_pane.pack(fill="both", expand=True)

        left = tk.Frame(self.main_pane, bg=DarkTheme.WINDOW_BG)
        right = tk.Frame(self.main_pane, bg=DarkTheme.WINDOW_BG)
        self.main_pane.add(left, width=520)
        self.main_pane.add(right)

        # --- Left panel ---
        top_box = tk.LabelFrame(left, text="Weapon Selection", fg=DarkTheme.TEXT_FG, bg=DarkTheme.FRAME_BG, bd=1, relief="groove", padx=8, pady=6)
        top_box.pack(fill="x", padx=8, pady=(8, 4))
        self.weapon_combo = ttk.Combobox(top_box, state="readonly")
        self.weapon_combo.bind("<<ComboboxSelected>>", lambda e: self.on_weapon_selected())
        self.weapon_combo.pack(fill="x", pady=(0, 6))
        edit_list_btn = self._mk_btn(top_box, "Edit Weapon List", self.open_weapon_list_folder)
        edit_list_btn.pack(fill="x", pady=(0, 2))
        ToolTip(edit_list_btn, "Open the base images folder (Add or Remove Gun Images Here) to add or remove PNGs.")

        # Buttons row 1
        btn_row1 = tk.Frame(left, bg=DarkTheme.WINDOW_BG); btn_row1.pack(fill="x", padx=8)
        btn = self._mk_btn(btn_row1, "EXTRACT ATTRIBUTES", self.on_extract_attributes)
        btn.pack(side="left", fill="x", expand=True)
        ToolTip(btn, "Analyze weapon image and fill in components automatically.")

        # Buttons row 1b
        btn_row1b = tk.Frame(left, bg=DarkTheme.WINDOW_BG); btn_row1b.pack(fill="x", padx=8, pady=(4, 0))
        btn = self._mk_btn(btn_row1b, "ENHANCE DESCRIPTION", self.on_enhance_description)
        btn.pack(side="left", fill="x", expand=True)
        ToolTip(btn, "Expand a short description into a full weapon concept and components.")

        # Buttons row 2
        btn_row2 = tk.Frame(left, bg=DarkTheme.WINDOW_BG); btn_row2.pack(fill="x", padx=8, pady=(4, 0))
        btn = self._mk_btn(btn_row2, "OPEN IMAGE", self.on_open_image)
        btn.pack(side="left", fill="x", expand=True, padx=(0, 4))
        ToolTip(btn, "Open an existing weapon image.")
        
        btn = self._mk_btn(btn_row2, "Reset Weapon", self.on_reset_weapon)
        btn.pack(side="left", fill="x", expand=True)
        ToolTip(btn, "Reset the entire tool to its initial state.")

        # Edit instructions
        edit_box = tk.LabelFrame(left, text="Edit Instructions", fg=DarkTheme.TEXT_FG, bg=DarkTheme.FRAME_BG, bd=1, relief="groove", padx=8, pady=6)
        edit_box.pack(fill="x", padx=8, pady=(6, 4))
        self.edit_text = tk.Text(edit_box, height=6, wrap="word", bg=DarkTheme.INPUT_BG, fg=DarkTheme.TEXT_FG, bd=0)
        self.edit_text.pack(fill="both", expand=True)
        configure_text_widget(self.edit_text)
        
        # Pressing Enter applies the edit
        self.edit_text.bind("<Return>", lambda e: (self.on_apply_edit(), "break"))
        self.edit_text.bind("<Shift-Return>", lambda e: None)
        btn = self._mk_btn(left, "Generate / Apply Edit", self.on_apply_edit)
        btn.pack(fill="x", padx=8, pady=(4, 6))
        ToolTip(btn, "Generate a new weapon image using current edits.")

        # Edit history with collapsible header
        self.hist_collapsed = tk.BooleanVar(value=True)  # Start collapsed
        
        # Header with expand/collapse button
        hist_header = tk.Frame(left, bg=DarkTheme.FRAME_BG)
        hist_header.pack(fill="x", padx=8, pady=(4, 0))
        
        # Collapsible content frame
        self.hist_frame = tk.Frame(left, bg=DarkTheme.FRAME_BG)
        # Pack initially - starts expanded
        
        def toggle_history():
            if self.hist_collapsed.get():
                # Only expand if there are history entries
                if self.edit_history:
                    self.hist_frame.pack(after=hist_header, fill="x", padx=8, pady=(0, 1), expand=False)
                    toggle_btn.config(text="▼ Edit History")
                    self.hist_collapsed.set(False)
            else:
                # Collapse
                self.hist_frame.forget()
                toggle_btn.config(text="► Edit History")
                self.hist_collapsed.set(True)
        
        toggle_btn = tk.Button(hist_header, text="► Edit History",
                               bg=DarkTheme.BUTTON_BG, fg=DarkTheme.TEXT_FG,
                               activebackground=DarkTheme.BUTTON_HOVER, relief="flat",
                               anchor="w", padx=10, pady=6, cursor="hand2",
                               command=toggle_history, bd=0)
        add_hover_effect(toggle_btn)
        toggle_btn.pack(fill="x")
        
        # Start collapsed - don't pack initially
        
        # Restore button - separate from scrollable history
        restore_row = tk.Frame(self.hist_frame, bg=DarkTheme.FRAME_BG)
        restore_row.pack(fill="x", padx=8, pady=(6, 1))
        self._mk_btn(restore_row, "↺ Restore Current Edits", self.on_restore_current).pack(fill="x", expand=True)

        # History list with conditional scrollbar - no fixed height
        self.hist_canvas = tk.Canvas(self.hist_frame, bg=DarkTheme.FRAME_BG, bd=0, highlightthickness=0)
        configure_canvas_widget(self.hist_canvas)
        self.hist_scroll = ttk.Scrollbar(self.hist_frame, orient="vertical", command=self.hist_canvas.yview)
        self.hist_canvas.configure(yscrollcommand=self.hist_scroll.set)
        self.hist_canvas.pack(side="left", fill="x", expand=False)
        # Don't pack scrollbar initially - will be shown when needed
        self.hist_inner = tk.Frame(self.hist_canvas, bg=DarkTheme.FRAME_BG)
        self.hist_window = self.hist_canvas.create_window((0, 0), window=self.hist_inner, anchor="nw")
        self.hist_inner.bind("<Configure>", self._on_hist_inner_configure)
        
        # Ensure proper width from the start
        self.root.after(100, self._ensure_hist_canvas_width)
        
        # Mouse wheel scrolling for history area
        def _on_mouse_wheel(e):
            if self.hist_frame.winfo_ismapped():
                self.hist_canvas.yview_scroll(int(-1 * (e.delta / 120)), "units")
        
        self.hist_canvas.bind("<Enter>", lambda e: self.hist_canvas.bind_all("<MouseWheel>", _on_mouse_wheel))
        self.hist_canvas.bind("<Leave>", lambda e: self.hist_canvas.unbind_all("<MouseWheel>"))

        # Components
        comp_box = tk.LabelFrame(
            left, text="Weapon Components",
            fg=DarkTheme.TEXT_FG, bg=DarkTheme.FRAME_BG,
            bd=1, relief="groove", padx=8, pady=6
        )
        comp_box.pack(fill="x", padx=8, pady=(0, 6))

        self.components: Dict[str, tk.Entry] = {}

        # Common entries
        basic_fields = ["Receiver", "Barrel", "Stock", "Grip", "Magazine", "Optic", "Muzzle", "Markings"]
        for name in basic_fields:
            row = tk.Frame(comp_box, bg=DarkTheme.FRAME_BG)
            row.pack(fill="x", pady=2)
            tk.Label(row, text=name, bg=DarkTheme.FRAME_BG, fg=DarkTheme.SUBTEXT_FG,
                     width=16, anchor="w").pack(side="left")
            ent = tk.Entry(row, bg=DarkTheme.INPUT_BG, fg=DarkTheme.TEXT_FG,
                           bd=0, insertbackground=DarkTheme.TEXT_FG)
            ent.pack(side="left", fill="x", expand=True)
            ent.bind("<Return>", lambda e: (self.on_apply_edit(), "break"))
            ent.bind("<Shift-Return>", lambda e: None)
            self.components[name] = ent

        # --- MATERIAL FINISH (Dropdown + Custom Text) ---
        row = tk.Frame(comp_box, bg=DarkTheme.FRAME_BG)
        row.pack(fill="x", pady=2)
        tk.Label(row, text="Material Finish", bg=DarkTheme.FRAME_BG, fg=DarkTheme.SUBTEXT_FG,
                 width=16, anchor="w").pack(side="left")

        # Dropdown list of finishes
        finish_options = {
            "Blued Steel": "Dark oxidized steel with reflective finish.",
            "Parkerized": "Matte gray-green corrosion-resistant phosphate coating.",
            "Nickel Plated": "Shiny metallic coating, highly reflective and corrosion resistant.",
            "Stainless": "Bare silver steel, smooth finish, no rust.",
            "Cerakote": "Modern ceramic-polymer coating, customizable color and texture.",
            "Anodized": "Color-tinted aluminum surface treatment, durable and smooth.",
            "Painted": "Simple painted surface — color and texture vary.",
        }
        finish_combo = ttk.Combobox(row, state="readonly", values=list(finish_options.keys()))
        finish_combo.pack(side="left", fill="x", expand=True)

        # Tooltip for finishes
        def show_finish_tip(event):
            choice = finish_combo.get()
            if choice in finish_options:
                self.status.set(finish_options[choice])
        finish_combo.bind("<<ComboboxSelected>>", show_finish_tip)

        # Custom text override
        finish_custom = tk.Entry(row, bg=DarkTheme.INPUT_BG, fg=DarkTheme.TEXT_FG,
                                 bd=0, insertbackground=DarkTheme.TEXT_FG)
        finish_custom.pack(side="left", fill="x", expand=True, padx=(4, 0))
        finish_custom.bind("<Return>", lambda e: (self.on_apply_edit(), "break"))
        finish_custom.bind("<Shift-Return>", lambda e: None)
        self.components["Material Finish"] = finish_custom
        self.finish_combo = finish_combo

        # --- CONDITION (Dropdown + Custom Text) ---
        row = tk.Frame(comp_box, bg=DarkTheme.FRAME_BG)
        row.pack(fill="x", pady=2)
        tk.Label(row, text="Condition", bg=DarkTheme.FRAME_BG, fg=DarkTheme.SUBTEXT_FG,
                 width=16, anchor="w").pack(side="left")

        condition_levels = {
            "1 - Factory New": "Mint condition, pristine, as if never fired.",
            "2 - Light Wear": "Slight handling marks, minimal cosmetic wear.",
            "3 - Service Used": "Visible wear, maintained but field-used.",
            "4 - Heavily Worn": "Significant scratches, faded finish, still functional.",
            "5 - Damaged": "Rust, cracks, or mechanical issues, barely functional."
        }
        condition_combo = ttk.Combobox(row, state="readonly", values=list(condition_levels.keys()))
        condition_combo.pack(side="left", fill="x", expand=True)

        def show_condition_tip(event):
            choice = condition_combo.get()
            if choice in condition_levels:
                self.status.set(condition_levels[choice])
        condition_combo.bind("<<ComboboxSelected>>", show_condition_tip)

        condition_custom = tk.Entry(row, bg=DarkTheme.INPUT_BG, fg=DarkTheme.TEXT_FG,
                                    bd=0, insertbackground=DarkTheme.TEXT_FG)
        condition_custom.pack(side="left", fill="x", expand=True, padx=(4, 0))
        condition_custom.bind("<Return>", lambda e: (self.on_apply_edit(), "break"))
        condition_custom.bind("<Shift-Return>", lambda e: None)
        self.components["Condition"] = condition_custom
        self.condition_combo = condition_combo

        # Multi-view
        mv_row1 = tk.Frame(left, bg=DarkTheme.WINDOW_BG); mv_row1.pack(fill="x", padx=8, pady=(4, 0))
        btn = self._mk_btn(mv_row1, "Generate all views", self.on_generate_all)
        btn.pack(side="left", fill="x", expand=True, padx=(0, 4))
        ToolTip(btn, "Generate all camera angles for this weapon.")
        
        btn = self._mk_btn(mv_row1, "Generate Selected View", self.on_generate_selected)
        btn.pack(side="left", fill="x", expand=True)
        ToolTip(btn, "Generate only the current camera view.")

        # Save options
        save_box = tk.Frame(left, bg=DarkTheme.WINDOW_BG); save_box.pack(fill="x", padx=8, pady=(6, 6))
        btn = self._mk_btn(save_box, "Send to PS", self.on_send_ps)
        btn.pack(side="left", fill="x", expand=True, padx=(0, 4))
        ToolTip(btn, "Send the current image to Photoshop.")
        
        btn = self._mk_btn(save_box, "Send ALL to PS", self.on_send_all_ps)
        btn.pack(side="left", fill="x", expand=True)
        ToolTip(btn, "Send Main, 3/4, Front, Back, and Side views to Photoshop.")
        
        save_box2 = tk.Frame(left, bg=DarkTheme.WINDOW_BG); save_box2.pack(fill="x", padx=8, pady=(0, 4))
        btn = self._mk_btn(save_box2, "Show XML", self.on_show_xml)
        btn.pack(side="left", fill="x", expand=True, padx=(0, 4))
        ToolTip(btn, "View current session data as JSON.")
        
        btn = self._mk_btn(save_box2, "Clear AI Cache", self.on_clear_cache)
        btn.pack(side="left", fill="x", expand=True, padx=(0, 4))
        ToolTip(btn, "Clear cached AI results.")
        
        btn = self._mk_btn(save_box2, "Open Generated Images", self.on_open_output_folder)
        btn.pack(side="left", fill="x", expand=True)
        ToolTip(btn, "Open the folder containing all generated images.")

        # --- Right panel ---
        top_row = tk.Frame(right, bg=DarkTheme.WINDOW_BG); top_row.pack(fill="x", padx=8, pady=(8, 4))
        tk.Label(top_row, text="Weapon Concept", bg=DarkTheme.WINDOW_BG, fg=DarkTheme.TEXT_FG).pack(side="left")
        btn = self._mk_btn(top_row, "★ QUICK GENERATE", self.on_quick_generate)
        btn.pack(side="right")
        ToolTip(btn, "Automatically generate a random weapon skin concept.")

        self.notebook = ttk.Notebook(right)
        self.view_frames: Dict[str, tk.Frame] = {}
        self.view_canvases: Dict[str, tk.Canvas] = {}
        for key, label in [
            ("main","Main Stage"),
            ("three_quarter","3/4"),
            ("front","Front"),
            ("back","Back"),
            ("side","Side"),
            ("top","Top"),
            ("bottom","Bottom"),
            ("ref_a","Ref A"),
            ("ref_b","Ref B"),
            ("ref_c","Ref C"),
        ]:
            frame = tk.Frame(self.notebook, bg=DarkTheme.WINDOW_BG); self.view_frames[key] = frame
            cnv = tk.Canvas(frame, bg=DarkTheme.CANVAS_BG, bd=0, highlightthickness=0); cnv.pack(fill="both", expand=True)
            configure_canvas_widget(cnv)
            self.view_canvases[key] = cnv
            self._bind_zoom_pan(cnv, key)
            self.notebook.add(frame, text=label)
        self.notebook.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        # Automatically refresh image when switching views
        self.notebook.bind("<<NotebookTabChanged>>", lambda e: self._on_view_tab_changed())

        use_row = tk.Frame(right, bg=DarkTheme.WINDOW_BG); use_row.pack(fill="x", padx=8, pady=(0, 4))
        self._mk_btn(use_row, "Use as Side Profile", lambda: self._assign_from_main("side")).pack(side="left", padx=(0, 4))
        self._mk_btn(use_row, "Use as Three-Quarter", lambda: self._assign_from_main("three_quarter")).pack(side="left", padx=(0, 4))
        self._mk_btn(use_row, "Use as Front", lambda: self._assign_from_main("front")).pack(side="left", padx=(0, 4))
        self._mk_btn(use_row, "Use as Back", lambda: self._assign_from_main("back")).pack(side="left", padx=(0, 4))
        self._mk_btn(use_row, "Use as Top", lambda: self._assign_from_main("top")).pack(side="left", padx=(0, 4))
        self._mk_btn(use_row, "Use as Bottom", lambda: self._assign_from_main("bottom")).pack(side="left")

        self.status_bar = tk.Label(self.root, textvariable=self.status, bg=DarkTheme.WINDOW_BG, fg=DarkTheme.SUBTEXT_FG, anchor="w")
        self.status_bar.pack(fill="x", side="bottom")

        # Bind ESC key for zoom/pan reset
        self.root.bind("<Escape>", self._reset_view)

        # Bind global undo/redo shortcuts
        self.root.bind_all("<Control-z>", lambda e: self._undo())
        self.root.bind_all("<Control-y>", lambda e: self._redo())

    def _on_hist_inner_configure(self, event):
        """Configure the history inner frame to fit content without extra space."""
        # Update scroll region
        self.hist_canvas.configure(scrollregion=self.hist_canvas.bbox("all"))
        # Ensure the inner frame fills the canvas width
        canvas_width = self.hist_canvas.winfo_width()
        if canvas_width > 1:  # Avoid division by zero
            self.hist_canvas.itemconfig(self.hist_window, width=canvas_width)
        
        # Resize canvas to fit content height (max 200px for scrolling)
        content_height = self.hist_inner.winfo_reqheight()
        if content_height > 0:
            # Limit height to 200px max, but don't force a minimum
            canvas_height = min(content_height, 200)
            self.hist_canvas.configure(height=canvas_height)
    
    def _ensure_hist_canvas_width(self):
        """Ensure the history canvas window is properly sized from the start."""
        if hasattr(self, 'hist_canvas') and hasattr(self, 'hist_window'):
            canvas_width = self.hist_canvas.winfo_width()
            if canvas_width > 1:
                self.hist_canvas.itemconfig(self.hist_window, width=canvas_width)

    def _mk_btn(self, parent, text, cmd):
        b = tk.Button(parent, text=text, bg=DarkTheme.BUTTON_BG, fg=DarkTheme.TEXT_FG, activebackground=DarkTheme.BUTTON_HOVER,
                      activeforeground=DarkTheme.TEXT_FG, relief="flat", bd=0, padx=12, pady=8,
                      command=cmd, cursor="hand2")
        add_hover_effect(b)
        return b

    def _populate_weapons(self):
        if not ASSETS_DIR.exists():
            self.weapon_combo["values"] = []
            return
        names = [p.stem for p in ASSETS_DIR.glob("*.png")]
        self.weapon_combo["values"] = ["None"] + sorted(names)
        self.weapon_combo.set("None")
        self.current_weapon = None

    def on_weapon_selected(self):
        name = self.weapon_combo.get()
        if not name or name == "None":
            self.current_weapon = None
            self.status.set("No base weapon selected (freeform mode).")
            return
        self.current_weapon = name
        path = ASSETS_DIR / f"{name}.png"
        img = safe_open_image(path)
        if img is None:
            self.status.set(f"Missing asset for '{name}'.")
            return
        self.images["main"] = img
        self._display_image("main", img)
        self._log_original_snapshot(img)
        self.status.set(f"Loaded {name}.")
        
        # Reset unsaved state when opening new weapon
        self._unsaved_state_locked = False
        self.unsaved_edit_text = ""
        self.unsaved_components = {}

    def _display_image(self, key: str, img: Image.Image):
        """Display image on canvas, always centered in its viewing area."""
        cnv = self.view_canvases[key]

        # Ensure layout update before measuring size
        cnv.update_idletasks()
        cnv.delete("all")

        cw = cnv.winfo_width()
        ch = cnv.winfo_height()

        # Fallback dimensions if still zero
        if cw <= 1 or ch <= 1:
            cw, ch = 1400, 800
        iw, ih = img.size

        # Apply zoom and pan
        zoom = self._zoom_factors.get(key, 1.0)
        pan_x, pan_y = self._pan_offsets.get(key, [0, 0])

        scaled_w, scaled_h = int(iw * zoom), int(ih * zoom)
        show = img.resize((scaled_w, scaled_h), Image.LANCZOS)
        self._photo = ImageTk.PhotoImage(show)

        x = (cw - scaled_w) // 2 + pan_x
        y = (ch - scaled_h) // 2 + pan_y
        cnv.create_image(x, y, image=self._photo, anchor="nw")

        res_text = f"{iw} \u00d7 {ih}"
        cnv.create_rectangle(4, ch - 24, len(res_text) * 7 + 18, ch - 4, fill="#111111", outline="")
        cnv.create_text(10, ch - 14, text=res_text, fill="#CCCCCC",
                        font=("Consolas", 9), anchor="w")

    # ======== Zoom and Pan Integration ========

    def _bind_zoom_pan(self, canvas, view_name: str):
        """Bind zoom and pan controls for a specific canvas."""
        canvas.bind("<MouseWheel>", lambda e, v=view_name: self._on_zoom(e, v))
        canvas.bind("<ButtonPress-1>", lambda e, v=view_name: self._start_pan(e, v))
        canvas.bind("<ButtonPress-2>", lambda e, v=view_name: self._start_pan(e, v))  # Middle click
        canvas.bind("<B1-Motion>", lambda e, v=view_name: self._do_pan(e, v))
        canvas.bind("<B2-Motion>", lambda e, v=view_name: self._do_pan(e, v))
        canvas.bind("<ButtonRelease-1>", lambda e, v=view_name: self._stop_pan(e, v))
        canvas.bind("<ButtonRelease-2>", lambda e, v=view_name: self._stop_pan(e, v))
        canvas.bind("<Button-3>", lambda e, v=view_name: self._show_context_menu(e, v))

    def _start_pan(self, event, view_name):
        self._drag_origin = (event.x, event.y)
        self._dragging_view = view_name
        self.root.config(cursor="fleur")

    def _do_pan(self, event, view_name):
        if getattr(self, "_drag_origin", None) is None:
            return
        dx = event.x - self._drag_origin[0]
        dy = event.y - self._drag_origin[1]
        self._pan_offsets[view_name][0] += dx
        self._pan_offsets[view_name][1] += dy
        self._drag_origin = (event.x, event.y)
        self._redraw_image(view_name)

    def _stop_pan(self, event, view_name):
        self._drag_origin = None
        self.root.config(cursor="")

    def _on_zoom(self, event, view_name):
        """Zoom in/out with scroll wheel."""
        factor = 1.1 if event.delta > 0 else 0.9
        new_zoom = self._zoom_factors[view_name] * factor
        if 0.1 <= new_zoom <= 10.0:
            self._zoom_factors[view_name] = new_zoom
            self._redraw_image(view_name)

    def _redraw_image(self, view_name):
        """Redraw image for the given view with current zoom/pan."""
        if view_name not in self.view_canvases or view_name not in self.images:
            return
        img = self.images.get(view_name)
        if img is not None:
            self._display_image(view_name, img)

    def _reset_view(self, event=None):
        """Reset zoom/pan for current view."""
        # Get current tab
        tab_index = self.notebook.index(self.notebook.select())
        tab_key = list(self.view_canvases.keys())[tab_index]
        
        # Reset zoom/pan for current view
        self._zoom_factors[tab_key] = 1.0
        self._pan_offsets[tab_key] = [0, 0]
        self._redraw_image(tab_key)
        self.status.set("View reset to default zoom/pan.")

    def _ensure_landscape(self, img: Optional[Image.Image]) -> Optional[Image.Image]:
        if img is None:
            return None
        w, h = img.size
        # Target 16:9 landscape canvas, keep original size and center
        target_w = max(w, int(h * 16 / 9))
        target_h = int(target_w * 9 / 16)
        if target_h < h:
            target_h = h
            target_w = int(target_h * 16 / 9)
        if target_w == w and target_h == h:
            return img
        background = (59, 59, 59, 255)
        canvas = Image.new("RGBA", (target_w, target_h), background)
        x = (target_w - w) // 2
        y = (target_h - h) // 2
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        canvas.paste(img, (x, y), img)
        return canvas

    def _collect_ref_images(self, prompt: str) -> list:
        prompt_lower = (prompt or "").lower()
        refs = []
        for key in ["ref_a", "ref_b", "ref_c"]:
            if (
                key in prompt_lower
                or key.replace("_", " ") in prompt_lower
                or key.replace("_", "") in prompt_lower
            ):
                img = self.images.get(key)
                if img is not None:
                    refs.append(img)
        return refs

    def _generate_imagen(self, prompt: str) -> Optional[Image.Image]:
        selected = os.environ.get("PUBG_IMAGE_MODEL", "imagen-4.0-generate-001")

        if selected.startswith("gemini-"):
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                return Image.new("RGB", (1400, 800), (40, 40, 40))
            try:
                img = _weapon_gen_gemini_image(api_key, [prompt], aspect_ratio="16:9", image_size="4K")
                if img is not None:
                    return img.convert("RGBA")
                print(f"[WeaponGen] No image in Gemini response from {selected}")
            except Exception as e:
                print(f"[ERROR] Gemini image generation failed ({selected}): {e}")
            return Image.new("RGB", (1400, 800), (40, 40, 40))

        # Imagen API path
        if not self._imagen_client:
            return Image.new("RGB", (1400, 800), (40, 40, 40))
        try:
            from google.genai import types as genai_types
            import io

            aspect = "16:9"
            size_label = "2K"
            primary = {"name": f"models/{selected}", "supports_image_size": selected != "imagen-4.0-fast-generate-001"}
            fallbacks = [
                {"name": "models/imagen-4.0-generate-001", "supports_image_size": True},
                {"name": "models/imagen-4.0-fast-generate-001", "supports_image_size": False},
            ]
            candidates = [primary] + [c for c in fallbacks if c["name"] != primary["name"]]

            last_error = None
            for candidate in candidates:
                model_name = candidate["name"]
                supports_image_size = candidate["supports_image_size"]
                try:
                    config_kwargs = {
                        "number_of_images": 1,
                        "aspect_ratio": aspect,
                        "safety_filter_level": "block_low_and_above",
                        "person_generation": "ALLOW_ADULT",
                    }
                    if supports_image_size:
                        config_kwargs["image_size"] = size_label
                    config = genai_types.GenerateImagesConfig(**config_kwargs)
                    result = self._imagen_client.models.generate_images(
                        model=model_name,
                        prompt=prompt,
                        config=config,
                    )
                    generated_images = getattr(result, "generated_images", None) or []
                    for generated_image in generated_images:
                        image_obj = getattr(generated_image, "image", None)
                        if image_obj and getattr(image_obj, "image_bytes", None):
                            return Image.open(io.BytesIO(image_obj.image_bytes)).convert("RGBA")
                except Exception as model_err:
                    last_error = model_err
                    continue
            if last_error:
                print(f"[ERROR] Imagen generation failed: {last_error}")
        except Exception as e:
            print(f"[ERROR] Imagen generation failed: {e}")
        return Image.new("RGB", (1400, 800), (40, 40, 40))

    def _on_view_tab_changed(self, event=None):
        """Save current view data, switch tabs, and load new view data."""
        # Save the current view's text and fields before switching
        if hasattr(self, 'view_edit_data'):  # Check if initialized
            try:
                old_tab_index = self.notebook.index("current")
                old_tab_key = list(self.view_canvases.keys())[old_tab_index]
                
                # Save current view's data
                self.view_edit_data[old_tab_key]["edit_text"] = self.edit_text.get("1.0", "end-1c")
                self.view_edit_data[old_tab_key]["components"] = {k: e.get() for k, e in self.components.items()}
                self.view_edit_data[old_tab_key]["finish_dropdown"] = self.finish_combo.get()
                self.view_edit_data[old_tab_key]["condition_dropdown"] = self.condition_combo.get()
            except:
                pass  # First call or error, skip saving
        
        # Get new tab
        tab_index = self.notebook.index(self.notebook.select())
        tab_key = list(self.view_canvases.keys())[tab_index]
        img = self.images.get(tab_key)
        
        # Load per-view fields when switching tabs
        view_data = self.view_edit_data.get(tab_key, {})
        
        # Restore Edit Instructions
        self.edit_text.delete("1.0", "end")
        self.edit_text.insert("1.0", view_data.get("edit_text", ""))
        
        # Restore component fields
        for name, entry in self.components.items():
            entry.delete(0, "end")
            entry.insert(0, view_data.get("components", {}).get(name, ""))
        
        # Restore dropdowns
        self.finish_combo.set(view_data.get("finish_dropdown", ""))
        self.condition_combo.set(view_data.get("condition_dropdown", ""))

        if img:
            # Reset zoom/pan to full-screen default
            self._zoom_factors[tab_key] = 1.0
            self._pan_offsets[tab_key] = [0, 0]
            self._display_image(tab_key, img)
            self.status.set(f"Showing {tab_key.replace('_', ' ').title()} view.")
        else:
            cnv = self.view_canvases[tab_key]
            cnv.delete("all")
            cnv.create_text(
                cnv.winfo_width() // 2,
                cnv.winfo_height() // 2,
                text="No image generated yet.",
                fill="gray",
                font=("Segoe UI", 12, "italic")
            )

    def _show_context_menu(self, event, view_name):
        """Right-click context menu for save/copy/paste options."""
        menu = tk.Menu(self.root, tearoff=0, bg=DarkTheme.FRAME_BG, fg=DarkTheme.TEXT_FG)
        menu.add_command(label="💾 Save Image", command=lambda: self._save_view_image(view_name))
        menu.add_command(label="📋 Copy Image", command=lambda: self._copy_view_image(view_name))
        menu.add_command(label="📥 Paste Image", command=lambda: self._paste_view_image(view_name))
        menu.add_command(label="📂 Open Image...", command=lambda: self._open_view_image(view_name))
        menu.add_separator()
        menu.add_command(label="🔍 Reset View", command=lambda: self._reset_view_for(view_name))
        if view_name in ("ref_a", "ref_b", "ref_c"):
            menu.add_separator()
            menu.add_command(label="🗑️ Clear Image Ref", command=lambda: self._clear_ref_image(view_name))
        menu.tk_popup(event.x_root, event.y_root)

    def _open_view_image(self, view_name):
        path = filedialog.askopenfilename(
            title=f"Open Image for {view_name.replace('_', ' ').title()}",
            filetypes=[["Images", "*.png;*.jpg;*.jpeg;*.webp"]]
        )
        if not path:
            return
        img = safe_open_image(Path(path))
        if img is None:
            return
        self.images[view_name] = img
        self._display_image(view_name, img)
        if view_name == "main":
            self._log_original_snapshot(img)
        self.status.set(f"Opened image in {view_name.replace('_', ' ').title()}: {Path(path).name}")

    def open_weapon_list_folder(self):
        try:
            ASSETS_DIR.mkdir(parents=True, exist_ok=True)
            os.startfile(str(ASSETS_DIR))
        except Exception as e:
            messagebox.showerror("Open Folder Failed", f"Could not open weapon image folder:\n{e}")

    def _reset_view_for(self, view_name):
        if view_name not in self.view_canvases:
            return
        self._zoom_factors[view_name] = 1.0
        self._pan_offsets[view_name] = [0, 0]
        self._redraw_image(view_name)
        self.status.set(f"🔍 {view_name.replace('_', ' ').title()} view reset.")

    def _clear_ref_image(self, view_name):
        self.images[view_name] = None
        cnv = self.view_canvases.get(view_name)
        if cnv:
            cnv.delete("all")
            cnv.create_text(
                cnv.winfo_width() // 2,
                cnv.winfo_height() // 2,
                text="No image loaded.",
                fill="gray",
                font=("Segoe UI", 12, "italic")
            )
        self.status.set(f"🗑️ Cleared reference image for {view_name.replace('_', ' ').title()}.")

    def _save_view_image(self, view_name):
        img = self.images.get(view_name)
        if img is None:
            messagebox.showwarning("No Image", f"No image in {view_name} view to save.")
            return
        path = filedialog.asksaveasfilename(
            title=f"Save {view_name} view",
            defaultextension=".png",
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        if path:
            try:
                img.save(path)
                self.status.set(f"Saved {view_name} view to {Path(path).name}.")
            except Exception as e:
                messagebox.showerror("Save Error", f"Could not save image: {e}")

    def _copy_view_image(self, view_name):
        """Copy the current view's image to the system clipboard."""
        img = self.images.get(view_name)
        if img is None:
            messagebox.showwarning("No Image", f"No image in {view_name} view to copy.")
            return

        # Method 1: Try win32clipboard (most compatible with Photoshop and other tools)
        try:
            import io
            import win32clipboard
            import win32con
            import time
            
            # Prepare DIB
            output = io.BytesIO()
            img.convert("RGB").save(output, "BMP")
            dib_data = output.getvalue()[14:]  # Strip BMP header
            output.close()
            
            # Prepare PNG
            png_output = io.BytesIO()
            img.save(png_output, "PNG")
            png_data = png_output.getvalue()
            png_output.close()
            
            # Attempt to open clipboard with retries
            for _ in range(5):
                try:
                    win32clipboard.OpenClipboard()
                    win32clipboard.EmptyClipboard()
                    
                    # Set DIB for wide compatibility
                    win32clipboard.SetClipboardData(win32con.CF_DIB, dib_data)
                    
                    # Set PNG for higher fidelity
                    for fmt_name in ["PNG", "Portable Network Graphics"]:
                        try:
                            png_fmt = win32clipboard.RegisterClipboardFormat(fmt_name)
                            win32clipboard.SetClipboardData(png_fmt, png_data)
                        except Exception:
                            continue
                        
                    win32clipboard.CloseClipboard()
                    
                    self.status.set(f"✅ Copied {view_name} image to clipboard (DIB + PNG).")
                    print("[Clipboard] Win32 DIB+PNG copy successful.")
                    return True
                except Exception:
                    try: win32clipboard.CloseClipboard()
                    except: pass
                    time.sleep(0.05)
                    
        except ImportError:
            print("[Clipboard] win32clipboard not available, trying PIL method...")
        except Exception as e:
            print(f"[Clipboard] Win32 method failed: {e}")
            print("[Clipboard] win32clipboard not available, trying PIL method...")
        except Exception as e:
            print(f"[Clipboard] Win32 method failed: {e}")
        
        # Method 2: Try PIL ImageGrab (simpler but less compatible)
        try:
            import io
            from PIL import ImageGrab
            
            # Save to clipboard via tkinter
            output = io.BytesIO()
            img.save(output, format='PNG')
            
            # Use ImageGrab to put it on clipboard
            self.root.clipboard_clear()
            
            # Try to use win32clipboard via PIL if available
            temp_path = Path(__file__).parent / "temp_clipboard.png"
            img.save(temp_path)
            
            # Open with system default viewer which allows copy
            import subprocess
            subprocess.Popen(['mspaint.exe', str(temp_path)])
            
            self.status.set(f"⚠️ Opened in Paint - use Ctrl+A, Ctrl+C to copy.")
            print("[Clipboard] Opened in Paint for manual copy.")
            return True
        except Exception as e:
            print(f"[Clipboard] PIL method failed: {e}")
        
        # Method 3: Fallback - save temp file
        try:
            temp_path = Path(__file__).parent / "clipboard_fallback.png"
            img.save(temp_path)
            self.status.set(f"⚠️ Clipboard unavailable — saved to {temp_path.name}")
            messagebox.showinfo("Clipboard Unavailable", 
                              f"Couldn't copy to clipboard.\n\nImage saved to:\n{temp_path}\n\nOpen it and copy manually.")
            return False
        except Exception as save_error:
            print(f"[Clipboard] All methods failed: {save_error}")
            self.status.set("❌ Clipboard copy failed.")
            messagebox.showerror("Copy Failed", "Could not copy image to clipboard.")
            return False

    def _paste_view_image(self, view_name):
        """Robustly paste an image from the system clipboard."""
        pasted = None
        try:
            import io
            import time
            from PIL import ImageGrab
            
            # Method 1: Try win32clipboard for PNG/DIB (with retries and multi-format support)
            if platform.system() == "Windows":
                try:
                    import win32clipboard, win32con
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
                                        # Add BMP header to DIB data
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
                    print(f"[Clipboard] win32 paste failed: {e}")

            # Method 2: Standard ImageGrab fallback
            if pasted is None:
                grabbed = ImageGrab.grabclipboard()
                if isinstance(grabbed, Image.Image):
                    pasted = grabbed
                elif isinstance(grabbed, (list, tuple)) and grabbed:
                    try:
                        path = Path(grabbed[0])
                        if path.exists():
                            pasted = Image.open(path)
                    except Exception:
                        pass
        except Exception as e:
            print(f"[Clipboard] Paste error: {e}")

        if pasted:
            img = pasted.convert("RGB")
            self.images[view_name] = img
            self._zoom_factors[view_name] = 1.0
            self._pan_offsets[view_name] = [0, 0]
            self._display_image(view_name, img)
            if view_name == "main":
                self._log_original_snapshot(img)
            self.status.set(f"✅ Pasted image into {view_name.replace('_', ' ').title()}.")
        else:
            messagebox.showinfo("No Image", "Clipboard does not contain a valid image.")

    def _log_original_snapshot(self, img: Image.Image):
        ts = datetime.now().strftime("%H:%M:%S")
        snap = EditSnapshot(timestamp=ts, label="ORIGINAL IMAGE",
                            image_path=str(autosave_image(img, "original")), is_original=True)
        self.edit_history = [s for s in self.edit_history if not s.is_original]
        self.edit_history.append(snap)
        self.refresh_edit_history()

    def _append_edit_snapshot(self, img: Image.Image, label_text: str):
        # Save undo snapshot before applying changes
        self._save_undo_state()
        
        ts = datetime.now().strftime("%H:%M:%S")

        # Gather all component data
        meta = {
            "timestamp": ts,
            "weapon": self.current_weapon,
            "prompt": label_text,
            "components": {k: e.get() for k, e in self.components.items()},
        }

        # Save image and metadata
        p = autosave_image(img, "main_generate", meta=meta)
        
        # Build description text for the history button
        components_with_values = {k: v for k, v in meta["components"].items() if v}

        # If there are component changes, summarize them first
        if components_with_values:
            component_summary = " ; ".join(f"{k}: {v}" for k, v in components_with_values.items())
            if label_text.strip():
                label_summary = f"{label_text.strip()} — {component_summary}"
            else:
                # No edit instructions, only component edits
                label_summary = component_summary
        else:
            # No components entered — fallback to edit instructions
            label_summary = label_text.strip() or "Edit"

        # Build snapshot entry
        snap = EditSnapshot(
            timestamp=ts,
            label=label_summary,
            image_path=str(p),
            is_original=False
        )

        # Add to top of history
        self.edit_history.insert(0, snap)
        self.refresh_edit_history()

    def refresh_edit_history(self):
        for w in list(self.hist_inner.winfo_children()):
            w.destroy()
        originals = [s for s in self.edit_history if s.is_original]
        edits = [s for s in self.edit_history if not s.is_original]
        rows = edits + originals
        
        # Auto-collapse if no history entries
        if not rows:
            self.hist_frame.forget()
            self.hist_collapsed.set(True)
            # Update toggle button text
            for child in self.hist_frame.master.winfo_children():
                if isinstance(child, tk.Frame) and child != self.hist_frame:
                    for widget in child.winfo_children():
                        if isinstance(widget, tk.Button) and "Edit History" in widget.cget("text"):
                            widget.config(text="► Edit History")
            return
        
        # Ensure canvas width is properly set from the start
        self.root.after(10, self._ensure_hist_canvas_width)
        
        # Show/hide scrollbar based on number of entries (6+ entries = show scrollbar)
        if len(rows) >= 6:
            self.hist_scroll.pack(side="right", fill="y")
        else:
            self.hist_scroll.pack_forget()
        for snap in rows:
            text = "ORIGINAL IMAGE" if snap.is_original else f"{snap.timestamp} - {snap.label[:80]}{'…' if len(snap.label)>80 else ''}"
            # Highlight current selection
            is_selected = (self.current_snapshot == snap)
            bg_color = DarkTheme.BUTTON_HOVER if is_selected else DarkTheme.BUTTON_BG
            
            # Create button directly without nested frame to match restore button width
            btn = tk.Button(
                self.hist_inner,
                text=text,
                bg=bg_color,
                fg=DarkTheme.TEXT_FG,
                anchor="w",
                relief="flat",
                bd=0,
                padx=14,
                pady=10,
                activebackground=DarkTheme.BUTTON_HOVER,
                activeforeground=DarkTheme.TEXT_FG,
                command=lambda s=snap: self._restore_snapshot(s)
            )
            add_hover_effect(btn)
            btn.pack(fill="x", expand=True, pady=1)  # Same packing as restore button

    def _restore_snapshot(self, snap: EditSnapshot):
        p = Path(snap.image_path)
        img = safe_open_image(p)
        if img is None:
            self.status.set("Snapshot file missing.")
            return
        self.images["main"] = img
        self._display_image("main", img)
        self.status.set(f"Restored: {'Original' if snap.is_original else 'Edit'}")
        # Set current snapshot and refresh to show selection
        self.current_snapshot = snap
        self.refresh_edit_history()
        
        # --- Save current working text only ONCE per edit session ---
        if not getattr(self, "_unsaved_state_locked", False):
            self.unsaved_edit_text = self.edit_text.get("1.0", "end-1c")
            self.unsaved_components = {k: e.get() for k, e in self.components.items()}
            try:
                self.unsaved_components["Material Finish (Dropdown)"] = self.finish_combo.get()
                self.unsaved_components["Condition (Dropdown)"] = self.condition_combo.get()
            except Exception:
                pass
            # Lock state so it doesn't overwrite if user keeps clicking history
            self._unsaved_state_locked = True
        
        # Clear all fields first
        self.edit_text.delete("1.0", "end")
        for entry in self.components.values():
            entry.delete(0, "end")
        self.finish_combo.set("")
        self.condition_combo.set("")

        if not snap.is_original:
            try:
                meta_path = Path(snap.image_path).with_suffix(".json")
                if meta_path.exists():
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    # Restore Edit Instructions text
                    text = meta.get("prompt", "")
                    self.edit_text.insert("1.0", text.strip())

                    # Restore component values
                    comps = meta.get("components", {})
                    for name, value in comps.items():
                        if name in self.components:
                            self.components[name].insert(0, value)
                    # Restore dropdowns
                    mat_finish = comps.get("Material Finish", "")
                    cond = comps.get("Condition", "")
                    if mat_finish in self.finish_combo["values"]:
                        self.finish_combo.set(mat_finish)
                    else:
                        self.components["Material Finish"].delete(0, "end")
                        self.components["Material Finish"].insert(0, mat_finish)
                    if cond in self.condition_combo["values"]:
                        self.condition_combo.set(cond)
                    else:
                        self.components["Condition"].delete(0, "end")
                        self.components["Condition"].insert(0, cond)
            except Exception as e:
                print(f"[DEBUG] Failed to load metadata for snapshot: {e}")

    def on_restore_current(self):
        """Restore whatever was being typed before clicking history."""
        # Clear current fields first
        self.edit_text.delete("1.0", "end")
        for entry in self.components.values():
            entry.delete(0, "end")
        self.finish_combo.set("")
        self.condition_combo.set("")

        # Restore previous unsaved working text
        if self.unsaved_edit_text.strip():
            self.edit_text.insert("1.0", self.unsaved_edit_text.strip())

        # Restore weapon component text fields
        for name, value in self.unsaved_components.items():
            if name in self.components and value:
                self.components[name].insert(0, value)

        # Restore dropdowns
        finish_val = self.unsaved_components.get("Material Finish (Dropdown)", "")
        cond_val = self.unsaved_components.get("Condition (Dropdown)", "")
        if finish_val:
            self.finish_combo.set(finish_val)
        if cond_val:
            self.condition_combo.set(cond_val)

        self.status.set("Restored current working edits.")

    # Event handlers
    def on_open_material_ref(self):
        path = filedialog.askopenfilename(title="Open Material Reference",
                                          filetypes=[["Images", "*.png;*.jpg;*.jpeg;*.webp"]])
        if not path: return
        
        img = safe_open_image(Path(path))
        if img is None:
            self.status.set("Failed to load material reference.")
            return
        
        progress = self._show_progress("Processing material reference image...")
        def analyze():
            # Capture the selected weapon name
            selected_weapon = self.weapon_combo.get() or "the selected weapon"
            
            # Fixed reference interpretation mode (selector removed)
            mode = "Creative Reference Mode (Normal)"
            
            if "Extreme" in mode:
                analysis_prompt = (
                    f"Analyze this reference image as inspiration for a highly creative visual reinterpretation of the {selected_weapon}. "
                    "You may experiment with color, materials, and decorative design, but the underlying form must remain visibly that of the selected weapon. "
                    "Do not transform it into a different firearm or drastically alter its frame or major components. "
                    f"It should still be instantly recognizable as the original {selected_weapon} when viewed."
                )
            
            elif "Strict" in mode:
                analysis_prompt = (
                    f"Describe the material, texture, and finish of this reference image. "
                    f"Focus only on color, surface treatment, and material qualities that could be applied to a {selected_weapon}. "
                    f"Do not alter the shape, design, or proportions of the {selected_weapon}. "
                    "Ignore any unrelated object forms — focus purely on how these surface qualities would appear on the weapon model."
                )
            
            else:  # Creative Reference Mode (Normal)
                analysis_prompt = (
                    f"Analyze this reference image as inspiration for a creative yet grounded weapon skin for the {selected_weapon}. "
                    f"Incorporate its materials, colors, and stylistic elements while preserving the overall shape and recognizable features of the {selected_weapon}. "
                    "Minor attachments, accents, or surface design reinterpretations are allowed, but it must remain clearly and unmistakably the same weapon model. "
                    "Do not replace it with any other firearm or change its silhouette or proportions."
                )
            
            # Add enforcement clause for all modes
            analysis_prompt += (
                f"\n\nIMPORTANT: The AI must not change or reinterpret the weapon type. "
                f"All visual creativity must be applied to the {selected_weapon} only — "
                "no substitutions, renames, or reimaginings as other firearms are allowed."
            )
            
            result = self.text_ai.run(analysis_prompt, img)
            self.root.after(0, lambda: self._on_material_done(progress, result))
        import threading; threading.Thread(target=analyze, daemon=True).start()

    def _on_material_done(self, progress, result):
        self._close_progress(progress)
        if result and result != "Analysis failed":
            # Insert material description into edit instructions
            # Fixed reference interpretation mode (selector removed)
            mode = "Creative Reference Mode (Normal)"
            self.edit_text.delete("1.0", "end")
            self.edit_text.insert("1.0", f"[{mode}] Apply material reference: {result}")
            self.status.set(f"Material reference analyzed in {mode}.")
        else:
            self.status.set("Material analysis failed.")

    def on_paste_material_ref(self):
        """Grab an image from the clipboard and analyze it as a material reference."""
        from PIL import ImageGrab

        try:
            img = ImageGrab.grabclipboard()
            if isinstance(img, Image.Image):
                # We got a valid image — analyze it
                progress = self._show_progress("Analyzing material reference from clipboard...")

                def analyze():
                    # Capture the selected weapon name
                    selected_weapon = self.weapon_combo.get() or "the selected weapon"
                    
                    # Fixed reference interpretation mode (selector removed)
                    mode = "Creative Reference Mode (Normal)"
                    
                    if "Extreme" in mode:
                        analysis_prompt = (
                            f"Analyze this reference image as inspiration for a highly creative visual reinterpretation of the {selected_weapon}. "
                            "You may experiment with color, materials, and decorative design, but the underlying form must remain visibly that of the selected weapon. "
                            "Do not transform it into a different firearm or drastically alter its frame or major components. "
                            f"It should still be instantly recognizable as the original {selected_weapon} when viewed."
                        )
                    
                    elif "Strict" in mode:
                        analysis_prompt = (
                            f"Describe the material, texture, and finish of this reference image. "
                            f"Focus only on color, surface treatment, and material qualities that could be applied to a {selected_weapon}. "
                            f"Do not alter the shape, design, or proportions of the {selected_weapon}. "
                            "Ignore any unrelated object forms — focus purely on how these surface qualities would appear on the weapon model."
                        )
                    
                    else:  # Creative Reference Mode (Normal)
                        analysis_prompt = (
                            f"Analyze this reference image as inspiration for a creative yet grounded weapon skin for the {selected_weapon}. "
                            f"Incorporate its materials, colors, and stylistic elements while preserving the overall shape and recognizable features of the {selected_weapon}. "
                            "Minor attachments, accents, or surface design reinterpretations are allowed, but it must remain clearly and unmistakably the same weapon model. "
                            "Do not replace it with any other firearm or change its silhouette or proportions."
                        )
                    
                    # Add enforcement clause for all modes
                    analysis_prompt += (
                        f"\n\nIMPORTANT: The AI must not change or reinterpret the weapon type. "
                        f"All visual creativity must be applied to the {selected_weapon} only — "
                        "no substitutions, renames, or reimaginings as other firearms are allowed."
                    )
                    
                    result = self.text_ai.run(analysis_prompt, img)
                    self.root.after(0, lambda: self._on_material_done(progress, result))

                import threading
                threading.Thread(target=analyze, daemon=True).start()
            elif isinstance(img, list) and img and Path(img[0]).is_file():
                # Handle case where clipboard contains an image file path
                file_path = Path(img[0])
                img_obj = safe_open_image(file_path)
                if img_obj:
                    progress = self._show_progress("Analyzing material reference from clipboard file...")
                    def analyze():
                        # Capture the selected weapon name
                        selected_weapon = self.weapon_combo.get() or "the selected weapon"
                        
                        # Fixed reference interpretation mode (selector removed)
                        mode = "Creative Reference Mode (Normal)"
                        
                        if "Extreme" in mode:
                            analysis_prompt = (
                                f"Analyze this reference image as inspiration for a highly creative visual reinterpretation of the {selected_weapon}. "
                                "You may experiment with color, materials, and decorative design, but the underlying form must remain visibly that of the selected weapon. "
                                "Do not transform it into a different firearm or drastically alter its frame or major components. "
                                f"It should still be instantly recognizable as the original {selected_weapon} when viewed."
                            )
                        
                        elif "Strict" in mode:
                            analysis_prompt = (
                                f"Describe the material, texture, and finish of this reference image. "
                                f"Focus only on color, surface treatment, and material qualities that could be applied to a {selected_weapon}. "
                                f"Do not alter the shape, design, or proportions of the {selected_weapon}. "
                                "Ignore any unrelated object forms — focus purely on how these surface qualities would appear on the weapon model."
                            )
                        
                        else:  # Creative Reference Mode (Normal)
                            analysis_prompt = (
                                f"Analyze this reference image as inspiration for a creative yet grounded weapon skin for the {selected_weapon}. "
                                f"Incorporate its materials, colors, and stylistic elements while preserving the overall shape and recognizable features of the {selected_weapon}. "
                                "Minor attachments, accents, or surface design reinterpretations are allowed, but it must remain clearly and unmistakably the same weapon model. "
                                "Do not replace it with any other firearm or change its silhouette or proportions."
                            )
                        
                        # Add enforcement clause for all modes
                        analysis_prompt += (
                            f"\n\nIMPORTANT: The AI must not change or reinterpret the weapon type. "
                            f"All visual creativity must be applied to the {selected_weapon} only — "
                            "no substitutions, renames, or reimaginings as other firearms are allowed."
                        )
                        
                        result = self.text_ai.run(analysis_prompt, img_obj)
                        self.root.after(0, lambda: self._on_material_done(progress, result))
                    import threading
                    threading.Thread(target=analyze, daemon=True).start()
                    return
                else:
                    messagebox.showwarning("Invalid File", "Clipboard file is not a valid image.")
            else:
                messagebox.showwarning("No Image Found", "Clipboard does not contain an image.")
        except Exception as e:
            print(f"[DEBUG] Failed to read clipboard image: {e}")
            self.status.set("Clipboard image unavailable.")

    def on_extract_attributes(self):
        """Analyze any image in Main Stage and derive a weapon concept or attributes from it."""
        img = self.images.get("main")
        if img is None:
            messagebox.showwarning("No Image", "Load or generate a Main Stage image first.")
            return

        progress = self._show_progress("Analyzing image to derive a weapon concept...")

        def analyze():
            try:
                # Flexible prompt: interpret any subject as a basis for a gun concept
                analysis_prompt = (
                    "Analyze this image in detail and reinterpret it as inspiration for a unique firearm design. "
                    "If it's not a weapon, imagine what kind of gun could be derived from it — "
                    "consider its shapes, colors, materials, and visual style. "
                    "Describe this concept as if designing a themed weapon. "
                    "Then provide structured attributes as follows:\n"
                    "- Receiver: (style or type inspired by the image)\n"
                    "- Barrel: (material, shape, or pattern)\n"
                    "- Stock: (visual theme or motif)\n"
                    "- Grip: (texture, pattern, or ergonomic style)\n"
                    "- Magazine: (capacity or aesthetic theme)\n"
                    "- Optic: (sight or scope style)\n"
                    "- Muzzle: (tip design or effect)\n"
                    "- Markings: (logos, patterns, or engravings)\n"
                    "- Material Finish: (surface coating or texture)\n"
                    "- Condition: (wear level or visual state)\n\n"
                    "Start your answer with:\nDESCRIPTION: <a creative paragraph describing the inspired weapon design>."
                )
                result = self.text_ai.run(analysis_prompt, img)
                self.root.after(0, lambda: self._on_attributes_done(progress, result))
            except Exception as e:
                print(f"[ExtractAttributes] Analysis failed: {e}")
                self.root.after(0, lambda: self._on_attributes_done(progress, "Analysis failed."))

        import threading
        threading.Thread(target=analyze, daemon=True).start()

    def on_enhance_description(self):
        """Expand a short description into a full weapon concept and component list."""
        if not self.text_ai:
            messagebox.showwarning("AI Unavailable", "Text AI is not available.")
            return

        base_desc = self.edit_text.get("1.0", "end-1c").strip()
        if not base_desc:
            messagebox.showwarning("No Description", "Enter a brief weapon description first.")
            return

        progress = self._show_progress("Enhancing weapon description...")

        def enhance():
            try:
                prompt = (
                    "Take the user's short weapon description and expand it into a richer, detailed weapon concept. "
                    "Then provide structured attributes using this format:\n"
                    "- Receiver: ...\n"
                    "- Barrel: ...\n"
                    "- Stock: ...\n"
                    "- Grip: ...\n"
                    "- Magazine: ...\n"
                    "- Optic: ...\n"
                    "- Muzzle: ...\n"
                    "- Markings: ...\n"
                    "- Material Finish: ...\n"
                    "- Condition: ...\n\n"
                    "Start your answer with:\nDESCRIPTION: <a creative paragraph describing the weapon concept>\n\n"
                    f"USER DESCRIPTION:\n{base_desc}"
                )
                result = self.text_ai.run(prompt)
                self.root.after(0, lambda: self._on_enhance_done(progress, result))
            except Exception as e:
                print(f"[EnhanceDescription] Failed: {e}")
                self.root.after(0, lambda: self._on_enhance_done(progress, "Analysis failed."))

        import threading
        threading.Thread(target=enhance, daemon=True).start()

    def _on_enhance_done(self, progress, result):
        """Apply enhanced description and components from text."""
        self._close_progress(progress)

        if not result or "failed" in result.lower():
            self.status.set("⚠️ Enhancement failed or returned no data.")
            return

        try:
            lines = [l.strip() for l in result.split("\n") if l.strip()]
            description = ""
            structured_data = {}

            for line in lines:
                if line.startswith("DESCRIPTION:"):
                    description = line.replace("DESCRIPTION:", "").strip()
                elif ":" in line:
                    key, val = line.split(":", 1)
                    structured_data[key.strip()] = val.strip()

            # Fill edit instructions with the descriptive paragraph
            self.edit_text.delete("1.0", "end")
            if description:
                self.edit_text.insert("1.0", f"Enhanced weapon concept:\n{description}")
            else:
                self.edit_text.insert("1.0", result.strip())

            # Populate component fields
            for name in self.components:
                if name in structured_data:
                    entry = self.components[name]
                    entry.delete(0, "end")
                    entry.insert(0, structured_data[name])

            # Handle Material Finish and Condition
            mat_val = structured_data.get("Material Finish", "")
            cond_val = structured_data.get("Condition", "")

            if mat_val:
                if mat_val in self.finish_combo["values"]:
                    self.finish_combo.set(mat_val)
                else:
                    self.components["Material Finish"].delete(0, "end")
                    self.components["Material Finish"].insert(0, mat_val)

            if cond_val:
                if cond_val in self.condition_combo["values"]:
                    self.condition_combo.set(cond_val)
                else:
                    self.components["Condition"].delete(0, "end")
                    self.components["Condition"].insert(0, cond_val)

            self.status.set("✅ Enhanced weapon description applied to fields.")
        except Exception as e:
            print(f"[EnhanceDescription] Parsing error: {e}")
            self.status.set("⚠️ Could not parse enhanced description.")

    def _on_attributes_done(self, progress, result):
        """Process AI analysis results and populate all relevant fields."""
        self._close_progress(progress)

        if not result or "failed" in result.lower():
            self.status.set("⚠️ Analysis failed or returned no data.")
            return

        try:
            # Split lines and detect description + key/value attributes
            lines = [l.strip() for l in result.split("\n") if l.strip()]
            description = ""
            structured_data = {}

            for line in lines:
                if line.startswith("DESCRIPTION:"):
                    description = line.replace("DESCRIPTION:", "").strip()
                elif ":" in line:
                    key, val = line.split(":", 1)
                    structured_data[key.strip()] = val.strip()

            # Always fill edit instructions with the descriptive paragraph
            self.edit_text.delete("1.0", "end")
            if description:
                self.edit_text.insert("1.0", f"Inspired weapon concept:\n{description}")
            else:
                # If no "DESCRIPTION" header was found, insert full text
                self.edit_text.insert("1.0", result.strip())

            # Populate all component fields
            for name in self.components:
                if name in structured_data:
                    entry = self.components[name]
                    entry.delete(0, "end")
                    entry.insert(0, structured_data[name])

            # Handle Material Finish and Condition
            mat_val = structured_data.get("Material Finish", "")
            cond_val = structured_data.get("Condition", "")

            if mat_val:
                if mat_val in self.finish_combo["values"]:
                    self.finish_combo.set(mat_val)
                else:
                    self.components["Material Finish"].delete(0, "end")
                    self.components["Material Finish"].insert(0, mat_val)

            if cond_val:
                if cond_val in self.condition_combo["values"]:
                    self.condition_combo.set(cond_val)
                else:
                    self.components["Condition"].delete(0, "end")
                    self.components["Condition"].insert(0, cond_val)

            self.status.set("✅ Weapon concept extracted from image and applied to fields.")
            print("[ExtractAttributes] Concept successfully generated and populated.")

        except Exception as e:
            print(f"[ExtractAttributes] Parsing error: {e}")
            self.status.set("⚠️ Could not parse all attributes correctly.")

    def on_open_image(self):
        path = filedialog.askopenfilename(title="Open Image",
                                          filetypes=[["Images", "*.png;*.jpg;*.jpeg;*.webp"]])
        if not path: return
        img = safe_open_image(Path(path))
        if img is None: return
        self.images["main"] = img
        self._display_image("main", img)
        self._log_original_snapshot(img)
        self.status.set(f"Opened image: {Path(path).name}")

    def on_reset_weapon(self):
        """Fully reset the entire tool to a clean initial state."""
        # Clear all weapon images
        for key in self.images:
            self.images[key] = None
            cnv = self.view_canvases.get(key)
            if cnv:
                cnv.delete("all")
                cnv.create_text(
                    cnv.winfo_width() // 2,
                    cnv.winfo_height() // 2,
                    text="No image loaded.",
                    fill="gray",
                    font=("Segoe UI", 12, "italic")
                )

        # Clear weapon selection
        self.weapon_combo.set("None")
        self.current_weapon = None

        # Reset component fields and dropdowns
        for entry in self.components.values():
            entry.delete(0, "end")
        if hasattr(self, "finish_combo"):
            self.finish_combo.set("")
        if hasattr(self, "condition_combo"):
            self.condition_combo.set("")

        # Clear edit instructions
        self.edit_text.delete("1.0", "end")

        # Reset edit history
        self.edit_history.clear()
        self.current_snapshot = None
        self.refresh_edit_history()

        # Reset unsaved state + undo/redo stacks
        self._undo_stack.clear()
        self._redo_stack.clear()
        self.unsaved_edit_text = ""
        self.unsaved_components = {}
        self._unsaved_state_locked = False

        # Reset zoom/pan for all views
        self._zoom_factors = {v: 1.0 for v in self.view_canvases.keys()}
        self._pan_offsets = {v: [0, 0] for v in self.view_canvases.keys()}
        
        # Reset per-view edit data
        for key in self.view_edit_data:
            self.view_edit_data[key]["edit_text"] = ""
            self.view_edit_data[key]["components"] = {name: "" for name in self.view_edit_data[key]["components"]}
            self.view_edit_data[key]["finish_dropdown"] = ""
            self.view_edit_data[key]["condition_dropdown"] = ""

        self.status.set("Tool fully reset to default state.")
        print("[RESET] Full tool reset complete.")

    def on_apply_edit(self):
        self._unsaved_state_locked = False
        
        # Save the current view's text and fields before applying
        tab_index = self.notebook.index(self.notebook.select())
        tab_key = list(self.view_canvases.keys())[tab_index]
        
        self.view_edit_data[tab_key]["edit_text"] = self.edit_text.get("1.0", "end-1c")
        self.view_edit_data[tab_key]["components"] = {k: e.get() for k, e in self.components.items()}
        self.view_edit_data[tab_key]["finish_dropdown"] = self.finish_combo.get()
        self.view_edit_data[tab_key]["condition_dropdown"] = self.condition_combo.get()
        
        # Base user edit text
        edit_prompt = self.edit_text.get("1.0", "end-1c").strip()
        
        # Collect component entries
        component_specs = {name: entry.get().strip() for name, entry in self.components.items() if entry.get().strip()}
        material_finish_value = self.components.get("Material Finish", "").get().strip()
        condition_value = self.components.get("Condition", "").get().strip()

        # Intelligent component prompt builder
        component_focus_parts = []
        for name, value in component_specs.items():
            # Create natural language statements per field
            if value:
                if name == "Material Finish":
                    component_focus_parts.append(f"Apply {value} finish to the entire weapon surface.")
                elif name == "Condition":
                    component_focus_parts.append(f"The weapon condition should appear as {value.lower()}.")
                else:
                    component_focus_parts.append(f"The {name.lower()} should appear as {value}.")
        
        # Merge them into contextual prompt
        if component_focus_parts:
            component_description = "Focus edits on the following weapon components:\n" + "\n".join(component_focus_parts)
        else:
            component_description = ""

        # Build final AI prompt
        full_prompt = f"{edit_prompt}\n\n{component_description}".strip()

        if not full_prompt:
            messagebox.showwarning("No prompt", "Enter edit instructions or component modifications first.")
            return
        
        # Determine which view is active
        active_view = tab_key
        if active_view in ("ref_a", "ref_b", "ref_c"):
            self.status.set("Ref tabs are for reference images only.")
            return
        
        # Get base image — default to main if generating from main view or if no image for that view
        base = self.images.get(active_view) or self.images.get("main")
        if base is None and self.current_weapon:
            base = safe_open_image(ASSETS_DIR / f"{self.current_weapon}.png")
            self.images["main"] = base
        if base is None and self.current_weapon:
            messagebox.showwarning("No image", "Load or select a weapon first.")
            return
        
        print(f"[DEBUG] AI Generation prompt:\n{full_prompt}\n---")
        progress = self._show_progress("Generating main stage view edits...")

        # Add focused contextual phrasing before sending to Gemini
        # Enforce strict side-view rules only if no official base weapon is active
        if not self.current_weapon:
            focused_prompt = (
                f"Modify this image based on the following instructions:\n{full_prompt}\n\n"
                "Render rules:\n"
                "- Always show a clean, direct orthographic side view of the weapon.\n"
                "- The weapon must be fully visible, centered in frame, and proportionally correct.\n"
                "- Use a flat neutral grey background (hex color #3B3B3B), no surface, no environment, no hands, no props.\n"
                "- Maintain realistic lighting, accurate materials, and full resolution.\n"
                "- Focus only on the weapon body and its visual design or finish.\n"
                f"- {NO_TEXT_DIRECTIVE}"
            )
        else:
            # Preserve existing behavior for official weapon base images
            focused_prompt = (
                f"Modify only the relevant areas of the weapon image based on these instructions:\n"
                f"{full_prompt}\nDo not alter unrelated parts.\n"
                f"Maintain the flat neutral grey background (hex color #3B3B3B). {NO_TEXT_DIRECTIVE}"
            )
        
        # Add weapon lock enforcement for all generations
        if self.current_weapon:
            focused_prompt += (
                f"\n\nThe design must strictly adhere to the selected weapon model: {self.current_weapon}. "
                "No other firearm types are allowed or implied. Maintain the exact geometry and recognizable silhouette."
            )
        
        # Run async generation
        def generate_async():
            refs = self._collect_ref_images(focused_prompt)
            if base is not None:
                if refs:
                    self.status.set("Merging references with Gemini 3...")
                    result = self.image_ai.generate_with_refs(focused_prompt, base, refs)
                else:
                    result = self.image_ai.generate(focused_prompt, base)
            else:
                result = self._generate_imagen(focused_prompt)
            self.root.after(0, lambda: self._on_gen_done(progress, result, active_view))
        import threading
        threading.Thread(target=generate_async, daemon=True).start()

    def on_quick_generate(self):
        """Generate a random weapon skin concept that adheres to the base model."""
        import random
        
        weapon_list = self.weapon_combo["values"]
        if not weapon_list:
            messagebox.showwarning("No Weapons Found", "No weapons available in the asset directory.")
            return

        # Randomly select a weapon from the dropdown
        chosen_weapon = random.choice(weapon_list)
        self.weapon_combo.set(chosen_weapon)
        self.current_weapon = chosen_weapon
        self.on_weapon_selected()

        progress = self._show_progress("Generating random weapon skin concept...")

        def generate_random_prompt():
            try:
                # Ask Gemini for a random idea — fun but still a skin concept
                idea_prompt = (
                    f"Create a unique and imaginative weapon skin concept for a {chosen_weapon}. "
                    "Describe it creatively in a few sentences — include colors, materials, finish, and small aesthetic details. "
                    "Focus on visual creativity, not function or backstory."
                )
                idea_text = self.text_ai.run(idea_prompt)
                if not idea_text or "failed" in idea_text.lower():
                    idea_text = f"A random skin design for {chosen_weapon}."

                # Fill Edit Instructions with AI-generated concept
                self.edit_text.delete("1.0", "end")
                self.edit_text.insert("1.0", f"Weapon concept: {idea_text.strip()}")

                # Ask Gemini to infer matching components, finish, and condition
                analysis_prompt = (
                    f"Based on this skin idea:\n\n{idea_text}\n\n"
                    "Suggest suitable weapon components (receiver, barrel, stock, grip, magazine, optic, muzzle, markings), "
                    "plus a material finish and condition that would visually fit this concept."
                )
                analysis_result = self.text_ai.run(analysis_prompt)

                if analysis_result and ":" in analysis_result:
                    for line in analysis_result.split("\n"):
                        if ":" not in line:
                            continue
                        key, val = [p.strip() for p in line.split(":", 1)]
                        if not key or not val:
                            continue
                        if key in self.components:
                            entry = self.components[key]
                            entry.delete(0, "end")
                            entry.insert(0, val)
                        elif "material" in key.lower():
                            if val in self.finish_combo["values"]:
                                self.finish_combo.set(val)
                            else:
                                self.components["Material Finish"].delete(0, "end")
                                self.components["Material Finish"].insert(0, val)
                        elif "condition" in key.lower():
                            if val in self.condition_combo["values"]:
                                self.condition_combo.set(val)
                            else:
                                self.components["Condition"].delete(0, "end")
                                self.components["Condition"].insert(0, val)

                # Fallback: ensure something fills out even if AI misses it
                if not self.finish_combo.get() and not self.components["Material Finish"].get():
                    self.finish_combo.set(random.choice(self.finish_combo["values"]))
                if not self.condition_combo.get() and not self.components["Condition"].get():
                    self.condition_combo.set(random.choice(self.condition_combo["values"]))

                # Build proper prompt for image generation (side-view adherence)
                concept_text = self.edit_text.get("1.0", "end-1c").strip()
                
                # Conditional prompt based on whether a dropdown weapon is active
                if not self.current_weapon:
                    full_prompt = (
                        f"Generate a clean, direct orthographic side-view image of a fictional weapon.\n"
                        f"Concept details: {concept_text}\n\n"
                        "Render rules:\n"
                        "- Center the weapon fully in frame, side view only.\n"
                        "- Use a flat neutral grey background (hex color #3B3B3B), no hands, no props, no surface.\n"
                        "- Maintain consistent perspective, alignment, and lighting.\n"
                        f"- {NO_TEXT_DIRECTIVE}"
                    )
                else:
                    full_prompt = (
                        f"Using the base weapon model ({chosen_weapon}), generate a clean, direct side-view image of the weapon. "
                        "Apply this concept visually as a new skin or surface treatment, not a redesign of shape or structure. "
                        "The image should show the entire gun centered on a flat neutral grey background (hex #3B3B3B), no hands, and nothing cropped or off-screen. "
                        f"Concept details: {concept_text}. {NO_TEXT_DIRECTIVE}"
                    )

                self.root.after(200, lambda: self._start_quick_main_generate_refined(progress, full_prompt))

            except Exception as e:
                print(f"[QuickGen Error] {e}")
            self.root.after(0, lambda: self._close_progress(progress))

        import threading
        threading.Thread(target=generate_random_prompt, daemon=True).start()

    def _start_quick_main_generate_refined(self, progress, prompt_text):
        """Generate the refined main-stage image respecting structure and framing."""
        base = self.images.get("main")
        if base is None and self.current_weapon:
            base = safe_open_image(ASSETS_DIR / f"{self.current_weapon}.png")
            self.images["main"] = base
        if base is None:
            messagebox.showwarning("No image", "Unable to load base weapon image.")
            return

        # Add consistent side-view framing instruction
        focused_prompt = (
            f"{prompt_text}\n\n"
            "Keep consistent lighting, camera angle, and dimensions. Do not alter proportions.\n"
            f"Use a flat neutral grey background (hex color #3B3B3B). {NO_TEXT_DIRECTIVE}"
        )

        progress2 = self._show_progress(f"Generating {self.current_weapon} concept...")
        def gen_async():
            refs = self._collect_ref_images(focused_prompt)
            if base is not None:
                if refs:
                    result = self.image_ai.generate_with_refs(focused_prompt, base, refs)
                else:
                    result = self.image_ai.generate(focused_prompt, base)
            else:
                result = self._generate_imagen(focused_prompt)
            self.root.after(0, lambda: self._on_quick_gen_done(progress2, result))
        import threading
        threading.Thread(target=gen_async, daemon=True).start()

    def _on_quick_gen_done(self, progress, img):
        """Handle completion of quick generation."""
        self._close_progress(progress)
        if img is not None:
            img = self._ensure_landscape(img)
            self.images["main"] = img
            self._display_image("main", img)
            self._append_edit_snapshot(img, "Quick Generate Random Concept")
            self.status.set("✅ Quick weapon concept generated successfully.")
        else:
            self.status.set("❌ Quick generation failed.")

    def on_generate_all(self):
        """Generate all major camera views sequentially, centered and status-updated."""
        # Always base all view generations strictly on the main-stage image
        base = self.images.get("main")
        if base is None:
            messagebox.showwarning("No Main Stage Image", "Generate or load a Main Stage image first.")
            return
        
        print("[GENERATION] Using main-stage image as base for all views.")

        prompt = self.edit_text.get("1.0", "end-1c").strip()
        
        # Camera positioning guides for consistent angles
        camera_guides = {
            "three_quarter": "Rotate the weapon to a true 3/4 angle relative to the camera (about 45 degrees), camera at weapon centerline height.",
            "front": "Camera straight down the barrel, centered on the barrel axis.",
            "back": "Camera aligned down the sights from a few feet behind the gun, slightly lower angle (just below sightline), centered on the barrel axis so the full weapon is visible.",
            "side": "Camera exactly perpendicular to receiver, full side profile view.",
            "top": "Camera directly above the weapon, perfectly orthographic top-down view.",
            "bottom": "Camera directly below the weapon, perfectly orthographic bottom-up view."
        }
        
        views = [
            ("three_quarter", "3/4 View — rotate the weapon about 45° to the camera"),
            ("front", "Front View — straight down the barrel"),
            ("back", "Back View — low angle behind, looking down the sights"),
            ("side", "Side View — perfectly perpendicular to weapon"),
            ("top", "Top View — direct orthographic top-down"),
            ("bottom", "Bottom View — direct orthographic bottom-up")
        ]
        progress = self._show_progress("Generating all views...")
        progress.update_idletasks()

        def generate_next(index=0):
            if index >= len(views):
                self.root.after(0, lambda: self._on_views_done(progress, self.images))
                return

            view_key, view_desc = views[index]
            self.status.set(f"🛠 Generating {view_desc}...")
            self._update_progress_text(f"Generating {view_desc}...")

            # Build contextualized prompt for each view
            camera_instruction = camera_guides.get(view_key, "")
            view_prompt = (
                f"{prompt}\n\nView: {view_desc}.\n"
                f"{camera_instruction}\n"
                "Keep the exact same weapon design and proportions.\n"
                "Orthographic view only (no perspective tilt or lens distortion).\n"
                "Camera height aligned to the weapon centerline; no roll or yaw beyond the view instruction.\n"
                "Full weapon visible, centered, no crop. Do not cut off any part of the weapon.\n"
                f"Flat neutral grey background (#3B3B3B). {NO_TEXT_DIRECTIVE}"
            )

            def handle_result(img):
                if img is not None:
                    img = self._ensure_landscape(img)
                    self.images[view_key] = img
                    # Delay slightly to ensure canvas geometry is stable before drawing
                    self.root.after(50, lambda key=view_key, image=img: self._display_image(key, image))
                    self.root.after(150, lambda key=view_key, image=img: self._display_image(key, image))
                    
                    # Automatically save generated image + metadata to daily folder
                    meta = {
                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                        "weapon": self.current_weapon,
                        "view": view_key,
                        "prompt": view_prompt,
                        "components": {k: e.get() for k, e in self.components.items()},
                    }
                    autosave_image(img, view_key, meta=meta)
                    
                    self.status.set(f"✅ Finished {view_desc}.")
                # Move to next view after slight delay
                self.root.after(1000, lambda: generate_next(index + 1))

            # Run generation in background
            import threading
            def generate_view():
                refs = self._collect_ref_images(view_prompt)
                if base is not None:
                    if refs:
                        result = self.image_ai.generate_with_refs(view_prompt, base, refs)
                    else:
                        result = self.image_ai.generate(view_prompt, base)
                else:
                    result = self._generate_imagen(view_prompt)
                self.root.after(0, lambda: handle_result(result))
            threading.Thread(target=generate_view, daemon=True).start()

        generate_next()

    def _on_views_done(self, progress, results):
        """Handles completion of Generate All Views — updates displays and centers images."""
        progress.destroy()
        for key, img in results.items():
            if img is None:
                continue
            self.images[key] = img
            self._display_image(key, img)
        # Default to main stage after all are finished
        self._display_image("main", self.images["main"])
        self.status.set("✅ All perspective views generated and centered.")

    def on_generate_selected(self):
        """Generate the currently selected camera view using the Main Stage image as reference."""
        base = self.images.get("main")
        if base is None:
            messagebox.showwarning("No Main Stage Image", "Generate or load a Main Stage image first.")
            return

        # Determine which tab (view) is currently active in the notebook
        tab_index = self.notebook.index(self.notebook.select())
        tab_key = list(self.view_canvases.keys())[tab_index]
        if tab_key in ("ref_a", "ref_b", "ref_c"):
            self.status.set("Ref tabs are for reference images only.")
            return
        
        print(f"[GENERATION] Using main-stage image as base for {tab_key} view.")
        view_labels = {
            "three_quarter": "3/4 View — rotate the weapon about 45° to the camera",
            "front": "Front View — straight down the barrel",
            "back": "Back View — low angle behind, looking down the sights",
            "side": "Side View — direct perpendicular full-length shot",
            "top": "Top View — direct orthographic top-down",
            "bottom": "Bottom View — direct orthographic bottom-up",
            "main": "Main Stage"
        }

        # Skip if main stage is selected
        if tab_key == "main":
            self.status.set("Main Stage is already active — use Apply Edit instead.")
            return

        # Build context prompt for the specific view
        prompt = self.edit_text.get("1.0", "end-1c").strip()
        camera_instruction = view_labels.get(tab_key, "Alternate weapon angle view")
        view_prompt = (
            f"{prompt}\n\nView: {camera_instruction}.\n"
            "Keep the exact same weapon design and proportions.\n"
            "Orthographic view only (no perspective tilt or lens distortion).\n"
            "Camera height aligned to the weapon centerline; no roll or yaw beyond the view instruction.\n"
            "Full weapon visible, centered, no crop. Do not cut off any part of the weapon.\n"
            f"Flat neutral grey background (#3B3B3B). {NO_TEXT_DIRECTIVE}"
        )

        self.status.set(f"🛠 Generating {camera_instruction}...")
        progress = self._show_progress(f"Generating {camera_instruction}...")

        def handle_result(img):
            self._close_progress(progress)
            if img is not None:
                img = self._ensure_landscape(img)
                self.images[tab_key] = img
                self.root.after(50, lambda key=tab_key, image=img: self._display_image(key, image))
                self.root.after(150, lambda key=tab_key, image=img: self._display_image(key, image))
                
                # Auto-save selected view image + metadata
                meta = {
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "weapon": self.current_weapon,
                    "view": tab_key,
                    "prompt": view_prompt,
                    "components": {k: e.get() for k, e in self.components.items()},
                }
                autosave_image(img, tab_key, meta=meta)
                
                self.notebook.select(tab_index)
                self.status.set(f"✅ Finished {camera_instruction}.")
            else:
                self.status.set(f"❌ Failed to generate {camera_instruction}.")

        # Always generate based on main stage image reference
        import threading
        def generate_selected():
            refs = self._collect_ref_images(view_prompt)
            if base is not None:
                if refs:
                    result = self.image_ai.generate_with_refs(view_prompt, base, refs)
                else:
                    result = self.image_ai.generate(view_prompt, base)
            else:
                result = self._generate_imagen(view_prompt)
            self.root.after(0, lambda: handle_result(result))
        threading.Thread(target=generate_selected, daemon=True).start()

    def on_save_current(self):
        """Open save dialog and save the currently selected view image."""
        from tkinter import filedialog, messagebox

        # Show reminder popup
        messagebox.showinfo(
            "Reminder",
            "All generated images are already auto-saved inside:\n\n"
            "IMAGES/ALL GENERATED IMAGES\n\n"
            "This dialog allows you to manually choose another location."
        )

        # Determine which view tab is currently active
        tab_index = self.notebook.index(self.notebook.select())
        tab_key = list(self.view_canvases.keys())[tab_index]
        img = self.images.get(tab_key)
        if img is None:
            messagebox.showwarning("No Image", f"No image found in the '{tab_key}' view.")
            return

        # Ask user for save location
        file_path = filedialog.asksaveasfilename(
            title=f"Save {tab_key} view image",
            defaultextension=".png",
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")],
            initialfile=f"{tab_key}_view.png"
        )
        if not file_path:
            return

        try:
            img.save(file_path)
            messagebox.showinfo("Saved", f"Image saved successfully:\n{file_path}")
            self.status.set(f"Saved {tab_key} view to: {Path(file_path).name}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Could not save image:\n{e}")

    def on_save_all(self):
        """Open a folder dialog and save all available view images there."""
        from tkinter import filedialog, messagebox

        # Show reminder popup
        messagebox.showinfo(
            "Reminder",
            "All generated images are already auto-saved inside:\n\n"
            "IMAGES/ALL GENERATED IMAGES\n\n"
            "This dialog allows you to manually export them elsewhere."
        )

        # Ask user to choose a folder
        folder_path = filedialog.askdirectory(title="Select Folder to Save All Views")
        if not folder_path:
            return
        folder = Path(folder_path)

        saved = []
        for key, img in self.images.items():
            if img is None:
                continue
            out_path = folder / f"{key}_view.png"
            try:
                img.save(out_path)
                saved.append(out_path)
            except Exception as e:
                print(f"[SaveAll] Failed to save {key}: {e}")

        if saved:
            messagebox.showinfo("Save Complete", f"Saved {len(saved)} views to:\n{folder}")
            self.status.set(f"Saved {len(saved)} generated views to: {folder.name}")
        else:
            messagebox.showwarning("No Images", "No generated views were available to save.")

    def on_send_ps(self):
        img = self.images.get("main")
        if img is None:
            self.status.set("No image loaded to send.")
            return

        if send_to_photoshop(img):
            self.status.set("Opened image in Photoshop successfully.")
        else:
            self.status.set("Failed to open Photoshop. Check installation path.")

    def on_send_all_ps(self):
        view_order = ["main", "three_quarter", "front", "back", "side"]
        sent = 0
        for key in view_order:
            img = self.images.get(key)
            if img is None:
                continue
            if send_to_photoshop(img):
                sent += 1
        if sent:
            self.status.set(f"Sent {sent} views to Photoshop.")
        else:
            self.status.set("No images available to send.")

    def on_show_xml(self):
        """Display all current session data in a clean scrollable window with a copy button."""
        import json
        from tkinter import Toplevel, scrolledtext, messagebox

        # Collect full session data
        data = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "weapon": self.current_weapon or "(none)",
            "components": {name: ent.get() for name, ent in self.components.items()},
            "history": [asdict(s) for s in self.edit_history],
            "views": [k for k, v in self.images.items() if v is not None],
            "status": self.status.get(),
        }

        # Create modal window
        win = Toplevel(self.root)
        win.title("Session Data (JSON View)")
        win.configure(bg=DarkTheme.WINDOW_BG)
        win.geometry("800x600")
        win.resizable(True, True)
        win.attributes("-topmost", True)

        # Add scrollable text area
        text_area = scrolledtext.ScrolledText(win, wrap="word", bg=DarkTheme.INPUT_BG,
                                              fg=DarkTheme.TEXT_FG, insertbackground=DarkTheme.INPUT_FG,
                                              font=("Consolas", 10))
        text_area.pack(fill="both", expand=True, padx=10, pady=10)

        # Insert formatted JSON
        formatted_json = json.dumps(data, indent=2)
        text_area.insert("1.0", formatted_json)
        text_area.configure(state="disabled")

        # Copy button
        def copy_to_clipboard():
            self.root.clipboard_clear()
            self.root.clipboard_append(formatted_json)
            messagebox.showinfo("Copied", "Session data copied to clipboard.")

        copy_btn = tk.Button(win, text="📋 Copy to Clipboard",
                             command=copy_to_clipboard,
                             bg=DarkTheme.BUTTON_BG, fg=DarkTheme.TEXT_FG,
                             activebackground=DarkTheme.BUTTON_HOVER, relief="flat", padx=10, pady=5)
        add_hover_effect(copy_btn)
        copy_btn.pack(side="bottom", pady=(0, 10))

        self.status.set("Displayed formatted session data.")

    def on_clear_cache(self):
        """Fully reset AI cache, regenerating Gemini clients and clearing any residual patterns."""
        try:
            import google.generativeai as genai
            genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))

            # Reset text + image AI clients
            self.text_ai = GeminiClientText()
            self.image_ai = GeminiClientImage()

            # Clear temporary files and cache directories
            cache_dirs = [
                Path(__file__).parent / "__pycache__",
                Path(__file__).parent / "temp_clipboard.png",
                Path(__file__).parent / "temp_ps.png"
            ]
            for p in cache_dirs:
                if p.is_dir():
                    for f in p.glob("*"):
                        try:
                            f.unlink()
                        except Exception:
                            pass
                elif p.is_file():
                    try:
                        p.unlink()
                    except Exception:
                        pass

            self.status.set("✅ All AI cache and clients cleared successfully.")
            print("[CACHE] Gemini clients and temporary data cleared.")
        except Exception as e:
            self.status.set("⚠️ Failed to clear AI cache.")
            print(f"[CACHE ERROR] {e}")

    def on_open_output_folder(self):
        """Open Windows Explorer to the generated images folder."""
        import subprocess
        import os
        
        try:
            # Ensure the directory exists
            output_root = _get_output_root()
            
            # Open the folder in Windows Explorer
            if os.name == 'nt':  # Windows
                os.startfile(str(output_root.absolute()))
            else:  # Fallback for other systems
                subprocess.Popen(['xdg-open', str(output_root.absolute())])
            
            self.status.set(f"✅ Opened output folder: {output_root}")
        except Exception as e:
            print(f"[OpenFolder Error] {e}")
            self.status.set("⚠️ Failed to open output folder.")

    def _assign_from_main(self, key: str):
        img = self.images.get("main")
        if img is None: return
        self.images[key] = img.copy()
        self._display_image(key, self.images[key])
        self.status.set(f"Assigned Main → {key}.")

    def _show_progress(self, msg="Processing..."):
        """Display a centered progress dialog with marquee animation."""
        if self._progress_win and self._progress_win.winfo_exists():
            if self._progress_label:
                self._progress_label.config(text=msg)
            return self._progress_win

        win = tk.Toplevel(self.root)
        win.title("Please Wait")
        win.configure(bg=DarkTheme.WINDOW_BG)
        win.resizable(False, False)
        win.attributes("-topmost", True)

        # Calculate center position relative to parent window
        win.update_idletasks()
        parent_x = self.root.winfo_x()
        parent_y = self.root.winfo_y()
        parent_w = self.root.winfo_width()
        parent_h = self.root.winfo_height()
        win_w, win_h = 420, 130
        pos_x = parent_x + (parent_w // 2 - win_w // 2)
        pos_y = parent_y + (parent_h // 2 - win_h // 2)
        win.geometry(f"{win_w}x{win_h}+{pos_x}+{pos_y}")

        # Create content
        msg_label = tk.Label(
            win,
            text=msg,
            fg=DarkTheme.TEXT_FG,
            bg=DarkTheme.WINDOW_BG,
            wraplength=380,
            justify="center",
            font=("Segoe UI", 10)
        )
        msg_label.pack(pady=(20, 10))
        self._progress_label = msg_label

        # Add a marquee-style progress bar
        progress = ttk.Progressbar(
            win,
            mode="indeterminate",
            length=300
        )
        progress.pack(pady=(0, 20))
        progress.start(10)  # Speed of animation

        # Prevent user interaction while open
        win.grab_set()

        # Return handle for later destruction
        self._progress_win = win
        return win

    def _update_progress_text(self, msg: str):
        if self._progress_label:
            self._progress_label.config(text=msg)

    def _close_progress(self, win):
        try:
            if win and win.winfo_exists():
                win.destroy()
        except Exception:
            pass
        if self._progress_win is win:
            self._progress_win = None
            self._progress_label = None

    def _on_gen_done(self, progress, img, active_view="main"):
        self._close_progress(progress)
        img = self._ensure_landscape(img)
        self.images[active_view] = img
        self._display_image(active_view, img)
        self._append_edit_snapshot(img, f"{active_view.upper()} View Edit: " + (self.edit_text.get("1.0", "end-1c").strip() or "Edit"))
        self.status.set(f"Generation complete for {active_view.replace('_', ' ').title()} view.")
        
        # Clear all input fields for next edit
        self.edit_text.delete("1.0", "end")
        for entry in self.components.values():
            entry.delete(0, "end")
        self.finish_combo.set("")
        self.condition_combo.set("")

        # Update the per-view data storage to reflect cleared fields
        self.view_edit_data[active_view]["edit_text"] = ""
        self.view_edit_data[active_view]["components"] = {k: "" for k in self.view_edit_data[active_view]["components"]}
        self.view_edit_data[active_view]["finish_dropdown"] = ""
        self.view_edit_data[active_view]["condition_dropdown"] = ""

        # Reset unsaved working state after successful generation
        self.unsaved_edit_text = ""
        self.unsaved_components = {}

    def _save_undo_state(self):
        """Save current edit and component text to the undo stack."""
        state = {
            "edit_text": self.edit_text.get("1.0", "end-1c"),
            "components": {k: e.get() for k, e in self.components.items()}
        }
        self._undo_stack.append(state)
        self._redo_stack.clear()  # Clear redo after new change

    def _undo(self):
        """Undo last edit change."""
        if not self._undo_stack:
            self.status.set("Nothing to undo.")
            return

        # Save current state for redo
        current = {
            "edit_text": self.edit_text.get("1.0", "end-1c"),
            "components": {k: e.get() for k, e in self.components.items()}
        }
        self._redo_stack.append(current)

        state = self._undo_stack.pop()
        self._restore_state(state)
        self.status.set("Undo applied.")

    def _redo(self):
        """Redo previously undone change."""
        if not self._redo_stack:
            self.status.set("Nothing to redo.")
            return

        # Save current state to undo stack before reapplying redo
        current = {
            "edit_text": self.edit_text.get("1.0", "end-1c"),
            "components": {k: e.get() for k, e in self.components.items()}
        }
        self._undo_stack.append(current)

        state = self._redo_stack.pop()
        self._restore_state(state)
        self.status.set("Redo applied.")

    def _restore_state(self, state):
        """Restore edit and component fields from a saved state."""
        self.edit_text.delete("1.0", "end")
        self.edit_text.insert("1.0", state["edit_text"])
        for name, entry in self.components.items():
            entry.delete(0, "end")
            if name in state["components"]:
                entry.insert(0, state["components"][name])

class ToolTip:
    """Simple delayed tooltip with dark theme styling."""
    def __init__(self, widget, text, delay=500):
        self.widget = widget
        self.text = text
        self.delay = delay
        self.tip_window = None
        self._after_id = None
        self.widget.bind("<Enter>", self._schedule)
        self.widget.bind("<Leave>", self._hide)

    def _schedule(self, event=None):
        self._after_id = self.widget.after(self.delay, self._show)

    def _show(self):
        if self.tip_window or not self.text:
            return
        x = self.widget.winfo_rootx() + 20
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 4
        self.tip_window = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        tw.configure(bg=DarkTheme.BUTTON_BG)

        label = tk.Label(
            tw,
            text=self.text,
            bg=DarkTheme.BUTTON_BG,
            fg=DarkTheme.TEXT_FG,
            relief="solid",
            borderwidth=1,
            padx=6,
            pady=3,
            font=("Segoe UI", 9)
        )
        label.pack()

    def _hide(self, event=None):
        if self._after_id:
            self.widget.after_cancel(self._after_id)
            self._after_id = None
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None

def main():
    root = tk.Tk()
    style = setup_dark_theme(root)
    root.state("zoomed")  # Auto full-screen

    app = App(root)
    root.minsize(1200, 700)
    root.mainloop()

if __name__ == "__main__":
    main()
