"""
Blender headless script: Render UV atlas (baked texture + wireframe overlay) for a material.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for atlas PNG output
  wireframe_output: path for UV wireframe overlay PNG
  material_index: index of the material to render (default 0)
  resolution: output resolution (default 2048)
  smart_unwrap: if true, re-unwrap UVs via Smart UV Project and bake texture (default true)
  island_margin: margin between UV islands for smart unwrap (default 0.02)
"""

import bpy
import sys
import json
import numpy as np


def _uv_quality_score(obj, target_mat):
    """Heuristic: returns a 0-1 score for UV quality. Low = per-face junk."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        return 0.0

    shared_uvs = 0
    total_checks = 0

    vert_uv_map = {}
    for poly in mesh.polygons:
        if poly.material_index < len(obj.material_slots):
            if obj.material_slots[poly.material_index].material != target_mat:
                continue
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            uv = tuple(round(c, 4) for c in uv_layer.data[li].uv)
            if vi in vert_uv_map:
                total_checks += 1
                if vert_uv_map[vi] == uv:
                    shared_uvs += 1
            else:
                vert_uv_map[vi] = uv

    if total_checks == 0:
        return 0.5
    return shared_uvs / total_checks


def _smart_unwrap_and_bake(meshes, target_mat, resolution, island_margin, output_path):
    """Re-unwrap with Smart UV Project, bake existing texture onto new UVs."""
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.cycles.samples = 1
    bpy.context.scene.cycles.use_denoising = False

    bake_image = bpy.data.images.new("bake_target", width=resolution, height=resolution, alpha=True)
    bake_image.colorspace_settings.name = "sRGB"

    for obj in meshes:
        if not any(s.material == target_mat for s in obj.material_slots):
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        mesh = obj.data
        if not mesh.uv_layers:
            mesh.uv_layers.new(name="UVMap")

        old_uv = mesh.uv_layers.active
        old_uv_name = old_uv.name if old_uv else None

        new_uv = mesh.uv_layers.new(name="SmartUV")
        mesh.uv_layers.active = new_uv

        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=island_margin, angle_limit=1.15)
        bpy.ops.object.mode_set(mode="OBJECT")

        if target_mat.use_nodes and target_mat.node_tree:
            nodes = target_mat.node_tree.nodes
            bake_node = nodes.new("ShaderNodeTexImage")
            bake_node.name = "_bake_target"
            bake_node.image = bake_image
            bake_node.select = True
            nodes.active = bake_node

    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True)
        print("SUCCESS: Baked texture to new UVs")
    except Exception as e:
        print(f"WARNING: Bake failed ({e}), falling back to blank atlas")
        pixels = np.full(resolution * resolution * 4, 0.2, dtype=np.float32)
        pixels[3::4] = 1.0
        bake_image.pixels.foreach_set(pixels)

    for obj in meshes:
        if not any(s.material == target_mat for s in obj.material_slots):
            continue
        mesh = obj.data
        if "SmartUV" in mesh.uv_layers:
            mesh.uv_layers.active = mesh.uv_layers["SmartUV"]

        if target_mat.use_nodes and target_mat.node_tree:
            nodes = target_mat.node_tree.nodes
            bake_node = nodes.get("_bake_target")
            if bake_node:
                nodes.remove(bake_node)

    bake_image.filepath_raw = output_path
    bake_image.file_format = "PNG"
    bake_image.save()
    return bake_image


def _draw_wireframe_numpy(meshes, target_mat, resolution):
    """Render UV wireframe edges into an RGBA numpy array using vectorised line drawing."""
    buf = np.zeros((resolution, resolution, 4), dtype=np.float32)

    for obj in meshes:
        if not obj.data.uv_layers:
            continue
        if not any(s.material == target_mat for s in obj.material_slots):
            continue

        mesh = obj.data
        uv_layer = mesh.uv_layers.active
        if not uv_layer:
            continue

        uv_data = uv_layer.data
        edges_a = []
        edges_b = []

        for poly in mesh.polygons:
            if poly.material_index < len(obj.material_slots):
                if obj.material_slots[poly.material_index].material != target_mat:
                    continue

            loops = list(poly.loop_indices)
            for i in range(len(loops)):
                a = uv_data[loops[i]].uv
                b = uv_data[loops[(i + 1) % len(loops)]].uv
                edges_a.append((a.x, a.y))
                edges_b.append((b.x, b.y))

        if not edges_a:
            continue

        ea = np.array(edges_a, dtype=np.float64)
        eb = np.array(edges_b, dtype=np.float64)

        xa = (ea[:, 0] * resolution).astype(np.int32) % resolution
        ya = (ea[:, 1] * resolution).astype(np.int32) % resolution
        xb = (eb[:, 0] * resolution).astype(np.int32) % resolution
        yb = (eb[:, 1] * resolution).astype(np.int32) % resolution

        dx = np.abs(xb - xa)
        dy = np.abs(yb - ya)
        steps = np.maximum(np.maximum(dx, dy), 1)

        max_steps = int(steps.max()) + 1
        t = np.linspace(0, 1, max_steps, dtype=np.float64)

        for i in range(len(edges_a)):
            n = int(steps[i]) + 1
            ts = t[:n]
            px = ((xa[i] + (xb[i] - xa[i]) * ts).astype(np.int32)) % resolution
            py = ((ya[i] + (yb[i] - ya[i]) * ts).astype(np.int32)) % resolution
            buf[py, px] = [1.0, 0.6, 0.0, 0.8]

    return buf


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    wireframe_output = args.get("wireframe_output", output_path.replace(".png", "_wire.png"))
    mat_index = args.get("material_index", 0)
    resolution = args.get("resolution", 2048)
    smart_unwrap = args.get("smart_unwrap", False)
    island_margin = args.get("island_margin", 0.02)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    all_mats = []
    for obj in meshes:
        for slot in obj.material_slots:
            if slot.material and slot.material not in all_mats:
                all_mats.append(slot.material)

    if mat_index < len(all_mats):
        target_mat = all_mats[mat_index]
    elif all_mats:
        target_mat = all_mats[0]
    else:
        print("ERROR: No materials found")
        sys.exit(1)

    # --- Check UV quality and decide whether to re-unwrap ---
    needs_unwrap = False
    if smart_unwrap:
        scores = []
        for obj in meshes:
            if any(s.material == target_mat for s in obj.material_slots):
                scores.append(_uv_quality_score(obj, target_mat))
        avg_score = sum(scores) / len(scores) if scores else 1.0
        needs_unwrap = avg_score < 0.3
        print(f"UV quality score: {avg_score:.2f} — {'re-unwrapping' if needs_unwrap else 'UVs look usable'}")

    if needs_unwrap:
        _smart_unwrap_and_bake(meshes, target_mat, resolution, island_margin, output_path)
        print(f"SUCCESS: Smart UV unwrap + bake at {output_path}")
    else:
        atlas_image = None
        if target_mat.use_nodes and target_mat.node_tree:
            for node in target_mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    bc = node.inputs.get("Base Color")
                    if bc and bc.is_linked:
                        src = bc.links[0].from_node
                        if src.type == "TEX_IMAGE" and src.image:
                            atlas_image = src.image
                    break

        if atlas_image:
            atlas_image.filepath_raw = output_path
            atlas_image.file_format = "PNG"
            atlas_image.save()
            print(f"SUCCESS: Saved atlas from existing texture: {output_path}")
        else:
            img = bpy.data.images.new("atlas_blank", width=resolution, height=resolution, alpha=True)
            pixels = np.full(resolution * resolution * 4, 0.2, dtype=np.float32)
            pixels[3::4] = 1.0
            img.pixels.foreach_set(pixels)
            img.filepath_raw = output_path
            img.file_format = "PNG"
            img.save()
            print("WARNING: No base color texture found, exported blank atlas")

    # --- Wireframe overlay (always uses current active UVs) ---
    wire_buf = _draw_wireframe_numpy(meshes, target_mat, resolution)
    wire_img = bpy.data.images.new("uv_wireframe", width=resolution, height=resolution, alpha=True)
    wire_img.pixels.foreach_set(wire_buf.reshape(-1))
    wire_img.filepath_raw = wireframe_output
    wire_img.file_format = "PNG"
    wire_img.save()
    print(f"SUCCESS: UV wireframe at {wireframe_output}")

    result = {
        "atlas": output_path,
        "wireframe": wireframe_output,
        "width": resolution,
        "height": resolution,
        "material_name": target_mat.name,
        "was_unwrapped": needs_unwrap,
    }
    print("ATLAS_RESULT:" + json.dumps(result))


if __name__ == "__main__":
    main()
