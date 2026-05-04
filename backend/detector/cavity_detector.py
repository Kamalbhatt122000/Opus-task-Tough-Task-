"""
Stage 2 — Cavity Detection.

Two complementary methods, run in this order:

  1. RIM-LOOP DETECTION (primary, for drilled-through holes / sharp seats).
     Finds closed cycles of edges with high dihedral angle (>50°) — these are
     the rims of cylindrical bores cut through the metal. Centroid of each
     loop is the stone seat; outward normal comes from a best-fit plane.

  2. CURVATURE-BASED DETECTION (fallback, for smooth bezel cups).
     For pieces with no sharp drilled holes (e.g. cast bezel pockets), look
     for concave faces in the bottom percentile of Gaussian curvature and
     cluster them with adaptive DBSCAN.

Through-drilled holes produce TWO rim loops (one per face of the metal); we
keep only the outer one using convex-hull proximity.

The cavity dict carries a `seat_offset_factor` field used by the placer:
  - rim cavities    → 0.0  (centroid is already at the rim plane)
  - curvature dish  → 0.40 (rim sits 40% of depth above the dish centre)
"""

import logging
from collections import defaultdict
from typing import List, Dict, Any

import numpy as np
import networkx as nx
from sklearn.cluster import DBSCAN
from scipy.spatial import ConvexHull

logger = logging.getLogger(__name__)


def detect_cavities(mesh) -> List[Dict[str, Any]]:
    logger.info("Cavity detection on mesh with %d vertices, %d faces",
                len(mesh.vertices), len(mesh.faces))

    rim_cavities = _detect_rim_loops(mesh)
    logger.info("Rim-loop detection: %d candidates", len(rim_cavities))

    if rim_cavities:
        # Filter to outer-surface rims only (drop inner-side duplicates of
        # through-holes).
        rim_cavities = _keep_outer_rims(mesh, rim_cavities)
        logger.info("After outer-rim filter: %d", len(rim_cavities))

    # Always run curvature detection too — covers bezel cups & accent seats
    curv_cavities = _detect_curvature_cavities(mesh)
    logger.info("Curvature detection: %d candidates", len(curv_cavities))

    # Combine and dedupe
    combined = rim_cavities + curv_cavities
    combined.sort(key=lambda x: x["confidence"], reverse=True)
    final = _nms(combined)
    logger.info("After NMS: %d", len(final))

    # Apply confidence threshold (looser for rim because they're geometric)
    threshold = 0.30
    final = [c for c in final if c["confidence"] >= threshold]
    logger.info("Final cavity count: %d", len(final))

    # Output
    final.sort(key=lambda x: x["confidence"], reverse=True)
    cavities: List[Dict[str, Any]] = []
    for idx, cav in enumerate(final):
        d = cav["diameter_mm"]
        dep = cav["depth_mm"]
        cavities.append({
            "id": idx + 1,
            "centroid_mm": cav["centroid_mm"],
            "normal": cav["normal"],
            "diameter_mm": round(d, 3),
            "depth_mm": round(dep, 3),
            "confidence": round(cav["confidence"], 3),
            "stone_cut": _assign_cut(d, dep),
            "stone_diameter_mm": round(d * 0.98, 3),
            "stone_height_mm": round(dep * 0.95, 3),
            "seat_offset_factor": float(cav.get("seat_offset_factor", 0.4)),
        })
    return cavities


# ======================================================================= #
# 1. Rim-loop detection
# ======================================================================= #

def _detect_rim_loops(mesh, angle_deg: float = 50.0,
                      min_loop_size: int = 5,
                      max_loop_size: int = 200) -> List[Dict[str, Any]]:
    """Find drilled-hole rims via cycles of sharp dihedral edges."""
    angles = mesh.face_adjacency_angles  # radians, length E_adj
    if len(angles) == 0:
        return []
    edges = mesh.face_adjacency_edges    # (E_adj, 2) vertex-pair per adjacency
    face_pairs = mesh.face_adjacency     # (E_adj, 2) face-pair per adjacency

    threshold_rad = np.deg2rad(angle_deg)
    sharp = angles > threshold_rad
    if not sharp.any():
        return []

    sharp_edges = edges[sharp]
    sharp_face_pairs = face_pairs[sharp]
    logger.info("Sharp edges (>%.0f°): %d / %d",
                angle_deg, int(sharp.sum()), len(angles))

    # Map each undirected edge → adjacent face pair, for normal computation
    edge_to_faces: Dict[tuple, tuple] = {}
    for (v0, v1), (f0, f1) in zip(sharp_edges, sharp_face_pairs):
        key = (min(int(v0), int(v1)), max(int(v0), int(v1)))
        edge_to_faces[key] = (int(f0), int(f1))

    G = nx.Graph()
    for v0, v1 in sharp_edges:
        G.add_edge(int(v0), int(v1))

    cycles = nx.cycle_basis(G)
    if not cycles:
        return []

    rims: List[Dict[str, Any]] = []
    for cycle in cycles:
        if not (min_loop_size <= len(cycle) <= max_loop_size):
            continue
        verts = mesh.vertices[cycle]
        centroid = verts.mean(axis=0)

        # Plane fit via SVD — smallest singular vector = plane normal
        centered = verts - centroid
        try:
            _, _, Vt = np.linalg.svd(centered, full_matrices=False)
        except np.linalg.LinAlgError:
            continue
        plane_normal = Vt[2]
        plane_normal /= np.linalg.norm(plane_normal) + 1e-9

        # Determine outward direction from adjacent face normals.
        # The two faces sharing each loop edge are inner-bore and outer-surface;
        # average them and pick the side with greater alignment to plane_normal.
        outer_normals = []
        for i in range(len(cycle)):
            v0 = int(cycle[i])
            v1 = int(cycle[(i + 1) % len(cycle)])
            key = (min(v0, v1), max(v0, v1))
            if key in edge_to_faces:
                f0, f1 = edge_to_faces[key]
                outer_normals.append(mesh.face_normals[f0])
                outer_normals.append(mesh.face_normals[f1])
        if not outer_normals:
            continue
        avg_n = np.mean(outer_normals, axis=0)
        avg_n /= np.linalg.norm(avg_n) + 1e-9
        if np.dot(plane_normal, avg_n) < 0:
            plane_normal = -plane_normal

        # Diameter = 2 × mean radius (in-plane)
        in_plane = centered - np.outer(centered @ plane_normal, plane_normal)
        radii = np.linalg.norm(in_plane, axis=1)
        diameter = float(2 * radii.mean())

        # Reject loops that are too elongated (probably not a circular hole)
        max_r = float(radii.max())
        if max_r > 2.5 * radii.mean():
            continue

        # Depth — raycast inward
        depth = _measure_depth(mesh, centroid, -plane_normal, diameter)

        rims.append({
            "centroid_mm": centroid.tolist(),
            "normal": (-plane_normal).tolist(),  # inward (placer flips)
            "diameter_mm": diameter,
            "depth_mm": depth,
            "confidence": 0.92,  # high — geometric structure is unambiguous
            "seat_offset_factor": 0.0,  # rim IS the seat
        })

    return rims


def _keep_outer_rims(mesh, rims: List[Dict[str, Any]],
                     hull_eps: float = 1.5) -> List[Dict[str, Any]]:
    """
    Drop rims that are NOT on the convex hull of the mesh.

    For a through-drilled hole, the outer rim is on the hull and the inner rim
    is recessed; this filters the inner one.
    """
    try:
        import trimesh
        hull = mesh.convex_hull
    except Exception as exc:
        logger.debug("Convex hull failed (%s) — skipping outer-rim filter", exc)
        return rims

    pts = np.array([c["centroid_mm"] for c in rims])
    try:
        _, dists, _ = trimesh.proximity.closest_point(hull, pts)
    except Exception as exc:
        logger.debug("Hull proximity failed (%s) — keeping all", exc)
        return rims

    return [c for c, d in zip(rims, dists) if d < hull_eps]


# ======================================================================= #
# 2. Curvature-based detection (fallback for bezel cups)
# ======================================================================= #

def _detect_curvature_cavities(mesh) -> List[Dict[str, Any]]:
    face_centroids = mesh.triangles_center
    face_normals = mesh.face_normals
    faces = mesh.faces

    curvature = _compute_gaussian_curvature(mesh)
    curvature = _laplacian_smooth(curvature, mesh, iterations=4, lam=0.5)

    p2, p98 = np.percentile(curvature, [2, 98])
    curvature_norm = np.clip(
        (curvature - p2) / (p98 - p2 + 1e-9) * 2 - 1, -1, 1
    )
    face_curvature = curvature_norm[faces].mean(axis=1)

    pct_threshold = float(np.percentile(face_curvature, 12))
    threshold = min(pct_threshold, -0.05)
    is_concave = face_curvature < threshold
    if int(is_concave.sum()) < 6:
        return []

    cand_centroids = face_centroids[is_concave]
    cand_normals = face_normals[is_concave]
    cand_curvs = np.abs(face_curvature[is_concave])

    bbox_diag = float(np.linalg.norm(mesh.bounding_box.extents))
    eps = float(np.clip(bbox_diag * 0.035, 0.6, 3.0))
    db = DBSCAN(eps=eps, min_samples=4).fit(cand_centroids)
    labels = db.labels_
    unique_labels = sorted(set(labels) - {-1})

    raw: List[Dict[str, Any]] = []
    for lbl in unique_labels:
        mask = labels == lbl
        pts = cand_centroids[mask]
        norms = cand_normals[mask]
        curvs = cand_curvs[mask]
        if len(pts) < 4:
            continue

        weights = curvs / (curvs.sum() + 1e-9)
        centroid = (pts * weights[:, None]).sum(axis=0)

        outward = (norms * weights[:, None]).sum(axis=0)
        outward_len = np.linalg.norm(outward)
        if outward_len < 1e-6:
            continue
        outward /= outward_len
        inward = -outward

        u = np.cross(inward, [1.0, 0.0, 0.0])
        if np.linalg.norm(u) < 0.1:
            u = np.cross(inward, [0.0, 1.0, 0.0])
        u /= np.linalg.norm(u)
        v = np.cross(inward, u)
        pts_local = np.column_stack([pts @ u, pts @ v])
        try:
            if len(pts_local) >= 3:
                hull = ConvexHull(pts_local)
                diameter = 2.0 * np.sqrt(hull.volume / np.pi)
            else:
                diameter = float(np.ptp(pts_local, axis=0).max())
        except Exception:
            diameter = float(np.ptp(pts_local, axis=0).max())

        depth = _measure_depth(mesh, centroid, inward, diameter)

        bbox_pts = np.ptp(pts, axis=0)
        long_axis = float(bbox_pts.max()) + 1e-9
        sorted_axes = np.sort(bbox_pts)
        short_axis = float(sorted_axes[1]) + 1e-9
        compactness = float(np.clip(
            1.0 - (long_axis / short_axis - 1.0) / 2.0, 0.0, 1.0
        ))
        curv_score = float(np.clip(curvs.mean() * 1.4, 0.0, 1.0))
        depth_score = float(np.clip(depth / (0.3 * diameter + 1e-9), 0.0, 1.0))
        confidence = 0.45 * curv_score + 0.30 * compactness + 0.25 * depth_score

        raw.append({
            "centroid_mm": centroid.tolist(),
            "normal": inward.tolist(),
            "diameter_mm": float(diameter),
            "depth_mm": float(depth),
            "confidence": float(confidence),
            "seat_offset_factor": 0.40,
        })

    return [c for c in raw
            if 0.4 <= c["diameter_mm"] <= 20.0
            and c["depth_mm"] >= max(0.05, 0.05 * c["diameter_mm"])]


# ======================================================================= #
# Helpers
# ======================================================================= #

def _nms(cavities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop overlapping cavities, keep the highest-confidence one."""
    cavities.sort(key=lambda x: x["confidence"], reverse=True)
    kept: List[Dict[str, Any]] = []
    for cand in cavities:
        cp = np.array(cand["centroid_mm"])
        suppressed = False
        for k in kept:
            kp = np.array(k["centroid_mm"])
            thresh = 0.7 * max(cand["diameter_mm"], k["diameter_mm"])
            if np.linalg.norm(cp - kp) < thresh:
                suppressed = True
                break
        if not suppressed:
            kept.append(cand)
    return kept


def _compute_gaussian_curvature(mesh) -> np.ndarray:
    n = len(mesh.vertices)
    angle_sum = np.zeros(n)
    mixed_area = np.zeros(n)
    verts = mesh.vertices

    for tri in mesh.faces:
        v0, v1, v2 = verts[tri[0]], verts[tri[1]], verts[tri[2]]
        e0 = v1 - v0
        e1 = v2 - v1
        e2 = v0 - v2
        l0 = np.linalg.norm(e0) + 1e-12
        l1 = np.linalg.norm(e1) + 1e-12
        l2 = np.linalg.norm(e2) + 1e-12
        a0 = np.arccos(np.clip(np.dot(e0, -e2) / (l0 * l2), -1, 1))
        a1 = np.arccos(np.clip(np.dot(e1, -e0) / (l1 * l0), -1, 1))
        a2 = np.arccos(np.clip(np.dot(e2, -e1) / (l2 * l1), -1, 1))
        angle_sum[tri[0]] += a0
        angle_sum[tri[1]] += a1
        angle_sum[tri[2]] += a2
        area = 0.5 * np.linalg.norm(np.cross(e0, -e2))
        mixed_area[tri[0]] += area / 3.0
        mixed_area[tri[1]] += area / 3.0
        mixed_area[tri[2]] += area / 3.0

    K = np.zeros(n)
    nz = mixed_area > 1e-12
    K[nz] = (2.0 * np.pi - angle_sum[nz]) / mixed_area[nz]
    return K


def _laplacian_smooth(values: np.ndarray, mesh, iterations: int = 3,
                      lam: float = 0.5) -> np.ndarray:
    adjacency: Dict[int, List[int]] = defaultdict(list)
    for tri in mesh.faces:
        for i in range(3):
            for j in range(3):
                if i != j:
                    adjacency[tri[i]].append(tri[j])

    result = values.copy()
    for _ in range(iterations):
        new = result.copy()
        for v, nbrs in adjacency.items():
            if nbrs:
                new[v] = (1 - lam) * result[v] + lam * np.mean(result[nbrs])
        result = new
    return result


def _measure_depth(mesh, centroid: np.ndarray, inward: np.ndarray,
                   diameter: float) -> float:
    try:
        ray_origin = centroid - inward * (diameter * 0.5)
        ray_dir = inward
        locs, _, _ = mesh.ray.intersects_location(
            ray_origins=[ray_origin],
            ray_directions=[ray_dir],
        )
        if len(locs) >= 2:
            dists = np.sort(np.linalg.norm(locs - ray_origin, axis=1))
            return float(dists[1] - dists[0])
        if len(locs) == 1:
            return float(np.linalg.norm(locs[0] - ray_origin))
        return diameter * 0.45
    except Exception as exc:
        logger.debug("Depth raycast failed: %s", exc)
        return diameter * 0.45


def _assign_cut(diameter: float, depth: float) -> str:
    ratio = depth / (diameter + 1e-9)
    if ratio > 0.7:
        return "princess"
    return "round_brilliant"
