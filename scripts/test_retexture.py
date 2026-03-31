"""End-to-end retexture test through the backend API."""
import requests
import json
import time
import sys

BASE = "http://127.0.0.1:8420/api/3d"
PROJECT = "fd266295-634"

# Step 1: Submit retexture
print("=== Step 1: Submit retexture ===")
r = requests.post(f"{BASE}/meshy", json={
    "action": "retexture",
    "model_url": f"/api/3d/workshop/projects/{PROJECT}/model/original.glb",
    "text_style_prompt": "weathered leather with brass studs",
    "ai_model": "latest",
    "enable_original_uv": True,
    "enable_pbr": False,
}, timeout=120)
data = r.json()
task_id = data.get("result")
print(f"Task ID: {task_id}")
if not task_id:
    print(f"ERROR: {data}")
    sys.exit(1)

version_id = f"v-{task_id[:8]}"

# Step 2: Add pending version (no GLB yet)
print(f"\n=== Step 2: Add pending version {version_id} ===")
r = requests.post(f"{BASE}/workshop/projects/{PROJECT}/versions", json={
    "id": version_id,
    "label": "Retexture Test",
    "type": "retexture",
    "meshyTaskId": task_id,
    "status": "pending",
    "prompt": "weathered leather with brass studs",
})
ver = r.json()
print(f"Status: {r.status_code}, glbFile: {ver.get('glbFile')}")

# Verify the project didn't switch to the pending version
proj = requests.get(f"{BASE}/workshop/projects/{PROJECT}").json()
cur = proj["currentVersionId"]
print(f"Current version ID: {cur} (should NOT be {version_id})")
assert cur != version_id, f"FAIL: Switched to pending version {version_id} before GLB was downloaded!"
print("PASS: Stayed on original version")

# Step 3: Poll until complete
print("\n=== Step 3: Polling ===")
glb_url = None
for i in range(30):
    r = requests.post(f"{BASE}/meshy", json={"action": "poll-retexture", "taskId": task_id}, timeout=30)
    data = r.json()
    status = data.get("status", "?")
    progress = data.get("progress", 0)
    print(f"  [{i*10}s] {status} {progress}%")
    if status == "SUCCEEDED":
        glb_url = data.get("model_urls", {}).get("glb")
        print(f"  GLB URL obtained ({len(glb_url)} chars)")
        break
    if status in ("FAILED", "CANCELED"):
        print(f"  FAILED: {data.get('task_error')}")
        sys.exit(1)
    time.sleep(10)

if not glb_url:
    print("TIMEOUT: Retexture did not complete in 5 minutes")
    sys.exit(1)

# Step 4: Update version with downloaded GLB
print(f"\n=== Step 4: Update version with GLB ===")
r = requests.post(f"{BASE}/workshop/projects/{PROJECT}/versions", json={
    "id": version_id,
    "label": "Retexture Test",
    "type": "retexture",
    "meshyTaskId": task_id,
    "status": "ready",
    "prompt": "weathered leather with brass studs",
    "glb_url": glb_url,
})
print(f"Version update: {r.status_code}")
ver = r.json()
print(f"  glbFile: {ver.get('glbFile')}")
print(f"  status: {ver.get('status')}")

# Verify project switched to new version
proj = requests.get(f"{BASE}/workshop/projects/{PROJECT}").json()
cur = proj["currentVersionId"]
print(f"  currentVersionId: {cur}")
assert cur == version_id, f"FAIL: Should have switched to {version_id}, got {cur}"
print("  PASS: Switched to retextured version")

# Verify file exists and is valid GLB
r = requests.get(f"{BASE}/workshop/projects/{PROJECT}/model/{version_id}.glb", timeout=10)
print(f"\n=== Step 5: Verify file ===")
print(f"  Download status: {r.status_code}")
print(f"  File size: {len(r.content)} bytes")
print(f"  GLB magic: {r.content[:4]}")
assert r.status_code == 200, f"FAIL: File download returned {r.status_code}"
assert r.content[:4] == b"glTF", f"FAIL: Not a valid GLB file"
print("  PASS: Valid GLB file")

# Check no duplicate versions
versions = proj.get("versions", [])
ids = [v["id"] for v in versions]
print(f"\n  Version count: {len(versions)}, IDs: {ids}")
dupes = [vid for vid in set(ids) if ids.count(vid) > 1]
assert not dupes, f"FAIL: Duplicate version IDs: {dupes}"
print("  PASS: No duplicate versions")

print("\n" + "=" * 50)
print("ALL TESTS PASSED")
print("=" * 50)
