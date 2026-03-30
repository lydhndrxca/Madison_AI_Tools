"""
Blender headless script: Scale a specific surface region to a target height.

Selects faces by index, computes their bounding box, and scales the region
to match the target height while preserving the rest of the model.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for output GLB
  faceIndices: list of face indices to select
  targetHeight: target height for the selected region in UE units (cm)
"""

import bpy
import bmesh
import sys
import json
from mathutils import Vector


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    face_indices = set(args["faceIndices"])
    target_h = float(args["targetHeight"]) / 100.0  # UU to meters

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    # Work on the first mesh (combined)
    obj = meshes[0]
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")

    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    # Select target faces
    selected_verts = set()
    for fi in face_indices:
        if fi < len(bm.faces):
            face = bm.faces[fi]
            face.select = True
            for v in face.verts:
                selected_verts.add(v.index)

    if not selected_verts:
        print("WARNING: No valid faces selected, exporting unchanged model")
        bpy.ops.object.mode_set(mode="OBJECT")
    else:
        # Compute bounding box of selected vertices
        sel_verts = [bm.verts[vi] for vi in selected_verts]
        min_z = min(v.co.z for v in sel_verts)
        max_z = max(v.co.z for v in sel_verts)
        current_h = max(max_z - min_z, 0.001)

        scale_factor = target_h / current_h

        # Scale selected vertices along Z axis from their center
        center_z = (min_z + max_z) / 2.0
        for v in sel_verts:
            v.co.z = center_z + (v.co.z - center_z) * scale_factor

        bmesh.update_edit_mesh(obj.data)
        bpy.ops.object.mode_set(mode="OBJECT")

    # Export
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
    )

    print(f"SUCCESS: Surface-scaled model saved to {output_path}")


if __name__ == "__main__":
    main()
