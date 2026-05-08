"""
main.py — FastAPI entry point for the jewellery stone-fitting API.
"""

import logging
import os
import tempfile
import uuid

# Load .env (sits alongside this file) before anything reads env vars.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Jewellery Stone Fitting API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/process")
async def process_stl(file: UploadFile = File(...)):
    """
    Accept an STL file, run the 4-stage pipeline, and stream SSE progress events.
    """
    if not file.filename.lower().endswith(".stl"):
        raise HTTPException(status_code=400, detail="Only .stl files are accepted")

    contents = await file.read()

    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    async def stream():
        try:
            from pipeline import run_pipeline
            for event in run_pipeline(tmp_path, file.filename):
                yield event
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


class RegenerateRequest(BaseModel):
    session_id: str
    stone_type: str = "round_brilliant"
    stone_material: str = "Diamond"


@app.post("/api/regenerate")
def regenerate(req: RegenerateRequest):
    from pipeline import regenerate_stones
    result = regenerate_stones(req.session_id, req.stone_type, req.stone_material)
    if result is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse(result)


@app.get("/api/export/glb/{session_id}")
def export_glb(session_id: str):
    from pipeline import get_session
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    glb_bytes = session.get("composite_glb", b"")
    return Response(
        content=glb_bytes,
        media_type="model/gltf-binary",
        headers={"Content-Disposition": f"attachment; filename=jewellery_{session_id[:8]}.glb"},
    )


# ======================================================================= #
# Staged per-stage endpoints — call one at a time so the user can pause
# between stages. Sessions remain compatible with /api/regenerate and
# /api/export/glb afterwards.
# ======================================================================= #

@app.post("/api/session")
async def create_session(file: UploadFile = File(...)):
    """Stage 1 — load + validate the uploaded STL, create a session."""
    if not file.filename.lower().endswith(".stl"):
        raise HTTPException(status_code=400, detail="Only .stl files are accepted")

    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        from pipeline import stage1_load
        result = stage1_load(tmp_path, file.filename)
        return JSONResponse(result)
    except Exception as exc:
        logger.exception("Stage 1 failed")
        raise HTTPException(status_code=500, detail=f"Stage 1 failed: {exc}") from exc
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/session/{session_id}/detect")
def detect_cavities_endpoint(session_id: str):
    try:
        from pipeline import stage2_detect
        result = stage2_detect(session_id)
    except Exception as exc:
        logger.exception("Stage 2 failed")
        raise HTTPException(status_code=500, detail=f"Stage 2 failed: {exc}") from exc
    if result is None:
        raise HTTPException(status_code=409,
                            detail="Session not ready: load the mesh first")
    return JSONResponse(result)


class GenerateRequest(BaseModel):
    stone_type: str = "round_brilliant"


@app.post("/api/session/{session_id}/generate")
def generate_stones_endpoint(session_id: str, req: GenerateRequest | None = None):
    stone_type = req.stone_type if req is not None else "round_brilliant"
    try:
        from pipeline import stage3_generate
        result = stage3_generate(session_id, stone_type=stone_type)
    except Exception as exc:
        logger.exception("Stage 3 failed")
        raise HTTPException(status_code=500, detail=f"Stage 3 failed: {exc}") from exc
    if result is None:
        raise HTTPException(status_code=409,
                            detail="Session not ready: detect cavities first")
    return JSONResponse(result)


@app.post("/api/session/{session_id}/place")
def place_stones_endpoint(session_id: str):
    try:
        from pipeline import stage4_place
        result = stage4_place(session_id)
    except Exception as exc:
        logger.exception("Stage 4 failed")
        raise HTTPException(status_code=500, detail=f"Stage 4 failed: {exc}") from exc
    if result is None:
        raise HTTPException(status_code=409,
                            detail="Session not ready: generate stones first")
    return JSONResponse(result)


@app.get("/api/session/{session_id}")
def session_state_endpoint(session_id: str):
    from pipeline import get_session_state
    state = get_session_state(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse(state)


# ======================================================================= #
# Chat — natural-language stone modifications via Gemini.
# ======================================================================= #

class ChatTurn(BaseModel):
    role: str
    text: str


class ChatRequest(BaseModel):
    message: str
    # Prior turns (excluding the new `message`) so the model can resolve
    # references like "it" or "the same place". Optional for backwards
    # compatibility with older frontends.
    history: list[ChatTurn] = []


@app.post("/api/session/{session_id}/chat")
def chat_endpoint(session_id: str, req: ChatRequest):
    from pipeline import get_session
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    from chat_handler import chat_modify
    try:
        history = [t.model_dump() for t in req.history]
        result = chat_modify(session, req.message, history)
    except Exception as exc:
        logger.exception("Chat handler failed")
        raise HTTPException(status_code=500, detail=f"Chat failed: {exc}") from exc
    return JSONResponse(result)