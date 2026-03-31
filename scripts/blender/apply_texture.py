"""
Blender headless script: Replace a texture channel on a material and re-export GLB.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for output GLB
  material_index: index of the target material (default 0)
  texture_path: path to the new texture image file
  channel: which channel to replace ("diffuse", "normal", "roughness", "metallic", "ao", "emissive")
"""

import bpy
import sys
import json
from pathlib import Path


CHANNEL_TO_INPUT = {
    "diffuse": "Base Color",
    "albedo": "Base Color",
    "normal": "Normal",
    "roughness": "Roughness",
    "metallic": "Metallic",
    "ao": "Occlusion",
    "emissive": "Emission Color",
}


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    mat_index = args.get("material_index", 0)
    texture_path = args["texture_path"]
    channel = args.get("channel", "diffuse")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    all_mats = []
    for obj in meshes:
        for slot in obj.material_slots:
            if slot.material and slot.material not in all_mats:
                all_mats.append(slot.material)

    if mat_index >= len(all_mats):
        print(f"ERROR: material_index {mat_index} out of range (have {len(all_mats)})")
        sys.exit(1)

    target_mat = all_mats[mat_index]
    bsdf_input_name = CHANNEL_TO_INPUT.get(channel, "Base Color")

    if not target_mat.use_nodes or not target_mat.node_tree:
        print(f"ERROR: Material '{target_mat.name}' has no node tree")
        sys.exit(1)

    bsdf = None
    for node in target_mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            bsdf = node
            break
    if not bsdf:
        print(f"ERROR: No Principled BSDF found in '{target_mat.name}'")
        sys.exit(1)

    new_image = bpy.data.images.load(texture_path)

    inp = bsdf.inputs.get(bsdf_input_name)
    if not inp:
        print(f"ERROR: BSDF has no input named '{bsdf_input_name}'")
        sys.exit(1)

    if inp.is_linked:
        linked_node = inp.links[0].from_node
        if channel == "normal" and linked_node.type == "NORMAL_MAP":
            color_inp = linked_node.inputs.get("Color")
            if color_inp and color_inp.is_linked:
                tex_node = color_inp.links[0].from_node
                if tex_node.type == "TEX_IMAGE":
                    tex_node.image = new_image
                    print(f"SUCCESS: Replaced normal map texture in '{target_mat.name}'")
            else:
                tex_node = target_mat.node_tree.nodes.new("ShaderNodeTexImage")
                tex_node.image = new_image
                target_mat.node_tree.links.new(tex_node.outputs["Color"], color_inp)
                print(f"SUCCESS: Created new normal texture node in '{target_mat.name}'")
        elif linked_node.type == "TEX_IMAGE":
            linked_node.image = new_image
            print(f"SUCCESS: Replaced {channel} texture in '{target_mat.name}'")
        else:
            tex_node = target_mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex_node.image = new_image
            target_mat.node_tree.links.new(tex_node.outputs["Color"], inp)
            print(f"SUCCESS: Created new {channel} texture node in '{target_mat.name}'")
    else:
        tex_node = target_mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex_node.image = new_image
        if channel == "normal":
            normal_node = target_mat.node_tree.nodes.new("ShaderNodeNormalMap")
            target_mat.node_tree.links.new(tex_node.outputs["Color"], normal_node.inputs["Color"])
            target_mat.node_tree.links.new(normal_node.outputs["Normal"], inp)
        else:
            target_mat.node_tree.links.new(tex_node.outputs["Color"], inp)
        print(f"SUCCESS: Added new {channel} texture to '{target_mat.name}'")

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
    )

    print(f"SUCCESS: Exported GLB to {output_path}")


if __name__ == "__main__":
    main()
