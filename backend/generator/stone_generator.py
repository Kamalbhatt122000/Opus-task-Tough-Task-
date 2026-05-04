"""
Stage 3 — Gemstone Generation.

Generates parametric gemstone meshes (round brilliant, princess, oval,
marquise, emerald) sized to fit each detected cavity.
"""

import logging
from typing import List, Dict, Any

import numpy as np
import trimesh

logger = logging.getLogger(__name__)


def generate_stones(
    cavities: List[Dict[str, Any]],
    stone_type: str = "round_brilliant",
) -> List[trimesh.Trimesh]:
    """Generate one gemstone mesh per cavity.

    Parameters
    ----------
    cavities : list[dict]
        Cavity dicts from Stage 2.
    stone_type : str
        One of round_brilliant, princess, oval, marquise, emerald.

    Returns
    -------
    list[trimesh.Trimesh]
        Gemstone meshes in cavity-ID order, centred at origin.
    """
    builders = {
        "round_brilliant": _round_brilliant,
        "princess": _princess,
        "oval": _oval,
        "marquise": _marquise,
        "emerald": _emerald_cut,
    }
    builder = builders.get(stone_type, _round_brilliant)

    stones = []
    for cav in cavities:
        d = cav["diameter_mm"] * 0.96
        h = cav["depth_mm"] * 0.92
        h = max(h, d * 0.25)  # ensure minimum height
        gem = builder(d, h)
        cav["stone_cut"] = stone_type
        cav["stone_diameter_mm"] = float(d)
        cav["stone_height_mm"] = float(h)
        stones.append(gem)
        logger.info("Stone %d: %s d=%.2f h=%.2f", cav["id"], stone_type, d, h)

    return stones


# ------------------------------------------------------------------
# Round Brilliant
# ------------------------------------------------------------------

def _round_brilliant(diameter: float, height: float) -> trimesh.Trimesh:
    R = diameter / 2
    table_ratio = 0.57
    crown_h = height * 0.35
    pav_h = height * 0.65
    n_girdle = 32
    n_table = 16

    verts = []
    faces = []

    # Girdle ring at z=0
    girdle = []
    for i in range(n_girdle):
        a = 2 * np.pi * i / n_girdle
        girdle.append([R * np.cos(a), R * np.sin(a), 0])
    g_start = len(verts)
    verts.extend(girdle)

    # Table ring at z=crown_h
    table = []
    tr = R * table_ratio
    for i in range(n_table):
        a = 2 * np.pi * i / n_table
        table.append([tr * np.cos(a), tr * np.sin(a), crown_h])
    t_start = len(verts)
    verts.extend(table)

    # Culet at z=-pav_h
    culet_idx = len(verts)
    verts.append([0, 0, -pav_h])

    # Crown faces: connect table to girdle
    g_per_t = n_girdle // n_table
    for i in range(n_table):
        t0 = t_start + i
        t1 = t_start + (i + 1) % n_table
        for j in range(g_per_t):
            g0 = g_start + (i * g_per_t + j) % n_girdle
            g1 = g_start + (i * g_per_t + j + 1) % n_girdle
            faces.append([t0, g0, g1])
            if j == g_per_t - 1:
                faces.append([t0, g1, t1])

    # Pavilion faces: girdle to culet
    for i in range(n_girdle):
        g0 = g_start + i
        g1 = g_start + (i + 1) % n_girdle
        faces.append([g0, culet_idx, g1])

    # Table top
    for i in range(n_table - 2):
        faces.append([t_start, t_start + i + 1, t_start + i + 2])

    return _finalize(verts, faces)


# ------------------------------------------------------------------
# Princess Cut
# ------------------------------------------------------------------

def _princess(diameter: float, height: float) -> trimesh.Trimesh:
    s = diameter / np.sqrt(2)
    ts = s * 0.95
    crown_h = height * 0.35
    pav_h = height * 0.65
    half = s / 2
    th = ts / 2

    verts = [
        [-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0],  # girdle
        [-th, -th, crown_h], [th, -th, crown_h], [th, th, crown_h], [-th, th, crown_h],  # table
        [0, 0, -pav_h],  # culet
    ]
    faces = [
        # Crown
        [4, 0, 1], [4, 1, 5], [5, 1, 2], [5, 2, 6],
        [6, 2, 3], [6, 3, 7], [7, 3, 0], [7, 0, 4],
        # Table
        [4, 5, 6], [4, 6, 7],
        # Pavilion
        [0, 8, 1], [1, 8, 2], [2, 8, 3], [3, 8, 0],
    ]
    return _finalize(verts, faces)


# ------------------------------------------------------------------
# Oval
# ------------------------------------------------------------------

def _oval(diameter: float, height: float) -> trimesh.Trimesh:
    rx = diameter / 2
    ry = diameter * 0.65 / 2
    crown_h = height * 0.35
    pav_h = height * 0.65
    n = 32

    verts, faces = [], []
    # Girdle
    g_start = 0
    for i in range(n):
        a = 2 * np.pi * i / n
        verts.append([rx * np.cos(a), ry * np.sin(a), 0])
    # Table
    t_start = len(verts)
    trx, try_ = rx * 0.57, ry * 0.57
    nt = 16
    for i in range(nt):
        a = 2 * np.pi * i / nt
        verts.append([trx * np.cos(a), try_ * np.sin(a), crown_h])
    culet = len(verts)
    verts.append([0, 0, -pav_h])

    gpt = n // nt
    for i in range(nt):
        t0, t1 = t_start + i, t_start + (i + 1) % nt
        for j in range(gpt):
            g0 = g_start + (i * gpt + j) % n
            g1 = g_start + (i * gpt + j + 1) % n
            faces.append([t0, g0, g1])
            if j == gpt - 1:
                faces.append([t0, g1, t1])
    for i in range(n):
        faces.append([g_start + i, culet, g_start + (i + 1) % n])
    for i in range(nt - 2):
        faces.append([t_start, t_start + i + 1, t_start + i + 2])

    return _finalize(verts, faces)


# ------------------------------------------------------------------
# Marquise
# ------------------------------------------------------------------

def _marquise(diameter: float, height: float) -> trimesh.Trimesh:
    rx = diameter / 2
    ry = diameter * 0.45 / 2
    crown_h = height * 0.35
    pav_h = height * 0.65
    n = 32

    verts, faces = [], []
    g_start = 0
    for i in range(n):
        a = 2 * np.pi * i / n
        verts.append([rx * np.cos(a), ry * np.sin(a), 0])
    t_start = len(verts)
    nt = 16
    for i in range(nt):
        a = 2 * np.pi * i / nt
        verts.append([rx * 0.5 * np.cos(a), ry * 0.5 * np.sin(a), crown_h])
    culet = len(verts)
    verts.append([0, 0, -pav_h])

    gpt = n // nt
    for i in range(nt):
        t0, t1 = t_start + i, t_start + (i + 1) % nt
        for j in range(gpt):
            g0 = g_start + (i * gpt + j) % n
            g1 = g_start + (i * gpt + j + 1) % n
            faces.append([t0, g0, g1])
            if j == gpt - 1:
                faces.append([t0, g1, t1])
    for i in range(n):
        faces.append([g_start + i, culet, g_start + (i + 1) % n])
    for i in range(nt - 2):
        faces.append([t_start, t_start + i + 1, t_start + i + 2])

    return _finalize(verts, faces)


# ------------------------------------------------------------------
# Emerald Cut
# ------------------------------------------------------------------

def _emerald_cut(diameter: float, height: float) -> trimesh.Trimesh:
    s = diameter / np.sqrt(2)
    c = 0.15 * s  # corner truncation
    crown_h = height * 0.35
    pav_h = height * 0.65
    h = s / 2

    def octagon(scale, z):
        hs = h * scale
        cs = c * scale
        return [
            [hs, hs - cs, z], [hs, -(hs - cs), z],
            [hs - cs, -hs, z], [-(hs - cs), -hs, z],
            [-hs, -(hs - cs), z], [-hs, hs - cs, z],
            [-(hs - cs), hs, z], [hs - cs, hs, z],
        ]

    verts = octagon(1.0, 0)  # 0-7 girdle
    verts += octagon(0.8, crown_h * 0.5)  # 8-15 crown step
    verts += octagon(0.6, crown_h)  # 16-23 table
    verts += octagon(0.8, -pav_h * 0.5)  # 24-31 pavilion step
    culet = len(verts)
    verts.append([0, 0, -pav_h])

    faces = []
    no = 8
    for i in range(no):
        j = (i + 1) % no
        # girdle to crown step
        faces.append([i, j, 8 + j]); faces.append([i, 8 + j, 8 + i])
        # crown step to table
        faces.append([8 + i, 8 + j, 16 + j]); faces.append([8 + i, 16 + j, 16 + i])
        # girdle to pavilion step
        faces.append([i, 24 + i, 24 + j]); faces.append([i, 24 + j, j])
        # pavilion step to culet
        faces.append([24 + i, culet, 24 + j])
    # table top
    for i in range(no - 2):
        faces.append([16, 16 + i + 1, 16 + i + 2])

    return _finalize(verts, faces)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _finalize(verts, faces) -> trimesh.Trimesh:
    mesh = trimesh.Trimesh(vertices=np.array(verts, dtype=np.float64),
                           faces=np.array(faces, dtype=np.int64))
    trimesh.repair.fix_normals(mesh)
    return mesh
