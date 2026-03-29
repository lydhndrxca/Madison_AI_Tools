"""Color Palette Extraction – k-means dominant color analysis."""
from __future__ import annotations

import base64
import io

import numpy as np
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

router = APIRouter()


class ExtractRequest(BaseModel):
    image_b64: str
    num_colors: int = Field(default=6, ge=1, le=20)


class ColorSwatch(BaseModel):
    hex: str
    rgb: list[int]
    percentage: float


def _kmeans(pixels: np.ndarray, k: int, max_iter: int = 20) -> tuple[np.ndarray, np.ndarray]:
    """Minimal k-means without sklearn dependency."""
    rng = np.random.default_rng(42)
    idx = rng.choice(len(pixels), size=k, replace=False)
    centers = pixels[idx].astype(np.float64)
    labels = np.zeros(len(pixels), dtype=np.int32)

    for _ in range(max_iter):
        dists = np.linalg.norm(pixels[:, None] - centers[None, :], axis=2)
        new_labels = np.argmin(dists, axis=1).astype(np.int32)
        if np.array_equal(labels, new_labels):
            break
        labels = new_labels
        for j in range(k):
            mask = labels == j
            if mask.any():
                centers[j] = pixels[mask].mean(axis=0)

    return centers, labels


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02X}{g:02X}{b:02X}"


@router.post("/extract")
def extract_palette(body: ExtractRequest) -> list[dict]:
    raw = body.image_b64
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        img_data = base64.b64decode(raw)
        img = Image.open(io.BytesIO(img_data)).convert("RGB")
    except Exception as exc:
        raise HTTPException(400, f"Invalid image data: {exc}")

    # Downsample for speed
    img.thumbnail((100, 100))
    pixels = np.array(img).reshape(-1, 3).astype(np.float64)

    k = min(body.num_colors, len(pixels))
    if k < 1:
        return []

    centers, labels = _kmeans(pixels, k)
    total = len(labels)
    swatches: list[dict] = []
    for j in range(k):
        count = int((labels == j).sum())
        r, g, b = int(round(centers[j][0])), int(round(centers[j][1])), int(round(centers[j][2]))
        swatches.append({
            "hex": _rgb_to_hex(r, g, b),
            "rgb": [r, g, b],
            "percentage": round(count / total * 100, 1),
        })
    swatches.sort(key=lambda s: s["percentage"], reverse=True)
    return swatches
