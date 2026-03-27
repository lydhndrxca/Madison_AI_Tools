"""
Dark Theme Configuration – Photoshop-style
Shared across all suite tools.
"""
import tkinter as tk
from tkinter import ttk


class DarkTheme:
    WINDOW_BG = "#4F4F4F"
    IMAGE_BG = "#343434"
    TEXT_FG = "#E0E0E0"

    BUTTON_BG = "#3A3A3A"
    BUTTON_HOVER = "#5A5A5A"
    BUTTON_ACTIVE = "#6A6A6A"
    BUTTON_FG = "#E0E0E0"

    INPUT_BG = "#3C3C3C"
    INPUT_FG = "#E0E0E0"
    INPUT_SELECT_BG = "#5A5A5A"

    FRAME_BG = "#4F4F4F"
    LABELFRAME_BG = "#4F4F4F"
    CANVAS_BG = "#343434"

    BORDER = "#3A3A3A"
    HIGHLIGHT = "#6A6A6A"
    SELECTION = "#5A5A5A"
    SUBTEXT_FG = "#C0C0C0"

    SUCCESS = "#4A7C4A"
    WARNING = "#B8860B"
    ERROR = "#8B3A3A"

    FONT_FAMILY = "Segoe UI"
    FONT_SIZE = 10


def apply_dark_theme(root, style=None):
    if style is None:
        style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    root.configure(bg=DarkTheme.WINDOW_BG)

    style.configure("TFrame", background=DarkTheme.FRAME_BG)
    style.configure("TLabelframe",
                     background=DarkTheme.LABELFRAME_BG,
                     foreground=DarkTheme.TEXT_FG,
                     bordercolor=DarkTheme.BORDER, borderwidth=1, relief="flat")
    style.configure("TLabelframe.Label",
                     background=DarkTheme.LABELFRAME_BG,
                     foreground=DarkTheme.TEXT_FG,
                     font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE, "bold"))
    style.configure("TLabel",
                     background=DarkTheme.FRAME_BG,
                     foreground=DarkTheme.TEXT_FG,
                     font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))
    style.configure("TButton",
                     background=DarkTheme.BUTTON_BG,
                     foreground=DarkTheme.BUTTON_FG,
                     bordercolor=DarkTheme.BORDER, borderwidth=1, relief="flat",
                     font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))
    style.map("TButton",
              background=[("active", DarkTheme.BUTTON_ACTIVE),
                          ("pressed", DarkTheme.BUTTON_ACTIVE),
                          ("hover", DarkTheme.BUTTON_HOVER)],
              foreground=[("active", DarkTheme.BUTTON_FG),
                          ("pressed", DarkTheme.BUTTON_FG)])
    style.configure("TEntry",
                     fieldbackground=DarkTheme.INPUT_BG,
                     background=DarkTheme.INPUT_BG,
                     foreground=DarkTheme.INPUT_FG,
                     bordercolor=DarkTheme.BORDER,
                     insertcolor=DarkTheme.INPUT_FG,
                     selectbackground=DarkTheme.INPUT_SELECT_BG,
                     selectforeground=DarkTheme.INPUT_FG)
    style.configure("TCombobox",
                     fieldbackground=DarkTheme.INPUT_BG,
                     background=DarkTheme.INPUT_BG,
                     foreground=DarkTheme.INPUT_FG,
                     bordercolor=DarkTheme.BORDER,
                     arrowcolor=DarkTheme.TEXT_FG,
                     selectbackground=DarkTheme.INPUT_SELECT_BG,
                     selectforeground=DarkTheme.INPUT_FG,
                     insertcolor=DarkTheme.INPUT_FG)
    style.map("TCombobox",
              fieldbackground=[("readonly", DarkTheme.INPUT_BG)],
              selectbackground=[("readonly", DarkTheme.INPUT_SELECT_BG)])
    root.option_add("*TCombobox*Listbox*Background", DarkTheme.INPUT_BG)
    root.option_add("*TCombobox*Listbox*Foreground", DarkTheme.INPUT_FG)
    root.option_add("*TCombobox*Listbox*selectBackground", DarkTheme.INPUT_SELECT_BG)
    root.option_add("*TCombobox*Listbox*selectForeground", DarkTheme.INPUT_FG)
    style.configure("TCheckbutton",
                     background=DarkTheme.FRAME_BG,
                     foreground=DarkTheme.TEXT_FG,
                     bordercolor=DarkTheme.BORDER,
                     font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))
    style.map("TCheckbutton", background=[("active", DarkTheme.FRAME_BG)])
    style.configure("TRadiobutton",
                     background=DarkTheme.FRAME_BG,
                     foreground=DarkTheme.TEXT_FG,
                     bordercolor=DarkTheme.BORDER,
                     font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))
    style.map("TRadiobutton", background=[("active", DarkTheme.FRAME_BG)])
    style.configure("TScrollbar",
                     background=DarkTheme.BUTTON_BG,
                     troughcolor=DarkTheme.FRAME_BG,
                     bordercolor=DarkTheme.BORDER,
                     arrowcolor=DarkTheme.TEXT_FG)
    style.map("TScrollbar", background=[("active", DarkTheme.BUTTON_HOVER)])
    style.configure("TNotebook",
                     background=DarkTheme.FRAME_BG,
                     bordercolor=DarkTheme.BORDER,
                     tabmargins=[2, 5, 2, 0])
    style.configure("TNotebook.Tab",
                     background=DarkTheme.BUTTON_BG,
                     foreground=DarkTheme.TEXT_FG,
                     bordercolor=DarkTheme.BORDER,
                     padding=[10, 2],
                     font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))
    style.map("TNotebook.Tab",
              background=[("selected", DarkTheme.BUTTON_HOVER),
                          ("active", DarkTheme.BUTTON_HOVER)],
              foreground=[("selected", DarkTheme.INPUT_FG),
                          ("active", DarkTheme.INPUT_FG)])

    for opt, val in [
        ("*Foreground", DarkTheme.TEXT_FG),
        ("*Background", DarkTheme.FRAME_BG),
        ("*Label*Foreground", DarkTheme.TEXT_FG),
        ("*Label*Background", DarkTheme.FRAME_BG),
        ("*Button*Foreground", DarkTheme.BUTTON_FG),
        ("*Button*Background", DarkTheme.BUTTON_BG),
        ("*Button*activeBackground", DarkTheme.BUTTON_ACTIVE),
        ("*Button*activeForeground", DarkTheme.BUTTON_FG),
        ("*Button*borderWidth", 1),
        ("*Button*relief", "flat"),
        ("*Entry*Foreground", DarkTheme.INPUT_FG),
        ("*Entry*Background", DarkTheme.INPUT_BG),
        ("*Entry*insertBackground", DarkTheme.INPUT_FG),
        ("*Entry*selectBackground", DarkTheme.INPUT_SELECT_BG),
        ("*Entry*selectForeground", DarkTheme.INPUT_FG),
        ("*Entry*borderWidth", 1),
        ("*Entry*relief", "flat"),
        ("*Text*Background", DarkTheme.INPUT_BG),
        ("*Text*Foreground", DarkTheme.INPUT_FG),
        ("*Text*insertBackground", DarkTheme.INPUT_FG),
        ("*Text*selectBackground", DarkTheme.INPUT_SELECT_BG),
        ("*Text*selectForeground", DarkTheme.INPUT_FG),
        ("*Text*borderWidth", 1),
        ("*Text*relief", "flat"),
        ("*Listbox*Background", DarkTheme.INPUT_BG),
        ("*Listbox*Foreground", DarkTheme.INPUT_FG),
        ("*Listbox*selectBackground", DarkTheme.INPUT_SELECT_BG),
        ("*Listbox*selectForeground", DarkTheme.INPUT_FG),
        ("*Listbox*borderWidth", 1),
        ("*Listbox*relief", "flat"),
        ("*Menu*Background", DarkTheme.BUTTON_BG),
        ("*Menu*Foreground", DarkTheme.TEXT_FG),
        ("*Menu*activeBackground", DarkTheme.BUTTON_HOVER),
        ("*Menu*activeForeground", DarkTheme.INPUT_FG),
        ("*Tooltip*Background", DarkTheme.BUTTON_BG),
        ("*Tooltip*Foreground", DarkTheme.TEXT_FG),
    ]:
        root.option_add(opt, val)

    return style


def configure_text_widget(text_widget):
    text_widget.config(
        bg=DarkTheme.INPUT_BG, fg=DarkTheme.INPUT_FG,
        insertbackground=DarkTheme.INPUT_FG,
        selectbackground=DarkTheme.INPUT_SELECT_BG,
        selectforeground=DarkTheme.INPUT_FG,
        borderwidth=1, relief="flat",
        font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))


def configure_canvas_widget(canvas_widget):
    canvas_widget.config(bg=DarkTheme.IMAGE_BG, highlightthickness=0, borderwidth=0)


def configure_label_widget(label_widget):
    label_widget.config(
        bg=DarkTheme.FRAME_BG, fg=DarkTheme.TEXT_FG,
        font=(DarkTheme.FONT_FAMILY, DarkTheme.FONT_SIZE))


def add_hover_effect(button_widget):
    def on_enter(e):
        button_widget["background"] = DarkTheme.BUTTON_HOVER
    def on_leave(e):
        button_widget["background"] = DarkTheme.BUTTON_BG
    button_widget.bind("<Enter>", on_enter)
    button_widget.bind("<Leave>", on_leave)


def update_tooltip_colors():
    return {"background": DarkTheme.BUTTON_BG, "foreground": DarkTheme.TEXT_FG}


def setup_dark_theme(root):
    return apply_dark_theme(root)
