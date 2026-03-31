"""
Blender headless script: Import an FBX, join all meshes into one object, export as FBX.

Args (JSON via sys.argv after '--'):
  input:  path to input FBX
  output: path for output FBX
"""

import bpy
import sys
import json


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    raw = argv[idx]
    if raw.endswith(".json"):
        with open(raw) as f:
            args = json.load(f)
    else:
        args = json.loads(raw)

    input_path = args["input"]
    output_path = args["output"]

    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.import_scene.fbx(
        filepath=input_path,
        use_custom_normals=True,
        use_image_search=True,
    )

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"INFO: Found {len(meshes)} mesh objects")

    if not meshes:
        print("ERROR: No meshes found in file")
        sys.exit(1)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    bpy.ops.object.join()

    joined = bpy.context.active_object
    joined.name = "C-130_Combined"
    print(f"INFO: Joined into '{joined.name}' — {len(joined.data.vertices)} verts, {len(joined.data.polygons)} faces")

    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    bpy.ops.export_scene.fbx(
        filepath=output_path,
        use_selection=True,
        apply_scale_options="FBX_SCALE_ALL",
        bake_space_transform=True,
    )

    print(f"SUCCESS: Combined FBX saved to {output_path}")


if __name__ == "__main__":
    main()
