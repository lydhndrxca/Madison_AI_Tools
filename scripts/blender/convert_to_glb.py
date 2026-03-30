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
from pathlib import Path


IMPORTERS = {
    "obj": lambda p: _import_obj(p),
    "fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p),
    "stl": lambda p: bpy.ops.import_mesh.stl(filepath=p),
    "gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    "glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    "blend": lambda p: _import_blend(p),
}


def _import_obj(filepath):
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=filepath)
    else:
        bpy.ops.import_scene.obj(filepath=filepath)


def _import_blend(filepath):
    with bpy.data.libraries.load(filepath) as (data_from, data_to):
        data_to.objects = data_from.objects
    for obj in data_to.objects:
        if obj is not None:
            bpy.context.scene.collection.objects.link(obj)


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

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
    )

    print(f"SUCCESS: Converted to GLB at {output_path}")


if __name__ == "__main__":
    main()
