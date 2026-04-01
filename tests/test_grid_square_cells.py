"""Tests for the grid cell pipeline: detection, bg removal, and square output.

Part A: Direct _make_square_cell tests with various aspect ratios.
Part B: Synthetic grid images through full pipeline.
"""
from __future__ import annotations
import sys, os, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
from PIL import Image, ImageDraw

from pubg_madison_ai_suite.api.routes.uilab import (
    _detect_cells_by_projection,
    _remove_bg_adaptive,
    _make_square_cell,
)

SAVE_DIR = os.path.join(ROOT, "tests", "_grid_test_output")
os.makedirs(SAVE_DIR, exist_ok=True)

PASS = 0
FAIL = 0


def ok(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS: {msg}")
    else:
        FAIL += 1
        print(f"  FAIL: {msg}")


# =====================================================================
# PART A: Direct _make_square_cell tests
# =====================================================================

def test_make_square_cell():
    print("\n" + "=" * 60)
    print("PART A: _make_square_cell with various aspect ratios")
    print("=" * 60)

    cases = [
        ("square_100x100",   100, 100),
        ("wide_300x60",      300,  60),
        ("wide_200x80",      200,  80),
        ("tall_60x300",       60, 300),
        ("tall_80x200",       80, 200),
        ("tiny_20x20",        20,  20),
        ("large_500x500",    500, 500),
        ("extreme_wide_400x30", 400, 30),
        ("extreme_tall_30x400",  30, 400),
        ("odd_137x89",       137,  89),
    ]

    for name, w, h in cases:
        # Create an icon with content on transparent bg
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        mx, my = max(2, w // 10), max(2, h // 10)
        draw.rounded_rectangle([mx, my, w - mx, h - my], radius=min(w, h) // 6,
                               fill=(200, 60, 60, 255), outline=(0, 0, 0, 255), width=2)

        result = _make_square_cell(img, output_size=256)
        rw, rh = result.size
        ok(rw == 256 and rh == 256, f"{name}: output is {rw}x{rh} (want 256x256)")
        ok(result.mode == "RGBA", f"{name}: mode is {result.mode}")
        ok(result.getbbox() is not None, f"{name}: has content")

        # Check corners are transparent
        arr = np.array(result)
        corners_alpha = [arr[0, 0, 3], arr[0, -1, 3], arr[-1, 0, 3], arr[-1, -1, 3]]
        ok(all(a == 0 for a in corners_alpha), f"{name}: corners are transparent (alphas={corners_alpha})")

        result.save(os.path.join(SAVE_DIR, f"A_{name}.png"))

    # Edge case: empty image
    empty = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    result = _make_square_cell(empty, output_size=256)
    ok(result.size == (256, 256), f"empty_input: output is {result.size}")
    ok(result.getbbox() is None, f"empty_input: correctly empty")


# =====================================================================
# PART B: Synthetic grid images through full pipeline
# =====================================================================

def _make_icon(w, h, seed):
    rng = random.Random(seed)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = (rng.randint(40, 220), rng.randint(40, 220), rng.randint(40, 220), 255)
    shape = rng.choice(["circle", "rect", "rrect"])
    mx, my = max(3, w // 12), max(3, h // 12)
    if shape == "circle":
        draw.ellipse([mx, my, w - mx, h - my], fill=color, outline=(0, 0, 0, 255), width=2)
    elif shape == "rect":
        draw.rectangle([mx, my, w - mx, h - my], fill=color, outline=(0, 0, 0, 255), width=2)
    else:
        draw.rounded_rectangle([mx, my, w - mx, h - my], radius=min(w, h) // 5,
                               fill=color, outline=(0, 0, 0, 255), width=2)
    return img


def make_grid(bg, cols, rows, cw, ch, sep, noise=0, fill_pct=0.90):
    """Synth grid where icons fill fill_pct of the cell (realistic Gemini output)."""
    canvas_w = cols * cw + (cols + 1) * sep
    canvas_h = rows * ch + (rows + 1) * sep
    img = Image.new("RGB", (canvas_w, canvas_h), bg)
    if noise > 0:
        arr = np.array(img, dtype=np.int16)
        n = np.random.randint(-noise, noise + 1, arr.shape, dtype=np.int16)
        arr = np.clip(arr + n, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr, "RGB")
    seed = 100
    for r in range(rows):
        for c in range(cols):
            rng = random.Random(seed)
            lo = max(0.80, fill_pct - 0.10)
            iw = max(20, int(cw * rng.uniform(lo, 1.0)))
            ih = max(20, int(ch * rng.uniform(lo, 1.0)))
            icon = _make_icon(iw, ih, seed)
            x = sep + c * (cw + sep) + (cw - iw) // 2
            y = sep + r * (ch + sep) + (ch - ih) // 2
            img.paste(icon, (x, y), icon)
            seed += 1
    return img


GRID_SCENARIOS = [
    # name,                  bg,              cols, rows, cw,  ch,  sep, noise
    ("green_4x4_square",     (0, 255, 0),       4,    4, 128, 128,  15,   0),
    ("green_5x5_wide",       (0, 255, 0),       5,    5, 180,  70,  16,   0),
    ("green_4x5_horiz",      (0, 255, 0),       4,    5, 200,  80,  14,   0),
    ("green_5x4_vert",       (0, 255, 0),       5,    4,  80, 180,  14,   0),
    ("muted_green_4x4",      (60, 180, 50),     4,    4, 140, 140,  12,   8),
    ("dark_green_6x3",       (30, 140, 20),     6,    3, 160,  60,  18,   0),
    ("lime_3x3",             (100, 230, 30),    3,    3, 180, 180,  20,   0),
    ("noisy_green_4x4",      (0, 255, 0),       4,    4, 150, 150,  14,  12),
    ("dark_bg_5x5",          (40, 100, 30),     5,    5, 110, 110,  12,   8),
    ("bright_green_5x5_tall",(0, 255, 0),       5,    5,  70, 160,  14,   0),
]


def test_grid_pipeline():
    print("\n" + "=" * 60)
    print("PART B: Full pipeline (detect -> bg remove -> square)")
    print("=" * 60)

    for name, bg, cols, rows, cw, ch, sep, noise in GRID_SCENARIOS:
        print(f"\n--- {name}: BG={bg} {cols}x{rows} cell={cw}x{ch} sep={sep} ---")
        grid_img = make_grid(bg, cols, rows, cw, ch, sep, noise)
        print(f"  Image: {grid_img.width}x{grid_img.height}")
        grid_img.save(os.path.join(SAVE_DIR, f"B_{name}_input.png"))

        cells, dc, dr, bgc = _detect_cells_by_projection(grid_img)
        print(f"  Detected: {dc}x{dr} ({len(cells)} cells), bg={bgc}")

        ok(dc == cols, f"{name}: cols {dc} == {cols}")
        ok(dr == rows, f"{name}: rows {dr} == {rows}")

        if not cells:
            ok(False, f"{name}: no cells detected")
            continue

        sq = 256
        all_square = True
        all_content = True
        for idx, cell in enumerate(cells):
            cell = _remove_bg_adaptive(cell, bgc)
            cell = _make_square_cell(cell, output_size=sq)
            if cell.size != (sq, sq):
                all_square = False
            if cell.getbbox() is None:
                all_content = False
            if idx < 4:
                cell.save(os.path.join(SAVE_DIR, f"B_{name}_cell{idx}.png"))

        ok(all_square, f"{name}: all {len(cells)} cells are {sq}x{sq}")
        ok(all_content, f"{name}: all cells have content")
        ok(len(cells) == cols * rows, f"{name}: cell count {len(cells)} == {cols * rows}")


# =====================================================================
# Run
# =====================================================================

if __name__ == "__main__":
    test_make_square_cell()
    test_grid_pipeline()
    print(f"\n{'=' * 60}")
    print(f"RESULTS: {PASS} passed, {FAIL} failed")
    print(f"Output: {SAVE_DIR}")
    print(f"{'=' * 60}")
    sys.exit(0 if FAIL == 0 else 1)
