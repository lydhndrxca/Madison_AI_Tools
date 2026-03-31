"""
Blender headless script: Render UV atlas (baked texture + wireframe overlay) for a material.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for atlas PNG output
  wireframe_output: path for UV wireframe overlay PNG
  material_index: index of the material to render (default 0)
  resolution: output resolution (default 2048)
"""

import bpy
import sys
import json
import os
from pathlib import Path


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    wireframe_output = args.get("wireframe_output", output_path.replace(".png", "_wire.png"))
    mat_index = args.get("material_index", 0)
    resolution = args.get("resolution", 2048)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    target_mat = None
    all_mats = []
    for obj in meshes:
        for slot in obj.material_slots:
            if slot.material and slot.material not in all_mats:
                all_mats.append(slot.material)

    if mat_index < len(all_mats):
        target_mat = all_mats[mat_index]
    elif all_mats:
        target_mat = all_mats[0]

    if not target_mat:
        print("ERROR: No materials found")
        sys.exit(1)

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
        pixels = [0.2, 0.2, 0.2, 1.0] * (resolution * resolution)
        img.pixels = pixels
        img.filepath_raw = output_path
        img.file_format = "PNG"
        img.save()
        print(f"WARNING: No base color texture found, exported blank atlas")

    try:
        import gpu
        import gpu_extras
    except ImportError:
        pass

    wire_img = bpy.data.images.new("uv_wireframe", width=resolution, height=resolution, alpha=True)
    pixels = [0.0] * (resolution * resolution * 4)

    for obj in meshes:
        if not obj.data.uv_layers:
            continue
        has_mat = False
        for slot in obj.material_slots:
            if slot.material == target_mat:
                has_mat = True
                break
        if not has_mat:
            continue

        mesh = obj.data
        uv_layer = mesh.uv_layers.active
        if not uv_layer:
            continue

        for poly in mesh.polygons:
            mat_slot = obj.material_slots[poly.material_index] if poly.material_index < len(obj.material_slots) else None
            if mat_slot and mat_slot.material != target_mat:
                continue

            loop_indices = list(poly.loop_indices)
            for i in range(len(loop_indices)):
                uv_a = uv_layer.data[loop_indices[i]].uv
                uv_b = uv_layer.data[loop_indices[(i + 1) % len(loop_indices)]].uv

                x0, y0 = int(uv_a.x * resolution) % resolution, int(uv_a.y * resolution) % resolution
                x1, y1 = int(uv_b.x * resolution) % resolution, int(uv_b.y * resolution) % resolution

                steps = max(abs(x1 - x0), abs(y1 - y0), 1)
                for s in range(steps + 1):
                    t = s / steps
                    px = int(x0 + (x1 - x0) * t) % resolution
                    py = int(y0 + (y1 - y0) * t) % resolution
                    idx_px = (py * resolution + px) * 4
                    if 0 <= idx_px < len(pixels) - 3:
                        pixels[idx_px] = 1.0
                        pixels[idx_px + 1] = 0.6
                        pixels[idx_px + 2] = 0.0
                        pixels[idx_px + 3] = 0.8

    wire_img.pixels = pixels
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
    }
    print("ATLAS_RESULT:" + json.dumps(result))


if __name__ == "__main__":
    main()
