"""
Stage 4 — Stone Placement.

Penetration detection uses trimesh.proximity.signed_distance, where the
convention is:
  - sdf > 0  → point is INSIDE the mesh body (penetrating the metal)
  - sdf < 0  → point is OUTSIDE the mesh body (in air, including cavity voids)

A correctly seated stone has its pavilion in the cavity void (sdf < 0); only
sdf.max() above 0 represents a real collision with the metal.
"""

import logging
import numpy as np
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def place_stones(jewellery_mesh, cavities: List[Dict], stones: List) -> Dict[str, Any]:
    """
    Place generated gemstone meshes into their corresponding cavities.

    Parameters
    ----------
    jewellery_mesh : trimesh.Trimesh
    cavities       : list of cavity dicts from detect_cavities()
    stones         : list of trimesh.Trimesh, one per cavity

    Returns
    -------
    dict with keys: composite_glb (bytes), stones_glb (bytes), placed_stones (list)
    """
    import trimesh

    placed_stones = []

    for i, (cavity, stone) in enumerate(zip(cavities, stones)):
        if stone is None:
            logger.warning("Stone %d is None, skipping", i)
            continue

        stone = stone.copy()

        centroid_arr = np.array(cavity["centroid_mm"], dtype=float)
        normal_arr = np.array(cavity["normal"], dtype=float)
        normal_len = np.linalg.norm(normal_arr)
        if normal_len < 1e-6:
            logger.warning("Cavity %d has zero normal, skipping", i)
            continue
        normal_arr /= normal_len

        # -------------------------------------------------------------- #
        # STEP 1: Align stone +Z (table direction) to cavity outward normal.
        # cavity["normal"] points INTO the mesh, so flip it to get outward.
        # -------------------------------------------------------------- #
        outward = -normal_arr
        gem_up = np.array([0.0, 0.0, 1.0])
        rotation = trimesh.geometry.align_vectors(gem_up, outward)
        stone.apply_transform(rotation)

        # -------------------------------------------------------------- #
        # STEP 2: Position stone so its girdle sits at the cavity rim.
        #
        # For rim-loop cavities the centroid is already on the rim plane.
        # For curvature-dish cavities the centroid lies inside the dish, so
        # we project it outward onto the mesh surface via raycast — that
        # surface hit is the true rim. If the raycast misses (degenerate
        # geometry), fall back to the seat_offset_factor heuristic.
        # -------------------------------------------------------------- #
        depth_mm = float(cavity["depth_mm"])
        seat_factor = float(cavity.get("seat_offset_factor", 0.40))

        rim_pt = centroid_arr + outward * (depth_mm * seat_factor)
        if seat_factor > 0.0:
            try:
                origins = (centroid_arr - outward * 1e-3).reshape(1, 3)
                directions = outward.reshape(1, 3)
                locs, _, _ = jewellery_mesh.ray.intersects_location(
                    ray_origins=origins,
                    ray_directions=directions,
                )
                if len(locs) > 0:
                    dists = np.linalg.norm(locs - centroid_arr, axis=1)
                    rim_pt = locs[int(np.argmin(dists))]
            except Exception as exc:
                logger.debug("Rim raycast failed for cavity %d: %s", i + 1, exc)

        stone.apply_translation(rim_pt)

        # -------------------------------------------------------------- #
        # STEP 3: Collision resolution.
        #
        # signed_distance returns POSITIVE for points inside the metal —
        # that is the only signal of a real collision. Pavilion vertices
        # sit in the cavity void (sdf < 0) and must NOT be flagged.
        # -------------------------------------------------------------- #
        def _max_penetration() -> float:
            try:
                sdf = trimesh.proximity.signed_distance(jewellery_mesh, stone.vertices)
                return float(max(0.0, sdf.max()))
            except Exception:
                return 0.0

        max_pen = _max_penetration()

        attempts = 0
        while max_pen > 0.05 and attempts < 4:
            centre = stone.centroid
            stone.apply_translation(-centre)
            stone.apply_scale(0.97)
            stone.apply_translation(centre)
            max_pen = _max_penetration()
            attempts += 1

        if max_pen > 0.05:
            lift = max_pen + 0.02
            stone.apply_translation(outward * lift)
            logger.debug("Cavity %d: lifted stone by %.2fmm to clear collision",
                         i + 1, lift)

        placed_stones.append(stone)
        logger.info("Placed stone %d at rim=(%s) outward=(%s)",
                    i + 1,
                    ", ".join(f"{x:.2f}" for x in rim_pt),
                    ", ".join(f"{x:.2f}" for x in outward))

    # -------------------------------------------------------------- #
    # Compose final scene
    # -------------------------------------------------------------- #
    composite = trimesh.Scene()
    composite.add_geometry(jewellery_mesh, node_name="jewellery")
    for idx, stone in enumerate(placed_stones):
        composite.add_geometry(stone, node_name=f"stone_{idx + 1}")

    stones_scene = trimesh.Scene()
    for idx, stone in enumerate(placed_stones):
        stones_scene.add_geometry(stone, node_name=f"stone_{idx + 1}")

    try:
        composite_glb = composite.export(file_type="glb")
    except Exception as exc:
        logger.error("Failed to export composite GLB: %s", exc)
        composite_glb = b""

    try:
        stones_glb = stones_scene.export(file_type="glb")
    except Exception as exc:
        logger.error("Failed to export stones GLB: %s", exc)
        stones_glb = b""

    return {
        "composite_glb": composite_glb,
        "stones_glb": stones_glb,
        "placed_stones": placed_stones,
    }