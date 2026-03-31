"""
Blender headless script: Extract PBR texture maps from a GLB model.
Generates missing maps (Roughness, Metallic from constants; AO via bake).

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output_dir: directory to write extracted PNGs
"""

import bpy
import sys
import json
import os
from pathlib import Path


CHANNEL_MAP = {
    "Base Color": "albedo",
    "Normal": "normal",
    "Roughness": "roughness",
    "Metallic": "metallic",
    "Occlusion": "ao",
}

BSDF_INPUT_NAMES = {
    "albedo": ["Base Color"],
    "normal": ["Normal"],
    "roughness": ["Roughness"],
    "metallic": ["Metallic"],
    "ao": ["Occlusion", "Ambient Occlusion"],
}


def find_image_for_input(node_input):
    """Walk links backwards from a Principled BSDF input to find an Image Texture node."""
    if not node_input.is_linked:
        return None
    linked_node = node_input.links[0].from_node
    if linked_node.type == "TEX_IMAGE" and linked_node.image:
        return linked_node.image
    if linked_node.type == "NORMAL_MAP":
        color_input = linked_node.inputs.get("Color")
        if color_input and color_input.is_linked:
            src = color_input.links[0].from_node
            if src.type == "TEX_IMAGE" and src.image:
                return src.image
    return None


def get_constant_value(node_input):
    """Get a constant value from an unlinked BSDF input."""
    if node_input.is_linked:
        return None
    val = node_input.default_value
    if hasattr(val, "__len__"):
        return list(val)
    return val


def get_texture_resolution(mat):
    """Find the resolution of any existing texture in the material."""
    if not mat.use_nodes:
        return 1024
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image:
            w, h = node.image.size
            if w > 0 and h > 0:
                return max(w, h)
    return 1024


def generate_solid_map(value, res, name, output_dir, is_metallic=False):
    """Create a solid-color texture from a constant value."""
    img = bpy.data.images.new(name, width=res, height=res, alpha=False)

    if isinstance(value, (list, tuple)):
        r, g, b = value[0], value[1], value[2]
    else:
        r = g = b = float(value)

    pixels = [0.0] * (res * res * 4)
    for i in range(res * res):
        pixels[i * 4 + 0] = r
        pixels[i * 4 + 1] = g
        pixels[i * 4 + 2] = b
        pixels[i * 4 + 3] = 1.0
    img.pixels[:] = pixels

    filepath = os.path.join(output_dir, f"{name}.png")
    img.filepath_raw = filepath
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return filepath


def bake_ao(objects, res, safe_name, output_dir):
    """Bake ambient occlusion from geometry using Cycles."""
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.cycles.use_denoising = True

    bake_img = bpy.data.images.new(f"{safe_name}_ao_bake", width=res, height=res, alpha=False)
    bake_img.generated_color = (1, 1, 1, 1)

    for obj in objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            tree = mat.node_tree
            bake_node = tree.nodes.new("ShaderNodeTexImage")
            bake_node.image = bake_img
            bake_node.name = "__AO_BAKE_TARGET__"
            tree.nodes.active = bake_node

    bpy.ops.object.select_all(action="DESELECT")
    mesh_objs = [o for o in objects if o.type == "MESH"]
    for obj in mesh_objs:
        obj.select_set(True)
    if mesh_objs:
        bpy.context.view_layer.objects.active = mesh_objs[0]

    try:
        bpy.ops.object.bake(type="AO", margin=4)
    except Exception as e:
        print(f"WARNING: AO bake failed: {e}")
        for obj in objects:
            if obj.type != "MESH":
                continue
            for slot in obj.material_slots:
                mat = slot.material
                if mat and mat.use_nodes:
                    node = mat.node_tree.nodes.get("__AO_BAKE_TARGET__")
                    if node:
                        mat.node_tree.nodes.remove(node)
        bpy.data.images.remove(bake_img)
        return None

    filepath = os.path.join(output_dir, f"{safe_name}_ao.png")
    bake_img.filepath_raw = filepath
    bake_img.file_format = "PNG"
    bake_img.save()

    for obj in objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if mat and mat.use_nodes:
                node = mat.node_tree.nodes.get("__AO_BAKE_TARGET__")
                if node:
                    mat.node_tree.nodes.remove(node)

    bpy.data.images.remove(bake_img)
    return filepath


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_dir = args["output_dir"]

    os.makedirs(output_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    all_objects = list(bpy.context.scene.objects)
    result = {"materials": []}
    ao_baked = {}

    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue

        bsdf = None
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                bsdf = node
                break
        if not bsdf:
            continue

        safe_name = mat.name.replace(" ", "_").replace("/", "_").replace("\\", "_")
        mat_info = {"name": mat.name, "channels": {}}
        res = get_texture_resolution(mat)

        for channel_key, input_names in BSDF_INPUT_NAMES.items():
            saved = False
            for iname in input_names:
                inp = bsdf.inputs.get(iname)
                if not inp:
                    continue
                img = find_image_for_input(inp)
                if img:
                    filename = f"{safe_name}_{channel_key}.png"
                    filepath = os.path.join(output_dir, filename)
                    img.filepath_raw = filepath
                    img.file_format = "PNG"
                    img.save()
                    mat_info["channels"][channel_key] = filename
                    saved = True
                    break

            if not saved:
                for iname in input_names:
                    inp = bsdf.inputs.get(iname)
                    if inp:
                        const = get_constant_value(inp)
                        if const is not None:
                            if channel_key in ("roughness", "metallic"):
                                filename = f"{safe_name}_{channel_key}.png"
                                generate_solid_map(
                                    const, res, f"{safe_name}_{channel_key}",
                                    output_dir,
                                    is_metallic=(channel_key == "metallic"),
                                )
                                mat_info["channels"][channel_key] = filename
                                saved = True
                            else:
                                mat_info["channels"][channel_key] = {"constant": const}
                        break

            if channel_key == "ao" and not saved:
                if safe_name not in ao_baked:
                    ao_path = bake_ao(all_objects, res, safe_name, output_dir)
                    ao_baked[safe_name] = ao_path
                ao_path = ao_baked.get(safe_name)
                if ao_path:
                    mat_info["channels"]["ao"] = f"{safe_name}_ao.png"

        result["materials"].append(mat_info)

    print("EXTRACT_RESULT:" + json.dumps(result))


if __name__ == "__main__":
    main()
