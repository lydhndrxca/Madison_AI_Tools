"""
Blender headless script: Render orthographic views of a model from 6 directions.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output_dir: directory to write rendered PNGs
  resolution: render resolution (default 1024)
  views: list of view names (default: front, back, left, right, top, bottom)
"""

import bpy
import sys
import json
import os
import math
from mathutils import Vector


VIEW_CAMERAS = {
    "front":  {"location": (0, -5, 0), "rotation": (math.pi / 2, 0, 0)},
    "back":   {"location": (0, 5, 0),  "rotation": (math.pi / 2, 0, math.pi)},
    "left":   {"location": (-5, 0, 0), "rotation": (math.pi / 2, 0, -math.pi / 2)},
    "right":  {"location": (5, 0, 0),  "rotation": (math.pi / 2, 0, math.pi / 2)},
    "top":    {"location": (0, 0, 5),  "rotation": (0, 0, 0)},
    "bottom": {"location": (0, 0, -5), "rotation": (math.pi, 0, 0)},
}


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_dir = args["output_dir"]
    resolution = args.get("resolution", 1024)
    views = args.get("views", list(VIEW_CAMERAS.keys()))

    os.makedirs(output_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    bbox_min = Vector((float("inf"),) * 3)
    bbox_max = Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            bbox_min.x = min(bbox_min.x, world.x)
            bbox_min.y = min(bbox_min.y, world.y)
            bbox_min.z = min(bbox_min.z, world.z)
            bbox_max.x = max(bbox_max.x, world.x)
            bbox_max.y = max(bbox_max.y, world.y)
            bbox_max.z = max(bbox_max.z, world.z)

    center = (bbox_min + bbox_max) / 2
    size = bbox_max - bbox_min
    max_dim = max(size.x, size.y, size.z)
    ortho_scale = max_dim * 1.2
    cam_distance = max_dim * 3

    bpy.ops.object.light_add(type="SUN", location=(3, -3, 5))
    sun = bpy.context.active_object
    sun.data.energy = 2.0

    bpy.context.scene.world = bpy.data.worlds.new("World")
    bpy.context.scene.world.use_nodes = True
    bg = bpy.context.scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.12, 0.12, 0.14, 1.0)
        bg.inputs["Strength"].default_value = 0.5

    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "BLENDER_EEVEE_NEXT") else "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = resolution
    bpy.context.scene.render.resolution_y = resolution
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.render.image_settings.file_format = "PNG"

    result = {"views": {}}

    for view_name in views:
        cam_info = VIEW_CAMERAS.get(view_name)
        if not cam_info:
            continue

        bpy.ops.object.camera_add()
        cam = bpy.context.active_object
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho_scale

        direction = Vector(cam_info["location"]).normalized()
        cam.location = center + direction * cam_distance
        cam.rotation_euler = cam_info["rotation"]

        bpy.context.scene.camera = cam

        filepath = os.path.join(output_dir, f"{view_name}.png")
        bpy.context.scene.render.filepath = filepath
        bpy.ops.render.render(write_still=True)

        result["views"][view_name] = filepath
        print(f"SUCCESS: Rendered {view_name} to {filepath}")

        bpy.data.objects.remove(cam, do_unlink=True)

    print("ORTHO_RESULT:" + json.dumps(result))


if __name__ == "__main__":
    main()
