"""
Blender headless script: Convert any supported 3D format to GLB.

Args (JSON via sys.argv after '--'):
  input: path to input file (extension determines importer)
  output: path for output GLB
  inputFormat: one of "obj", "fbx", "stl", "gltf", "glb", "blend"
"""

import bpy
import sys
import json
import mathutils
from pathlib import Path


def _import_obj(filepath):
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=filepath)
    else:
        bpy.ops.import_scene.obj(filepath=filepath)


def _import_fbx(filepath):
    bpy.ops.import_scene.fbx(
        filepath=filepath,
        use_custom_normals=True,
        use_image_search=True,
        force_connect_children=False,
        automatic_bone_orientation=True,
    )


def _import_blend(filepath):
    with bpy.data.libraries.load(filepath) as (data_from, data_to):
        data_to.objects = data_from.objects
    for obj in data_to.objects:
        if obj is not None:
            bpy.context.scene.collection.objects.link(obj)


IMPORTERS = {
    "obj": lambda p: _import_obj(p),
    "fbx": lambda p: _import_fbx(p),
    "stl": lambda p: bpy.ops.import_mesh.stl(filepath=p),
    "gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    "glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    "blend": lambda p: _import_blend(p),
}


def _apply_all_transforms():
    """Select all mesh objects and apply location/rotation/scale."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    if bpy.context.selected_objects:
        bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def _normalize_scene():
    """Center all meshes at origin and scale to a reasonable size for glTF (meters)."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        return

    import mathutils as mu

    bbox_min = mu.Vector((float("inf"),) * 3)
    bbox_max = mu.Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            world_pt = obj.matrix_world @ mu.Vector(corner)
            bbox_min.x = min(bbox_min.x, world_pt.x)
            bbox_min.y = min(bbox_min.y, world_pt.y)
            bbox_min.z = min(bbox_min.z, world_pt.z)
            bbox_max.x = max(bbox_max.x, world_pt.x)
            bbox_max.y = max(bbox_max.y, world_pt.y)
            bbox_max.z = max(bbox_max.z, world_pt.z)

    dims = bbox_max - bbox_min
    max_dim = max(dims.x, dims.y, dims.z)
    if max_dim < 0.001:
        return

    center = (bbox_min + bbox_max) / 2

    for obj in meshes:
        obj.location -= center

    print(f"INFO: Scene bounds {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f}, max_dim={max_dim:.2f}")


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    fmt = args.get("inputFormat", "").lower()

    if not fmt:
        fmt = Path(input_path).suffix.lstrip(".").lower()

    bpy.ops.wm.read_factory_settings(use_empty=True)

    importer = IMPORTERS.get(fmt)
    if not importer:
        print(f"ERROR: Unsupported format: {fmt}")
        sys.exit(1)

    importer(input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("WARNING: No mesh objects found, exporting empty scene")

    _apply_all_transforms()
    _normalize_scene()

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )

    print(f"SUCCESS: Converted to GLB at {output_path}")


if __name__ == "__main__":
    main()
