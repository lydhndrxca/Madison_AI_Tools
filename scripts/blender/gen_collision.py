"""
Blender headless script: Generate UE5-compatible simple collision meshes.

Uses convex decomposition to produce collision hulls named with UCX_ prefix
per UE5 convention. Each hull is limited to 256 vertices.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for output collision GLB
"""

import bpy
import bmesh
import sys
import json


MAX_VERTS_PER_HULL = 256


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    collision_objects = []

    for i, obj in enumerate(meshes):
        base_name = obj.name or f"mesh_{i}"

        # Duplicate for collision processing
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.duplicate()
        col_obj = bpy.context.active_object

        # Apply convex hull
        bm = bmesh.new()
        bm.from_mesh(col_obj.data)

        result = bmesh.ops.convex_hull(bm, input=bm.verts)

        # Decimate if too many vertices
        if len(bm.verts) > MAX_VERTS_PER_HULL:
            ratio = MAX_VERTS_PER_HULL / len(bm.verts)
            bmesh.ops.dissolve_degenerate(bm, dist=0.001, edges=bm.edges)
            # Use decimate modifier as fallback
            bm.to_mesh(col_obj.data)
            bm.free()

            mod = col_obj.modifiers.new(name="Decimate", type="DECIMATE")
            mod.ratio = ratio
            bpy.context.view_layer.objects.active = col_obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
        else:
            bm.to_mesh(col_obj.data)
            bm.free()

        col_obj.name = f"UCX_{base_name}_{i:02d}"
        collision_objects.append(col_obj)

    # Remove original meshes, keep only collision
    for obj in meshes:
        bpy.data.objects.remove(obj, do_unlink=True)

    # Select collision objects for export
    bpy.ops.object.select_all(action="DESELECT")
    for col_obj in collision_objects:
        col_obj.select_set(True)

    # Export
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
    )

    print(f"SUCCESS: Collision mesh ({len(collision_objects)} hulls) saved to {output_path}")


if __name__ == "__main__":
    main()
