from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime
import asyncio
import hashlib
import json
import os
import base64
import shutil
from pathlib import Path
import logging
import sys

# Configure logging — stdout only; no FileHandler to avoid double I/O on every request
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)

# Create logger
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_ALLOWED_ORIGINS = {
    "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
    "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
    "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081",
    "http://127.0.0.1:8082",
}

import re
_ORIGIN_RE = re.compile(r"https?://(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$")

def _add_cors(response: Response, origin: Optional[str]) -> None:
    """Attach CORS headers to an existing response object in-place."""
    if origin and (origin in _ALLOWED_ORIGINS or _ORIGIN_RE.match(origin)):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    else:
        response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Expose-Headers"] = "*"

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

_THUMB_SUFFIXES = frozenset([".jpg", ".jpeg", ".png", ".webp"])


def _generate_thumbnail_sync(full_path: Path, thumb_path: Path, thumb_size: int) -> bool:
    """Generate a thumbnail synchronously (runs in a thread pool executor).

    Returns True if the thumbnail was created/already exists, False on error.
    """
    if thumb_path.exists():
        return True
    try:
        from PIL import Image
        thumb_path.parent.mkdir(exist_ok=True)
        with Image.open(full_path) as img:
            ratio = min(thumb_size / img.width, thumb_size / img.height)
            new_size = (max(1, int(img.width * ratio)), max(1, int(img.height * ratio)))
            thumb_img = img.resize(new_size, Image.Resampling.LANCZOS)
            suffix = full_path.suffix.lower()
            if suffix in (".jpg", ".jpeg") and thumb_img.mode == "RGBA":
                thumb_img = thumb_img.convert("RGB")
            thumb_img.save(thumb_path, quality=85, optimize=True)
        return True
    except Exception as exc:
        logger.warning("Thumbnail generation failed for %s: %s", full_path, exc)
        return False

from . import models, schemas
from .database import engine, get_db

import time
for _attempt in range(1, 31):
    try:
        models.Base.metadata.create_all(bind=engine)
        break
    except Exception as _exc:
        logger.warning("DB not ready (attempt %d/30): %s", _attempt, _exc)
        if _attempt == 30:
            raise
        time.sleep(2)

app = FastAPI()

# Ensure required directories exist
Path("data").mkdir(exist_ok=True)
Path("projects").mkdir(exist_ok=True)

# Add permissive CORS middleware - specify origins when credentials are allowed
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8082",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:8082",
    ],
    # Vite uses host "::"; browsers may send Origin: http://[::1]:8080 — not in list above
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Add a simple test endpoint for debugging CORS
@app.get("/test-cors")
async def test_cors(request: Request):
    """Simple endpoint to test CORS configuration"""
    origin = request.headers.get("origin")
    response = JSONResponse(content={"message": "CORS test successful", "origin": origin})
    _add_cors(response, origin)
    return response

# Mount static files directories - COMMENTED OUT TO USE CUSTOM HANDLERS
# app.mount("/data", StaticFiles(directory="data"), name="data")
# app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

# Add OPTIONS handler for static files CORS preflight
@app.options("/static/projects/{file_path:path}")
async def options_project_files(file_path: str, request: Request):
    """Handle CORS preflight requests for static files"""
    origin = request.headers.get("origin")
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }
    if origin and (origin in _ALLOWED_ORIGINS or _ORIGIN_RE.match(origin)):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    else:
        headers["Access-Control-Allow-Origin"] = "*"
    return JSONResponse(content={}, headers=headers)

# Custom static file handlers with explicit CORS
@app.get("/static/projects/{file_path:path}")
async def serve_project_files(file_path: str, request: Request, thumb: Optional[int] = None):
    """Serve project images with optional thumbnail generation.

    Thumbnails are generated in a thread-pool executor (non-blocking) and cached
    indefinitely via Cache-Control + ETag so repeat visits skip the download.
    """
    full_path = Path("projects") / file_path

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    suffix = full_path.suffix.lower()
    media_type = _MEDIA_TYPES.get(suffix)

    # Resolve thumbnail path (generate in thread if missing)
    serve_path = full_path
    if thumb and suffix in _THUMB_SUFFIXES:
        thumb_size = min(thumb, 800)
        thumb_path = full_path.parent / ".thumbs" / f"{full_path.stem}_{thumb_size}{suffix}"
        if not thumb_path.exists():
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, _generate_thumbnail_sync, full_path, thumb_path, thumb_size
            )
        if thumb_path.exists():
            serve_path = thumb_path

    # ETag based on file mtime — enables 304 Not Modified on repeat requests
    try:
        mtime = serve_path.stat().st_mtime
        etag = f'"{hashlib.md5(f"{serve_path}{mtime}".encode()).hexdigest()}"'
    except OSError:
        etag = None

    if etag and request.headers.get("if-none-match") == etag:
        resp_304 = Response(status_code=304)
        _add_cors(resp_304, request.headers.get("origin"))
        return resp_304

    response = FileResponse(
        path=str(serve_path),
        media_type=media_type,
        filename=serve_path.name,
    )

    if etag:
        response.headers["ETag"] = etag
    if thumb:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response.headers["Cache-Control"] = "public, max-age=3600"

    _add_cors(response, request.headers.get("origin"))
    return response

@app.options("/data/{file_path:path}")
async def options_data_files(file_path: str, request: Request):
    """Handle CORS preflight requests for data files"""
    origin = request.headers.get("origin")
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }
    if origin and (origin in _ALLOWED_ORIGINS or _ORIGIN_RE.match(origin)):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    else:
        headers["Access-Control-Allow-Origin"] = "*"
    return JSONResponse(content={}, headers=headers)

@app.get("/data/{file_path:path}")
async def serve_data_files(file_path: str, request: Request):
    """Custom handler for data static files with explicit CORS"""
    full_path = Path("data") / file_path

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    suffix = full_path.suffix.lower()
    response = FileResponse(
        path=str(full_path),
        media_type=_MEDIA_TYPES.get(suffix),
        filename=full_path.name,
    )
    _add_cors(response, request.headers.get("origin"))
    return response

# Ensure exports directory exists
Path("static/exports").mkdir(parents=True, exist_ok=True)

# Add OPTIONS handler for exports CORS preflight
@app.options("/static/exports/{file_path:path}")
async def options_export_files(file_path: str, request: Request):
    """Handle CORS preflight requests for export files"""
    origin = request.headers.get("origin")
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }
    if origin and (origin in _ALLOWED_ORIGINS or _ORIGIN_RE.match(origin)):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    else:
        headers["Access-Control-Allow-Origin"] = "*"
    return JSONResponse(content={}, headers=headers)

# Custom static file handler for exports
@app.get("/static/exports/{file_path:path}")
async def serve_export_files(file_path: str, request: Request):
    """Custom handler for export files with explicit CORS"""
    full_path = Path("static/exports") / file_path
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Export file not found")
    response = FileResponse(
        path=str(full_path),
        media_type="application/octet-stream",
        filename=full_path.name,
    )
    _add_cors(response, request.headers.get("origin"))
    return response

# Ensure inference_results directory exists
Path("static/inference_results").mkdir(parents=True, exist_ok=True)

@app.options("/static/inference_results/{file_path:path}")
async def options_inference_files(file_path: str, request: Request):
    """Handle CORS preflight requests for inference result files"""
    origin = request.headers.get("origin")
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }
    if origin and (origin in _ALLOWED_ORIGINS or _ORIGIN_RE.match(origin)):
        headers["Access-Control-Allow-Origin"] = origin
    else:
        headers["Access-Control-Allow-Origin"] = "*"
    return JSONResponse(content={}, headers=headers)

# Custom static file handler for inference results
@app.get("/static/inference_results/{file_path:path}")
async def serve_inference_files(file_path: str, request: Request):
    """Custom handler for inference result images with explicit CORS"""
    full_path = Path("static/inference_results") / file_path
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Inference result file not found")
    suffix = full_path.suffix.lower()
    response = FileResponse(
        path=str(full_path),
        media_type=_MEDIA_TYPES.get(suffix, "image/jpeg"),
        filename=full_path.name,
    )
    _add_cors(response, request.headers.get("origin"))
    return response

# CORS middleware is handled by the custom middleware above
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=allowed_origins,
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
#     expose_headers=["*"],
#     max_age=3600,
# )

# Mount static files directories - COMMENTED OUT TO USE CUSTOM HANDLERS
# app.mount("/data", StaticFiles(directory="data"), name="data")
# app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")


def _prewarm_thumbnails(projects_root: Path, size: int = 300) -> None:
    """Walk projects/ and generate missing thumbnails for all images.

    Runs in a background thread so it doesn't block app startup or any requests.
    """
    count = generated = 0
    for img_path in projects_root.rglob("*"):
        if img_path.suffix.lower() not in _THUMB_SUFFIXES:
            continue
        if ".thumbs" in img_path.parts:
            continue  # Skip already-generated thumbnails
        count += 1
        thumb_path = img_path.parent / ".thumbs" / f"{img_path.stem}_{size}{img_path.suffix.lower()}"
        if not thumb_path.exists():
            ok = _generate_thumbnail_sync(img_path, thumb_path, size)
            if ok:
                generated += 1
    if count:
        logger.info("Thumbnail pre-warm complete: %d images scanned, %d new thumbnails generated", count, generated)


def _reconcile_pause_requested_tasks_on_startup() -> None:
    """Mark orphaned running tasks as paused after backend restart.

    If pause was requested but the worker never reached the epoch boundary before restart,
    tasks can be left as 'running' forever. This reconciles those to 'paused'.
    """
    recovered = 0
    try:
        with Session(bind=engine) as db:
            running_tasks = db.query(models.Task).filter(models.Task.status == "running").all()
            for task in running_tasks:
                metadata = task.task_metadata or {}
                if not isinstance(metadata, dict):
                    continue
                if not metadata.get("pause_requested_at"):
                    continue

                task.status = "paused"
                task.task_metadata = {
                    **metadata,
                    "stage": "paused",
                    "pause_requested_at": None,
                    "paused_recovered_at": datetime.utcnow().isoformat(),
                }
                recovered += 1

            if recovered:
                db.commit()
                logger.warning("Recovered %d pause-requested running task(s) to paused on startup", recovered)
    except Exception as exc:
        logger.error("Failed startup task reconciliation: %s", exc, exc_info=True)


@app.on_event("startup")
async def startup_prewarm_thumbnails() -> None:
    """Fire-and-forget thumbnail pre-generation so first page loads are fast."""
    _reconcile_pause_requested_tasks_on_startup()
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _prewarm_thumbnails, Path("projects"))


@app.get("/health-check")
async def health_check(db: Session = Depends(get_db)):
    """Health check endpoint that verifies both API and database connectivity"""
    try:
        # Test database connection by executing a simple query
        db.execute(text("SELECT 1"))
        db.commit()
        
        return {
            "status": "ok",
            "database": "connected",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        # Still return 200 but indicate database issue
        return {
            "status": "degraded",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }


# Import routers
from .routers import projects, datasets, tasks, augmentations, dataset_groups, annotation_db, image_collections, segmentation, database_backup, training, predictions, backup, export, pipelines, auto_annotation, preannotate, system, calibration

# Include routers
app.include_router(system.router)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(tasks.router)
app.include_router(augmentations.router)
app.include_router(dataset_groups.router)
app.include_router(annotation_db.router)
app.include_router(image_collections.router)
app.include_router(segmentation.router)
app.include_router(database_backup.router)
app.include_router(training.router)
app.include_router(predictions.router)
app.include_router(backup.router)
app.include_router(export.router)
app.include_router(pipelines.router)
app.include_router(auto_annotation.router)
app.include_router(preannotate.router)
app.include_router(calibration.router)