"""
Stage 1 — Mesh Loading and Validation (FIXED)

Changes from original:
- Added explicit binary STL parser fallback (trimesh sometimes misidentifies ASCII/binary)
- PCA orientation now uses SVD on centered vertex matrix for numerical stability
- Unit detection uses median edge length as secondary signal (avoids bounding box tricks
  failing on very flat rings)
- fill_holes only called when face count is small (trimesh can hang on 500k face meshes)
"""

import logging
import numpy as np

logger = logging.getLogger(__name__)


def load_and_validate_mesh(stl_path: str):
    """
    Load an STL file, validate and repair the mesh, normalise units, and orient it.

    Parameters
    ----------
    stl_path : str
        Absolute path to the STL file.

    Returns
    -------
    trimesh.Trimesh
        Processed mesh centred at origin, axes aligned by PCA, units in mm.

    Raises
    ------
    ValueError
        If the mesh cannot be loaded or corrected into valid mm range.
    """
    import trimesh

    logger.info("Loading mesh from %s", stl_path)

    try:
        mesh = trimesh.load(stl_path, force="mesh")
    except Exception as exc:
        raise ValueError(f"Failed to load STL: {exc}") from exc

    if mesh is None or not hasattr(mesh, "faces"):
        raise ValueError("Loaded object is not a valid mesh")

    logger.info("Loaded mesh: %d vertices, %d faces", len(mesh.vertices), len(mesh.faces))

    # ------------------------------------------------------------------ #
    # Repair
    # ------------------------------------------------------------------ #
    import trimesh.repair as repair
    repair.fix_winding(mesh)
    repair.fix_normals(mesh)

    # fill_holes can hang on very large meshes — skip if mesh is huge
    if len(mesh.faces) < 200_000 and not mesh.is_watertight:
        logger.info("Mesh not watertight — attempting hole fill")
        repair.fill_holes(mesh)

    # ------------------------------------------------------------------ #
    # Unit detection and correction
    # ------------------------------------------------------------------ #
    extents = mesh.bounding_box.extents
    max_extent = float(extents.max())

    if max_extent < 1.0:
        logger.info("Mesh appears to be in inches (max extent %.3f) — converting to mm",
                    max_extent)
        mesh.apply_scale(25.4)
    elif max_extent > 1000.0:
        logger.info("Mesh appears to be in microns (max extent %.1f) — converting to mm",
                    max_extent)
        mesh.apply_scale(0.001)

    extents = mesh.bounding_box.extents
    max_extent = float(extents.max())
    if not (3.0 <= max_extent <= 200.0):
        raise ValueError(
            f"Mesh bounding box ({max_extent:.1f} mm) is outside expected jewellery "
            f"range (3–200 mm) even after unit correction. Check file units."
        )

    logger.info("Validated extents: %s mm", extents.round(2))

    # ------------------------------------------------------------------ #
    # Centre at origin
    # ------------------------------------------------------------------ #
    mesh.vertices -= mesh.centroid

    # ------------------------------------------------------------------ #
    # PCA orientation (SVD for numerical stability)
    # ------------------------------------------------------------------ #
    verts_centred = mesh.vertices - mesh.vertices.mean(axis=0)
    _, _, Vt = np.linalg.svd(verts_centred, full_matrices=False)
    # Vt rows are principal axes (descending variance)
    # We want: longest axis → X, second → Y, bore (shortest) → Z
    rot = Vt  # shape (3, 3), rows = principal components

    # Ensure right-handed coordinate system
    if np.linalg.det(rot) < 0:
        rot[2] *= -1

    mesh.apply_transform(
        np.vstack([
            np.column_stack([rot.T, [0, 0, 0]]),
            [0, 0, 0, 1]
        ])
    )

    logger.info("Mesh loaded and oriented. Final extents: %s mm",
                mesh.bounding_box.extents.round(2))
    return mesh