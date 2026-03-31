# Phase 1: 3D Material Workshop — Manual Test Steps

**Current Progress: Step 9 (Decal Projection) — pick up here next session**

---

## 1. Import a GLB model ✅
- Click "Import Model", pick a .glb file.
- Verify it appears in the 3D viewport, the project bar shows its name,
  and it shows up in the Projects dropdown.

## 2. Import a non-GLB model (FBX/OBJ/STL) ✅
- Import a .fbx or .obj file.
- Verify Blender conversion kicks in (requires Blender installed),
  the spinner shows "Importing...", and the model loads as GLB in the viewer.

## 3. Material Inspector + Targeting ✅
- With a model loaded, check the left panel lists material slots.
- Click a slot to target it (purple highlight).
- Click "Full Model" to target everything.
- Verify the targeting badge updates in the Retexture panel.

## 4. Retexture via Meshy ✅
- Type a style prompt (e.g. "rusty metal with worn paint"),
  pick Fast Preview or High Quality mode, hit "Retexture with Meshy".
- Verify the progress bar polls, status transitions from PENDING to SUCCEEDED,
  and a new version appears in the bottom Version History strip.
- (Requires a Meshy API key in Settings.)

## 5. Version History + Compare ✅
- After a retexture completes, click between versions in the history strip.
- Verify the 3D viewer swaps models.
- Click the compare button on an older version — verify split/compare mode
  shows two models side-by-side.

## 6. PBR Map Extraction ✅
- In the right panel, click "Extract PBR Maps".
- Verify Blender runs, and a grid of map thumbnails appears
  (Albedo, Normal, Roughness, Metallic, AO).
- Click a thumbnail to preview full-size.
- Click "Download All" and verify PNGs download.

## 7. UV Atlas Editor ✅
- Click the "UV Editor" tab in the center panel.
- Verify the UV atlas renders via Blender, showing the unwrapped texture.
- Toggle the "UV Wireframe" checkbox — verify wireframe overlay toggles.
- Use Brush/Eraser to paint a mask on the atlas.

## 8. UV Inpaint + Bake-Back ✅
- In the UV Editor, paint a mask region, type a texture prompt
  (e.g. "camouflage pattern"), click "Apply Inpaint".
- Verify Gemini edits the masked area.
- Then click "Apply to Model" — verify a new version is created
  and the 3D viewport updates with the baked texture.

## 9. Decal Projection ⬅️ START HERE
- In the right panel under "Decal Projection", upload a PNG decal image.
- Adjust position/normal/scale values (or click the model in the viewport
  if click-to-place is wired).
- Click "Bake Decal".
- Verify Blender projects the decal and a new version appears.

## 10. AI Material Analysis
- In the right panel under "AI Material Analysis", click "AI Analyze".
- Verify it renders 6 orthographic views via Blender, sends them to Gemini,
  and returns detected material regions with names, types, locations,
  and suggested prompts.
- Click "Apply as Retexture Prompt" on a region — verify it populates
  the Retexture panel's prompt field.

---

## Bugs Fixed During Testing
- **Infinite fetch loop**: `useGLTF.clear()` on Suspense unmount caused endless model re-fetches. Fixed by only clearing cache on URL change.
- **Broken version history**: Pending versions with missing GLB files caused spinner hangs. Fixed with backend filtering + frontend disable.
- **Slow import**: 3x base64 round-trips replaced with single multipart file upload.
- **Retexture panel complexity**: Simplified to Fast Preview (meshy-5, no PBR) / High Quality (meshy-6, PBR on) — removed redundant AI model dropdown and PBR checkbox.
- **Missing PBR maps**: Blender now generates solid-color textures for constant Roughness/Metallic values and bakes AO from geometry.
- **UV mask offset**: Paint was landing far from cursor. Fixed by using `offsetX/offsetY` directly from the mask canvas events instead of cross-referencing `getBoundingClientRect` from a different canvas element.
- **Global shortcut leak**: Character Lab's Ctrl+Shift+R fired in Material Workshop. Fixed with visibility guard.
- **WebGL context loss**: Added exponential backoff recovery with GPU memory cleanup.
- **FBX model not visible**: Fixed Blender conversion to apply transforms + normalize scene.
- **Stack overflow on import**: Replaced `btoa(String.fromCharCode(...))` with chunked base64 encoder.
