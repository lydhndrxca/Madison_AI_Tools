import requests, sys
sys.path.insert(0, "src")
from pubg_madison_ai_suite.api.core import get_extra_key

key = get_extra_key("meshy_api_key")
headers = {"Authorization": f"Bearer {key}"}

r = requests.get("https://api.meshy.ai/openapi/v1/retexture?page_size=5&sort_by=-created_at", headers=headers, timeout=30)
tasks = r.json()
for t in tasks:
    tid = t["id"][:16]
    prompt = t.get("text_style_prompt", "")
    status = t["status"]
    print(f"Task {tid}...  Status={status}  Prompt={prompt!r}")
