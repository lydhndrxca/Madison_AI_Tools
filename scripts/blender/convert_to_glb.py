"""
Blender headless script: Convert any supported 3D format to GLB.

Args (JSON via sys.argv after '--'):
  input:        path to input file (extension determines importer)
  output:       path for output GLB
  inputFormat:  one of "obj", "fbx", "stl", "gltf", "glb", "blend"
  joinMeshes:   (bool, default True) join meshes that share a material
  stripAnim:    (bool, default True) remove all animation data
  textureDir:   (str, optional) folder with textures to link before export
"""

import bpy
import sys
import json
import os
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


def _flatten_hierarchy():
    """Unparent all mesh objects (keeping world transform) and delete non-mesh objects."""
    bpy.ops.object.select_all(action="DESELECT")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in meshes:
        obj.select_set(True)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.select_all(action="DESELECT")

    non_mesh = [o for o in bpy.context.scene.objects if o.type != "MESH"]
    for obj in non_mesh:
        bpy.data.objects.remove(obj, do_unlink=True)
    print(f"INFO: Flattened hierarchy — {len(meshes)} meshes kept, {len(non_mesh)} non-mesh objects removed")


def _apply_all_transforms():
    """Select all mesh objects and apply location/rotation/scale."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    if bpy.context.selected_objects:
        bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def _remove_ground_planes():
    """Remove degenerate flat meshes (ground planes, shadow catchers)."""
    import mathutils as mu
    to_delete = []
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) <= 1:
        return

    scene_min = mu.Vector((float("inf"),) * 3)
    scene_max = mu.Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            wp = obj.matrix_world @ mu.Vector(corner)
            scene_min.x = min(scene_min.x, wp.x)
            scene_min.y = min(scene_min.y, wp.y)
            scene_min.z = min(scene_min.z, wp.z)
            scene_max.x = max(scene_max.x, wp.x)
            scene_max.y = max(scene_max.y, wp.y)
            scene_max.z = max(scene_max.z, wp.z)
    scene_dims = scene_max - scene_min
    scene_max_dim = max(scene_dims.x, scene_dims.y, scene_dims.z)

    for obj in meshes:
        bbox_corners = [obj.matrix_world @ mu.Vector(c) for c in obj.bound_box]
        xs = [c.x for c in bbox_corners]
        ys = [c.y for c in bbox_corners]
        zs = [c.z for c in bbox_corners]
        dx = max(xs) - min(xs)
        dy = max(ys) - min(ys)
        dz = max(zs) - min(zs)
        dims = sorted([dx, dy, dz])

        is_flat = False
        if dims[0] < 1e-6 and dims[2] > 0.001:
            is_flat = True
        elif dims[2] > 0.001 and dims[0] / dims[2] < 0.005:
            is_flat = True

        verts = len(obj.data.vertices)
        if verts <= 25 and dims[2] > 0 and max(dx, dy, dz) > scene_max_dim * 0.5:
            is_flat = True

        if is_flat:
            to_delete.append(obj)

    if len(to_delete) >= len(meshes):
        return

    for obj in to_delete:
        print(f"INFO: Removing ground plane: {obj.name} ({len(obj.data.vertices)} verts)")
        bpy.data.objects.remove(obj, do_unlink=True)


def _remove_construction_geometry():
    """Remove meshes that are disproportionately large (construction/reference geometry).

    Uses the mesh with the most vertices as the "main body" reference.
    Any mesh whose max dimension exceeds 1.4x the main body's max dimension
    is considered construction geometry and removed.
    """
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) <= 2:
        return

    mesh_info = []
    for obj in meshes:
        verts = obj.data.vertices
        if not verts:
            mesh_info.append((obj, 0.0, 0))
            continue
        ws = [obj.matrix_world @ v.co for v in verts]
        xs = [v.x for v in ws]
        ys = [v.y for v in ws]
        zs = [v.z for v in ws]
        max_dim = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
        mesh_info.append((obj, max_dim, len(verts)))

    mesh_info.sort(key=lambda x: x[2], reverse=True)
    ref_dim = mesh_info[0][1]
    if ref_dim < 1e-9:
        return

    threshold = ref_dim * 1.4

    to_delete = []
    for obj, max_dim, vert_count in mesh_info:
        if max_dim > threshold:
            to_delete.append((obj, max_dim, vert_count))

    if len(to_delete) >= len(mesh_info):
        return

    for obj, max_dim, vert_count in to_delete:
        print(
            f"INFO: Removing construction geometry: {obj.name} "
            f"(max_dim={max_dim:.6f} > threshold={threshold:.6f}, verts={vert_count})"
        )
        bpy.data.objects.remove(obj, do_unlink=True)


def _strip_animations():
    """Remove all animation data from the scene."""
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for obj in bpy.context.scene.objects:
        if obj.animation_data:
            obj.animation_data_clear()
    if bpy.context.scene.animation_data:
        bpy.context.scene.animation_data_clear()
    print("INFO: Stripped all animation data")


def _join_meshes_by_material():
    """Join mesh objects that share the same material into single objects."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) <= 1:
        return

    mat_groups = {}
    no_mat = []
    for obj in meshes:
        if obj.data.materials:
            mat_names = tuple(sorted(set(m.name for m in obj.data.materials if m)))
            if mat_names:
                mat_groups.setdefault(mat_names, []).append(obj)
            else:
                no_mat.append(obj)
        else:
            no_mat.append(obj)

    for mat_names, objs in mat_groups.items():
        if len(objs) <= 1:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        label = ", ".join(mat_names)
        print(f"INFO: Joined {len(objs)} meshes for material(s): {label}")

    if no_mat and len(no_mat) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in no_mat:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = no_mat[0]
        bpy.ops.object.join()
        print(f"INFO: Joined {len(no_mat)} meshes with no material")

    final_count = len([o for o in bpy.context.scene.objects if o.type == "MESH"])
    print(f"INFO: Mesh count reduced: {len(meshes)} -> {final_count}")


def _resolve_missing_textures(texture_dir):
    """Relink images whose files are missing by searching texture_dir."""
    if not texture_dir or not os.path.isdir(texture_dir):
        return
    available = {}
    for fn in os.listdir(texture_dir):
        available[fn.lower()] = os.path.join(texture_dir, fn)

    relinked = 0
    for img in bpy.data.images:
        if img.packed_file:
            continue
        current = img.filepath_raw or img.filepath or ""
        if current and os.path.isfile(bpy.path.abspath(current)):
            continue
        basename = os.path.basename(current).lower() if current else img.name.lower()
        if basename in available:
            img.filepath = available[basename]
            img.reload()
            relinked += 1
            print(f"INFO: Relinked texture: {img.name} -> {available[basename]}")
    if relinked:
        print(f"INFO: Relinked {relinked} textures from {texture_dir}")


def _normalize_scene():
    """Center the whole scene at origin. Operates on geometry data directly."""
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

    # Re-apply transforms so the offset is baked into geometry
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    print(f"INFO: Scene bounds {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f}, centered at origin")


def main():
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    fmt = args.get("inputFormat", "").lower()
    join_meshes = args.get("joinMeshes", True)
    strip_anim = args.get("stripAnim", True)
    texture_dir = args.get("textureDir", "")

    if not fmt:
        fmt = Path(input_path).suffix.lstrip(".").lower()

    bpy.ops.wm.read_factory_settings(use_empty=True)

    importer = IMPORTERS.get(fmt)
    if not importer:
        print(f"ERROR: Unsupported format: {fmt}")
        sys.exit(1)

    importer(input_path)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"INFO: Imported {len(meshes)} mesh objects")
    if not meshes:
        print("WARNING: No mesh objects found, exporting empty scene")

    if strip_anim:
        _strip_animations()

    # Flatten parent-child hierarchy FIRST — this preserves world transforms
    # while removing Empty/Armature parents that FBX imports create
    _flatten_hierarchy()

    # Now apply all transforms (loc+rot+scale) to bake world positions into geometry
    _apply_all_transforms()

    _remove_ground_planes()
    _remove_construction_geometry()

    if texture_dir:
        _resolve_missing_textures(texture_dir)

    if join_meshes:
        _join_meshes_by_material()

    _normalize_scene()

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )

    final_meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    mats = set()
    for obj in final_meshes:
        for m in obj.data.materials:
            if m:
                mats.add(m.name)
    print(f"SUCCESS: Exported GLB with {len(final_meshes)} meshes, {len(mats)} materials")
    print(f"SUCCESS: Output at {output_path}")


if __name__ == "__main__":
    main()
