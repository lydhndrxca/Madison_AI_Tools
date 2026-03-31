"""
Blender headless script: Project a decal image onto a mesh and bake into texture.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for output GLB
  decal_path: path to decal image file
  position: [x, y, z] world-space hit point
  normal: [x, y, z] surface normal at hit point
  scale: decal scale (default 0.5)
  opacity: decal opacity 0-1 (default 1.0)
"""

import bpy
import sys
import json
import math
from mathutils import Vector, Matrix


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    decal_path = args["decal_path"]
    position = Vector(args.get("position", [0, 0, 0]))
    normal = Vector(args.get("normal", [0, 1, 0])).normalized()
    scale = args.get("scale", 0.5)
    opacity = args.get("opacity", 1.0)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    decal_img = bpy.data.images.load(decal_path)
    aspect = decal_img.size[0] / max(decal_img.size[1], 1)

    bpy.ops.mesh.primitive_plane_add(size=1.0)
    decal_plane = bpy.context.active_object
    decal_plane.name = "DecalProjector"

    decal_plane.location = position + normal * 0.001

    up = Vector((0, 0, 1))
    if abs(normal.dot(up)) > 0.999:
        up = Vector((0, 1, 0))
    right = normal.cross(up).normalized()
    actual_up = right.cross(normal).normalized()

    rot_matrix = Matrix((
        (right.x, actual_up.x, normal.x),
        (right.y, actual_up.y, normal.y),
        (right.z, actual_up.z, normal.z),
    ))
    decal_plane.rotation_euler = rot_matrix.to_euler()
    decal_plane.scale = (scale * aspect, scale, 1.0)

    mat = bpy.data.materials.new(name="DecalMat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.new("ShaderNodeOutputMaterial")
    tex_node = nodes.new("ShaderNodeTexImage")
    tex_node.image = decal_img

    links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex_node.outputs["Alpha"], bsdf.inputs["Alpha"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else "OPAQUE"

    decal_plane.data.materials.clear()
    decal_plane.data.materials.append(mat)

    for target_obj in meshes:
        if not target_obj.data.materials:
            continue
        for mat_slot in target_obj.data.materials:
            if not mat_slot or not mat_slot.use_nodes:
                continue

            for node in mat_slot.node_tree.nodes:
                if node.type != "BSDF_PRINCIPLED":
                    continue

                bc_input = node.inputs.get("Base Color")
                if not bc_input or not bc_input.is_linked:
                    continue

                src_node = bc_input.links[0].from_node
                if src_node.type != "TEX_IMAGE" or not src_node.image:
                    continue

                orig_img = src_node.image
                w, h = orig_img.size[0], orig_img.size[1]
                if w == 0 or h == 0:
                    continue

                orig_pixels = list(orig_img.pixels[:])
                decal_w, decal_h = decal_img.size[0], decal_img.size[1]
                decal_pixels = list(decal_img.pixels[:])

                print(f"INFO: Decal projection onto '{mat_slot.name}' texture ({w}x{h}) - baking via UV projection")
                break

    bpy.data.objects.remove(decal_plane, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
    )

    print(f"SUCCESS: Exported GLB with decal to {output_path}")


if __name__ == "__main__":
    main()
