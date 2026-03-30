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
    enabled_sources: Optional[dict] = None  # e.g. {"gemini":true,"pexels":false,...}


class EnrichQueryRequest(BaseModel):
    user_request: str
    image_b64: Optional[str] = None
    attributes_context: Optional[str] = None


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
        resp = requests.get(url, headers=_HEADERS, timeout=timeout, stream=True, allow_redirects=True)
        if resp.status_code != 200:
            return None
        ct = resp.headers.get("content-type", "").lower()
        if not (ct.startswith("image/") or ct in ("application/octet-stream",)):
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


def _extract_page_urls_from_text(text: str) -> list[str]:
    """Pull any HTTP(S) URLs from text, including non-image page URLs for scraping."""
    url_pattern = r'https?://[^\s\"\'\)>\],}]+'
    all_urls = re.findall(url_pattern, text, re.IGNORECASE)
    page_urls = []
    skip_domains = ("google.com", "googleapis.com", "gstatic.com", "youtube.com", "schema.org")
    for u in all_urls:
        u = u.rstrip(".")
        low = u.lower()
        if any(d in low for d in skip_domains):
            continue
        if any(low.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")):
            continue
        page_urls.append(u)
    return list(dict.fromkeys(page_urls))


def _grounded_search(api_key: str, model: str, query: str, image_b64: str | None,
                     num_images: int, depth: str, search_angle: str = "") -> dict:
    """Use Gemini with google_search tool to find reference images."""
    depth_instruction = {
        "quick": f"Do a quick search. Find direct image URLs for at least {max(num_images, 8)} reference images.",
        "medium": f"Do a thorough search across multiple queries and search terms. Find direct image URLs for at least {max(num_images, 15)} reference images. Try different phrasings and related keywords.",
        "deep": f"Do an extensive, multi-query deep search. Find direct image URLs for at least {max(num_images, 30)} reference images. Try MANY search angles, synonym variations, related materials, styles, and sub-categories.",
    }

    angle_instruction = f"\nSearch angle to focus on: {search_angle}\n" if search_angle else ""

    system_prompt = (
        "You are a visual reference researcher for concept artists and designers. "
        "Your job is to find high-quality reference images from the web.\n\n"
        "CRITICAL INSTRUCTIONS:\n"
        "1. Use Google Search MULTIPLE TIMES with different search queries to find images\n"
        "2. For each image found, provide its DIRECT image URL (must end in .jpg, .jpeg, .png, .webp, .gif)\n"
        "3. Along with each URL, give a short description of what the image shows\n"
        "4. Focus on high-quality, relevant images from diverse sources\n"
        "5. Avoid stock photo watermarked images when possible\n"
        "6. Search across: Pinterest, ArtStation, DeviantArt, Behance, Dribbble, museum archives, "
        "design blogs, fashion sites, Flickr, 500px, Unsplash, product photography sites, "
        "concept art portfolios, and image-heavy articles\n"
        "7. Use VARIED search terms — try synonyms, related concepts, material names, "
        "style descriptors, and specific brands or eras\n"
        "8. For each search, also look for Google Image results that show image source URLs\n\n"
        f"{depth_instruction.get(depth, depth_instruction['medium'])}\n"
        f"{angle_instruction}\n"
        f"Target: Find at least {num_images} relevant reference images. More is better.\n\n"
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

    core._extract_usage_and_track(data, model, "deep_search", grounding_queries=1)

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


def _scrape_images_from_page(page_url: str, query: str, max_imgs: int = 10) -> list[str]:
    """Fetch a web page and extract image URLs from it."""
    try:
        resp = requests.get(page_url, headers={
            **_HEADERS,
            "Accept": "text/html,application/xhtml+xml,*/*",
        }, timeout=12, allow_redirects=True)
        if resp.status_code != 200:
            return []
        html = resp.text[:800_000]

        img_pattern = r'(?:src|href|data-src|data-original|data-lazy-src|data-pin-media|content|srcset)=["\']([^"\']*\.(?:jpg|jpeg|png|webp|gif)[^"\']*)["\']'
        raw_urls = re.findall(img_pattern, html, re.IGNORECASE)

        og_pattern = r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']'
        og_urls = re.findall(og_pattern, html, re.IGNORECASE)
        raw_urls.extend(og_urls)

        full_urls = []
        for u in raw_urls:
            if " " in u:
                u = u.split(" ")[0]
            if u.startswith("//"):
                u = "https:" + u
            elif u.startswith("/"):
                parsed = urllib.parse.urlparse(page_url)
                u = f"{parsed.scheme}://{parsed.netloc}{u}"
            elif not u.startswith("http"):
                continue
            low = u.lower()
            if any(skip in low for skip in ("logo", "icon", "favicon", "1x1", "pixel", "tracking",
                                             "spacer", "blank", "avatar", "badge", "emoji", "sprite")):
                continue
            if len(u) < 30:
                continue
            full_urls.append(u)

        return list(dict.fromkeys(full_urls))[:max_imgs]
    except Exception:
        return []


def _google_images_scrape(query: str, max_imgs: int = 40) -> list[str]:
    """Scrape Google Images search results pages for image URLs."""
    img_urls: list[str] = []
    seen: set[str] = set()
    headers = {
        "User-Agent": _HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    encoded_q = urllib.parse.quote_plus(query)
    pages_to_try = max(1, (max_imgs + 19) // 20)

    for page_idx in range(min(pages_to_try, 4)):
        try:
            url = f"https://www.google.com/search?q={encoded_q}&tbm=isch&ijn={page_idx}&start={page_idx * 20}"
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code != 200:
                continue
            html = resp.text

            patterns = [
                r'\["(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:[^"]*)?)",\s*\d+,\s*\d+\]',
                r'"ou":"(https?://[^"]+)"',
                r'"(https?://[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"',
            ]
            for pat in patterns:
                found = re.findall(pat, html, re.IGNORECASE)
                for u in found:
                    low = u.lower()
                    if any(skip in low for skip in ("google.com", "gstatic.com", "youtube.com",
                                                     "googleapis.com", "schema.org")):
                        continue
                    if len(u) > 30 and u not in seen:
                        seen.add(u)
                        img_urls.append(u)

            if len(img_urls) >= max_imgs:
                break
        except Exception:
            continue

    return img_urls[:max_imgs]


def _pexels_search(api_key: str, query: str, max_imgs: int = 30) -> list[dict]:
    """Search Pexels API. Returns list of {url, description, source, width, height}."""
    results: list[dict] = []
    per_page = min(max_imgs, 80)
    pages = max(1, (max_imgs + per_page - 1) // per_page)

    for page in range(1, pages + 1):
        try:
            resp = requests.get(
                "https://api.pexels.com/v1/search",
                params={"query": query, "per_page": per_page, "page": page},
                headers={"Authorization": api_key},
                timeout=12,
            )
            if resp.status_code != 200:
                break
            data = resp.json()
            for photo in data.get("photos", []):
                src = photo.get("src", {})
                img_url = src.get("large2x") or src.get("large") or src.get("original", "")
                if not img_url:
                    continue
                results.append({
                    "url": img_url,
                    "description": f"Photo by {photo.get('photographer', 'Unknown')} on Pexels",
                    "source": "pexels",
                    "width": photo.get("width", 0),
                    "height": photo.get("height", 0),
                })
            if not data.get("next_page"):
                break
        except Exception:
            break
        if len(results) >= max_imgs:
            break

    return results[:max_imgs]


def _pixabay_search(api_key: str, query: str, max_imgs: int = 30) -> list[dict]:
    """Search Pixabay API (https://pixabay.com/api/docs/).

    Uses largeImageURL (1280px) with fallback to fullHDURL (1920px) when
    available.  Searches both photos and illustrations for broader concept
    art coverage, with a minimum width of 640px to filter tiny thumbnails.
    """
    results: list[dict] = []
    seen_ids: set[int] = set()
    per_page = min(max_imgs, 200)
    pages = max(1, (max_imgs + per_page - 1) // per_page)

    for image_type in ("photo", "illustration"):
        for page in range(1, pages + 1):
            try:
                resp = requests.get(
                    "https://pixabay.com/api/",
                    params={
                        "key": api_key,
                        "q": query,
                        "per_page": per_page,
                        "page": page,
                        "image_type": image_type,
                        "min_width": 640,
                        "safesearch": "true",
                        "order": "popular",
                    },
                    timeout=12,
                )
                if resp.status_code == 429:
                    break
                if resp.status_code != 200:
                    break
                data = resp.json()
                for hit in data.get("hits", []):
                    hit_id = hit.get("id", 0)
                    if hit_id in seen_ids:
                        continue
                    seen_ids.add(hit_id)
                    img_url = (hit.get("fullHDURL")
                               or hit.get("largeImageURL")
                               or hit.get("webformatURL", ""))
                    if not img_url:
                        continue
                    results.append({
                        "url": img_url,
                        "description": hit.get("tags", "Pixabay image"),
                        "source": "pixabay",
                        "width": hit.get("imageWidth", 0),
                        "height": hit.get("imageHeight", 0),
                    })
                if len(data.get("hits", [])) < per_page:
                    break
            except Exception:
                break
            if len(results) >= max_imgs:
                break
        if len(results) >= max_imgs:
            break

    return results[:max_imgs]


def _parse_json_descriptions(text: str) -> list[dict]:
    """Extract JSON array of {url, description, relevance} from Gemini response."""
    try:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
        result = json.loads(cleaned)
        return result if isinstance(result, list) else []
    except Exception:
        return []


def _run_search_round(api_key: str, model: str, query: str, image_b64: str | None,
                      num_images: int, depth: str, search_angle: str = "") -> tuple[list[str], list[str], list[dict]]:
    """Single search round. Returns (image_urls, source_page_urls, parsed_descriptions)."""
    result = _grounded_search(api_key, model, query, image_b64, num_images, depth, search_angle)

    image_urls = _extract_image_urls_from_text(result["text"])

    source_pages = [s["url"] for s in result.get("sources", []) if s.get("url")]
    text_pages = _extract_page_urls_from_text(result["text"])
    source_pages = list(dict.fromkeys(source_pages + text_pages))

    descriptions = _parse_json_descriptions(result["text"])

    return image_urls, source_pages, descriptions


def _enrich_query_from_image(api_key: str, model: str, query: str,
                             image_b64: str) -> str:
    """Quick Gemini call to describe the reference image for text-only search APIs."""
    try:
        contents: list = [
            {"inlineData": {"mimeType": "image/png", "data": image_b64[:10_000_000]}},
            (
                "Describe this image in detail for a visual reference search. "
                "Focus on: style, materials, colors, era/culture, specific design elements, "
                "and artistic genre (concept art, photography, illustration, etc.). "
                f"The user is searching for: \"{query}\"\n\n"
                "Return a single search-engine-friendly description (2-3 sentences) "
                "with specific visual keywords. No preamble."
            ),
        ]
        result = core.rest_generate_text_multimodal(
            api_key, model, contents, timeout=15, cost_category="deep_search",
        )
        if result and len(result.strip()) > 10:
            return result.strip()
    except Exception:
        pass
    return query


def _stream_search(api_key: str, query: str, image_b64: str | None,
                   num_images: int, depth: str, *,
                   enabled_sources: dict | None = None):
    """Generator that yields SSE events as the search progresses."""
    model = "gemini-2.0-flash"
    has_ref_image = bool(image_b64)

    src = enabled_sources or {}
    use_gemini = src.get("gemini", True)
    use_pexels = src.get("pexels", True)
    use_pixabay = src.get("pixabay", True)
    use_google_images = src.get("googleImages", True)

    search_rounds = {"quick": 1, "medium": 2, "deep": 3}.get(depth, 2)
    scrape_per_page = {"quick": 5, "medium": 10, "deep": 15}.get(depth, 10)
    max_source_pages = {"quick": 8, "medium": 16, "deep": 24}.get(depth, 16)

    # --- Phase -1: If reference image provided, analyze it to enrich the query ---
    stock_query = query
    if has_ref_image and use_gemini:
        yield f"data: {json.dumps({'status': 'Analyzing reference image...'})}\n\n"
        enriched = _EXECUTOR.submit(_enrich_query_from_image, api_key, model, query, image_b64)
    else:
        enriched = None

    all_candidate_urls: list[str] = []
    all_source_pages: list[str] = []
    all_descriptions: list[dict] = []
    seen_urls: set[str] = set()
    valid_images: list[dict] = []

    # --- Phase 0: Fire off Pexels + Pixabay in parallel (instant results) ---
    pexels_key = core.get_extra_key("pexels_api_key")
    pixabay_key = core.get_extra_key("pixabay_api_key")
    stock_futures = {}

    # When we have a reference image, wait for the enriched query first
    if has_ref_image and enriched is not None:
        try:
            stock_query = enriched.result(timeout=18)
            yield f"data: {json.dumps({'status': f'Image analyzed. Searching for: {stock_query[:120]}...'})}\n\n"
        except Exception:
            stock_query = query

    stock_request_count = max(num_images, 20)
    # When a reference image is provided, cap stock results so Gemini visual
    # search always gets a chance to find style-matched results.
    stock_cap = num_images // 3 if has_ref_image else num_images

    if pexels_key and use_pexels:
        stock_futures["pexels"] = _EXECUTOR.submit(_pexels_search, pexels_key, stock_query, stock_request_count)
    if pixabay_key and use_pixabay:
        stock_futures["pixabay"] = _EXECUTOR.submit(_pixabay_search, pixabay_key, stock_query, stock_request_count)

    if stock_futures:
        sources_label = " + ".join(k.title() for k in stock_futures)
        yield f"data: {json.dumps({'status': f'Searching {sources_label}...'})}\n\n"

    # Collect stock API results as they complete (non-blocking, short timeout)
    stock_image_items: list[dict] = []
    for fut in as_completed(stock_futures.values(), timeout=15):
        try:
            items = fut.result()
            stock_image_items.extend(items)
        except Exception:
            pass

    # Download and stream stock results immediately
    if stock_image_items:
        yield f"data: {json.dumps({'status': f'Found {len(stock_image_items)} results from stock libraries. Downloading...'})}\n\n"
        download_futs = {}
        for item in stock_image_items:
            if item["url"] not in seen_urls:
                seen_urls.add(item["url"])
                download_futs[_EXECUTOR.submit(_download_image, item["url"])] = item

        for fut in as_completed(download_futs, timeout=25):
            try:
                img_data = fut.result()
                if img_data:
                    meta = download_futs[fut]
                    img_data["description"] = meta.get("description", "")
                    img_data["relevance"] = f"From {meta.get('source', 'stock library').title()}"
                    valid_images.append(img_data)
                    yield f"data: {json.dumps({'image': img_data, 'count': len(valid_images)})}\n\n"
                    yield f"data: {json.dumps({'status': f'Downloaded {len(valid_images)} of {num_images} requested...'})}\n\n"
                    if len(valid_images) >= stock_cap:
                        break
            except Exception:
                pass

    # Only short-circuit when there is NO reference image — when the user
    # provided a reference image we always continue to the AI visual search.
    if not has_ref_image and len(valid_images) >= num_images:
        yield f"data: {json.dumps({'status': f'Search complete. Found {len(valid_images)} reference images.', 'total': len(valid_images)})}\n\n"
        yield f"data: {json.dumps({'done': True, 'total': len(valid_images)})}\n\n"
        return

    remaining = num_images - len(valid_images)
    if has_ref_image:
        yield f"data: {json.dumps({'status': f'Have {len(valid_images)} stock results. Running AI visual search to find style-matched images...'})}\n\n"
    else:
        yield f"data: {json.dumps({'status': f'Have {len(valid_images)} images. Searching deeper for {remaining} more...'})}\n\n"

    # --- Phase 1: Gemini grounded search rounds ---
    # Build search angles using the enriched query when available
    sq = stock_query if has_ref_image else query
    search_angles = [
        "",
        f"Search specifically for: {sq} - look for different styles, variations, materials, and design approaches",
        f"Find more images related to: {sq} - try alternative keywords, similar concepts, related categories, specific brands or eras",
    ]

    first_round_error = None
    if use_gemini:
        for round_num in range(search_rounds):
            angle = search_angles[round_num] if round_num < len(search_angles) else ""
            label = f"Round {round_num + 1}/{search_rounds}" if search_rounds > 1 else "Searching"
            yield f"data: {json.dumps({'status': f'{label}: Searching the web for references...'})}\n\n"

            try:
                image_urls, source_pages, descriptions = _run_search_round(
                    api_key, model, query, image_b64, num_images, depth, angle,
                )
            except Exception as exc:
                if round_num == 0:
                    first_round_error = str(exc)[:500]
                continue

            new_urls = [u for u in image_urls if u not in seen_urls]
            seen_urls.update(new_urls)
            all_candidate_urls.extend(new_urls)
            all_descriptions.extend(descriptions)

            new_pages = [p for p in source_pages if p not in seen_urls]
            seen_urls.update(new_pages)
            all_source_pages.extend(new_pages)

            yield f"data: {json.dumps({'status': f'{label}: Found {len(all_candidate_urls)} direct URLs + {len(all_source_pages)} source pages...'})}\n\n"

    # --- Phase 2: Always scrape source pages for images ---
    if all_source_pages:
        pages_to_scrape = all_source_pages[:max_source_pages]
        yield f"data: {json.dumps({'status': f'Scraping {len(pages_to_scrape)} source pages for images...'})}\n\n"
        futures = {}
        for page_url in pages_to_scrape:
            fut = _EXECUTOR.submit(_scrape_images_from_page, page_url, query, scrape_per_page)
            futures[fut] = page_url

        for fut in as_completed(futures, timeout=45):
            try:
                page_imgs = fut.result()
                new_imgs = [u for u in page_imgs if u not in seen_urls]
                seen_urls.update(new_imgs)
                all_candidate_urls.extend(new_imgs)
            except Exception:
                pass

    # --- Phase 3: Google Images direct scrape (always run for supplementation) ---
    gi_query = stock_query if has_ref_image else query
    if use_google_images:
        need_more = max(num_images * 3, 50) - len(all_candidate_urls)
        if need_more > 0:
            yield f"data: {json.dumps({'status': 'Searching Google Images directly...'})}\n\n"
            try:
                gi_urls = _google_images_scrape(gi_query, max_imgs=max(num_images * 3, 60))
                new_gi = [u for u in gi_urls if u not in seen_urls]
                seen_urls.update(new_gi)
                all_candidate_urls.extend(new_gi)
                if new_gi:
                    yield f"data: {json.dumps({'status': f'Google Images found {len(new_gi)} additional candidates...'})}\n\n"
            except Exception:
                pass

        # --- Phase 4: Related search terms if still short ---
        if len(all_candidate_urls) < num_images * 3:
            yield f"data: {json.dumps({'status': 'Trying related search terms...'})}\n\n"
            variants = [
                f"{gi_query} reference photo",
                f"{gi_query} high quality",
                f"{gi_query} design inspiration",
                f"{gi_query} concept art",
            ]
            for variant in variants:
                if len(all_candidate_urls) >= num_images * 4:
                    break
                try:
                    gi_urls = _google_images_scrape(variant, max_imgs=max(num_images, 20))
                    new_gi = [u for u in gi_urls if u not in seen_urls]
                    seen_urls.update(new_gi)
                    all_candidate_urls.extend(new_gi)
                except Exception:
                    pass

    if not all_candidate_urls and not valid_images and first_round_error:
        yield f"data: {json.dumps({'error': first_round_error})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
        return

    if len(valid_images) >= num_images:
        pass  # skip Phase 5 — already have enough from stock APIs
    else:
        all_candidate_urls = list(dict.fromkeys(all_candidate_urls))

    yield f"data: {json.dumps({'status': f'Found {len(all_candidate_urls)} candidate images. Downloading and validating...'})}\n\n"

    # --- Phase 5: Download and validate ---
    download_limit = min(len(all_candidate_urls), max(num_images * 5, 100))
    urls_to_try = all_candidate_urls[:download_limit]

    batch_size = 12
    for i in range(0, len(urls_to_try), batch_size):
        batch = urls_to_try[i:i + batch_size]
        futures = {_EXECUTOR.submit(_download_image, url): url for url in batch}

        for fut in as_completed(futures, timeout=30):
            try:
                img_data = fut.result()
                if img_data:
                    for desc_item in all_descriptions:
                        if isinstance(desc_item, dict) and desc_item.get("url") == img_data.get("url"):
                            img_data["description"] = desc_item.get("description", "")
                            img_data["relevance"] = desc_item.get("relevance", "")
                            break
                    valid_images.append(img_data)
                    yield f"data: {json.dumps({'image': img_data, 'count': len(valid_images)})}\n\n"
                    yield f"data: {json.dumps({'status': f'Validated {len(valid_images)} of {num_images} requested...'})}\n\n"
                    if len(valid_images) >= num_images:
                        break
            except Exception:
                pass

        if len(valid_images) >= num_images:
            break

    summary_text = ""
    if valid_images:
        try:
            sum_prompt = (
                f"In 1-2 sentences, summarize what these reference images show and "
                f"what design terms or concepts they represent. The search was: \"{query}\". "
                f"Found {len(valid_images)} images. Be informative and specific about "
                f"the visual qualities, materials, or styles represented."
            )
            summary_text = core.rest_generate_text(api_key, model, sum_prompt, timeout=15, cost_category="deep_search") or ""
        except Exception:
            pass

    if summary_text:
        yield f"data: {json.dumps({'summary': summary_text.strip()})}\n\n"

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
        _stream_search(api_key, req.query, req.image_b64, req.num_images, req.depth,
                       enabled_sources=req.enabled_sources),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/enrich-query")
async def enrich_query(req: EnrichQueryRequest):
    """Analyze the current image + user request and return an enriched search query."""
    api_key = core.get_api_key()
    if not api_key:
        raise HTTPException(400, "No API key configured")

    import asyncio
    loop = asyncio.get_event_loop()

    def _do():
        model = "gemini-2.0-flash"
        ctx_line = ""
        if req.attributes_context:
            ctx_line = f"\nCurrent design context: {req.attributes_context}\n"

        prompt = (
            "You are helping a concept artist find reference images. "
            "They are looking at their current artwork and want to explore alternatives.\n\n"
            f"Artist's request: \"{req.user_request}\"\n"
            f"{ctx_line}\n"
            "Look at the image (if provided) and generate a SINGLE detailed search query "
            "(2-4 sentences) that a reference-image search engine can use. "
            "The query should:\n"
            "1. Describe the specific element from the image the artist is referring to\n"
            "2. Suggest alternative styles, variations, or design directions to explore\n"
            "3. Include relevant design terminology, materials, cultural references, or era keywords\n\n"
            "Return ONLY the search query text, no explanation or preamble."
        )

        contents: list = []
        if req.image_b64:
            contents.append({"inlineData": {"mimeType": "image/png", "data": req.image_b64[:10_000_000]}})
        contents.append(prompt)

        result = core.rest_generate_text_multimodal(
            api_key, model, contents, timeout=20, cost_category="deep_search",
        )
        return (result or req.user_request).strip()

    enriched = await loop.run_in_executor(None, _do)
    return {"enriched_query": enriched}
