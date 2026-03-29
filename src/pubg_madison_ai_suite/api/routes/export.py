"""Export endpoints – consistency sheet compositing and ZIP handoff package."""
from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel

router = APIRouter()


def _safe_filename(name: str) -> str:
    """Sanitize a label for use inside a ZIP archive path."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    cleaned = cleaned.strip('. ')
    return cleaned or "unnamed"


class ImageItem(BaseModel):
    label: str
    image_b64: str


class ConsistencySheetRequest(BaseModel):
    images: list[ImageItem]
    layout: str = "1x4"  # "1x4" | "2x2" | "1x5"
    title: str = ""
    background_color: str = "#2a2a2a"
    include_labels: bool = True


class ExportPackageRequest(BaseModel):
    images: list[ImageItem]
    xml_data: str = ""
    prompt_text: str = ""
    settings: dict = {}
    palette: list[dict] = []  # [{"hex": "#ABC123"}, ...]
    include_ref_sheet: bool = True
    tool_name: str = "character"
    character_name: str = "export"
    ref_sheet_layout: str = "1x4"


def _b64_to_image(data: str) -> Image.Image:
    raw = data
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGBA")
    except Exception as exc:
        raise HTTPException(400, f"Invalid image data: {exc}")


def _image_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _compose_sheet(
    images: list[tuple[str, Image.Image]],
    layout: str,
    title: str,
    bg_color: str,
    include_labels: bool,
) -> Image.Image:
    """Composite images into a reference sheet."""
    if not images:
        return Image.new("RGBA", (512, 512), bg_color)

    pad = 20
    label_h = 24 if include_labels else 0
    title_h = 40 if title else 0

    # Determine grid
    n = len(images)
    if layout == "2x2":
        cols, rows = 2, (n + 1) // 2
    elif layout == "1x5":
        cols, rows = min(5, n), 1
    else:  # "1x4"
        cols, rows = min(4, n), (n + 3) // 4

    # Uniform cell size based on largest image
    max_w = max(img.width for _, img in images)
    max_h = max(img.height for _, img in images)
    cell_w = max_w + pad
    cell_h = max_h + pad + label_h

    sheet_w = cols * cell_w + pad
    sheet_h = rows * cell_h + pad + title_h

    sheet = Image.new("RGBA", (sheet_w, sheet_h), bg_color)
    draw = ImageDraw.Draw(sheet)

    try:
        font = ImageFont.truetype("arial.ttf", 14)
        title_font = ImageFont.truetype("arial.ttf", 20)
    except OSError:
        font = ImageFont.load_default()
        title_font = font

    if title:
        draw.text((sheet_w // 2, pad), title, fill="white", anchor="mt", font=title_font)

    for i, (label, img) in enumerate(images):
        row = i // cols
        col = i % cols
        x = pad // 2 + col * cell_w + (cell_w - img.width) // 2
        y = title_h + pad // 2 + row * cell_h + (cell_h - label_h - img.height) // 2
        sheet.paste(img, (x, y), img if img.mode == "RGBA" else None)
        if include_labels and label:
            lx = pad // 2 + col * cell_w + cell_w // 2
            ly = title_h + pad // 2 + (row + 1) * cell_h - label_h + 4
            draw.text((lx, ly), label, fill="white", anchor="mt", font=font)

    return sheet


def _create_palette_swatch(palette: list[dict], width: int = 400, height: int = 60) -> Image.Image:
    """Create a PNG swatch strip from a palette list."""
    n = len(palette)
    if n == 0:
        return Image.new("RGB", (width, height), "#333")
    sw = width // n
    img = Image.new("RGB", (width, height), "#333")
    draw = ImageDraw.Draw(img)
    for i, p in enumerate(palette):
        x = i * sw
        draw.rectangle([x, 0, x + sw, height], fill=p.get("hex", "#333"))
        try:
            font = ImageFont.truetype("arial.ttf", 10)
        except OSError:
            font = ImageFont.load_default()
        draw.text((x + sw // 2, height - 12), p.get("hex", ""), fill="white", anchor="mt", font=font)
    return img


@router.post("/consistency-sheet")
def create_consistency_sheet(body: ConsistencySheetRequest) -> dict:
    images = [(item.label, _b64_to_image(item.image_b64)) for item in body.images]
    sheet = _compose_sheet(images, body.layout, body.title, body.background_color, body.include_labels)
    return {"image_b64": _image_to_b64(sheet), "width": sheet.width, "height": sheet.height}


@router.post("/package")
def create_package(body: ExportPackageRequest):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Images
        pil_images: list[tuple[str, Image.Image]] = []
        for item in body.images:
            img = _b64_to_image(item.image_b64)
            pil_images.append((item.label, img))
            img_buf = io.BytesIO()
            img.save(img_buf, "PNG")
            zf.writestr(f"images/{_safe_filename(item.label)}.png", img_buf.getvalue())

        # Ref sheet
        if body.include_ref_sheet and pil_images:
            sheet = _compose_sheet(pil_images, body.ref_sheet_layout, body.character_name, "#2a2a2a", True)
            sheet_buf = io.BytesIO()
            sheet.save(sheet_buf, "PNG")
            zf.writestr("ref_sheet.png", sheet_buf.getvalue())

        # XML
        if body.xml_data:
            zf.writestr("data.xml", body.xml_data)

        # Prompt
        if body.prompt_text:
            zf.writestr("prompt.txt", body.prompt_text)

        # Settings
        if body.settings:
            zf.writestr("settings.json", json.dumps(body.settings, indent=2))

        # Palette
        if body.palette:
            swatch = _create_palette_swatch(body.palette)
            swatch_buf = io.BytesIO()
            swatch.save(swatch_buf, "PNG")
            zf.writestr("palette.png", swatch_buf.getvalue())
            zf.writestr("palette.json", json.dumps(body.palette, indent=2))

        # README
        readme = (
            f"# {body.character_name} — Export Package\n\n"
            f"Tool: {body.tool_name}\n"
            f"Exported: {datetime.now().isoformat()}\n"
            f"Images: {len(body.images)}\n"
        )
        if body.palette:
            readme += f"Palette: {', '.join(p.get('hex', '') for p in body.palette)}\n"
        zf.writestr("README.txt", readme)

    buf.seek(0)
    safe_name = _safe_filename(body.character_name)
    safe_tool = _safe_filename(body.tool_name)
    filename = f"{safe_name}_{safe_tool}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
