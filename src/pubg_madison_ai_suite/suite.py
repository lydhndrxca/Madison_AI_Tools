#!/usr/bin/env python3
import importlib.util
import json
import os
import shutil
import traceback
import sys
import tkinter as tk
import threading
import ctypes
import msvcrt
from pathlib import Path
from tkinter import ttk, filedialog, simpledialog, messagebox
from PIL import Image, ImageTk


PACKAGE_DIR = Path(__file__).resolve().parent


def _resolve_base_dir() -> Path:
    override = os.environ.get("PUBG_SUITE_BASEDIR", "").strip()
    if override:
        return Path(override).resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # src/pubg_madison_ai_suite -> parents[1] = project root
    return PACKAGE_DIR.parents[1]


BASE_DIR = _resolve_base_dir()
ASSETS_ROOT = PACKAGE_DIR / "assets"
TOOLS_ROOT = PACKAGE_DIR / "tools"
CONFIG_ROOT = BASE_DIR / "config"
DARK_THEME_PATH = PACKAGE_DIR / "dark_theme.py"


def _find_app_root() -> Path:
    for parent in [PACKAGE_DIR] + list(PACKAGE_DIR.parents):
        if (parent / "run.bat").exists():
            return parent
    return BASE_DIR.parent


APP_ROOT = _find_app_root()
OUTPUT_ROOT = BASE_DIR / "output"
IMAGES_ROOT = APP_ROOT / "ALL GENERATED IMAGES"
LOG_ROOT = OUTPUT_ROOT / "logs"
TMP_ROOT = OUTPUT_ROOT / "tmp"
SAVE_DIR = BASE_DIR / "saves"

for path in [OUTPUT_ROOT, IMAGES_ROOT, LOG_ROOT, TMP_ROOT, SAVE_DIR, CONFIG_ROOT]:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

os.environ["PUBG_SUITE_SAVE_ROOT"] = str(IMAGES_ROOT)
os.environ["PUBG_SUITE_ROOT"] = str(BASE_DIR)
weapon_assets_dir = APP_ROOT / "Add or Remove Gun Images Here"
if weapon_assets_dir.exists():
    os.environ["PUBG_WEAPON_ASSETS_DIR"] = str(weapon_assets_dir)
else:
    fallback_assets_dir = ASSETS_ROOT / "Weapon_Generator"
    if fallback_assets_dir.exists():
        os.environ["PUBG_WEAPON_ASSETS_DIR"] = str(fallback_assets_dir)

ICON_DIR = ASSETS_ROOT / "Icon"
ICON_PATH = ICON_DIR / "ICON.png"
ICON_ICO_PATH = ICON_DIR / "ICON.ico"

RECENT_LIMIT = 8
RECENT_FILES = []

# ── Image model registry ─────────────────────────────────────
# Every Gemini-ecosystem image generation model available via the API.
# "multimodal" means the model accepts image+text input (editing/reference).
# "api" indicates which SDK path is used: "genai" (google.genai) or "generativeai" (google.generativeai).

IMAGE_MODELS = [
    {
        "id": "gemini-3-pro-image-preview",
        "label": "Nano Banana Pro",
        "resolution": "4K (up to 5504px)",
        "time_estimate": "~40-90s",
        "multimodal": True,
        "api": "genai",
        "supports_4k": True,
        "description": "Studio-quality, complex layouts, precise text rendering",
    },
    {
        "id": "gemini-3.1-flash-image-preview",
        "label": "Nano Banana 2",
        "resolution": "4K (up to 5504px)",
        "time_estimate": "~20-45s",
        "multimodal": True,
        "api": "genai",
        "supports_4k": True,
        "description": "High-volume, fast iteration, image search grounding",
    },
    {
        "id": "gemini-2.5-flash-image",
        "label": "Nano Banana",
        "resolution": "1K (1024px)",
        "time_estimate": "~3-8s",
        "multimodal": True,
        "api": "genai",
        "supports_4k": False,
        "description": "Quick drafts, rapid iteration, lowest latency",
    },
    {
        "id": "imagen-4.0-ultra-generate-001",
        "label": "Imagen 4 Ultra",
        "resolution": "2K (up to 2816px)",
        "time_estimate": "~15-30s",
        "multimodal": False,
        "api": "genai",
        "supports_4k": False,
        "description": "Maximum fidelity, photorealistic output",
    },
    {
        "id": "imagen-4.0-generate-001",
        "label": "Imagen 4 Standard",
        "resolution": "2K (up to 2816px)",
        "time_estimate": "~5-10s",
        "multimodal": False,
        "api": "genai",
        "supports_4k": False,
        "description": "Balanced quality and speed",
    },
    {
        "id": "imagen-4.0-fast-generate-001",
        "label": "Imagen 4 Fast",
        "resolution": "1K (1024px)",
        "time_estimate": "~2-5s",
        "multimodal": False,
        "api": "genai",
        "supports_4k": False,
        "description": "Rapid prototyping, fastest Imagen",
    },
]

DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview"


def _load_image_model() -> str:
    env_val = os.environ.get("PUBG_IMAGE_MODEL", "").strip()
    if env_val:
        return env_val
    kp = CONFIG_ROOT / "keys.json"
    if kp.exists():
        try:
            data = json.loads(kp.read_text(encoding="utf-8"))
            val = str(data.get("image_model", "")).strip()
            if val:
                return val
        except Exception:
            pass
    return DEFAULT_IMAGE_MODEL


def _save_image_model(model_id: str):
    kp = CONFIG_ROOT / "keys.json"
    kp.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if kp.exists():
        try:
            data = json.loads(kp.read_text(encoding="utf-8"))
        except Exception:
            pass
    data["image_model"] = model_id
    kp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.environ["PUBG_IMAGE_MODEL"] = model_id


def get_image_model_info(model_id: str = None) -> dict:
    """Return the registry entry for a model id, or the currently selected one."""
    if model_id is None:
        model_id = os.environ.get("PUBG_IMAGE_MODEL", DEFAULT_IMAGE_MODEL)
    for m in IMAGE_MODELS:
        if m["id"] == model_id:
            return m
    return IMAGE_MODELS[0]


TOOLS = {
    "multitool": {
        "path": TOOLS_ROOT / "AI_Multitool_v1_1",
        "module": "prop_generator.py",
        "init": "DualModeApp",
    },
    "weapon": {
        "path": TOOLS_ROOT / "AI_Gun_Generator_v1_3",
        "module": "Weapon_Generator_V1_3.py",
        "init": "App",
    },
    "character": {
        "path": TOOLS_ROOT / "AI_Character_Generator_v1_4",
        "module": "character_generator.py",
        "init": "App",
    },
}


def _load_module(name: str, module_path: Path):
    """Load a tool module after registering the shared dark_theme."""
    theme_spec = importlib.util.spec_from_file_location(f"{name}_dark_theme", DARK_THEME_PATH)
    theme_mod = importlib.util.module_from_spec(theme_spec)
    theme_spec.loader.exec_module(theme_mod)
    sys.modules["dark_theme"] = theme_mod

    spec = importlib.util.spec_from_file_location(name, module_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ── API key management ──────────────────────────────────────────

def _keys_path() -> Path:
    return CONFIG_ROOT / "keys.json"


def _load_api_key() -> str:
    for env_var in ["GEMINI_API_KEY", "GOOGLE_API_KEY", "PUBG_API_KEY"]:
        key = os.environ.get(env_var, "").strip()
        if key:
            return key

    kp = _keys_path()
    if kp.exists():
        try:
            data = json.loads(kp.read_text(encoding="utf-8"))
            for field in ["gemini_api_key", "google_api_key", "api_key", "default"]:
                val = str(data.get(field, "")).strip()
                if val:
                    return val
        except Exception:
            pass
    return ""


def _save_api_key(key: str):
    kp = _keys_path()
    kp.parent.mkdir(parents=True, exist_ok=True)
    kp.write_text(json.dumps({"gemini_api_key": key}, indent=2), encoding="utf-8")


def _apply_api_key(key: str):
    os.environ["GEMINI_API_KEY"] = key
    os.environ["GOOGLE_API_KEY"] = key


# ── Logging ─────────────────────────────────────────────────────

def _log_startup(message: str):
    try:
        log_path = LOG_ROOT / "startup.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(message.rstrip() + "\n")
    except Exception:
        pass


def _ensure_generated_image_folders():
    for name in ["Gemini", "Multiview", "Character Generator", "Weapon Generator"]:
        try:
            (IMAGES_ROOT / name).mkdir(parents=True, exist_ok=True)
        except Exception:
            pass


def _ensure_weapon_assets_folder():
    target_dir = ASSETS_ROOT / "Weapon_Generator"
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        return
    if any(target_dir.glob("*.png")):
        return
    source_dir = TOOLS_ROOT / "AI_Gun_Generator_v1_3" / "assets" / "reference_guns"
    if not source_dir.exists():
        return
    for src in source_dir.glob("*"):
        if src.is_file():
            try:
                shutil.copy2(src, target_dir / src.name)
            except Exception:
                pass


def _ensure_console():
    try:
        ctypes.windll.kernel32.AllocConsole()
    except Exception:
        pass
    try:
        def _redirect(std_handle):
            try:
                handle = ctypes.windll.kernel32.GetStdHandle(std_handle)
                if handle in (0, -1):
                    return None
                fd = msvcrt.open_osfhandle(int(handle), os.O_TEXT)
                return os.fdopen(fd, "w", buffering=1)
            except Exception:
                return None
        out = _redirect(-11)
        err = _redirect(-12)
        if out:
            sys.stdout = out
        if err:
            sys.stderr = err
    except Exception:
        pass


def _show_splash(root, image_path=None):
    try:
        splash_path = image_path if image_path and Path(image_path).exists() else ICON_PATH
        if not splash_path.exists():
            return None
        splash = tk.Toplevel(root)
        splash.overrideredirect(True)
        try:
            splash.wm_attributes("-topmost", True)
        except Exception:
            pass
        img = tk.PhotoImage(file=str(splash_path))
        splash._img = img
        w, h = img.width(), img.height()
        x = (splash.winfo_screenwidth() - w) // 2
        y = (splash.winfo_screenheight() - h) // 2
        splash.geometry(f"{w}x{h}+{x}+{y}")
        lbl = tk.Label(splash, image=img, borderwidth=0, highlightthickness=0)
        lbl.pack()
        splash.update_idletasks()
        splash.update()
        return splash
    except Exception:
        return None


def _ensure_transparent_icon():
    try:
        if not ICON_PATH.exists():
            return None
        transparent_png = TMP_ROOT / "ICON_TRANSPARENT.png"
        if not transparent_png.exists():
            pil_icon = Image.open(ICON_PATH).convert("RGBA")
            new_pixels = []
            for r, g, b, a in pil_icon.getdata():
                if r > 250 and g > 250 and b > 250:
                    new_pixels.append((r, g, b, 0))
                else:
                    new_pixels.append((r, g, b, a))
            pil_icon.putdata(new_pixels)
            try:
                pil_icon.save(transparent_png, format="PNG")
            except Exception:
                transparent_png = None
            try:
                ICON_ICO_PATH.parent.mkdir(exist_ok=True)
                pil_icon.save(ICON_ICO_PATH, format="ICO",
                              sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
            except Exception:
                pass
        return transparent_png if transparent_png and Path(transparent_png).exists() else None
    except Exception:
        return None


class TabRoot(tk.Frame):
    def __init__(self, master, title=""):
        super().__init__(master, bg="#4F4F4F")
        self._top = master.winfo_toplevel()
        self._title = title

    def title(self, text=None):
        if text is None:
            return self._title
        self._title = text
        try:
            self._top.title(text)
        except Exception:
            pass

    def geometry(self, value=None):
        try:
            return self._top.geometry() if value is None else self._top.geometry(value)
        except Exception:
            return ""

    def state(self, value=None):
        try:
            return self._top.state() if value is None else self._top.state(value)
        except Exception:
            return ""

    def protocol(self, *args):
        try:
            return self._top.protocol(*args)
        except Exception:
            return None

    def iconphoto(self, *args, **kwargs):
        try:
            return self._top.iconphoto(*args, **kwargs)
        except Exception:
            return None

    def wm_attributes(self, *args, **kwargs):
        try:
            return self._top.wm_attributes(*args, **kwargs)
        except Exception:
            return None

    def minsize(self, w=None, h=None):
        try:
            return self._top.minsize(w, h)
        except Exception:
            return None


def _init_multitool(tab, api_key, start_mode="gemini", hide_tabs=False):
    tool = TOOLS["multitool"]
    mod = _load_module("pubg_multitool", tool["path"] / tool["module"])
    root = TabRoot(tab, "PUBG Madison AI Suite v2.0 - Multitool")
    root.pack(fill="both", expand=True)
    app = getattr(mod, tool["init"])(root, api_key, start_mode=start_mode, hide_internal_tabs=hide_tabs)
    if hasattr(mod, "probe_gemini_models"):
        root.after(
            2000,
            lambda: threading.Thread(
                target=lambda: setattr(app, "capabilities", mod.probe_gemini_models(api_key)),
                daemon=True,
            ).start(),
        )
    return app


def _init_weapon(tab):
    tool = TOOLS["weapon"]
    mod = _load_module("pubg_weapon_gen", tool["path"] / tool["module"])
    root = TabRoot(tab, "PUBG Madison AI Suite v2.0 - Weapons")
    root.pack(fill="both", expand=True)
    try:
        mod.setup_dark_theme(root)
    except Exception:
        pass
    return getattr(mod, tool["init"])(root)


def _init_character(tab):
    tool = TOOLS["character"]
    mod = _load_module("pubg_character_gen", tool["path"] / tool["module"])
    root = TabRoot(tab, "PUBG Madison AI Suite v2.0 - Characters")
    root.pack(fill="both", expand=True)
    try:
        mod.setup_dark_theme(root)
    except Exception:
        pass
    return getattr(mod, tool["init"])(root)


def _init_gemini(tab, api_key):
    return _init_multitool(tab, api_key, start_mode="gemini", hide_tabs=True)


def _init_multiview(tab, api_key):
    return _init_multitool(tab, api_key, start_mode="multiview", hide_tabs=True)


def main():
    _ensure_console()
    _log_startup("=== PUBG Madison AI Suite starting ===")

    root = tk.Tk()
    try:
        root.withdraw()
    except Exception:
        pass

    splash = None
    if not getattr(sys, "frozen", False):
        splash_path = _ensure_transparent_icon()
        splash = _show_splash(root, splash_path)
    try:
        root.update_idletasks()
        root.update()
    except Exception:
        pass

    api_key = _load_api_key()

    # Destroy splash before any modal dialog so it isn't hidden behind it
    try:
        if splash:
            splash.destroy()
            splash = None
    except Exception:
        pass

    if not api_key:
        try:
            root.deiconify()
        except Exception:
            pass
        api_key = simpledialog.askstring(
            "API Key Required",
            "Enter your Google Gemini API key:",
            show="*",
            parent=root,
        ) or ""
        api_key = api_key.strip()
        if api_key:
            _save_api_key(api_key)
        try:
            root.withdraw()
        except Exception:
            pass

    if api_key:
        _apply_api_key(api_key)

    selected_image_model = _load_image_model()
    os.environ["PUBG_IMAGE_MODEL"] = selected_image_model

    os.environ.setdefault("PUBG_SUITE_ROOT", str(BASE_DIR))
    _ensure_generated_image_folders()
    threading.Thread(target=_ensure_weapon_assets_folder, daemon=True).start()

    try:
        if ICON_PATH.exists():
            ICON_ICO_PATH.parent.mkdir(exist_ok=True)
            if not ICON_ICO_PATH.exists():
                img = Image.open(ICON_PATH)
                img.save(ICON_ICO_PATH, format="ICO",
                         sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
    except Exception:
        pass

    root.title("PUBG Madison AI Suite v2.0")
    try:
        root.option_add("*Menu*Background", "#3A3A3A")
        root.option_add("*Menu*Foreground", "#E0E0E0")
        root.option_add("*Menu*activeBackground", "#5A5A5A")
        root.option_add("*Menu*activeForeground", "#FFFFFF")
    except Exception:
        pass

    try:
        if ICON_PATH.exists():
            pil_icon = Image.open(ICON_PATH).convert("RGBA")
            new_pixels = []
            for r, g, b, a in pil_icon.getdata():
                if r > 250 and g > 250 and b > 250:
                    new_pixels.append((r, g, b, 0))
                else:
                    new_pixels.append((r, g, b, a))
            pil_icon.putdata(new_pixels)
            try:
                transparent_png = TMP_ROOT / "ICON_TRANSPARENT.png"
                pil_icon.save(transparent_png, format="PNG")
                icon_img = ImageTk.PhotoImage(pil_icon)
                root.iconphoto(True, icon_img)
                root._icon_img = icon_img
                ICON_ICO_PATH.parent.mkdir(exist_ok=True)
                pil_icon.save(ICON_ICO_PATH, format="ICO",
                              sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
                root.iconbitmap(default=str(ICON_ICO_PATH))
            except Exception:
                icon_img = ImageTk.PhotoImage(pil_icon)
                root.iconphoto(True, icon_img)
                root._icon_img = icon_img
    except Exception:
        pass

    try:
        root.state("zoomed")
    except Exception:
        root.geometry("1600x950")

    # ── File menu helpers ────────────────────────────────────────

    def _add_recent(path):
        p = str(Path(path))
        if p in RECENT_FILES:
            RECENT_FILES.remove(p)
        RECENT_FILES.insert(0, p)
        del RECENT_FILES[RECENT_LIMIT:]
        _refresh_recent_menu()

    def _refresh_recent_menu():
        open_recent_menu.delete(0, "end")
        if not RECENT_FILES:
            open_recent_menu.add_command(label="(none)", state="disabled")
            return
        for p in RECENT_FILES:
            open_recent_menu.add_command(label=p, command=lambda f=p: _open_session(f))

    def _new_session():
        messagebox.showinfo("New", "Start a new session.")

    def _open_session(path=None):
        target = path
        if not target:
            target = filedialog.askopenfilename(
                initialdir=SAVE_DIR, title="Open Session",
                filetypes=[("Session Files", "*.txt;*.json;*.*")])
        if target:
            messagebox.showinfo("Open", f"Opened session:\n{target}")
            _add_recent(target)

    def _save_session():
        name = simpledialog.askstring("Save Session", "Enter a session name:")
        if not name:
            return
        filename = name if any(name.lower().endswith(ext) for ext in [".txt", ".json"]) else f"{name}.txt"
        path = SAVE_DIR / filename
        try:
            path.write_text("PUBG Madison AI Suite session\n", encoding="utf-8")
            messagebox.showinfo("Saved", f"Session saved to:\n{path}")
            _add_recent(path)
        except Exception as e:
            messagebox.showerror("Save Failed", str(e))

    def _set_api_key():
        nonlocal api_key
        current = os.environ.get("GEMINI_API_KEY", "")
        masked = current[:8] + "..." if len(current) > 8 else current

        dlg = tk.Toplevel(root)
        dlg.title("Set API Key")
        dlg.configure(bg="#2B2B2B")
        dlg.resizable(False, False)
        dlg.transient(root)
        dlg.grab_set()

        width, height = 480, 220
        x = (dlg.winfo_screenwidth() - width) // 2
        y = (dlg.winfo_screenheight() - height) // 2
        dlg.geometry(f"{width}x{height}+{x}+{y}")

        tk.Label(dlg, text="Google Gemini API Key", font=("Segoe UI", 13, "bold"),
                 bg="#2B2B2B", fg="#FFFFFF").pack(pady=(18, 4))
        if masked:
            tk.Label(dlg, text=f"Current: {masked}", font=("Segoe UI", 9),
                     bg="#2B2B2B", fg="#888888").pack()

        entry_frame = tk.Frame(dlg, bg="#2B2B2B")
        entry_frame.pack(pady=12, padx=24, fill="x")
        key_var = tk.StringVar()
        entry = tk.Entry(entry_frame, textvariable=key_var, show="*",
                         font=("Consolas", 11), bg="#3C3C3C", fg="#E0E0E0",
                         insertbackground="#E0E0E0", relief="flat", bd=2)
        entry.pack(fill="x", ipady=4)
        entry.focus_set()

        status_var = tk.StringVar()
        tk.Label(dlg, textvariable=status_var, font=("Segoe UI", 9),
                 bg="#2B2B2B", fg="#4A7C4A").pack()

        def _apply():
            nonlocal api_key
            new_key = key_var.get().strip()
            if not new_key:
                status_var.set("Key cannot be empty.")
                return
            api_key = new_key
            _save_api_key(api_key)
            _apply_api_key(api_key)
            status_var.set("Key saved and applied!")
            dlg.after(800, dlg.destroy)

        btn_frame = tk.Frame(dlg, bg="#2B2B2B")
        btn_frame.pack(pady=(4, 14))
        tk.Button(btn_frame, text="Save", command=_apply,
                  font=("Segoe UI", 10, "bold"), bg="#444444", fg="white",
                  activebackground="#555555", activeforeground="white",
                  relief="flat", width=12, pady=6).pack(side="left", padx=6)
        tk.Button(btn_frame, text="Cancel", command=dlg.destroy,
                  font=("Segoe UI", 10), bg="#444444", fg="white",
                  activebackground="#555555", activeforeground="white",
                  relief="flat", width=12, pady=6).pack(side="left", padx=6)

        dlg.bind("<Return>", lambda e: _apply())

    # ── About / How-to / Bug Report ─────────────────────────────

    def _show_about():
        about = tk.Toplevel(root)
        about.title("About AI Models - v2.0")
        about.configure(bg="#2B2B2B")
        width, height = 700, 680
        x = (about.winfo_screenwidth() - width) // 2
        y = (about.winfo_screenheight() - height) // 2
        about.geometry(f"{width}x{height}+{x}+{y}")
        about.resizable(False, False)
        about.transient(root)
        about.grab_set()

        tk.Label(about, text="PUBG Madison AI Suite v2.0", font=("Segoe UI", 16, "bold"),
                 bg="#2B2B2B", fg="#FFFFFF", pady=10).pack()
        active = get_image_model_info(selected_image_model)
        tk.Label(about, text=f"Active Image Model: {active['label']}  ({active['id']})",
                 font=("Segoe UI", 10, "bold"), bg="#2B2B2B", fg="#6CB56C").pack(pady=(0, 4))
        tk.Label(about, text=f"{active['resolution']}  \u2022  {active['time_estimate']}  \u2022  {'Multimodal' if active['multimodal'] else 'Text-to-Image'}",
                 font=("Segoe UI", 9), bg="#2B2B2B", fg="#AAAAAA").pack(pady=(0, 10))
        tk.Label(about, text="Developed by Shawn Wiederhoeft \u2022 Feedback & Testing: Eric Sandhop",
                 font=("Segoe UI", 9), bg="#2B2B2B", fg="#888888").pack(pady=(0, 12))

        content_frame = tk.Frame(about, bg="#333333", padx=20, pady=14, relief="flat", bd=1)
        content_frame.pack(fill="both", expand=True, padx=20, pady=10)

        tk.Label(content_frame, text="Available Image Models", font=("Segoe UI", 11, "bold"),
                 bg="#333333", fg="#E0E0E0", anchor="w").pack(fill="x", pady=(0, 8))

        for m in IMAGE_MODELS:
            is_active = m["id"] == selected_image_model
            prefix = "\u2714 " if is_active else "  "
            mm_tag = "Multimodal" if m["multimodal"] else "Text\u2192Image"
            fg = "#6CB56C" if is_active else "#CCCCCC"
            tk.Label(content_frame,
                     text=f"{prefix}{m['label']}  |  {m['resolution']}  |  {m['time_estimate']}  |  {mm_tag}",
                     font=("Consolas", 9), bg="#333333", fg=fg, anchor="w", padx=8).pack(fill="x")

        tk.Label(content_frame, text="", bg="#333333").pack(pady=4)
        tk.Label(content_frame, text="Tool Model Assignments", font=("Segoe UI", 11, "bold"),
                 bg="#333333", fg="#E0E0E0", anchor="w").pack(fill="x", pady=(0, 4))

        assignments = [
            "\u2022 Image Generation: controlled by Image Model selector above",
            "\u2022 Text/Attribute Extraction: gemini-2.0-flash (always)",
            "\u2022 Text Reasoning: gemini-2.5-pro (always)",
            "\u2022 Auto-Labeling: gemini-2.0-flash (always)",
        ]
        for line in assignments:
            tk.Label(content_frame, text=line, font=("Consolas", 9),
                     bg="#333333", fg="#CCCCCC", anchor="w", padx=8).pack(fill="x")

        tk.Button(about, text="CLOSE", command=about.destroy,
                  font=("Segoe UI", 10, "bold"), bg="#444444", fg="white",
                  activebackground="#555555", activeforeground="white",
                  relief="flat", width=15, pady=8).pack(pady=20)

    def _should_show_how_to_use():
        try:
            prefs_path = SAVE_DIR / "howto_prefs.json"
            if prefs_path.exists():
                data = json.loads(prefs_path.read_text(encoding="utf-8"))
                return not bool(data.get("hide", False))
        except Exception:
            pass
        return True

    def _show_how_to_use():
        howto = tk.Toplevel(root)
        howto.title("How to Use")
        howto.configure(bg="#2B2B2B")
        width, height = 720, 900
        x = (howto.winfo_screenwidth() - width) // 2
        y = (howto.winfo_screenheight() - height) // 2
        howto.geometry(f"{width}x{height}+{x}+{y}")
        howto.resizable(False, False)
        howto.transient(root)
        howto.grab_set()

        tk.Label(howto, text="How to Use", font=("Segoe UI", 16, "bold"),
                 bg="#2B2B2B", fg="#FFFFFF", pady=10).pack()

        content = tk.Frame(howto, bg="#333333", padx=22, pady=20)
        content.pack(fill="both", expand=True, padx=26, pady=(10, 4))

        def add_section(title, body, row):
            tk.Label(content, text=title, font=("Segoe UI", 11, "bold"),
                     bg="#333333", fg="#E0E0E0", anchor="w").grid(row=row, column=0, sticky="w", pady=(0, 4))
            tk.Label(content, text=body, font=("Segoe UI", 10), bg="#333333", fg="#CCCCCC",
                     anchor="w", justify="left", wraplength=620).grid(row=row + 1, column=0, sticky="w", pady=(0, 14))

        add_section("Gemini",
                    'Use this for fast, single-image ideation. Paste or load a reference into Ref A/B/C, then explicitly call it out in the prompt ("ref a", "ref b", "ref c", or a combination). Use Quality for max detail or Speed for quick drafts.', 0)
        add_section("Multiview",
                    "Use this for turnarounds. Generate a main prop, then create front, back, side, and 3/4 views. Ideal for consistent multi-angle reference.", 2)
        add_section("Character Generator",
                    "Paste a photo of a person/character and use Extract Attributes to pull their traits so the AI can recreate them in your style. You can also write or enhance a description, then generate the main image and consistent front/back/side views.", 4)
        add_section("Weapon Generator",
                    'Generate freeform weapons with no base image, or load a base image to refine. Use Edit Weapon List to open the base images folder; add or remove PNGs there. If using references, explicitly call them out ("ref a", "ref b", "ref c"). Use view tabs for orthographic and 3/4 angles.', 6)
        add_section("How Everything Connects",
                    "You can copy and paste images between tools. For example, generate a weapon in the Weapon Generator, copy it, and paste into Gemini or Multiview as a reference. All generated images are saved in the ALL GENERATED IMAGES folder.", 8)

        tk.Label(content, text="For questions or feedback, contact Shawn Wiederhoeft",
                 font=("Segoe UI", 10), bg="#333333", fg="#CCCCCC", anchor="w",
                 wraplength=620).grid(row=10, column=0, sticky="w", pady=(0, 10))

        def _close_howto():
            if do_not_show_var.get():
                try:
                    prefs_path = SAVE_DIR / "howto_prefs.json"
                    prefs_path.write_text(json.dumps({"hide": True}, indent=2), encoding="utf-8")
                except Exception:
                    pass
            howto.destroy()

        howto.protocol("WM_DELETE_WINDOW", _close_howto)

        bottom_frame = tk.Frame(howto, bg="#2B2B2B")
        bottom_frame.pack(side="bottom", fill="x", pady=(6, 16))
        tk.Button(bottom_frame, text="CLOSE", command=_close_howto,
                  font=("Segoe UI", 10, "bold"), bg="#444444", fg="white",
                  activebackground="#555555", activeforeground="white",
                  relief="flat", width=18, pady=10).pack(pady=(4, 6))
        do_not_show_var = tk.BooleanVar(value=False)
        tk.Checkbutton(bottom_frame, text="Do not show this message again",
                       variable=do_not_show_var, bg="#2B2B2B", fg="#CCCCCC",
                       activebackground="#2B2B2B", activeforeground="#FFFFFF",
                       selectcolor="#2B2B2B").pack(pady=(0, 10))

    def _report_bug():
        report_win = tk.Toplevel(root)
        report_win.title("Report Bug / Feature Request")
        report_win.configure(bg="#2B2B2B")
        width, height = 520, 420
        x = (report_win.winfo_screenwidth() - width) // 2
        y = (report_win.winfo_screenheight() - height) // 2
        report_win.geometry(f"{width}x{height}+{x}+{y}")
        report_win.resizable(False, False)
        report_win.transient(root)
        report_win.grab_set()

        def _copy_text(value: str, label: str):
            try:
                report_win.clipboard_clear()
                report_win.clipboard_append(value)
                report_win.update_idletasks()
            except Exception:
                pass
            status_var.set(f"Copied {label}")

        tk.Label(report_win, text="Please report bugs/feature requests to:",
                 font=("Segoe UI", 12, "bold"), bg="#2B2B2B", fg="#FFFFFF", pady=12).pack(pady=(0, 8))

        info_frame = tk.Frame(report_win, bg="#2B2B2B")
        info_frame.pack(fill="x", padx=20)
        info_frame.grid_columnconfigure(0, weight=1)
        info_frame.grid_columnconfigure(1, weight=0)

        tk.Label(info_frame, text="Shawn Wiederhoeft", font=("Segoe UI", 12),
                 bg="#2B2B2B", fg="#E0E0E0", anchor="w").grid(row=0, column=0, sticky="w", pady=(0, 6))
        tk.Label(info_frame, text="Email: Shawn@pubg.com", font=("Segoe UI", 11),
                 bg="#2B2B2B", fg="#CCCCCC", anchor="w").grid(row=1, column=0, sticky="w", pady=(0, 6))
        tk.Button(info_frame, text="Copy",
                  command=lambda: _copy_text("Shawn@pubg.com", "email"), width=8
                  ).grid(row=1, column=1, sticky="e", pady=(0, 6))
        tk.Label(info_frame, text="Slack: shawnw", font=("Segoe UI", 11),
                 bg="#2B2B2B", fg="#CCCCCC", anchor="w").grid(row=2, column=0, sticky="w", pady=(0, 6))
        tk.Button(info_frame, text="Copy",
                  command=lambda: _copy_text("shawnw", "Slack"), width=8
                  ).grid(row=2, column=1, sticky="e", pady=(0, 6))

        status_var = tk.StringVar(value="")
        tk.Label(report_win, textvariable=status_var, font=("Segoe UI", 9),
                 bg="#2B2B2B", fg="#AAAAAA").pack(pady=(6, 10))
        tk.Button(report_win, text="CLOSE", command=report_win.destroy,
                  font=("Segoe UI", 10, "bold"), bg="#444444", fg="white",
                  activebackground="#555555", activeforeground="white",
                  relief="flat", width=15, pady=8).pack(pady=10)

    # ── Menu bar ─────────────────────────────────────────────────

    menubar = tk.Menu(root)

    file_menu = tk.Menu(menubar, tearoff=0)
    file_menu.add_command(label="Set API Key\u2026", command=_set_api_key)
    file_menu.add_separator()
    file_menu.add_command(label="New", command=_new_session)
    file_menu.add_command(label="Open", command=_open_session)
    open_recent_menu = tk.Menu(file_menu, tearoff=0)
    file_menu.add_cascade(label="Open Recent", menu=open_recent_menu)
    file_menu.add_command(label="Save Session", command=_save_session)
    file_menu.add_separator()
    file_menu.add_command(label="Exit", command=root.destroy)
    menubar.add_cascade(label="File", menu=file_menu)

    # ── Image Model selector menu ─────────────────────────────
    model_var = tk.StringVar(value=selected_image_model)
    model_menu = tk.Menu(menubar, tearoff=0)

    def _on_model_select():
        new_model = model_var.get()
        nonlocal selected_image_model
        selected_image_model = new_model
        _save_image_model(new_model)
        info = get_image_model_info(new_model)
        _update_model_menu_label(info)

    _model_menu_index = [None]  # mutable container for the menubar index

    def _update_model_menu_label(info=None):
        if info is None:
            info = get_image_model_info(selected_image_model)
        idx = _model_menu_index[0]
        if idx is not None:
            try:
                menubar.entryconfigure(idx, label=f"Image Model: {info['label']}")
            except Exception:
                pass

    multimodal_models = [m for m in IMAGE_MODELS if m["multimodal"]]
    imagen_models = [m for m in IMAGE_MODELS if not m["multimodal"]]

    model_menu.add_command(
        label="── Multimodal (Image+Text \u2192 Image) ──",
        state="disabled",
    )
    for m in multimodal_models:
        model_menu.add_radiobutton(
            label=f"{m['label']}  |  {m['resolution']}  |  {m['time_estimate']}  |  {m['description']}",
            variable=model_var,
            value=m["id"],
            command=_on_model_select,
        )

    model_menu.add_separator()
    model_menu.add_command(
        label="── Text-to-Image Only ──",
        state="disabled",
    )
    for m in imagen_models:
        model_menu.add_radiobutton(
            label=f"{m['label']}  |  {m['resolution']}  |  {m['time_estimate']}  |  {m['description']}",
            variable=model_var,
            value=m["id"],
            command=_on_model_select,
        )

    menubar.add_command(label="How to Use", command=_show_how_to_use)
    menubar.add_command(label="About", command=_show_about)
    menubar.add_command(label="Report Bug", command=_report_bug)

    init_info = get_image_model_info(selected_image_model)
    menubar.add_cascade(label=f"Image Model: {init_info['label']}", menu=model_menu)
    _model_menu_index[0] = menubar.index("end")

    root.config(menu=menubar)
    _refresh_recent_menu()

    # ── Notebook tabs ────────────────────────────────────────────

    notebook = ttk.Notebook(root)
    notebook.pack(fill="both", expand=True)

    tab_gemini = tk.Frame(notebook, bg="#4F4F4F")
    tab_multiview = tk.Frame(notebook, bg="#4F4F4F")
    tab_character = tk.Frame(notebook, bg="#4F4F4F")
    tab_weapon = tk.Frame(notebook, bg="#4F4F4F")
    tab_3d = tk.Frame(notebook, bg="#4F4F4F")

    style = ttk.Style(root)
    style.map("TNotebook.Tab",
              foreground=[("disabled", "#666666")],
              background=[("disabled", "#5A5A5A")])

    notebook.add(tab_gemini, text="Gemini")
    notebook.add(tab_multiview, text="Multiview")
    notebook.add(tab_character, text="Character Generator")
    notebook.add(tab_weapon, text="Weapon Generator")
    notebook.add(tab_3d, text="3D GEN AI (Coming Soon)")
    notebook.tab(tab_3d, state="disabled", padding=(10, 4))

    def _safe_init(tab, label, init_func):
        try:
            _log_startup(f"Initializing {label}...")
            try:
                for child in tab.winfo_children():
                    child.destroy()
            except Exception:
                pass
            init_func()
            _log_startup(f"{label} initialized.")
        except Exception as e:
            _log_startup(f"{label} failed: {e}")
            _log_startup(traceback.format_exc())
            try:
                tk.Label(tab, text=f"{label} failed to load.\nSee output\\logs\\startup.log",
                         fg="#CCCCCC", bg="#4F4F4F", font=("Segoe UI", 12)).pack(expand=True)
            except Exception:
                pass

    def _loading_label(tab, text):
        try:
            tk.Label(tab, text=text, fg="#CCCCCC", bg="#4F4F4F",
                     font=("Segoe UI", 12)).pack(expand=True)
        except Exception:
            pass

    _loading_label(tab_gemini, "Loading Gemini...")
    _loading_label(tab_multiview, "Loading Multiview...")
    _loading_label(tab_character, "Loading Character Generator...")
    _loading_label(tab_weapon, "Loading Weapon Generator...")

    init_states = {tab_gemini: False, tab_multiview: False, tab_character: False, tab_weapon: False}
    init_map = {
        tab_gemini: ("Gemini", lambda: _init_gemini(tab_gemini, api_key)),
        tab_multiview: ("Multiview", lambda: _init_multiview(tab_multiview, api_key)),
        tab_character: ("Character Generator", lambda: _init_character(tab_character)),
        tab_weapon: ("Weapon Generator", lambda: _init_weapon(tab_weapon)),
    }

    def _init_tab(tab):
        if init_states.get(tab):
            return
        label, init_func = init_map[tab]
        init_states[tab] = True
        root.after(50, lambda: _safe_init(tab, label, init_func))

    def _on_tab_changed(event):
        try:
            selected = event.widget.nametowidget(event.widget.select())
        except Exception:
            return
        if selected in init_map:
            _init_tab(selected)

    notebook.bind("<<NotebookTabChanged>>", _on_tab_changed)
    root.after(100, lambda: _init_tab(tab_gemini))

    try:
        if _should_show_how_to_use():
            root.after(300, _show_how_to_use)
    except Exception:
        pass

    placeholder = tk.Label(tab_3d, text="3D GEN AI - Coming Soon",
                           fg="#888888", bg="#4F4F4F", font=("Segoe UI", 14, "bold"))
    placeholder.pack(expand=True)

    # ── Window close ─────────────────────────────────────────────

    closing_flag = {"done": False}

    def _safe_close():
        if closing_flag["done"]:
            return
        closing_flag["done"] = True
        try:
            root.quit()
        except Exception:
            pass
        try:
            root.destroy()
        except Exception:
            pass
        os._exit(0)

    try:
        root.protocol("WM_DELETE_WINDOW", _safe_close)
    except Exception:
        pass

    try:
        if splash:
            splash.destroy()
    except Exception:
        pass
    try:
        root.deiconify()
        root.lift()
        try:
            root.attributes("-topmost", True)
            root.after(250, lambda: root.attributes("-topmost", False))
        except Exception:
            pass
        try:
            root.state("zoomed")
        except Exception:
            root.geometry("1600x950")
    except Exception as e:
        _log_startup(f"Deiconify failed: {e}")

    root.mainloop()


if __name__ == "__main__":
    main()
