#!/usr/bin/env python3
from __future__ import annotations
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
import os, io, threading, json, subprocess, sys
from pathlib import Path
from datetime import datetime
from uuid import uuid4

_BAKED_KEY = ""

GEMINI_AVAILABLE = True
try:
    from PIL import Image, ImageTk, ImageGrab
    from PIL import ImageOps, ImageChops
except ImportError as e:
    print(f"Error: {e}")
    GEMINI_AVAILABLE = False

try:
    from dark_theme import setup_dark_theme, configure_text_widget
    DARK_THEME_AVAILABLE = True
except ImportError:
    DARK_THEME_AVAILABLE = False

"""Heavy modules are lazy-loaded inside functions to speed up startup."""

"""Photoshop API is lazy-loaded inside ImageUtils.send_to_photoshop."""

APP_TITLE = "PUBG Madison Image Generation v2.0"
WINDOW_WIDTH = 1600
WINDOW_HEIGHT = 900
IMAGE_SIZE = 1024
DEBUG_CLIP = True

VIEW_REQUESTS = {
    "threequarter": "THREE-QUARTER VIEW: Camera positioned approximately 30–35 degrees to the right, elevated 10–15 degrees.",
    "front": "STRICT ORTHOGRAPHIC FRONT VIEW: Camera directly in front, no rotation.",
    "back": "STRICT ORTHOGRAPHIC BACK VIEW: Camera directly behind, no rotation.",
    "side": "STRICT ORTHOGRAPHIC RIGHT-SIDE VIEW: Camera exactly 90 degrees to the right.",
    "top": "STRICT ORTHOGRAPHIC TOP VIEW: Camera directly above, no rotation."
}

PROP_STYLE_BASE = """CRITICAL: 1:1 square (1024x1024)
Medium: Photorealistic 3D render, HIGH-QUALITY, 4K, HDR
Background: PURE WHITE
Lighting: Studio three-point
Materials: PBR workflow
ABSOLUTELY NO SHADOWS, NO GROUND SHADOWS, NO DROP SHADOWS, NO CAST SHADOWS, NO GROUND PLANE, NO SURFACE, NO FLOOR.
Object must float completely isolated with no shadow underneath or around it."""

class ImageManager:
    @staticmethod
    def save_gemini_image(
        image: Image.Image,
        prompt: str,
        ai_label: str = "image",
        generation_type: str = "auto",
        view_name: str = "main"
    ) -> Path:
        # ensure save root is next to the running exe when built with PyInstaller
        if getattr(sys, "frozen", False):
            base_dir = Path(sys.executable).parent
        else:
            base_dir = Path(__file__).parent
            mv = base_dir / "MULTIVIEW"
            if mv.exists():
                base_dir = mv

        # Shared root for all generated images
        suite_save_root = os.environ.get("PUBG_SUITE_SAVE_ROOT")
        if suite_save_root:
            all_gen_root = Path(suite_save_root)
            # Avoid doubling up the path if it's already in the env var
            if "ALL GENERATED IMAGES" not in str(all_gen_root):
                all_gen_root = all_gen_root / "IMAGES" / "ALL GENERATED IMAGES"
        else:
            all_gen_root = base_dir / "IMAGES" / "ALL GENERATED IMAGES"
            
        base_dir = all_gen_root / "Gemini"
        date_dir = base_dir / datetime.now().strftime("%Y-%m-%d")
        date_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        unique_id = uuid4().hex[:8]
        auto_name = f"{ai_label}_{timestamp}_{unique_id}_{view_name}_{generation_type}.png"
        base_name = auto_name
        counter = 1
        while (date_dir / auto_name).exists():
            auto_name = base_name.replace(".png", f"_{counter}.png")
            counter += 1
        image_path = date_dir / auto_name
        image.save(image_path, "PNG")
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "prompt": prompt,
            "mode": "gemini",
            "ai_label": ai_label,
            "generation_type": generation_type,
            "view_name": view_name
        }
        with open(image_path.with_suffix(".json"), 'w') as f:
            json.dump(metadata, f, indent=2)
        return image_path
    
    @staticmethod
    def save_multiview_image(
        image: Image.Image,
        prop_name: str,
        view: str,
        prompt: str = "",
        ai_label: str = "image",
        generation_type: str = "auto"
    ) -> Path:
        # ensure save root is next to the running exe when built with PyInstaller
        if getattr(sys, "frozen", False):
            base_dir = Path(sys.executable).parent
        else:
            base_dir = Path(__file__).parent
            mv = base_dir / "MULTIVIEW"
            if mv.exists():
                base_dir = mv

        # Shared root for all generated images
        suite_save_root = os.environ.get("PUBG_SUITE_SAVE_ROOT")
        if suite_save_root:
            all_gen_root = Path(suite_save_root)
            # Avoid doubling up the path if it's already in the env var
            if "ALL GENERATED IMAGES" not in str(all_gen_root):
                all_gen_root = all_gen_root / "IMAGES" / "ALL GENERATED IMAGES"
        else:
            all_gen_root = base_dir / "IMAGES" / "ALL GENERATED IMAGES"

        base_dir = all_gen_root / "Multiview"
        date_dir = base_dir / datetime.now().strftime("%Y-%m-%d")
        date_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        unique_id = uuid4().hex[:8]
        auto_name = f"{ai_label}_{timestamp}_{unique_id}_{view}_{generation_type}.png"
        base_name = auto_name
        counter = 1
        while (date_dir / auto_name).exists():
            auto_name = base_name.replace(".png", f"_{counter}.png")
            counter += 1
        image_path = date_dir / auto_name
        image.save(image_path, "PNG")
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "prop_name": prop_name,
            "view": view,
            "prompt": prompt,
            "ai_label": ai_label,
            "generation_type": generation_type,
            "mode": "multiview"
        }
        with open(image_path.with_suffix(".json"), 'w') as f:
            json.dump(metadata, f, indent=2)
        return image_path

class GeminiClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self._text_model = None
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            # Use a fast text-capable multimodal model for labeling
            self._text_model = genai.GenerativeModel("gemini-2.0-flash")
        except Exception as e:
            print(f"[DEBUG] GeminiClient init error: {e}")

    def describe_image_briefly(self, image: Image.Image) -> str:
        """
        Use Gemini to generate a short, one-word or two-word description for this image.
        Used for intelligent filename labeling (e.g., 'cloud', 'old_man', 'pistol').
        Returns a lowercase alphanumeric-safe string.
        """
        if not self._text_model:
            return "image"
        try:
            import io as _io, re
            buf = _io.BytesIO()
            image.save(buf, format="PNG")
            buf.seek(0)
            parts = [
                {"mime_type": "image/png", "data": buf.getvalue()},
                "Describe what this image depicts in 1-3 words (no punctuation, no adjectives, only concrete subject nouns). Example: 'woman', 'old man', 'pistol', 'forest', 'red car'. Respond with TEXT ONLY."
            ]
            result = self._text_model.generate_content(parts)
            if hasattr(result, "text") and result.text:
                label = result.text.strip().lower()
                label = re.sub(r"[^a-z0-9_]+", "_", label)
                return label or "image"
            return "image"
        except Exception as e:
            print(f"[DEBUG] describe_image_briefly error: {e}")
            return "image"

class ImageUtils:
    @staticmethod
    def copy_to_clipboard(image: Image.Image) -> bool:
        try:
            import sys
            if sys.platform == "win32":
                try:
                    import win32clipboard
                    import win32con
                    import time
                    bmp_io = io.BytesIO()
                    image.convert("RGB").save(bmp_io, "BMP")
                    dib_data = bmp_io.getvalue()[14:]
                    png_io = io.BytesIO()
                    image.save(png_io, "PNG")
                    png_data = png_io.getvalue()
                    bmp_io.close()
                    png_io.close()

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
                            return True
                        except Exception as _e:
                            try:
                                win32clipboard.CloseClipboard()
                            except Exception:
                                pass
                            time.sleep(0.05)
                except ImportError:
                    pass
                except Exception as e:
                    print(f"Clipboard error: {e}")
                    try:
                        win32clipboard.CloseClipboard()
                    except Exception:
                        pass
                    return False
            temp_path = Path(__file__).parent / "temp_clipboard.png"
            image.save(temp_path, "PNG")
            return False
        except Exception as e:
            print(f"Clipboard error: {e}")
            return False
    
    @staticmethod
    def send_to_photoshop(image: Image.Image) -> bool:
        """
        Send the current image to Adobe Photoshop.
        1. Tries COM (photoshop-python-api) first.
        2. If that fails, launches Photoshop manually with the temp image.
        3. Always returns True if Photoshop launches successfully.
        """
        import subprocess, platform, os
        from pathlib import Path

        temp_path = Path(__file__).parent / "temp_ps.png"
        try:
            image.save(temp_path, "PNG")
        except Exception as e:
            print(f"[DEBUG] Failed to save temp_ps.png: {e}")
            return False

        # --- Try Photoshop COM API ---
        try:
            import photoshop.api as ps
            app = ps.Application()
            app.load(str(temp_path))
            print("[DEBUG] Photoshop COM loaded image successfully.")
            return True
        except Exception as e:
            print(f"[DEBUG] Photoshop COM API not available: {e}")

        # --- Manual launch fallback ---
        try:
            system = platform.system()
            photoshop_path_candidates = []

            if system == "Windows":
                photoshop_path_candidates = [
                    r"C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
                    r"C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe",
                    r"C:\\Program Files (x86)\\Adobe\\Adobe Photoshop\\Photoshop.exe"
                ]
                photoshop_exe = next((p for p in photoshop_path_candidates if os.path.exists(p)), "Photoshop")
                subprocess.Popen([photoshop_exe, str(temp_path)], shell=True)

            elif system == "Darwin":  # macOS
                subprocess.Popen(["open", "-a", "Adobe Photoshop 2024", str(temp_path)])

            else:  # Linux or Wine
                subprocess.Popen(["wine", "Photoshop.exe", str(temp_path)])

            print(f"[DEBUG] Photoshop launched successfully on {system}.")
            return True

        except Exception as e:
            print(f"[DEBUG] Photoshop launch failed: {e}")
            return False
    
    @staticmethod
    def isolate_object(image: Image.Image) -> Image.Image:
        try:
            if image.mode != 'RGB':
                image = image.convert('RGB')
            try:
                from rembg import remove as rembg_remove
            except ImportError:
                rembg_remove = None
            if rembg_remove:
                img_buffer = io.BytesIO()
                image.save(img_buffer, format='PNG')
                result = rembg_remove(img_buffer.getvalue())
                image = Image.open(io.BytesIO(result)).convert('RGBA')
            else:
                image = image.convert('RGBA')
            canvas = Image.new('RGBA', (IMAGE_SIZE, IMAGE_SIZE), (255, 255, 255, 255))
            image.thumbnail((IMAGE_SIZE - 100, IMAGE_SIZE - 100), Image.Resampling.LANCZOS)
            offset = ((IMAGE_SIZE - image.width) // 2, (IMAGE_SIZE - image.height) // 2)
            canvas.paste(image, offset, image if image.mode == 'RGBA' else None)
            return canvas.convert('RGB')
        except Exception as e:
            print(f"Isolation error: {e}")
            canvas = Image.new('RGB', (IMAGE_SIZE, IMAGE_SIZE), (255, 255, 255))
            image = image.convert('RGB')
            image.thumbnail((IMAGE_SIZE - 100, IMAGE_SIZE - 100), Image.Resampling.LANCZOS)
            offset = ((IMAGE_SIZE - image.width) // 2, (IMAGE_SIZE - image.height) // 2)
            canvas.paste(image, offset)
            return canvas

# --- BEGIN: ClipboardManager (insert after ImageUtils) ---
class ClipboardManager:
    """
    App-owned clipboard. Use this first when pasting.
    Provides optional system write/read as fallback.
    """

    def __init__(self):
        self._img = None         # PIL.Image or None
        self._source = None      # Optional: 'gemini' / 'multiview' etc.

    def set_image(self, pil_image, source=None):
        """Store image in-memory (authoritative). Also attempt to write to system clipboard (best-effort)."""
        try:
            if pil_image is None:
                self.clear()
                return
            self._img = pil_image.copy()
            self._source = source
            if DEBUG_CLIP:
                print(f"[CLIP] set source={source} size={getattr(pil_image, 'size', None)}")
            try:
                ImageUtils.copy_to_clipboard(self._img)
            except Exception:
                pass
        except Exception as e:
            print(f"[ClipboardManager] set_image failed: {e}")

    def get_image(self, prefer_system_fallback=True):
        """
        Return a PIL.Image if available.
        prefer_system_fallback (bool): if in-memory empty, try ImageGrab.grabclipboard() once.
        """
        if isinstance(self._img, Image.Image):
            try:
                return self._img.copy()
            except Exception:
                return self._img
        if not prefer_system_fallback:
            return None
        try:
            sys_img = ImageGrab.grabclipboard()
            if isinstance(sys_img, Image.Image):
                if DEBUG_CLIP:
                    print(f"[CLIP] grabbed system clipboard image size={getattr(sys_img, 'size', None)}")
                return sys_img
        except Exception:
            pass
        return None

    def clear(self):
        self._img = None
        self._source = None

    def source(self):
        return self._source
# --- END: ClipboardManager ---
    
    @staticmethod
    def fit_to_display(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
        display_img = image.copy()
        display_img.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
        return display_img

# --- Auto-crop and resize helper ---
def autocrop_and_resize(img, target_size=(1024, 1024)):
    """
    Automatically crop empty/white/gray borders and resize to a target size.
    Mimics the Character Generator's portrait/landscape aspect behavior.
    """
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
    # Resize + center within the target aspect ratio
    return ImageOps.fit(img, target_size, Image.Resampling.LANCZOS, centering=(0.5, 0.5))

class ProcessingPopup:
    def __init__(self, parent, message="Generating..."):
        from dark_theme import DarkTheme

        self.window = tk.Toplevel(parent)
        self.window.title("Please Wait")
        self.window.geometry("420x130")
        self.window.resizable(False, False)
        self.window.configure(bg=DarkTheme.WINDOW_BG)
        self.window.grab_set()
        # --- Center popup in parent window ---
        parent.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() // 2) - 210
        y = parent.winfo_y() + (parent.winfo_height() // 2) - 65
        self.window.geometry(f"+{x}+{y}")
        ttk.Label(self.window, text=message, background=DarkTheme.WINDOW_BG, foreground=DarkTheme.TEXT_FG).pack(pady=12)
        self.progress = ttk.Progressbar(self.window, mode="indeterminate", length=280)
        self.progress.pack(pady=5)
        self.progress.start(10)
        # Defer update to keep UI responsive
        self.window.after(0, self.window.update)

    def close(self):
        self.progress.stop()
        self.window.destroy()

class DualModeApp:
    def __init__(self, root, api_key: str, capabilities=None, start_mode="gemini", hide_internal_tabs=False):
        self.root = root
        self.root.title(APP_TITLE)
        # --- Window Geometry State File ---
        self._window_state_file = Path(__file__).parent / "window_state.json"
        # --- Restore Last Window Geometry (if available) ---
        def _restore_geometry():
            if self._window_state_file.exists():
                try:
                    data = json.loads(self._window_state_file.read_text())
                    geom = data.get("geometry")
                    if geom:
                        self.root.geometry(geom)
                    else:
                        self.root.geometry("1600x950+50+50")
                except Exception as e:
                    print(f"[WARN] Failed to load window geometry: {e}")
                    self.root.geometry("1600x950+50+50")
            else:
                self.root.geometry("1600x950+50+50")
        _restore_geometry()
        if DARK_THEME_AVAILABLE:
            setup_dark_theme(self.root)
        self.api_key = api_key
        self.gemini_client = GeminiClient(api_key)
        # authoritative app clipboard
        self.clipboard = ClipboardManager()
        self.capabilities = capabilities or {}
        self.current_mode = start_mode
        self.hide_internal_tabs = hide_internal_tabs
        self.mode_buttons = {}

        # clipboard helpers
        def _copy_to_app_clipboard(pil_img, source, success_msg=None, fail_msg=None):
            try:
                self.clipboard.set_image(pil_img, source=source)
                self._clipboard_image = self.clipboard.get_image()
                if DEBUG_CLIP:
                    print(f"[CLIP] _copy_to_app_clipboard source={source}")
                if success_msg:
                    self.status_var.set(success_msg)
                return True
            except Exception as e:
                if fail_msg:
                    self.status_var.set(f"{fail_msg} ({e})")
                return False

        def _paste_from_app_or_system():
            try:
                # 1) Try system clipboard FIRST (win32 PNG/DIB) for cross-app compatibility
                try:
                    import win32clipboard, win32con
                    import time
                    from io import BytesIO
                    sys_img = None
                    
                    # Attempt to open clipboard with retries
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
                                                sys_img = Image.open(BytesIO(data)).convert("RGB")
                                                break
                                    except Exception:
                                        continue
                                
                                # Fallback to DIB (universal)
                                if sys_img is None and win32clipboard.IsClipboardFormatAvailable(win32con.CF_DIB):
                                    dib = win32clipboard.GetClipboardData(win32con.CF_DIB)
                                    if isinstance(dib, bytes):
                                        header_size = int.from_bytes(dib[0:4], "little") if len(dib) >= 4 else 40
                                        off_bits = 14 + header_size
                                        bmp_header = b"BM" + (len(dib) + 14).to_bytes(4, "little") + b"\x00\x00\x00\x00" + off_bits.to_bytes(4, "little")
                                        sys_img = Image.open(BytesIO(bmp_header + dib)).convert("RGB")
                            finally:
                                win32clipboard.CloseClipboard()
                            
                            if sys_img:
                                break
                        except Exception:
                            time.sleep(0.05)
                            
                    if isinstance(sys_img, Image.Image):
                        if DEBUG_CLIP:
                            print(f"[CLIP] paste from system clipboard (win32) size={getattr(sys_img, 'size', None)}")
                        return sys_img
                except Exception as e:
                    if DEBUG_CLIP:
                        print(f"[CLIP] system clipboard win32 read failed: {e}")

                # 2) App clipboard fallback (if system was empty/busy)
                img = self.clipboard.get_image(prefer_system_fallback=False)
                if isinstance(img, Image.Image):
                    if DEBUG_CLIP:
                        print(f"[CLIP] paste from app clipboard source={self.clipboard.source()}")
                    return img

                # 3) PIL fallback (includes file drop list handling)
                try:
                    from PIL import ImageGrab
                    grabbed = ImageGrab.grabclipboard()
                    if isinstance(grabbed, Image.Image):
                        if DEBUG_CLIP:
                            print(f"[CLIP] paste from system clipboard (PIL) size={getattr(grabbed, 'size', None)}")
                        return grabbed
                    if isinstance(grabbed, (list, tuple)) and grabbed:
                        try:
                            path = grabbed[0]
                            if DEBUG_CLIP:
                                print(f"[CLIP] paste from file path on clipboard: {path}")
                            return Image.open(path).convert("RGB")
                        except Exception as e:
                            if DEBUG_CLIP:
                                print(f"[CLIP] failed to open file from clipboard list: {e}")
                except Exception:
                    pass

                return None
            except Exception:
                return None

        self._copy_to_app_clipboard = _copy_to_app_clipboard
        self._paste_from_app_or_system = _paste_from_app_or_system

        if not self.hide_internal_tabs:
            # --- File-Tab Style Mode Bar ---
            top_bar = tk.Frame(self.root, bg="#4F4F4F", height=48)
            top_bar.pack(side=tk.TOP, fill=tk.X)

            def make_tab_button(text, mode_key):
                # --- Button container ---
                wrapper = ttk.Frame(top_bar)
                wrapper.pack(side=tk.LEFT, padx=(0, 2))

                # --- Main tab button ---
                btn = tk.Button(
                    wrapper,
                    text=text,
                    font=("Segoe UI", 11, "bold"),
                    relief="raised",
                    bd=1,
                    padx=18,
                    pady=5,
                    fg="#E0E0E0",
                    bg="#3A3A3A",
                    activebackground="#6A3A3A".replace("3A3A3A", "6A6A6A"),
                    activeforeground="#FFFFFF",
                    highlightthickness=1,
                    highlightbackground="#3A3A3A",
                    command=lambda: self._select_mode_tab(mode_key)
                )
                btn.pack(fill=tk.X)

                # --- Active indicator label (starts hidden) ---
                lbl = ttk.Label(
                    wrapper,
                    text="(active)",
                    font=("Segoe UI", 8, "italic"),
                    foreground="#AAAAAA"
                )
                lbl.pack(pady=(0, 2))
                lbl.place(relx=0.5, rely=1.0, anchor="n")
                lbl.place_forget()

                self.mode_buttons[mode_key] = {"button": btn, "label": lbl}
                return btn

            # Create tab buttons
            make_tab_button("Gemini", "gemini")
            make_tab_button("Multi-View", "multiview")

            # Optional subtle divider line
            divider = tk.Frame(self.root, height=1, bg="#3A3A3A")
            divider.pack(fill=tk.X, side=tk.TOP)

        # Initialize selection later after UI is built
        self.container = ttk.Frame(self.root)
        self.container.pack(fill=tk.BOTH, expand=True)
        self.status_var = tk.StringVar(value="Ready")
        status_bar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)
        self.build_gemini_ui()
        self.multiview_content = None
        # Image history tracking
        self.image_history = []   # list of Image objects generated in this session
        self.history_index = -1   # current position in history (−1 = none)
        # --- Edit History for Gemini and Multi-View ---
        self.edit_registry = {"gemini": {}, "multiview": {}}  # image_path → [ {timestamp, prompt, image_file, is_original} ]
        self.active_edit = {"gemini": None, "multiview": None}
        # Keep startup quiet; leave status as Ready
        self.show_mode(start_mode)
        # Now set tab visuals to match current mode
        if not self.hide_internal_tabs:
            try:
                self._select_mode_tab(start_mode)
            except Exception:
                pass
        # Preload Gemini model in background
        threading.Thread(target=self._preload_gemini_model, daemon=True).start()
        # Handle window closing to persist geometry
        try:
            self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        except Exception:
            pass
        # --- Auto-resize to show full UI ---
        try:
            self._ensure_min_window_size()
            # --- Final geometry correction ---
            self.root.after(500, lambda: self._adjust_window_size())
        except Exception:
            pass
    
    def show_mode(self, mode: str):
        self.current_mode = mode
        if mode == "gemini":
            if self.multiview_content:
                self.multiview_content.pack_forget()
            self.gemini_content.pack(fill=tk.BOTH, expand=True)
        else:
            if not self.multiview_content:
                self.build_multiview_ui()
            self.gemini_content.pack_forget()
            self.multiview_content.pack(fill=tk.BOTH, expand=True)

    def _select_mode_tab(self, mode_key):
        """Visually update tab styles and switch between Gemini / Multi-View."""
        self.current_mode = mode_key

        # If internal tabs are hidden, just switch content
        if self.hide_internal_tabs:
            self.show_mode(mode_key)
            return

        # Update button visuals to simulate file tabs
        for key, elements in self.mode_buttons.items():
            btn = elements["button"]
            lbl = elements["label"]
            if key == mode_key:
                btn.config(
                    relief="raised",
                    bg="#6A6A6A",
                    fg="#FFFFFF",
                    font=("Segoe UI", 11, "bold")
                )
                lbl.place(relx=0.5, rely=1.0, anchor="n")
            else:
                btn.config(
                    relief="flat",
                    bg="#3A3A3A",
                    fg="#E0E0E0",
                    font=("Segoe UI", 11, "normal")
                )
                lbl.place_forget()

        # Switch displayed content
        self.show_mode(mode_key)

    def _preload_gemini_model(self):
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            genai.GenerativeModel("gemini-3-pro-image-preview")
            try:
                self.root.after(0, self.status_var.set, "Imagen 4 cached and ready.")
            except Exception:
                pass
        except Exception as e:
            print(f"Preload failed: {e}")
    
    def _adjust_window_size(self):
        """Ensure all widgets are visible after layout settles."""
        try:
            self.root.update_idletasks()
            w = max(self.root.winfo_width(), 1600)
            h = max(self.root.winfo_height(), 950)
            screen_w = self.root.winfo_screenwidth()
            screen_h = self.root.winfo_screenheight()
            if h > screen_h - 50:
                h = screen_h - 80
            if w > screen_w - 50:
                w = screen_w - 80
            self.root.minsize(w, h)
            self.root.geometry(f"{w}x{h}+50+30")
        except Exception:
            pass

    def _ensure_min_window_size(self):
        """
        Compute and set a guaranteed minimum window size large enough to fit
        all UI elements (buttons, frames, tabs, etc.) without cutoff.
        """
        try:
            # Allow all frames to finish rendering first
            self.root.update_idletasks()

            # Measure required width/height of main container + margins
            required_w = max(self.container.winfo_reqwidth() + 80, 1650)
            required_h = max(self.container.winfo_reqheight() + 120, 980)

            # Get available screen size
            screen_w = self.root.winfo_screenwidth()
            screen_h = self.root.winfo_screenheight()

            # Clamp window size to screen
            target_w = min(required_w, screen_w - 60)
            target_h = min(required_h, screen_h - 60)

            # Ensure minimum for full UI (never smaller than safe baseline)
            target_w = max(target_w, 1650)
            target_h = max(target_h, 980)

            # Apply geometry
            self.root.minsize(target_w, target_h)
            self.root.geometry(f"{target_w}x{target_h}+50+40")
            self.root.update()

            # Double-check after render (second pass)
            self.root.after(300, self._final_geometry_check)
        except Exception as e:
            print(f"[DEBUG] _ensure_min_window_size error: {e}")

    def _final_geometry_check(self):
        """Final safety check after all panels and buttons are drawn."""
        try:
            self.root.update_idletasks()

            # Get current dimensions and available screen size
            w = self.root.winfo_width()
            h = self.root.winfo_height()
            req_w = max(self.container.winfo_reqwidth() + 80, 1650)
            req_h = max(self.container.winfo_reqheight() + 120, 980)

            screen_w = self.root.winfo_screenwidth()
            screen_h = self.root.winfo_screenheight()

            # If too small, enlarge to fit all content again
            if h < req_h or w < req_w:
                new_w = min(req_w, screen_w - 60)
                new_h = min(req_h, screen_h - 60)
                self.root.geometry(f"{new_w}x{new_h}+50+40")
                self.root.update()
                print(f"[DEBUG] Window auto-expanded to {new_w}x{new_h} for full UI visibility.")
        except Exception as e:
            print(f"[DEBUG] _final_geometry_check error: {e}")

    def _on_multiview_prompt_return(self, event):
        """Handle Enter key in Multi-View prompt: generate or edit."""
        prompt = self.multiview_prompt_text.get("1.0", tk.END).strip()
        if not prompt:
            self.status_var.set("Please type something before pressing Enter.")
            return "break"
        # If no image exists yet → generate new prop
        if not getattr(self, "multiview_main_stage_image", None):
            self.status_var.set(f"🎨 Generating new prop: {prompt}")
            self.multiview_generate_from_text(prompt)
        else:
            # Otherwise, apply to existing image
            self.status_var.set(f"🛠️ Applying edit to current prop: {prompt}")
            self.multiview_edit_existing_image(prompt)
        return "break"

    def on_closing(self):
        # --- Save Window Geometry Before Exit ---
        try:
            geom = self.root.geometry()
            data = {"geometry": geom}
            self._window_state_file.write_text(json.dumps(data), encoding="utf-8")
            print(f"[DEBUG] Saved window geometry: {geom}")
        except Exception as e:
            print(f"[WARN] Failed to save window geometry: {e}")
        # proceed to close
        try:
            self.root.destroy()
        except Exception:
            pass

    def _get_generated_images_root(self, mode: str) -> Path:
        if getattr(sys, "frozen", False):
            base_dir = Path(sys.executable).parent
        else:
            base_dir = Path(__file__).parent
            mv = base_dir / "MULTIVIEW"
            if mv.exists():
                base_dir = mv
        
        suite_save_root = os.environ.get("PUBG_SUITE_SAVE_ROOT")
        if suite_save_root:
            all_gen_root = Path(suite_save_root)
            if "ALL GENERATED IMAGES" not in str(all_gen_root):
                all_gen_root = all_gen_root / "IMAGES" / "ALL GENERATED IMAGES"
        else:
            all_gen_root = base_dir / "IMAGES" / "ALL GENERATED IMAGES"

        subdir = "Gemini" if mode == "gemini" else "Multiview"
        return all_gen_root / subdir

    def open_gemini_generated_images(self):
        try:
            folder = self._get_generated_images_root("gemini")
            folder.mkdir(parents=True, exist_ok=True)
            os.startfile(str(folder))
            self.status_var.set("Opened Gemini generated images folder.")
        except Exception as e:
            self.status_var.set(f"Could not open generated images: {e}")

    def open_multiview_generated_images(self):
        try:
            folder = self._get_generated_images_root("multiview")
            folder.mkdir(parents=True, exist_ok=True)
            os.startfile(str(folder))
            self.status_var.set("Opened Multiview generated images folder.")
        except Exception as e:
            self.status_var.set(f"Could not open generated images: {e}")
    
    def build_gemini_ui(self):
        self.gemini_content = ttk.Frame(self.container)
        self.gemini_current_image = None
        self.gemini_current_prompt = ""
        self.gemini_is_generating = False
        self.gemini_mode_var = tk.StringVar(value="quality")
        self.gemini_ref_images = {"ref_a": None, "ref_b": None, "ref_c": None}
        left_panel = ttk.Frame(self.gemini_content, width=350)
        left_panel.pack(side=tk.LEFT, fill=tk.Y, padx=10, pady=10)
        left_panel.pack_propagate(False)
        input_frame = ttk.LabelFrame(left_panel, text="Input", padding="10")
        input_frame.pack(fill=tk.X, pady=(0, 10))
        ttk.Button(input_frame, text="Open Image", command=self.gemini_open_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(input_frame, text="Copy Image", command=self.gemini_copy_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(input_frame, text="Paste Image", command=self.gemini_paste_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(input_frame, text="Reset", command=self.gemini_reset_session, width=25).pack(fill=tk.X, pady=2)
        
        # Speed/Quality Toggle Frame
        mode_frame = ttk.Frame(input_frame)
        mode_frame.pack(fill=tk.X, pady=(5, 0))
        ttk.Radiobutton(mode_frame, text="QUALITY 2k", variable=self.gemini_mode_var, value="quality").pack(side=tk.LEFT, expand=True)
        ttk.Radiobutton(mode_frame, text="SPEED 1k", variable=self.gemini_mode_var, value="speed").pack(side=tk.LEFT, expand=True)

        prompt_frame = ttk.LabelFrame(left_panel, text="Prompt", padding="10")
        prompt_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))
        
        ttk.Label(prompt_frame, text="Describe image:").pack(anchor=tk.W, pady=(10, 0))
        self.gemini_prompt_text = tk.Text(prompt_frame, height=15, wrap=tk.WORD)
        self.gemini_prompt_text.pack(fill=tk.BOTH, expand=True, pady=5)

        # Move Generate button directly under Describe Image
        ttk.Button(prompt_frame, text="Generate Image", command=self.gemini_generate, width=25).pack(fill=tk.X, pady=(5, 8))

        # --- Edit History Panel ---
        self.create_edit_history_panel(prompt_frame, "gemini")
        if DARK_THEME_AVAILABLE:
            configure_text_widget(self.gemini_prompt_text)
        # Enter submits; Shift+Enter inserts newline
        self.gemini_prompt_text.bind("<Return>", self._on_gemini_prompt_return)
        self.gemini_prompt_text.bind("<Shift-Return>", lambda e: None)
        action_frame = ttk.LabelFrame(left_panel, text="Actions", padding="10")
        action_frame.pack(fill=tk.X)
        ttk.Button(action_frame, text="Send to PS", command=self.gemini_send_to_ps, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(action_frame, text="Save Image", command=self.gemini_save_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(action_frame, text="Open Generated Images", command=self.open_gemini_generated_images, width=25).pack(fill=tk.X, pady=2)
        right_panel = ttk.Frame(self.gemini_content)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        self.gemini_notebook = ttk.Notebook(right_panel)
        self.gemini_notebook.pack(fill=tk.BOTH, expand=True)

        self.gemini_canvases = {}

        def make_canvas(tab, key, enable_zoom):
            frame = ttk.Frame(tab)
            frame.pack(fill=tk.BOTH, expand=True)
            if enable_zoom:
                toolbar = ttk.Frame(frame)
                toolbar.pack(side=tk.TOP, fill=tk.X)
                ttk.Label(toolbar, text="Zoom").pack(side=tk.LEFT, padx=4)
                ttk.Button(toolbar, text="-", width=3, command=lambda: self._zoom_main_stage(0.9)).pack(side=tk.LEFT, padx=2)
                ttk.Button(toolbar, text="+", width=3, command=lambda: self._zoom_main_stage(1.1)).pack(side=tk.LEFT, padx=2)
            canvas = tk.Canvas(frame, bg="#222222", highlightthickness=0)
            canvas.pack(fill=tk.BOTH, expand=True)
            self.gemini_canvases[key] = canvas
            if enable_zoom:
                canvas.bind("<ButtonPress-1>", self._on_main_stage_press)
                canvas.bind("<B1-Motion>", self._on_main_stage_drag)
                canvas.bind("<ButtonRelease-1>", self._on_main_stage_release)
                canvas.bind("<ButtonPress-2>", self._on_main_stage_press)
                canvas.bind("<B2-Motion>", self._on_main_stage_drag)
                canvas.bind("<ButtonRelease-2>", self._on_main_stage_release)
                canvas.bind("<Button-3>", lambda e: self._show_gemini_context_menu(e))
                canvas.bind("<MouseWheel>", self._on_main_stage_scroll)
                canvas.bind("<Button-4>", lambda e: self._zoom_main_stage(1.1))
                canvas.bind("<Button-5>", lambda e: self._zoom_main_stage(0.9))
                canvas.bind_all("<Escape>", lambda e: self._reset_gemini_zoom())
            else:
                canvas.bind("<Button-3>", lambda e, k=key: self._show_ref_context_menu(k, e))

        # Main Stage tab
        main_stage = ttk.Frame(self.gemini_notebook)
        self.gemini_notebook.add(main_stage, text="Main Stage")
        make_canvas(main_stage, "main", enable_zoom=True)

        # Reference tabs
        for key, label in [("ref_a", "Ref A"), ("ref_b", "Ref B"), ("ref_c", "Ref C")]:
            tab = ttk.Frame(self.gemini_notebook)
            self.gemini_notebook.add(tab, text=label)
            make_canvas(tab, key, enable_zoom=False)

        self._main_stage_zoom = 1.0
        self._main_stage_offset = [0, 0]
        self._main_stage_last_pos = None
        self._main_stage_drag_update_pending = False
        self.gemini_image_on_canvas = None

    def _on_gemini_prompt_return(self, event):
        # Trigger generate on Enter without inserting a newline
        try:
            self.gemini_generate()
        except Exception:
            pass
        return "break"

    # --- ZOOM & PAN HANDLERS ---
    def _zoom_main_stage(self, factor):
        self._main_stage_zoom *= factor
        self._main_stage_zoom = max(0.1, min(self._main_stage_zoom, 10.0))
        self.gemini_update_display()

    def _on_main_stage_scroll(self, event):
        # scroll up/down zoom
        factor = 1.1 if event.delta > 0 else 0.9
        self._zoom_main_stage(factor)

    def _on_main_stage_press(self, event):
        self._main_stage_last_pos = (event.x, event.y)
        self.root.config(cursor="fleur")

    def _on_main_stage_drag(self, event):
        if self._main_stage_last_pos:
            dx = event.x - self._main_stage_last_pos[0]
            dy = event.y - self._main_stage_last_pos[1]
            self._main_stage_offset[0] += dx
            self._main_stage_offset[1] += dy
            self._main_stage_last_pos = (event.x, event.y)
            
            # Throttle updates: only update if no pending update
            if not self._main_stage_drag_update_pending:
                self._main_stage_drag_update_pending = True
                self.root.after(16, self._do_main_stage_drag_update)  # ~60fps

    def _do_main_stage_drag_update(self):
        """Throttled update during drag to reduce flicker."""
        self.gemini_update_display(force_update=False)
        self._main_stage_drag_update_pending = False
    
    def _on_main_stage_release(self, event):
        self._main_stage_last_pos = None
        self.root.config(cursor="")
        self._main_stage_drag_update_pending = False
        # Final smooth update after drag
        self.gemini_update_display(force_update=True)
    
    def _show_gemini_context_menu(self, event):
        from dark_theme import DarkTheme
        menu = tk.Menu(self.root, tearoff=0, bg=DarkTheme.FRAME_BG, fg=DarkTheme.TEXT_FG)
        menu.add_command(label="💾 Save Image", command=self._save_gemini_image)
        menu.add_command(label="📋 Copy Image", command=self._copy_gemini_image_enhanced)
        menu.add_command(label="📥 Paste Image", command=self._paste_gemini_image)
        menu.add_command(label="📂 Open Image...", command=self.gemini_open_image)
        menu.add_separator()
        menu.add_command(label="🔍 Reset View", command=lambda: self._reset_gemini_zoom("main"))
        menu.tk_popup(event.x_root, event.y_root)
    
    def _save_gemini_image(self):
        if not self.gemini_current_image:
            messagebox.showwarning("No Image", "No image to save.")
            return
        path = filedialog.asksaveasfilename(
            title="Save Gemini Image",
            defaultextension=".png",
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        if path:
            try:
                self.gemini_current_image.save(path)
                self.status_var.set(f"Saved to {Path(path).name}")
            except Exception as e:
                messagebox.showerror("Save Error", f"Could not save: {e}")
    
    def _copy_gemini_image_enhanced(self):
        if not self.gemini_current_image:
            self.status_var.set("No image to copy.")
            return
        try:
            self._copy_to_app_clipboard(self.gemini_current_image, source="gemini", success_msg="✅ Image copied to app clipboard", fail_msg="Copy failed")
            self._clipboard_image = self.clipboard.get_image()
        except Exception as e:
            self.status_var.set(f"Copy failed: {e}")
    
    def _paste_gemini_image(self):
        try:
            img = self._paste_from_app_or_system()
            if isinstance(img, Image.Image):
                self.gemini_current_image = img.convert("RGB")
                self._main_stage_zoom = 1.0
                self._main_stage_offset = [0, 0]
                self.gemini_update_display(force_update=True)
                self.root.after(100, lambda: self.gemini_update_display(force_update=True))
                self.status_var.set("Pasted image into Gemini view")
            else:
                messagebox.showinfo("No Image", "Clipboard does not contain an image")
        except Exception as e:
            messagebox.showerror("Paste Error", f"Could not paste: {e}")
    
    def gemini_reset_session(self):
        """Completely reset the Gemini session and clear the canvas image."""
        self.gemini_is_generating = False
        self.gemini_current_image = None
        self.gemini_current_prompt = ""
        self.image_history = []
        self.history_index = -1
        # Clear ref images
        for k in ["ref_a", "ref_b", "ref_c"]:
            self.gemini_ref_images[k] = None
        self.gemini_prompt_text.delete("1.0", tk.END)
        # Clear canvases (main + refs)
        for cnv in self.gemini_canvases.values():
            try:
                cnv.delete("all")
            except Exception:
                pass
        self._main_stage_zoom = 1.0
        self._main_stage_offset = [0, 0]
        self._main_stage_last_pos = None
        self.status_var.set("Session reset and canvas cleared.")
        # clear edit history panel
        try:
            self._reset_edit_history("gemini")
        except Exception:
            pass
    
    def gemini_open_image(self):
        path = filedialog.askopenfilename(title="Select Image", filetypes=[("Images", "*.png *.jpg *.jpeg *.bmp"), ("All", "*.*")])
        if path:
            try:
                self.gemini_current_image = Image.open(path)
                self._main_stage_zoom = 1.0
                self._main_stage_offset = [0, 0]
                self.gemini_update_display(force_update=True)
                self.root.after(100, lambda: self.gemini_update_display(force_update=True))
                self.status_var.set("Image loaded")
            except Exception as e:
                messagebox.showerror("Error", f"Failed: {e}")
    
    def gemini_paste_image(self):
        try:
            img = self._paste_from_app_or_system()
            if isinstance(img, Image.Image):
                self.gemini_current_image = img.convert("RGB")
                self._main_stage_zoom = 1.0
                self._main_stage_offset = [0, 0]
                self.gemini_update_display(force_update=True)
                self.root.after(100, lambda: self.gemini_update_display(force_update=True))
                self.status_var.set("Image pasted")
            else:
                messagebox.showwarning("No Image", "No image in clipboard")
        except Exception as e:
            messagebox.showerror("Paste Error", f"Could not paste image:\n{e}")
    
    def gemini_generate(self):
        if self.gemini_is_generating:
            return
        prompt = self.gemini_prompt_text.get("1.0", tk.END).strip()
        if not prompt:
            messagebox.showwarning("No Prompt", "Enter a prompt")
            return
        self.gemini_current_prompt = prompt
        base_image = self.gemini_current_image
        ref_images = {k: v for k, v in self.gemini_ref_images.items()}
        quality_mode = (self.gemini_mode_var.get() == "quality")
        self.gemini_is_generating = True
        self.status_var.set("Generating image...")
        self.gemini_processing_popup = ProcessingPopup(self.root, "Generating image...")
        threading.Thread(
            target=self.gemini_generate_thread,
            args=(prompt, base_image, ref_images, quality_mode),
            daemon=True
        ).start()
    
    def gemini_generate_thread(self, prompt: str, base_image: Image.Image | None, ref_images: dict, quality_mode: bool = False):
        try:
            from google import genai as genai_images
            from google.genai import types as genai_types

            prompt_lower = prompt.lower()
            use_ref_a = "ref a" in prompt_lower or "ref_a" in prompt_lower or "refa" in prompt_lower
            use_ref_b = "ref b" in prompt_lower or "ref_b" in prompt_lower or "refb" in prompt_lower
            use_ref_c = "ref c" in prompt_lower or "ref_c" in prompt_lower or "refc" in prompt_lower

            use_imagen3 = False
            if use_ref_a and ref_images.get("ref_a"):
                use_imagen3 = True
            if use_ref_b and ref_images.get("ref_b"):
                use_imagen3 = True
            if use_ref_c and ref_images.get("ref_c"):
                use_imagen3 = True

            final_prompt = prompt.strip()

            client = genai_images.Client(api_key=self.api_key)
            if use_imagen3:
                # --- Gemini 3 Pro Image Preview for ref-based synthesis ---
                import google.generativeai as genai_legacy
                genai_legacy.configure(api_key=self.api_key)
                model = genai_legacy.GenerativeModel("gemini-3-pro-image-preview")

                parts = []
                for key in ["ref_a", "ref_b", "ref_c"]:
                    img = ref_images.get(key)
                    if img:
                        if key.replace("_", " ") in prompt_lower or key.replace("_", "") in prompt_lower:
                            # Use higher resolution for refs if quality mode is on
                            ref_img = img.copy()
                            max_dim = 2048 if quality_mode else 1024
                            if max(ref_img.size) > max_dim:
                                ref_img.thumbnail((max_dim, max_dim), Image.LANCZOS)
                            buf = io.BytesIO()
                            ref_img.save(buf, format="PNG")
                            parts.append({"mime_type": "image/png", "data": buf.getvalue()})
                
                parts.append(final_prompt)
                self.root.after(0, self.status_var.set, "Merging images with Gemini 3...")
                result = model.generate_content(parts, generation_config={"temperature": 0.8, "candidate_count": 1})
                
                for part in getattr(result, "parts", []):
                    if hasattr(part, "inline_data") and part.inline_data:
                        img_data = part.inline_data.data
                        if isinstance(img_data, bytes):
                            img = Image.open(io.BytesIO(img_data)).convert("RGB")
                            self.root.after(0, self.status_var.set, "Image generated (Gemini 3).")
                            self.gemini_current_image = img
                            # Update display IMMEDIATELY before slow labeling/saving
                            self.root.after(0, lambda: self.gemini_update_display(force_update=True))
                            self.root.after(0, lambda: self.gemini_prompt_text.delete("1.0", tk.END))

                            try:
                                ai_label = self.gemini_client.describe_image_briefly(img)
                            except Exception:
                                ai_label = "image"
                            
                            ImageManager.save_gemini_image(img, self.gemini_current_prompt, ai_label=ai_label, generation_type="auto", view_name="main")
                            self.image_history.append(img)
                            self.history_index = len(self.image_history) - 1
                            try:
                                self.add_edit_history_entry("gemini", self.gemini_current_image, self.gemini_current_prompt)
                            except Exception:
                                pass
                            
                            self._main_stage_zoom = 1.0
                            self._main_stage_offset = [0, 0]
                            # Extra refreshes for UI stability
                            self.root.after(100, lambda: self.gemini_update_display(force_update=True))
                            self.root.after(200, lambda: self.gemini_update_display(force_update=True))
                            return
                
                self.root.after(0, lambda: self.status_var.set("No image returned by Gemini 3."))
            else:
                # --- Imagen 4 Path ---
                aspect = "1:1"
                size_label = "2K" if quality_mode else "1K"
                
                if quality_mode:
                    # Quality first: standard model at 2K
                    model_candidates = ["models/imagen-4.0-generate-001", "models/imagen-4.0-fast-generate-001"]
                else:
                    # Speed first: fast model at default 1K
                    model_candidates = ["models/imagen-4.0-fast-generate-001", "models/imagen-4.0-generate-001"]
                
                result = None
                last_error = None
                for model_name in model_candidates:
                    try:
                        config_kwargs = {
                            "number_of_images": 1,
                            "aspect_ratio": aspect,
                            "safety_filter_level": "block_low_and_above",
                            "person_generation": "ALLOW_ADULT",
                        }
                        if "fast" not in model_name:
                            config_kwargs["image_size"] = size_label
                        config = genai_types.GenerateImagesConfig(**config_kwargs)
                        print(f"[DEBUG] Trying {model_name} with Square {size_label if 'fast' not in model_name else 'default size'}...")
                        result = client.models.generate_images(model=model_name, prompt=final_prompt, config=config)
                        if result and hasattr(result, "generated_images") and result.generated_images:
                            break
                    except Exception as model_err:
                        print(f"[DEBUG] Model {model_name} failed: {model_err}")
                        last_error = model_err
                        continue  # Try next candidate if this one fails
                
                if result is None and last_error:
                    raise last_error

                generated_images = getattr(result, "generated_images", None) or []
                for generated_image in generated_images:
                    image_obj = getattr(generated_image, "image", None)
                    if image_obj and getattr(image_obj, "image_bytes", None):
                        img = Image.open(io.BytesIO(image_obj.image_bytes)).convert("RGB")
                        print(f"[DEBUG] API returned image with size: {img.size}")
                        self.root.after(0, self.status_var.set, f"Generated: {img.width}x{img.height}")
                        self.gemini_current_image = img
                        # Update display IMMEDIATELY before slow labeling/saving
                        self.root.after(0, lambda: self.gemini_update_display(force_update=True))
                        self.root.after(0, lambda: self.gemini_prompt_text.delete("1.0", tk.END))

                        try:
                            ai_label = self.gemini_client.describe_image_briefly(img)
                        except Exception:
                            ai_label = "image"
                        
                        ImageManager.save_gemini_image(img, self.gemini_current_prompt, ai_label=ai_label, generation_type="auto", view_name="main")
                        self.image_history.append(img)
                        self.history_index = len(self.image_history) - 1
                        try:
                            self.add_edit_history_entry("gemini", self.gemini_current_image, self.gemini_current_prompt)
                        except Exception:
                            pass
                        
                        self._main_stage_zoom = 1.0
                        self._main_stage_offset = [0, 0]
                        # Extra refreshes for UI stability
                        self.root.after(100, lambda: self.gemini_update_display(force_update=True))
                        self.root.after(200, lambda: self.gemini_update_display(force_update=True))
                        return
                
                self.root.after(0, lambda: self.status_var.set("No image returned by Imagen 4."))
        except Exception as e:
            msg = str(e)
            print(f"Unexpected error: {msg}")
            self.root.after(0, lambda: self.status_var.set(f"Image generation failed: {msg}"))
        finally:
            self.gemini_is_generating = False
            if hasattr(self, "gemini_processing_popup"):
                try:
                    self.root.after(0, lambda: self.gemini_processing_popup.close())
                except Exception:
                    pass
    
    def gemini_update_display(self, view="main", force_update=True):
        canvas = self.gemini_canvases.get(view)
        if not canvas:
            return
        img = self.gemini_current_image if view == "main" else self.gemini_ref_images.get(view)
        if not img:
            return
        try:
            canvas.delete("all")

            cw, ch = canvas.winfo_width() or 1100, canvas.winfo_height() or 800
            iw, ih = img.size
            base_scale = min(cw / max(1, iw), ch / max(1, ih))
            if view == "main":
                scale = base_scale * self._main_stage_zoom
                x = (cw // 2) + self._main_stage_offset[0]
                y = (ch // 2) + self._main_stage_offset[1]
            else:
                scale = base_scale
                x = cw // 2
                y = ch // 2
            nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
            img_resized = img.resize((nw, nh), Image.Resampling.LANCZOS)

            display = ImageTk.PhotoImage(img_resized, master=canvas)
            canvas.create_image(x, y, image=display, anchor="center")
            canvas.image = display
            
            if view == "main":
                canvas.create_rectangle(5, 5, 380, 40, fill="black", outline="")
                canvas.create_text(10, 12, text="Scroll: Zoom | Click+Drag: Pan | ESC: Reset View", 
                                 fill="white", font=("Segoe UI", 9, "bold"), anchor="w")
                canvas.create_text(10, 28, text="Right-Click: Save/Copy/Paste", 
                                 fill="white", font=("Segoe UI", 9, "bold"), anchor="w")
            
            if force_update:
                canvas.update_idletasks()
        except Exception as e:
            print(f"Display error: {e}")
    
    def gemini_copy_image(self):
        if not self.gemini_current_image:
            self.status_var.set("No image to copy.")
            return
        try:
            self._copy_to_app_clipboard(
                self.gemini_current_image,
                source="gemini",
                success_msg="Image copied to app clipboard (system clipboard attempted).",
                fail_msg="Copy failed",
            )
        except Exception as e:
            self.status_var.set(f"Copy failed: {e}")
    
    def gemini_send_to_multiview(self):
        if not self.gemini_current_image:
            self.status_var.set("No image to send.")
            return
        self.multiview_main_stage_image = self.gemini_current_image.copy()
        self.show_mode("multiview")
        if not hasattr(self, "_mv_zoom"):
            self._mv_zoom = {}
        if not hasattr(self, "_mv_offset"):
            self._mv_offset = {}
        self._mv_zoom["main"] = 1.0
        self._mv_offset["main"] = [0, 0]
        self.image_history.append(self.multiview_main_stage_image.copy())
        self.history_index = len(self.image_history) - 1
        self.root.update_idletasks()
        if hasattr(self, "multiview_notebook"):
            self.multiview_notebook.select(0)
            self.multiview_notebook.update_idletasks()
        if hasattr(self, "multiview_tab_labels") and "main" in self.multiview_tab_labels:
            self.multiview_tab_labels["main"].update_idletasks()
        self.multiview_update_tab_display("main", force_update=True)
        self.root.after(50, lambda: self.multiview_update_tab_display("main", force_update=True))
        self.root.after(150, lambda: self.multiview_update_tab_display("main", force_update=True))
        self.status_var.set("Image sent to Multi-View.")
    
    def gemini_send_to_ps(self):
        if not self.gemini_current_image:
            self.status_var.set("No image to send.")
            return
        if ImageUtils.send_to_photoshop(self.gemini_current_image):
            self.status_var.set("Opened in Photoshop")
        else:
            self.status_var.set("Failed to launch Photoshop.")
    
    def gemini_save_image(self):
        """Save the current Gemini image to a selected location."""
        if not self.gemini_current_image:
            messagebox.showwarning("No Image", "No image to save.")
            return
        
        # Open file save dialog
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        default_filename = f"gemini_image_{timestamp}.png"
        
        filepath = filedialog.asksaveasfilename(
            title="Save Gemini Image",
            defaultextension=".png",
            initialfile=default_filename,
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        
        if not filepath:
            return
        
        try:
            self.gemini_current_image.save(filepath)
            messagebox.showinfo("Success", f"✅ Image saved to:\n{filepath}")
            self.status_var.set(f"Saved to {Path(filepath).name}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Could not save image:\n{e}")
            self.status_var.set("Save failed")
    
    def build_multiview_ui(self):
        self.multiview_content = ttk.Frame(self.container)
        self.multiview_source_image = None
        self.multiview_main_stage_image = None
        self.multiview_prop_name = ""
        self.multiview_generated_views = {"threequarter": None, "front": None, "back": None, "side": None, "top": None, "bottom": None}
        self.multiview_current_tab = "main"
        self.multiview_is_generating = False
        left_panel = ttk.Frame(self.multiview_content, width=350)
        left_panel.pack(side=tk.LEFT, fill=tk.Y, padx=10, pady=10)
        left_panel.pack_propagate(False)
        input_frame = ttk.LabelFrame(left_panel, text="Input", padding="10")
        input_frame.pack(fill=tk.X, pady=(0, 10))
        ttk.Button(input_frame, text="Open Image", command=self.multiview_open_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(input_frame, text="Copy Image", command=self.multiview_copy_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(input_frame, text="Paste Image", command=self.multiview_paste_image, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(input_frame, text="Reset", command=self.multiview_reset_session, width=25).pack(fill=tk.X, pady=2)

        # Prop Name section removed for unified layout
        prompt_frame = ttk.LabelFrame(left_panel, text="Prompt", padding="10")
        prompt_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))
        ttk.Label(prompt_frame, text="Image Dimensions:").pack(anchor=tk.W)
        self.multiview_image_dimension = tk.StringVar(value="Square (1:1)")
        ttk.Combobox(
            prompt_frame,
            textvariable=self.multiview_image_dimension,
            values=[
                "Square (1:1)",
                "Portrait (9:16)",
                "Landscape (16:9)"
            ],
            state="readonly"
        ).pack(fill=tk.X, pady=5)
        ttk.Label(prompt_frame, text="Describe image:").pack(anchor=tk.W, pady=(10, 0))
        self.multiview_prompt_text = tk.Text(prompt_frame, height=15, wrap=tk.WORD)
        self.multiview_prompt_text.pack(fill=tk.BOTH, expand=True, pady=5)
        # --- ENTER triggers Generate, Shift+Enter inserts newline ---
        self.multiview_prompt_text.bind("<Return>", self._on_multiview_prompt_return)
        self.multiview_prompt_text.bind("<Shift-Return>", lambda e: None)
        # --- Generate Buttons (above Edit History) ---
        gen_frame = ttk.Frame(prompt_frame)
        gen_frame.pack(fill=tk.X, pady=(5, 8))
        self.multiview_generate_btn = ttk.Button(gen_frame, text="Generate Image", command=self.multiview_generate_from_text, width=25)
        self.multiview_generate_btn.pack(fill=tk.X, pady=2)
        self.multiview_isolate_btn = ttk.Button(
            gen_frame,
            text="Isolate Image",
            command=self.multiview_isolate_image,
            width=25,
            state="disabled"
        )
        self.multiview_isolate_btn.pack(fill=tk.X, pady=2)
        self.multiview_generate_selected_btn = ttk.Button(gen_frame, text="Generate Selected View", command=self.multiview_generate_selected, width=25, state="disabled")
        self.multiview_generate_selected_btn.pack(fill=tk.X, pady=2)
        # Group "Generate All Views" button + view checkboxes
        gen_all_group = ttk.LabelFrame(gen_frame, text="")
        gen_all_group.pack(fill=tk.X, pady=(4, 2))
        self.multiview_generate_all_btn = ttk.Button(
            gen_all_group,
            text="Generate All Views",
            command=self.multiview_generate_all,
            width=25,
            state="disabled"
        )
        self.multiview_generate_all_btn.pack(fill=tk.X, pady=(2, 4))

        # Per-view checkboxes removed for Generate All
        # --- Edit History Panel ---
        self.create_edit_history_panel(prompt_frame, "multiview")
        if DARK_THEME_AVAILABLE:
            configure_text_widget(self.multiview_prompt_text)
        action_frame = ttk.LabelFrame(left_panel, text="Actions", padding="10")
        action_frame.pack(fill=tk.X)
        ttk.Button(action_frame, text="Send to PS", command=self.multiview_send_to_ps, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(action_frame, text="Save All Images", command=self.multiview_save_all_images, width=25).pack(fill=tk.X, pady=2)
        ttk.Button(action_frame, text="Open Generated Images", command=self.open_multiview_generated_images, width=25).pack(fill=tk.X, pady=2)
        right_panel = ttk.Frame(self.multiview_content)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        self.multiview_notebook = ttk.Notebook(right_panel)
        self.multiview_notebook.pack(fill=tk.BOTH, expand=True)
        self.multiview_notebook.bind('<<NotebookTabChanged>>', self.multiview_on_tab_changed)
        self.multiview_tab_labels = {}
        tabs = [("main", "Main Stage"), ("threequarter", "3/4"), ("front", "Front"), ("back", "Back"), ("side", "Side"), ("top", "Top"), ("bottom", "Bottom")]
        for key, label in tabs:
            frame = ttk.Frame(self.multiview_notebook)
            self.multiview_notebook.add(frame, text=label)

            # --- Add zoom toolbar at top of each tab ---
            toolbar = ttk.Frame(frame)
            toolbar.pack(side=tk.TOP, fill=tk.X)
            ttk.Label(toolbar, text="Zoom").pack(side=tk.LEFT, padx=4)
            ttk.Button(toolbar, text="-", width=3, command=lambda k=key: self._multiview_zoom(k, 0.9)).pack(side=tk.LEFT, padx=2)
            ttk.Button(toolbar, text="+", width=3, command=lambda k=key: self._multiview_zoom(k, 1.1)).pack(side=tk.LEFT, padx=2)

            # --- Canvas for displaying the image ---
            canvas = tk.Canvas(frame, bg="#222222", highlightthickness=0)
            canvas.pack(fill=tk.BOTH, expand=True)
            canvas.bind("<ButtonPress-1>", lambda e, k=key: self._on_mv_press(e, k))
            canvas.bind("<B1-Motion>", lambda e, k=key: self._on_mv_drag(e, k))
            canvas.bind("<ButtonRelease-1>", lambda e, k=key: self._on_mv_release(e, k))
            canvas.bind("<ButtonPress-2>", lambda e, k=key: self._on_mv_press(e, k))
            canvas.bind("<B2-Motion>", lambda e, k=key: self._on_mv_drag(e, k))
            canvas.bind("<ButtonRelease-2>", lambda e, k=key: self._on_mv_release(e, k))
            canvas.bind("<Button-3>", lambda e, k=key: self._show_multiview_context_menu(e, k))

            # Scroll zoom
            canvas.bind("<MouseWheel>", lambda e, k=key: self._on_mv_scroll(e, k))
            canvas.bind("<Button-4>", lambda e, k=key: self._multiview_zoom(k, 1.1))  # Linux scroll up
            canvas.bind("<Button-5>", lambda e, k=key: self._multiview_zoom(k, 0.9))  # Linux scroll down

            # ESC resets zoom/pan
            canvas.bind_all("<Escape>", lambda e, k=key: self._reset_multiview_zoom())

            self.multiview_tab_labels[key] = canvas

        # initialize pan/zoom states
        self._mv_zoom = {k: 1.0 for k, _ in tabs}
        self._mv_offset = {k: [0, 0] for k, _ in tabs}
        self._mv_last_pos = {k: None for k, _ in tabs}
        self._mv_drag_update_pending = {k: False for k, _ in tabs}

    def multiview_reset_session(self):
        """Reset Multi-View canvas and prompt but keep dimensions."""
        self.multiview_source_image = None
        self.multiview_main_stage_image = None
        if hasattr(self, 'multiview_prompt_text'):
            self.multiview_prompt_text.delete("1.0", tk.END)
        # Keep selected dimensions
        dim = self.multiview_image_dimension.get() if hasattr(self, 'multiview_image_dimension') else "Square (1:1)"
        for key, label in getattr(self, 'multiview_tab_labels', {}).items():
            try:
                label.delete("all")
            except Exception:
                try:
                    label.config(image="", text=f"No image ({dim})")
                    label.image = None
                except Exception:
                    pass
        try:
            self._reset_edit_history("multiview")
        except Exception:
            pass
        self._update_multiview_action_states()
        self.status_var.set("Multi-View reset.")

    def multiview_generate_main(self):
        """Isolate the main object, remove background, and render 3D three-quarter view."""
        from datetime import datetime
        import io as _io

        if not getattr(self, "multiview_source_image", None):
            messagebox.showinfo("No Image", "Please open or paste an image first.")
            return

        self.status_var.set("🎨 Isolating and re-rendering prop in 3/4 view...")
        popup = ProcessingPopup(self.root, "Generating isolated prop...")

        def process_image():
            try:
                # Step 1. Remove background / isolate object
                img = ImageUtils.isolate_object(self.multiview_source_image)

                # Step 2. Resize + prepare target dimensions
                dim = self.multiview_image_dimension.get()
                if "Portrait" in dim:
                    target_w, target_h = (1024, 1792)
                elif "Landscape" in dim:
                    target_w, target_h = (1792, 1024)
                else:
                    target_w, target_h = (1024, 1024)
                img = ImageUtils.fit_to_display(img, target_w, target_h)

                # Step 3. Use Gemini 3 (image-preview) to re-render isolated object
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                model = genai.GenerativeModel("gemini-3-pro-image-preview")

                description = self.multiview_prompt_text.get("1.0", tk.END).strip()
                if not description:
                    description = "Isolated subject"
                # Always apply the isolation + three-quarter-view rule set
                user_prompt = (
                    f"Take the provided image (if any) or concept described below and recreate it "
                    f"as a clean, isolated 3/4-view studio render. Remove all background elements, "
                    f"center the subject, fill the frame within {self.multiview_image_dimension.get()} bounds, "
                    f"and extrapolate missing parts naturally. CRITICAL: ABSOLUTELY NO SHADOWS, NO GROUND SHADOWS, "
                    f"NO DROP SHADOWS, NO CAST SHADOWS, NO GROUND PLANE, NO SURFACE, NO FLOOR. "
                    f"Object must float completely isolated against blank background with no shadow underneath or around it.\n\nSubject: {description}"
                )

                buf = _io.BytesIO()
                img.save(buf, format="PNG")
                parts = [{"mime_type": "image/png", "data": buf.getvalue()}, user_prompt]
                result = model.generate_content(parts)

                if hasattr(result, "parts"):
                    for part in result.parts:
                        if hasattr(part, "inline_data") and part.inline_data.data:
                            output_img = Image.open(_io.BytesIO(part.inline_data.data)).convert("RGB")
                            self.multiview_main_stage_image = output_img
                            ImageManager.save_multiview_image(
                                output_img, "isolated_prop", "threequarter", description
                            )
                            try:
                                self.add_edit_history_entry("multiview", self.multiview_main_stage_image, description)
                            except Exception:
                                pass
                            self.root.after(0, lambda: self.multiview_update_tab_display("main"))
                            self.root.after(0, lambda: self.status_var.set("✅ Prop isolated and re-rendered."))
                            break
            except Exception as e:
                print(f"[ERROR] multiview_generate_main failed: {e}")
                self.root.after(0, lambda: messagebox.showerror("Generate Failed", str(e)))
            finally:
                try:
                    self.root.after(0, lambda p=popup: p.close())
                except Exception:
                    pass

        threading.Thread(target=process_image, daemon=True).start()

    def multiview_generate_from_text(self, prompt: str | None = None):
        """Generate a new prop image from description text."""
        import io, threading as _threading
        from PIL import Image as _PILImage
        from google import genai as genai_images
        from google.genai import types as genai_types

        prompt = prompt or self.multiview_prompt_text.get("1.0", tk.END).strip() or "isolated object"
        self.status_var.set(f"🎨 Generating new prop: {prompt}")
        popup = ProcessingPopup(self.root, f"Generating {prompt}...")
        dim = self.multiview_image_dimension.get()
        target_w, target_h = (1024, 1024)
        if "Portrait" in dim:
            target_w, target_h = (1024, 1792)
        elif "Landscape" in dim:
            target_w, target_h = (1792, 1024)

        def run():
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                model = genai.GenerativeModel("gemini-3-pro-image-preview")

                instruction = (
                    f"Create a high-quality, realistic 3/4-view render of a single {prompt}. "
                    f"The subject should fill the frame naturally within {target_w}×{target_h}, "
                    "never cropped, centered on a light gray (#e0e0e0) studio background. "
                    "CRITICAL: ABSOLUTELY NO SHADOWS, NO GROUND SHADOWS, NO DROP SHADOWS, NO CAST SHADOWS, "
                    "NO GROUND PLANE, NO SURFACE, NO FLOOR. Object must float completely isolated against "
                    "blank background with no shadow underneath or around it. Show full form and consistent lighting."
                )

                result = model.generate_content(
                    [instruction],
                    generation_config={"temperature": 0.8, "candidate_count": 1}
                )

                for part in getattr(result, "parts", []) or []:
                    if hasattr(part, "inline_data") and part.inline_data:
                        img_data = part.inline_data.data
                        if isinstance(img_data, bytes):
                            img = _PILImage.open(io.BytesIO(img_data)).convert("RGB")
                            img = autocrop_and_resize(img, (target_w, target_h))
                            self.multiview_main_stage_image = img
                            self._mv_zoom["main"] = 1.0
                            self._mv_offset["main"] = [0, 0]
                            self.root.after(0, lambda: self.multiview_update_tab_display("main", force_update=True))
                            self.root.after(100, lambda: self.multiview_update_tab_display("main", force_update=True))
                            self.root.after(200, lambda: self.multiview_update_tab_display("main", force_update=True))
                            self.root.after(0, self._update_multiview_isolate_state)
                            self.root.after(0, lambda: self.status_var.set("✅ New prop generated."))
                            ImageManager.save_multiview_image(img, prompt.replace(" ", "_"), "threequarter", instruction)
                            try:
                                self.add_edit_history_entry("multiview", self.multiview_main_stage_image, prompt)
                            except Exception:
                                pass
                            break
            except Exception as e:
                print(f"[ERROR] multiview_generate_from_text: {e}")
                self.root.after(0, lambda: messagebox.showerror("Generate Failed", str(e)))
            finally:
                try:
                    self.root.after(0, lambda p=popup: p.close())
                except Exception:
                    pass

        _threading.Thread(target=run, daemon=True).start()

    def multiview_edit_existing_image(self, prompt: str):
        """Apply a Gemini edit to the existing Multi-View image."""
        import io, threading as _threading
        from PIL import Image as _PILImage
        import google.generativeai as genai

        if not self.multiview_main_stage_image:
            messagebox.showinfo("No Image", "No active image to edit.")
            return

        popup = ProcessingPopup(self.root, f"Editing image: {prompt}")

        def run():
            try:
                genai.configure(api_key=self.api_key)
                model = genai.GenerativeModel("gemini-3-pro-image-preview")

                buf = io.BytesIO()
                self.multiview_main_stage_image.save(buf, format="PNG")
                buf.seek(0)

                edit_instruction = (
                    f"Modify the given object according to this instruction: '{prompt}'. "
                    "Recreate the prop in a clean, isolated 3/4-view on a light gray (#e0e0e0) background. "
                    "Preserve overall proportions and materials; remove any environment or clutter. "
                    "CRITICAL: ABSOLUTELY NO SHADOWS, NO GROUND SHADOWS, NO DROP SHADOWS, NO CAST SHADOWS, "
                    "NO GROUND PLANE, NO SURFACE, NO FLOOR. Object must float completely isolated against "
                    "blank background with no shadow underneath or around it."
                )

                parts = [{"mime_type": "image/png", "data": buf.getvalue()}, edit_instruction]
                result = model.generate_content(parts)

                for part in getattr(result, "parts", []):
                    if hasattr(part, "inline_data") and part.inline_data.data:
                        img = _PILImage.open(io.BytesIO(part.inline_data.data)).convert("RGB")
                        self.multiview_main_stage_image = img
                        self._mv_zoom["main"] = 1.0
                        self._mv_offset["main"] = [0, 0]
                        self.root.after(0, lambda: self.multiview_update_tab_display("main", force_update=True))
                        self.root.after(100, lambda: self.multiview_update_tab_display("main", force_update=True))
                        self.root.after(200, lambda: self.multiview_update_tab_display("main", force_update=True))
                        self.root.after(0, self._update_multiview_isolate_state)
                        self.root.after(0, lambda: self.status_var.set("✅ Edit applied."))
                        ImageManager.save_multiview_image(img, "edited_prop", "threequarter", prompt)
                        try:
                            self.add_edit_history_entry("multiview", self.multiview_main_stage_image, prompt)
                        except Exception:
                            pass
                        break
            except Exception as e:
                print(f"[ERROR] multiview_edit_existing_image: {e}")
                self.root.after(0, lambda: messagebox.showerror("Edit Failed", str(e)))
            finally:
                try:
                    self.root.after(0, lambda p=popup: p.close())
                except Exception:
                    pass

        _threading.Thread(target=run, daemon=True).start()

    def multiview_isolate_image(self):
        """
        Isolate the main object from the current Multi-View image by removing the background.
        Keeps the prop unchanged (no re-generation).
        """
        import io, threading
        from PIL import Image
        import google.generativeai as genai

        if not getattr(self, "multiview_main_stage_image", None):
            messagebox.showinfo("No Image", "Load or paste an image first before isolating.")
            return

        self.status_var.set("🧩 Isolating main object from image...")
        popup = ProcessingPopup(self.root, "Isolating Object...")

        def run():
            try:
                genai.configure(api_key=self.api_key)
                model = genai.GenerativeModel("gemini-3-pro-image-preview")

                buf = io.BytesIO()
                self.multiview_main_stage_image.save(buf, format="PNG")
                buf.seek(0)

                subject = self.multiview_prompt_text.get("1.0", tk.END).strip() or "main object"
                prompt = (
                    "ISOLATION WITH EXACT RECREATION.\n"
                    f"Recreate the {subject} EXACTLY as it appears in the image (same pose, angle, proportions, "
                    "materials, colors, texture, wear, and details), but remove ALL background and anything visible "
                    "through glass/windows. No changes or stylization.\n"
                    "Center the object, scale to use the full frame without cropping, and place it on a clean light gray "
                    "(#e0e0e0) background.\n"
                    "No shadows, no ground plane, no floor, no reflections."
                )

                parts = [{"mime_type": "image/png", "data": buf.getvalue()}, prompt]
                result = model.generate_content(parts)

                for part in getattr(result, "parts", []):
                    if hasattr(part, "inline_data") and part.inline_data.data:
                        img = Image.open(io.BytesIO(part.inline_data.data)).convert("RGB")
                        self.multiview_main_stage_image = img
                        self._mv_zoom["main"] = 1.0
                        self._mv_offset["main"] = [0, 0]
                        try:
                            ImageManager.save_multiview_image(img, "isolated_prop", "threequarter", "background_removed_ai")
                        except Exception:
                            pass
                        self.root.after(0, lambda: self.multiview_update_tab_display("main", force_update=True))
                        self.root.after(100, lambda: self.multiview_update_tab_display("main", force_update=True))
                        self.root.after(200, lambda: self.multiview_update_tab_display("main", force_update=True))
                        self.root.after(0, self._update_multiview_isolate_state)
                        self.root.after(0, lambda: self.status_var.set("✅ Background removed (AI)."))
                        break
            except Exception as e:
                print(f"[ERROR] multiview_isolate_image: {e}")
                self.root.after(0, lambda: messagebox.showerror("Isolation Failed", str(e)))
            finally:
                try:
                    self.root.after(0, lambda p=popup: p.close())
                except Exception:
                    pass

        threading.Thread(target=run, daemon=True).start()
    
    def multiview_open_image(self):
        """Open an image and load it into Multi-View Main Stage (no auto-isolation)."""
        filename = filedialog.askopenfilename(
            title="Open Image",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.tiff"), ("All files", "*.*")]
        )
        if not filename:
            return
        try:
            img = Image.open(filename).convert("RGB")
            self.multiview_main_stage_image = img
            self.multiview_source_image = img
            self._mv_zoom["main"] = 1.0
            self._mv_offset["main"] = [0, 0]
            self.multiview_update_tab_display("main", force_update=True)
            self.root.after(100, lambda: self.multiview_update_tab_display("main", force_update=True))
            try:
                self.add_edit_history_entry("multiview", img, "Original Image", is_original=True)
            except Exception:
                pass
            self._update_multiview_action_states()
            self.status_var.set(f"Loaded image into Multi-View Main Stage: {Path(filename).name}")
        except Exception as e:
            messagebox.showerror("Open Error", f"Could not open image:\n{e}")
    
    def multiview_paste_image(self):
        """Paste an image from clipboard into Multi-View Main Stage (no isolation)."""
        try:
            img = self._paste_from_app_or_system()
            if isinstance(img, Image.Image):
                self.multiview_main_stage_image = img.convert("RGB")
                self.multiview_source_image = img
                self._mv_zoom["main"] = 1.0
                self._mv_offset["main"] = [0, 0]
                self.multiview_update_tab_display("main", force_update=True)
                self.root.after(100, lambda: self.multiview_update_tab_display("main", force_update=True))
                try:
                    self.add_edit_history_entry("multiview", img, "Original Image", is_original=True)
                except Exception:
                    pass
                self._update_multiview_action_states()
                self.status_var.set("Pasted image into Multi-View Main Stage.")
                try:
                    self.root.after(50, self.multiview_generate_main)
                    self.root.after(800, self.multiview_generate_all)
                except Exception:
                    pass
            else:
                messagebox.showinfo("No Image", "No image data found in clipboard.")
        except Exception as e:
            messagebox.showerror("Paste Error", f"Could not paste image:\n{e}")
    
    def multiview_process_source(self):
        # No-op: Auto isolation on load is disabled
            return
    
    def multiview_prompt_for_name(self):
        # Deprecated: no longer prompting for names in Multi-View flow
        pass
    
    def multiview_generate_selected(self, completion_callback=None, allow_if_generating=False, show_popup=True):
        """
        Generate the currently selected camera view (Front, Back, Side, or Three-Quarter)
        using the Main Stage image as reference.
        """
        import io, threading
        from PIL import Image
        import google.generativeai as genai

        if not getattr(self, "multiview_main_stage_image", None):
            messagebox.showinfo("No Image", "No Main Stage image to use as reference.")
            return

        view_key = self.multiview_current_tab
        if view_key == "main":
            messagebox.showinfo("Info", "Select a camera view tab (3/4, Front, Back, Side, Top).")
            return
        if self.multiview_is_generating and not (allow_if_generating or getattr(self, "_allow_multiview_reentry", False)):
            return

        self.status_var.set(f"🎥 Generating {view_key} view from Main Stage image...")
        popup = ProcessingPopup(self.root, f"Generating {view_key} view...") if show_popup else None
        
        user_text = self.multiview_prompt_text.get("1.0", tk.END).strip()

        def run():
            try:
                genai.configure(api_key=self.api_key)
                model = genai.GenerativeModel("gemini-3-pro-image-preview")

                buf = io.BytesIO()
                self.multiview_main_stage_image.save(buf, format="PNG")
                buf.seek(0)

                view_instruction = VIEW_REQUESTS.get(view_key, VIEW_REQUESTS["threequarter"])
                user_prompt = (
                    f"Use the provided image as a reference. Re-render the same object from the {view_key.upper()} "
                    f"camera view. Maintain identical materials, lighting, and design, but change perspective. "
                    f"Remove all backgrounds, keep light gray background, and fit within 1024×1024 frame. "
                    f"CRITICAL: ABSOLUTELY NO SHADOWS, NO GROUND SHADOWS, NO DROP SHADOWS, NO CAST SHADOWS, "
                    f"NO GROUND PLANE, NO SURFACE, NO FLOOR. Object must float completely isolated against "
                    f"blank background with no shadow underneath or around it.\n\n"
                    f"Camera setup:\n{view_instruction}"
                )
                
                if user_text:
                    user_prompt += f"\n\nAdditional instructions: {user_text}"

                result = model.generate_content([
                    {"mime_type": "image/png", "data": buf.getvalue()},
                    user_prompt
                ], generation_config={"temperature": 0.8, "candidate_count": 1})

                for part in getattr(result, "parts", []):
                    if hasattr(part, "inline_data") and part.inline_data.data:
                        img = Image.open(io.BytesIO(part.inline_data.data)).convert("RGB")
                        self.multiview_generated_views[view_key] = img
                        self._mv_zoom[view_key] = 1.0
                        self._mv_offset[view_key] = [0, 0]
                        ImageManager.save_multiview_image(img, "prop", view_key, user_prompt)
                        self.root.after(0, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                        self.root.after(100, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                        self.root.after(200, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                        self.root.after(0, lambda k=view_key: self.status_var.set(f"✅ Generated {k} view."))
                        break
            except Exception as err:
                print(f"[ERROR] multiview_generate_selected: {err}")
                self.root.after(0, lambda err=err: messagebox.showerror("Generation Failed", str(err)))
            finally:
                try:
                    if popup:
                        self.root.after(0, lambda p=popup: p.close())
                except Exception:
                    pass
                if completion_callback:
                    self.root.after(0, completion_callback)

        threading.Thread(target=run, daemon=True).start()
    
    def multiview_generate_all(self):
        """Generate all camera views from Main Stage image."""
        if not getattr(self, "multiview_main_stage_image", None):
            messagebox.showinfo("No Image", "No Main Stage image to use as reference.")
            return

        views = ["threequarter", "front", "back", "side", "top", "bottom"]
        self.status_var.set("🎥 Generating selected views...")
        self.multiview_is_generating = True
        self._allow_multiview_reentry = True
        popup_all = ProcessingPopup(self.root, "Generating all views...")
        try:
            self.multiview_generate_all_btn.configure(state="disabled")
        except Exception:
            pass

        def finish_batch(success=True):
            self.multiview_is_generating = False
            self._allow_multiview_reentry = False
            try:
                self.multiview_generate_all_btn.configure(state="normal")
            except Exception:
                pass
            try:
                popup_all.close()
            except Exception:
                pass
            if success:
                self.root.after(0, lambda: messagebox.showinfo("Complete", "✅ All views generated!"))
                self.root.after(0, lambda: self.status_var.set("✅ All views complete."))
            else:
                self.root.after(0, lambda: self.status_var.set("Generation stopped."))

        def generate_next(index=0):
            if index >= len(views):
                finish_batch(True)
                return
            if not getattr(self, "multiview_main_stage_image", None):
                self.root.after(0, lambda: messagebox.showerror("No Image", "Main Stage image missing during batch."))
                finish_batch(False)
                return
            view_key = views[index]
            self.multiview_current_tab = view_key
            self.status_var.set(f"🎥 Generating {view_key} view...")
            # Chain generation using completion callbacks to ensure serialization
            self.multiview_generate_selected(
                completion_callback=lambda: generate_next(index + 1),
                allow_if_generating=True,
                show_popup=False
            )

        generate_next()
    
    def multiview_generate_view(self, view_key: str):
        if self.multiview_is_generating:
            return
        self.multiview_is_generating = True
        self.status_var.set(f"Generating {view_key}...")
        prompt = self.multiview_prompt_text.get("1.0", tk.END).strip()
        threading.Thread(target=self.multiview_generate_view_thread, args=(view_key, prompt), daemon=True).start()
    
    def multiview_generate_view_thread(self, view_key: str, user_prompt: str):
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            view_instruction = VIEW_REQUESTS.get(view_key, VIEW_REQUESTS["threequarter"])
            full_prompt = f"GENERATE IN 1:1 SQUARE (1024x1024). {PROP_STYLE_BASE}\n\nUse provided image as reference.\n\nVIEW:\n{view_instruction}\n"
            if user_prompt:
                full_prompt += f"\nUSER NOTES: {user_prompt}\n"
            model = genai.GenerativeModel("gemini-3-pro-image-preview")
            buf = io.BytesIO()
            self.multiview_main_stage_image.save(buf, format="PNG")
            parts = [{"mime_type": "image/png", "data": buf.getvalue()}, full_prompt]
            result = model.generate_content(parts, generation_config={"temperature": 0.8})
            if result.parts:
                for part in result.parts:
                    if hasattr(part, 'inline_data') and part.inline_data:
                        img_data = part.inline_data.data
                        if isinstance(img_data, bytes):
                            img = Image.open(io.BytesIO(img_data)).convert("RGB")
                            img = autocrop_and_resize(img, (1024, 1024))
                            self.multiview_generated_views[view_key] = img
                            self._mv_zoom[view_key] = 1.0
                            self._mv_offset[view_key] = [0, 0]
                            try:
                                ai_label = self.gemini_client.describe_image_briefly(img)
                            except Exception:
                                ai_label = "image"
                            ImageManager.save_multiview_image(img, self.multiview_prop_name, view_key, full_prompt, ai_label=ai_label, generation_type="auto")
                            self.image_history.append(img)
                            self.history_index = len(self.image_history) - 1
                            self.root.after(0, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                            self.root.after(100, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                            self.root.after(200, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                            self.root.after(300, lambda k=view_key: self.multiview_update_tab_display(k, force_update=True))
                            self.root.after(0, lambda k=view_key: self.status_var.set(f"{k} generated"))
                            self.multiview_is_generating = False
                            return
            self.root.after(0, messagebox.showerror, "Error", "No image generated")
        except Exception as e:
            msg = str(e)
            if "quota" in msg.lower():
                self.root.after(0, messagebox.showerror, "Quota", "API quota exceeded")
            else:
                self.root.after(0, messagebox.showerror, "Error", f"Failed: {msg}")
        finally:
            self.multiview_is_generating = False
            self.root.after(0, self.status_var.set, "Ready")
    
    def multiview_update_tab_display(self, tab_key: str, force_update=True):
        """Display the image for a given tab with zoom/pan applied."""
        if tab_key == "main":
            img = self.multiview_main_stage_image
        else:
            img = self.multiview_generated_views.get(tab_key)
        if not img:
            return

        try:
            if not hasattr(self, "multiview_tab_labels") or tab_key not in self.multiview_tab_labels:
                self.root.after(50, lambda: self.multiview_update_tab_display(tab_key, force_update))
                return

            canvas = self.multiview_tab_labels[tab_key]
            canvas.delete("all")

            cw, ch = canvas.winfo_width() or 1100, canvas.winfo_height() or 800
            iw, ih = img.size
            
            # Apply zoom to base scale
            base_scale = min(cw / max(1, iw), ch / max(1, ih))
            zoom = self._mv_zoom.get(tab_key, 1.0)
            scale = base_scale * zoom
            nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
            img_resized = img.resize((nw, nh), Image.Resampling.LANCZOS)

            # Apply pan offsets
            offsets = self._mv_offset.get(tab_key, [0, 0])
            cx = (cw // 2) + offsets[0]
            cy = (ch // 2) + offsets[1]

            display = ImageTk.PhotoImage(img_resized, master=canvas)
            canvas.create_image(cx, cy, image=display, anchor="center")
            canvas.image = display
            
            # Add overlay instructions
            canvas.create_rectangle(5, 5, 380, 40, fill="black", outline="")
            canvas.create_text(10, 12, text="Scroll: Zoom | Click+Drag: Pan | ESC: Reset View", 
                             fill="white", font=("Segoe UI", 9, "bold"), anchor="w")
            canvas.create_text(10, 28, text="Right-Click: Save/Copy/Paste", 
                             fill="white", font=("Segoe UI", 9, "bold"), anchor="w")
            
            if force_update:
                canvas.update_idletasks()
                canvas.update()
            
            # Toggle isolate availability based on main stage presence
            if tab_key == "main":
                try:
                    self._update_multiview_action_states()
                except Exception:
                    pass
        except Exception as e:
            print(f"[DEBUG] MultiView display error: {e}")

    # === MULTIVIEW HISTORY NAVIGATION ===
    def step_back_image(self):
        """Step one image back in the MultiView history."""
        if not self.image_history or self.history_index <= 0:
            return
        self.history_index -= 1
        img = self.image_history[self.history_index]
        self._load_history_image(img)
        self.status_var.set(f"Showing image {self.history_index + 1}/{len(self.image_history)}")

    def step_forward_image(self):
        """Step one image forward in the MultiView history."""
        if not self.image_history or self.history_index >= len(self.image_history) - 1:
            return
        self.history_index += 1
        img = self.image_history[self.history_index]
        self._load_history_image(img)
        self.status_var.set(f"Showing image {self.history_index + 1}/{len(self.image_history)}")

    def jump_to_start(self):
        """Jump to the first image in MultiView history."""
        if not self.image_history:
            return
        self.history_index = 0
        img = self.image_history[0]
        self._load_history_image(img)
        self.status_var.set("Jumped to first image in history")

    def jump_to_end(self):
        """Jump to the last image in MultiView history."""
        if not self.image_history:
            return
        self.history_index = len(self.image_history) - 1
        img = self.image_history[-1]
        self._load_history_image(img)
        self.status_var.set("Jumped to latest image in history")

    def _load_history_image(self, image):
        """Internal: display the given image on the current tab."""
        if image is None:
            return
        if self.current_mode == "gemini":
            self.gemini_current_image = image
            self.gemini_update_display()
        else:
            self.multiview_main_stage_image = image
            self.multiview_update_tab_display("main")

    # === MULTIVIEW ZOOM & PAN SUPPORT ===
    def _multiview_zoom(self, tab_key, factor):
        """Zoom in/out for multiview tab with smooth redraw (no flicker)."""
        if tab_key not in self._mv_zoom or not self.multiview_tab_labels.get(tab_key):
            return
        try:
            old_zoom = self._mv_zoom[tab_key]
            new_zoom = max(0.1, min(old_zoom * factor, 10.0))
            if abs(new_zoom - old_zoom) < 0.01:
                return
            self._mv_zoom[tab_key] = new_zoom
            self.multiview_update_tab_display(tab_key)
        except Exception as e:
            print(f"[DEBUG] Zoom error ({tab_key}): {e}")

    def _on_mv_press(self, event, tab_key):
        """Start dragging (pan)."""
        if tab_key not in self._mv_last_pos:
            self._mv_last_pos[tab_key] = None
        self._mv_last_pos[tab_key] = (event.x, event.y)
        self.root.config(cursor="fleur")

    def _on_mv_drag(self, event, tab_key):
        """Handle image drag for panning."""
        if self._mv_last_pos[tab_key]:
            dx = event.x - self._mv_last_pos[tab_key][0]
            dy = event.y - self._mv_last_pos[tab_key][1]
            self._mv_offset[tab_key][0] += dx
            self._mv_offset[tab_key][1] += dy
            self._mv_last_pos[tab_key] = (event.x, event.y)
            
            # Throttle updates: only update if no pending update
            if not self._mv_drag_update_pending.get(tab_key, False):
                self._mv_drag_update_pending[tab_key] = True
                self.root.after(16, lambda k=tab_key: self._do_mv_drag_update(k))  # ~60fps

    def _on_mv_scroll(self, event, tab_key):
        """Scroll to zoom."""
        factor = 1.1 if event.delta > 0 else 0.9
        self._multiview_zoom(tab_key, factor)

    def _do_mv_drag_update(self, tab_key):
        """Throttled update during drag to reduce flicker."""
        self.multiview_update_tab_display(tab_key, force_update=False)
        self._mv_drag_update_pending[tab_key] = False
    
    def _on_mv_release(self, event, tab_key):
        """Stop dragging."""
        self._mv_last_pos[tab_key] = None
        self.root.config(cursor="")
        self._mv_drag_update_pending[tab_key] = False
        # Final smooth update after drag
        self.multiview_update_tab_display(tab_key, force_update=True)
    
    def _show_multiview_context_menu(self, event, tab_key):
        from dark_theme import DarkTheme
        menu = tk.Menu(self.root, tearoff=0, bg=DarkTheme.FRAME_BG, fg=DarkTheme.TEXT_FG)
        menu.add_command(label="💾 Save Image", command=lambda: self._save_multiview_image(tab_key))
        menu.add_command(label="📋 Copy Image", command=lambda: self._copy_multiview_image(tab_key))
        menu.add_command(label="📥 Paste Image", command=lambda: self._paste_multiview_image(tab_key))
        menu.add_command(label="📂 Open Image...", command=lambda: self._open_multiview_image(tab_key))
        menu.add_separator()
        menu.add_command(label="🔍 Reset View", command=lambda: self._reset_mv_view(tab_key))
        menu.tk_popup(event.x_root, event.y_root)
    
    def _save_multiview_image(self, tab_key):
        if tab_key == "main":
            img = self.multiview_main_stage_image
        else:
            img = self.multiview_generated_views.get(tab_key)
        if not img:
            messagebox.showwarning("No Image", f"No image in {tab_key} view to save.")
            return
        path = filedialog.asksaveasfilename(
            title=f"Save {tab_key} view",
            defaultextension=".png",
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        if path:
            try:
                img.save(path)
                self.status_var.set(f"Saved {tab_key} view to {Path(path).name}")
            except Exception as e:
                messagebox.showerror("Save Error", f"Could not save: {e}")
    
    def _copy_multiview_image(self, tab_key):
        if tab_key == "main":
            img = self.multiview_main_stage_image
        else:
            img = self.multiview_generated_views.get(tab_key)
        if not img:
            messagebox.showwarning("No Image", f"No image in {tab_key} view to copy.")
            return
        try:
            self._copy_to_app_clipboard(
                img,
                source=f"multiview_{tab_key}",
                success_msg=f"✅ Copied {tab_key} view to app clipboard",
                fail_msg="Copy failed",
            )
            self._clipboard_image = self.clipboard.get_image()
        except Exception as e:
            self.status_var.set(f"Clipboard copy failed ({e})")
    
    def _paste_multiview_image(self, tab_key):
        try:
            img = self._paste_from_app_or_system()
            if isinstance(img, Image.Image):
                if tab_key == "main":
                    self.multiview_main_stage_image = img
                else:
                    self.multiview_generated_views[tab_key] = img
                self._mv_zoom[tab_key] = 1.0
                self._mv_offset[tab_key] = [0, 0]
                self.multiview_update_tab_display(tab_key)
                self.status_var.set(f"Pasted image into {tab_key} view")
            else:
                messagebox.showinfo("No Image", "Clipboard does not contain an image")
        except Exception as e:
            messagebox.showerror("Paste Error", f"Could not paste: {e}")

    def _open_multiview_image(self, tab_key):
        filename = filedialog.askopenfilename(
            title=f"Open image for {tab_key}",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.tiff"), ("All files", "*.*")]
        )
        if not filename:
            return
        try:
            img = Image.open(filename).convert("RGB")
            if tab_key == "main":
                self.multiview_main_stage_image = img
            else:
                self.multiview_generated_views[tab_key] = img
            self._mv_zoom[tab_key] = 1.0
            self._mv_offset[tab_key] = [0, 0]
            self.multiview_update_tab_display(tab_key, force_update=True)
            self.status_var.set(f"Opened image for {tab_key}")
        except Exception as e:
            messagebox.showerror("Open Error", f"Could not open image:\n{e}")

    def _reset_mv_view(self, tab_key):
        """Reset zoom/pan for a given multiview tab."""
        if tab_key not in self._mv_zoom:
            return
        self._mv_zoom[tab_key] = 1.0
        self._mv_offset[tab_key] = [0, 0]
        self.multiview_update_tab_display(tab_key)
        self.status_var.set(f"{tab_key} view reset (zoom/pan).")

    def _reset_gemini_zoom(self, view="main"):
        """Reset zoom/pan for a Gemini view (main by default)."""
        if view == "main":
            self._main_stage_zoom = 1.0
            self._main_stage_offset = [0, 0]
        self.gemini_update_display(view=view, force_update=True)
        self.status_var.set("🔍 Gemini view reset")

    def _save_gemini_ref(self, key):
        img = self.gemini_ref_images.get(key)
        if not img:
            messagebox.showwarning("No Image", "No image to save.")
            return
        path = filedialog.asksaveasfilename(
            title=f"Save {key.replace('_',' ').title()}",
            defaultextension=".png",
            filetypes=[("PNG Image", "*.png"), ("JPEG Image", "*.jpg"), ("All Files", "*.*")]
        )
        if path:
            try:
                img.save(path)
                self.status_var.set(f"Saved {Path(path).name}")
            except Exception as e:
                messagebox.showerror("Save Error", f"Could not save: {e}")

    def _copy_gemini_ref(self, key):
        img = self.gemini_ref_images.get(key)
        if not img:
            self.status_var.set("No image to copy.")
            return
        try:
            self._copy_to_app_clipboard(img, source=f"gemini_ref_{key}", success_msg="Image copied to app clipboard.", fail_msg="Copy failed")
        except Exception:
            self.status_var.set("Clipboard copy unavailable on this platform.")

    def _show_ref_context_menu(self, key, event):
        from dark_theme import DarkTheme
        menu = tk.Menu(self.root, tearoff=0, bg=DarkTheme.FRAME_BG, fg=DarkTheme.TEXT_FG)
        menu.add_command(label="💾 Save Image", command=lambda k=key: self._save_gemini_ref(k))
        menu.add_command(label="📋 Copy Image", command=lambda k=key: self._copy_gemini_ref(k))
        menu.add_command(label="📥 Paste Image", command=lambda k=key: self.gemini_paste_ref(k))
        menu.add_command(label="📂 Open Image...", command=lambda k=key: self.gemini_load_ref(k))
        menu.add_separator()
        menu.add_command(label="🔍 Reset View", command=lambda k=key: self._reset_gemini_zoom(k))
        menu.add_command(label="🗑️ Clear", command=lambda k=key: self.gemini_clear_ref(k))
        menu.tk_popup(event.x_root, event.y_root)

    def gemini_load_ref(self, key: str):
        path = filedialog.askopenfilename(
            title=f"Load {key.replace('_',' ').title()}",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif *.tiff"), ("All files", "*.*")]
        )
        if not path:
            return
        try:
            img = Image.open(path).convert("RGB")
            self.gemini_ref_images[key] = img
            self.gemini_update_display(view=key, force_update=True)
            self.status_var.set(f"Loaded {key.replace('_',' ').title()}")
        except Exception as e:
            messagebox.showerror("Load Failed", str(e))

    def gemini_paste_ref(self, key: str):
        try:
            img = self._paste_from_app_or_system()
            if isinstance(img, Image.Image):
                self.gemini_ref_images[key] = img.convert("RGB")
                self.gemini_update_display(view=key, force_update=True)
                self.status_var.set(f"Pasted into {key.replace('_',' ').title()}")
            else:
                messagebox.showinfo("No Image", "No image in clipboard.")
        except Exception as e:
            messagebox.showerror("Paste Failed", str(e))

    def gemini_clear_ref(self, key: str):
        self.gemini_ref_images[key] = None
        canvas = self.gemini_canvases.get(key)
        if canvas:
            canvas.delete("all")
        self.status_var.set(f"Cleared {key.replace('_',' ').title()}")

    def _reset_multiview_zoom(self):
        """Reset Multi-View zoom/pan to default fit view."""
        if hasattr(self, "_mv_zoom"):
            for k in self._mv_zoom:
                self._mv_zoom[k] = 1.0
                self._mv_offset[k] = [0, 0]
        self.multiview_update_tab_display(self.multiview_current_tab)
        self.status_var.set("🔍 Multi-View reset (Esc)")

    def _update_multiview_action_states(self):
        """Enable or disable image-dependent Multi-View buttons based on main stage content."""
        has_image = bool(getattr(self, "multiview_main_stage_image", None))
        try:
            state = "normal" if has_image else "disabled"
            self.multiview_isolate_btn.configure(state=state)
            self.multiview_generate_selected_btn.configure(state=state)
            self.multiview_generate_all_btn.configure(state=state)
        except Exception as e:
            print(f"[DEBUG] Failed to update multiview button states: {e}")

    def create_edit_history_panel(self, parent, mode: str):
        """
        Create a collapsible Edit History panel for Gemini or Multi-View.
        Auto-expands when a new edit is added.
        """
        from dark_theme import DarkTheme

        # --- Container + header bar ---
        container = ttk.Frame(parent)
        container.pack(fill=tk.BOTH, expand=False, pady=(6, 8))

        header = ttk.Frame(container)
        header.pack(fill=tk.X, pady=(0, 2))

        is_expanded = tk.BooleanVar(value=False)
        # Initial arrow based on collapsed state
        initial_arrow = "►"
        arrow = tk.Label(
            header, text=initial_arrow, font=("Segoe UI", 10, "bold"),
            fg=DarkTheme.TEXT_FG, bg=DarkTheme.FRAME_BG, cursor="hand2"
        )
        arrow.pack(side="left", padx=(2, 4))
        ttk.Label(header, text="Edit History", font=("Segoe UI", 10, "bold")).pack(side="left")

        # --- Scrollable frame (hidden when collapsed) ---
        wrapper = ttk.Frame(container)
        # Start collapsed
        # wrapper will be packed when expanded

        canvas = tk.Canvas(wrapper, height=180, highlightthickness=0, bg="#4F4F4F")
        scrollbar = ttk.Scrollbar(wrapper, orient="vertical", command=canvas.yview)
        frame = ttk.Frame(canvas)

        frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # --- Scrollbar + mouse wheel binding ---
        def _on_mousewheel(event):
            try:
                canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            except Exception:
                pass

        # Windows and most systems
        canvas.bind_all("<MouseWheel>", lambda e: _on_mousewheel(e))
        # macOS/Linux button events
        canvas.bind_all("<Button-4>", lambda e: canvas.yview_scroll(-1, "units"))
        canvas.bind_all("<Button-5>", lambda e: canvas.yview_scroll(1, "units"))

        # --- Toggle behavior ---
        def toggle_panel():
            if is_expanded.get():
                wrapper.pack_forget()
                arrow.config(text="►")
                is_expanded.set(False)
            else:
                wrapper.pack(fill=tk.BOTH, expand=True)
                arrow.config(text="▼")
                is_expanded.set(True)

        arrow.bind("<Button-1>", lambda e: toggle_panel())
        arrow.bind("<Enter>", lambda e: arrow.config(fg="#FFFFFF"))
        arrow.bind("<Leave>", lambda e: arrow.config(fg=DarkTheme.TEXT_FG))

        # --- Store references ---
        if mode == "gemini":
            self.gemini_edit_canvas = canvas
            self.gemini_edit_frame = frame
            self._gemini_edit_expanded = is_expanded
        else:
            self.multiview_edit_canvas = canvas
            self.multiview_edit_frame = frame
            self._multiview_edit_expanded = is_expanded

        return container

    def send_multiview_to_gemini(self):
        """Send current Multi-View Main Stage image to Gemini Main Stage."""
        if not getattr(self, "multiview_main_stage_image", None):
            self.status_var.set("No Multi-View image to send.")
            return
        self.gemini_current_image = self.multiview_main_stage_image.copy()
        self._main_stage_zoom = 1.0
        self._main_stage_offset = [0, 0]
        self.show_mode("gemini")
        self.gemini_update_display(force_update=True)
        self.root.after(100, lambda: self.gemini_update_display(force_update=True))
        self.root.after(200, lambda: self.gemini_update_display(force_update=True))
        self.status_var.set("Image sent from Multi-View → Gemini Main Stage.")
        try:
            self._update_multiview_action_states()
        except Exception:
            pass

    def update_edit_history_display(self, mode: str, image_path=None):
        """Refresh the edit history list and auto-expand panel when new edits appear."""
        from datetime import datetime
        from dark_theme import DarkTheme

        frame = self.gemini_edit_frame if mode == "gemini" else self.multiview_edit_frame
        expanded_flag = self._gemini_edit_expanded if mode == "gemini" else self._multiview_edit_expanded

        for child in frame.winfo_children():
            child.destroy()

        edits = []
        if image_path:
            edits = self.edit_registry.get(mode, {}).get(str(image_path), [])

        if not edits:
            ttk.Label(
                frame, text="No edits yet.\nApply changes to create history.",
                foreground="#888888", font=("Segoe UI", 9, "italic")
            ).pack(anchor="w", padx=4, pady=4)
            return

        # Auto-expand when new edits appear while collapsed
        if not expanded_flag.get():
            parent = frame.master
            parent.pack(fill=tk.BOTH, expand=True)
            expanded_flag.set(True)
            arrow_widget = None
            for widget in parent.master.winfo_children():
                if isinstance(widget, tk.Label) and widget.cget("text") in ["▼", "►"]:
                    arrow_widget = widget
                    break
            if arrow_widget:
                arrow_widget.config(text="▼")

        header = ttk.Label(
            frame,
            text=f"Edits ({len(edits)} total)",
            foreground="#B0B0B0",
            font=("Segoe UI", 9, "bold")
        )
        header.pack(anchor="w", padx=4, pady=(2, 4))

        # Show newest first
        for entry in reversed(edits):
            ts = entry.get("timestamp", datetime.now().strftime("%H:%M:%S"))
            prompt = entry.get("prompt", "(unknown)")
            img_file = entry.get("image_file", "")
            is_original = entry.get("is_original", False)

            row = ttk.Frame(frame)
            row.pack(fill="x", pady=1, padx=4)

            btn = ttk.Button(row, text="🖼", width=3,
                             command=lambda f=img_file, m=mode: self.load_edit_image(m, f))
            btn.pack(side="left", padx=(4, 2))

            text = f"[{ts}] {prompt}"
            if is_original:
                text += " (original)"
            ttk.Label(row, text=text, anchor="w",
                      foreground=DarkTheme.TEXT_FG).pack(side="left", fill="x", expand=True)

    def load_edit_image(self, mode: str, filename: str):
        """Load a specific history image back into the stage."""
        from PIL import Image as _Image
        try:
            img = _Image.open(filename)
            if mode == "gemini":
                self.gemini_current_image = img
                self.gemini_update_display()
            else:
                self.multiview_main_stage_image = img
                self.multiview_update_tab_display("main")
            self.status_var.set(f"Restored {mode.capitalize()} image: {Path(filename).name}")
        except Exception as e:
            print(f"[DEBUG] load_edit_image failed: {e}")

    def add_edit_history_entry(self, mode: str, image, prompt: str = "Original Image", is_original=False):
        """Add a new entry to the edit history for this mode."""
        from datetime import datetime
        import tempfile
        from PIL import Image as _Image
        if image is None:
            return
        tmp_dir = Path(tempfile.gettempdir()) / "multi_tool_history"
        tmp_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%H-%M-%S")
        filename = f"{mode}_{timestamp}.png"
        path = tmp_dir / filename
        try:
            image.save(path)
        except Exception as e:
            print(f"[DEBUG] Failed to save history image: {e}")
        entry = {
            "timestamp": timestamp,
            "prompt": prompt,
            "image_file": str(path),
            "is_original": is_original
        }
        self.edit_registry.setdefault(mode, {}).setdefault("current", []).append(entry)
        self.update_edit_history_display(mode, image_path="current")
    
    def multiview_copy_image(self):
        if self.multiview_current_tab == "main":
            img = self.multiview_main_stage_image
        else:
            img = self.multiview_generated_views.get(self.multiview_current_tab)
        if not img:
            messagebox.showwarning("No Image", "No image in current tab")
            return
        try:
            self._copy_to_app_clipboard(
                img,
                source=f"multiview_{self.multiview_current_tab}",
                success_msg=None,
                fail_msg=None,
            )
            self._clipboard_image = self.clipboard.get_image()
            messagebox.showinfo("Success", "Image copied to app clipboard")
        except Exception as e:
            messagebox.showinfo("Info", f"Saved to temp_clipboard.png (copy failed: {e})")
    
    def multiview_send_to_ps(self):
        if self.multiview_current_tab == "main":
            img = self.multiview_main_stage_image
        else:
            img = self.multiview_generated_views.get(self.multiview_current_tab)
        if not img:
            self.status_var.set("No image in current tab")
            return
        if ImageUtils.send_to_photoshop(img):
            self.status_var.set("Opened in Photoshop")
        else:
            self.status_var.set("Photoshop API not available")
    
    def multiview_save_all_images(self):
        """Save all loaded images from all views to a selected folder."""
        # Collect all available images
        images_to_save = []
        
        if self.multiview_main_stage_image:
            images_to_save.append(("main", self.multiview_main_stage_image))
        
        for view_name in ["threequarter", "front", "back", "side"]:
            img = self.multiview_generated_views.get(view_name)
            if img:
                images_to_save.append((view_name, img))
        
        if not images_to_save:
            messagebox.showwarning("No Images", "No images loaded to save.")
            return
        
        # Open folder selection dialog
        from tkinter import filedialog
        folder = filedialog.askdirectory(title="Select folder to save all images")
        
        if not folder:
            return
        
        # Save all images
        saved_count = 0
        failed_count = 0
        
        for view_name, img in images_to_save:
            try:
                timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                filename = f"{view_name}_view_{timestamp}.png"
                filepath = Path(folder) / filename
                img.save(filepath, "PNG")
                saved_count += 1
            except Exception as e:
                print(f"Failed to save {view_name}: {e}")
                failed_count += 1
        
        # Show result
        if failed_count == 0:
            messagebox.showinfo("Success", f"✅ Saved {saved_count} image(s) to:\n{folder}")
            self.status_var.set(f"Saved {saved_count} image(s) successfully")
        else:
            messagebox.showwarning("Partial Success", 
                                 f"Saved {saved_count} image(s), {failed_count} failed.\nCheck console for errors.")
            self.status_var.set(f"Saved {saved_count} image(s), {failed_count} failed")
    
    def multiview_on_tab_changed(self, event):
        tab_idx = self.multiview_notebook.index(self.multiview_notebook.select())
        tabs = ["main", "threequarter", "front", "back", "side", "top", "bottom"]
        if tab_idx < len(tabs):
            self.multiview_current_tab = tabs[tab_idx]
            self.root.after(0, lambda: self.multiview_update_tab_display(self.multiview_current_tab, force_update=True))
            self.root.after(50, lambda: self.multiview_update_tab_display(self.multiview_current_tab, force_update=True))
            self.root.after(150, lambda: self.multiview_update_tab_display(self.multiview_current_tab, force_update=True))

    def _update_multiview_isolate_state(self):
        # This method should be implemented to update the state of multiview_main_stage_image
        # based on the current state of multiview_source_image and multiview_prompt_text
        pass

def probe_gemini_models(api_key):
    """
    Detects which Gemini image models the API key can access and whether
    non-square (portrait/landscape) generation is honored.
    Uses prompt-based detection instead of generation_config fields.
    """
    import google.generativeai as genai
    from PIL import Image
    import io

    genai.configure(api_key=api_key)
    supported = {}

    probes = [
        ("Gemini 3 Image Preview", "gemini-3-pro-image-preview", "Generate an abstract pattern in 1:1 square (1024x1024)."),
    ]

    for label, model_name, prompt in probes:
        try:
            # Quiet probe; no console prints
            model = genai.GenerativeModel(model_name)
            result = model.generate_content(
                [prompt],
                generation_config={"temperature": 0.2, "candidate_count": 1}
            )

            if hasattr(result, "parts"):
                for part in result.parts:
                    if hasattr(part, "inline_data") and part.inline_data:
                        img_data = part.inline_data.data
                        if isinstance(img_data, bytes):
                            img = Image.open(io.BytesIO(img_data))
                            supported[label] = img.size
                            # Quiet success
                            break
                else:
                    supported[label] = False
            else:
                supported[label] = False

        except Exception as e:
            supported[label] = False
            # Quiet errors

    return supported

def main():
    def _clean_key(val: str) -> str:
        return (val or "").strip().lstrip("\ufeff").strip('"').strip("'")

    if not GEMINI_AVAILABLE:
        print("\nERROR: Missing dependencies!")
        print("Install: pip install Pillow google-generativeai")
        input("\nPress Enter to exit...")
        return
    if getattr(sys, "frozen", False):
        base_dir = Path(sys.executable).parent
    else:
        base_dir = Path(__file__).parent
        mv = base_dir / "MULTIVIEW"
        if mv.exists():
            base_dir = mv

    api_key = _clean_key(os.environ.get('GEMINI_API_KEY', '') or os.environ.get('GOOGLE_API_KEY', ''))
    if not api_key:
        print("No API key provided")
        return
    root = tk.Tk()
    app = DualModeApp(root, api_key)
    # Probe capabilities asynchronously after UI shows
    root.after(2000, lambda: threading.Thread(target=lambda: setattr(app, 'capabilities', probe_gemini_models(api_key)), daemon=True).start())
    root.mainloop()

if __name__ == "__main__":
    main()
