"""
chat_handler.py — natural-language stone modifications via Gemini.

The user types a message ("make all stones bigger", "remove stone 2"); we send
the message + a summary of the current stone state + recent conversation
turns to Gemini, get back a JSON list of operations, and return them to the
frontend which applies them to its state.

Operations are a small fixed vocabulary so we can safely apply whatever Gemini
returns without it going off the rails:
  - set_size                {factor: 0.1..3.0}
  - set_cut                 {cut: round_brilliant|princess|oval|marquise|emerald}
  - set_material            {material: Diamond|Ruby|Emerald|Sapphire|Amethyst}
  - set_color               {color: "#rrggbb"}
  - set_jewellery_material  {material: Silver|Yellow Gold|Rose Gold|White Gold|Platinum|Oxidized}
  - remove_stone            {stone_id: int}
  - restore_all             {}
  - move_stone              {stone_id: int, dx: float, dy: float, dz: float}
  - duplicate_stone         {stone_id: int, dx: float, dy: float, dz: float}
  - add_stone               {x: float, y: float, z: float,
                             nx?: float, ny?: float, nz?: float,
                             diameter_mm?: float, cut?: string}

The validator drops any op that doesn't conform — never blindly forward Gemini.
"""

import json
import logging
import os
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

GEMINI_CHAT_MODEL = "gemini-2.5-flash"

VALID_CUTS = {"round_brilliant", "princess", "oval", "marquise", "emerald"}
VALID_STONE_MATERIALS = {"Diamond", "Ruby", "Emerald", "Sapphire", "Amethyst"}
VALID_JEWELLERY_MATERIALS = {
    "Silver", "Yellow Gold", "Rose Gold", "White Gold", "Platinum", "Oxidized",
}

# Cap absolute deltas so a runaway model can't fling stones off the part.
MAX_OFFSET_MM = 20.0
# Cap absolute coords for add_stone to a generous bounding sphere.
MAX_ABS_COORD_MM = 200.0
# Keep at most this many prior turns when prompting — older context rarely
# helps and inflates the token bill.
MAX_HISTORY_TURNS = 12


def chat_modify(
    session: Dict[str, Any],
    message: str,
    history: List[Dict[str, str]] | None = None,
) -> Dict[str, Any]:
    """Returns {operations: [...], explanation: "..."}"""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {
            "operations": [],
            "explanation": "Gemini API key not configured on the server.",
        }

    cavities = session.get("cavities") or []
    stone_ids = [int(c.get("id", 0)) for c in cavities if isinstance(c, dict)]

    # Pull bounding-box extents from the loaded mesh so the AI can resolve
    # "center of the ring", "top edge", etc. into real coordinates.
    bbox_extents = None
    mesh = session.get("mesh")
    if mesh is not None:
        try:
            bbox_extents = [round(float(v), 2) for v in mesh.bounding_box.extents.tolist()]
        except Exception:  # noqa: BLE001
            bbox_extents = None

    state: Dict[str, Any] = {
        "stone_count": len(cavities),
        "stone_ids": stone_ids,
        "stone_type": session.get("stone_type", "round_brilliant"),
        "stone_material": session.get("stone_material", "Diamond"),
    }
    if bbox_extents is not None:
        state["bounding_box_extents_mm"] = bbox_extents

    prompt = _build_prompt(state, message, history or [])

    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=GEMINI_CHAT_MODEL,
            contents=[prompt],
        )
    except Exception as exc:
        logger.exception("Chat Gemini call failed")
        return {"operations": [], "explanation": f"AI error: {exc}"}

    text = (response.text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    parsed: Any
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return {"operations": [], "explanation":
                    "I couldn't understand that — try rephrasing."}
        try:
            parsed = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {"operations": [], "explanation":
                    "I couldn't understand that — try rephrasing."}

    if not isinstance(parsed, dict):
        return {"operations": [], "explanation": "Unexpected AI response."}

    ops = _validate_operations(parsed.get("operations", []), state)
    explanation = str(parsed.get("explanation", ""))[:300] or "Done."

    return {"operations": ops, "explanation": explanation}


def _format_history(history: List[Dict[str, str]]) -> str:
    """Render the last few turns for the prompt. Empty string if none."""
    if not history:
        return ""
    trimmed = history[-MAX_HISTORY_TURNS:]
    lines = []
    for turn in trimmed:
        role = turn.get("role", "user")
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        prefix = "User" if role == "user" else "Assistant"
        # Cap each line so a runaway turn doesn't dominate the prompt.
        lines.append(f"{prefix}: {text[:300]}")
    if not lines:
        return ""
    return "Recent conversation (oldest first):\n" + "\n".join(lines) + "\n\n"


def _build_prompt(
    state: Dict[str, Any],
    message: str,
    history: List[Dict[str, str]],
) -> str:
    bbox = state.get("bounding_box_extents_mm")
    if bbox and len(bbox) == 3:
        x, y, z = bbox
        bbox_block = (
            f"Mesh bounding box (extents in mm): x={x}, y={y}, z={z}.\n"
            "World coordinates are centered: origin (0,0,0) is the mesh's geometric center.\n"
            f"  - x ranges roughly [{-x/2:.2f}, {x/2:.2f}]\n"
            f"  - y ranges roughly [{-y/2:.2f}, {y/2:.2f}]\n"
            f"  - z ranges roughly [{-z/2:.2f}, {z/2:.2f}]\n"
            "Semantic anchors (use these when the user says 'center', 'top', etc.):\n"
            f"  - 'center of the ring'      → (0, 0, 0)\n"
            f"  - 'top'      → (0, {y/2:.2f}, 0)\n"
            f"  - 'bottom'   → (0, {-y/2:.2f}, 0)\n"
            f"  - 'right'    → ({x/2:.2f}, 0, 0)\n"
            f"  - 'left'     → ({-x/2:.2f}, 0, 0)\n"
            f"  - 'front'    → (0, 0, {z/2:.2f})\n"
            f"  - 'back'     → (0, 0, {-z/2:.2f})\n\n"
        )
    else:
        bbox_block = ""

    return (
        "You are an assistant for a 3D jewellery stone-fitting application. "
        "The user describes a change in plain English; you respond with a JSON "
        "list of operations from the fixed vocabulary below.\n\n"
        f"Current state:\n{json.dumps(state, indent=2)}\n\n"
        f"{bbox_block}"
        f"{_format_history(history)}"
        "Available operations:\n"
        '  - {"type": "set_size", "factor": <0.1..3.0>}                                                  // scale ALL stones\n'
        '  - {"type": "set_cut", "cut": "round_brilliant"|"princess"|"oval"|"marquise"|"emerald"}        // change cut for ALL stones\n'
        '  - {"type": "set_material", "material": "Diamond"|"Ruby"|"Emerald"|"Sapphire"|"Amethyst"}     // change material for ALL\n'
        '  - {"type": "set_color", "color": "#rrggbb"}                                                   // override stone colour\n'
        '  - {"type": "set_jewellery_material", "material": "Silver"|"Yellow Gold"|"Rose Gold"|"White Gold"|"Platinum"|"Oxidized"}\n'
        '  - {"type": "remove_stone", "stone_id": <int>}                                                 // hide one stone\n'
        '  - {"type": "restore_all"}                                                                     // unhide every stone\n'
        '  - {"type": "move_stone", "stone_id": <int>, "dx": <float>, "dy": <float>, "dz": <float>}     // nudge one stone, mm units\n'
        '  - {"type": "duplicate_stone", "stone_id": <int>, "dx": <float>, "dy": <float>, "dz": <float>} // clone a stone at an offset\n'
        '  - {"type": "add_stone", "x": <float>, "y": <float>, "z": <float>,\n'
        '       "nx"?: <float>, "ny"?: <float>, "nz"?: <float>,\n'
        '       "diameter_mm"?: <0.5..10.0>, "cut"?: "round_brilliant"|"princess"|"oval"|"marquise"|"emerald"} // place a NEW stone at an absolute world coordinate\n\n'
        "TARGETING RULES:\n"
        "  - 'all stones' / 'every stone' → use the global ops (set_size, set_cut, set_material, ...).\n"
        "  - 'stone N' / 'the Nth stone' → resolve to that stone_id from stone_ids.\n"
        "  - 'the stone' / 'it' when there is exactly one stone → that stone.\n"
        "  - 'place a stone at the center', 'add one in the middle' → use add_stone with the center anchor.\n"
        "  - When the user references something from earlier in the conversation ('it', 'that one', 'the same place'), resolve from the recent history.\n"
        "  - If ambiguous, return [] and explain in `explanation`.\n\n"
        "SPATIAL LANGUAGE (move_stone / duplicate_stone deltas, in millimetres):\n"
        "  - 'left' → dx negative, 'right' → dx positive\n"
        "  - 'up'   → dy positive, 'down'  → dy negative\n"
        "  - 'forward' / 'closer' → dz positive, 'back' / 'further' → dz negative\n"
        "  - 'a tiny bit' / 'slightly' → 0.2–0.5 mm\n"
        "  - 'a little'                → 0.5–1.5 mm\n"
        "  - 'a lot' / 'way over'      → 2–5 mm\n"
        f"  - Cap individual deltas at ±{MAX_OFFSET_MM:.0f} mm.\n\n"
        "ADD_STONE NOTES:\n"
        "  - Coordinates are absolute, in centered world space — see bounding box and anchors above.\n"
        "  - Default diameter is 2.0 mm; adjust if the user specifies a size.\n"
        "  - Default cut is round_brilliant; match the user's request if they name a cut.\n"
        "  - Normal (nx, ny, nz) is optional — leave unset for a flat-up stone unless the user asked for a specific orientation.\n"
        f"  - Cap absolute coordinates at ±{MAX_ABS_COORD_MM:.0f} mm.\n\n"
        "MULTIPLE OPS:\n"
        "  - One user message can produce several operations. Emit them all in order.\n"
        "  - Example: 'shrink everything and nudge stone 1 left' →\n"
        '    [{"type": "set_size", "factor": 0.8}, {"type": "move_stone", "stone_id": 1, "dx": -1.0, "dy": 0, "dz": 0}]\n'
        "  - Example: 'add a 3mm diamond at the center of the ring' →\n"
        '    [{"type": "add_stone", "x": 0, "y": 0, "z": 0, "diameter_mm": 3.0}]\n\n'
        f"User message: {message}\n\n"
        "Respond with ONLY a JSON object. No markdown, no prose outside the JSON:\n"
        "{\n"
        '  "operations": [<list of operation objects>],\n'
        '  "explanation": "<one short user-facing sentence describing what you did>"\n'
        "}\n"
        "If the request can't be fulfilled, return an empty operations list and "
        "use the explanation field to tell the user what you can do instead."
    )


def _validate_operations(ops: Any, state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Drop any operation that doesn't conform to the schema or references
    a non-existent stone — never blindly forward whatever Gemini returns."""
    if not isinstance(ops, list):
        return []

    valid_stone_ids = set(state.get("stone_ids") or [])
    valid: List[Dict[str, Any]] = []

    for op in ops:
        if not isinstance(op, dict):
            continue
        t = op.get("type")

        if t == "set_size":
            f = op.get("factor")
            if isinstance(f, (int, float)) and 0.1 <= f <= 3.0:
                valid.append({"type": t, "factor": float(f)})

        elif t == "set_cut":
            cut = op.get("cut")
            if cut in VALID_CUTS:
                valid.append({"type": t, "cut": cut})

        elif t == "set_material":
            mat = op.get("material")
            if mat in VALID_STONE_MATERIALS:
                valid.append({"type": t, "material": mat})

        elif t == "set_color":
            c = op.get("color")
            if isinstance(c, str):
                if not c.startswith("#"):
                    c = "#" + c
                if re.match(r"^#[0-9a-fA-F]{6}$", c):
                    valid.append({"type": t, "color": c})

        elif t == "set_jewellery_material":
            mat = op.get("material")
            if mat in VALID_JEWELLERY_MATERIALS:
                valid.append({"type": t, "material": mat})

        elif t == "remove_stone":
            sid = op.get("stone_id")
            if isinstance(sid, int) and sid in valid_stone_ids:
                valid.append({"type": t, "stone_id": sid})

        elif t == "restore_all":
            valid.append({"type": t})

        elif t == "move_stone":
            sid = op.get("stone_id")
            if isinstance(sid, int) and sid in valid_stone_ids:
                delta = _read_delta(op)
                if delta is not None:
                    valid.append({"type": t, "stone_id": sid,
                                  "dx": delta[0], "dy": delta[1], "dz": delta[2]})

        elif t == "duplicate_stone":
            sid = op.get("stone_id")
            if isinstance(sid, int) and sid in valid_stone_ids:
                delta = _read_delta(op)
                if delta is not None:
                    valid.append({"type": t, "stone_id": sid,
                                  "dx": delta[0], "dy": delta[1], "dz": delta[2]})

        elif t == "add_stone":
            entry = _validate_add_stone(op)
            if entry is not None:
                valid.append(entry)

    return valid


def _read_delta(op: Dict[str, Any]) -> tuple[float, float, float] | None:
    """Pull dx/dy/dz from an op, validate as numbers, clamp to MAX_OFFSET_MM."""
    out = []
    for key in ("dx", "dy", "dz"):
        v = op.get(key, 0)
        if not isinstance(v, (int, float)):
            return None
        out.append(max(-MAX_OFFSET_MM, min(MAX_OFFSET_MM, float(v))))
    return out[0], out[1], out[2]


def _validate_add_stone(op: Dict[str, Any]) -> Dict[str, Any] | None:
    """Validate an add_stone op. Coords are required and clamped; everything
    else is optional with sensible defaults applied client-side."""
    coords = []
    for key in ("x", "y", "z"):
        v = op.get(key)
        if not isinstance(v, (int, float)):
            return None
        coords.append(max(-MAX_ABS_COORD_MM, min(MAX_ABS_COORD_MM, float(v))))

    entry: Dict[str, Any] = {
        "type": "add_stone",
        "x": coords[0],
        "y": coords[1],
        "z": coords[2],
    }

    # Optional normal — only emit if all three components are valid numbers.
    nx, ny, nz = op.get("nx"), op.get("ny"), op.get("nz")
    if all(isinstance(v, (int, float)) for v in (nx, ny, nz)):
        entry["nx"] = float(nx)
        entry["ny"] = float(ny)
        entry["nz"] = float(nz)

    diam = op.get("diameter_mm")
    if isinstance(diam, (int, float)) and 0.5 <= diam <= 10.0:
        entry["diameter_mm"] = float(diam)

    cut = op.get("cut")
    if cut in VALID_CUTS:
        entry["cut"] = cut

    return entry
