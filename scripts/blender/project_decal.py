"""
Blender headless script: Project a decal image onto a mesh texture via UV-space compositing.
Fully vectorized with numpy for speed.

Args (JSON via sys.argv after '--'):
  input: path to input GLB
  output: path for output GLB
  decal_path: path to decal image file (PNG with alpha)
  position: [x, y, z] world-space projection center
  normal: [x, y, z] projection direction
  scale: decal world-space size (default 0.5)
  opacity: decal opacity 0-1 (default 1.0)
"""

import bpy
import sys
import json
import time
import numpy as np
from mathutils import Vector


def _build_projection(position, normal, scale, aspect):
    up = Vector((0, 0, 1))
    if abs(normal.dot(up)) > 0.999:
        up = Vector((0, 1, 0))
    right_v = normal.cross(up).normalized()
    up_v = right_v.cross(normal).normalized()
    half_w = scale * aspect * 0.5
    half_h = scale * 0.5
    return (
        np.array(right_v, dtype=np.float64),
        np.array(up_v, dtype=np.float64),
        np.array(normal, dtype=np.float64),
        np.array(position, dtype=np.float64),
        half_w,
        half_h,
    )


def _composite_triangles(
    tri_world,      # (N_tri, 3, 3) world coords per triangle vertex
    tri_uvs,        # (N_tri, 3, 2) UV coords per triangle vertex
    tw, th,
    tex_pixels,     # (H, W, 4)
    decal_pixels,   # (H_d, W_d, 4)
    decal_w, decal_h,
    right, up_vec, fwd, center, half_w, half_h,
    depth_limit, opacity,
):
    """Composite decal onto texture for a batch of triangles."""
    n_tris = tri_world.shape[0]
    if n_tris == 0:
        return False

    modified = False

    for i in range(n_tris):
        v = tri_world[i]   # (3, 3)
        uv = tri_uvs[i]    # (3, 2)

        uv_px = np.empty((3, 2), dtype=np.float64)
        uv_px[:, 0] = uv[:, 0] * tw
        uv_px[:, 1] = (1.0 - uv[:, 1]) * th

        min_x = max(0, int(np.floor(uv_px[:, 0].min())))
        max_x = min(tw - 1, int(np.ceil(uv_px[:, 0].max())))
        min_y = max(0, int(np.floor(uv_px[:, 1].min())))
        max_y = min(th - 1, int(np.ceil(uv_px[:, 1].max())))

        if max_x <= min_x or max_y <= min_y:
            continue

        x0, y0 = uv_px[0]
        x1, y1 = uv_px[1]
        x2, y2 = uv_px[2]
        denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(denom) < 1e-10:
            continue

        xs = np.arange(min_x, max_x + 1, dtype=np.float64)
        ys = np.arange(min_y, max_y + 1, dtype=np.float64)
        gx, gy = np.meshgrid(xs, ys)

        w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / denom
        w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / denom
        w2 = 1.0 - w0 - w1

        inside = (w0 >= -0.001) & (w1 >= -0.001) & (w2 >= -0.001)
        if not np.any(inside):
            continue

        iy, ix = np.nonzero(inside)
        bw0 = w0[iy, ix]
        bw1 = w1[iy, ix]
        bw2 = w2[iy, ix]

        world_pts = bw0[:, None] * v[0] + bw1[:, None] * v[1] + bw2[:, None] * v[2]
        offsets = world_pts - center[None, :]
        u_proj = offsets @ right
        v_proj = offsets @ up_vec
        d_proj = offsets @ fwd

        in_bounds = (np.abs(u_proj) <= half_w) & (np.abs(v_proj) <= half_h) & (np.abs(d_proj) <= depth_limit)
        if not np.any(in_bounds):
            continue

        idx = np.nonzero(in_bounds)[0]
        du = u_proj[idx] / half_w * 0.5 + 0.5
        dv = v_proj[idx] / half_h * 0.5 + 0.5
        px_x = xs[ix[idx]].astype(np.intp)
        px_y = ys[iy[idx]].astype(np.intp)

        dpx = np.clip((du * (decal_w - 1)).astype(np.intp), 0, decal_w - 1)
        dpy = np.clip((dv * (decal_h - 1)).astype(np.intp), 0, decal_h - 1)
        sampled = decal_pixels[dpy, dpx]

        alpha = sampled[:, 3] * opacity
        vis = alpha >= 0.01
        if not np.any(vis):
            continue

        vi = np.nonzero(vis)[0]
        fx, fy, fa, fs = px_x[vi], px_y[vi], alpha[vi], sampled[vi]
        inv_a = 1.0 - fa

        tex_pixels[fy, fx, 0] = tex_pixels[fy, fx, 0] * inv_a + fs[:, 0] * fa
        tex_pixels[fy, fx, 1] = tex_pixels[fy, fx, 1] * inv_a + fs[:, 1] * fa
        tex_pixels[fy, fx, 2] = tex_pixels[fy, fx, 2] * inv_a + fs[:, 2] * fa
        tex_pixels[fy, fx, 3] = np.maximum(tex_pixels[fy, fx, 3], fa)
        modified = True

    return modified


def main():
    t0 = time.time()
    argv = sys.argv
    idx = argv.index("--") + 1
    args = json.loads(argv[idx])

    input_path = args["input"]
    output_path = args["output"]
    decal_path = args["decal_path"]
    position = Vector(args.get("position", [0, 0, 0]))
    normal = Vector(args.get("normal", [0, 0, 1])).normalized()
    scale = args.get("scale", 0.5)
    opacity = args.get("opacity", 1.0)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)
    print(f"TIMING: Import done in {time.time() - t0:.1f}s")

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("ERROR: No mesh objects found")
        sys.exit(1)

    decal_img = bpy.data.images.load(decal_path)
    decal_w, decal_h = decal_img.size[0], decal_img.size[1]
    decal_pixels = np.array(decal_img.pixels[:], dtype=np.float32).reshape(decal_h, decal_w, 4)
    decal_pixels = np.flipud(decal_pixels)

    aspect = decal_w / max(decal_h, 1)
    right, up_vec, fwd, center, half_w, half_h = _build_projection(position, normal, scale, aspect)
    depth_limit = scale * 2.0

    composited_any = False

    for obj in meshes:
        obj_matrix = obj.matrix_world
        mesh_data = obj.data
        if not mesh_data.uv_layers or not mesh_data.uv_layers.active:
            continue

        uv_layer = mesh_data.uv_layers.active

        n_verts = len(mesh_data.vertices)
        n_loops = len(mesh_data.loops)
        n_polys = len(mesh_data.polygons)

        co_local = np.empty(n_verts * 3, dtype=np.float64)
        mesh_data.vertices.foreach_get("co", co_local)
        co_local = co_local.reshape(n_verts, 3)

        mat_np = np.array(obj_matrix, dtype=np.float64)[:3, :]
        ones = np.ones((n_verts, 1), dtype=np.float64)
        co_world = np.hstack([co_local, ones]) @ mat_np.T

        loop_vert_idx = np.empty(n_loops, dtype=np.intp)
        mesh_data.loops.foreach_get("vertex_index", loop_vert_idx)

        uv_flat = np.empty(n_loops * 2, dtype=np.float64)
        uv_layer.data.foreach_get("uv", uv_flat)
        uvs_all = uv_flat.reshape(n_loops, 2)

        # Bulk-extract polygon data
        poly_loop_starts = np.empty(n_polys, dtype=np.intp)
        poly_loop_totals = np.empty(n_polys, dtype=np.intp)
        poly_mat_indices = np.empty(n_polys, dtype=np.intp)
        mesh_data.polygons.foreach_get("loop_start", poly_loop_starts)
        mesh_data.polygons.foreach_get("loop_total", poly_loop_totals)
        mesh_data.polygons.foreach_get("material_index", poly_mat_indices)

        # Quick rejection: check per-vertex which vertices are near the decal
        offsets = co_world - center[None, :]
        u_offs = offsets @ right
        v_offs = offsets @ up_vec
        d_offs = offsets @ fwd
        vert_near = (
            (np.abs(u_offs) <= half_w * 2.0)
            & (np.abs(v_offs) <= half_h * 2.0)
            & (np.abs(d_offs) <= depth_limit * 1.5)
        )

        print(f"TIMING: {obj.name}: {n_polys} polys, {np.sum(vert_near)}/{n_verts} verts near decal, prep in {time.time() - t0:.1f}s")

        for mat_idx, mat_slot in enumerate(obj.material_slots):
            mat = mat_slot.material
            if not mat or not mat.use_nodes or not mat.node_tree:
                continue

            tex_image = None
            bsdf_node = None
            for node in mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    bsdf_node = node
                    bc = node.inputs.get("Base Color")
                    if bc and bc.is_linked:
                        src = bc.links[0].from_node
                        if src.type == "TEX_IMAGE" and src.image:
                            tex_image = src.image
                    break

            if not tex_image and bsdf_node:
                bc_input = bsdf_node.inputs.get("Base Color")
                base_col = bc_input.default_value if bc_input else [0.8, 0.8, 0.8, 1.0]
                tex_res = 2048
                tex_image = bpy.data.images.new(
                    f"decal_base_{mat.name}", width=tex_res, height=tex_res, alpha=True
                )
                fill = np.tile(
                    np.array([base_col[0], base_col[1], base_col[2], 1.0], dtype=np.float32),
                    tex_res * tex_res,
                )
                tex_image.pixels.foreach_set(fill)
                tex_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
                tex_node.image = tex_image
                if bc_input:
                    mat.node_tree.links.new(tex_node.outputs["Color"], bc_input)
                print(f"INFO: Created {tex_res}x{tex_res} base texture for '{mat.name}'")

            if not tex_image:
                continue

            tw, th = tex_image.size[0], tex_image.size[1]
            if tw == 0 or th == 0:
                continue

            # Filter polygons: correct material AND at least one vertex near decal
            mat_mask = poly_mat_indices == mat_idx
            mat_poly_idx = np.nonzero(mat_mask)[0]
            if len(mat_poly_idx) == 0:
                continue

            # Build triangles from relevant polygons (fan triangulation)
            tri_worlds = []
            tri_uvs_list = []

            for pi in mat_poly_idx:
                ls = poly_loop_starts[pi]
                lt = poly_loop_totals[pi]
                loop_ids = np.arange(ls, ls + lt)
                vis = loop_vert_idx[loop_ids]

                # Skip polygon if no vertex is near the decal
                if not np.any(vert_near[vis]):
                    continue

                vw = co_world[vis]
                uv = uvs_all[loop_ids]

                for t in range(1, lt - 1):
                    tri_worlds.append(vw[[0, t, t + 1]])
                    tri_uvs_list.append(uv[[0, t, t + 1]])

            if not tri_worlds:
                continue

            tri_world_arr = np.array(tri_worlds, dtype=np.float64)
            tri_uvs_arr = np.array(tri_uvs_list, dtype=np.float64)

            print(f"TIMING: Material '{mat.name}': {len(tri_worlds)} tris to process, {time.time() - t0:.1f}s")

            tex_pixels = np.array(tex_image.pixels[:], dtype=np.float32).reshape(th, tw, 4)

            modified = _composite_triangles(
                tri_world_arr, tri_uvs_arr, tw, th, tex_pixels,
                decal_pixels, decal_w, decal_h,
                right, up_vec, fwd, center, half_w, half_h,
                depth_limit, opacity,
            )

            if modified:
                tex_image.pixels.foreach_set(tex_pixels.reshape(-1))
                tex_image.pack()
                composited_any = True
                print(f"SUCCESS: Composited decal onto '{mat.name}' ({tw}x{th}) in {time.time() - t0:.1f}s")

    if not composited_any:
        print("WARNING: Decal did not overlap any textured faces. Check position/normal/scale values.")

    t_export = time.time()
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
    )
    print(f"SUCCESS: Exported GLB to {output_path}")
    print(f"TIMING: Export in {time.time() - t_export:.1f}s, total {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
