"""
main.py — FastAPI entry point for the jewellery stone-fitting API.
"""

import logging
import os
import tempfile
import uuid
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