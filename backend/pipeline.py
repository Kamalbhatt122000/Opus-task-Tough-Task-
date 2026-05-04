"""
pipeline.py — Orchestrates all 4 stages and emits SSE progress events.

Key changes from original spec:
- pyrender dependency removed (was killing the process on headless servers
  and its cross-view depth check discarded valid cavities — see cavity_detector.py)
- Explicit error serialisation so frontend sees structured error events
- session_store keyed by session_id for /api/regenerate support
"""

import base64
import json
import logging
import time
import uuid
from typing import Generator

logger = logging.getLogger(__name__)

# In-memory session store: {session_id: {mesh, cavities, stone_type, stone_material}}
_sessions: dict = {}


def get_session(session_id: str) -> dict | None:
    return _sessions.get(session_id)


def _sse(stage: int, status: str, message: str, data=None) -> str:
    payload = {"stage": stage, "status": status, "message": message, "data": data}
    return f"data: {json.dumps(payload)}\n\n"


def run_pipeline(stl_path: str, filename: str,
                 stone_type: str = "round_brilliant",
                 stone_material: str = "Diamond") -> Generator[str, None, None]:
    """
    Generator that yields SSE strings for each pipeline stage.

    Final yield contains the complete response JSON in data.
    """
    session_id = str(uuid.uuid4())
    t_total_start = time.perf_counter()
    timings: dict[str, int] = {}

    # ------------------------------------------------------------------ #
    # STAGE 1 — Load mesh
    # ------------------------------------------------------------------ #
    yield _sse(1, "running", "Loading and validating mesh…")
    t0 = time.perf_counter()
    try:
        from detector.loader import load_and_validate_mesh
        mesh = load_and_validate_mesh(stl_path)
    except Exception as exc:
        logger.exception("Stage 1 failed")
        yield _sse(1, "error", f"Mesh loading failed: {exc}")
        return
    timings["stage1_load"] = int((time.perf_counter() - t0) * 1000)
    yield _sse(1, "done", f"Mesh loaded: {len(mesh.vertices):,} vertices, "
                          f"{len(mesh.faces):,} faces")

    # ------------------------------------------------------------------ #
    # STAGE 2 — Detect cavities
    # ------------------------------------------------------------------ #
    yield _sse(2, "running", "Detecting stone-setting cavities…")
    t0 = time.perf_counter()
    try:
        from detector.cavity_detector import detect_cavities
        cavities = detect_cavities(mesh)
    except Exception as exc:
        logger.exception("Stage 2 failed")
        yield _sse(2, "error", f"Cavity detection failed: {exc}")
        return
    timings["stage2_detect"] = int((time.perf_counter() - t0) * 1000)
    yield _sse(2, "done", f"Detected {len(cavities)} cavities")

    # ------------------------------------------------------------------ #
    # STAGE 3 — Generate stones
    # ------------------------------------------------------------------ #
    yield _sse(3, "running", f"Generating {stone_type} gemstones…")
    t0 = time.perf_counter()
    try:
        from generator.stone_generator import generate_stones
        stones = generate_stones(cavities, stone_type=stone_type)
    except Exception as exc:
        logger.exception("Stage 3 failed")
        yield _sse(3, "error", f"Stone generation failed: {exc}")
        return
    timings["stage3_generate"] = int((time.perf_counter() - t0) * 1000)
    yield _sse(3, "done", f"Generated {len(stones)} gemstone meshes")

    # ------------------------------------------------------------------ #
    # STAGE 4 — Place stones
    # ------------------------------------------------------------------ #
    yield _sse(4, "running", "Placing stones into cavities…")
    t0 = time.perf_counter()
    try:
        from generator.placer import place_stones
        placement = place_stones(mesh, cavities, stones)
    except Exception as exc:
        logger.exception("Stage 4 failed")
        yield _sse(4, "error", f"Stone placement failed: {exc}")
        return
    timings["stage4_place"] = int((time.perf_counter() - t0) * 1000)
    timings["total"] = int((time.perf_counter() - t_total_start) * 1000)
    yield _sse(4, "done", "Stones placed successfully")

    # ------------------------------------------------------------------ #
    # Serialise mesh data to base64
    # ------------------------------------------------------------------ #
    import trimesh
    jewellery_stl = mesh.export(file_type="stl")
    jewellery_b64 = base64.b64encode(jewellery_stl).decode()
    composite_b64 = base64.b64encode(placement["composite_glb"]).decode()
    stones_b64 = base64.b64encode(placement["stones_glb"]).decode()

    bb = mesh.bounding_box.extents.tolist()

    response_data = {
        "session_id": session_id,
        "metadata": {
            "filename": filename,
            "vertices": len(mesh.vertices),
            "faces": len(mesh.faces),
            "bounding_box_mm": [round(x, 2) for x in bb],
            "total_cavities": len(cavities),
            "processing_time_ms": timings,
        },
        "cavities": cavities,
        "jewellery_mesh_b64": jewellery_b64,
        "composite_mesh_b64": composite_b64,
        "stones_glb_b64": stones_b64,
    }

    # Store in session for /api/regenerate
    _sessions[session_id] = {
        "mesh": mesh,
        "cavities": cavities,
        "stone_type": stone_type,
        "stone_material": stone_material,
        "composite_glb": placement["composite_glb"],
    }

    yield _sse(4, "done", "Processing complete", data=response_data)


def regenerate_stones(session_id: str, stone_type: str,
                      stone_material: str) -> dict | None:
    """
    Re-run stages 3 and 4 only, returning a new response dict.
    Returns None if session_id is not found.
    """
    session = _sessions.get(session_id)
    if session is None:
        return None

    mesh = session["mesh"]
    cavities = session["cavities"]

    from generator.stone_generator import generate_stones
    from generator.placer import place_stones

    stones = generate_stones(cavities, stone_type=stone_type)
    placement = place_stones(mesh, cavities, stones)

    composite_b64 = base64.b64encode(placement["composite_glb"]).decode()
    stones_b64 = base64.b64encode(placement["stones_glb"]).decode()

    session["composite_glb"] = placement["composite_glb"]
    session["stone_type"] = stone_type
    session["stone_material"] = stone_material

    return {
        "session_id": session_id,
        "cavities": cavities,
        "composite_mesh_b64": composite_b64,
        "stones_glb_b64": stones_b64,
    }