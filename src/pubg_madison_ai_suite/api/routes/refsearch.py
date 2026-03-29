"""Deep Reference Search — uses Gemini + Google Search grounding to find
reference images for concept art workflows.

Endpoints:
  POST /search — Run a grounded search query, find images, validate them
"""

from __future__ import annotations

import base64
import io
import json
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from pubg_madison_ai_suite.api import core

router = APIRouter()

_EXECUTOR = ThreadPoolExecutor(max_workers=12)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class SearchRequest(BaseModel):
    query: str
    image_b64: Optional[str] = None
    num_images: int = Field(default=12, ge=1, le=40)
    depth: str = Field(default="medium")  # quick / medium / deep


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "image/*,*/*;q=0.8",
}


def _download_image(url: str, timeout: int = 15) -> dict | None:
    """Download an image URL and return {url, b64, width, height} or None."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=timeout, stream=True)
        if resp.status_code != 200:
            return None
        ct = resp.headers.get("content-type", "")
        if not ct.startswith("image/"):
            return None
        data = resp.content
        if len(data) < 2000:
            return None
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        if img.width < 80 or img.height < 80:
            return None
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        MAX_DIM = 1024
        if img.width > MAX_DIM or img.height > MAX_DIM:
            img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return {
            "url": url,
            "b64": b64,
            "width": img.width,
            "height": img.height,
        }
    except Exception:
        return None


def _extract_image_urls_from_text(text: str) -> list[str]:
    """Pull any direct image URLs from Gemini's response text."""
    url_pattern = r'https?://[^\s\"\'\)>\]]+\.(?:jpg|jpeg|png|webp|gif|bmp)(?:[^\s\"\'\)>\]]*)?'
    urls = re.findall(url_pattern, text, re.IGNORECASE)
    return list(dict.fromkeys(urls))


def _grounded_search(api_key: str, model: str, query: str, image_b64: str | None,
                     num_images: int, depth: str) -> dict:
    """Use Gemini with google_search tool to find reference images."""
    depth_instruction = {
        "quick": "Do a quick search. Find direct image URLs for 5-10 reference images.",
        "medium": "Do a thorough search across multiple queries. Find direct image URLs for 10-20 reference images.",
        "deep": "Do an extensive, multi-query deep search. Find direct image URLs for 20-40 reference images. Try many search angles and variations.",
    }

    system_prompt = (
        "You are a visual reference researcher for concept artists and designers. "
        "Your job is to find high-quality reference images from the web.\n\n"
        "CRITICAL INSTRUCTIONS:\n"
        "1. Use Google Search to find relevant reference images\n"
        "2. For each image found, provide its DIRECT image URL (ending in .jpg, .png, .webp, etc.)\n"
        "3. Along with each URL, give a short description of what the image shows\n"
        "4. Focus on high-quality, relevant images that match the query\n"
        "5. Avoid stock photo watermarked images when possible\n"
        "6. Look for images from art reference sites, Pinterest, ArtStation, DeviantArt, "
        "museum archives, design blogs, etc.\n\n"
        f"{depth_instruction.get(depth, depth_instruction['medium'])}\n\n"
        f"Target: Find at least {num_images} relevant reference images.\n\n"
        "FORMAT YOUR RESPONSE as a JSON array of objects:\n"
        '[{"url": "https://example.com/image.jpg", "description": "Brief description", "relevance": "Why this matches"}]\n\n'
        "Return ONLY the JSON array, no other text."
    )

    parts: list[dict] = []
    if image_b64:
        parts.append({"inlineData": {"mimeType": "image/png", "data": image_b64[:10_000_000]}})
        parts.append({"text": f"Find reference images similar to this uploaded image. Additional context: {query}"})
    else:
        parts.append({"text": query})

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    body: dict[str, Any] = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": parts}],
        "tools": [{"google_search": {}}],
    }

    resp = requests.post(url, json=body, headers=headers, timeout=120)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API returned {resp.status_code}: {resp.text[:300]}")

    data = resp.json()

    response_text = ""
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "text" in part:
                response_text += part["text"]

    grounding_meta = {}
    for cand in data.get("candidates", []):
        if "groundingMetadata" in cand:
            grounding_meta = cand["groundingMetadata"]
            break

    source_urls = []
    for chunk in grounding_meta.get("groundingChunks", []):
        web = chunk.get("web", {})
        if web.get("uri"):
            source_urls.append({"url": web["uri"], "title": web.get("title", "")})

    return {
        "text": response_text,
        "sources": source_urls,
        "grounding": grounding_meta,
    }


def _scrape_images_from_page(page_url: str, query: str, max_imgs: int = 5) -> list[str]:
    """Fetch a web page and extract image URLs from it."""
    try:
        resp = requests.get(page_url, headers={
            **_HEADERS,
            "Accept": "text/html,application/xhtml+xml,*/*",
        }, timeout=10)
        if resp.status_code != 200:
            return []
        html = resp.text[:500_000]
        img_pattern = r'(?:src|href|data-src|data-original|content)=["\']([^"\']*\.(?:jpg|jpeg|png|webp|gif)[^"\']*)["\']'
        raw_urls = re.findall(img_pattern, html, re.IGNORECASE)

        full_urls = []
        for u in raw_urls:
            if u.startswith("//"):
                u = "https:" + u
            elif u.startswith("/"):
                parsed = urllib.parse.urlparse(page_url)
                u = f"{parsed.scheme}://{parsed.netloc}{u}"
            elif not u.startswith("http"):
                continue
            if "logo" in u.lower() or "icon" in u.lower() or "favicon" in u.lower():
                continue
            if "1x1" in u or "pixel" in u.lower() or "tracking" in u.lower():
                continue
            full_urls.append(u)

        return list(dict.fromkeys(full_urls))[:max_imgs]
    except Exception:
        return []


def _stream_search(api_key: str, query: str, image_b64: str | None,
                   num_images: int, depth: str):
    """Generator that yields SSE events as the search progresses."""
    model = "gemini-2.0-flash"

    yield f"data: {json.dumps({'status': 'Searching the web for references...'})}\n\n"

    try:
        result = _grounded_search(api_key, model, query, image_b64, num_images, depth)
    except Exception as exc:
        yield f"data: {json.dumps({'error': str(exc)[:500]})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
        return

    yield f"data: {json.dumps({'status': 'Analyzing search results...'})}\n\n"

    image_urls_from_text = _extract_image_urls_from_text(result["text"])

    all_candidate_urls: list[str] = list(image_urls_from_text)

    source_pages = result.get("sources", [])
    if len(all_candidate_urls) < num_images * 2 and source_pages:
        yield f"data: {json.dumps({'status': f'Scanning {len(source_pages)} source pages for images...'})}\n\n"
        futures = {}
        for src in source_pages[:12]:
            fut = _EXECUTOR.submit(_scrape_images_from_page, src["url"], query, 8)
            futures[fut] = src["url"]

        for fut in as_completed(futures, timeout=30):
            try:
                page_imgs = fut.result()
                all_candidate_urls.extend(page_imgs)
            except Exception:
                pass

    all_candidate_urls = list(dict.fromkeys(all_candidate_urls))

    yield f"data: {json.dumps({'status': f'Found {len(all_candidate_urls)} candidate images. Downloading and validating...'})}\n\n"

    download_limit = min(len(all_candidate_urls), num_images * 3)
    urls_to_try = all_candidate_urls[:download_limit]

    valid_images: list[dict] = []
    batch_size = 8
    for i in range(0, len(urls_to_try), batch_size):
        batch = urls_to_try[i:i + batch_size]
        futures = {_EXECUTOR.submit(_download_image, url): url for url in batch}

        for fut in as_completed(futures, timeout=20):
            try:
                img_data = fut.result()
                if img_data:
                    valid_images.append(img_data)
                    yield f"data: {json.dumps({'image': img_data, 'count': len(valid_images)})}\n\n"
                    if len(valid_images) >= num_images:
                        break
            except Exception:
                pass

        if len(valid_images) >= num_images:
            break

    if not valid_images and len(all_candidate_urls) == 0:
        yield f"data: {json.dumps({'status': 'Trying alternative search approach...'})}\n\n"
        alt_prompt = (
            f"Find direct image URLs for: {query}\n"
            "Search for high resolution reference photos. Return a JSON array of "
            '{"url": "...", "description": "..."} objects. Only include direct image file URLs.'
        )
        try:
            alt_text = core.rest_generate_text(api_key, model, alt_prompt, timeout=30)
            if alt_text:
                alt_urls = _extract_image_urls_from_text(alt_text)
                for url in alt_urls[:num_images]:
                    img_data = _download_image(url)
                    if img_data:
                        valid_images.append(img_data)
                        yield f"data: {json.dumps({'image': img_data, 'count': len(valid_images)})}\n\n"
        except Exception:
            pass

    parsed_descriptions = []
    try:
        cleaned = result["text"].strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
        parsed_descriptions = json.loads(cleaned)
        if not isinstance(parsed_descriptions, list):
            parsed_descriptions = []
    except Exception:
        parsed_descriptions = []

    for img in valid_images:
        for desc_item in parsed_descriptions:
            if isinstance(desc_item, dict) and desc_item.get("url") == img.get("url"):
                img["description"] = desc_item.get("description", "")
                img["relevance"] = desc_item.get("relevance", "")
                break

    yield f"data: {json.dumps({'status': f'Search complete. Found {len(valid_images)} reference images.', 'total': len(valid_images)})}\n\n"
    yield f"data: {json.dumps({'done': True, 'total': len(valid_images)})}\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/search")
async def deep_search(req: SearchRequest):
    api_key = core.get_api_key()
    if not api_key:
        raise HTTPException(400, "No API key configured")

    return StreamingResponse(
        _stream_search(api_key, req.query, req.image_b64, req.num_images, req.depth),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
