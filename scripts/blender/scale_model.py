"""
Blender headless script: Scale a GLB model to target UE5 dimensions.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for output GLB
  targetHeight: target height in UE units (cm)
  targetWidth: target width in UE units (cm) — optional
  targetDepth: target depth in UE units (cm) — optional

If only targetHeight is given, uniform scaling is applied.
If all three are given, per-axis scaling is applied.
"""

import bpy
import sys
import json


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    target_h = float(args["targetHeight"]) / 100.0  # UU to meters
    target_w = float(args.get("targetWidth", 0)) / 100.0
    target_d = float(args.get("targetDepth", 0)) / 100.0

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=input_path)

    # Get all mesh objects
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found in GLB")
        sys.exit(1)

    # Compute combined bounding box
    min_co = [float("inf")] * 3
    max_co = [float("-inf")] * 3
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ bpy.mathutils.Vector(corner) if hasattr(bpy, 'mathutils') else obj.matrix_world @ __import__('mathutils').Vector(corner)
            for i in range(3):
                min_co[i] = min(min_co[i], world[i])
                max_co[i] = max(max_co[i], world[i])

    size = [max_co[i] - min_co[i] for i in range(3)]

    if target_w > 0 and target_d > 0:
        # Per-axis scaling
        sx = target_w / max(size[0], 0.001)
        sy = target_d / max(size[1], 0.001)
        sz = target_h / max(size[2], 0.001)
        for obj in meshes:
            obj.scale = (obj.scale[0] * sx, obj.scale[1] * sy, obj.scale[2] * sz)
    else:
        # Uniform scaling based on height (Z-axis in Blender)
        current_h = max(size[2], 0.001)
        scale = target_h / current_h
        for obj in meshes:
            obj.scale = tuple(s * scale for s in obj.scale)

    # Apply transforms
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Export GLB
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
    )

    print(f"SUCCESS: Scaled model saved to {output_path}")


if __name__ == "__main__":
    main()
