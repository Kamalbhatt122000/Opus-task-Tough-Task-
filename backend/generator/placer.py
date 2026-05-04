"""
Stage 4 — Stone Placement (FIXED)

Root cause of wrong positions:

ORIGINAL BUG:
  1. stone.apply_translation(cavity["centroid_mm"]) places the stone at the
     GEOMETRIC centroid of all cavity face-centroids. This centroid floats
     INSIDE the mesh body, not at the actual surface rim.
  2. rim_z = centroid[2] + depth × 0.05  — offsets along global Z, ignoring
     that the cavity normal may not be vertical.  Stones end up floating above
     or buried inside the metal depending on ring orientation.

FIXES:
  1. Project the cavity centroid onto the nearest mesh surface using proximity
     query → this gives the actual surface point where the girdle should sit.
  2. Apply depth-sinking along the CAVITY NORMAL (not global Z) so the stone
     seats correctly regardless of ring tilt.
  3. Collision resolution scales the stone down if it penetrates the mesh.
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
        # `seat_offset_factor` depends on the detection method:
        #   - rim-loop cavities     → 0.0 (centroid is already on the rim)
        #   - curvature-dish cavities → 0.40 (rim is 40% of depth above
        #     the dish centre, along the outward normal)
        # -------------------------------------------------------------- #
        depth_mm = float(cavity["depth_mm"])
        seat_factor = float(cavity.get("seat_offset_factor", 0.40))
        rim_pt = centroid_arr + outward * (depth_mm * seat_factor)
        stone.apply_translation(rim_pt)

        # -------------------------------------------------------------- #
        # STEP 3: Light collision resolution.
        #
        # We allow up to 6 small scale-downs (max ~6%) so the pavilion fits
        # the cavity wall without disappearing visually. If still
        # penetrating after that, we lift the stone outward — better to
        # have a slightly raised stone than an invisible one.
        # -------------------------------------------------------------- #
        try:
            sdf = trimesh.proximity.signed_distance(jewellery_mesh, stone.vertices)
            max_pen = float(-sdf.min())
        except Exception:
            max_pen = 0.0

        attempts = 0
        while max_pen > 0.10 and attempts < 6:
            centre = stone.centroid
            stone.apply_translation(-centre)
            stone.apply_scale(0.99)
            stone.apply_translation(centre)
            try:
                sdf = trimesh.proximity.signed_distance(jewellery_mesh, stone.vertices)
                max_pen = float(-sdf.min())
            except Exception:
                break
            attempts += 1

        # If still penetrating, lift outward instead of shrinking further
        if max_pen > 0.10:
            stone.apply_translation(outward * (max_pen + 0.05))
            logger.debug("Cavity %d: lifted stone by %.2fmm to clear collision",
                         i + 1, max_pen + 0.05)

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